/**
 * A local record of a granted plan, for when the cloud write cannot land.
 *
 * WHY THIS EXISTS
 *
 * `subscriptions` is protected by row-level security, and both payment paths —
 * the Korapay redirect and the Korapay webhook — arrive with no user session
 * attached. Without SUPABASE_SERVICE_ROLE_KEY the anon key is rejected, and a
 * payment that Korapay has confirmed would leave the payer on the free tier
 * holding a receipt. That is the worst failure this app can have: money taken,
 * nothing given.
 *
 * So a grant that cannot reach Supabase is written here instead, and
 * `service.ts:loadSubscription` reads it as a fallback. The payer gets what they
 * paid for either way.
 *
 * WHAT THIS IS NOT
 *
 * It is not a replacement for the cloud row, and it is not a second source of
 * truth to be reconciled: the cloud row always wins when one exists. This is a
 * safety net under one specific failure, deliberately append-only and
 * latest-wins so a retry or a webhook arriving after the redirect cannot
 * corrupt it.
 *
 * LIMITS, STATED PLAINLY
 *
 * On a serverless host the filesystem is read-only and ephemeral, so this net
 * has holes there — the write fails and the caller still reports the failure
 * loudly. The real fix on such a deployment is SUPABASE_SERVICE_ROLE_KEY, which
 * is why the failure message names it. This is the same tradeoff
 * `utils/integrity/store.ts` already makes.
 *
 * Server-only. Nothing here may be imported by a client component: it decides
 * what a user is entitled to, and a browser must not be able to write it.
 */

import fs from 'fs'
import path from 'path'
import type { PlanTier } from '../plans'

const DATA_DIR = path.join(process.cwd(), 'data')
const ENTITLEMENT_DIR = path.join(DATA_DIR, 'entitlements')
const GRANTS_FILE = path.join(ENTITLEMENT_DIR, 'grants.jsonl')

export interface StoredGrant {
  email: string
  planTier: PlanTier
  amount: number
  korapayReference: string | null
  cycleStartedAt: string
  expirationDate: string
  /** Set when an admin comped the plan rather than it being paid for. */
  grantedBy?: string | null
  createdAt: number
}

function ensureDir(): boolean {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    if (!fs.existsSync(ENTITLEMENT_DIR)) fs.mkdirSync(ENTITLEMENT_DIR, { recursive: true })
    return true
  } catch (e) {
    console.warn('Local grant storage is unavailable (read-only filesystem?):', e)
    return false
  }
}

/** Files a grant locally. Returns whether it actually landed. */
export function recordGrant(grant: StoredGrant): boolean {
  if (!ensureDir()) return false
  try {
    fs.appendFileSync(GRANTS_FILE, `${JSON.stringify(grant)}\n`, 'utf-8')
    return true
  } catch (e) {
    console.warn('Could not write the local grant record:', e)
    return false
  }
}

function readGrants(): StoredGrant[] {
  try {
    if (!fs.existsSync(GRANTS_FILE)) return []
    return fs
      .readFileSync(GRANTS_FILE, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .flatMap(line => {
        try {
          return [JSON.parse(line) as StoredGrant]
        } catch {
          // A truncated final line from an interrupted append is not a reason
          // to lose everyone else's grant.
          return []
        }
      })
  } catch (e) {
    console.warn('Could not read local grant records:', e)
    return []
  }
}

/**
 * The newest grant for this address, or null.
 *
 * Expiry is NOT applied here — the caller decides what a lapsed grant means,
 * exactly as it does for a cloud row, so both paths age the same way.
 */
export function findGrant(email: string | null | undefined): StoredGrant | null {
  if (!email) return null
  const wanted = email.trim().toLowerCase()

  let newest: StoredGrant | null = null
  for (const grant of readGrants()) {
    if ((grant.email ?? '').toLowerCase() !== wanted) continue
    if (!newest || grant.createdAt > newest.createdAt) newest = grant
  }
  return newest
}

/** Every locally-granted account, newest grant per address. For the admin list. */
export function listGrants(): StoredGrant[] {
  const byEmail = new Map<string, StoredGrant>()
  for (const grant of readGrants()) {
    const email = (grant.email ?? '').toLowerCase()
    if (!email) continue
    const existing = byEmail.get(email)
    if (!existing || grant.createdAt > existing.createdAt) byEmail.set(email, grant)
  }
  return Array.from(byEmail.values()).sort((a, b) => b.createdAt - a.createdAt)
}
