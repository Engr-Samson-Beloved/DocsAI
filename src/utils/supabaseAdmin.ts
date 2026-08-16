/**
 * Service-role Supabase client.
 *
 * Exists for exactly one caller: the Copyleaks completion webhook. That request
 * arrives from Copyleaks' servers with no user session attached, so the
 * user-scoped anon client in `supabase.ts` cannot satisfy the row-level
 * security policies in `data/migrations/001_integrity_checks.sql` and the scan
 * result would be silently dropped.
 *
 * Kept in its own module rather than added to `supabase.ts` so the service key
 * has one importer that is easy to audit. It must never be imported by a
 * client component: the key bypasses RLS entirely, and Next will happily bundle
 * whatever a `"use client"` file imports.
 *
 * When SUPABASE_SERVICE_ROLE_KEY is unset this returns null and the webhook
 * falls back to the on-disk store — which is the correct behaviour for a local
 * install, and a real (logged) limitation on a serverless one.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

function cleanUrl(raw: string): string {
  let url = raw.trim()
  if (url.startsWith('"') && url.endsWith('"')) url = url.slice(1, -1)
  url = url.replace(/\/+$/, '')
  if (url.endsWith('/rest/v1')) url = url.slice(0, -8).replace(/\/+$/, '')
  return url
}

export function getSupabaseAdminClient(): SupabaseClient | null {
  if (cached) return cached

  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) return null

  try {
    cached = createClient(cleanUrl(url), serviceKey.trim(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    return cached
  } catch (error) {
    console.error('Failed to initialise the Supabase service client:', error)
    return null
  }
}
