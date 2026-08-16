/**
 * Humanizer: collect the rewritten .docx.
 *
 * Proxies GhostWriter `GET /rewrite/{job_id}/download` and streams the bytes
 * back under our own origin, so the browser never has to reach the upstream
 * directly. The editor re-imports the result through the normal .docx ingest
 * path, which is why the response must stay real Word bytes rather than being
 * transformed here.
 */

import { humanizerBaseUrl, upstreamAuthHeaders, describeUpstreamError, unreachable } from '../../upstream'

export const runtime = 'nodejs'
export const maxDuration = 60

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** Strips characters that would break the Content-Disposition header. */
function safeFilename(raw: string | null): string {
  const base = (raw || 'humanized').replace(/\.[^.]+$/, '').replace(/[\r\n"\\]/g, '').trim()
  return `${base || 'humanized'}.docx`
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params
  if (!jobId) {
    return Response.json({ error: 'A job id is required.' }, { status: 400 })
  }

  const base = humanizerBaseUrl()
  const filename = safeFilename(new URL(request.url).searchParams.get('name'))

  try {
    const res = await fetch(`${base}/rewrite/${encodeURIComponent(jobId)}/download`, {
      method: 'GET',
      headers: upstreamAuthHeaders(),
      signal: AbortSignal.timeout(55_000),
      cache: 'no-store',
    })

    if (!res.ok) {
      // The error path answers JSON even though the success path is binary.
      const body = await res.json().catch(() => null)
      return Response.json(
        { error: describeUpstreamError(body, res.status) },
        { status: res.status === 404 ? 404 : 502 }
      )
    }

    const bytes = await res.arrayBuffer()
    if (!bytes.byteLength) {
      return Response.json(
        { error: 'The rewriter returned an empty document.' },
        { status: 502 }
      )
    }

    // Trust the upstream's own content type when it sent a real one; some
    // gateways answer octet-stream, which the ingest pipeline would refuse.
    const upstreamType = res.headers.get('content-type') || ''
    const contentType = upstreamType.includes('officedocument') ? upstreamType : DOCX_MIME

    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return unreachable(err)
  }
}
