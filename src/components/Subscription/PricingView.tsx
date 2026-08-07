"use client"

import React, { useState, useEffect } from 'react'
import {
  Check,
  Zap,
  Crown,
  Sparkles,
  ArrowLeft,
  Coins,
  ShieldCheck,
  CheckCircle2,
  TrendingUp,
  CreditCard
} from 'lucide-react'
import {
  PLAN_DETAILS,
  UserSubscription,
  getSubscription,
  saveSubscription
} from '../../utils/subscription'

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

  useEffect(() => {
    loadSubscriptionAndTokens()
  }, [userEmail])

  const loadSubscriptionAndTokens = async () => {
    const sub = await getSubscription(userEmail)
    setCurrentSub(sub)

    if (typeof window !== 'undefined') {
      const storedTokens = localStorage.getItem(`wordpi_tokens_${userEmail || 'guest'}`)
      setUserTokens(storedTokens ? parseInt(storedTokens, 10) : 0)
    }
  }

  const handleSelectPlan = async (tier: 'basic' | 'pro' | 'enterprise') => {
    if (!userEmail && onOpenAuth) {
      onOpenAuth()
      return
    }

    setLoadingTier(tier)
    setSuccessMessage(null)

    // Simulate instant plan activation cleanly without Korapay branding
    setTimeout(async () => {
      const expirationDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      const amounts = { basic: 5000, pro: 7000, enterprise: 10000 }
      
      const newSub: UserSubscription = {
        user_id: userEmail || 'guest',
        email: userEmail || 'guest@docuai.app',
        plan_tier: tier,
        amount: amounts[tier],
        status: 'active',
        expiration_date: expirationDate,
        updated_at: new Date().toISOString()
      }

      await saveSubscription(newSub)
      setCurrentSub(newSub)
      if (onSubscriptionUpdated) onSubscriptionUpdated(newSub)

      setLoadingTier(null)
      setSuccessMessage(`🎉 Success! You have successfully activated the ${PLAN_DETAILS[tier].name}. Enjoy full AI features!`)
    }, 600)
  }

  const handleFundTokens = (tokenAmount: number, cost: number) => {
    if (!userEmail && onOpenAuth) {
      onOpenAuth()
      return
    }

    setLoadingTier(`token_${tokenAmount}`)
    setSuccessMessage(null)

    setTimeout(() => {
      const newBalance = userTokens + tokenAmount
      setUserTokens(newBalance)
      if (typeof window !== 'undefined') {
        localStorage.setItem(`wordpi_tokens_${userEmail || 'guest'}`, newBalance.toString())
      }

      setLoadingTier(null)
      setSuccessMessage(`🪙 Success! Added ${tokenAmount} AI Tokens to your account balance. Current total: ${newBalance} Tokens.`)
    }, 600)
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
                    ? `Active Plan: ${PLAN_DETAILS[currentSub.plan_tier]?.name || 'Pro'}` 
                    : 'Free Tier (5 daily AI generations)'}
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

        {/* Success / Info Message */}
        {successMessage && (
          <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 rounded-2xl p-4 flex items-center gap-3 text-xs font-bold animate-in fade-in duration-200 shadow-sm">
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-500" />
            <span>{successMessage}</span>
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            
            {/* Basic Plan */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 shadow-sm flex flex-col justify-between space-y-4 hover:border-indigo-400 transition-all">
              <div className="space-y-3">
                <span className="text-xs font-extrabold text-blue-600 dark:text-blue-400 uppercase tracking-wider">Basic</span>
                <h3 className="text-lg font-bold">Standard Research</h3>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-extrabold">₦5,000</span>
                  <span className="text-xs text-zinc-400 font-semibold">/ month</span>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  50 AI generations per day. Ideal for undergraduate term papers and seminar reports.
                </p>
                <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3 space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300 font-medium">
                    <Check className="w-4 h-4 text-emerald-500" />
                    <span>50 AI generations daily</span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300 font-medium">
                    <Check className="w-4 h-4 text-emerald-500" />
                    <span>DOCX & PDF export</span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300 font-medium">
                    <Check className="w-4 h-4 text-emerald-500" />
                    <span>Standard academic tone</span>
                  </div>
                </div>
              </div>
              
              <button
                onClick={() => handleSelectPlan('basic')}
                disabled={loadingTier === 'basic' || (currentSub?.status === 'active' && currentSub?.plan_tier === 'basic')}
                className="w-full py-3 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-white text-white dark:text-zinc-900 rounded-2xl text-xs font-bold transition-all cursor-pointer active:scale-95 disabled:opacity-50"
              >
                {loadingTier === 'basic' ? 'Activating...' : currentSub?.plan_tier === 'basic' && currentSub?.status === 'active' ? 'Current Plan' : 'Select Basic Plan'}
              </button>
            </div>

            {/* Pro Plan (Featured) */}
            <div className="bg-white dark:bg-zinc-900 border-2 border-indigo-500 dark:border-indigo-600 rounded-3xl p-6 shadow-md flex flex-col justify-between space-y-4 relative overflow-hidden">
              <div className="absolute top-0 right-0 bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-[10px] font-extrabold uppercase px-3 py-1 rounded-bl-xl tracking-wider">
                Most Popular
              </div>

              <div className="space-y-3">
                <span className="text-xs font-extrabold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider flex items-center gap-1">
                  <Crown className="w-3.5 h-3.5 fill-indigo-500" /> Pro Plan
                </span>
                <h3 className="text-lg font-bold">Thesis & Multi-Chapter</h3>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-extrabold text-indigo-600 dark:text-indigo-400">₦7,000</span>
                  <span className="text-xs text-zinc-400 font-semibold">/ month</span>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  200 AI generations per day. Built for Master's thesis & multi-chapter academic projects.
                </p>
                <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3 space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300 font-medium">
                    <Check className="w-4 h-4 text-emerald-500" />
                    <span>200 AI generations daily</span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300 font-medium">
                    <Check className="w-4 h-4 text-emerald-500" />
                    <span>Full multi-chapter outline wizard</span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300 font-medium">
                    <Check className="w-4 h-4 text-emerald-500" />
                    <span>DOCX, PDF & PPTX exports</span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300 font-medium">
                    <Check className="w-4 h-4 text-emerald-500" />
                    <span>Fast stream model response</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => handleSelectPlan('pro')}
                disabled={loadingTier === 'pro' || (currentSub?.status === 'active' && currentSub?.plan_tier === 'pro')}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-xs font-bold transition-all cursor-pointer active:scale-95 shadow-md disabled:opacity-50"
              >
                {loadingTier === 'pro' ? 'Activating...' : currentSub?.plan_tier === 'pro' && currentSub?.status === 'active' ? 'Current Plan' : 'Select Pro Plan'}
              </button>
            </div>

            {/* Enterprise Plan */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 shadow-sm flex flex-col justify-between space-y-4 hover:border-purple-400 transition-all">
              <div className="space-y-3">
                <span className="text-xs font-extrabold text-purple-600 dark:text-purple-400 uppercase tracking-wider">Enterprise</span>
                <h3 className="text-lg font-bold">Unlimited Research</h3>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-extrabold">₦10,000</span>
                  <span className="text-xs text-zinc-400 font-semibold">/ month</span>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  Unlimited AI generations per day. Maximum priority speed & all AI models (Gemini, Groq, Grok).
                </p>
                <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3 space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300 font-medium">
                    <Check className="w-4 h-4 text-emerald-500" />
                    <span>Unlimited AI generations</span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300 font-medium">
                    <Check className="w-4 h-4 text-emerald-500" />
                    <span>Priority model failover</span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300 font-medium">
                    <Check className="w-4 h-4 text-emerald-500" />
                    <span>All export formats & templates</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => handleSelectPlan('enterprise')}
                disabled={loadingTier === 'enterprise' || (currentSub?.status === 'active' && currentSub?.plan_tier === 'enterprise')}
                className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-2xl text-xs font-bold transition-all cursor-pointer active:scale-95 shadow-md disabled:opacity-50"
              >
                {loadingTier === 'enterprise' ? 'Activating...' : currentSub?.plan_tier === 'enterprise' && currentSub?.status === 'active' ? 'Current Plan' : 'Select Enterprise Plan'}
              </button>
            </div>

          </div>
        )}

        {/* ━━━ TAB 2: Pay As You Go (Fund Tokens) ━━━ */}
        {activeTab === 'tokens' && (
          <div className="space-y-6">
            
            <div className="text-center max-w-xl mx-auto space-y-1">
              <h3 className="text-base font-bold">Pay As You Go Token Bundles</h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                No monthly commitment! Tokens never expire and give you 1 AI generation per token.
              </p>
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
                  onClick={() => handleFundTokens(50, 1000)}
                  disabled={loadingTier === 'token_50'}
                  className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-2xl text-xs font-bold transition-all cursor-pointer active:scale-95 shadow-sm"
                >
                  {loadingTier === 'token_50' ? 'Funding...' : 'Fund 50 Tokens (₦1,000)'}
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
                  onClick={() => handleFundTokens(200, 3000)}
                  disabled={loadingTier === 'token_200'}
                  className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-2xl text-xs font-bold transition-all cursor-pointer active:scale-95 shadow-md"
                >
                  {loadingTier === 'token_200' ? 'Funding...' : 'Fund 200 Tokens (₦3,000)'}
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
                  onClick={() => handleFundTokens(500, 6000)}
                  disabled={loadingTier === 'token_500'}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-xs font-bold transition-all cursor-pointer active:scale-95 shadow-sm"
                >
                  {loadingTier === 'token_500' ? 'Funding...' : 'Fund 500 Tokens (₦6,000)'}
                </button>
              </div>

            </div>
          </div>
        )}

      </div>
    </div>
  )
}
