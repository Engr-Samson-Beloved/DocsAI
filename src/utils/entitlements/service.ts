/**
 * The paywall.
 *
 * Every route that can spend money at an upstream provider asks this module
 * first. It is server-only on purpose: the previous quota check lived in
 * `utils/subscription.ts` and counted generations in localStorage, which meant
 * clearing site data reset it and `/api/generate` accepted anonymous requests
 * regardless. Anything the browser can edit is not a paywall.
 *
 * The shape of a metered call is:
 *
 *   const grant = await requireFeature(req, 'report')
 *   if (!grant.ok) return grant.response        // 401 / 402 / 429, already logged
 *   ...do the expensive thing...
 *   await grant.commit({ projectId })           // only once it actually worked
 *
 * `commit` is separate from the check for one reason: a report the model failed
 * to produce must not cost the user one of two monthly reports. The check
 * decides eligibility, the work runs, and only a success is charged. The gap
 * between them is a small race — two simultaneous requests can both pass a
 * check with one credit left — which is accepted deliberately rather than
 * solved with row locks, because the loss is bounded at one unit and the
 * alternative is a distributed lock in a serverless function.
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveOwner, type RequestOwner } from '../owner'
import {
  FEATURE_LABELS,
  FEATURE_PERIOD,
  METERED_FEATURES,
  PLANS,
  planFor,
  type MeteredFeature,
  type PlanTier,
} from '../plans'
import { cycleKey, periodKeyFor, type CycleSource } from './period'
import { countUsage, countUsageByFeature, recordFailureEntry, recordUsage } from './store'
import type { EntitlementSnapshot, QuotaDecision, QuotaState } from './types'

const SUBSCRIPTION_TABLE = 'subscriptions'

export interface SubscriptionRecord {
  planTier: PlanTier
  status: 'active' | 'expired' | 'free'
  expirationDate: string | null
  korapayReference: string | null
  cycleStartedAt: string | null
  amount: number
}

const FREE_RECORD: SubscriptionRecord = {
  planTier: 'free',
  status: 'free',
  expirationDate: null,
  korapayReference: null,
  cycleStartedAt: null,
  amount: 0,
}

/** The email behind an owner key, when there is one. */
export function emailForOwner(owner: RequestOwner): string | null {
  if (owner.user?.email) return owner.user.email.toLowerCase()
  if (owner.ownerKey.startsWith('local:')) return owner.ownerKey.slice('local:'.length)
  return null
}

/**
 * Reads the live subscription for this caller.
 *
 * Expiry is applied here rather than trusted from the row, because nothing
 * sweeps `subscriptions` when a cycle lapses — the row keeps saying 'active'
 * with a date in the past until the next payment overwrites it.
 */
export async function loadSubscription(
  email: string | null,
  supabase: SupabaseClient | null
): Promise<SubscriptionRecord> {
  if (!email || !supabase) return FREE_RECORD

  try {
    const { data, error } = await supabase
      .from(SUBSCRIPTION_TABLE)
      .select('*')
      .ilike('email', email)
      .maybeSingle()

    if (error || !data) return FREE_RECORD

    const expirationDate: string | null = data.expiration_date ?? null
    const lapsed = expirationDate ? new Date(expirationDate).getTime() < Date.now() : true
    const rowActive = String(data.status ?? '') === 'active'

    if (!rowActive || lapsed) {
      return {
        ...FREE_RECORD,
        status: rowActive || data.status === 'expired' ? 'expired' : 'free',
        expirationDate,
      }
    }

    return {
      planTier: (data.plan_tier ?? 'free') as PlanTier,
      status: 'active',
      expirationDate,
      korapayReference: data.korapay_reference ?? null,
      cycleStartedAt: data.cycle_started_at ?? null,
      amount: Number(data.amount ?? 0),
    }
  } catch (e) {
    console.warn('Could not read the subscription for entitlement checks:', e)
    return FREE_RECORD
  }
}

function cycleSource(email: string | null, record: SubscriptionRecord): CycleSource {
  return {
    status: record.status,
    email,
    korapayReference: record.korapayReference,
    cycleStartedAt: record.cycleStartedAt,
    expirationDate: record.expirationDate,
  }
}

function quotaState(
  feature: MeteredFeature,
  limit: number,
  used: number,
  periodKey: string
): QuotaState {
  return {
    feature,
    label: FEATURE_LABELS[feature],
    period: FEATURE_PERIOD[feature],
    limit,
    used,
    remaining: Math.max(0, limit - used),
    periodKey,
  }
}

/**
 * The caller's full entitlement picture.
 *
 * One rollup query rather than five, because the editor asks for this on every
 * mount and the pricing screen asks again on every render of the status banner.
 */
export async function getEntitlements(owner: RequestOwner): Promise<EntitlementSnapshot> {
  const email = emailForOwner(owner)
  const record = await loadSubscription(email, owner.supabase)
  const plan = planFor(record.planTier)
  const source = cycleSource(email, record)

  const periodKeys = {} as Record<MeteredFeature, string>
  for (const feature of METERED_FEATURES) {
    periodKeys[feature] = periodKeyFor(feature, source)
  }

  const used = await countUsageByFeature(owner.ownerKey, METERED_FEATURES, periodKeys, owner.supabase)

  const quotas = {} as Record<MeteredFeature, QuotaState>
  for (const feature of METERED_FEATURES) {
    quotas[feature] = quotaState(feature, plan.quotas[feature], used[feature] ?? 0, periodKeys[feature])
  }

  return {
    ownerKey: owner.ownerKey,
    email,
    planTier: plan.tier,
    planName: plan.name,
    status: record.status,
    expiresAt: record.expirationDate,
    // "Can prompt a model at all" — the free tier's single integrity check is
    // a scan, not a generation, so it does not make this true.
    canUseAi: plan.quotas.report > 0 || plan.quotas.assist > 0,
    quotas,
  }
}

/** Explains a refusal in the terms the user actually cares about. */
function refusalMessage(
  feature: MeteredFeature,
  planTier: PlanTier,
  state: QuotaState
): string {
  const label = FEATURE_LABELS[feature].toLowerCase()

  if (state.limit === 0) {
    if (planTier === 'free') {
      return (
        `${FEATURE_LABELS[feature]} is a paid feature. Formatting, importing and exporting stay ` +
        `free and unlimited, but prompting the AI needs a plan — the Base Plan is ` +
        `₦${PLANS.basic.amount.toLocaleString('en-NG')} a month.`
      )
    }
    return `Your ${planFor(planTier).name} does not include ${label}. Upgrade to unlock it.`
  }

  const window = state.period === 'day' ? 'today' : 'in this billing cycle'
  return (
    `You have used all ${state.limit} of your ${label} credits ${window} ` +
    `(${state.used}/${state.limit}). Upgrade your plan for more, or wait for the ` +
    `${state.period === 'day' ? 'daily reset' : 'next renewal'}.`
  )
}

/**
 * Decides whether one unit of `feature` may be spent, without spending it.
 *
 * Returns the reservation to pass to `commitUsage` on success. Nothing is
 * written here — see the note at the top of the file about why charging happens
 * after the work, not before it.
 */
export async function checkFeature(
  owner: RequestOwner,
  feature: MeteredFeature,
  quantity = 1
): Promise<QuotaDecision> {
  const snapshot = await getEntitlements(owner)
  const state = snapshot.quotas[feature]

  if (state.remaining < quantity) {
    return {
      allowed: false,
      state,
      snapshot,
      message: refusalMessage(feature, snapshot.planTier, state),
      // 402 means "this needs a plan you do not have"; 429 means "your plan
      // covers this but the allowance is spent". The client renders a different
      // call to action for each.
      statusCode: state.limit === 0 ? 402 : 429,
    }
  }

  return {
    allowed: true,
    reservation: {
      feature,
      periodKey: state.periodKey,
      planTier: snapshot.planTier,
      ownerKey: owner.ownerKey,
      email: snapshot.email,
    },
    state,
    snapshot,
    message: '',
    statusCode: 200,
  }
}

/** Charges a reserved unit. Call only once the paid work actually succeeded. */
export async function commitUsage(
  reservation: NonNullable<QuotaDecision['reservation']>,
  owner: RequestOwner,
  extra: { projectId?: string | null; quantity?: number; metadata?: Record<string, unknown> } = {}
): Promise<void> {
  await recordUsage(
    {
      id: nanoid(16),
      ownerKey: reservation.ownerKey,
      email: reservation.email,
      feature: reservation.feature,
      periodKey: reservation.periodKey,
      planTier: reservation.planTier,
      projectId: extra.projectId ?? null,
      quantity: extra.quantity ?? 1,
      metadata: extra.metadata,
      createdAt: Date.now(),
    },
    owner.supabase
  )
}

/** Files a failure against this caller for the admin history. Never throws. */
export async function recordFailure(
  owner: RequestOwner,
  detail: {
    feature: string
    stage: string
    message: string
    statusCode?: number
    metadata?: Record<string, unknown>
  }
): Promise<void> {
  try {
    await recordFailureEntry(
      {
        id: nanoid(16),
        ownerKey: owner.ownerKey,
        email: emailForOwner(owner),
        feature: detail.feature,
        stage: detail.stage,
        // Bounded: an upstream can return a whole HTML error page, and the
        // failure log is a list the admin reads, not a place to archive one.
        message: String(detail.message).slice(0, 1000),
        statusCode: detail.statusCode ?? null,
        metadata: detail.metadata,
        createdAt: Date.now(),
      },
      owner.supabase
    )
  } catch (e) {
    console.warn('Could not record failure event:', e)
  }
}

/* ── route helper ─────────────────────────────────────────────────── */

export type FeatureGrant =
  | { ok: false; response: NextResponse; owner: RequestOwner }
  | {
      ok: true
      owner: RequestOwner
      snapshot: EntitlementSnapshot
      /** Charges the unit. Safe to call once; a second call double-charges. */
      commit: (extra?: {
        projectId?: string | null
        quantity?: number
        metadata?: Record<string, unknown>
      }) => Promise<void>
      /** Files a failure against this caller, for the admin history. */
      fail: (stage: string, message: string, statusCode?: number) => Promise<void>
    }

/**
 * Resolves the caller, checks the quota, and hands back either a ready-made
 * error response or the means to charge for the work.
 *
 * The refusal is logged as a failure event before it is returned, so the admin
 * dashboard shows paywall hits — those are the most useful signal in the whole
 * log, because each one is someone who wanted to pay for something.
 */
export async function requireFeature(
  req: NextRequest | Request,
  feature: MeteredFeature,
  options: { quantity?: number } = {}
): Promise<FeatureGrant> {
  const owner = await resolveOwner(req)

  if (owner.unauthorized) {
    return {
      ok: false,
      owner,
      response: NextResponse.json(
        { error: 'Your session has expired. Please sign in again.', code: 'unauthorized' },
        { status: 401 }
      ),
    }
  }

  // A guest has no account for a subscription to attach to, so no metered
  // feature can ever be theirs — say so in terms that name the fix.
  if (owner.ownerKey === 'guest') {
    await recordFailure(owner, {
      feature,
      stage: 'auth',
      message: `Anonymous request for ${feature}`,
      statusCode: 401,
    })
    return {
      ok: false,
      owner,
      response: NextResponse.json(
        {
          error:
            'Sign in to use the AI features. Formatting and exporting stay free without an account.',
          code: 'signin_required',
        },
        { status: 401 }
      ),
    }
  }

  const decision = await checkFeature(owner, feature, options.quantity ?? 1)

  if (!decision.allowed) {
    await recordFailure(owner, {
      feature,
      stage: 'quota',
      message: decision.message,
      statusCode: decision.statusCode,
      metadata: { planTier: decision.snapshot.planTier, used: decision.state.used, limit: decision.state.limit },
    })

    return {
      ok: false,
      owner,
      response: NextResponse.json(
        {
          error: decision.message,
          code: decision.statusCode === 402 ? 'plan_required' : 'quota_exhausted',
          feature,
          quota: decision.state,
          planTier: decision.snapshot.planTier,
        },
        { status: decision.statusCode }
      ),
    }
  }

  const reservation = decision.reservation!

  return {
    ok: true,
    owner,
    snapshot: decision.snapshot,
    commit: extra => commitUsage(reservation, owner, extra ?? {}),
    fail: (stage, message, statusCode) =>
      recordFailure(owner, { feature, stage, message, statusCode }),
  }
}

/**
 * Requires a plan that may prompt a model, without charging a credit.
 *
 * For the routes that support a metered action rather than being one. The chat
 * action router (`/api/plan`) is the case this exists for: every chat turn
 * calls it once to decide which tool to run and then calls `/api/generate`,
 * which is where the credit is actually spent. Metering both would silently
 * charge two `assist` credits for one thing the user asked for.
 *
 * It still has to be gated, because it is a Gemini call and a free account must
 * not be able to make one.
 */
export async function requireAiAccess(
  req: NextRequest | Request
): Promise<{ ok: true; owner: RequestOwner; snapshot: EntitlementSnapshot } | { ok: false; response: NextResponse }> {
  const owner = await resolveOwner(req)

  if (owner.unauthorized) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Your session has expired. Please sign in again.', code: 'unauthorized' },
        { status: 401 }
      ),
    }
  }

  if (owner.ownerKey === 'guest') {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Sign in to use the AI features. Formatting and exporting stay free without an account.',
          code: 'signin_required',
        },
        { status: 401 }
      ),
    }
  }

  const snapshot = await getEntitlements(owner)

  if (!snapshot.canUseAi) {
    await recordFailure(owner, {
      feature: 'assist',
      stage: 'quota',
      message: 'AI access attempted on a plan without it',
      statusCode: 402,
    })
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            `AI assistance is a paid feature. Formatting, importing and exporting stay free and ` +
            `unlimited — prompting the AI needs a plan, starting at ` +
            `₦${PLANS.basic.amount.toLocaleString('en-NG')} a month.`,
          code: 'plan_required',
          planTier: snapshot.planTier,
        },
        { status: 402 }
      ),
    }
  }

  return { ok: true, owner, snapshot }
}

/** Re-exported so routes need only one import to meter themselves. */
export { countUsage, cycleKey, periodKeyFor }
