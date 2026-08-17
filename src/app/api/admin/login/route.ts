/**
 * Admin sign-in / sign-out / session probe.
 *
 *   GET    -> { signedIn, email?, configured, missing[] }
 *   POST   -> exchange credentials for the session cookie
 *   DELETE -> sign out
 *
 * GET exists so the dashboard can render the right screen on load without a
 * failed request in the console, and so the login form can say "ADMIN_PASSWORD
 * is not set on this deployment" instead of "invalid credentials" when the
 * cause is configuration rather than a typo.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  adminConfig,
  clearSessionCookie,
  currentAdmin,
  issueSession,
  setSessionCookie,
  verifyCredentials,
} from '../../../../utils/adminAuth'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const session = currentAdmin(req)
  const config = adminConfig()

  return NextResponse.json({
    signedIn: Boolean(session),
    email: session?.email ?? null,
    configured: config.configured,
    missing: config.missing,
  })
}

export async function POST(req: NextRequest) {
  const config = adminConfig()
  if (!config.configured) {
    return NextResponse.json(
      {
        error: `The admin dashboard is not configured on this deployment. Set ${config.missing.join(
          ' and '
        )} in .env.local and restart.`,
      },
      { status: 503 }
    )
  }

  let body: { email?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 })
  }

  const email = verifyCredentials(body.email ?? '', body.password ?? '')
  if (!email) {
    // One message for both a wrong email and a wrong password: telling an
    // attacker which half they got right halves the work.
    return NextResponse.json({ error: 'Those credentials were not accepted.' }, { status: 401 })
  }

  const token = issueSession(email)
  if (!token) {
    return NextResponse.json(
      { error: 'Could not sign the admin session. Set ADMIN_SESSION_SECRET and restart.' },
      { status: 500 }
    )
  }

  return setSessionCookie(NextResponse.json({ signedIn: true, email }), token)
}

export async function DELETE() {
  return clearSessionCookie(NextResponse.json({ signedIn: false }))
}
