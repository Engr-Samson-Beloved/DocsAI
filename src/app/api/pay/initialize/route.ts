import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { email, planTier, userId } = await req.json()

    if (!email || !planTier) {
      return NextResponse.json(
        { error: 'Email and planTier are required parameters.' },
        { status: 400 }
      )
    }

    const tierAmounts: Record<string, number> = {
      basic: 5000,
      pro: 7000,
      enterprise: 10000
    }

    const amount = tierAmounts[planTier]
    if (!amount) {
      return NextResponse.json(
        { error: 'Invalid planTier specified. Must be basic (5k), pro (7k), or enterprise (10k).' },
        { status: 400 }
      )
    }

    const korapaySecret = process.env.KORAPAY_SECRET_KEY
    const korapayPublic = process.env.NEXT_PUBLIC_KORAPAY_PUBLIC_KEY
    const korapayBaseUrl = process.env.KORAPAY_BASE_URL || 'https://api.korapay.com/merchant/api/v1'
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.headers.get('origin') || 'http://localhost:3000'

    const reference = `DOCUAI_KORA_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`

    // If Korapay secret key is not set or is test key, handle initialization gracefully
    if (!korapaySecret || korapaySecret.includes('xxxxxxxx')) {
      console.warn('[Korapay] Secret key missing or placeholder. Returning mock checkout initialization response.')
      return NextResponse.json({
        success: true,
        reference,
        amount,
        currency: 'NGN',
        planTier,
        publicKey: korapayPublic || 'pk_test_mock_key',
        checkoutUrl: `${appUrl}/dashboard?payment=success&reference=${reference}&tier=${planTier}`,
        isMockMode: true,
        message: 'Korapay Test Mode initialized (Add KORAPAY_SECRET_KEY in .env.local for live payments).'
      })
    }

    // Call official Korapay Charges Initialize API
    const response = await fetch(`${korapayBaseUrl}/charges/initialize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${korapaySecret}`
      },
      body: JSON.stringify({
        amount: amount,
        currency: 'NGN',
        reference: reference,
        customer: {
          email: email
        },
        notification_url: `${appUrl}/api/pay/webhook`,
        redirect_url: `${appUrl}/dashboard?payment=success&reference=${reference}&tier=${planTier}`,
        merchant_bears_cost: false,
        metadata: {
          user_id: userId || email,
          email: email,
          plan_tier: planTier
        }
      })
    })

    const korapayData = await response.json()

    if (!response.ok || !korapayData.status) {
      console.error('[Korapay API Error]:', korapayData)
      return NextResponse.json(
        { error: korapayData.message || 'Failed to initialize payment with Korapay.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      reference,
      amount,
      currency: 'NGN',
      planTier,
      publicKey: korapayPublic,
      checkoutUrl: korapayData.data?.checkout_url || korapayData.data?.payment_url,
      checkoutToken: korapayData.data?.token || korapayData.data?.charge_token,
      isMockMode: false
    })
  } catch (error: any) {
    console.error('Korapay initialization exception:', error)
    return NextResponse.json(
      { error: error.message || 'Server error during payment initialization.' },
      { status: 500 }
    )
  }
}
