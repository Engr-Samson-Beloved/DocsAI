"use client"

/**
 * The upgrade dialog.
 *
 * The three plan cards are rendered from `utils/plans.ts` rather than written
 * out by hand. They used to be three near-identical blocks with the prices
 * typed into the markup, which is how the page ended up advertising a tier the
 * checkout charged a different amount for. One catalogue, one price.
 */

import React, { useState, useEffect } from 'react'
import {
  Check,
  Zap,
  Crown,
  X,
  ShieldCheck,
  CreditCard,
  AlertCircle,
  ExternalLink,
  LogIn,
  Lock,
  Sparkles
} from 'lucide-react'
import {
  UserSubscription,
  getSubscription,
  saveSubscription
} from '../../utils/subscription'
import {
  PAID_TIERS,
  PLANS,
  formatNaira,
  planFor,
  type PlanTier
} from '../../utils/plans'

interface PricingModalProps {
  isOpen: boolean
  onClose: () => void
  userEmail: string | null
  onOpenAuth?: () => void
  onSubscriptionUpdated?: (sub: UserSubscription) => void
}

type PaidTier = Exclude<PlanTier, 'free'>

/** Per-tier accent, kept out of the catalogue: it is presentation, not pricing. */
const ACCENT: Record<PaidTier, { chip: string; tick: string; button: string; icon: typeof Zap }> = {
  basic: {
    chip: 'text-zinc-500 dark:text-zinc-400',
    tick: 'text-emerald-500',
    button: 'bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 shadow-sm',
    icon: CreditCard
  },
  pro: {
    chip: 'text-indigo-600 dark:text-indigo-400',
    tick: 'text-indigo-600 dark:text-indigo-400',
    button: 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/20',
    icon: Zap
  },
  enterprise: {
    chip: 'text-amber-600 dark:text-amber-400',
    tick: 'text-amber-500',
    button: 'bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 shadow-sm',
    icon: Crown
  }
}

export const PricingModal: React.FC<PricingModalProps> = ({
  isOpen,
  onClose,
  userEmail,
  onOpenAuth,
  onSubscriptionUpdated
}) => {
  const [currentSub, setCurrentSub] = useState<UserSubscription | null>(null)
  const [loadingTier, setLoadingTier] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [redirectingUrl, setRedirectingUrl] = useState<string | null>(null)

  const isGuest = !userEmail || userEmail.includes('guest')

  useEffect(() => {
    if (isOpen) {
      loadSubscription()
      checkUrlPaymentVerification()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, userEmail])

  const loadSubscription = async () => {
    const sub = await getSubscription(userEmail)
    setCurrentSub(sub)
  }

  // Check if returning from Korapay checkout redirect
  const checkUrlPaymentVerification = async () => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const paymentStatus = params.get('payment')
    const reference = params.get('reference')
    const tier = params.get('tier')

    if (paymentStatus === 'success' && reference) {
      setLoadingTier(tier || 'basic')
      await verifyAndActivate(reference, tier || 'basic', userEmail || 'user@docuai.app')
      setLoadingTier(null)
      // Clean query params from URL
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }

  if (!isOpen) return null

  const handleSubscribe = async (tier: PaidTier) => {
    setErrorMessage(null)
    setSuccessMessage(null)
    setRedirectingUrl(null)

    // Enforce Authentication: Prevent unauthenticated guest payments to prevent loss of funds
    if (isGuest) {
      setErrorMessage('🔐 Sign In Required: Please sign in or register an account before subscribing so your payment and subscription access are linked safely to your email.')
      if (onOpenAuth) {
        setTimeout(() => {
          onClose()
          onOpenAuth()
        }, 1500)
      }
      return
    }

    setLoadingTier(tier)

    try {
      // 1. Initialize charge with backend server
      const res = await fetch('/api/pay/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          planTier: tier,
          userId: userEmail
        })
      })

      const data = await res.json()

      if (!res.ok || !data.success || !data.checkoutUrl) {
        throw new Error(data.error || 'Failed to initialize Korapay payment')
      }

      const checkoutUrl = data.checkoutUrl
      console.log('[Korapay Checkout Redirect] Redirecting to:', checkoutUrl)

      setRedirectingUrl(checkoutUrl)

      // 2. Redirect directly to official Korapay hosted checkout page
      window.location.href = checkoutUrl
    } catch (err: any) {
      console.error('Subscription error:', err)
      setErrorMessage(err.message || 'Payment initialization failed. Please try again.')
      setLoadingTier(null)
    }
  }

  /**
   * Reads back what the server actually granted.
   *
   * The tier and amount come from the verify response, not from the redirect
   * URL — the URL is user-editable and the server decides the plan from the
   * settled Korapay amount.
   */
  const verifyAndActivate = async (reference: string, tier: string, email: string) => {
    try {
      const res = await fetch(
        `/api/pay/verify?reference=${encodeURIComponent(reference)}&tier=${encodeURIComponent(tier)}&email=${encodeURIComponent(email)}`
      )
      const data = await res.json()

      if (res.ok && data.success && data.status === 'active') {
        const granted = data.subscription ?? {}
        const grantedTier = (granted.plan_tier ?? 'basic') as PlanTier
        const plan = planFor(grantedTier)

        const newSub: UserSubscription = {
          user_id: email,
          email: granted.email || email,
          plan_tier: grantedTier,
          amount: Number(granted.amount ?? plan.amount),
          status: 'active',
          korapay_reference: reference,
          expiration_date:
            granted.expiration_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString()
        }

        await saveSubscription(newSub)
        setCurrentSub(newSub)
        if (onSubscriptionUpdated) onSubscriptionUpdated(newSub)

        setSuccessMessage(`Payment verified. Your ${plan.name} is now active for 30 days.`)
      } else {
        throw new Error(data.message || 'Payment has not been completed or verified by Korapay.')
      }
    } catch (e: any) {
      setErrorMessage(e.message || 'Could not verify payment status. If debited, your subscription will be auto-activated via webhook shortly.')
    }
  }

  const isCurrent = (tier: PaidTier) =>
    currentSub?.plan_tier === tier && currentSub?.status === 'active'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
      <div className="relative w-full max-w-5xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden my-8">

        {/* Modal Header */}
        <div className="relative px-6 py-8 text-center bg-gradient-to-b from-indigo-50/50 to-transparent dark:from-indigo-950/20 dark:to-transparent border-b border-zinc-100 dark:border-zinc-800">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="inline-flex items-center gap-2 px-3 py-1 mb-3 rounded-full text-xs font-semibold bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300">
            <Crown className="w-3.5 h-3.5" />
            <span>Korapay Realtime Payment Gateway</span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-extrabold text-zinc-900 dark:text-white tracking-tight">
            Unlock Full Academic Research Power
          </h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 max-w-xl mx-auto">
            Select your plan to complete payment securely via Korapay. Instant automated activation upon payment confirmation.
          </p>

          {/* Authentication Banner for Guest Users */}
          {isGuest ? (
            <div className="mt-4 p-3.5 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-xl max-w-2xl mx-auto flex items-center justify-between gap-3 text-left">
              <div className="flex items-center gap-2.5 text-xs text-indigo-900 dark:text-indigo-200">
                <Lock className="w-4 h-4 text-indigo-600 shrink-0" />
                <span><strong>Sign In Required:</strong> You are currently browsing as a guest. Please sign in before subscribing so your plan is linked safely to your email account.</span>
              </div>
              {onOpenAuth && (
                <button
                  onClick={() => {
                    onClose()
                    onOpenAuth()
                  }}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg shrink-0 flex items-center gap-1 cursor-pointer transition-colors shadow-sm"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Sign In Now</span>
                </button>
              )}
            </div>
          ) : (
            /* What the free tier actually is, stated plainly rather than as a
               fallback quota that no longer exists. */
            <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-xl max-w-2xl mx-auto flex items-start gap-3 text-left">
              <Sparkles className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-800 dark:text-amber-300">
                <strong className="font-bold">On the free tier:</strong> formatting, importing, styling
                and exporting stay <strong className="underline">unlimited and free</strong>, plus one
                integrity check a month. Writing, humanizing and deck generation need a plan.
              </div>
            </div>
          )}
        </div>

        {/* Notifications */}
        {errorMessage && (
          <div className="mx-6 mt-4 p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-xs rounded-xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="mx-6 mt-4 p-3 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 text-xs rounded-xl flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {redirectingUrl && (
          <div className="mx-6 mt-4 p-3 bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-900 text-indigo-700 dark:text-indigo-300 text-xs rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              <span>Redirecting to Korapay secure checkout page...</span>
            </div>
            <a href={redirectingUrl} className="font-bold underline flex items-center gap-1">
              <span>Click if not redirected</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        {/* Subscription Cards Grid */}
        <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
          {PAID_TIERS.map(tier => {
            const plan = PLANS[tier]
            const accent = ACCENT[tier]
            const Icon = accent.icon
            const current = isCurrent(tier)
            const featured = tier === 'pro'

            return (
              <div
                key={tier}
                className={`relative flex flex-col p-6 rounded-2xl border transition-all ${
                  current
                    ? 'border-indigo-500 bg-indigo-50/20 dark:bg-indigo-950/10 ring-2 ring-indigo-500/20'
                    : featured
                    ? 'border-indigo-500 dark:border-indigo-600 bg-gradient-to-b from-indigo-50/40 to-transparent dark:from-indigo-950/20 dark:to-transparent shadow-lg'
                    : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 hover:border-zinc-300 dark:hover:border-zinc-700'
                }`}
              >
                {featured && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm flex items-center gap-1">
                    <Zap className="w-3 h-3" />
                    <span>Most Popular</span>
                  </div>
                )}

                <div className={`mb-4 ${featured ? 'mt-1' : ''}`}>
                  <span className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1 ${accent.chip}`}>
                    {tier === 'enterprise' && <Crown className="w-3.5 h-3.5" />}
                    <span>{plan.name}</span>
                  </span>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-3xl font-extrabold text-zinc-900 dark:text-white">
                      {formatNaira(plan.amount)}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">/ month</span>
                  </div>
                  <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{plan.tagline}</p>
                </div>

                <ul className="space-y-2.5 mb-6 flex-1 text-xs text-zinc-700 dark:text-zinc-300">
                  {plan.features.map(feature => (
                    <li key={feature} className="flex items-start gap-2">
                      <Check className={`w-4 h-4 shrink-0 mt-0.5 ${accent.tick}`} />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handleSubscribe(tier)}
                  disabled={loadingTier !== null || current}
                  className={`w-full py-2.5 px-4 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer disabled:cursor-default ${
                    current ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : accent.button
                  }`}
                >
                  {loadingTier === tier ? (
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : current ? (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      <span>Current Active Plan</span>
                    </>
                  ) : isGuest ? (
                    <>
                      <Lock className="w-4 h-4" />
                      <span>Sign in to pay {formatNaira(plan.amount)}</span>
                    </>
                  ) : (
                    <>
                      <Icon className="w-4 h-4" />
                      <span>Pay {formatNaira(plan.amount)} via Korapay</span>
                    </>
                  )}
                </button>
              </div>
            )
          })}
        </div>

        {/* Footer info */}
        <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-950/50 border-t border-zinc-100 dark:border-zinc-800/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>256-bit Bank Grade Security by Korapay Payment Gateway</span>
          </div>
          <div>Need custom institutional billing? Contact support@docuai.app</div>
        </div>

      </div>
    </div>
  )
}
