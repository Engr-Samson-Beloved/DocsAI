"use client"

/**
 * Client side of the paywall.
 *
 * This is a MIRROR of the server's decision, never the decision itself. Every
 * metered route re-checks the quota before it spends anything, so the worst a
 * tampered client can do is show itself a button that the server then refuses.
 * The reason it exists at all is that meeting a paywall three seconds into a
 * full report is a worse experience than seeing the button disabled with the
 * reason on it.
 *
 * The previous version of this counted generations in localStorage and WAS the
 * decision, which meant clearing site data reset the quota. Nothing here writes
 * a counter any more.
 */

import type { MeteredFeature, PlanTier } from './plans'

export interface QuotaState {
  feature: MeteredFeature
  label: string
  period: 'cycle' | 'day'
  /** Null means unlimited (an owner account). Check `unlimited` before formatting. */
  limit: number | null
  used: number
  /** Null when `unlimited`. */
  remaining: number | null
  unlimited: boolean
  periodKey: string
}

export interface EntitlementSnapshot {
  ownerKey: string
  email: string | null
  planTier: PlanTier
  planName: string
  status: 'active' | 'expired' | 'free'
  expiresAt: string | null
  canUseAi: boolean
  /** True for an account that owns the deployment and is metered by nothing. */
  owner: boolean
  quotas: Record<MeteredFeature, QuotaState>
}

/** Why a metered action was refused, in a form the UI can act on. */
export interface QuotaRefusal {
  allowed: false
  /** 'signin_required' | 'plan_required' | 'quota_exhausted' | 'error' */
  code: string
  message: string
  quota?: QuotaState
  planTier?: PlanTier
}

export type QuotaVerdict = { allowed: true; quota?: QuotaState } | QuotaRefusal

export function authHeaders(json = false): Record<string, string> {
  const headers: Record<string, string> = {}
  if (json) headers['Content-Type'] = 'application/json'
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('wordpi-session-token')
    if (token) headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

/**
 * Turns a refused response into a refusal.
 *
 * Every metered route answers 401/402/429 with the same JSON shape, so one
 * reader covers all of them and the editor does not need a per-feature error
 * branch.
 */
export async function readRefusal(res: Response): Promise<QuotaRefusal> {
  let body: any = null
  try {
    body = await res.json()
  } catch {
    /* fall through to the generic message */
  }

  return {
    allowed: false,
    code: body?.code || (res.status === 401 ? 'signin_required' : 'error'),
    message:
      body?.error ||
      (res.status === 401
        ? 'Sign in to use the AI features.'
        : 'This action is not available on your current plan.'),
    quota: body?.quota,
    planTier: body?.planTier,
  }
}

/** True when a response was refused by the paywall rather than by anything else. */
export function isPaywallStatus(status: number): boolean {
  return status === 401 || status === 402 || status === 429
}

let cached: Promise<EntitlementSnapshot | null> | null = null

/**
 * The caller's plan and remaining credits.
 *
 * Cached for the session because the editor asks on mount and the toolbar asks
 * again on every render. `refresh` drops the cache — call it after a payment
 * settles or a credit is spent, or the UI will keep showing a stale count.
 */
export function fetchEntitlements(options: { refresh?: boolean } = {}): Promise<EntitlementSnapshot | null> {
  if (options.refresh) cached = null
  if (!cached) {
    cached = fetch('/api/entitlements', { headers: authHeaders(), cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then(body => (body?.entitlements as EntitlementSnapshot) ?? null)
      .catch(() => null)
  }
  return cached
}

/** Drops the cached snapshot so the next read comes from the server. */
export function invalidateEntitlements(): void {
  cached = null
}

/**
 * Asks whether one unit of `feature` may be spent. Writes nothing.
 *
 * Used as a pre-flight so a blocked action fails before the user waits — and
 * before, in the report case, an empty project is left stranded in the
 * dashboard.
 */
export async function checkFeatureAccess(feature: MeteredFeature): Promise<QuotaVerdict> {
  try {
    const res = await fetch('/api/entitlements', {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ action: 'check', feature }),
    })

    if (res.ok) {
      const body = await res.json()
      return { allowed: true, quota: body?.quota }
    }

    return readRefusal(res)
  } catch {
    // A network failure is not a paywall decision. The server re-checks before
    // it spends anything, so letting the action proceed here is safe and keeps
    // a flaky connection from looking like a billing problem.
    return { allowed: true }
  }
}

/**
 * Charges one unit of `feature`.
 *
 * Only for features with no server route of their own — in practice the
 * PowerPoint deck builder, which runs entirely in the browser. Call it AFTER
 * the work succeeded. Everything that spends provider credit is metered on the
 * server and must not be charged from here.
 */
export async function consumeFeature(
  feature: MeteredFeature,
  extra: { projectId?: string | null; metadata?: Record<string, unknown> } = {}
): Promise<QuotaVerdict> {
  try {
    const res = await fetch('/api/entitlements', {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ action: 'consume', feature, ...extra }),
    })

    if (res.ok) {
      const body = await res.json()
      if (body?.entitlements) cached = Promise.resolve(body.entitlements as EntitlementSnapshot)
      return { allowed: true }
    }

    return readRefusal(res)
  } catch {
    return { allowed: true }
  }
}

/** A short "2 of 4 left" style line for a toolbar or menu item. */
export function describeQuota(quota: QuotaState | undefined): string {
  if (!quota) return ''
  if (quota.unlimited) return 'Unlimited'
  if (quota.limit === 0) return 'Not on your plan'
  const window = quota.period === 'day' ? 'today' : 'this cycle'
  return `${quota.remaining} of ${quota.limit} left ${window}`
}
