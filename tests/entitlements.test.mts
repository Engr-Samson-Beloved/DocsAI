/**
 * Plans, quotas and the paywall.
 *
 * This is billing logic: a bug here either gives away paid work or charges
 * someone for a generation that never happened, and neither shows up as a
 * crash. So the pricing ladder, the window keys and the metering points are all
 * pinned.
 *
 * Two kinds of test, following integrity-security.test.mts.
 *
 * Behavioural: the plan catalogue and the period-key derivation are pure and
 * are exercised directly.
 *
 * Structural: the route handlers pull in `next/server`, whose request context
 * does not exist outside a running Next server, so the guarantees they uphold —
 * that every money-spending route is gated, and that the charge lands after the
 * work rather than before it — are asserted against their source text.
 *
 * Run: npm test
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8')

const plans = () => import('../src/utils/plans.ts')
const period = () => import('../src/utils/entitlements/period.ts')

describe('plan catalogue', () => {
  it('prices the three paid tiers at 15k / 30k / 50k', async () => {
    const { PLANS } = await plans()

    assert.equal(PLANS.free.amount, 0)
    assert.equal(PLANS.basic.amount, 15_000)
    assert.equal(PLANS.pro.amount, 30_000)
    assert.equal(PLANS.enterprise.amount, 50_000)
  })

  it('gives the base plan exactly what the pricing promises', async () => {
    const { PLANS } = await plans()

    assert.deepEqual(PLANS.basic.quotas, {
      report: 2,
      humanize: 2,
      powerpoint: 4,
      integrity: 3,
      assist: 100,
    })
  })

  it('doubles the base plan at 30k and triples it at 50k', async () => {
    const { PLANS } = await plans()

    // Every metered feature scales on the same ladder — a tier that quietly
    // failed to double one of them would be a silently worse deal.
    for (const feature of ['report', 'humanize', 'powerpoint', 'assist'] as const) {
      assert.equal(
        PLANS.pro.quotas[feature],
        PLANS.basic.quotas[feature] * 2,
        `pro should be double base for ${feature}`
      )
      assert.equal(
        PLANS.enterprise.quotas[feature],
        PLANS.basic.quotas[feature] * 3,
        `enterprise should be triple base for ${feature}`
      )
    }
  })

  it('gives free accounts formatting and one integrity check, and no generation', async () => {
    const { PLANS } = await plans()

    assert.equal(PLANS.free.quotas.report, 0, 'free must not generate reports')
    assert.equal(PLANS.free.quotas.humanize, 0, 'free must not humanize')
    assert.equal(PLANS.free.quotas.powerpoint, 0, 'free must not generate decks')
    assert.equal(PLANS.free.quotas.assist, 0, 'free must not prompt the model at all')

    // The one deliberate exception: a taste of AI detection is what sells a plan.
    assert.equal(PLANS.free.quotas.integrity, 1)
  })

  it('never grants a tier above what was actually paid', async () => {
    const { tierForAmount } = await plans()

    assert.equal(tierForAmount(0), 'free')
    assert.equal(tierForAmount(14_999), 'free', 'an underpayment must not buy the base plan')
    assert.equal(tierForAmount(15_000), 'basic')
    assert.equal(tierForAmount(29_999), 'basic')
    assert.equal(tierForAmount(30_000), 'pro')
    assert.equal(tierForAmount(49_999), 'pro')
    assert.equal(tierForAmount(50_000), 'enterprise')
    assert.equal(tierForAmount(500_000), 'enterprise')
  })
})

describe('quota windows', () => {
  it('opens a fresh cycle for every payment', async () => {
    const { cycleKey } = await period()

    const first = cycleKey({ status: 'active', email: 'a@b.com', korapayReference: 'REF_1' })
    const second = cycleKey({ status: 'active', email: 'a@b.com', korapayReference: 'REF_2' })

    // This is the whole renewal mechanism: a new payment produces a new key, so
    // no previously-spent usage row matches and the allowance is back in full.
    assert.notEqual(first, second)
    assert.match(first, /^sub:/)
  })

  it('keys an admin grant on its cycle start, since it has no payment', async () => {
    const { cycleKey } = await period()

    const key = cycleKey({
      status: 'active',
      email: 'a@b.com',
      korapayReference: null,
      cycleStartedAt: '2026-08-01T00:00:00.000Z',
    })

    assert.match(key, /^sub:a@b\.com:2026-08-01/)
  })

  it('counts a free account against the calendar month', async () => {
    const { cycleKey } = await period()

    const august = cycleKey({ status: 'free', email: 'a@b.com' }, Date.parse('2026-08-17T10:00:00Z'))
    const september = cycleKey({ status: 'free', email: 'a@b.com' }, Date.parse('2026-09-01T10:00:00Z'))

    // A free integrity check per MONTH, not one ever, and not one per day.
    assert.equal(august, 'month:2026-08')
    assert.notEqual(august, september)
  })

  it('treats an expired subscription as a free account', async () => {
    const { cycleKey } = await period()

    // The reference is still on the row after the cycle lapses; honouring it
    // would keep handing back the paid allowance forever.
    const key = cycleKey(
      { status: 'expired', email: 'a@b.com', korapayReference: 'REF_1' },
      Date.parse('2026-08-17T10:00:00Z')
    )
    assert.equal(key, 'month:2026-08')
  })

  it('resets the in-editor allowance daily, in UTC', async () => {
    const { periodKeyFor } = await period()
    const source = { status: 'active' as const, email: 'a@b.com', korapayReference: 'REF_1' }

    const morning = periodKeyFor('assist', source, Date.parse('2026-08-17T01:00:00Z'))
    const night = periodKeyFor('assist', source, Date.parse('2026-08-17T23:00:00Z'))
    const tomorrow = periodKeyFor('assist', source, Date.parse('2026-08-18T01:00:00Z'))

    assert.equal(morning, 'day:2026-08-17')
    assert.equal(night, morning, 'the same UTC day is one allowance')
    assert.notEqual(tomorrow, morning)

    // The per-cycle features must not follow the daily key.
    assert.match(periodKeyFor('report', source), /^sub:/)
  })
})

describe('the paywall is server-side', () => {
  it('gates every route that can spend money at a provider', () => {
    const metered: [string, string][] = [
      ['src/app/api/generate/route.ts', 'requireFeature'],
      ['src/app/api/humanize/route.ts', 'requireFeature'],
      ['src/app/api/integrity/check/route.ts', 'checkFeature'],
      // Gated but not metered: the chat router supports a charge made elsewhere.
      ['src/app/api/plan/route.ts', 'requireAiAccess'],
    ]

    for (const [file, guard] of metered) {
      assert.ok(
        read(file).includes(guard),
        `${file} spends provider credit and must call ${guard} before it does`
      )
    }
  })

  it('charges only after the work succeeded', () => {
    // A generation that produced nothing must not cost one of two monthly
    // reports. The flag is what makes that true, so it is pinned here.
    const generate = read('src/app/api/generate/route.ts')
    assert.match(generate, /deliveredText\s*=\s*true/, 'the charge flag must be set when text is sent')
    assert.match(generate, /if \(deliveredText\)/, 'the commit must be conditional on delivery')

    // The integrity route must not charge for a cache hit: re-reading an
    // unchanged document spends no provider credit.
    const integrity = read('src/app/api/integrity/check/route.ts')
    const cacheReturn = integrity.indexOf('cached: true')
    const quotaCheck = integrity.indexOf('await checkFeature(')
    assert.ok(cacheReturn > -1 && quotaCheck > -1)
    assert.ok(quotaCheck > cacheReturn, 'the cache hit must return before any credit is checked')
  })

  it('derives the purchased tier from the settled amount, never from the caller', () => {
    for (const file of ['src/app/api/pay/verify/route.ts', 'src/app/api/pay/webhook/route.ts']) {
      const source = read(file)
      assert.ok(
        source.includes('tierForAmount'),
        `${file} must price the grant from what Korapay settled`
      )
      assert.ok(
        !/plan_tier\s*\|\|/.test(source),
        `${file} must not fall back to a caller-supplied plan_tier`
      )
    }
  })

  it('no longer meters anything in localStorage', () => {
    const subscription = read('src/utils/subscription.ts')

    // The old paywall counted generations in localStorage, so clearing site
    // data reset it. Nothing may count there again.
    assert.ok(!subscription.includes('incrementDailyUsage'))
    assert.ok(!subscription.includes('docuai_daily_usage'))
  })

  it('keeps the entitlement service off the browser', () => {
    for (const file of [
      'src/utils/entitlements/service.ts',
      'src/utils/entitlements/store.ts',
      'src/utils/adminAuth.ts',
      'src/utils/adminData.ts',
    ]) {
      const source = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').trim()
      assert.ok(!/^(['"])use client\1/.test(source), `${file} must not be a client module`)
    }
  })
})

describe('owner accounts', () => {
  it('recognises the configured owner addresses', async () => {
    const previous = process.env.OWNER_EMAILS
    process.env.OWNER_EMAILS = 'Owner@Example.com, second@example.com'

    try {
      const { isOwnerEmail, ownerEmails } = await plans()

      assert.deepEqual(ownerEmails(), ['owner@example.com', 'second@example.com'])
      assert.equal(isOwnerEmail('owner@example.com'), true)
      assert.equal(isOwnerEmail('OWNER@EXAMPLE.COM'), true, 'matching is case-insensitive')
      assert.equal(isOwnerEmail('  owner@example.com  '), true, 'and whitespace-insensitive')
      assert.equal(isOwnerEmail('someone@example.com'), false)
      assert.equal(isOwnerEmail(null), false)
      assert.equal(isOwnerEmail(''), false)
    } finally {
      process.env.OWNER_EMAILS = previous
    }
  })

  it('falls back to the admin address when no owner list is set', async () => {
    const previousOwner = process.env.OWNER_EMAILS
    const previousAdmin = process.env.ADMIN_EMAIL
    process.env.OWNER_EMAILS = ''
    process.env.ADMIN_EMAIL = 'boss@example.com'

    try {
      const { ownerEmails } = await plans()
      assert.deepEqual(ownerEmails(), ['boss@example.com'])
    } finally {
      process.env.OWNER_EMAILS = previousOwner
      process.env.ADMIN_EMAIL = previousAdmin
    }
  })

  it('only trusts a verified session for owner access', () => {
    const source = read('src/utils/entitlements/service.ts')

    // The security property this whole feature rests on. `emailForOwner` will
    // return the address out of a self-asserted `local:` token, so unlimited
    // access must be gated on the ownerKey being a verified `user:` identity —
    // otherwise anyone can mint local-token-<base64 of the owner address>.
    const guard = source.slice(
      source.indexOf('export function isOwnerRequest'),
      source.indexOf('export async function loadSubscription')
    )

    assert.ok(guard.length > 0, 'isOwnerRequest must exist')
    assert.match(guard, /startsWith\('user:'\)/, 'owner access requires a verified Supabase session')
    assert.ok(
      !guard.includes('emailForOwner'),
      'isOwnerRequest must not read the email out of a self-asserted local token'
    )
    assert.match(guard, /owner\.user\?\.email/, 'the address must come from the verified session')
  })

  it('never gates an owner in the quota check', () => {
    const source = read('src/utils/entitlements/service.ts')
    assert.match(
      source,
      /!snapshot\.owner &&/,
      'checkFeature must short-circuit before the remaining-credits arithmetic'
    )
  })

  it('keeps the owner list off the browser bundle', () => {
    const source = read('src/utils/plans.ts')
    // NEXT_PUBLIC_ would ship the owner addresses to every visitor and let a
    // client decide it was one.
    assert.ok(!source.includes('NEXT_PUBLIC_OWNER'), 'owner config must stay server-side')
    assert.ok(!source.includes('NEXT_PUBLIC_ADMIN'), 'admin config must stay server-side')
  })
})

describe('a confirmed payment always grants something', () => {
  it('falls back to the local store when the cloud write is refused', () => {
    const source = read('src/utils/subscriptionWrite.ts')

    // Money taken with nothing given is the worst failure this app has, so a
    // refused cloud write must not be the end of the road.
    assert.match(source, /fallbackToDisk/, 'a refused cloud write must fall back to disk')
    assert.match(source, /'cloud' \| 'local' \| 'failed'/, 'the outcome must be reported precisely')
  })

  it('reads that fallback back when resolving entitlements', () => {
    const source = read('src/utils/entitlements/service.ts')

    // Granting to the fallback is pointless if nothing reads it: the payer
    // would still resolve to the free tier on the very next request.
    assert.match(source, /findGrant/, 'loadSubscription must consult the local grant store')
    assert.match(
      source,
      /if \(error \|\| !data\) return localRecord\(email\)/,
      'a missing cloud row must fall through to the local grant'
    )
  })

  it('only reports failure when nothing landed at all', () => {
    const verify = read('src/app/api/pay/verify/route.ts')
    assert.match(verify, /outcome === 'failed'/, 'success must not depend on the cloud write alone')
    assert.match(verify, /PAYMENT TAKEN BUT NOT GRANTED/, 'a total failure must still be loud')
  })
})

describe('admin surface', () => {
  it('has no built-in credentials to fall back to', () => {
    const source = read('src/utils/adminAuth.ts')

    // A documented default password on an admin surface is a backdoor. The
    // dashboard must refuse every login when the env vars are absent.
    assert.ok(!/ADMIN_PASSWORD\s*\|\|\s*['"]/.test(source), 'no default admin password')
    assert.ok(!/ADMIN_EMAIL\s*\|\|\s*['"]/.test(source), 'no default admin email')
    assert.match(source, /timingSafeEqual/, 'credentials must be compared in constant time')
  })

  it('checks the session on every admin route', () => {
    for (const file of [
      'src/app/api/admin/overview/route.ts',
      'src/app/api/admin/users/route.ts',
      'src/app/api/admin/failures/route.ts',
      'src/app/api/admin/usage/route.ts',
    ]) {
      assert.match(read(file), /requireAdmin\(req\)/, `${file} must guard every handler`)
    }
  })

  it('marks a comped account so it never counts as revenue', () => {
    const source = read('src/utils/adminData.ts')
    assert.match(source, /granted_by/, 'an admin grant must be stamped')
    assert.match(source, /grantedBy\) compedAccounts/, 'comped accounts are excluded from revenue')
  })
})
