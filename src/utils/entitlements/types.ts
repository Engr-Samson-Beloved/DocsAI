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
  limit: number
  used: number
  remaining: number
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
