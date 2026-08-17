/** Dashboard headline numbers. Admin session required. */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '../../../../utils/adminAuth'
import { overview } from '../../../../utils/adminData'
import { PLANS } from '../../../../utils/plans'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const guard = requireAdmin(req)
  if ('response' in guard) return guard.response

  try {
    const result = await overview()
    return NextResponse.json({
      overview: result.data,
      degraded: result.degraded,
      reason: result.reason,
      plans: PLANS,
    })
  } catch (error) {
    console.error('Admin overview failed:', error)
    return NextResponse.json({ error: 'Could not load the dashboard.' }, { status: 500 })
  }
}
