import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getSupabaseClient } from '../../../../utils/supabase'

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text()
    const signature = req.headers.get('x-korapay-signature')
    
    const webhookSecret = process.env.KORAPAY_WEBHOOK_SECRET || process.env.KORAPAY_SECRET_KEY

    if (webhookSecret && signature) {
      const computedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex')

      if (computedSignature !== signature) {
        console.error('[Korapay Webhook] Invalid HMAC signature mismatch!')
        return NextResponse.json(
          { error: 'Invalid webhook signature' },
          { status: 401 }
        )
      }
    }

    const payload = JSON.parse(rawBody)
    const { event, data } = payload

    console.log(`[Korapay Webhook Received] Event: ${event}`, data)

    if (event === 'charge.success' || event === 'subscription.create') {
      const email = data.customer?.email
      const reference = data.reference
      const amount = data.amount || 5000

      const metadataPlan = data.metadata?.plan_tier
      const planTier: 'basic' | 'pro' | 'enterprise' = metadataPlan ||
        (amount >= 10000 ? 'enterprise' : amount >= 7000 ? 'pro' : 'basic')

      const expirationDate = new Date()
      expirationDate.setDate(expirationDate.getDate() + 30) // 30 days active

      const supabase = getSupabaseClient()
      if (supabase && email) {
        const { error } = await supabase.from('subscriptions').upsert({
          email: email,
          plan_tier: planTier,
          amount: amount,
          status: 'active',
          korapay_reference: reference,
          expiration_date: expirationDate.toISOString(),
          updated_at: new Date().toISOString()
        }, { onConflict: 'email' })

        if (error) {
          console.error('[Korapay Webhook] Supabase upsert failed:', error)
        } else {
          console.log(`[Korapay Webhook] Successfully activated ${planTier} subscription for ${email}`)
        }
      }
    }

    return NextResponse.json({ status: 'success', received: true })
  } catch (error: any) {
    console.error('[Korapay Webhook Error]:', error)
    return NextResponse.json(
      { error: error.message || 'Webhook parsing error' },
      { status: 500 }
    )
  }
}
