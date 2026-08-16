/**
 * Copyleaks similarity completion callback.
 *
 *   POST /api/integrity/webhook/:id?token=...&status=completed
 *
 * This is the one route in the feature that is not called by our own client, so
 * it is the one with no session to authorise against. It is protected by the
 * HMAC token in the query string (see ../webhookToken.ts): without it, anyone
 * who guessed a check id could post a fabricated similarity result into another
 * user's report.
 *
 * It always answers 200, even when it rejects the payload. Copyleaks retries
 * non-2xx responses, and there is nothing to gain from having it retry a
 * callback we have deliberately refused — the retries would just repeat until
 * the provider gave up.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdminClient } from '../../../../../utils/supabaseAdmin'
import { applyPlagiarismWebhook } from '../../../../../utils/integrity/runner'
import { verifyWebhookToken } from '../../webhookToken'

export const runtime = 'nodejs'
export const maxDuration = 60

/** Accepted, ignored. The provider does not need to know why. */
const ACK = NextResponse.json({ received: true })

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { searchParams } = new URL(req.url)

  if (!verifyWebhookToken(id, searchParams.get('token') || '')) {
    // Logged without the presented token: it is attacker-controlled input and
    // does not belong in a log line that may be shipped somewhere.
    console.warn(`Rejected an integrity webhook for ${id}: bad token.`)
    return ACK
  }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    console.warn(`Rejected an integrity webhook for ${id}: unreadable body.`)
    return ACK
  }

  // Written with the service key: this request carries no user session, so the
  // anon client cannot satisfy the row-level security policy on the table.
  // Falls back to the on-disk store when no service key is configured.
  const supabase = getSupabaseAdminClient()

  try {
    const check = await applyPlagiarismWebhook(id, 'copyleaks', payload, supabase)
    if (!check) {
      console.warn(`Integrity webhook for ${id} did not match an outstanding scan.`)
    }
  } catch (error) {
    // Never surface the failure to the provider: the check is recoverable by
    // the reaper in runner.ts, and a 500 here only buys us retries.
    console.error(`Integrity webhook processing failed for ${id}:`, error)
  }

  return ACK
}
