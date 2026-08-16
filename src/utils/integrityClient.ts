"use client"

/**
 * Client side of the Integrity Checker.
 *
 * Same shape as `utils/humanize.ts`, deliberately: submit, poll with backoff,
 * collect. Callers get a promise and a stream of progress, not a state machine.
 * Everything goes through our own /api/integrity routes — the provider keys are
 * server-side and the browser never sees them (§3, §24).
 */

import type { CheckStage, IntegrityCheck, IntegrityStatus } from './integrity/types'

/** Thrown when no detection provider is configured on this deployment. */
export class IntegrityUnavailableError extends Error {}

/** Thrown when the check itself failed, as opposed to the transport failing. */
export class IntegrityCheckError extends Error {}

function authHeaders(json = false): Record<string, string> {
  const headers: Record<string, string> = {}
  if (json) headers['Content-Type'] = 'application/json'
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('wordpi-session-token')
    if (token) headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

async function errorFrom(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json()
    if (body?.error) return String(body.error)
  } catch {
    /* keep the fallback */
  }
  return fallback
}

export interface SubmitDocument {
  projectId: string
  title: string
  /** Stringified Tiptap JSON or HTML — the server normalises either. */
  content: string
  documentType?: string
  academicLevel?: string
  studentName?: string
  department?: string
  institution?: string
}

export interface UsageEstimate {
  wordCount: number
  providers: { id: string; label: string; note: string }[]
}

export interface SubmitResult {
  checkId: string
  /** True when an identical document had already been checked (§21). */
  cached: boolean
  message?: string
  estimate?: UsageEstimate
  /** False when this deployment has no public URL for similarity callbacks. */
  similarityAvailable?: boolean
}

/**
 * Starts a check.
 *
 * `force` re-scans a document that has not changed since its last check. The
 * default is not to, because the previous result is free and a new one is not.
 */
export async function submitIntegrityCheck(
  document: SubmitDocument,
  options: { force?: boolean; sandbox?: boolean } = {}
): Promise<SubmitResult> {
  const res = await fetch('/api/integrity/check', {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({ ...document, force: options.force, sandbox: options.sandbox }),
  })

  if (res.status === 501) {
    throw new IntegrityUnavailableError(
      await errorFrom(res, 'Integrity checking is not configured on this deployment.')
    )
  }
  if (!res.ok) {
    throw new IntegrityCheckError(
      await errorFrom(res, `Could not start the integrity check (${res.status}).`)
    )
  }

  const body = await res.json()
  return {
    checkId: body.checkId,
    cached: Boolean(body.cached),
    message: body.message,
    estimate: body.estimate,
    similarityAvailable: body.similarityAvailable,
  }
}

export interface StatusSnapshot {
  id: string
  status: IntegrityStatus
  stages: CheckStage[]
  reportGenerated: boolean
  error: string | null
}

export async function fetchStatus(checkId: string, signal?: AbortSignal): Promise<StatusSnapshot> {
  const res = await fetch(`/api/integrity/check/${encodeURIComponent(checkId)}/status`, {
    headers: authHeaders(),
    cache: 'no-store',
    signal,
  })

  if (res.status === 404) {
    throw new IntegrityCheckError('This integrity check could not be found.')
  }
  if (!res.ok) {
    throw new Error(await errorFrom(res, `Status check failed (${res.status}).`))
  }
  return res.json()
}

export async function fetchCheck(checkId: string): Promise<IntegrityCheck> {
  const res = await fetch(`/api/integrity/check/${encodeURIComponent(checkId)}`, {
    headers: authHeaders(),
    cache: 'no-store',
  })

  if (res.status === 404) {
    throw new IntegrityCheckError('This integrity check could not be found.')
  }
  if (!res.ok) {
    throw new Error(await errorFrom(res, `Could not load the check (${res.status}).`))
  }
  return (await res.json()).check
}

/**
 * How long to watch before giving up.
 *
 * Generous, because a similarity scan of a full dissertation genuinely takes
 * minutes. The ceiling exists only so a check that dies server-side cannot
 * leave the UI spinning forever.
 */
const POLL_TIMEOUT_MS = 10 * 60 * 1000
const POLL_INTERVAL_START_MS = 1500
const POLL_INTERVAL_MAX_MS = 5000

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

export interface WatchOptions {
  onStages?: (stages: CheckStage[]) => void
  signal?: AbortSignal
}

/**
 * Polls until the check settles, then resolves with the full record.
 *
 * A single failed poll is not a failed check — the scan is running server-side
 * whether or not one status request got through — so transient errors are
 * absorbed and only a run of them gives up. Same reasoning as the Humanizer's
 * poll loop.
 */
export async function watchIntegrityCheck(
  checkId: string,
  options: WatchOptions = {}
): Promise<IntegrityCheck> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  let interval = POLL_INTERVAL_START_MS
  let consecutiveFailures = 0

  while (Date.now() < deadline) {
    let snapshot: StatusSnapshot
    try {
      snapshot = await fetchStatus(checkId, options.signal)
      consecutiveFailures = 0
    } catch (err) {
      if (err instanceof IntegrityCheckError) throw err
      if (err instanceof DOMException && err.name === 'AbortError') throw err

      if (++consecutiveFailures >= 4) {
        throw new Error('Lost contact with the integrity service while it was working.')
      }
      await sleep(interval, options.signal)
      continue
    }

    options.onStages?.(snapshot.stages)

    if (snapshot.status === 'completed') {
      return fetchCheck(checkId)
    }
    if (snapshot.status === 'failed') {
      throw new IntegrityCheckError(
        snapshot.error || 'Integrity check could not be completed. Please try again.'
      )
    }

    await sleep(interval, options.signal)
    interval = Math.min(Math.round(interval * 1.25), POLL_INTERVAL_MAX_MS)
  }

  throw new Error('The integrity check is taking longer than expected. Please try again.')
}

export interface CheckSummary {
  id: string
  projectId: string
  title: string
  status: IntegrityStatus
  assessment: string | null
  headline: string | null
  wordCount: number
  similarityPercentage: number | null
  ai: { provider: string; aiProbability: number | null; status: string }[]
  reportGenerated: boolean
  createdAt: number
  completedAt: number | null
}

/** Previous checks, for the document history (§29, item 15). */
export async function fetchHistory(projectId?: string): Promise<CheckSummary[]> {
  const url = projectId
    ? `/api/integrity/check?projectId=${encodeURIComponent(projectId)}`
    : '/api/integrity/check'

  const res = await fetch(url, { headers: authHeaders(), cache: 'no-store' })
  if (!res.ok) return []
  return (await res.json()).checks ?? []
}

/** The authorised download path for a completed report. */
export function reportUrl(checkId: string): string {
  return `/api/integrity/check/${encodeURIComponent(checkId)}/report`
}

/**
 * Downloads the report.
 *
 * Fetched with the session header and saved from a blob rather than linked
 * directly, because the route requires an Authorization header that a plain
 * `<a href>` navigation cannot send.
 */
export async function downloadReport(checkId: string, filename?: string): Promise<void> {
  const res = await fetch(reportUrl(checkId), { headers: authHeaders() })
  if (!res.ok) {
    throw new Error(await errorFrom(res, 'The report could not be downloaded.'))
  }

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename || 'WordPI-Integrity-Report.pdf'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoked on the next tick: revoking synchronously can cancel the download
  // in some browsers before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
