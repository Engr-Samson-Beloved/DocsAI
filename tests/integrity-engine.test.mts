/**
 * Consensus engine and report shaping (§9, §10, §22).
 *
 * The engine's whole job is to be honest about disagreement, so most of these
 * tests are about what it must NOT say: no average across results that
 * conflict, no "AI GENERATED" assertion, no clean bill of health when the
 * analysis simply failed to run.
 *
 * Run: npm test
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { AIDetectionResult, PlagiarismResult } from '../src/utils/integrity/types.ts'

const engine = () => import('../src/utils/integrity/engine.ts')
const reportData = () => import('../src/utils/integrity/reportData.ts')

function ai(provider: string, probability: number | null, status: AIDetectionResult['status'] = 'completed'): AIDetectionResult {
  return {
    provider,
    aiProbability: probability,
    humanProbability: probability === null ? null : 1 - probability,
    analyzedWords: 5000,
    status,
  }
}

function similarity(percentage: number, status: PlagiarismResult['status'] = 'completed'): PlagiarismResult {
  return {
    provider: 'copyleaks',
    similarityPercentage: percentage,
    matchedWords: 100,
    sources: [],
    status,
  }
}

/** Everything the engine can emit, flattened, for wording assertions. */
function allText(verdict: { headline: string; detail: string[]; recommendations: string[] }): string {
  return [verdict.headline, ...verdict.detail, ...verdict.recommendations].join(' ')
}

describe('agreement between providers', () => {
  it('reports high concern when both providers agree the indicators are strong', async () => {
    const { assess } = await engine()

    const verdict = assess([ai('copyleaks', 0.78), ai('gptzero', 0.71)], null)

    assert.equal(verdict.assessment, 'high_concern')
    assert.equal(verdict.spreadPoints, 7)
    assert.deepEqual(verdict.contributingProviders, ['copyleaks', 'gptzero'])
    // Both numbers survive into the output; neither is hidden behind a summary.
    assert.match(allText(verdict), /78%/)
    assert.match(allText(verdict), /71%/)
  })

  it('reports low concern when both providers agree the indicators are weak', async () => {
    const { assess } = await engine()

    const verdict = assess([ai('copyleaks', 0.08), ai('gptzero', 0.12)], null)
    assert.equal(verdict.assessment, 'low_concern')
  })

  it('reports moderate concern in the middle band', async () => {
    const { assess } = await engine()

    const verdict = assess([ai('copyleaks', 0.38), ai('gptzero', 0.42)], null)
    assert.equal(verdict.assessment, 'moderate_concern')
  })
})

describe('disagreement between providers', () => {
  it('names the disagreement instead of averaging it away', async () => {
    const { assess } = await engine()

    // The spec's own example: 82% and 34%.
    const verdict = assess([ai('copyleaks', 0.82), ai('gptzero', 0.34)], null)

    assert.equal(verdict.assessment, 'provider_disagreement')
    assert.equal(verdict.spreadPoints, 48)
    assert.match(allText(verdict), /disagree/i)
    assert.match(allText(verdict), /manual review|review/i)

    // 82 and 34 average to 58. That number must appear nowhere: presenting it
    // would claim a confidence the evidence does not support.
    assert.ok(!allText(verdict).includes('58%'), 'must not publish an average of conflicting results')
  })

  it('treats a 30-point spread as the boundary', async () => {
    const { assess, THRESHOLDS } = await engine()

    assert.equal(THRESHOLDS.DISAGREEMENT_POINTS, 30)

    const justUnder = assess([ai('a', 0.5), ai('b', 0.21)], null)
    const justOver = assess([ai('a', 0.5), ai('b', 0.2)], null)

    assert.notEqual(justUnder.assessment, 'provider_disagreement')
    assert.equal(justOver.assessment, 'provider_disagreement')
  })
})

describe('partial and absent evidence (§22)', () => {
  it('still produces a verdict when one provider failed, and says so', async () => {
    const { assess } = await engine()

    const verdict = assess([ai('copyleaks', null, 'failed'), ai('gptzero', 0.65)], null)

    assert.equal(verdict.assessment, 'high_concern')
    assert.deepEqual(verdict.contributingProviders, ['gptzero'])
    assert.match(allText(verdict), /Copyleaks/)
    assert.match(allText(verdict), /partial coverage|no second opinion/i)
  })

  it('notes the absence of a second opinion when only one provider ran', async () => {
    const { assess } = await engine()

    const verdict = assess([ai('gptzero', 0.2)], null)

    assert.equal(verdict.spreadPoints, null)
    assert.match(allText(verdict), /no second opinion/i)
  })

  it('is inconclusive — never low concern — when both providers failed', async () => {
    const { assess } = await engine()

    const verdict = assess([ai('copyleaks', null, 'failed'), ai('gptzero', null, 'failed')], null)

    assert.equal(verdict.assessment, 'inconclusive')
    // The dangerous failure mode: "nothing detected" reading as "nothing there".
    assert.notEqual(verdict.assessment, 'low_concern')
    assert.match(allText(verdict), /did not run|nothing can be concluded/i)
  })

  it('is inconclusive when no provider ran at all', async () => {
    const { assess } = await engine()
    assert.equal(assess([], null).assessment, 'inconclusive')
  })
})

describe('language discipline (§9, §10)', () => {
  it('never asserts that a document was AI generated', async () => {
    const { assess } = await engine()

    const cases = [
      assess([ai('copyleaks', 0.99), ai('gptzero', 0.98)], null),
      assess([ai('copyleaks', 0.5), ai('gptzero', 0.5)], null),
      assess([ai('copyleaks', 0.01), ai('gptzero', 0.02)], null),
    ]

    for (const verdict of cases) {
      const text = allText(verdict)
      assert.ok(!/AI GENERATED/.test(text), 'must not assert AI authorship as fact')
      assert.ok(
        !/\bis AI[- ]written\b/i.test(text) && !/\bwas written by AI\b/i.test(text),
        `asserted authorship: ${text}`
      )
    }

    // The permitted framing, from the spec.
    assert.match(allText(cases[0]), /characteristics associated with AI-generated writing/i)
  })

  it('acknowledges that scores are probabilistic', async () => {
    const { assess } = await engine()
    const verdict = assess([ai('copyleaks', 0.8), ai('gptzero', 0.78)], null)
    assert.match(allText(verdict), /probabilistic|not proof/i)
  })

  it('never presents similarity as confirmed plagiarism', async () => {
    const { assess } = await engine()

    const verdict = assess([ai('copyleaks', 0.1), ai('gptzero', 0.1)], similarity(64))
    const text = allText(verdict)

    assert.ok(!/plagiaris/i.test(text), `the verdict must not allege plagiarism: ${text}`)
    assert.match(text, /matches other sources|cited/i)
  })

  it('keeps similarity out of the AI assessment entirely', async () => {
    const { assess } = await engine()

    // A heavily-quoted but human-written literature review.
    const withSimilarity = assess([ai('copyleaks', 0.05), ai('gptzero', 0.07)], similarity(70))
    const without = assess([ai('copyleaks', 0.05), ai('gptzero', 0.07)], null)

    assert.equal(withSimilarity.assessment, 'low_concern')
    assert.equal(withSimilarity.assessment, without.assessment)
  })

  it('adds a similarity recommendation only when there is something to review', async () => {
    const { assess } = await engine()

    const high = assess([ai('a', 0.1)], similarity(40))
    const low = assess([ai('a', 0.1)], similarity(2))

    assert.ok(high.recommendations.some(r => r.includes('40%')))
    assert.ok(!low.recommendations.some(r => /matches other sources/.test(r)))
  })

  it('does not recommend acting on a similarity scan that never completed', async () => {
    const { assess } = await engine()

    const verdict = assess([ai('a', 0.1)], similarity(0, 'failed'))
    assert.ok(!verdict.recommendations.some(r => /matches other sources/.test(r)))
  })

  it('always ends with the user owning the final decision', async () => {
    const { assess } = await engine()

    for (const verdict of [
      assess([ai('a', 0.9), ai('b', 0.88)], null),
      assess([ai('a', 0.9), ai('b', 0.1)], null),
      assess([ai('a', 0.05)], null),
    ]) {
      assert.match(
        verdict.recommendations.join(' '),
        /your own understanding|your own authorship|your own words/i
      )
    }
  })
})

describe('labels and tone', () => {
  it('never shows inconclusive as a positive result', async () => {
    const { assessmentTone, assessmentLabel } = await engine()

    assert.equal(assessmentTone('inconclusive'), 'neutral')
    assert.notEqual(assessmentTone('inconclusive'), 'positive')
    assert.equal(assessmentLabel('inconclusive'), 'Inconclusive')
  })

  it('labels disagreement as needing review rather than as a severity', async () => {
    const { assessmentLabel } = await engine()
    assert.equal(assessmentLabel('provider_disagreement'), 'Needs review')
  })
})

describe('report data shaping (§15, §16, §17)', () => {
  it('carries the required disclaimer verbatim', async () => {
    const { DISCLAIMER } = await reportData()

    assert.match(DISCLAIMER, /probabilistic indicators/)
    assert.match(DISCLAIMER, /not be interpreted as definitive proof/)
    assert.match(DISCLAIMER, /do not independently establish plagiarism/)
    assert.match(DISCLAIMER, /verify citations before submission/)
  })

  it('renders a missing score as an em dash, not as zero', async () => {
    const { percent } = await reportData()

    assert.equal(percent(null), '—')
    assert.equal(percent(0), '0%')
    assert.equal(percent(0.784), '78%')
  })

  it('groups flagged passages by section, strongest first', async () => {
    const { summariseFlagged } = await reportData()

    const rows = summariseFlagged([
      { span: { start: 0, length: 5 }, aiProbability: 0.9, section: '2.1 Overview' },
      { span: { start: 10, length: 5 }, aiProbability: 0.7, section: '2.1 Overview' },
      { span: { start: 20, length: 5 }, aiProbability: 0.6, section: '2.2 Method' },
    ])

    assert.equal(rows.length, 2)
    assert.equal(rows[0].section, '2.1 Overview')
    assert.equal(rows[0].count, 2)
    assert.equal(rows[0].peak, '90%', 'the peak, not the mean, is what a reviewer needs')
  })

  it('keeps unattributed flags rather than dropping them', async () => {
    const { summariseFlagged } = await reportData()

    const rows = summariseFlagged([{ span: { start: 0, length: 5 }, aiProbability: 0.8 }])
    assert.equal(rows[0].section, 'Unattributed passages')
  })

  it('splits similarity by source origin and omits empty categories', async () => {
    const { categoryTotals } = await reportData()

    const totals = categoryTotals([
      { category: 'internet', similarityPercentage: 4 },
      { category: 'academic', similarityPercentage: 2 },
      { category: 'other', similarityPercentage: 1 },
    ])

    assert.deepEqual(totals, [
      { label: 'Web sources', value: 4 },
      { label: 'Academic sources', value: 2 },
      { label: 'Other sources', value: 1 },
    ])
    assert.ok(!totals.some(t => t.label === 'Repositories'))
  })
})
