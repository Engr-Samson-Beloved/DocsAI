/**
 * Humanizer: poll a rewrite job.
 *
 * Proxies GhostWriter `GET /rewrite/{job_id}` and normalises the answer, because
 * the published spec types both 200 bodies as a bare `string` — the FastAPI
 * default when no response model is declared. The real shape is described only
 * in prose on the submit endpoint: a `status`, plus `rewritten` for text jobs
 * and `download_url` for file jobs once the status settles.
 *
 * Since the field names are documented but unverified, reading them is done
 * defensively and snake_case and camelCase are both accepted.
 */

import { humanizerBaseUrl, upstreamAuthHeaders, describeUpstreamError, unreachable } from '../upstream'

export const runtime = 'nodejs'

export type JobState = 'running' | 'done' | 'error'

/**
 * Collapses upstream status strings onto the three states the client handles.
 *
 * Documented values are `running`, `done` and `error`; the synonyms cover the
 * usual job-queue vocabulary so an upstream wording change does not strand a
 * poll loop that would otherwise spin until it times out.
 */
function normaliseStatus(raw: unknown): JobState {
  const value = String(raw ?? '').toLowerCase().trim()
  if (['done', 'completed', 'complete', 'success', 'succeeded', 'finished'].includes(value)) {
    return 'done'
  }
  if (['error', 'failed', 'failure', 'cancelled', 'canceled'].includes(value)) {
    return 'error'
  }
  return 'running'
}

function firstString(source: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params
  if (!jobId) {
    return Response.json({ error: 'A job id is required.' }, { status: 400 })
  }

  const base = humanizerBaseUrl()

  try {
    const res = await fetch(`${base}/rewrite/${encodeURIComponent(jobId)}`, {
      method: 'GET',
      headers: { Accept: 'application/json', ...upstreamAuthHeaders() },
      // Polling must stay responsive; a slow answer is retried by the caller.
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    })

    const body = await res.json().catch(() => null)

    if (!res.ok) {
      return Response.json(
        { error: describeUpstreamError(body, res.status) },
        { status: res.status === 404 ? 404 : 502 }
      )
    }

    if (!body || typeof body !== 'object') {
      return Response.json(
        { error: 'The rewriter returned an unreadable job status.' },
        { status: 502 }
      )
    }

    const record = body as Record<string, unknown>
    const status = normaliseStatus(record.status)
    const rewritten = firstString(record, 'rewritten', 'result', 'text')
    const downloadUrl = firstString(record, 'download_url', 'downloadUrl')

    if (status === 'error') {
      return Response.json({
        status,
        error:
          firstString(record, 'error', 'detail', 'message') ||
          'The rewriter could not finish this document.',
      })
    }

    return Response.json({
      status,
      rewritten,
      /**
       * Whether the finished job has a file to collect. The upstream's own
       * `download_url` is deliberately not handed to the browser: it points at
       * another origin with no published CORS policy, and fetching it directly
       * would bypass the proxy that exists to keep the upstream configurable.
       * The client collects the file from our route below instead.
       */
      hasFile: Boolean(downloadUrl),
      downloadPath: downloadUrl ? `/api/humanize/${encodeURIComponent(jobId)}/download` : null,
    })
  } catch (err) {
    return unreachable(err)
  }
}
