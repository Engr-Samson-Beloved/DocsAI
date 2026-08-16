/**
 * Webhook authenticity.
 *
 * Copyleaks calls our completion URL from its own servers with no signature and
 * no shared credential — the documented mechanism is that the callback URL is
 * itself the secret. A guessable URL would let anyone POST a fabricated 0%
 * similarity result into someone else's report, so the URL carries a token
 * derived from the check id under a server-side secret.
 *
 * HMAC rather than a stored random token: it needs no extra column, survives a
 * restart, and cannot be enumerated from the check id alone. Comparison is
 * constant-time, because a timing oracle on a 64-hex-character token is a real
 * way to forge one given enough attempts.
 *
 * If INTEGRITY_WEBHOOK_SECRET is unset the tokens are still generated from a
 * process-lifetime random secret. That keeps a local dev install working while
 * making it obvious in the logs that callbacks will not survive a restart.
 */

import crypto from 'crypto'

let ephemeralSecret: string | null = null

function secret(): string {
  const configured = process.env.INTEGRITY_WEBHOOK_SECRET?.trim()
  if (configured) return configured

  if (!ephemeralSecret) {
    ephemeralSecret = crypto.randomBytes(32).toString('hex')
    console.warn(
      'INTEGRITY_WEBHOOK_SECRET is not set. Similarity callbacks are signed with a ' +
        'process-lifetime secret and will be rejected after a restart.'
    )
  }
  return ephemeralSecret
}

export function webhookToken(checkId: string): string {
  return crypto.createHmac('sha256', secret()).update(checkId).digest('hex')
}

export function verifyWebhookToken(checkId: string, presented: string): boolean {
  const expected = webhookToken(checkId)
  const a = Buffer.from(expected, 'utf-8')
  const b = Buffer.from(presented || '', 'utf-8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/**
 * The absolute callback URL handed to the provider, or null when this
 * deployment has no publicly reachable address.
 *
 * A localhost URL is treated as no URL at all: submitting it would have the
 * provider retry a scan against an unreachable host and the user would wait
 * fifteen minutes for a result that can never arrive. Better to report
 * similarity as unavailable up front (§22).
 */
export function callbackUrlFor(checkId: string): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, '')
  if (!base) return null

  let host: string
  try {
    host = new URL(base).hostname
  } catch {
    return null
  }

  const isLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local')

  if (isLocal) return null

  // {STATUS} is substituted by Copyleaks with `completed` or `error`.
  return `${base}/api/integrity/webhook/${encodeURIComponent(checkId)}?token=${webhookToken(checkId)}&status={STATUS}`
}
