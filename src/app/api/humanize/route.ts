/**
 * Humanizer: submit a rewrite job.
 *
 * Proxies to GhostWriter `POST /rewrite`, which rewrites a draft in the
 * author's voice. The work runs in the background upstream: a successful
 * submission answers 202 with a `job_id`, and the caller polls
 * `/api/humanize/{jobId}` until the status settles.
 *
 * Two input modes, exactly one per job:
 *   - `draft` — raw text, and the finished job carries `rewritten` text back.
 *   - `file`  — a .docx or .pdf, and the finished job exposes a rewritten .docx
 *     to download.
 *
 * The editor uses the file mode. Sending a .docx and reading a .docx back is
 * what keeps headings, lists and tables through the rewrite; handing over
 * flattened text would return prose we could only re-import as paragraphs.
 */

import {
  humanizerBaseUrl,
  upstreamAuthHeaders,
  MAX_UPLOAD_BYTES,
  describeUpstreamError,
  unreachable,
} from './upstream'
import { requireFeature } from '../../../utils/entitlements/service'

export const runtime = 'nodejs'
export const maxDuration = 60

/** What GhostWriter accepts as a file upload. */
const ACCEPTED_FILE = /\.(docx|pdf)$/i

const ACCEPTED_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/pdf',
])

/**
 * Availability probe, mirroring the export/pdf route so the client can decide
 * whether to offer the action at all instead of failing one the user started.
 *
 * The service exposes no health endpoint, so this HEADs the docs path: any HTTP
 * answer proves the host is up and routing. A 403 counts — the docs sit behind
 * an edge filter that the API paths themselves do not use.
 */
export async function GET() {
  const base = humanizerBaseUrl()

  try {
    const probe = await fetch(`${base}/docs`, {
      method: 'HEAD',
      headers: upstreamAuthHeaders(),
      signal: AbortSignal.timeout(5000),
    })
    // Only 5xx means the service itself is broken.
    return Response.json({ available: probe.status < 500, endpoint: base })
  } catch {
    return Response.json({
      available: false,
      endpoint: base,
      reason: 'The rewriting service is unreachable.',
    })
  }
}

export async function POST(request: Request) {
  const base = humanizerBaseUrl()

  // Metered before the upload is read: a rewrite is one of a Base subscriber's
  // two per cycle, and the check costs nothing while parsing a 20 MB multipart
  // body does. Charged at the bottom, once the job is accepted upstream — a
  // submission the rewriter rejected must not spend a credit.
  const grant = await requireFeature(request, 'humanize')
  if (!grant.ok) return grant.response

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ error: 'Expected a multipart/form-data upload.' }, { status: 400 })
  }

  const rawDraft = form.get('draft')
  const draft = typeof rawDraft === 'string' && rawDraft.trim() ? rawDraft : null

  const rawFile = form.get('file')
  const file = rawFile instanceof File && rawFile.size > 0 ? rawFile : null

  // Enforced here rather than upstream so the message names the real problem.
  // Upstream resolves the ambiguous case by silently ignoring one input, which
  // would rewrite something other than what the caller meant to send.
  if (!draft && !file) {
    return Response.json(
      { error: "Provide either 'draft' text or a 'file' upload to humanize." },
      { status: 400 }
    )
  }
  if (draft && file) {
    return Response.json(
      { error: "Provide only one of 'draft' or 'file', not both." },
      { status: 400 }
    )
  }

  if (file) {
    if (file.size > MAX_UPLOAD_BYTES) {
      return Response.json(
        { error: `Document is too large to humanize (limit ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).` },
        { status: 413 }
      )
    }
    if (!ACCEPTED_FILE.test(file.name) && !ACCEPTED_MIME.has(file.type)) {
      return Response.json(
        { error: 'Only .docx and .pdf files can be humanized.' },
        { status: 415 }
      )
    }
  }

  // Rebuilt rather than forwarded wholesale: only the three documented fields
  // should ever reach the upstream.
  const upstreamForm = new FormData()
  if (draft) upstreamForm.append('draft', draft)
  if (file) upstreamForm.append('file', file, file.name || 'document.docx')

  const override = form.get('system_prompt_override')
  if (typeof override === 'string' && override.trim()) {
    upstreamForm.append('system_prompt_override', override.trim())
  }

  try {
    const res = await fetch(`${base}/rewrite`, {
      method: 'POST',
      headers: upstreamAuthHeaders(),
      body: upstreamForm,
      signal: AbortSignal.timeout(55_000),
    })

    const body = await res.json().catch(() => null)

    if (!res.ok) {
      const message = describeUpstreamError(body, res.status)
      await grant.fail('upstream', message, res.status)
      return Response.json(
        { error: message },
        // 4xx is the caller's fault and is passed through; anything else is a
        // failure of the upstream, which is a bad gateway from here.
        { status: res.status >= 400 && res.status < 500 ? res.status : 502 }
      )
    }

    const jobId = (body as { job_id?: unknown } | null)?.job_id
    if (typeof jobId !== 'string' || !jobId) {
      await grant.fail('upstream', 'Rewriter accepted the job but returned no job id', 502)
      return Response.json(
        { error: 'The rewriter accepted the job but returned no job id.' },
        { status: 502 }
      )
    }

    // The job is running upstream and its output is the user's. Charged here
    // rather than on download: the rewrite is already being paid for at
    // GhostWriter whether or not the browser comes back to collect it.
    await grant.commit({ metadata: { jobId, mode: file ? 'file' : 'draft' } })

    return Response.json(
      { jobId, status: (body as { status?: string }).status || 'running' },
      { status: 202 }
    )
  } catch (err) {
    await grant.fail('upstream', err instanceof Error ? err.message : String(err), 502)
    return unreachable(err)
  }
}
