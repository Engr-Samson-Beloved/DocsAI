/**
 * The stored report PDF.
 *
 *   GET /api/integrity/check/:id/report
 *
 * Streams bytes that were rendered once, when the check completed (§25). This
 * route never regenerates: a download that re-rendered would produce a file
 * with a different generation date from the one the student already saved, and
 * would re-do minutes of layout work on every click.
 *
 * The PDF is served through an authorised route rather than from a public URL.
 * A predictable public path to a document that names a student, their
 * institution and their AI-detection scores is exactly the leak §20 rules out.
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveOwner, ownsRecord } from '../../../../../../utils/owner'
import { loadCheck, loadReport } from '../../../../../../utils/integrity/store'

export const runtime = 'nodejs'

/** Trims a document title down to something safe to put in a filename. */
function safeFilename(title: string): string {
  const cleaned = title
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
  return cleaned || 'document'
}

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

  if (!check.reportGenerated) {
    return NextResponse.json(
      {
        error:
          check.status === 'completed'
            ? 'The report for this check could not be generated. Your results are still available on the dashboard.'
            : 'The report is not ready yet.',
      },
      { status: 409 }
    )
  }

  const bytes = await loadReport(id, owner.supabase)
  if (!bytes) {
    return NextResponse.json({ error: 'The stored report could not be read.' }, { status: 404 })
  }

  const filename = `WordPI-Integrity-Report-${safeFilename(check.document.title)}.pdf`

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(bytes.byteLength),
      'Content-Disposition': `attachment; filename="${filename}"`,
      // Private: the response body is the user's own document analysis and
      // must not be retained by a shared cache.
      'Cache-Control': 'private, no-store',
    },
  })
}
