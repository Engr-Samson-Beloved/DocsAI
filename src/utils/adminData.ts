/**
 * The queries behind the admin dashboard.
 *
 * All of them read across every account, which no user-scoped client may do, so
 * they go through the service-role Supabase client. Where SUPABASE_SERVICE_ROLE_KEY
 * is absent they degrade honestly: the reads fall back to whatever this install
 * wrote to disk, and the writes (create a user, grant a plan) report that they
 * need the key rather than silently doing nothing.
 *
 * `degraded` on each result is what the dashboard renders that warning from. An
 * empty list because nothing happened and an empty list because we cannot see
 * the data are very different things to show an operator.
 */

import { getSupabaseAdminClient } from './supabaseAdmin'
import { getSupabaseClient } from './supabase'
import {
  CYCLE_DAYS,
  PLANS,
  planFor,
  type MeteredFeature,
  type PlanTier,
} from './plans'
import { cycleKey } from './entitlements/period'
import { countUsageByFeature, listFailures, listUsage } from './entitlements/store'
import { METERED_FEATURES } from './plans'

export interface AdminSubscriber {
  email: string
  userId: string | null
  planTier: PlanTier
  planName: string
  status: 'active' | 'expired' | 'free'
  amount: number
  expiresAt: string | null
  grantedBy: string | null
  note: string | null
  updatedAt: string | null
  /** Credits spent in the CURRENT window, keyed by feature. */
  used: Record<string, number>
  quotas: Record<MeteredFeature, number>
  /** Present only when the account exists in Supabase Auth. */
  lastSignInAt?: string | null
  createdAt?: string | null
}

export interface DegradableResult<T> {
  data: T
  degraded: boolean
  reason: string | null
}

const NO_SERVICE_KEY =
  'SUPABASE_SERVICE_ROLE_KEY is not set, so this dashboard can only see records written by this install. Set it to manage accounts across the whole deployment.'

/** Prefers the service-role client, falling back to the anon one for reads. */
function readClient() {
  return getSupabaseAdminClient() ?? getSupabaseClient()
}

function subscriptionRowToSubscriber(row: any): AdminSubscriber {
  const expiresAt: string | null = row.expiration_date ?? null
  const lapsed = expiresAt ? new Date(expiresAt).getTime() < Date.now() : true
  const rowActive = String(row.status ?? '') === 'active'
  const active = rowActive && !lapsed

  const tier = (active ? row.plan_tier : 'free') as PlanTier
  const plan = planFor(tier)

  return {
    email: String(row.email ?? '').toLowerCase(),
    userId: row.user_id ?? null,
    planTier: plan.tier,
    planName: plan.name,
    status: active ? 'active' : rowActive || row.status === 'expired' ? 'expired' : 'free',
    amount: Number(row.amount ?? 0),
    expiresAt,
    grantedBy: row.granted_by ?? null,
    note: row.note ?? null,
    updatedAt: row.updated_at ?? null,
    used: {},
    quotas: plan.quotas,
  }
}

/**
 * Everyone with a subscription row, newest first, with their current usage.
 *
 * Accounts that have never had a row — someone who signed up and stayed on the
 * free tier — are folded in from Supabase Auth where the service key allows it,
 * so the list is "everyone" rather than "everyone who paid".
 */
export async function listSubscribers(
  options: { limit?: number; search?: string | null } = {}
): Promise<DegradableResult<AdminSubscriber[]>> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500)
  const admin = getSupabaseAdminClient()
  const client = readClient()

  if (!client) {
    return {
      data: [],
      degraded: true,
      reason: 'Supabase is not configured on this deployment, so there are no accounts to manage.',
    }
  }

  const byEmail = new Map<string, AdminSubscriber>()

  try {
    let query = client
      .from('subscriptions')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(limit)

    if (options.search) query = query.ilike('email', `%${options.search}%`)

    const { data, error } = await query
    if (error) throw error

    for (const row of data ?? []) {
      const subscriber = subscriptionRowToSubscriber(row)
      if (subscriber.email) byEmail.set(subscriber.email, subscriber)
    }
  } catch (e) {
    console.warn('Admin subscriber query failed:', e)
  }

  // Free accounts have no subscription row at all, so they only appear here.
  if (admin) {
    try {
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: limit })
      if (error) throw error

      for (const user of data?.users ?? []) {
        const email = (user.email ?? '').toLowerCase()
        if (!email) continue
        if (options.search && !email.includes(options.search.toLowerCase())) continue

        const existing = byEmail.get(email)
        if (existing) {
          existing.userId = existing.userId ?? user.id
          existing.lastSignInAt = user.last_sign_in_at ?? null
          existing.createdAt = user.created_at ?? null
          continue
        }

        byEmail.set(email, {
          email,
          userId: user.id,
          planTier: 'free',
          planName: PLANS.free.name,
          status: 'free',
          amount: 0,
          expiresAt: null,
          grantedBy: null,
          note: null,
          updatedAt: user.updated_at ?? null,
          used: {},
          quotas: PLANS.free.quotas,
          lastSignInAt: user.last_sign_in_at ?? null,
          createdAt: user.created_at ?? null,
        })
      }
    } catch (e) {
      console.warn('Admin auth user listing failed:', e)
    }
  }

  const subscribers = Array.from(byEmail.values())

  // Usage is counted per account against its OWN current window, so a
  // subscriber mid-cycle and a free account mid-month are both accurate.
  await Promise.all(
    subscribers.map(async subscriber => {
      if (!subscriber.userId) return
      const ownerKey = `user:${subscriber.userId}`
      const cycle = cycleKey({
        status: subscriber.status,
        email: subscriber.email,
        expirationDate: subscriber.expiresAt,
      })

      const periodKeys = {} as Record<MeteredFeature, string>
      for (const feature of METERED_FEATURES) {
        periodKeys[feature] =
          feature === 'assist' ? `day:${new Date().toISOString().slice(0, 10)}` : cycle
      }

      try {
        subscriber.used = await countUsageByFeature(ownerKey, METERED_FEATURES, periodKeys, admin)
      } catch {
        subscriber.used = {}
      }
    })
  )

  return {
    data: subscribers.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')),
    degraded: !admin,
    reason: admin ? null : NO_SERVICE_KEY,
  }
}

/**
 * Puts an account on a plan without a payment.
 *
 * Stamped with `granted_by` so a comped account is never mistaken for a paying
 * one in the dashboard or in revenue figures, and with a fresh `cycle_started_at`
 * so the grant opens a full quota window (see utils/entitlements/period.ts).
 */
export async function grantPlan(input: {
  email: string
  tier: PlanTier
  days?: number
  grantedBy: string
  note?: string | null
}): Promise<{ ok: boolean; error?: string; warning?: string }> {
  // Service role only, and not merely because RLS rejects the anon key here:
  // if the anon key COULD write this table, any browser holding it could put
  // itself on the Elite plan. A grant is an authorisation decision and belongs
  // to a credential the browser never sees.
  const client = getSupabaseAdminClient()
  if (!client) {
    return {
      ok: false,
      error:
        'Changing a plan needs SUPABASE_SERVICE_ROLE_KEY. The subscriptions table is protected by row level security, ' +
        'so the public key cannot write to it — which is what stops a browser granting itself a plan. ' +
        'Set the key in .env.local and restart.',
    }
  }

  const email = input.email.trim().toLowerCase()
  if (!email) return { ok: false, error: 'An email address is required.' }

  const plan = planFor(input.tier)
  const now = new Date()

  // Downgrading to free ends the cycle rather than opening a zero-length one.
  const expires = new Date(now)
  expires.setDate(expires.getDate() + (input.days ?? CYCLE_DAYS))

  const base = {
    email,
    plan_tier: plan.tier,
    amount: plan.amount,
    status: plan.tier === 'free' ? 'free' : 'active',
    // Not a payment, so no korapay_reference: clearing it keeps a comped
    // account from inheriting the previous payment's quota window.
    korapay_reference: null,
    expiration_date: plan.tier === 'free' ? now.toISOString() : expires.toISOString(),
    updated_at: now.toISOString(),
  }

  const withMigration = {
    ...base,
    cycle_started_at: now.toISOString(),
    granted_by: input.grantedBy,
    note: input.note ?? null,
  }

  const upsert = (row: Record<string, unknown>) =>
    client.from('subscriptions').upsert(row, { onConflict: 'email' })

  try {
    const { error } = await upsert(withMigration)
    if (!error) return { ok: true }

    // PGRST204 is PostgREST's "no such column". It means migrations/002 has not
    // been applied to this project yet. Granting a plan is the core admin
    // action and refusing it over three optional columns would be the wrong
    // call — so retry with the columns that predate the migration and say what
    // is degraded. `cycleKey` already falls back to expiration_date, so the
    // grant still opens a working quota window without cycle_started_at.
    if (error.code !== 'PGRST204') throw error

    const retry = await upsert(base)
    if (retry.error) throw retry.error

    return {
      ok: true,
      warning:
        'Applied, but migrations/002_entitlements.sql has not been run on this Supabase project, ' +
        'so the grant is not marked as comped and will be counted as revenue. Run the migration and re-apply.',
    }
  } catch (e: unknown) {
    console.error('Admin plan grant failed:', e)
    // Supabase returns a PostgrestError, which is not an Error instance — the
    // `instanceof` check alone swallowed the only useful part of the message.
    const detail =
      (e as { message?: string })?.message ??
      (e instanceof Error ? e.message : null) ??
      'Could not update the plan.'
    return { ok: false, error: detail }
  }
}

/**
 * Creates an account.
 *
 * Requires the service-role key: minting a user is `auth.admin.createUser`, and
 * the anon client has no such method. The account is created email-confirmed,
 * because an admin adding someone by hand has already vouched for the address
 * and a confirmation link they never see would leave the account unusable.
 */
export async function createUser(input: {
  email: string
  password: string
  tier?: PlanTier
  grantedBy: string
}): Promise<{ ok: boolean; error?: string; userId?: string }> {
  const admin = getSupabaseAdminClient()
  if (!admin) {
    return {
      ok: false,
      error:
        'Creating accounts needs SUPABASE_SERVICE_ROLE_KEY. Set it in .env.local and restart, or have the user sign up themselves and grant them a plan here.',
    }
  }

  const email = input.email.trim().toLowerCase()
  if (!email || !input.password) {
    return { ok: false, error: 'An email address and a password are required.' }
  }
  if (input.password.length < 6) {
    return { ok: false, error: 'The password must be at least 6 characters.' }
  }

  try {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
    })
    if (error) throw error

    // A tier of 'free' needs no row; the absence of one already means free.
    if (input.tier && input.tier !== 'free') {
      const granted = await grantPlan({
        email,
        tier: input.tier,
        grantedBy: input.grantedBy,
        note: 'Created from the admin dashboard',
      })
      if (!granted.ok) {
        return {
          ok: true,
          userId: data.user?.id,
          error: `The account was created but the plan could not be applied: ${granted.error}`,
        }
      }
    }

    return { ok: true, userId: data.user?.id }
  } catch (e) {
    console.error('Admin user creation failed:', e)
    return { ok: false, error: e instanceof Error ? e.message : 'Could not create the account.' }
  }
}

export interface AdminOverview {
  totalAccounts: number
  activeSubscribers: number
  byTier: Record<PlanTier, number>
  /** Naira currently under active subscription, comped accounts excluded. */
  monthlyRevenue: number
  compedAccounts: number
  usageLast30Days: Record<string, number>
  failuresLast7Days: number
  topFailureStage: string | null
}

/** The numbers across the top of the dashboard. */
export async function overview(): Promise<DegradableResult<AdminOverview>> {
  const subscribers = await listSubscribers({ limit: 500 })

  const byTier: Record<PlanTier, number> = { free: 0, basic: 0, pro: 0, enterprise: 0 }
  let activeSubscribers = 0
  let monthlyRevenue = 0
  let compedAccounts = 0

  for (const subscriber of subscribers.data) {
    byTier[subscriber.planTier] = (byTier[subscriber.planTier] ?? 0) + 1
    if (subscriber.status === 'active' && subscriber.planTier !== 'free') {
      activeSubscribers += 1
      if (subscriber.grantedBy) compedAccounts += 1
      // A comped account produces no revenue, so it is counted as a subscriber
      // but not as money.
      else monthlyRevenue += PLANS[subscriber.planTier].amount
    }
  }

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

  const usageRows = await listUsage({ limit: 1000, since: thirtyDaysAgo })
  const usageLast30Days: Record<string, number> = {}
  for (const feature of METERED_FEATURES) usageLast30Days[feature] = 0
  for (const row of usageRows) {
    usageLast30Days[row.feature] = (usageLast30Days[row.feature] ?? 0) + row.quantity
  }

  const failures = await listFailures({ limit: 1000, since: sevenDaysAgo })
  const stageCounts = new Map<string, number>()
  for (const failure of failures) {
    stageCounts.set(failure.stage, (stageCounts.get(failure.stage) ?? 0) + 1)
  }
  const topFailureStage =
    Array.from(stageCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  return {
    data: {
      totalAccounts: subscribers.data.length,
      activeSubscribers,
      byTier,
      monthlyRevenue,
      compedAccounts,
      usageLast30Days,
      failuresLast7Days: failures.length,
      topFailureStage,
    },
    degraded: subscribers.degraded,
    reason: subscribers.reason,
  }
}
