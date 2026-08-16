/**
 * Who a request belongs to.
 *
 * Lifted verbatim out of `src/app/api/projects/route.ts`, where it was a
 * private helper, because the Integrity Checker has to answer exactly the same
 * question and §20 makes getting it wrong a security bug rather than a
 * cosmetic one. A second implementation would drift from this one, and the
 * drift would show up as one route trusting a caller the other rejects.
 *
 * Three identities exist, in the app's own order of trust:
 *
 *   `user:<uuid>`   a verified Supabase account
 *   `local:<email>` an offline session, minted when no Supabase project is
 *                   configured at all. Self-asserted — the token carries the
 *                   email in its own body — so it is an identity for
 *                   partitioning storage, not an authentication claim.
 *   `guest`         no usable credential
 *
 * `unauthorized` is distinct from `guest`: it means a Supabase token was
 * presented and rejected. That must 401 rather than silently degrade to guest,
 * or an expired session would quietly start reading a different user's shelf.
 */

import type { NextRequest } from 'next/server'
import { getSupabaseClient } from './supabase'

export interface RequestOwner {
  ownerKey: string
  supabase: ReturnType<typeof getSupabaseClient>
  token?: string
  user: { id: string; email?: string } | null
  unauthorized: boolean
}

export function getBearerToken(req: NextRequest | Request): string | undefined {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return undefined
  const parts = authHeader.split(' ')
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1]
  }
  return undefined
}

export async function resolveOwner(req: NextRequest | Request): Promise<RequestOwner> {
  const token = getBearerToken(req)
  const supabase = getSupabaseClient(token)

  // Offline/local sessions carry their identity in the token itself
  if (token && token.startsWith('local-token-')) {
    const encoded = token.split('-').slice(3).join('-')
    try {
      const email = Buffer.from(encoded, 'base64').toString('utf-8').trim().toLowerCase()
      if (email) {
        return { ownerKey: `local:${email}`, supabase: null, token, user: null, unauthorized: false }
      }
    } catch {
      // fall through to guest
    }
    return { ownerKey: 'guest', supabase: null, token, user: null, unauthorized: false }
  }

  if (supabase && token) {
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) {
      return { ownerKey: 'guest', supabase, token, user: null, unauthorized: true }
    }
    return {
      ownerKey: `user:${user.id}`,
      supabase,
      token,
      user: { id: user.id, email: user.email },
      unauthorized: false
    }
  }

  return { ownerKey: 'guest', supabase, token, user: null, unauthorized: false }
}

/**
 * Whether this caller may touch a record stamped with `recordOwner`.
 *
 * A guest owns nothing that another guest can then read: two signed-out
 * browsers both resolve to `guest`, so guest-owned integrity checks are
 * readable by any guest on the same install. That is acceptable for the
 * on-disk single-machine fallback and is why the cloud path requires a real
 * account, but it must not be mistaken for isolation — hence the explicit
 * check here rather than a bare string compare scattered across routes.
 */
export function ownsRecord(caller: RequestOwner, recordOwner: string): boolean {
  if (caller.unauthorized) return false
  return caller.ownerKey === recordOwner
}
