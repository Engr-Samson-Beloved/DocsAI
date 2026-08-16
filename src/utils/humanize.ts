"use client"

/**
 * Client side of the Humanizer — rewriting a document in the author's voice.
 *
 * The work is asynchronous upstream, so a humanize is three steps rather than
 * one request: submit the job, poll until it settles, then collect the result.
 * That is hidden behind `humanizeFile` / `humanizeText`; callers get a promise
 * and a stream of progress messages, not a state machine.
 *
 * Everything talks to our own /api/humanize routes, never to GhostWriter
 * directly — see src/app/api/humanize/upstream.ts for why.
 */

/** Thrown when the rewriting service is not reachable on this deployment. */
export class HumanizerUnavailableError extends Error {}

/** Thrown when the job itself failed, as opposed to the transport failing. */
export class HumanizeJobError extends Error {}

let availabilityProbe: Promise<boolean> | null = null

/** Cached per session — the answer cannot change without a redeploy. */
export function isHumanizerAvailable(): Promise<boolean> {
  if (!availabilityProbe) {
    availabilityProbe = fetch('/api/humanize', { method: 'GET' })
      .then(r => (r.ok ? r.json() : { available: false }))
      .then(j => Boolean(j?.available))
      .catch(() => false)
  }
  return availabilityProbe
}

export interface HumanizeOptions {
  /** Replaces the default author-style prompt used upstream. */
  systemPromptOverride?: string
  /** Receives human-readable progress, suitable for a loading overlay. */
  onStage?: (message: string) => void
  /** Aborts the poll loop. The upstream job keeps running; we stop watching. */
  signal?: AbortSignal
}

/**
 * How long to keep polling before giving up.
 *
 * A full dissertation is a large rewrite, so this is generous. The ceiling
 * exists only so a job that dies upstream cannot leave the UI spinning
 * forever.
 */
const POLL_TIMEOUT_MS = 6 * 60 * 1000

/** Poll cadence, easing off so a long job does not hammer the endpoint. */
const POLL_INTERVAL_START_MS = 2000
const POLL_INTERVAL_MAX_MS = 6000

interface JobStatus {
  status: 'running' | 'done' | 'error'
  rewritten?: string | null
  hasFile?: boolean
  downloadPath?: string | null
  error?: string
}

/** Reads the `error` field out of a failed JSON response, if there is one. */
async function errorFrom(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json()
    if (body?.error) return String(body.error)
  } catch {
    /* keep the fallback */
  }
  return fallback
}

async function submitJob(body: FormData): Promise<string> {
  const res = await fetch('/api/humanize', { method: 'POST', body })

  if (res.status === 501) {
    throw new HumanizerUnavailableError('Humanizing is not configured on this deployment.')
  }
  if (!res.ok) {
    throw new Error(await errorFrom(res, `Could not start the rewrite (${res.status}).`))
  }

  const { jobId } = await res.json()
  if (!jobId) throw new Error('The rewriter did not return a job id.')
  return jobId as string
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Polls until the job settles.
 *
 * A single failed poll is not treated as a failed job: the rewrite is running
 * upstream regardless of whether one status request got through, so transient
 * network errors are absorbed and only a run of them gives up.
 */
async function awaitJob(jobId: string, options: HumanizeOptions): Promise<JobStatus> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  let interval = POLL_INTERVAL_START_MS
  let consecutiveFailures = 0
  let elapsed = 0

  while (Date.now() < deadline) {
    await sleep(interval, options.signal)
    elapsed += interval
    interval = Math.min(Math.round(interval * 1.25), POLL_INTERVAL_MAX_MS)

    let status: JobStatus
    try {
      const res = await fetch(`/api/humanize/${encodeURIComponent(jobId)}`, {
        signal: options.signal,
        cache: 'no-store',
      })
      if (res.status === 404) {
        throw new HumanizeJobError('The rewrite job expired or could not be found.')
      }
      if (!res.ok) {
        throw new Error(await errorFrom(res, `Status check failed (${res.status}).`))
      }
      status = await res.json()
      consecutiveFailures = 0
    } catch (err) {
      // An abort or a definitively dead job must not be retried.
      if (err instanceof HumanizeJobError) throw err
      if (err instanceof DOMException && err.name === 'AbortError') throw err

      if (++consecutiveFailures >= 4) {
        throw new Error('Lost contact with the rewriting service while it was working.')
      }
      continue
    }

    if (status.status === 'error') {
      throw new HumanizeJobError(status.error || 'The rewrite failed.')
    }
    if (status.status === 'done') {
      return status
    }

    options.onStage?.(`Rewriting in your voice… (${Math.round(elapsed / 1000)}s)`)
  }

  throw new Error('The rewrite is taking longer than expected. Please try again.')
}

/**
 * Humanizes a .docx or .pdf and resolves with the rewritten .docx.
 *
 * File in, file out is the high-fidelity path: the rewriter reads a real
 * document and returns a real document, so headings, lists and tables survive
 * the round trip. Flattening to text first would lose all of that.
 */
export async function humanizeFile(
  file: Blob,
  filename: string,
  options: HumanizeOptions = {}
): Promise<Blob> {
  options.onStage?.('Uploading your document…')

  const form = new FormData()
  form.append('file', file, filename)
  if (options.systemPromptOverride?.trim()) {
    form.append('system_prompt_override', options.systemPromptOverride.trim())
  }

  const jobId = await submitJob(form)
  options.onStage?.('Rewriting in your voice…')

  const status = await awaitJob(jobId, options)

  if (!status.hasFile || !status.downloadPath) {
    throw new HumanizeJobError('The rewrite finished but produced no document.')
  }

  options.onStage?.('Collecting the rewritten document…')

  const res = await fetch(
    `${status.downloadPath}?name=${encodeURIComponent(filename)}`,
    { signal: options.signal }
  )
  if (!res.ok) {
    throw new Error(await errorFrom(res, `Could not download the rewrite (${res.status}).`))
  }

  const blob = await res.blob()
  if (!blob.size) throw new HumanizeJobError('The rewritten document came back empty.')
  return blob
}

/** Humanizes raw text and resolves with the rewritten text. */
export async function humanizeText(
  draft: string,
  options: HumanizeOptions = {}
): Promise<string> {
  if (!draft.trim()) throw new Error('There is no text to humanize.')

  options.onStage?.('Sending your draft…')

  const form = new FormData()
  form.append('draft', draft)
  if (options.systemPromptOverride?.trim()) {
    form.append('system_prompt_override', options.systemPromptOverride.trim())
  }

  const jobId = await submitJob(form)
  options.onStage?.('Rewriting in your voice…')

  const status = await awaitJob(jobId, options)

  if (!status.rewritten?.trim()) {
    throw new HumanizeJobError('The rewrite finished but produced no text.')
  }
  return status.rewritten
}
