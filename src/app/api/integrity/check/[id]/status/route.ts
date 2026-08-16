/**
 * Poll target for a running check.
 *
 *   GET /api/integrity/check/:id/status
 *
 * Deliberately smaller than the full record: this is fetched every couple of
 * seconds while a scan runs, and shipping provider payloads and flagged
 * offsets on each poll would be wasteful for data the progress UI never reads.
 * The dashboard fetches the full check once, when the status settles.
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveOwner, ownsRecord } from '../../../../../../utils/owner'
import { loadCheck } from '../../../../../../utils/integrity/store'
import { reapIfStale } from '../../../../../../utils/integrity/runner'

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
  if (!check || !ownsRecord(owner, check.ownerKey)) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  const settled = await reapIfStale(check, owner.supabase)

  return NextResponse.json(
    {
      id: settled.id,
      status: settled.status,
      stages: settled.stages,
      assessment: settled.verdict?.assessment ?? null,
      reportGenerated: settled.reportGenerated,
      error: settled.error ?? null,
    },
    // Polling must never be answered from a cache, or the UI watches a stale
    // "processing" until the poll loop gives up.
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
