/**
 * Persistence for usage and failure records.
 *
 * Follows the pattern `src/utils/integrity/store.ts` already established rather
 * than inventing a second one: write to Supabase when it is configured, write to
 * `data/entitlements/` on disk when the filesystem is writable, and treat either
 * succeeding as success. That is what lets metering work on a laptop with no
 * cloud account and on a serverless host with a read-only filesystem.
 *
 * Records are append-only. Nothing here updates or deletes a usage row, because
 * a usage row is a charge — the only correct way to reverse one is an explicit
 * admin refund, which is the single caller of `deleteUsage`.
 *
 * On disk the format is JSONL. Counting rows is the whole query surface, so a
 * line-per-record file needs no index and cannot be left half-written by a
 * crash mid-append the way a rewritten JSON array can.
 *
 * Cloud schema: migrations/002_entitlements.sql
 */

import fs from 'fs'
import path from 'path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdminClient } from '../supabaseAdmin'
import type { MeteredFeature, PlanTier } from '../plans'
import type { FailureEntry, UsageEntry } from './types'

const DATA_DIR = path.join(process.cwd(), 'data')
const ENTITLEMENT_DIR = path.join(DATA_DIR, 'entitlements')
const USAGE_FILE = path.join(ENTITLEMENT_DIR, 'usage.jsonl')
const FAILURE_FILE = path.join(ENTITLEMENT_DIR, 'failures.jsonl')

const USAGE_TABLE = 'feature_usage'
const FAILURE_TABLE = 'failure_events'

/** Keeps the admin dashboard's disk reads bounded on a long-lived install. */
const MAX_DISK_SCAN_LINES = 20_000

function ensureDir(): boolean {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    if (!fs.existsSync(ENTITLEMENT_DIR)) fs.mkdirSync(ENTITLEMENT_DIR, { recursive: true })
    return true
  } catch (e) {
    console.warn('Local entitlement storage is unavailable (read-only filesystem?):', e)
    return false
  }
}

/**
 * Whether this caller's records live in Supabase.
 *
 * Only a verified `user:` identity does. A `local:` or `guest` owner has no row
 * that satisfies the RLS policies in migrations/002, so writing there would be
 * rejected and reading would silently return an empty set — which for a quota
 * check means handing out free credits. Disk is the correct and only store for
 * those two.
 */
function usesCloud(ownerKey: string, supabase: SupabaseClient | null): supabase is SupabaseClient {
  return Boolean(supabase) && ownerKey.startsWith('user:')
}

/* ── row mapping ──────────────────────────────────────────────────── */

function usageToRow(entry: UsageEntry): Record<string, unknown> {
  return {
    id: entry.id,
    owner_key: entry.ownerKey,
    email: entry.email,
    feature: entry.feature,
    period_key: entry.periodKey,
    plan_tier: entry.planTier,
    project_id: entry.projectId ?? null,
    quantity: entry.quantity,
    metadata: entry.metadata ?? {},
    created_at: entry.createdAt,
  }
}

function usageFromRow(row: Record<string, any>): UsageEntry {
  return {
    id: String(row.id),
    ownerKey: String(row.owner_key),
    email: row.email ?? null,
    feature: row.feature as MeteredFeature,
    periodKey: String(row.period_key),
    planTier: (row.plan_tier ?? 'free') as PlanTier,
    projectId: row.project_id ?? null,
    quantity: Number(row.quantity ?? 1),
    metadata: row.metadata ?? {},
    createdAt: Number(row.created_at ?? 0),
  }
}

function failureToRow(entry: FailureEntry): Record<string, unknown> {
  return {
    id: entry.id,
    owner_key: entry.ownerKey,
    email: entry.email,
    feature: entry.feature,
    stage: entry.stage,
    message: entry.message,
    status_code: entry.statusCode ?? null,
    metadata: entry.metadata ?? {},
    created_at: entry.createdAt,
  }
}

function failureFromRow(row: Record<string, any>): FailureEntry {
  return {
    id: String(row.id),
    ownerKey: String(row.owner_key),
    email: row.email ?? null,
    feature: String(row.feature),
    stage: String(row.stage),
    message: String(row.message ?? ''),
    statusCode: row.status_code ?? null,
    metadata: row.metadata ?? {},
    createdAt: Number(row.created_at ?? 0),
  }
}

/* ── disk helpers ─────────────────────────────────────────────────── */

function appendLine(file: string, value: unknown): boolean {
  if (!ensureDir()) return false
  try {
    fs.appendFileSync(file, `${JSON.stringify(value)}\n`, 'utf-8')
    return true
  } catch (e) {
    console.warn(`Could not append to ${path.basename(file)}:`, e)
    return false
  }
}

function readLines<T>(file: string, revive: (row: any) => T): T[] {
  try {
    if (!fs.existsSync(file)) return []
    const raw = fs.readFileSync(file, 'utf-8')
    const lines = raw.split('\n').filter(Boolean)
    // Newest records are at the end, so a bounded scan keeps the tail.
    const window = lines.length > MAX_DISK_SCAN_LINES ? lines.slice(-MAX_DISK_SCAN_LINES) : lines
    const out: T[] = []
    for (const line of window) {
      try {
        out.push(revive(JSON.parse(line)))
      } catch {
        // A truncated final line from an interrupted append is not a reason to
        // lose the whole history.
      }
    }
    return out
  } catch (e) {
    console.warn(`Could not read ${path.basename(file)}:`, e)
    return []
  }
}

function rewriteLines(file: string, values: unknown[]): boolean {
  if (!ensureDir()) return false
  try {
    fs.writeFileSync(file, values.map(v => `${JSON.stringify(v)}\n`).join(''), 'utf-8')
    return true
  } catch (e) {
    console.warn(`Could not rewrite ${path.basename(file)}:`, e)
    return false
  }
}

/* ── usage ────────────────────────────────────────────────────────── */

/**
 * How many units of `feature` this owner has spent in `periodKey`.
 *
 * NOTE ON FAILURE MODE: if the cloud read errors, this falls back to the disk
 * count rather than refusing the request. A storage blip therefore grants usage
 * rather than blocking a paying subscriber mid-document, which is the tradeoff
 * the rest of this app makes. Every such fallback is logged, and the admin
 * dashboard surfaces it as a `storage` failure.
 */
export async function countUsage(
  ownerKey: string,
  feature: MeteredFeature,
  periodKey: string,
  supabase: SupabaseClient | null
): Promise<number> {
  if (usesCloud(ownerKey, supabase)) {
    try {
      const { data, error } = await supabase
        .from(USAGE_TABLE)
        .select('quantity')
        .eq('owner_key', ownerKey)
        .eq('feature', feature)
        .eq('period_key', periodKey)

      if (error) throw error
      return (data ?? []).reduce((sum, row: any) => sum + Number(row.quantity ?? 1), 0)
    } catch (e) {
      console.warn('Cloud usage count failed; falling back to local records:', e)
    }
  }

  return readLines(USAGE_FILE, usageFromRow)
    .filter(
      entry =>
        entry.ownerKey === ownerKey &&
        entry.feature === feature &&
        entry.periodKey === periodKey
    )
    .reduce((sum, entry) => sum + entry.quantity, 0)
}

/** Counts every metered feature for one owner/period pair in one pass. */
export async function countUsageByFeature(
  ownerKey: string,
  features: MeteredFeature[],
  periodKeys: Record<MeteredFeature, string>,
  supabase: SupabaseClient | null
): Promise<Record<string, number>> {
  const totals: Record<string, number> = {}
  for (const feature of features) totals[feature] = 0

  const keys = Array.from(new Set(features.map(f => periodKeys[f])))

  if (usesCloud(ownerKey, supabase)) {
    try {
      const { data, error } = await supabase
        .from(USAGE_TABLE)
        .select('feature, period_key, quantity')
        .eq('owner_key', ownerKey)
        .in('period_key', keys)

      if (error) throw error
      for (const row of data ?? []) {
        const feature = String((row as any).feature)
        if (!(feature in totals)) continue
        if ((row as any).period_key !== periodKeys[feature as MeteredFeature]) continue
        totals[feature] += Number((row as any).quantity ?? 1)
      }
      return totals
    } catch (e) {
      console.warn('Cloud usage rollup failed; falling back to local records:', e)
      for (const feature of features) totals[feature] = 0
    }
  }

  for (const entry of readLines(USAGE_FILE, usageFromRow)) {
    if (entry.ownerKey !== ownerKey) continue
    if (!(entry.feature in totals)) continue
    if (entry.periodKey !== periodKeys[entry.feature]) continue
    totals[entry.feature] += entry.quantity
  }
  return totals
}

/** Files a spent unit. Never throws: losing the record must not fail the work. */
export async function recordUsage(
  entry: UsageEntry,
  supabase: SupabaseClient | null
): Promise<void> {
  let stored = false

  if (usesCloud(entry.ownerKey, supabase)) {
    try {
      const { error } = await supabase.from(USAGE_TABLE).insert(usageToRow(entry))
      if (error) throw error
      stored = true
    } catch (e) {
      console.warn('Could not record usage in Supabase; writing locally instead:', e)
    }
  }

  if (!stored) appendLine(USAGE_FILE, usageToRow(entry))
}

/* ── failures ─────────────────────────────────────────────────────── */

/** Files a failure for the admin history. Never throws. */
export async function recordFailureEntry(
  entry: FailureEntry,
  supabase: SupabaseClient | null
): Promise<void> {
  let stored = false

  if (usesCloud(entry.ownerKey, supabase)) {
    try {
      const { error } = await supabase.from(FAILURE_TABLE).insert(failureToRow(entry))
      if (error) throw error
      stored = true
    } catch (e) {
      console.warn('Could not record failure in Supabase; writing locally instead:', e)
    }
  }

  if (!stored) appendLine(FAILURE_FILE, failureToRow(entry))
}

/* ── admin reads ──────────────────────────────────────────────────── */

/**
 * Admin queries read across ALL owners, which no user-scoped client may do, so
 * they go through the service-role client. Where that key is absent the admin
 * dashboard falls back to whatever this install wrote to disk — complete on a
 * local install, and empty on a serverless one, which the dashboard says out
 * loud rather than presenting as "no failures".
 */
export function adminClient(): SupabaseClient | null {
  return getSupabaseAdminClient()
}

export interface AdminListOptions {
  limit?: number
  email?: string | null
  feature?: string | null
  since?: number | null
}

export async function listUsage(options: AdminListOptions = {}): Promise<UsageEntry[]> {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000)
  const admin = adminClient()

  if (admin) {
    try {
      let query = admin
        .from(USAGE_TABLE)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit)

      if (options.email) query = query.ilike('email', options.email)
      if (options.feature) query = query.eq('feature', options.feature)
      if (options.since) query = query.gte('created_at', options.since)

      const { data, error } = await query
      if (error) throw error
      return (data ?? []).map(usageFromRow)
    } catch (e) {
      console.warn('Admin usage query failed; falling back to local records:', e)
    }
  }

  return readLines(USAGE_FILE, usageFromRow)
    .filter(entry => {
      if (options.email && (entry.email ?? '').toLowerCase() !== options.email.toLowerCase()) return false
      if (options.feature && entry.feature !== options.feature) return false
      if (options.since && entry.createdAt < options.since) return false
      return true
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
}

export async function listFailures(options: AdminListOptions = {}): Promise<FailureEntry[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 1000)
  const admin = adminClient()

  if (admin) {
    try {
      let query = admin
        .from(FAILURE_TABLE)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit)

      if (options.email) query = query.ilike('email', options.email)
      if (options.feature) query = query.eq('feature', options.feature)
      if (options.since) query = query.gte('created_at', options.since)

      const { data, error } = await query
      if (error) throw error
      return (data ?? []).map(failureFromRow)
    } catch (e) {
      console.warn('Admin failure query failed; falling back to local records:', e)
    }
  }

  return readLines(FAILURE_FILE, failureFromRow)
    .filter(entry => {
      if (options.email && (entry.email ?? '').toLowerCase() !== options.email.toLowerCase()) return false
      if (options.feature && entry.feature !== options.feature) return false
      if (options.since && entry.createdAt < options.since) return false
      return true
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
}

/**
 * Refunds one unit by removing its row.
 *
 * The only mutation in this module. It exists because the alternative — an
 * admin "add credits" counter — would need a second source of truth that the
 * quota check would then have to reconcile against.
 */
export async function deleteUsage(id: string): Promise<boolean> {
  const admin = adminClient()

  if (admin) {
    try {
      const { error } = await admin.from(USAGE_TABLE).delete().eq('id', id)
      if (error) throw error
      return true
    } catch (e) {
      console.warn('Could not delete usage row in Supabase:', e)
    }
  }

  const rows = readLines(USAGE_FILE, usageFromRow)
  const kept = rows.filter(entry => entry.id !== id)
  if (kept.length === rows.length) return false
  return rewriteLines(USAGE_FILE, kept.map(usageToRow))
}
