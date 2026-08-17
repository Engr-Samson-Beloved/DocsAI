/**
 * Which window a quota is counted over.
 *
 * The whole metering scheme rests on one idea: usage rows carry the key of the
 * window they were spent in, and a quota check counts the rows whose key
 * matches the CURRENT window. Nothing is ever reset, decremented or swept —
 * the window moves and the old rows simply stop matching.
 *
 * That is what makes a renewal work. Paying again produces a new Korapay
 * reference, which produces a new cycle key, which means zero rows match and
 * the subscriber has their full allowance back. No cron job, no reset endpoint,
 * and no way for a reset to half-run and leave someone short.
 */

import { FEATURE_PERIOD, type MeteredFeature } from '../plans'

/** UTC so a laptop's timezone cannot hand someone a second daily allowance. */
function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

function utcMonth(now: number): string {
  return new Date(now).toISOString().slice(0, 7)
}

/** Identifies the subscription cycle a paid account is currently inside. */
export interface CycleSource {
  status: 'active' | 'expired' | 'free'
  email?: string | null
  /** The payment that opened this cycle. The most stable key available. */
  korapayReference?: string | null
  /** Set on admin-granted plans, which have no payment reference. */
  cycleStartedAt?: string | null
  expirationDate?: string | null
}

/**
 * The key for a per-cycle allowance.
 *
 * Preference order is deliberate. A Korapay reference is unique per payment, so
 * it is the ideal key. An admin grant has no payment, so it falls back to the
 * stamped cycle start. Expiry is the last resort — it moves with the cycle too,
 * but two renewals landing on the same expiry date would share a bucket, which
 * is why it is not preferred.
 *
 * An account with no live subscription counts against the calendar month. That
 * is what gives a free account its one integrity check per month rather than
 * one ever.
 */
export function cycleKey(source: CycleSource, now: number = Date.now()): string {
  if (source.status === 'active') {
    if (source.korapayReference) return `sub:${source.korapayReference}`
    if (source.cycleStartedAt) return `sub:${source.email || 'anon'}:${source.cycleStartedAt}`
    if (source.expirationDate) return `sub:${source.email || 'anon'}:${source.expirationDate}`
  }
  return `month:${utcMonth(now)}`
}

/** The key a given feature's usage should be filed under right now. */
export function periodKeyFor(
  feature: MeteredFeature,
  source: CycleSource,
  now: number = Date.now()
): string {
  return FEATURE_PERIOD[feature] === 'day' ? `day:${utcDay(now)}` : cycleKey(source, now)
}
