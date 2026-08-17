/**
 * Accounts.
 *
 *   GET  /api/admin/users?search=&limit=   list accounts with their usage
 *   POST /api/admin/users                  { action: 'create' | 'grant' }
 *
 * `create` mints a Supabase Auth account (service key required). `grant` puts an
 * existing address on a plan without a payment — which also works for an address
 * that has never signed up, so an operator can provision a plan ahead of the
 * user creating their own account.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '../../../../utils/adminAuth'
import { createUser, grantPlan, listSubscribers } from '../../../../utils/adminData'
import { PLANS, type PlanTier } from '../../../../utils/plans'

export const runtime = 'nodejs'

function isTier(value: unknown): value is PlanTier {
  return typeof value === 'string' && value in PLANS
}

export async function GET(req: NextRequest) {
  const guard = requireAdmin(req)
  if ('response' in guard) return guard.response

  const { searchParams } = new URL(req.url)

  try {
    const result = await listSubscribers({
      search: searchParams.get('search'),
      limit: Number(searchParams.get('limit') || '100'),
    })

    return NextResponse.json({
      users: result.data,
      degraded: result.degraded,
      reason: result.reason,
    })
  } catch (error) {
    console.error('Admin user listing failed:', error)
    return NextResponse.json({ error: 'Could not load the account list.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const guard = requireAdmin(req)
  if ('response' in guard) return guard.response

  let body: {
    action?: string
    email?: string
    password?: string
    tier?: string
    days?: number
    note?: string
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 })
  }

  if (!body.email?.trim()) {
    return NextResponse.json({ error: 'An email address is required.' }, { status: 400 })
  }

  const tier: PlanTier = isTier(body.tier) ? body.tier : 'free'

  if (body.action === 'create') {
    if (!body.password) {
      return NextResponse.json({ error: 'A password is required to create an account.' }, { status: 400 })
    }

    const result = await createUser({
      email: body.email,
      password: body.password,
      tier,
      grantedBy: guard.session.email,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    // `error` can be set on a successful create when the account landed but the
    // plan did not — reported as a warning so the operator knows to retry the
    // grant rather than the whole thing.
    return NextResponse.json({ ok: true, userId: result.userId, warning: result.error ?? null })
  }

  if (body.action === 'grant') {
    const result = await grantPlan({
      email: body.email,
      tier,
      days: body.days,
      grantedBy: guard.session.email,
      note: body.note ?? null,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "Unknown action. Use 'create' or 'grant'." }, { status: 400 })
}
