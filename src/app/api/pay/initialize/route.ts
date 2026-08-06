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

    // Dynamically derive host & scheme for production HTTPS URLs
    const hostHeader = req.headers.get('host')
    const protoHeader = req.headers.get('x-forwarded-proto') || (hostHeader?.includes('localhost') ? 'http' : 'https')
    const inferredUrl = hostHeader ? `${protoHeader}://${hostHeader}` : null
    
    let appUrl = process.env.NEXT_PUBLIC_APP_URL || req.headers.get('origin') || inferredUrl || 'http://localhost:3000'
    
    // In live mode, ensure localhost URLs are replaced by inferred production domain if available
    if (korapaySecret?.startsWith('sk_live_') && appUrl.includes('localhost') && inferredUrl && !inferredUrl.includes('localhost')) {
      appUrl = inferredUrl
    }

    if (!korapaySecret || korapaySecret.includes('your_korapay')) {
      return NextResponse.json(
        { error: 'Korapay Secret Key is not configured on the server. Please check your production environment variables.' },
        { status: 500 }
      )
    }

    const reference = `DOCUAI_KORA_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`

    // Call official Korapay Charges Initialize API
    console.log(`[Korapay Init] Initializing live charge for ${email}, plan: ${planTier}, amount: ₦${amount}, ref: ${reference}, appUrl: ${appUrl}`)

    const payload: any = {
      amount: amount,
      currency: 'NGN',
      reference: reference,
      customer: {
        email: email
      },
      merchant_bears_cost: false,
      metadata: {
        user_id: userId || email,
        email: email,
        plan_tier: planTier
      }
    }

    // Only attach callback URLs if they are valid public HTTPS URLs (or local HTTP during test mode)
    if (appUrl && (!appUrl.includes('localhost') || korapaySecret.startsWith('sk_test_'))) {
      payload.notification_url = `${appUrl}/api/pay/webhook`
      payload.redirect_url = `${appUrl}/dashboard?payment=success&reference=${reference}&tier=${planTier}`
    }

    const response = await fetch(`${korapayBaseUrl}/charges/initialize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${korapaySecret}`
      },
      body: JSON.stringify(payload)
    })

    const korapayData = await response.json()

    if (!response.ok || !korapayData.status) {
      console.error('[Korapay API Error]:', korapayData)
      return NextResponse.json(
        { error: korapayData.message || 'Failed to initialize payment with Korapay.' },
        { status: 500 }
      )
    }

    const checkoutUrl = korapayData.data?.checkout_url || korapayData.data?.payment_url

    return NextResponse.json({
      success: true,
      reference,
      amount,
      currency: 'NGN',
      planTier,
      publicKey: korapayPublic,
      checkoutUrl
    })
  } catch (error: any) {
    console.error('Korapay initialization exception:', error)
    return NextResponse.json(
      { error: error.message || 'Server error during payment initialization.' },
      { status: 500 }
    )
  }
}
