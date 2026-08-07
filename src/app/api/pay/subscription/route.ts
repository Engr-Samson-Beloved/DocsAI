import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseClient } from '../../../../utils/supabase'

function getBearerToken(req: NextRequest): string | undefined {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return undefined
  const parts = authHeader.split(' ')
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1]
  }
  return undefined
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const emailParam = searchParams.get('email')
    const token = getBearerToken(req)

    const supabase = getSupabaseClient(token)
    
    let targetEmail = emailParam

    if (supabase && token) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user && user.email) {
        targetEmail = user.email
      }
    }

    if (!targetEmail) {
      return NextResponse.json({
        subscription: {
          user_id: 'guest',
          email: 'guest@docuai.app',
          plan_tier: 'free',
          amount: 0,
          status: 'free',
          expiration_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString()
        }
      })
    }

    if (supabase) {
      const { data, error } = await supabase
        .from('subscriptions')
        .select('*')
        .ilike('email', targetEmail)
        .maybeSingle()

      if (data && !error) {
        let status = data.status
        let plan_tier = data.plan_tier

        if (data.expiration_date && new Date(data.expiration_date) < new Date()) {
          status = 'expired'
          plan_tier = 'free'
        }

        return NextResponse.json({
          subscription: {
            user_id: data.user_id || targetEmail,
            email: data.email,
            plan_tier,
            amount: data.amount,
            status,
            korapay_reference: data.korapay_reference,
            expiration_date: data.expiration_date,
            updated_at: data.updated_at
          }
        })
      }
    }

    return NextResponse.json({
      subscription: {
        user_id: targetEmail,
        email: targetEmail,
        plan_tier: 'free',
        amount: 0,
        status: 'free',
        expiration_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString()
      }
    })
  } catch (error: any) {
    console.error('Failed to get subscription:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
