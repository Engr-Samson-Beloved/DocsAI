import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseClient } from '../../../../utils/supabase'

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
    const amount = transactionData.amount || 5000
    const planTier: 'basic' | 'pro' | 'enterprise' = transactionData.metadata?.plan_tier || tierParam ||
      (amount >= 10000 ? 'enterprise' : amount >= 7000 ? 'pro' : 'basic')

    const expirationDate = new Date()
    expirationDate.setDate(expirationDate.getDate() + 30) // 30 days valid

    const supabase = getSupabaseClient()
    if (supabase && userEmail) {
      try {
        await supabase.from('subscriptions').upsert({
          email: userEmail,
          plan_tier: planTier,
          amount: amount,
          status: 'active',
          korapay_reference: reference,
          expiration_date: expirationDate.toISOString(),
          updated_at: new Date().toISOString()
        }, { onConflict: 'email' })
      } catch (e) {
        console.warn('Supabase subscription save warning:', e)
      }
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
