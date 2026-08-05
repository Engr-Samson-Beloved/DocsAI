import { getSupabaseClient } from './supabase'

export type SubscriptionTier = 'free' | 'basic' | 'pro' | 'enterprise'

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

export interface QuotaStatus {
  allowed: boolean
  planTier: SubscriptionTier
  status: 'active' | 'expired' | 'free'
  remainingGenerations: number | 'unlimited'
  dailyFreeLimit: number
  usedToday: number
  message: string
}

export const PLAN_DETAILS = {
  free: {
    name: 'Free Trial / Fallback',
    amount: 0,
    dailyLimit: 5,
    description: '5 free AI generations per day when subscription expires or for guest users.',
    features: ['5 AI generations per day', 'Basic DOCX export', 'Standard speed generation']
  },
  basic: {
    name: 'Basic Plan',
    amount: 5000,
    dailyLimit: 50,
    description: '50 AI generations per day. Perfect for undergraduate term papers & essays.',
    features: ['50 AI generations per day', 'DOCX & PDF export', 'Standard academic research assistant']
  },
  pro: {
    name: 'Pro Plan',
    amount: 7000,
    dailyLimit: 200,
    description: '200 AI generations per day. Ideal for Master’s theses & multi-chapter projects.',
    features: ['200 AI generations per day', 'Full multi-chapter outline wizard', 'DOCX, PDF & PPTX exports', 'Fast stream AI response']
  },
  enterprise: {
    name: 'Enterprise Plan',
    amount: 10000,
    dailyLimit: 9999,
    description: 'Unlimited AI generations per day. Priority speed & dedicated support for research leads.',
    features: ['Unlimited AI generations', 'Priority model failover (Gemini, Groq, Grok)', 'All export formats & templates', 'Dedicated support']
  }
}

const STORAGE_SUB_KEY = 'docuai_user_subscription'
const STORAGE_USAGE_KEY = 'docuai_daily_usage'

/**
 * Gets local usage count for today
 */
export function getDailyUsage(emailOrId: string = 'guest'): { date: string; count: number } {
  if (typeof window === 'undefined') return { date: getTodayDateString(), count: 0 }
  
  try {
    const raw = localStorage.getItem(`${STORAGE_USAGE_KEY}_${emailOrId}`)
    if (!raw) return { date: getTodayDateString(), count: 0 }
    
    const parsed = JSON.parse(raw)
    const today = getTodayDateString()
    
    if (parsed.date !== today) {
      const resetData = { date: today, count: 0 }
      localStorage.setItem(`${STORAGE_USAGE_KEY}_${emailOrId}`, JSON.stringify(resetData))
      return resetData
    }
    
    return parsed
  } catch (e) {
    return { date: getTodayDateString(), count: 0 }
  }
}

/**
 * Increments daily usage count
 */
export function incrementDailyUsage(emailOrId: string = 'guest'): number {
  if (typeof window === 'undefined') return 1
  
  const current = getDailyUsage(emailOrId)
  const updated = { date: getTodayDateString(), count: current.count + 1 }
  localStorage.setItem(`${STORAGE_USAGE_KEY}_${emailOrId}`, JSON.stringify(updated))
  return updated.count
}

function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0]
}

/**
 * Fetches user subscription from Supabase or Local Storage
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

  if (userEmail) {
    const supabase = getSupabaseClient()
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('email', userEmail)
          .single()

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
        console.warn('Could not fetch subscription from Supabase, returning local default:', err)
      }
    }
  }

  return defaultSub
}

/**
 * Checks if user is allowed to make an AI generation call
 */
export async function checkAiQuota(userEmail?: string | null): Promise<QuotaStatus> {
  const sub = await getSubscription(userEmail)
  const usage = getDailyUsage(userEmail || 'guest')
  
  const planInfo = PLAN_DETAILS[sub.plan_tier] || PLAN_DETAILS.free
  const dailyLimit = sub.status === 'active' ? planInfo.dailyLimit : PLAN_DETAILS.free.dailyLimit

  if (sub.status === 'expired') {
    const remaining = Math.max(0, PLAN_DETAILS.free.dailyLimit - usage.count)
    return {
      allowed: remaining > 0,
      planTier: 'free',
      status: 'expired',
      remainingGenerations: remaining,
      dailyFreeLimit: PLAN_DETAILS.free.dailyLimit,
      usedToday: usage.count,
      message: remaining > 0
        ? `Your previous subscription has expired. You are using the Free Fallback Quota (${usage.count}/${PLAN_DETAILS.free.dailyLimit} used today). Upgrade your plan to unlock full access.`
        : `Your subscription has expired and you have used your 5 free AI generations today. Please upgrade your plan to continue.`
    }
  }

  if (sub.plan_tier === 'enterprise' && sub.status === 'active') {
    return {
      allowed: true,
      planTier: 'enterprise',
      status: 'active',
      remainingGenerations: 'unlimited',
      dailyFreeLimit: 9999,
      usedToday: usage.count,
      message: 'Active Enterprise Plan - Unlimited AI generations available.'
    }
  }

  const remaining = Math.max(0, dailyLimit - usage.count)
  const isAllowed = remaining > 0

  return {
    allowed: isAllowed,
    planTier: sub.plan_tier,
    status: sub.status as any,
    remainingGenerations: remaining,
    dailyFreeLimit: dailyLimit,
    usedToday: usage.count,
    message: isAllowed
      ? `Active ${planInfo.name}: ${remaining} AI generations remaining today (${usage.count}/${dailyLimit} used).`
      : `Daily limit of ${dailyLimit} AI generations reached for ${planInfo.name}. Upgrade your plan to get more generations.`
  }
}

/**
 * Saves subscription locally and in Supabase
 */
export async function saveSubscription(sub: UserSubscription): Promise<void> {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_SUB_KEY, JSON.stringify(sub))
  }

  const supabase = getSupabaseClient()
  if (supabase && sub.email) {
    try {
      await supabase.from('subscriptions').upsert({
        user_id: sub.user_id,
        email: sub.email,
        plan_tier: sub.plan_tier,
        amount: sub.amount,
        status: sub.status,
        korapay_reference: sub.korapay_reference,
        expiration_date: sub.expiration_date,
        updated_at: new Date().toISOString()
      }, { onConflict: 'email' })
    } catch (e) {
      console.warn('Failed to persist subscription to Supabase:', e)
    }
  }
}
