/**
 * Recent metered activity, and the one way to reverse a charge.
 *
 *   GET    /api/admin/usage?limit=&email=&feature=&days=
 *   DELETE /api/admin/usage?id=              refund a single unit
 *
 * The refund deletes the usage row rather than incrementing a credit counter.
 * Counting rows IS the quota (see migrations/002_entitlements.sql), so removing
 * one hands the credit straight back with no second source of truth to drift.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '../../../../utils/adminAuth'
import { deleteUsage, listUsage } from '../../../../utils/entitlements/store'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const guard = requireAdmin(req)
  if ('response' in guard) return guard.response

  const { searchParams } = new URL(req.url)
  const days = Number(searchParams.get('days') || '30')

  try {
    const usage = await listUsage({
      limit: Number(searchParams.get('limit') || '200'),
      email: searchParams.get('email'),
      feature: searchParams.get('feature'),
      since: Number.isFinite(days) && days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : null,
    })

    return NextResponse.json({ usage })
  } catch (error) {
    console.error('Admin usage query failed:', error)
    return NextResponse.json({ error: 'Could not load usage.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const guard = requireAdmin(req)
  if ('response' in guard) return guard.response

  const id = new URL(req.url).searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'A usage id is required.' }, { status: 400 })
  }

  try {
    const removed = await deleteUsage(id)
    if (!removed) {
      return NextResponse.json({ error: 'That usage record was not found.' }, { status: 404 })
    }
    console.log(`[Admin] ${guard.session.email} refunded usage record ${id}`)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Admin refund failed:', error)
    return NextResponse.json({ error: 'Could not refund that credit.' }, { status: 500 })
  }
}
