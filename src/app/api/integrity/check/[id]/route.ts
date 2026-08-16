/**
 * One integrity check: read it, or delete it.
 *
 *   GET    /api/integrity/check/:id
 *   DELETE /api/integrity/check/:id
 *
 * Ownership is checked on both. A check record names a document, carries its
 * scores and can be used to fetch the report PDF, so serving one to the wrong
 * caller is the exact failure §20 is about — and `loadCheck` deliberately does
 * NOT filter by owner itself, so that the check happens here, in the open,
 * rather than being buried in a query someone later "optimises".
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveOwner, ownsRecord } from '../../../../../utils/owner'
import { deleteCheck, loadCheck } from '../../../../../utils/integrity/store'
import { reapIfStale } from '../../../../../utils/integrity/runner'

export const runtime = 'nodejs'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const owner = await resolveOwner(req)

  if (owner.unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const check = await loadCheck(id, owner.supabase)

  // Same answer for "does not exist" and "is not yours": distinguishing them
  // would turn this route into a way to test whether a check id is real.
  if (!check || !ownsRecord(owner, check.ownerKey)) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  // A check parked on a similarity callback that never came is finished here,
  // at the moment someone actually looks at it. See runner.ts:reapIfStale.
  const settled = await reapIfStale(check, owner.supabase)

  return NextResponse.json({ check: settled })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const owner = await resolveOwner(req)

  if (owner.unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const check = await loadCheck(id, owner.supabase)
  if (!check || !ownsRecord(owner, check.ownerKey)) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  await deleteCheck(id, owner.supabase)
  return NextResponse.json({ success: true })
}
