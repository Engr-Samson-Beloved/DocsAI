/**
 * Admin session handling.
 *
 * Deliberately small. The admin dashboard is a single operator surface, not a
 * second user system, so it has no table, no roles and no password reset: one
 * credential pair read from the environment, exchanged for a signed cookie.
 * Adding a users-and-roles model here would be more machinery than the job
 * needs and one more place for an authorisation bug to live.
 *
 * The cookie is an HMAC over `{email, exp}` — a stateless session, so restarting
 * the server does not sign everyone out and there is no session store to
 * expire. It is httpOnly, sameSite=lax and (in production) secure, so a page
 * script cannot read it and it does not ride along on cross-site requests.
 *
 * Configure with, in `.env.local`:
 *
 *   ADMIN_EMAIL=godisovergods@gmail.com
 *   ADMIN_PASSWORD=...
 *   ADMIN_SESSION_SECRET=$(openssl rand -hex 32)
 *
 * With ADMIN_EMAIL or ADMIN_PASSWORD unset the dashboard refuses every login
 * rather than falling back to a default — a built-in default password on an
 * admin surface is a backdoor, whatever it is documented as.
 */

import crypto from 'crypto'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

export const ADMIN_COOKIE = 'wordpi_admin'

/** How long a signed-in admin stays signed in. */
const SESSION_TTL_MS = 8 * 60 * 60 * 1000

export interface AdminConfigState {
  configured: boolean
  /** What is missing, for the login screen to explain rather than just fail. */
  missing: string[]
}

export function adminConfig(): AdminConfigState {
  const missing: string[] = []
  if (!process.env.ADMIN_EMAIL) missing.push('ADMIN_EMAIL')
  if (!process.env.ADMIN_PASSWORD) missing.push('ADMIN_PASSWORD')
  return { configured: missing.length === 0, missing }
}

/**
 * The key the session cookie is signed with.
 *
 * Falls back to deriving one from the admin password so a install that only set
 * the two required variables still gets signed sessions. That is weaker than a
 * dedicated random secret — rotating the password invalidates every session,
 * which is arguably correct anyway — so ADMIN_SESSION_SECRET is preferred and
 * documented in .env.example.
 */
function sessionSecret(): string | null {
  const explicit = process.env.ADMIN_SESSION_SECRET
  if (explicit && explicit.trim()) return explicit.trim()

  const password = process.env.ADMIN_PASSWORD
  if (!password) return null
  return crypto.createHash('sha256').update(`wordpi-admin:${password}`).digest('hex')
}

/** Constant-time string comparison that tolerates length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  // timingSafeEqual throws on unequal lengths, which would itself leak the
  // length, so both sides are hashed to a fixed width first.
  const leftHash = crypto.createHash('sha256').update(left).digest()
  const rightHash = crypto.createHash('sha256').update(right).digest()
  return crypto.timingSafeEqual(leftHash, rightHash)
}

/** Verifies a login attempt. Returns the admin email, or null. */
export function verifyCredentials(email: string, password: string): string | null {
  const expectedEmail = process.env.ADMIN_EMAIL
  const expectedPassword = process.env.ADMIN_PASSWORD

  if (!expectedEmail || !expectedPassword) return null
  if (!email || !password) return null

  const emailOk = safeEqual(email.trim().toLowerCase(), expectedEmail.trim().toLowerCase())
  const passwordOk = safeEqual(password, expectedPassword)

  // Both are always evaluated so a wrong email and a wrong password take the
  // same time to reject.
  return emailOk && passwordOk ? expectedEmail.trim().toLowerCase() : null
}

function sign(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url')
}

export function issueSession(email: string): string | null {
  const secret = sessionSecret()
  if (!secret) return null

  const payload = Buffer.from(
    JSON.stringify({ email, exp: Date.now() + SESSION_TTL_MS }),
    'utf8'
  ).toString('base64url')

  return `${payload}.${sign(payload, secret)}`
}

export interface AdminSession {
  email: string
  exp: number
}

export function readSession(token: string | undefined | null): AdminSession | null {
  if (!token) return null

  const secret = sessionSecret()
  if (!secret) return null

  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null

  const expected = sign(payload, secret)
  if (!safeEqual(signature, expected)) return null

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (typeof parsed?.exp !== 'number' || parsed.exp < Date.now()) return null
    if (typeof parsed?.email !== 'string') return null
    return { email: parsed.email, exp: parsed.exp }
  } catch {
    return null
  }
}

/** The session on this request, or null. */
export function currentAdmin(req: NextRequest): AdminSession | null {
  return readSession(req.cookies.get(ADMIN_COOKIE)?.value)
}

/**
 * Guard for every admin route.
 *
 * Returns a 401 response to return directly, or null when the caller is a
 * signed-in admin. Written to be impossible to use wrongly by accident: a route
 * that forgets to check the return value still does not get a session object.
 */
export function requireAdmin(req: NextRequest): { session: AdminSession } | { response: NextResponse } {
  const session = currentAdmin(req)
  if (!session) {
    return {
      response: NextResponse.json({ error: 'Admin sign-in required.' }, { status: 401 }),
    }
  }
  return { session }
}

export function setSessionCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  })
  return response
}

export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set(ADMIN_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
  return response
}
