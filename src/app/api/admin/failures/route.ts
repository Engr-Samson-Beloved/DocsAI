/**
 * Failure history.
 *
 *   GET /api/admin/failures?limit=&email=&feature=&days=
 *
 * Reads across every account, so it is admin-only and goes through the
 * service-role client (see utils/entitlements/store.ts). Note that a paywall
 * refusal is recorded as a failure with stage `quota` — those rows are the most
 * useful thing in the log, because each one is someone who wanted to do
 * something their plan did not cover.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '../../../../utils/adminAuth'
import { listFailures } from '../../../../utils/entitlements/store'
import { getSupabaseAdminClient } from '../../../../utils/supabaseAdmin'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const guard = requireAdmin(req)
  if ('response' in guard) return guard.response

  const { searchParams } = new URL(req.url)
  const days = Number(searchParams.get('days') || '30')
  const limit = Number(searchParams.get('limit') || '200')

  try {
    const failures = await listFailures({
      limit,
      email: searchParams.get('email'),
      feature: searchParams.get('feature'),
      since: Number.isFinite(days) && days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : null,
    })

    return NextResponse.json({
      failures,
      // Without the service key this list only covers what this install wrote
      // to disk, which the dashboard says rather than implying all is well.
      degraded: !getSupabaseAdminClient(),
    })
  } catch (error) {
    console.error('Admin failure query failed:', error)
    return NextResponse.json({ error: 'Could not load the failure history.' }, { status: 500 })
  }
}
