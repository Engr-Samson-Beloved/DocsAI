"use client"

import React, { useState, useEffect } from 'react'
import {
  Check,
  Zap,
  Crown,
  ArrowLeft,
  Coins,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Lock,
  CreditCard
} from 'lucide-react'
import {
  UserSubscription,
  getSubscription,
  verifyPaymentCallback
} from '../../utils/subscription'
import {
  PAID_TIERS,
  PLANS,
  formatNaira,
  planFor,
  type PlanTier
} from '../../utils/plans'
import {
  fetchEntitlements,
  type EntitlementSnapshot
} from '../../utils/entitlementsClient'

interface PricingViewProps {
  onBack: () => void
  userEmail: string | null
  onOpenAuth?: () => void
  onSubscriptionUpdated?: (sub: UserSubscription) => void
}

export const PricingView: React.FC<PricingViewProps> = ({
  onBack,
  userEmail,
  onOpenAuth,
  onSubscriptionUpdated
}) => {
  const [activeTab, setActiveTab] = useState<'subscription' | 'tokens'>('subscription')
  const [currentSub, setCurrentSub] = useState<UserSubscription | null>(null)
  const [userTokens, setUserTokens] = useState<number>(0)
  const [loadingTier, setLoadingTier] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [redirectingUrl, setRedirectingUrl] = useState<string | null>(null)
  /** Remaining credits, straight from the server — the same numbers the paywall uses. */
  const [entitlements, setEntitlements] = useState<EntitlementSnapshot | null>(null)

  // Guests cannot be charged: the payment has to be linked to an account or the
  // subscription has nowhere to land once Korapay confirms it.
  const isGuest = !userEmail || userEmail.includes('guest')

  const loadSubscriptionAndTokens = async () => {
    const sub = await getSubscription(userEmail)
    setCurrentSub(sub)
    setEntitlements(await fetchEntitlements({ refresh: true }))

    if (typeof window !== 'undefined') {
      const storedTokens = localStorage.getItem(`wordpi_tokens_${userEmail || 'guest'}`)
      setUserTokens(storedTokens ? parseInt(storedTokens, 10) : 0)
    }
  }

  // Korapay sends the user back to /?payment=success&reference=...&tier=...
  // If they land here rather than on the dashboard, settle the charge in place.
  const settleReturningPayment = async () => {
    const result = await verifyPaymentCallback(userEmail)
    if (!result.checked) return

    if (result.success && result.subscription) {
      setCurrentSub(result.subscription)
      if (onSubscriptionUpdated) onSubscriptionUpdated(result.subscription)
      setSuccessMessage(result.message)
    } else {
      setErrorMessage(result.message)
    }
  }

  useEffect(() => {
    loadSubscriptionAndTokens()
    settleReturningPayment()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail])

  const handleSelectPlan = async (tier: Exclude<PlanTier, 'free'>) => {
    setErrorMessage(null)
    setSuccessMessage(null)
    setRedirectingUrl(null)

    if (isGuest) {
      setErrorMessage('Sign in required: create an account or sign in first so your payment stays linked to your email.')
      if (onOpenAuth) {
        setTimeout(() => onOpenAuth(), 1200)
      }
      return
    }

    setLoadingTier(tier)

    try {
      const res = await fetch('/api/pay/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail, planTier: tier, userId: userEmail })
      })

      const data = await res.json()

      if (!res.ok || !data.success || !data.checkoutUrl) {
        throw new Error(data.error || 'Could not start the payment. Please try again.')
      }

      setRedirectingUrl(data.checkoutUrl)
      window.location.href = data.checkoutUrl
    } catch (err: any) {
      console.error('Subscription initialization failed:', err)
      setErrorMessage(err.message || 'Payment initialization failed. Please try again.')
      setLoadingTier(null)
    }
  }

  return (
    <div className="flex flex-col flex-1 h-screen h-[100dvh] bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-y-auto overscroll-contain touch-pan-y safe-area-top safe-area-bottom">
      
      {/* ━━━ Header ━━━ */}
      <header className="flex items-center justify-between px-4 py-3 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 sticky top-0 z-30 shadow-xs">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>

        <div className="flex items-center gap-2">
          <Crown className="w-4 h-4 text-amber-500 fill-amber-400" />
          <span className="font-bold text-sm tracking-tight">Subscription & Token Funding</span>
        </div>

        <div className="w-16" />
      </header>

      {/* ━━━ Main Body ━━━ */}
      <div className="max-w-4xl mx-auto w-full px-4 py-6 space-y-6">
        
        {/* Status Callout Banner */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-left">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
              {userEmail ? userEmail.charAt(0).toUpperCase() : 'G'}
            </div>
            <div>
              <p className="text-xs font-bold truncate">{userEmail || 'Guest Mode'}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`inline-block w-2 h-2 rounded-full ${
                  currentSub?.status === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                }`} />
                <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                  {currentSub?.status === 'active'
                    ? `Active plan: ${planFor(currentSub.plan_tier).name}`
                    : 'Free tier — unlimited formatting, no AI writing'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 bg-zinc-50 dark:bg-zinc-800/60 px-4 py-2 rounded-xl border border-zinc-200/60 dark:border-zinc-700/50">
            <Coins className="w-5 h-5 text-amber-500" />
            <div className="text-left">
              <span className="text-[10px] text-zinc-400 font-bold uppercase block">Token Balance</span>
              <span className="text-xs font-extrabold text-zinc-800 dark:text-zinc-100">{userTokens} Tokens</span>
            </div>
          </div>
        </div>

        {/* Sign-in requirement for guests */}
        {isGuest && (
          <div className="bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-2.5 text-xs text-indigo-900 dark:text-indigo-200 text-left">
              <Lock className="w-4 h-4 text-indigo-600 shrink-0" />
              <span><strong>Sign in required.</strong> Your subscription is linked to your email, so you need an account before paying.</span>
            </div>
            {onOpenAuth && (
              <button
                onClick={onOpenAuth}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shrink-0 cursor-pointer transition-colors shadow-sm active:scale-95"
              >
                Sign In
              </button>
            )}
          </div>
        )}

        {/* Success / Info Message */}
        {successMessage && (
          <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 rounded-2xl p-4 flex items-center gap-3 text-xs font-bold animate-in fade-in duration-200 shadow-sm">
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-500" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Error Message */}
        {errorMessage && (
          <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300 rounded-2xl p-4 flex items-center gap-3 text-xs font-bold animate-in fade-in duration-200 shadow-sm">
            <AlertCircle className="w-5 h-5 shrink-0 text-red-500" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Checkout redirect notice */}
        {redirectingUrl && (
          <div className="bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-indigo-800 dark:text-indigo-300 rounded-2xl p-4 flex items-center justify-between gap-3 text-xs font-bold animate-in fade-in duration-200 shadow-sm">
            <div className="flex items-center gap-2.5">
              <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin shrink-0" />
              <span>Taking you to the secure checkout page…</span>
            </div>
            <a href={redirectingUrl} className="underline flex items-center gap-1 shrink-0">
              <span>Open manually</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        {/* ━━━ Mode Switcher Tabs ━━━ */}
        <div className="flex bg-zinc-200/60 dark:bg-zinc-900 p-1 rounded-2xl max-w-md mx-auto">
          <button
            onClick={() => setActiveTab('subscription')}
            className={`flex-1 py-2.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer flex items-center justify-center gap-2 ${
              activeTab === 'subscription'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm'
                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            <Crown className="w-4 h-4 text-amber-500" />
            <span>Monthly Subscription Plans</span>
          </button>
          <button
            onClick={() => setActiveTab('tokens')}
            className={`flex-1 py-2.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer flex items-center justify-center gap-2 ${
              activeTab === 'tokens'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm'
                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            <Coins className="w-4 h-4 text-indigo-500" />
            <span>Pay As You Go (Fund Tokens)</span>
          </button>
        </div>

        {/* ━━━ TAB 1: Monthly Subscription Plans ━━━ */}
        {activeTab === 'subscription' && (
          <div className="space-y-5">

            {/* What is left on the current plan. Server numbers, not a local
                count — this is the same data the paywall decides on. */}
            {entitlements && entitlements.planTier !== 'free' && (
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
                <div className="text-xs font-bold mb-3">Credits left on your {entitlements.planName}</div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {Object.values(entitlements.quotas).map(quota => (
                    <div key={quota.feature} className="text-center">
                      <div className="text-lg font-extrabold">
                        {quota.remaining}
                        <span className="text-xs text-zinc-400 font-bold"> / {quota.limit}</span>
                      </div>
                      <div className="text-[10px] font-semibold text-zinc-500 leading-tight mt-0.5">
                        {quota.label}
                      </div>
                      <div className="text-[9px] text-zinc-400 uppercase tracking-wider mt-0.5">
                        {quota.period === 'day' ? 'per day' : 'this cycle'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* What the free tier actually includes, so the paywall is never a
                surprise: formatting was and stays free. */}
            {(!entitlements || entitlements.planTier === 'free') && (
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                <strong className="text-zinc-900 dark:text-zinc-100">You are on the Free tier.</strong>{' '}
                Formatting, importing, restyling, paginating and exporting are unlimited and always
                free, and you get one integrity check a month. Writing with AI, humanizing a document
                and generating slides need a plan.
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {PAID_TIERS.map(tier => {
                const plan = PLANS[tier]
                const featured = tier === 'pro'
                const current = currentSub?.status === 'active' && currentSub?.plan_tier === tier

                return (
                  <div
                    key={tier}
                    className={`bg-white dark:bg-zinc-900 rounded-3xl p-6 flex flex-col justify-between space-y-4 transition-all ${
                      featured
                        ? 'border-2 border-indigo-500 dark:border-indigo-600 shadow-md relative overflow-hidden'
                        : 'border border-zinc-200 dark:border-zinc-800 shadow-sm hover:border-indigo-400'
                    }`}
                  >
                    {featured && (
                      <div className="absolute top-0 right-0 bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-[10px] font-extrabold uppercase px-3 py-1 rounded-bl-xl tracking-wider">
                        Most Popular
                      </div>
                    )}

                    <div className="space-y-3">
                      <span
                        className={`text-xs font-extrabold uppercase tracking-wider flex items-center gap-1 ${
                          tier === 'basic'
                            ? 'text-blue-600 dark:text-blue-400'
                            : tier === 'pro'
                            ? 'text-indigo-600 dark:text-indigo-400'
                            : 'text-purple-600 dark:text-purple-400'
                        }`}
                      >
                        {featured && <Crown className="w-3.5 h-3.5 fill-indigo-500" />}
                        {plan.name}
                      </span>

                      <div className="flex items-baseline gap-1">
                        <span
                          className={`text-2xl font-extrabold ${
                            featured ? 'text-indigo-600 dark:text-indigo-400' : ''
                          }`}
                        >
                          {formatNaira(plan.amount)}
                        </span>
                        <span className="text-xs text-zinc-400 font-semibold">/ month</span>
                      </div>

                      <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                        {plan.tagline}
                      </p>

                      <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3 space-y-2 text-xs">
                        {plan.features.map(feature => (
                          <div
                            key={feature}
                            className="flex items-start gap-2 text-zinc-700 dark:text-zinc-300 font-medium"
                          >
                            <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                            <span>{feature}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={() => handleSelectPlan(tier)}
                      disabled={loadingTier !== null || current}
                      className={`w-full py-3 rounded-2xl text-xs font-bold transition-all cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-default flex items-center justify-center gap-2 ${
                        tier === 'pro'
                          ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md'
                          : tier === 'enterprise'
                          ? 'bg-purple-600 hover:bg-purple-700 text-white shadow-md'
                          : 'bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-white text-white dark:text-zinc-900'
                      }`}
                    >
                      {loadingTier === tier ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          <span>Starting checkout…</span>
                        </>
                      ) : current ? (
                        <span>Current Plan</span>
                      ) : isGuest ? (
                        <>
                          <Lock className="w-3.5 h-3.5" />
                          <span>Sign in to pay {formatNaira(plan.amount)}</span>
                        </>
                      ) : (
                        <>
                          {tier === 'pro' ? (
                            <Zap className="w-3.5 h-3.5 fill-current" />
                          ) : tier === 'enterprise' ? (
                            <Crown className="w-3.5 h-3.5" />
                          ) : (
                            <CreditCard className="w-3.5 h-3.5" />
                          )}
                          <span>Pay {formatNaira(plan.amount)}</span>
                        </>
                      )}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ━━━ TAB 2: Pay As You Go (Fund Tokens) ━━━ */}
        {activeTab === 'tokens' && (
          <div className="space-y-6">
            
            <div className="text-center max-w-xl mx-auto space-y-1">
              <h3 className="text-base font-bold">Pay As You Go Token Bundles</h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                No monthly commitment. Tokens never expire and give you 1 AI generation per token.
              </p>
            </div>

            {/* Token bundles are not purchasable yet: nothing in the app spends a
                token, so selling them would take money for an inert balance. */}
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-2xl p-4 flex items-start gap-3 max-w-xl mx-auto text-left">
              <Coins className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-800 dark:text-amber-300">
                <strong className="font-bold">Coming soon.</strong> Token bundles aren&apos;t on sale yet. Until they are, a monthly plan is the way to raise your daily generation limit.
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              
              {/* Starter Token Pack */}
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 shadow-sm flex flex-col justify-between space-y-4 text-center">
                <div className="space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-500 flex items-center justify-center mx-auto">
                    <Coins className="w-6 h-6" />
                  </div>
                  <h4 className="font-extrabold text-sm">Starter Token Pack</h4>
                  <div className="text-2xl font-extrabold text-zinc-900 dark:text-zinc-100">50 Tokens</div>
                  <p className="text-xs text-zinc-500">₦1,000 one-time</p>
                  <p className="text-[11px] text-zinc-400">Perfect for a single project or seminar editing session.</p>
                </div>

                <button
                  disabled
                  className="w-full py-3 bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 rounded-2xl text-xs font-bold cursor-not-allowed"
                >
                  Coming soon
                </button>
              </div>

              {/* Pro Token Pack */}
              <div className="bg-white dark:bg-zinc-900 border-2 border-amber-500 rounded-3xl p-6 shadow-md flex flex-col justify-between space-y-4 text-center relative overflow-hidden">
                <div className="absolute top-0 right-0 bg-amber-500 text-white text-[9px] font-extrabold uppercase px-2.5 py-1 rounded-bl-xl tracking-wider">
                  Best Value
                </div>

                <div className="space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500 text-white flex items-center justify-center mx-auto shadow-md">
                    <Coins className="w-6 h-6" />
                  </div>
                  <h4 className="font-extrabold text-sm">Pro Token Pack</h4>
                  <div className="text-2xl font-extrabold text-amber-500">200 Tokens</div>
                  <p className="text-xs text-zinc-500">₦3,000 one-time</p>
                  <p className="text-[11px] text-zinc-400">Great for full chapter generation and thesis formatting.</p>
                </div>

                <button
                  disabled
                  className="w-full py-3 bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 rounded-2xl text-xs font-bold cursor-not-allowed"
                >
                  Coming soon
                </button>
              </div>

              {/* Mega Token Pack */}
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 shadow-sm flex flex-col justify-between space-y-4 text-center">
                <div className="space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-500 flex items-center justify-center mx-auto">
                    <Coins className="w-6 h-6" />
                  </div>
                  <h4 className="font-extrabold text-sm">Mega Token Pack</h4>
                  <div className="text-2xl font-extrabold text-zinc-900 dark:text-zinc-100">500 Tokens</div>
                  <p className="text-xs text-zinc-500">₦6,000 one-time</p>
                  <p className="text-[11px] text-zinc-400">Unlimited flexibility for multiple research papers.</p>
                </div>

                <button
                  disabled
                  className="w-full py-3 bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 rounded-2xl text-xs font-bold cursor-not-allowed"
                >
                  Coming soon
                </button>
              </div>

            </div>
          </div>
        )}

      </div>
    </div>
  )
}
