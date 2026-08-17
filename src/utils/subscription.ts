"use client"

/**
 * The subscription a browser thinks it has.
 *
 * WHAT CHANGED, AND WHY IT MATTERS
 *
 * This module used to be the paywall: it kept a per-day generation counter in
 * localStorage, and `/api/generate` accepted anonymous requests without ever
 * consulting it. Clearing site data reset the quota; posting to the route
 * directly skipped it entirely. Anything the browser can edit is not a paywall.
 *
 * Entitlement decisions now live server-side in `utils/entitlements/*` and are
 * re-checked inside every route that can spend money at a provider. What is
 * left here is display state — which plan the user is on, when it expires, and
 * settling the redirect Korapay sends them back on. Read
 * `utils/entitlementsClient.ts` for remaining credits; this file no longer
 * counts anything.
 *
 * Plan prices and quotas come from `utils/plans.ts`, shared with the server, so
 * a pricing card and the paywall cannot disagree.
 */

import { getSupabaseClient } from './supabase'
import {
  PLANS,
  planFor,
  type PlanDefinition,
  type PlanTier,
} from './plans'
import { invalidateEntitlements } from './entitlementsClient'

export type SubscriptionTier = PlanTier

export interface UserSubscription {
  user_id: string
  email: string
  plan_tier: SubscriptionTier
  amount: number
  status: 'active' | 'expired' | 'free'
  korapay_reference?: string
  expiration_date: string
  updated_at: string
}

/**
 * Kept as an alias rather than a second table.
 *
 * The pricing screens were written against this name; pointing it at the shared
 * catalogue means a price change is one edit in `plans.ts` and not three.
 */
export const PLAN_DETAILS: Record<PlanTier, PlanDefinition> = PLANS

const STORAGE_SUB_KEY = 'docuai_user_subscription'

/**
 * Fetches the subscription from the API, falling back to Supabase and then to
 * the last known value cached on this device.
 *
 * The cached copy exists so the header does not flash "Free" on every reload
 * while the request is in flight. It is never trusted for an entitlement
 * decision — the server does not read it.
 */
export async function getSubscription(userEmail?: string | null): Promise<UserSubscription> {
  const defaultSub: UserSubscription = {
    user_id: userEmail || 'guest',
    email: userEmail || 'guest@docuai.app',
    plan_tier: 'free',
    amount: 0,
    status: 'free',
    expiration_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString()
  }

  if (userEmail) {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('wordpi-session-token') : null
      const res = await fetch(`/api/pay/subscription?email=${encodeURIComponent(userEmail)}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      })
      if (res.ok) {
        const data = await res.json()
        if (data && data.subscription) {
          const sub: UserSubscription = data.subscription
          if (typeof window !== 'undefined') {
            localStorage.setItem(STORAGE_SUB_KEY, JSON.stringify(sub))
          }
          return sub
        }
      }
    } catch (err) {
      console.warn('Could not fetch subscription from API, trying Supabase or local storage:', err)
    }

    const supabase = getSupabaseClient()
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('subscriptions')
          .select('*')
          .ilike('email', userEmail)
          .maybeSingle()

        if (data && !error) {
          let status = data.status
          let tier = data.plan_tier as SubscriptionTier

          if (data.expiration_date && new Date(data.expiration_date) < new Date()) {
            status = 'expired'
            tier = 'free'
          }

          const sub: UserSubscription = {
            user_id: data.user_id || userEmail,
            email: data.email,
            plan_tier: tier,
            amount: data.amount,
            status,
            korapay_reference: data.korapay_reference,
            expiration_date: data.expiration_date,
            updated_at: data.updated_at
          }

          if (typeof window !== 'undefined') {
            localStorage.setItem(STORAGE_SUB_KEY, JSON.stringify(sub))
          }
          return sub
        }
      } catch (err) {
        console.warn('Could not fetch subscription from Supabase:', err)
      }
    }
  }

  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_SUB_KEY)
    if (stored) {
      try {
        const parsed: UserSubscription = JSON.parse(stored)
        if (parsed.expiration_date && new Date(parsed.expiration_date) < new Date()) {
          parsed.status = 'expired'
          parsed.plan_tier = 'free'
        }
        return parsed
      } catch (e) {}
    }
  }

  return defaultSub
}

/**
 * Caches a subscription on this device.
 *
 * Local only. It deliberately no longer writes to the `subscriptions` table:
 * that row decides what the server lets the account do, and a browser must not
 * be able to set it. Only the verified Korapay paths (`/api/pay/verify`,
 * `/api/pay/webhook`) and an admin grant write there now.
 */
export async function saveSubscription(sub: UserSubscription): Promise<void> {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_SUB_KEY, JSON.stringify(sub))
  }
  invalidateEntitlements()
}

/**
 * Settles the payment Korapay redirected back with.
 *
 * The activation itself happens server-side in `/api/pay/verify`, which reads
 * the settled amount from Korapay and writes the subscription row. What comes
 * back here is a report of that, not a grant — the tier and amount below are
 * read from the server's answer rather than from the URL the browser arrived
 * on.
 */
export async function verifyPaymentCallback(userEmail?: string | null): Promise<{
  checked: boolean
  success: boolean
  status: 'active' | 'failed' | 'pending' | 'none'
  message: string
  subscription?: UserSubscription
}> {
  if (typeof window === 'undefined') return { checked: false, success: false, status: 'none', message: '' }

  const params = new URLSearchParams(window.location.search)
  const reference = params.get('reference')
  const tierParam = params.get('tier') || 'basic'
  const email = userEmail || 'user@docuai.app'

  if (!reference) {
    return { checked: false, success: false, status: 'none', message: '' }
  }

  console.log(`[Payment Verification] Verifying payment reference from URL: ${reference}`)

  try {
    const res = await fetch(
      `/api/pay/verify?reference=${encodeURIComponent(reference)}&tier=${encodeURIComponent(tierParam)}&email=${encodeURIComponent(email)}`
    )
    const data = await res.json()

    // Clean up URL query parameters to avoid duplicate verification loops
    window.history.replaceState({}, document.title, window.location.pathname)

    if (res.ok && data.success && data.status === 'active') {
      const granted = data.subscription ?? {}
      // The server's tier, not the URL's — see the note above.
      const tier = (granted.plan_tier ?? 'basic') as PlanTier
      const plan = planFor(tier)

      const newSub: UserSubscription = {
        user_id: email,
        email: granted.email || email,
        plan_tier: tier,
        amount: Number(granted.amount ?? plan.amount),
        status: 'active',
        korapay_reference: reference,
        expiration_date:
          granted.expiration_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString()
      }

      await saveSubscription(newSub)
      return {
        checked: true,
        success: true,
        status: 'active',
        message: `✅ Payment verified. Your ${plan.name} is active for 30 days.`,
        subscription: newSub
      }
    }

    return {
      checked: true,
      success: false,
      status: (data.status as any) || 'failed',
      message:
        data.message ||
        '❌ Payment incomplete or declined: Korapay reports this transaction was not completed. Your account remains on the Free tier.'
    }
  } catch (err: any) {
    window.history.replaceState({}, document.title, window.location.pathname)
    return {
      checked: true,
      success: false,
      status: 'failed',
      message: `❌ Verification error: could not confirm the transaction. If you were debited, your subscription will activate via webhook shortly.`
    }
  }
}
