/**
 * Controlled retries for provider calls (§23).
 *
 * The rule that matters is which failures are worth repeating. Retrying a 401
 * just burns the rate limit with the same wrong credential, and retrying a 400
 * re-sends the same malformed body — both fail identically the second time and
 * delay the honest error the user needs to see. Only transport faults, 429 and
 * 5xx get another attempt.
 *
 * Three attempts, then stop. An unbounded loop against a paid API is a way to
 * spend a lot of money on an outage.
 */

/** Marks an error as worth another attempt. Thrown by provider HTTP helpers. */
export class TransientProviderError extends Error {
  /** Seconds the provider asked us to wait, from `Retry-After`, if it did. */
  retryAfterSeconds?: number

  constructor(message: string, retryAfterSeconds?: number) {
    super(message)
    this.name = 'TransientProviderError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/** A failure that will recur identically — bad credentials, bad request. */
export class PermanentProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PermanentProviderError'
  }
}

export interface RetryOptions {
  attempts?: number
  /** Delay before the first retry. Doubles each time. */
  baseDelayMs?: number
  /** Ceiling on any single wait, so a hostile Retry-After cannot stall a job. */
  maxDelayMs?: number
  signal?: AbortSignal
  /** Called before each wait, for progress reporting. */
  onRetry?: (attempt: number, error: Error, waitMs: number) => void
}

const DEFAULTS = {
  attempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 20_000,
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
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
 * Runs `task`, retrying only transient failures.
 *
 * Backoff is exponential with jitter. The jitter is not decoration: a document
 * that chunks into a dozen parallel calls would otherwise retry all twelve on
 * the same tick and re-trip the rate limit that caused the retry.
 */
export async function withRetry<T>(
  task: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const attempts = options.attempts ?? DEFAULTS.attempts
  const baseDelayMs = options.baseDelayMs ?? DEFAULTS.baseDelayMs
  const maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs

  let lastError: Error = new Error('Retry helper ran zero attempts.')

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await task(attempt)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      if (err instanceof PermanentProviderError) throw err

      lastError = err instanceof Error ? err : new Error(String(err))

      // Anything not explicitly marked transient is treated as permanent. The
      // safer default for a metered API is to stop, not to spend again.
      if (!(err instanceof TransientProviderError)) throw lastError

      if (attempt === attempts) break

      const exponential = baseDelayMs * 2 ** (attempt - 1)
      const requested = (err.retryAfterSeconds ?? 0) * 1000
      const jitter = Math.random() * baseDelayMs
      const waitMs = Math.min(Math.max(exponential, requested) + jitter, maxDelayMs)

      options.onRetry?.(attempt, lastError, waitMs)
      await delay(waitMs, options.signal)
    }
  }

  throw lastError
}

/**
 * Turns an HTTP response into the right error class.
 *
 * 408/425/429 and 5xx are the retryable set. 409 is not: for Copyleaks it means
 * the scan id is already in use, which repeating cannot fix.
 */
export function classifyHttpFailure(status: number, message: string, retryAfter?: string | null): Error {
  const retryable = status === 408 || status === 425 || status === 429 || status >= 500
  if (!retryable) return new PermanentProviderError(message)

  const seconds = retryAfter ? Number(retryAfter) : NaN
  return new TransientProviderError(message, Number.isFinite(seconds) ? seconds : undefined)
}

/** Network-level failures (DNS, refused, timeout) are always worth one more go. */
export function classifyFetchFailure(err: unknown, providerLabel: string): Error {
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof DOMException && err.name === 'AbortError') {
    return new TransientProviderError(`${providerLabel} did not respond in time.`)
  }
  return new TransientProviderError(`Could not reach ${providerLabel}: ${message}`)
}
