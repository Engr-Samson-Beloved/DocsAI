/**
 * Provider adapter tests (§27).
 *
 * Every case here stubs `globalThis.fetch`. No test in this file touches the
 * network: the point is to verify how we *speak* to Copyleaks and GPTZero —
 * which endpoint, which header, which field — and how we read what comes back.
 * A test that made a real call would verify the provider's uptime instead, and
 * would spend credits doing it.
 *
 * The GPTZero cases matter most. Its published response schema is incomplete
 * and two different shapes are in circulation, so the reader has to handle
 * both and must refuse to invent a score when it recognises neither. That
 * refusal is the behaviour these tests pin down.
 *
 * Run: npm test
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

const copyleaks = () => import('../src/utils/integrity/providers/copyleaks.ts')
const gptzero = () => import('../src/utils/integrity/providers/gptzero.ts')

type FetchCall = { url: string; init: RequestInit }

const realFetch = globalThis.fetch
let calls: FetchCall[] = []

/** Replaces fetch with a scripted responder and records what was sent. */
function stubFetch(handler: (url: string, init: RequestInit) => unknown) {
  calls = []
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push({ url, init })
    const result = handler(url, init)
    if (result instanceof Response) return result
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
}

function jsonBody(call: FetchCall): Record<string, unknown> {
  return JSON.parse(String(call.init.body))
}

/** Prose long enough to clear both providers' 255-character floor. */
const LONG_TEXT = 'This is a sentence of academic prose about energy systems. '.repeat(10)

beforeEach(() => {
  process.env.COPYLEAKS_EMAIL = 'student@example.edu'
  process.env.COPYLEAKS_API_KEY = '00000000-0000-0000-0000-000000000000'
  process.env.GPTZERO_API_KEY = 'test-key'
})

afterEach(async () => {
  globalThis.fetch = realFetch
  const { resetCopyleaksToken } = await copyleaks()
  resetCopyleaksToken()
  delete process.env.COPYLEAKS_EMAIL
  delete process.env.COPYLEAKS_API_KEY
  delete process.env.GPTZERO_API_KEY
})

/* ── Copyleaks: authentication ───────────────────────────────────── */

describe('Copyleaks authentication', () => {
  it('exchanges email and key for a token at the documented login endpoint', async () => {
    const { CopyleaksProvider } = await copyleaks()

    stubFetch(url => {
      if (url.includes('/v3/account/login/api')) {
        return { access_token: 'token-abc', '.expires': new Date(Date.now() + 3600_000).toISOString() }
      }
      return { summary: { human: 100, ai: 0 }, scannedDocument: { totalWords: 100 } }
    })

    await new CopyleaksProvider().checkAI({ text: LONG_TEXT, scanId: 'check1' })

    const login = calls.find(c => c.url.includes('/account/login/api'))
    assert.ok(login, 'must authenticate before scanning')
    assert.equal(login.url, 'https://id.copyleaks.com/v3/account/login/api')
    assert.equal(login.init.method, 'POST')

    const body = jsonBody(login)
    assert.equal(body.email, 'student@example.edu')
    assert.equal(body.key, '00000000-0000-0000-0000-000000000000')
  })

  it('reuses the cached token instead of re-authenticating per scan', async () => {
    const { CopyleaksProvider } = await copyleaks()

    stubFetch(url =>
      url.includes('login')
        ? { access_token: 'token-abc', '.expires': new Date(Date.now() + 3600_000).toISOString() }
        : { summary: { human: 100, ai: 0 }, scannedDocument: { totalWords: 100 } }
    )

    const provider = new CopyleaksProvider()
    await provider.checkAI({ text: LONG_TEXT, scanId: 'a' })
    await provider.checkAI({ text: LONG_TEXT, scanId: 'b' })
    await provider.checkAI({ text: LONG_TEXT, scanId: 'c' })

    const logins = calls.filter(c => c.url.includes('login')).length
    // Copyleaks blocks the account after 12 logins per 15 minutes, so one
    // login per scan is a real outage waiting to happen.
    assert.equal(logins, 1, 'the 48-hour token must be reused')
  })

  it('sends the token as a bearer credential on the scan call', async () => {
    const { CopyleaksProvider } = await copyleaks()

    stubFetch(url =>
      url.includes('login')
        ? { access_token: 'token-abc' }
        : { summary: { human: 90, ai: 10 }, scannedDocument: { totalWords: 100 } }
    )

    await new CopyleaksProvider().checkAI({ text: LONG_TEXT, scanId: 'check1' })

    const scan = calls.find(c => c.url.includes('writer-detector'))!
    const headers = scan.init.headers as Record<string, string>
    assert.equal(headers.Authorization, 'Bearer token-abc')
  })

  it('reports itself unconfigured when credentials are absent', async () => {
    const { CopyleaksProvider } = await copyleaks()
    delete process.env.COPYLEAKS_EMAIL
    delete process.env.COPYLEAKS_API_KEY

    assert.equal(new CopyleaksProvider().isConfigured(), false)
  })

  it('does not retry rejected credentials', async () => {
    const { CopyleaksProvider } = await copyleaks()

    stubFetch(() => new Response('{"error":"bad key"}', { status: 401 }))

    const result = await new CopyleaksProvider().checkAI({ text: LONG_TEXT, scanId: 'check1' })

    assert.equal(result.status, 'failed')
    // Retrying a 401 just burns the login rate limit with the same wrong key.
    assert.equal(calls.length, 1)
  })
})

/* ── Copyleaks: AI detection ─────────────────────────────────────── */

describe('Copyleaks AI detection', () => {
  it('posts to the documented writer-detector endpoint with the scan id', async () => {
    const { CopyleaksProvider } = await copyleaks()

    stubFetch(url =>
      url.includes('login')
        ? { access_token: 't' }
        : { summary: { human: 50, ai: 50 }, scannedDocument: { totalWords: 100 } }
    )

    await new CopyleaksProvider().checkAI({ text: LONG_TEXT, scanId: 'scan-42', sandbox: true })

    const scan = calls.find(c => c.url.includes('writer-detector'))!
    assert.equal(scan.url, 'https://api.copyleaks.com/v2/writer-detector/scan-42/check')
    assert.equal(scan.init.method, 'POST')

    const body = jsonBody(scan)
    assert.equal(body.text, LONG_TEXT)
    assert.equal(body.sandbox, true, 'sandbox must be forwarded so tests cost nothing')
  })

  it('derives the document score from the summary word counts, not from span probabilities', async () => {
    const { CopyleaksProvider } = await copyleaks()

    stubFetch(url =>
      url.includes('login')
        ? { access_token: 't' }
        : {
            modelVersion: 'v9',
            summary: { human: 250, ai: 750 },
            // A single short span at 99% must not drag the document to 99%.
            results: [{ classification: 2, probability: 0.99, matches: [] }],
            scannedDocument: { totalWords: 1000 },
          }
    )

    const result = await new CopyleaksProvider().checkAI({ text: LONG_TEXT, scanId: 's' })

    assert.equal(result.status, 'completed')
    assert.equal(result.aiProbability, 0.75)
    assert.equal(result.humanProbability, 0.25)
    assert.equal(result.modelVersion, 'v9')
  })

  it('maps matched character spans into offsets on our own text', async () => {
    const { CopyleaksProvider } = await copyleaks()

    stubFetch(url =>
      url.includes('login')
        ? { access_token: 't' }
        : {
            summary: { human: 0, ai: 100 },
            results: [
              {
                classification: 2,
                probability: 0.88,
                matches: [{ text: { chars: { starts: [10, 40], lengths: [12, 8] } } }],
              },
            ],
            scannedDocument: { totalWords: 100 },
          }
    )

    const result = await new CopyleaksProvider().checkAI({
      text: LONG_TEXT,
      scanId: 's',
      sectionAt: offset => (offset < 30 ? 'CHAPTER ONE' : 'CHAPTER TWO'),
    })

    assert.equal(result.sections?.length, 2)
    assert.deepEqual(result.sections?.[0].span, { start: 10, length: 12 })
    assert.equal(result.sections?.[0].aiProbability, 0.88)
    assert.equal(result.sections?.[0].section, 'CHAPTER ONE')
    assert.equal(result.sections?.[1].section, 'CHAPTER TWO')
  })

  it('does not flag spans the provider classified as human', async () => {
    const { CopyleaksProvider } = await copyleaks()

    stubFetch(url =>
      url.includes('login')
        ? { access_token: 't' }
        : {
            summary: { human: 100, ai: 0 },
            results: [
              { classification: 1, probability: 0.9, matches: [{ text: { chars: { starts: [0], lengths: [5] } } }] },
            ],
            scannedDocument: { totalWords: 100 },
          }
    )

    const result = await new CopyleaksProvider().checkAI({ text: LONG_TEXT, scanId: 's' })
    assert.equal(result.sections?.length, 0, 'highlighting human spans would paint the whole document')
  })

  it('refuses documents below the provider’s 255-character floor without calling out', async () => {
    const { CopyleaksProvider } = await copyleaks()
    stubFetch(() => ({}))

    const result = await new CopyleaksProvider().checkAI({ text: 'too short', scanId: 's' })

    assert.equal(result.status, 'failed')
    assert.match(result.error!, /255/)
    assert.equal(calls.length, 0, 'a doomed request must not be sent')
  })

  it('splits a long document and weights the parts by length', async () => {
    const { CopyleaksProvider } = await copyleaks()

    // 150k characters: over the documented 100k single-call limit.
    const long = 'Sentence about the study. '.repeat(6000)
    let call = 0

    stubFetch(url => {
      if (url.includes('login')) return { access_token: 't' }
      call++
      // First (large) chunk is mostly human; second (small) is all AI.
      return call === 1
        ? { summary: { human: 900, ai: 100 }, scannedDocument: { totalWords: 1000 } }
        : { summary: { human: 0, ai: 100 }, scannedDocument: { totalWords: 100 } }
    })

    const result = await new CopyleaksProvider().checkAI({ text: long, scanId: 'big' })

    const scans = calls.filter(c => c.url.includes('writer-detector'))
    assert.ok(scans.length > 1, 'a 150k-character document must be chunked')
    // Each chunk gets its own scan id; a reused id is a 409 from Copyleaks.
    const ids = new Set(scans.map(c => c.url))
    assert.equal(ids.size, scans.length, 'chunk scan ids must be unique')

    // Weighted, not averaged: the 1000-word chunk dominates the 100-word one.
    assert.ok(result.aiProbability! < 0.3, `expected a length-weighted score, got ${result.aiProbability}`)
  })

  it('reports partial rather than failed when only some chunks fail', async () => {
    const { CopyleaksProvider } = await copyleaks()

    const long = 'Sentence about the study. '.repeat(6000)
    let call = 0

    stubFetch(url => {
      if (url.includes('login')) return { access_token: 't' }
      call++
      if (call === 2) return new Response('nope', { status: 400 })
      return { summary: { human: 500, ai: 500 }, scannedDocument: { totalWords: 500 } }
    })

    const result = await new CopyleaksProvider().checkAI({ text: long, scanId: 'big' })

    assert.equal(result.status, 'partial')
    assert.match(result.error!, /could not be analysed/)
    assert.notEqual(result.aiProbability, null, 'a partial run still reports what it measured')
  })
})

/* ── Copyleaks: similarity submission and webhook ────────────────── */

describe('Copyleaks similarity', () => {
  it('submits the document as base64 with a webhook and parks awaiting the callback', async () => {
    const { CopyleaksProvider } = await copyleaks()

    stubFetch(url =>
      url.includes('login') ? { access_token: 't' } : new Response('', { status: 201 })
    )

    const result = await new CopyleaksProvider().checkPlagiarism({
      text: LONG_TEXT,
      scanId: 'sim-1',
      webhookUrl: 'https://example.com/api/integrity/webhook/x?token=y&status={STATUS}',
    })

    const submit = calls.find(c => c.url.includes('/scans/submit/file/'))!
    assert.equal(submit.url, 'https://api.copyleaks.com/v3/scans/submit/file/sim-1')
    assert.equal(submit.init.method, 'PUT')

    const body = jsonBody(submit) as {
      base64: string
      filename: string
      properties: { webhooks: { status: string } }
    }
    assert.equal(Buffer.from(body.base64, 'base64').toString('utf-8'), LONG_TEXT)
    assert.match(body.properties.webhooks.status, /\{STATUS\}/)

    // Not a 0% result — the scan has not finished yet, and those are very
    // different claims to put in front of a student.
    assert.equal(result.status, 'partial')
    assert.equal(result.awaitingCallback, true)
    assert.equal(result.providerReference, 'sim-1')
  })

  it('skips similarity, with a reason, when no public callback URL exists', async () => {
    const { CopyleaksProvider } = await copyleaks()
    stubFetch(() => ({}))

    const result = await new CopyleaksProvider().checkPlagiarism({
      text: LONG_TEXT,
      scanId: 'sim-1',
    })

    assert.equal(result.status, 'skipped')
    assert.match(result.error!, /publicly reachable/)
    assert.equal(calls.length, 0, 'nothing may be submitted that cannot report back')
  })

  it('reads a completed webhook into normalised sources by origin', async () => {
    const { CopyleaksProvider } = await copyleaks()

    const result = await new CopyleaksProvider().resolvePlagiarismWebhook(
      {
        status: 0,
        scannedDocument: { totalWords: 5000 },
        results: {
          score: {
            aggregatedScore: 7,
            identicalWords: 200,
            minorChangedWords: 100,
            relatedMeaningWords: 50,
          },
          internet: [
            { id: '1', title: 'A web page', url: 'https://example.com/a', matchedWords: 200, totalWords: 1000 },
          ],
          database: [{ id: '2', title: 'A journal article', matchedWords: 100, totalWords: 1000 }],
          repositories: [{ id: '3', title: 'A repository copy', matchedWords: 50, totalWords: 1000 }],
        },
      },
      'sim-1'
    )

    assert.equal(result.status, 'completed')
    assert.equal(result.similarityPercentage, 7)
    assert.equal(result.matchedWords, 350)
    assert.equal(result.sources.length, 3)

    const web = result.sources.find(s => s.category === 'internet')!
    assert.equal(web.url, 'https://example.com/a')
    assert.equal(web.similarityPercentage, 20)

    assert.ok(result.sources.some(s => s.category === 'academic'))
    assert.ok(result.sources.some(s => s.category === 'repository'))

    // Sorted strongest first, so the dashboard's truncated list is the useful end.
    const scores = result.sources.map(s => s.similarityPercentage ?? 0)
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a))
  })

  it('treats a non-zero webhook status as a failed scan', async () => {
    const { CopyleaksProvider } = await copyleaks()

    const result = await new CopyleaksProvider().resolvePlagiarismWebhook({ status: 3 }, 'sim-1')

    assert.equal(result.status, 'failed')
    assert.equal(result.similarityPercentage, 0)
  })

  it('does not mistake an unreadable callback for a clean result', async () => {
    const { CopyleaksProvider } = await copyleaks()

    const result = await new CopyleaksProvider().resolvePlagiarismWebhook('garbage', 'sim-1')
    assert.equal(result.status, 'failed')
  })
})

/* ── GPTZero ─────────────────────────────────────────────────────── */

describe('GPTZero', () => {
  it('posts to /v2/predict/text with the x-api-key header', async () => {
    const { GPTZeroProvider } = await gptzero()

    stubFetch(() => ({ documents: [{ class_probabilities: { ai: 0.7, human: 0.3 } }] }))

    await new GPTZeroProvider().checkAI({ text: LONG_TEXT, scanId: 's' })

    assert.equal(calls[0].url, 'https://api.gptzero.me/v2/predict/text')
    assert.equal(calls[0].init.method, 'POST')
    const headers = calls[0].init.headers as Record<string, string>
    assert.equal(headers['x-api-key'], 'test-key')
    assert.equal(jsonBody(calls[0]).document, LONG_TEXT)
  })

  it('reads the documented documents[] envelope', async () => {
    const { GPTZeroProvider } = await gptzero()

    stubFetch(() => ({
      documents: [
        {
          document_classification: 'MIXED',
          class_probabilities: { ai: 0.71, human: 0.24, mixed: 0.05 },
          confidence_category: 'high',
        },
      ],
    }))

    const result = await new GPTZeroProvider().checkAI({ text: LONG_TEXT, scanId: 's' })

    assert.equal(result.status, 'completed')
    assert.equal(Math.round(result.aiProbability! * 100), 71)
    assert.equal(result.modelVersion, 'confidence:high')
  })

  it('also reads the flat completely_generated_prob envelope', async () => {
    const { GPTZeroProvider } = await gptzero()

    // The shape published by the widely-mirrored third-party OpenAPI spec.
    stubFetch(() => ({ completely_generated_prob: 0.42, classification: 'mixed' }))

    const result = await new GPTZeroProvider().checkAI({ text: LONG_TEXT, scanId: 's' })

    assert.equal(result.status, 'completed')
    assert.equal(Math.round(result.aiProbability! * 100), 42)
  })

  it('fails rather than reporting 0% when it recognises neither shape', async () => {
    const { GPTZeroProvider } = await gptzero()

    stubFetch(() => ({ unexpected: 'shape' }))

    const result = await new GPTZeroProvider().checkAI({ text: LONG_TEXT, scanId: 's' })

    // The whole point: a missing field must never become "0% AI" on a report a
    // student may hand to an examiner.
    assert.equal(result.status, 'failed')
    assert.equal(result.aiProbability, null)
    assert.match(result.error!, /unrecognised format/)
  })

  it('locates sentence-level flags in our own text by matching the sentence', async () => {
    const { GPTZeroProvider } = await gptzero()

    const text =
      'The first sentence is ordinary. The second sentence was flagged. A third follows here.'

    stubFetch(() => ({
      documents: [
        {
          class_probabilities: { ai: 0.8, human: 0.2 },
          sentences: [
            { sentence: 'The first sentence is ordinary.', generated_prob: 0.1 },
            { sentence: 'The second sentence was flagged.', generated_prob: 0.93 },
            { sentence: 'A third follows here.', generated_prob: 0.2, highlight_sentence_for_ai: true },
          ],
        },
      ],
    }))

    const result = await new GPTZeroProvider().checkAI({
      text: text.padEnd(300, ' Additional filler prose.'),
      scanId: 's',
    })

    // Only the two AI-leaning sentences; the ordinary one is not highlighted.
    assert.equal(result.sections?.length, 2)

    const flagged = result.sections![0]
    assert.equal(
      text.slice(flagged.span.start, flagged.span.start + flagged.span.length),
      'The second sentence was flagged.'
    )
    assert.equal(flagged.aiProbability, 0.93)
  })

  it('drops a sentence it cannot locate rather than guessing an offset', async () => {
    const { GPTZeroProvider } = await gptzero()

    stubFetch(() => ({
      documents: [
        {
          class_probabilities: { ai: 0.8, human: 0.2 },
          sentences: [{ sentence: 'A sentence that is not in the document.', generated_prob: 0.99 }],
        },
      ],
    }))

    const result = await new GPTZeroProvider().checkAI({ text: LONG_TEXT, scanId: 's' })

    // Highlighting the wrong paragraph is worse than highlighting nothing.
    assert.equal(result.sections?.length, 0)
  })

  it('does not offer plagiarism checking, which it has no endpoint for', async () => {
    const { GPTZeroProvider } = await gptzero()
    const provider = new GPTZeroProvider()

    assert.equal(provider.supportsPlagiarism(), false)
    assert.equal(typeof (provider as { checkPlagiarism?: unknown }).checkPlagiarism, 'undefined')
  })

  it('reports itself unconfigured without a key', async () => {
    const { GPTZeroProvider } = await gptzero()
    delete process.env.GPTZERO_API_KEY
    assert.equal(new GPTZeroProvider().isConfigured(), false)
  })

  it('names the credential problem without echoing the credential', async () => {
    const { GPTZeroProvider } = await gptzero()

    stubFetch(() => new Response('{"error":"invalid"}', { status: 403 }))

    const result = await new GPTZeroProvider().checkAI({ text: LONG_TEXT, scanId: 's' })

    assert.equal(result.status, 'failed')
    assert.match(result.error!, /rejected the API key/)
    assert.ok(!result.error!.includes('test-key'), 'an error message must never carry the key')
  })
})

/* ── retry policy ────────────────────────────────────────────────── */

describe('retry policy', () => {
  it('retries a 429 and succeeds on a later attempt', async () => {
    const { GPTZeroProvider } = await gptzero()

    let attempt = 0
    stubFetch(() => {
      attempt++
      if (attempt < 3) {
        return new Response('slow down', { status: 429, headers: { 'Retry-After': '0' } })
      }
      return { documents: [{ class_probabilities: { ai: 0.5, human: 0.5 } }] }
    })

    const result = await new GPTZeroProvider().checkAI({ text: LONG_TEXT, scanId: 's' })

    assert.equal(result.status, 'completed')
    assert.equal(attempt, 3)
  })

  it('stops after three attempts rather than hammering a paid API', async () => {
    const { GPTZeroProvider } = await gptzero()

    let attempt = 0
    stubFetch(() => {
      attempt++
      return new Response('server error', { status: 500 })
    })

    const result = await new GPTZeroProvider().checkAI({ text: LONG_TEXT, scanId: 's' })

    assert.equal(result.status, 'failed')
    assert.equal(attempt, 3, 'three attempts, then stop')
  })

  it('does not retry a 400, which would fail identically', async () => {
    const { GPTZeroProvider } = await gptzero()

    let attempt = 0
    stubFetch(() => {
      attempt++
      return new Response('bad request', { status: 400 })
    })

    await new GPTZeroProvider().checkAI({ text: LONG_TEXT, scanId: 's' })
    assert.equal(attempt, 1)
  })
})
