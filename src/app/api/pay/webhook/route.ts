import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getSupabaseClient } from '../../../../utils/supabase'
import { getSupabaseAdminClient } from '../../../../utils/supabaseAdmin'
import { CYCLE_DAYS, isPaidTier, tierForAmount } from '../../../../utils/plans'
import { saveSubscriptionRow } from '../../../../utils/subscriptionWrite'

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text()
    const signature = req.headers.get('x-korapay-signature')

    const webhookSecret = process.env.KORAPAY_WEBHOOK_SECRET || process.env.KORAPAY_SECRET_KEY

    // A webhook grants paid access, so it is only ever trusted when it proves it
    // came from Korapay. Previously a request that simply omitted the signature
    // header skipped verification entirely and could activate any subscription.
    if (!webhookSecret) {
      console.error('[Korapay Webhook] No webhook secret configured; refusing to process.')
      return NextResponse.json(
        { error: 'Webhook secret is not configured on this server.' },
        { status: 500 }
      )
    }

    if (!signature) {
      console.error('[Korapay Webhook] Rejected request with no x-korapay-signature header.')
      return NextResponse.json(
        { error: 'Missing webhook signature' },
        { status: 401 }
      )
    }

    // Korapay signs the `data` object, but accept a whole-envelope signature
    // too — both require the secret, so tolerating either is safe and keeps the
    // endpoint working if the signing convention differs.
    const signingCandidates: string[] = [rawBody]
    try {
      const parsedForSigning = JSON.parse(rawBody)
      if (parsedForSigning && parsedForSigning.data !== undefined) {
        signingCandidates.unshift(JSON.stringify(parsedForSigning.data))
      }
    } catch {
      return NextResponse.json({ error: 'Malformed webhook payload' }, { status: 400 })
    }

    const provided = Buffer.from(signature, 'utf8')
    const signatureMatches = signingCandidates.some(candidate => {
      const computed = Buffer.from(
        crypto.createHmac('sha256', webhookSecret).update(candidate).digest('hex'),
        'utf8'
      )
      return provided.length === computed.length && crypto.timingSafeEqual(provided, computed)
    })

    if (!signatureMatches) {
      console.error('[Korapay Webhook] Invalid HMAC signature mismatch!')
      return NextResponse.json(
        { error: 'Invalid webhook signature' },
        { status: 401 }
      )
    }

    const payload = JSON.parse(rawBody)
    const { event, data } = payload

    console.log(`[Korapay Webhook Received] Event: ${event}`, data)

    if (event === 'charge.success' || event === 'subscription.create') {
      const email = data.customer?.email
      const reference = data.reference
      const amount = Number(data.amount) || 0

      // Derived from the settled amount, never from the echoed metadata: the
      // signature proves Korapay sent this envelope, not that the plan name
      // inside it matches what was paid. Same reasoning as /api/pay/verify.
      const planTier = tierForAmount(amount)

      if (!isPaidTier(planTier)) {
        console.warn(
          `[Korapay Webhook] ${reference} settled for ₦${amount}, below the lowest plan. Not activating.`
        )
        return NextResponse.json({ status: 'success', received: true, activated: false })
      }

      const cycleStartedAt = new Date()
      const expirationDate = new Date(cycleStartedAt)
      expirationDate.setDate(expirationDate.getDate() + CYCLE_DAYS)

      // Service role first: this request comes from Korapay's servers with no
      // user session, so under row-level security the anon key cannot write the
      // row and a paid subscription would never activate.
      const supabase = getSupabaseAdminClient() ?? getSupabaseClient()

      if (email) {
        const outcome = await saveSubscriptionRow(supabase, {
          email,
          planTier,
          amount,
          reference,
          cycleStartedAt,
          expirationDate,
        })

        if (outcome !== 'failed') {
          console.log(
            `[Korapay Webhook] Successfully activated ${planTier} subscription for ${email}` +
              (outcome === 'local' ? ' (from the local fallback store)' : '')
          )
        } else {
          // Answering non-2xx makes Korapay retry, which is what we want: the
          // charge is real and the grant is missing, so another attempt is
          // strictly better than dropping it. The operator also sees this in
          // the admin failure history.
          console.error(
            `[Korapay Webhook] PAYMENT TAKEN BUT NOT GRANTED. reference=${reference} email=${email} tier=${planTier}`
          )
          return NextResponse.json(
            { error: 'Could not persist the subscription; please retry this webhook.' },
            { status: 503 }
          )
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
