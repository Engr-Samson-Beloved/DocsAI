import type { MeteredFeature, PlanTier, QuotaPeriod } from '../plans'

/** One unit of paid work, as it is stored. */
export interface UsageEntry {
  id: string
  ownerKey: string
  email: string | null
  feature: MeteredFeature
  periodKey: string
  planTier: PlanTier
  projectId?: string | null
  quantity: number
  metadata?: Record<string, unknown>
  createdAt: number
}

/** Something that went wrong, as it is stored for the admin failure history. */
export interface FailureEntry {
  id: string
  ownerKey: string
  email: string | null
  /** A MeteredFeature, or 'auth' / 'payment' for the two non-feature paths. */
  feature: string
  /** 'quota' | 'upstream' | 'provider' | 'storage' | 'unhandled' | 'auth' */
  stage: string
  message: string
  statusCode?: number | null
  metadata?: Record<string, unknown>
  createdAt: number
}

/** What one metered feature looks like to the caller right now. */
export interface QuotaState {
  feature: MeteredFeature
  label: string
  period: QuotaPeriod
  /**
   * How many units the plan allows, or null for unlimited (owner accounts).
   *
   * Null rather than Infinity because this crosses JSON, where Infinity
   * silently becomes null anyway — making the meaning explicit here beats
   * having it happen by accident on the wire. Every renderer must check
   * `unlimited` before formatting these numbers.
   */
  limit: number | null
  used: number
  /** Null when `unlimited`. */
  remaining: number | null
  unlimited: boolean
  /** The window these numbers were counted over. */
  periodKey: string
}

/**
 * Everything the client needs to render the paywall without a second round
 * trip, and everything a route needs to decide whether to spend money.
 */
export interface EntitlementSnapshot {
  ownerKey: string
  email: string | null
  planTier: PlanTier
  planName: string
  status: 'active' | 'expired' | 'free'
  /** ISO. Null when there is no paid cycle running. */
  expiresAt: string | null
  /** True when the account may prompt a model at all. */
  canUseAi: boolean
  /** True for an account that owns the deployment and is metered by nothing. */
  owner: boolean
  quotas: Record<MeteredFeature, QuotaState>
}

/** The result of asking to spend a unit. */
export interface QuotaDecision {
  allowed: boolean
  /** Present when allowed — pass to `commitUsage` once the work succeeded. */
  reservation?: {
    feature: MeteredFeature
    periodKey: string
    planTier: PlanTier
    ownerKey: string
    email: string | null
  }
  state: QuotaState
  snapshot: EntitlementSnapshot
  /** User-facing explanation of a refusal. */
  message: string
  /** 402 for "needs a plan", 429 for "plan exhausted". */
  statusCode: 402 | 429 | 200
}
