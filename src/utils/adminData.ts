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
import { listGrants } from './entitlements/grantStore'
import { saveSubscriptionRow } from './subscriptionWrite'
import { isOwnerEmail, METERED_FEATURES } from './plans'

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
  /** True when the plan lives only in the on-disk fallback store. */
  localOnly?: boolean
  /** True for an account that owns the deployment and is metered by nothing. */
  owner?: boolean
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

  // Plans granted to the on-disk fallback because the cloud write was refused.
  // Without this the dashboard would show a paying customer as free — which is
  // the one thing an operator diagnosing "I paid and nothing happened" needs to
  // see. A cloud row always wins where both exist.
  for (const grant of listGrants()) {
    if (options.search && !grant.email.includes(options.search.toLowerCase())) continue
    if (byEmail.has(grant.email)) continue

    const plan = planFor(grant.planTier)
    const lapsed = new Date(grant.expirationDate).getTime() < Date.now()

    byEmail.set(grant.email, {
      email: grant.email,
      userId: null,
      planTier: lapsed ? 'free' : plan.tier,
      planName: lapsed ? PLANS.free.name : plan.name,
      status: lapsed ? 'expired' : 'active',
      amount: grant.amount,
      expiresAt: grant.expirationDate,
      grantedBy: grant.grantedBy ?? null,
      note: 'Granted locally — not written to Supabase',
      updatedAt: new Date(grant.createdAt).toISOString(),
      used: {},
      quotas: lapsed ? PLANS.free.quotas : plan.quotas,
      localOnly: true,
    })
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

  // Owner accounts are metered by nothing, so their per-feature numbers below
  // are activity rather than consumption. Flagged so the table can say so
  // instead of showing a used/limit ratio that means nothing.
  for (const subscriber of subscribers) {
    if (isOwnerEmail(subscriber.email)) subscriber.owner = true
  }

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
  const email = input.email.trim().toLowerCase()
  if (!email) return { ok: false, error: 'An email address is required.' }

  const plan = planFor(input.tier)
  const now = new Date()

  // Downgrading to free ends the cycle rather than opening a zero-length one.
  const expires = new Date(now)
  expires.setDate(expires.getDate() + (input.days ?? CYCLE_DAYS))

  // Goes through the same writer the payment paths use, so an admin grant and a
  // paid grant land the same way and degrade the same way. Prefers the
  // service-role client — under RLS the anon key cannot write `subscriptions`,
  // which is exactly what stops a browser granting itself a plan — and falls
  // back to the on-disk store when neither is available.
  const outcome = await saveSubscriptionRow(getSupabaseAdminClient(), {
    email,
    planTier: plan.tier,
    amount: plan.amount,
    // Not a payment, so no reference: clearing it keeps a comped account from
    // inheriting the previous payment's quota window.
    reference: null,
    cycleStartedAt: now,
    expirationDate: plan.tier === 'free' ? now : expires,
    grantedBy: input.grantedBy,
  })

  if (outcome === 'failed') {
    return {
      ok: false,
      error:
        'Could not apply the plan. Set SUPABASE_SERVICE_ROLE_KEY in .env.local and restart — the subscriptions ' +
        'table is protected by row level security, so the public key cannot write to it, and the local ' +
        'fallback store is not writable on this deployment either.',
    }
  }

  if (outcome === 'local') {
    return {
      ok: true,
      warning:
        'Applied to this deployment only. SUPABASE_SERVICE_ROLE_KEY is not set, so the grant was written to ' +
        'the local store instead of Supabase and will not survive a redeploy. Set the key to make it permanent.',
    }
  }

  return { ok: true }
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
