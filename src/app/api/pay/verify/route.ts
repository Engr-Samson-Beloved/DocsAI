import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseClient } from '../../../../utils/supabase'
import { getSupabaseAdminClient } from '../../../../utils/supabaseAdmin'
import { CYCLE_DAYS, isPaidTier, tierForAmount, type PlanTier } from '../../../../utils/plans'
import { saveSubscriptionRow } from '../../../../utils/subscriptionWrite'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const reference = searchParams.get('reference')
    const tierParam = searchParams.get('tier') as 'basic' | 'pro' | 'enterprise' | null
    const emailParam = searchParams.get('email')

    if (!reference) {
      return NextResponse.json(
        { error: 'Transaction reference is required.' },
        { status: 400 }
      )
    }

    const korapaySecret = process.env.KORAPAY_SECRET_KEY
    const korapayBaseUrl = process.env.KORAPAY_BASE_URL || 'https://api.korapay.com/merchant/api/v1'

    if (!korapaySecret || korapaySecret.includes('your_korapay')) {
      return NextResponse.json(
        { error: 'Korapay Secret Key is not configured.' },
        { status: 500 }
      )
    }

    // Call Korapay charge verification endpoint
    console.log(`[Korapay Verify] Verifying reference: ${reference}`)
    const res = await fetch(`${korapayBaseUrl}/charges/${reference}`, {
      headers: {
        'Authorization': `Bearer ${korapaySecret}`
      }
    })

    const data = await res.json()

    if (!res.ok || !data.status) {
      console.warn('[Korapay Verify] Verification call failed or reference not found:', data)
      return NextResponse.json({
        success: false,
        status: 'not_found',
        message: data.message || 'Transaction reference not found on Korapay.'
      }, { status: 404 })
    }

    const transactionData = data.data
    const koraStatus = (transactionData?.status || '').toLowerCase()

    if (koraStatus !== 'success') {
      console.warn(`[Korapay Verify] Reference ${reference} is NOT success. Status: ${koraStatus}`)
      
      const isFailed = koraStatus === 'failed' || koraStatus === 'declined' || koraStatus === 'expired'
      
      return NextResponse.json({
        success: false,
        status: isFailed ? 'failed' : 'pending',
        message: isFailed 
          ? 'Transaction failed or was declined on Korapay. No charges were made.'
          : 'Payment is incomplete or pending completion on Korapay.'
      }, { status: 400 })
    }

    // Payment is CONFIRMED SUCCESSFUL by Korapay API!
    const userEmail = transactionData.customer?.email || emailParam || 'user@docuai.app'
    const amount = Number(transactionData.amount) || 0

    // The amount Korapay confirms is the only authority on which plan was
    // bought. The `tier` query parameter rides on a redirect URL the user can
    // edit, and charge metadata is echoed from the initialize call — trusting
    // either would let ?tier=enterprise on a Base-plan redirect grant the top
    // plan for ₦15,000.
    const planTier: PlanTier = tierForAmount(amount)

    if (!isPaidTier(planTier)) {
      console.warn(
        `[Korapay Verify] ${reference} settled for ₦${amount}, below the lowest plan. Not activating.`
      )
      return NextResponse.json({
        success: false,
        status: 'failed',
        message:
          'The amount received is below the price of any plan, so no subscription was activated. Please contact support with your payment reference.'
      }, { status: 400 })
    }

    if (isPaidTier(tierParam || '') && tierParam !== planTier) {
      console.warn(
        `[Korapay Verify] ${reference} requested tier '${tierParam}' but ₦${amount} buys '${planTier}'. Granting '${planTier}'.`
      )
    }

    const cycleStartedAt = new Date()
    const expirationDate = new Date(cycleStartedAt)
    expirationDate.setDate(expirationDate.getDate() + CYCLE_DAYS)

    // Service role first. This request carries no user session — it is settled
    // from a Korapay redirect — so under row-level security the anon key cannot
    // write the subscription row, and a confirmed payment would leave the payer
    // on the free tier. Falls back to the anon client for installs whose
    // `subscriptions` table has no RLS.
    const supabase = getSupabaseAdminClient() ?? getSupabaseClient()

    let persisted = false
    if (supabase && userEmail) {
      persisted = await saveSubscriptionRow(supabase, {
        email: userEmail,
        planTier,
        amount,
        reference,
        cycleStartedAt,
        expirationDate,
      })
    }

    // The money is taken. If the grant did not land, the payer is on the free
    // tier with a receipt, so this must never pass silently: it is logged at
    // error level and the response says who to contact and with what.
    if (!persisted) {
      console.error(
        `[Korapay Verify] PAYMENT TAKEN BUT NOT GRANTED. reference=${reference} email=${userEmail} ` +
          `tier=${planTier} amount=${amount}. Check SUPABASE_SERVICE_ROLE_KEY and migrations/002_entitlements.sql.`
      )
      return NextResponse.json({
        success: false,
        status: 'pending',
        message:
          `Your payment went through, but we could not activate the plan on this account automatically. ` +
          `Nothing further is owed. Please contact support quoting reference ${reference} and it will be applied by hand.`,
        reference,
      }, { status: 202 })
    }

    return NextResponse.json({
      success: true,
      status: 'active',
      subscription: {
        email: userEmail,
        plan_tier: planTier,
        amount: amount,
        status: 'active',
        korapay_reference: reference,
        expiration_date: expirationDate.toISOString()
      },
      message: `Payment Verified! Your ${planTier.toUpperCase()} plan is active.`
    })
  } catch (error: any) {
    console.error('Korapay verification error:', error)
    return NextResponse.json(
      { error: error.message || 'Server error during payment verification.' },
      { status: 500 }
    )
  }
}
