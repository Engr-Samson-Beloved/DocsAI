/**
 * Security and privacy (§20, §27).
 *
 * Two kinds of test here.
 *
 * Behavioural: ownership resolution, the path-traversal guard on check ids,
 * and webhook token verification are all exercised directly.
 *
 * Structural: the route handlers themselves cannot be imported — they pull in
 * `next/server`, whose request context does not exist outside a running Next
 * server — so the guarantees those routes must uphold are asserted against
 * their source text. That is the same technique house-style.test.mts already
 * uses on Editor.tsx. It is weaker than executing the handler, and it is
 * deliberately written to fail loudly if someone deletes an ownership check.
 *
 * Run: npm test
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8')

/**
 * Whether a module is a client module.
 *
 * Has to look for the directive where the bundler looks for it — as the first
 * statement — rather than anywhere in the text. Several server-only modules
 * discuss `"use client"` in their comments precisely to explain why they are
 * not client modules, and a naive substring search flags exactly those files.
 */
function isClientModule(source: string): boolean {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .trim()
  return /^(['"])use client\1/.test(withoutComments)
}

const owner = () => import('../src/utils/owner.ts')
const webhookToken = () => import('../src/app/api/integrity/webhookToken.ts')

const ROUTES = [
  'src/app/api/integrity/check/route.ts',
  'src/app/api/integrity/check/[id]/route.ts',
  'src/app/api/integrity/check/[id]/status/route.ts',
  'src/app/api/integrity/check/[id]/report/route.ts',
]

/* ── ownership ───────────────────────────────────────────────────── */

describe('ownership resolution', () => {
  it('rejects a caller whose token was refused, rather than degrading to guest', async () => {
    const { ownsRecord } = await owner()

    const rejected = {
      ownerKey: 'guest',
      supabase: null,
      user: null,
      unauthorized: true,
    }

    // An expired session must not quietly start reading the guest shelf.
    assert.equal(ownsRecord(rejected as never, 'guest'), false)
    assert.equal(ownsRecord(rejected as never, 'user:someone'), false)
  })

  it('does not let one user read another user’s record', async () => {
    const { ownsRecord } = await owner()

    const alice = { ownerKey: 'user:alice', supabase: null, user: null, unauthorized: false }

    assert.equal(ownsRecord(alice as never, 'user:alice'), true)
    assert.equal(ownsRecord(alice as never, 'user:bob'), false)
    assert.equal(ownsRecord(alice as never, 'local:bob@example.com'), false)
    assert.equal(ownsRecord(alice as never, 'guest'), false)
  })

  it('derives a stable owner key from an offline session token', async () => {
    const { resolveOwner } = await owner()

    const email = 'student@example.edu'
    const token = `local-token-${Date.now()}-${Buffer.from(email).toString('base64')}`
    const request = new Request('https://example.com/api/integrity/check', {
      headers: { Authorization: `Bearer ${token}` },
    })

    const resolved = await resolveOwner(request)

    assert.equal(resolved.ownerKey, `local:${email}`)
    assert.equal(resolved.unauthorized, false)
  })

  it('falls back to guest for a request with no credential', async () => {
    const { resolveOwner } = await owner()

    const resolved = await resolveOwner(new Request('https://example.com/api/integrity/check'))

    assert.equal(resolved.ownerKey, 'guest')
    assert.equal(resolved.unauthorized, false)
  })
})

/* ── every route authorises ──────────────────────────────────────── */

describe('integrity routes authorise every request', () => {
  for (const route of ROUTES) {
    it(`${route} resolves the caller and rejects an invalid session`, () => {
      const source = read(route)

      assert.match(source, /resolveOwner\(/, 'the route must identify its caller')
      assert.match(
        source,
        /unauthorized[\s\S]{0,120}401/,
        'a refused token must produce a 401, not a degraded read'
      )
    })
  }

  for (const route of ROUTES.filter(r => r.includes('[id]'))) {
    it(`${route} verifies ownership of the record it serves`, () => {
      const source = read(route)

      assert.match(source, /ownsRecord\(/, 'per-record routes must check ownership')
      // A 403 would confirm the id exists. 404 for both cases keeps the route
      // from being used to probe for real check ids.
      assert.match(source, /404/, 'a foreign record must be indistinguishable from a missing one')
      assert.ok(
        !/\b403\b/.test(source),
        'answering 403 would leak that the record exists'
      )
    })
  }

  it('the report route serves bytes only through an authorised handler', () => {
    const source = read('src/app/api/integrity/check/[id]/report/route.ts')

    assert.match(source, /ownsRecord\(/)
    assert.match(source, /Cache-Control[\s\S]{0,40}(private|no-store)/, 'a shared cache must not retain a report')
    assert.match(source, /application\/pdf/)
  })
})

/* ── path traversal ──────────────────────────────────────────────── */

describe('check ids cannot escape the storage directory', () => {
  it('rejects traversal and absolute paths before touching the filesystem', () => {
    // safeId is private to store.ts; this is the pattern it enforces.
    const SAFE = /^[A-Za-z0-9_-]{6,64}$/

    for (const hostile of [
      '../../../../etc/passwd',
      '..\\..\\windows\\system32',
      '/etc/shadow',
      'abc/../../secret',
      'a'.repeat(200),
      'short',
      '',
      'has space',
      'has.dot',
    ]) {
      assert.equal(SAFE.test(hostile), false, `should reject: ${hostile}`)
    }

    for (const legitimate of ['V1StGXR8_Z5jdHi6', 'abcdef', 'A-B_c-1234567890']) {
      assert.equal(SAFE.test(legitimate), true, `should accept: ${legitimate}`)
    }
  })

  it('store.ts guards both the record path and the report path', () => {
    const source = read('src/utils/integrity/store.ts')

    assert.match(source, /function safeId/)
    assert.match(source, /A-Za-z0-9_-/)
    // Both path builders must go through the guard, not just one.
    assert.match(source, /function recordPath[\s\S]{0,200}safeId\(/)
    assert.match(source, /function reportPath[\s\S]{0,200}safeId\(/)
  })
})

/* ── webhook forgery ─────────────────────────────────────────────── */

describe('similarity webhook authenticity', () => {
  beforeEach(() => {
    process.env.INTEGRITY_WEBHOOK_SECRET = 'test-secret-value'
  })
  afterEach(() => {
    delete process.env.INTEGRITY_WEBHOOK_SECRET
    delete process.env.NEXT_PUBLIC_APP_URL
  })

  it('accepts only the token derived for that specific check', async () => {
    const { webhookToken: mint, verifyWebhookToken } = await webhookToken()

    const good = mint('check-abc')

    assert.equal(verifyWebhookToken('check-abc', good), true)
    // The token for one check must not unlock another.
    assert.equal(verifyWebhookToken('check-xyz', good), false)
    assert.equal(verifyWebhookToken('check-abc', 'forged'), false)
    assert.equal(verifyWebhookToken('check-abc', ''), false)
  })

  it('produces a token that cannot be derived from the check id alone', async () => {
    const { webhookToken: mint } = await webhookToken()

    const token = mint('check-abc')
    assert.equal(token.length, 64, 'a full sha256 hex digest')
    assert.ok(!token.includes('check-abc'))
  })

  it('refuses to hand a provider a callback URL it cannot reach', async () => {
    const { callbackUrlFor } = await webhookToken()

    for (const local of [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://myapp.local',
    ]) {
      process.env.NEXT_PUBLIC_APP_URL = local
      assert.equal(
        callbackUrlFor('check-abc'),
        null,
        `${local} is unreachable from a provider and must not be submitted`
      )
    }

    delete process.env.NEXT_PUBLIC_APP_URL
    assert.equal(callbackUrlFor('check-abc'), null)
  })

  it('builds a tokenised callback URL for a public deployment', async () => {
    const { callbackUrlFor } = await webhookToken()

    process.env.NEXT_PUBLIC_APP_URL = 'https://wordpi.app'
    const url = callbackUrlFor('check-abc')!

    assert.match(url, /^https:\/\/wordpi\.app\/api\/integrity\/webhook\/check-abc\?token=[a-f0-9]{64}/)
    assert.match(url, /\{STATUS\}/, 'Copyleaks substitutes the status into this placeholder')
  })

  it('the webhook route verifies the token before doing any work', () => {
    const source = read('src/app/api/integrity/webhook/[id]/route.ts')

    // The token check must reject and return before the body is read, let
    // alone applied — so `verifyWebhookToken` has to appear ahead of both.
    const guardAt = source.indexOf('verifyWebhookToken(id')
    const bodyAt = source.indexOf('req.json()')
    const applyAt = source.indexOf('applyPlagiarismWebhook(')

    assert.ok(guardAt > -1, 'the webhook must verify its token')
    assert.ok(guardAt < bodyAt, 'the token is checked before the payload is parsed')
    assert.ok(guardAt < applyAt, 'the token is checked before any result is applied')
    assert.match(
      source.slice(guardAt, applyAt),
      /return ACK/,
      'a bad token must short-circuit the handler'
    )
    // Copyleaks retries non-2xx. Answering 500 to a rejected callback only
    // buys repeated deliveries of something we already refused.
    assert.ok(!/status:\s*(401|403|500)/.test(source))
  })
})

/* ── credential exposure ─────────────────────────────────────────── */

describe('provider credentials never reach the browser', () => {
  const SECRETS = [
    'COPYLEAKS_EMAIL',
    'COPYLEAKS_API_KEY',
    'GPTZERO_API_KEY',
    'INTEGRITY_WEBHOOK_SECRET',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]

  /** Every .ts/.tsx under src, so a new file cannot quietly opt out. */
  function sourceFiles(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(join(ROOT, dir))) {
      const relative = `${dir}/${entry}`
      if (statSync(join(ROOT, relative)).isDirectory()) {
        sourceFiles(relative, found)
      } else if (/\.tsx?$/.test(entry)) {
        found.push(relative)
      }
    }
    return found
  }

  it('no secret is exposed under a NEXT_PUBLIC_ name', () => {
    for (const secret of SECRETS) {
      assert.ok(
        !read('.env.example').includes(`NEXT_PUBLIC_${secret}`),
        `${secret} must never be published to the browser bundle`
      )
    }
  })

  it('no client component reads a provider credential', () => {
    const offenders: string[] = []

    for (const file of sourceFiles('src')) {
      const source = read(file)
      if (!isClientModule(source)) continue

      for (const secret of SECRETS) {
        if (source.includes(secret)) offenders.push(`${file} reads ${secret}`)
      }
    }

    assert.deepEqual(offenders, [], 'a "use client" module is bundled and shipped to the browser')
  })

  it('the service-role key is imported only where it is unavoidable', () => {
    // It bypasses row-level security entirely, so every importer is listed here
    // by hand and has to justify itself. Adding one is a deliberate act, which
    // is the point of pinning the list rather than counting it.
    const allowed = [
      // Copyleaks calls back with no user session attached, so RLS cannot be
      // satisfied any other way.
      'src/app/api/integrity/webhook/[id]/route.ts',
      // Metering falls back to this when a usage row has to be written for an
      // owner whose own client cannot reach the table.
      'src/utils/entitlements/store.ts',
      // The admin dashboard reads across every account, which no user-scoped
      // client may do, and mints accounts via auth.admin.
      'src/utils/adminData.ts',
      // Reports whether the key is present, so the dashboard can say that its
      // view is partial instead of showing an empty list as though it were whole.
      'src/app/api/admin/failures/route.ts',
    ]

    const importers = sourceFiles('src').filter(file =>
      /supabaseAdmin/.test(read(file)) && !file.endsWith('supabaseAdmin.ts')
    )

    assert.deepEqual(importers.slice().sort(), allowed.slice().sort())

    // The property that actually matters: whatever the list contains, none of
    // it may be bundled into the browser.
    for (const file of importers) {
      assert.ok(!isClientModule(read(file)), `${file} imports the service-role key and is a client module`)
    }
  })

  it('provider adapters run only on the server', () => {
    for (const file of [
      'src/utils/integrity/providers/copyleaks.ts',
      'src/utils/integrity/providers/gptzero.ts',
      'src/utils/integrity/store.ts',
      'src/utils/supabaseAdmin.ts',
    ]) {
      assert.ok(!isClientModule(read(file)), `${file} must not be a client module`)
    }
  })

  it('the browser-facing client never names a provider endpoint', () => {
    const source = read('src/utils/integrityClient.ts')

    assert.ok(!source.includes('api.copyleaks.com'))
    assert.ok(!source.includes('api.gptzero.me'))
    assert.ok(!source.includes('id.copyleaks.com'))
    assert.match(source, /\/api\/integrity\//, 'the client speaks only to our own routes')
  })
})

/* ── document retention ──────────────────────────────────────────── */

describe('document text is not retained', () => {
  it('the stored record has no field carrying the document body', () => {
    const source = read('src/utils/integrity/store.ts')

    // The row builder is the exhaustive list of what gets written.
    const row = source.slice(source.indexOf('function toRow'), source.indexOf('function fromRow'))

    for (const forbidden of ['text:', 'content:', 'body:', 'prose:', 'matchedText']) {
      assert.ok(!row.includes(forbidden), `toRow must not persist ${forbidden}`)
    }
  })

  it('flagged passages are stored as offsets rather than quoted prose', () => {
    const types = read('src/utils/integrity/types.ts')

    assert.match(types, /interface TextSpan[\s\S]{0,120}start: number[\s\S]{0,60}length: number/)
    // A `matchedText` field would put the student's sentences back in the
    // database, which is the thing the offset design exists to avoid.
    assert.ok(!/matchedText/.test(types))
  })

  it('deletion removes the report alongside the record', () => {
    const source = read('src/utils/integrity/store.ts')
    const del = source.slice(source.indexOf('export async function deleteCheck'))

    assert.match(del, /recordPath\(id\), reportPath\(id\)/, 'both artifacts must go')
  })
})
