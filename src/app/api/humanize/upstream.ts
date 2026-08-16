/**
 * Shared configuration for the GhostWriter rewrite proxy.
 *
 * Every humanize request goes through our own routes rather than straight from
 * the browser to GhostWriter. Three reasons:
 *
 *  - CORS. The service publishes no cross-origin policy, so a direct fetch from
 *    the editor origin is not something we can rely on.
 *  - The upstream host is deployment configuration, not a client constant. A
 *    self-hosted rewriter only needs an env var, not a rebuild.
 *  - It leaves one place to add a credential when the service grows one. The
 *    published spec (OAS 3.1, v1.1.0) declares no security schemes today.
 *
 * Not colocated with a `route.ts` export on purpose: in the app router only
 * `route.ts` is a route, so this file stays a plain module.
 */

/** The deployment the feature was built against. */
const DEFAULT_BASE_URL = 'https://ghostwriter-ai.pxxl.click'

/**
 * Base URL for the rewrite service, no trailing slash.
 *
 * Unlike DOCX_CONVERTER_URL this has a working default: the hosted service is
 * public, so the feature should work on a fresh checkout without ceremony.
 */
export function humanizerBaseUrl(): string {
  const raw = process.env.GHOSTWRITER_API_URL?.trim()
  return (raw || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

/**
 * Auth header for the upstream, when one is configured.
 *
 * The spec declares no security, so this is empty on the public deployment. It
 * exists so a private instance behind a key does not need a code change.
 */
export function upstreamAuthHeaders(): Record<string, string> {
  const key = process.env.GHOSTWRITER_API_KEY?.trim()
  return key ? { Authorization: `Bearer ${key}` } : {}
}

/** Uploads larger than this are rejected before we spend a round trip on them. */
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024

/**
 * Pulls the most useful message out of an upstream error body.
 *
 * FastAPI reports two shapes on the same field: `detail` is a string for the
 * documented 400s ("Provide either 'draft' text or a 'file' upload") and an
 * array of ValidationError objects for 422s. Showing "[object Object]" to the
 * user because of that difference is not acceptable, so both are flattened.
 */
export function describeUpstreamError(body: unknown, status: number): string {
  const fallback = `The rewriter rejected the request (${status}).`
  if (!body || typeof body !== 'object') {
    return typeof body === 'string' && body.trim() ? body.trim().slice(0, 500) : fallback
  }

  const detail = (body as { detail?: unknown }).detail
  if (typeof detail === 'string' && detail.trim()) return detail.trim().slice(0, 500)

  if (Array.isArray(detail)) {
    const messages = detail
      .map(entry => {
        if (!entry || typeof entry !== 'object') return ''
        const { loc, msg } = entry as { loc?: unknown; msg?: unknown }
        if (typeof msg !== 'string') return ''
        // `loc` is ["body", "file"] — the trailing element names the field.
        const field = Array.isArray(loc) && loc.length ? String(loc[loc.length - 1]) : ''
        return field ? `${field}: ${msg}` : msg
      })
      .filter(Boolean)
    if (messages.length) return messages.join('; ').slice(0, 500)
  }

  return fallback
}

/** Wraps a fetch failure so the client sees why the rewriter was unreachable. */
export function unreachable(err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err)
  const timedOut = /abort|timeout/i.test(message)
  return Response.json(
    {
      error: timedOut
        ? 'The rewriting service did not respond in time.'
        : `Could not reach the rewriting service: ${message}`,
    },
    { status: 502 }
  )
}
