"use client"

import React, { useState, useEffect } from 'react'
import {
  Check,
  Zap,
  Crown,
  Sparkles,
  X,
  ShieldCheck,
  CreditCard,
  AlertCircle,
  Clock,
  ExternalLink
} from 'lucide-react'
import {
  PLAN_DETAILS,
  UserSubscription,
  getSubscription,
  saveSubscription
} from '../../utils/subscription'

interface PricingModalProps {
  isOpen: boolean
  onClose: () => void
  userEmail: string | null
  onSubscriptionUpdated?: (sub: UserSubscription) => void
}

declare global {
  interface Window {
    Korapay?: {
      initialize: (config: any) => void
    }
  }
}

export const PricingModal: React.FC<PricingModalProps> = ({
  isOpen,
  onClose,
  userEmail,
  onSubscriptionUpdated
}) => {
  const [currentSub, setCurrentSub] = useState<UserSubscription | null>(null)
  const [loadingTier, setLoadingTier] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [redirectingUrl, setRedirectingUrl] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      loadSubscription()
      loadKorapayScript()
      checkUrlPaymentVerification()
    }
  }, [isOpen, userEmail])

  const loadSubscription = async () => {
    const sub = await getSubscription(userEmail)
    setCurrentSub(sub)
  }

  // Load Korapay Inline SDK
  const loadKorapayScript = () => {
    if (document.getElementById('korapay-js-sdk')) return

    const script = document.createElement('script')
    script.id = 'korapay-js-sdk'
    script.src = 'https://korablobstorage.blob.core.windows.net/modal-bucket/korapay-collections.min.js'
    script.async = true
    document.body.appendChild(script)
  }

  // Check if returning from Korapay checkout redirect
  const checkUrlPaymentVerification = async () => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const paymentStatus = params.get('payment')
    const reference = params.get('reference')
    const tier = params.get('tier') as 'basic' | 'pro' | 'enterprise' | null

    if (paymentStatus === 'success' && reference) {
      setLoadingTier(tier || 'basic')
      await verifyAndActivate(reference, tier || 'basic', userEmail || 'user@docuai.app')
      setLoadingTier(null)
      // Clean query params from URL
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }

  if (!isOpen) return null

  const handleSubscribe = async (tier: 'basic' | 'pro' | 'enterprise') => {
    setLoadingTier(tier)
    setErrorMessage(null)
    setSuccessMessage(null)
    setRedirectingUrl(null)

    const email = userEmail || 'guest@docuai.app'

    try {
      // 1. Initialize charge with backend server
      const res = await fetch('/api/pay/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          planTier: tier,
          userId: email
        })
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to initialize Korapay payment')
      }

      const checkoutUrl = data.checkoutUrl
      const reference = data.reference
      const publicKey = data.publicKey || process.env.NEXT_PUBLIC_KORAPAY_PUBLIC_KEY

      // 2. Try Korapay Popup Modal if SDK script is loaded
      if (window.Korapay && publicKey) {
        try {
          console.log('[Korapay Modal] Initializing popup modal...')
          window.Korapay.initialize({
            key: publicKey,
            reference: reference,
            amount: data.amount,
            currency: 'NGN',
            customer: {
              email: email,
              name: email.split('@')[0]
            },
            notification_url: `${window.location.origin}/api/pay/webhook`,
            onClose: () => {
              setLoadingTier(null)
              console.log('Korapay checkout modal closed by user')
            },
            onSuccess: async (response: any) => {
              console.log('Korapay Payment Success Response:', response)
              await verifyAndActivate(response.reference || reference, tier, email)
              setLoadingTier(null)
            }
          })
          return
        } catch (modalErr) {
          console.warn('Korapay popup initialization failed, falling back to direct checkout URL redirect:', modalErr)
        }
      }

      // 3. Fallback: Redirect directly to Korapay hosted checkout page
      if (checkoutUrl) {
        console.log('[Korapay Redirect] Opening checkout page:', checkoutUrl)
        setRedirectingUrl(checkoutUrl)
        window.location.href = checkoutUrl
      } else {
        throw new Error('No valid checkout URL received from Korapay API.')
      }
    } catch (err: any) {
      console.error('Subscription error:', err)
      setErrorMessage(err.message || 'Payment initialization failed. Please try again.')
      setLoadingTier(null)
    }
  }

  const verifyAndActivate = async (reference: string, tier: 'basic' | 'pro' | 'enterprise', email: string) => {
    try {
      const res = await fetch(`/api/pay/verify?reference=${reference}&tier=${tier}&email=${encodeURIComponent(email)}`)
      const data = await res.json()

      if (res.ok && data.success && data.status === 'active') {
        const expirationDate = data.subscription?.expiration_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

        const newSub: UserSubscription = {
          user_id: email,
          email: email,
          plan_tier: tier,
          amount: tier === 'enterprise' ? 10000 : tier === 'pro' ? 7000 : 5000,
          status: 'active',
          korapay_reference: reference,
          expiration_date: expirationDate,
          updated_at: new Date().toISOString()
        }

        await saveSubscription(newSub)
        setCurrentSub(newSub)
        if (onSubscriptionUpdated) onSubscriptionUpdated(newSub)

        const tierName = PLAN_DETAILS[tier].name
        setSuccessMessage(`Payment Verified! Your ${tierName} is now active for 30 days.`)
      } else {
        throw new Error(data.message || 'Payment has not been completed or verified by Korapay.')
      }
    } catch (e: any) {
      setErrorMessage(e.message || 'Could not verify payment status. If debited, your subscription will be auto-activated via webhook shortly.')
    }
  }

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
            <Sparkles className="w-3.5 h-3.5" />
            <span>Korapay Realtime Payment Gateway</span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-extrabold text-zinc-900 dark:text-white tracking-tight">
            Unlock Full Academic Research Power
          </h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 max-w-xl mx-auto">
            Select your plan to complete payment securely via Korapay. Instant automated activation upon payment confirmation.
          </p>

          {/* Fallback Free Quota Banner */}
          <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-xl max-w-2xl mx-auto flex items-start gap-3 text-left">
            <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800 dark:text-amber-300">
              <strong className="font-bold">Free Quota Fallback:</strong> Expired subscriptions automatically receive <strong className="underline">5 free AI generations every 24 hours</strong>. Your work is never locked out!
            </div>
          </div>
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

          {/* Tier 1: 5k Basic */}
          <div className={`relative flex flex-col p-6 rounded-2xl border transition-all ${
            currentSub?.plan_tier === 'basic' && currentSub?.status === 'active'
              ? 'border-indigo-500 bg-indigo-50/20 dark:bg-indigo-950/10 ring-2 ring-indigo-500/20'
              : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 hover:border-zinc-300 dark:hover:border-zinc-700'
          }`}>
            <div className="mb-4">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Basic Tier</span>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-3xl font-extrabold text-zinc-900 dark:text-white">₦5,000</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">/ month</span>
              </div>
              <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                50 AI generations/day. Best for standard undergraduate assignments.
              </p>
            </div>

            <ul className="space-y-2.5 mb-6 flex-1 text-xs text-zinc-700 dark:text-zinc-300">
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span><strong>50 AI generations</strong> per day</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>DOCX & PDF document exports</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>Standard academic research model</span>
              </li>
              <li className="flex items-center gap-2 text-zinc-400 dark:text-zinc-500">
                <Clock className="w-4 h-4 shrink-0" />
                <span>5 free fallback daily generations when expired</span>
              </li>
            </ul>

            <button
              onClick={() => handleSubscribe('basic')}
              disabled={loadingTier !== null || (currentSub?.plan_tier === 'basic' && currentSub?.status === 'active')}
              className={`w-full py-2.5 px-4 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2 ${
                currentSub?.plan_tier === 'basic' && currentSub?.status === 'active'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 cursor-default'
                  : 'bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 shadow-sm'
              }`}
            >
              {loadingTier === 'basic' ? (
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : currentSub?.plan_tier === 'basic' && currentSub?.status === 'active' ? (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Current Active Plan</span>
                </>
              ) : (
                <>
                  <CreditCard className="w-4 h-4" />
                  <span>Pay ₦5,000 via Korapay</span>
                </>
              )}
            </button>
          </div>

          {/* Tier 2: 7k Pro (Featured) */}
          <div className={`relative flex flex-col p-6 rounded-2xl border transition-all ${
            currentSub?.plan_tier === 'pro' && currentSub?.status === 'active'
              ? 'border-indigo-500 bg-indigo-50/20 dark:bg-indigo-950/10 ring-2 ring-indigo-500/20'
              : 'border-indigo-500 dark:border-indigo-600 bg-gradient-to-b from-indigo-50/40 to-transparent dark:from-indigo-950/20 dark:to-transparent shadow-lg'
          }`}>
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm flex items-center gap-1">
              <Zap className="w-3 h-3" />
              <span>Most Popular</span>
            </div>

            <div className="mb-4 mt-1">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">Pro Tier</span>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-3xl font-extrabold text-zinc-900 dark:text-white">₦7,000</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">/ month</span>
              </div>
              <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                200 AI generations/day. Ideal for Master's thesis & multi-chapter projects.
              </p>
            </div>

            <ul className="space-y-2.5 mb-6 flex-1 text-xs text-zinc-700 dark:text-zinc-300">
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                <span><strong>200 AI generations</strong> per day</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                <span>Full Multi-Chapter Outline Wizard</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                <span>DOCX, PDF & PPTX exports</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                <span>Fast streaming AI responses</span>
              </li>
            </ul>

            <button
              onClick={() => handleSubscribe('pro')}
              disabled={loadingTier !== null || (currentSub?.plan_tier === 'pro' && currentSub?.status === 'active')}
              className={`w-full py-2.5 px-4 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2 ${
                currentSub?.plan_tier === 'pro' && currentSub?.status === 'active'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 cursor-default'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/20'
              }`}
            >
              {loadingTier === 'pro' ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : currentSub?.plan_tier === 'pro' && currentSub?.status === 'active' ? (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Current Active Plan</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 fill-current" />
                  <span>Pay ₦7,000 via Korapay</span>
                </>
              )}
            </button>
          </div>

          {/* Tier 3: 10k Enterprise */}
          <div className={`relative flex flex-col p-6 rounded-2xl border transition-all ${
            currentSub?.plan_tier === 'enterprise' && currentSub?.status === 'active'
              ? 'border-indigo-500 bg-indigo-50/20 dark:bg-indigo-950/10 ring-2 ring-indigo-500/20'
              : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 hover:border-zinc-300 dark:hover:border-zinc-700'
          }`}>
            <div className="mb-4">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <Crown className="w-3.5 h-3.5" />
                <span>Enterprise Tier</span>
              </span>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-3xl font-extrabold text-zinc-900 dark:text-white">₦10,000</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">/ month</span>
              </div>
              <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                Unlimited AI generations. Dedicated for Ph.D. candidates & research leads.
              </p>
            </div>

            <ul className="space-y-2.5 mb-6 flex-1 text-xs text-zinc-700 dark:text-zinc-300">
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-amber-500 shrink-0" />
                <span><strong>Unlimited AI generations</strong></span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-amber-500 shrink-0" />
                <span>Priority failover (Gemini, Groq, Grok)</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-amber-500 shrink-0" />
                <span>All document templates & export tools</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-amber-500 shrink-0" />
                <span>Priority customer support</span>
              </li>
            </ul>

            <button
              onClick={() => handleSubscribe('enterprise')}
              disabled={loadingTier !== null || (currentSub?.plan_tier === 'enterprise' && currentSub?.status === 'active')}
              className={`w-full py-2.5 px-4 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2 ${
                currentSub?.plan_tier === 'enterprise' && currentSub?.status === 'active'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 cursor-default'
                  : 'bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 shadow-sm'
              }`}
            >
              {loadingTier === 'enterprise' ? (
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : currentSub?.plan_tier === 'enterprise' && currentSub?.status === 'active' ? (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Current Active Plan</span>
                </>
              ) : (
                <>
                  <Crown className="w-4 h-4" />
                  <span>Pay ₦10,000 via Korapay</span>
                </>
              )}
            </button>
          </div>

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
