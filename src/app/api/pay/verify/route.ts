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

    let isSuccess = false
    let planTier: 'basic' | 'pro' | 'enterprise' = tierParam || 'basic'
    let amount = 5000
    let userEmail = emailParam || 'user@docuai.app'

    // Mock Mode fallback for local testing
    if (!korapaySecret || korapaySecret.includes('xxxxxxxx')) {
      console.warn('[Korapay Verify] Using mock verification mode.')
      isSuccess = true
      amount = planTier === 'enterprise' ? 10000 : planTier === 'pro' ? 7000 : 5000
    } else {
      // Call Korapay charge verification endpoint
      const res = await fetch(`${korapayBaseUrl}/charges/${reference}`, {
        headers: {
          'Authorization': `Bearer ${korapaySecret}`
        }
      })

      const data = await res.json()

      if (res.ok && data.status && data.data?.status === 'success') {
        isSuccess = true
        amount = data.data.amount || amount
        userEmail = data.data.customer?.email || userEmail
        if (data.data.metadata?.plan_tier) {
          planTier = data.data.metadata.plan_tier
        } else {
          planTier = amount >= 10000 ? 'enterprise' : amount >= 7000 ? 'pro' : 'basic'
        }
      } else {
        return NextResponse.json({
          success: false,
          status: data.data?.status || 'failed',
          message: data.message || 'Payment verification failed or pending.'
        })
      }
    }

    if (isSuccess) {
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
        }
      })
    }

    return NextResponse.json(
      { success: false, message: 'Could not verify transaction status.' },
      { status: 400 }
    )
  } catch (error: any) {
    console.error('Korapay verification error:', error)
    return NextResponse.json(
      { error: error.message || 'Server error during payment verification.' },
      { status: 500 }
    )
  }
}
