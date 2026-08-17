/**
 * Writing the subscription row — the one place a paid plan is actually granted.
 *
 * Shared by `/api/pay/verify` and `/api/pay/webhook`, which are the only two
 * callers that may grant a plan from a payment. It lives in its own module
 * because both of them get it wrong in the same two ways otherwise, and because
 * a grant is the single most consequential write in the app: everything
 * `utils/entitlements/service.ts` decides is read back off this row.
 *
 * The two failure modes it exists to handle:
 *
 *   1. Row level security. Neither caller carries a user session — one is
 *      settled from a redirect, the other from Korapay's servers — so under RLS
 *      the anon key cannot insert here and a confirmed payment would silently
 *      leave the payer on the free tier. The routes pass the service-role
 *      client for this reason; see src/utils/supabaseAdmin.ts.
 *
 *   2. An unapplied migration. `cycle_started_at` arrives with
 *      migrations/002_entitlements.sql, and a deployment that has not run it
 *      would otherwise reject every grant over one optional column. The write
 *      retries without it, which still works: `cycleKey` falls back to the
 *      expiry date when no cycle start is stamped.
 *
 * Returns whether the row landed. Callers MUST act on `false` — a payment taken
 * without a grant is money owed.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlanTier } from './plans'

/** PostgREST's "no such column", i.e. migrations/002 has not been applied. */
const MISSING_COLUMN = 'PGRST204'

export interface SubscriptionGrant {
  email: string
  planTier: PlanTier
  amount: number
  reference: string | null
  cycleStartedAt: Date
  expirationDate: Date
}

export async function saveSubscriptionRow(
  supabase: SupabaseClient,
  grant: SubscriptionGrant
): Promise<boolean> {
  const base = {
    email: grant.email,
    plan_tier: grant.planTier,
    amount: grant.amount,
    status: 'active',
    korapay_reference: grant.reference,
    expiration_date: grant.expirationDate.toISOString(),
    updated_at: new Date().toISOString(),
  }

  const upsert = (row: Record<string, unknown>) =>
    supabase.from('subscriptions').upsert(row, { onConflict: 'email' })

  try {
    // Opens a fresh quota window — see utils/entitlements/period.ts.
    const { error } = await upsert({ ...base, cycle_started_at: grant.cycleStartedAt.toISOString() })
    if (!error) return true

    if (error.code !== MISSING_COLUMN) {
      console.error('Subscription grant rejected:', error)
      return false
    }

    console.warn(
      'migrations/002_entitlements.sql has not been applied; granting without cycle_started_at. ' +
        'Quota windows will key off expiration_date instead.'
    )

    const retry = await upsert(base)
    if (retry.error) {
      console.error('Subscription grant rejected on retry:', retry.error)
      return false
    }
    return true
  } catch (e) {
    console.error('Subscription grant threw:', e)
    return false
  }
}
