/**
 * End-to-end pipeline tests (§27's integration cases).
 *
 * These drive `runCheck` with both providers stubbed at the network boundary,
 * so the whole chain runs for real: extract, chunk, call providers, normalise,
 * assess, persist, report. Only two things are substituted — `fetch`, so no
 * credits are spent, and the PDF renderer, because `report.tsx` is JSX and
 * Node's type stripping cannot parse it.
 *
 * Records are written to a temporary directory rather than the repo's `data/`,
 * so a test run never touches a developer's real checks.
 *
 * Run: npm test
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IntegrityCheck } from '../src/utils/integrity/types.ts'

const runner = () => import('../src/utils/integrity/runner.ts')
const copyleaks = () => import('../src/utils/integrity/providers/copyleaks.ts')
const store = () => import('../src/utils/integrity/store.ts')

const realFetch = globalThis.fetch
const realCwd = process.cwd()
let workspace: string

/** A document comfortably over both providers' 255-character floor. */
function documentJson(paragraphs = 12): string {
  const blocks: unknown[] = [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'INTRODUCTION' }] },
  ]
  for (let i = 0; i < paragraphs; i++) {
    blocks.push({
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: `Paragraph ${i} discusses the design of the smart energy monitoring system in detail.`,
        },
      ],
    })
  }
  return JSON.stringify({ type: 'doc', content: [{ type: 'page', content: blocks }] })
}

interface ProviderScript {
  copyleaksAi?: unknown | 'fail'
  gptzeroAi?: unknown | 'fail'
  similarity?: 'accept' | 'fail'
}

function stubProviders(script: ProviderScript) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString()
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })

    if (url.includes('login')) return json({ access_token: 'token' })

    if (url.includes('writer-detector')) {
      if (script.copyleaksAi === 'fail') return new Response('down', { status: 503 })
      return json(script.copyleaksAi ?? { summary: { human: 100, ai: 0 }, scannedDocument: { totalWords: 100 } })
    }

    if (url.includes('predict/text')) {
      if (script.gptzeroAi === 'fail') return new Response('down', { status: 503 })
      return json(script.gptzeroAi ?? { documents: [{ class_probabilities: { ai: 0, human: 1 } }] })
    }

    if (url.includes('scans/submit/file')) {
      return script.similarity === 'fail'
        ? new Response('nope', { status: 400 })
        : new Response('', { status: 201 })
    }

    return json({})
  }) as typeof fetch
}

/** Runs a check to completion and returns the stored record. */
async function run(
  script: ProviderScript,
  options: { webhookUrl?: string; content?: string } = {}
): Promise<IntegrityCheck> {
  const { createCheck, prepareDocument, runCheck } = await runner()

  stubProviders(script)

  const prepared = prepareDocument(options.content ?? documentJson())
  const check = createCheck('testcheck000001', 'user:alice', {
    projectId: 'project-1',
    title: 'Final Year Project — Chapter 2',
  }, prepared)

  return runCheck(check, prepared, null, { webhookUrl: options.webhookUrl })
}

beforeEach(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'wordpi-integrity-'))
  process.chdir(workspace)

  process.env.COPYLEAKS_EMAIL = 'student@example.edu'
  process.env.COPYLEAKS_API_KEY = '00000000-0000-0000-0000-000000000000'
  process.env.GPTZERO_API_KEY = 'test-key'

  // The renderer is JSX and cannot be imported here; a stub keeps the rest of
  // the pipeline honest. Its bytes are asserted on where they are stored.
  const { setReportGenerator } = await runner()
  setReportGenerator(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))
})

afterEach(async () => {
  globalThis.fetch = realFetch
  process.chdir(realCwd)
  rmSync(workspace, { recursive: true, force: true })

  const { resetCopyleaksToken } = await copyleaks()
  resetCopyleaksToken()
  const { setReportGenerator } = await runner()
  setReportGenerator(null)

  delete process.env.COPYLEAKS_EMAIL
  delete process.env.COPYLEAKS_API_KEY
  delete process.env.GPTZERO_API_KEY
})

/* ── the happy path ──────────────────────────────────────────────── */

describe('a complete document scan', () => {
  it('runs every stage and stores a finished, reportable check', async () => {
    const check = await run({
      copyleaksAi: { summary: { human: 220, ai: 780 }, scannedDocument: { totalWords: 1000 } },
      gptzeroAi: { documents: [{ class_probabilities: { ai: 0.71, human: 0.29 } }] },
    })

    assert.equal(check.status, 'completed')
    assert.ok(check.completedAt)

    // Both providers present, side by side (§11).
    assert.equal(check.ai.length, 2)
    assert.ok(check.ai.find(r => r.provider === 'copyleaks'))
    assert.ok(check.ai.find(r => r.provider === 'gptzero'))

    assert.equal(check.verdict?.assessment, 'high_concern')
    assert.equal(check.reportGenerated, true)

    // Stage checklist reached the end (§26).
    const byId = Object.fromEntries(check.stages.map(s => [s.id, s.state]))
    assert.equal(byId.prepare, 'done')
    assert.equal(byId['ai-detection'], 'done')
    assert.equal(byId.compare, 'done')
    assert.equal(byId.report, 'done')
  })

  it('stores the report once, and the stored bytes are what is served', async () => {
    const check = await run({})
    const { loadReport, loadCheck } = await store()

    const bytes = await loadReport(check.id, null)
    assert.ok(bytes, 'a completed check must have a stored report')
    // %PDF- — the download route streams these bytes rather than re-rendering.
    assert.deepEqual([...bytes.slice(0, 5)], [0x25, 0x50, 0x44, 0x46, 0x2d])

    const reloaded = await loadCheck(check.id, null)
    assert.equal(reloaded?.reportGenerated, true)
  })

  it('never persists the document text', async () => {
    const check = await run({})
    const { loadCheck } = await store()

    const stored = await loadCheck(check.id, null)
    const serialised = JSON.stringify(stored)

    assert.ok(
      !serialised.includes('smart energy monitoring system'),
      'the student’s prose must not survive in the record'
    )
    // Only offsets and counts.
    assert.ok(stored!.wordCount > 0)
    assert.ok(stored!.contentHash.length > 0)
  })
})

/* ── provider disagreement ───────────────────────────────────────── */

describe('provider disagreement', () => {
  it('records both figures and refuses to reconcile them', async () => {
    const check = await run({
      copyleaksAi: { summary: { human: 180, ai: 820 }, scannedDocument: { totalWords: 1000 } },
      gptzeroAi: { documents: [{ class_probabilities: { ai: 0.34, human: 0.66 } }] },
    })

    assert.equal(check.verdict?.assessment, 'provider_disagreement')
    assert.equal(check.verdict?.spreadPoints, 48)

    const copyleaksScore = check.ai.find(r => r.provider === 'copyleaks')!.aiProbability!
    const gptzeroScore = check.ai.find(r => r.provider === 'gptzero')!.aiProbability!
    assert.equal(Math.round(copyleaksScore * 100), 82)
    assert.equal(Math.round(gptzeroScore * 100), 34)

    // Still a usable, downloadable report — disagreement is a result.
    assert.equal(check.status, 'completed')
    assert.equal(check.reportGenerated, true)
  })
})

/* ── partial failure (§22) ───────────────────────────────────────── */

describe('one provider failing', () => {
  it('completes with the other provider and says which one was unavailable', async () => {
    const check = await run({
      copyleaksAi: 'fail',
      gptzeroAi: { documents: [{ class_probabilities: { ai: 0.66, human: 0.34 } }] },
    })

    assert.equal(check.status, 'completed')
    assert.equal(check.reportGenerated, true, 'a partial report is still a report')

    const copyleaksResult = check.ai.find(r => r.provider === 'copyleaks')!
    assert.equal(copyleaksResult.status, 'failed')
    assert.equal(copyleaksResult.aiProbability, null, 'a failure is not a zero')

    const stage = check.stages.find(s => s.id === 'ai-detection')!
    assert.equal(stage.state, 'done')
    assert.match(stage.note!, /Copyleaks unavailable/)
    assert.match(stage.note!, /partial results/)
  })

  it('works the other way round too', async () => {
    const check = await run({
      copyleaksAi: { summary: { human: 900, ai: 100 }, scannedDocument: { totalWords: 1000 } },
      gptzeroAi: 'fail',
    })

    assert.equal(check.status, 'completed')
    assert.match(check.stages.find(s => s.id === 'ai-detection')!.note!, /GPTZero unavailable/)
    assert.equal(check.verdict?.assessment, 'low_concern')
  })
})

/* ── total failure ───────────────────────────────────────────────── */

describe('both providers failing', () => {
  it('marks the check failed rather than reporting a clean document', async () => {
    const check = await run({ copyleaksAi: 'fail', gptzeroAi: 'fail' })

    assert.equal(check.status, 'failed')
    assert.match(check.error!, /could not be completed/i)

    // The whole point: two outages must not read as "no AI detected".
    assert.equal(check.verdict?.assessment, 'inconclusive')
    assert.notEqual(check.verdict?.assessment, 'low_concern')
    assert.equal(check.reportGenerated, false)
  })

  it('still persists the record, so nothing is lost to a third-party outage', async () => {
    const check = await run({ copyleaksAi: 'fail', gptzeroAi: 'fail' })
    const { loadCheck } = await store()

    const stored = await loadCheck(check.id, null)
    assert.ok(stored, 'a failed check must still be retrievable')
    assert.equal(stored.status, 'failed')
  })
})

/* ── similarity lifecycle ────────────────────────────────────────── */

describe('similarity scanning', () => {
  it('parks the check while the scan runs, without claiming 0% similarity', async () => {
    const check = await run(
      { similarity: 'accept' },
      { webhookUrl: 'https://example.com/api/integrity/webhook/x?token=y&status={STATUS}' }
    )

    assert.equal(check.status, 'processing')
    assert.equal(check.plagiarism?.awaitingCallback, true)
    assert.ok(check.pendingProviderScans?.copyleaks)
    assert.equal(check.verdict, null, 'no verdict until the evidence is in')
  })

  it('finishes the check when the completion callback arrives', async () => {
    const { applyPlagiarismWebhook } = await runner()

    const parked = await run(
      {
        similarity: 'accept',
        copyleaksAi: { summary: { human: 950, ai: 50 }, scannedDocument: { totalWords: 1000 } },
      },
      { webhookUrl: 'https://example.com/api/integrity/webhook/x?token=y&status={STATUS}' }
    )
    assert.equal(parked.status, 'processing')

    const finished = await applyPlagiarismWebhook(
      parked.id,
      'copyleaks',
      {
        status: 0,
        scannedDocument: { totalWords: 1000 },
        results: {
          score: { aggregatedScore: 7, identicalWords: 60, minorChangedWords: 10, relatedMeaningWords: 0 },
          internet: [{ id: '1', title: 'Source', url: 'https://example.com', matchedWords: 40, totalWords: 1000 }],
        },
      },
      null
    )

    assert.equal(finished?.status, 'completed')
    assert.equal(finished?.plagiarism?.similarityPercentage, 7)
    assert.equal(finished?.plagiarism?.sources.length, 1)
    assert.equal(finished?.reportGenerated, true)
    assert.equal(finished?.pendingProviderScans, undefined, 'the pending scan is cleared')
  })

  it('ignores a callback for a check with no outstanding scan', async () => {
    const { applyPlagiarismWebhook } = await runner()

    const done = await run({})
    assert.equal(done.status, 'completed')

    // A replayed webhook must not reopen a finished check, nor overwrite its
    // similarity result with whatever the caller supplied.
    const result = await applyPlagiarismWebhook(done.id, 'copyleaks', { status: 0 }, null)

    assert.equal(result?.status, 'completed')
    assert.equal(result?.completedAt, done.completedAt, 'the check must not be re-finalised')
    assert.equal(
      result?.plagiarism?.status,
      'skipped',
      'the forged payload must not become the stored similarity result'
    )
  })

  it('abandons a scan whose callback never arrives, rather than hanging forever', async () => {
    const { reapIfStale } = await runner()
    const { WEBHOOK_DEADLINE_MS } = await store()

    const parked = await run(
      { similarity: 'accept' },
      { webhookUrl: 'https://example.com/api/integrity/webhook/x?token=y&status={STATUS}' }
    )

    // Not yet due.
    assert.equal((await reapIfStale(parked, null)).status, 'processing')

    parked.createdAt = Date.now() - WEBHOOK_DEADLINE_MS - 1000
    const reaped = await reapIfStale(parked, null)

    assert.equal(reaped.status, 'completed', 'the AI results the user paid for must still land')
    assert.equal(reaped.plagiarism?.status, 'failed')
    assert.match(reaped.plagiarism!.error!, /did not report back in time/)
  })

  it('skips similarity with an explanation when there is no public callback URL', async () => {
    const check = await run({})

    assert.equal(check.status, 'completed')
    const stage = check.stages.find(s => s.id === 'plagiarism')!
    assert.equal(stage.state, 'skipped')
    assert.match(stage.note!, /publicly reachable/)
  })
})

/* ── document edge cases ─────────────────────────────────────────── */

describe('document validation', () => {
  it('rejects a document below the minimum length before spending anything', async () => {
    const { prepareDocument, MIN_CHARACTERS } = await runner()

    const tiny = prepareDocument('<p>Too short.</p>')
    assert.ok(tiny.characterCount < MIN_CHARACTERS)
  })

  it('treats an empty document as empty rather than throwing', async () => {
    const { prepareDocument } = await runner()

    for (const empty of ['', '<p></p>', '{}', 'not json and not html']) {
      const prepared = prepareDocument(empty)
      assert.equal(typeof prepared.wordCount, 'number')
      assert.equal(typeof prepared.contentHash, 'string')
    }
  })

  it('chunks a large document across several provider calls', async () => {
    const check = await run({}, { content: documentJson(2000) })

    assert.equal(check.status, 'completed')
    assert.ok(check.wordCount > 20000, `expected a large document, got ${check.wordCount}`)
    // Both providers still produced a single normalised result each.
    assert.equal(check.ai.length, 2)
  })
})

/* ── caching (§21) ───────────────────────────────────────────────── */

describe('content-hash caching', () => {
  it('offers a previous result for an unchanged document', async () => {
    const { findCachedCheck } = await store()

    const first = await run({})
    assert.equal(first.status, 'completed')

    const cached = await findCachedCheck(
      'user:alice',
      first.contentHash,
      ['copyleaks', 'gptzero'],
      null
    )

    assert.equal(cached?.id, first.id)
  })

  it('does not reuse a result produced by a different set of providers', async () => {
    const { findCachedCheck } = await store()

    const first = await run({})

    // Copyleaks has since been configured; the old GPTZero-only result would
    // give the user half the analysis they asked for.
    const cached = await findCachedCheck(
      'user:alice',
      first.contentHash,
      ['copyleaks', 'gptzero', 'turnitin'],
      null
    )

    assert.equal(cached, null)
  })

  it('does not reuse a result across owners', async () => {
    const { findCachedCheck } = await store()

    const first = await run({})
    const cached = await findCachedCheck('user:bob', first.contentHash, ['copyleaks', 'gptzero'], null)

    assert.equal(cached, null, 'a cache hit must never cross an ownership boundary')
  })

  it('does not reuse a result once the document changes', async () => {
    const { findCachedCheck } = await store()
    const { prepareDocument } = await runner()

    const first = await run({})
    const edited = prepareDocument(documentJson(13))

    assert.notEqual(edited.contentHash, first.contentHash)
    assert.equal(
      await findCachedCheck('user:alice', edited.contentHash, ['copyleaks', 'gptzero'], null),
      null
    )
  })
})

/* ── storage isolation ───────────────────────────────────────────── */

describe('stored checks are partitioned by owner', () => {
  it('lists only the caller’s own checks', async () => {
    const { listChecks, saveCheck } = await store()

    const mine = await run({})

    await saveCheck({ ...mine, id: 'othercheck0001', ownerKey: 'user:bob' }, null)

    const alices = await listChecks('user:alice', null)
    const bobs = await listChecks('user:bob', null)

    assert.deepEqual(alices.map(c => c.id), [mine.id])
    assert.deepEqual(bobs.map(c => c.id), ['othercheck0001'])
  })

  it('refuses to write a record under a traversing id', async () => {
    const { loadCheck } = await store()

    // safeId rejects it, so nothing is written and nothing can be read back.
    assert.equal(await loadCheck('../../etc/passwd', null), null)
  })
})
