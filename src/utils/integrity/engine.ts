/**
 * The WordPI consensus engine.
 *
 * Its job is to say something true about disagreeing evidence. The tempting
 * implementation — average the providers and print one number — is the one
 * thing this must not do: 82% and 34% do not average to a meaningful 58%, they
 * mean the two detectors disagree and a person needs to look. §9 forbids the
 * average precisely because it launders that disagreement into false
 * confidence.
 *
 * So the rules are:
 *
 *   - A central value is only computed when the providers actually agree.
 *     Where they don't, the assessment IS the disagreement.
 *   - Every provider's own number is preserved and shown. Nothing is hidden
 *     behind the summary.
 *   - No output asserts that text was AI-generated. Detectors produce
 *     indicators, and the wording says so.
 *   - Absence of evidence is `inconclusive`, never `low_concern`. A check where
 *     both providers failed must not read as a clean bill of health.
 */

import type {
  AIDetectionResult,
  IntegrityAssessment,
  IntegrityVerdict,
  PlagiarismResult,
} from './types'

/**
 * Percentage points of spread above which two providers are treated as
 * disagreeing rather than as noisily agreeing.
 *
 * 30 points is the width at which the two answers stop supporting the same
 * conclusion: 20% vs 45% still both read as "mostly human, some flags", while
 * 34% vs 82% do not describe the same document.
 */
const DISAGREEMENT_POINTS = 30

/** Concern bands, applied only to an agreed central value. */
const MODERATE_THRESHOLD = 25
const HIGH_THRESHOLD = 60

/** Similarity above this is worth calling out in its own right. */
const SIMILARITY_NOTABLE = 15

function asPercent(probability: number): number {
  return Math.round(Math.max(0, Math.min(1, probability)) * 100)
}

/** Providers that produced a usable document-level score. */
function scored(results: AIDetectionResult[]): AIDetectionResult[] {
  return results.filter(
    result =>
      result.aiProbability !== null &&
      (result.status === 'completed' || result.status === 'partial')
  )
}

function labelFor(providerId: string): string {
  // Kept local rather than imported from the registry so the engine stays
  // testable without instantiating providers that read process.env.
  if (providerId === 'copyleaks') return 'Copyleaks'
  if (providerId === 'gptzero') return 'GPTZero'
  return providerId
}

/**
 * Builds the verdict.
 *
 * `plagiarism` is passed in but never folded into the AI assessment — §10 is
 * explicit that similarity and AI detection are separate claims about a
 * document, and merging them would let a well-cited literature review look
 * like an AI-writing problem. It only contributes recommendations.
 */
export function assess(
  ai: AIDetectionResult[],
  plagiarism: PlagiarismResult | null
): IntegrityVerdict {
  const usable = scored(ai)
  const percentages = usable.map(result => asPercent(result.aiProbability as number))
  const contributingProviders = usable.map(result => result.provider)

  const failed = ai.filter(result => result.status === 'failed')

  // ── no usable evidence ──────────────────────────────────────────
  if (!usable.length) {
    return {
      assessment: 'inconclusive',
      headline: 'No AI-writing analysis could be completed for this document.',
      detail: failed.length
        ? [
            `${failed.length === 1 ? 'The detector' : 'Both detectors'} could not analyse this document, so nothing can be concluded either way.`,
            'This is not a result of "no indicators found" — the analysis did not run.',
          ]
        : ['No detection provider was available for this check.'],
      spreadPoints: null,
      contributingProviders: [],
      recommendations: [
        'Run the check again — provider outages are usually brief.',
        'If the problem persists, confirm the document contains enough text to analyse.',
      ],
    }
  }

  const highest = Math.max(...percentages)
  const lowest = Math.min(...percentages)
  const spreadPoints = usable.length > 1 ? highest - lowest : null

  // ── providers disagree ──────────────────────────────────────────
  if (spreadPoints !== null && spreadPoints >= DISAGREEMENT_POINTS) {
    const ordered = [...usable].sort(
      (a, b) => (b.aiProbability as number) - (a.aiProbability as number)
    )
    return {
      assessment: 'provider_disagreement',
      headline: 'The detectors disagree about this document, so manual review is recommended.',
      detail: [
        ordered
          .map(r => `${labelFor(r.provider)} reports ${asPercent(r.aiProbability as number)}%`)
          .join(', and ') + '.',
        `That is a spread of ${spreadPoints} percentage points — too wide for the two results to describe the same document.`,
        'A single combined figure is deliberately not shown here, because averaging results that disagree would suggest more certainty than the evidence supports.',
      ],
      spreadPoints,
      contributingProviders,
      recommendations: [
        'Read the flagged sections yourself and judge whether they reflect your own understanding.',
        'Where a passage was drafted with assistance, revise it in your own words.',
        'Keep your drafts and notes — they are the strongest evidence of your own authorship.',
        ...similarityRecommendations(plagiarism),
      ],
    }
  }

  // ── providers agree; a central value is meaningful ──────────────
  const mean = Math.round(percentages.reduce((sum, p) => sum + p, 0) / percentages.length)

  let assessment: IntegrityAssessment
  let headline: string

  if (mean >= HIGH_THRESHOLD) {
    assessment = 'high_concern'
    headline = 'The analysed text shows strong characteristics associated with AI-generated writing.'
  } else if (mean >= MODERATE_THRESHOLD) {
    assessment = 'moderate_concern'
    headline = 'Parts of the analysed text show characteristics associated with AI-generated writing.'
  } else {
    assessment = 'low_concern'
    headline = 'The analysed text shows few characteristics associated with AI-generated writing.'
  }

  const detail: string[] = [
    usable
      .map(r => `${labelFor(r.provider)}: ${asPercent(r.aiProbability as number)}%`)
      .join(' · '),
  ]

  if (usable.length > 1) {
    detail.push(
      `Both detectors agree within ${spreadPoints} percentage points, which makes the combined reading more dependable than either result alone.`
    )
  } else {
    detail.push(
      `Only ${labelFor(usable[0].provider)} returned a result for this document, so there is no second opinion to compare it against.`
    )
  }

  detail.push(
    'AI-detection scores are probabilistic indicators, not proof of how the text was written.'
  )

  if (failed.length) {
    detail.push(
      `${failed.map(r => labelFor(r.provider)).join(' and ')} did not complete, so this reading is based on partial coverage.`
    )
  }

  return {
    assessment,
    headline,
    detail,
    spreadPoints,
    contributingProviders,
    recommendations: recommendationsFor(assessment, plagiarism),
  }
}

function similarityRecommendations(plagiarism: PlagiarismResult | null): string[] {
  if (!plagiarism || plagiarism.status !== 'completed') return []
  if (plagiarism.similarityPercentage < SIMILARITY_NOTABLE) return []

  return [
    `Review the ${plagiarism.similarityPercentage}% of text that matches other sources and confirm each match is quoted or cited.`,
  ]
}

function recommendationsFor(
  assessment: IntegrityAssessment,
  plagiarism: PlagiarismResult | null
): string[] {
  const base: string[] = []

  if (assessment === 'high_concern') {
    base.push(
      'Review the flagged sections closely and rewrite any passage that does not reflect your own understanding.',
      'Check that every factual claim in those sections is supported by a source you have actually read.'
    )
  } else if (assessment === 'moderate_concern') {
    base.push(
      'Review the flagged sections and make sure the explanation is in your own words.',
      'Verify the citations attached to the flagged passages.'
    )
  } else {
    base.push(
      'Skim the flagged sections to confirm they read the way you intended.',
      'Verify that quotations are correctly attributed.'
    )
  }

  base.push(...similarityRecommendations(plagiarism))
  base.push('Confirm the final document reflects your own understanding before you submit it.')

  return base
}

/**
 * The short status line the editor and the project card show.
 *
 * Kept beside `assess` so the summary wording cannot drift away from the
 * verdict wording it is summarising.
 */
export function assessmentLabel(assessment: IntegrityAssessment): string {
  switch (assessment) {
    case 'low_concern':
      return 'Low'
    case 'moderate_concern':
      return 'Moderate'
    case 'high_concern':
      return 'High'
    case 'provider_disagreement':
      return 'Needs review'
    case 'inconclusive':
      return 'Inconclusive'
  }
}

/** Colour intent for the dashboard. Never green for `inconclusive`. */
export function assessmentTone(
  assessment: IntegrityAssessment
): 'positive' | 'caution' | 'warning' | 'neutral' {
  switch (assessment) {
    case 'low_concern':
      return 'positive'
    case 'moderate_concern':
      return 'caution'
    case 'high_concern':
      return 'warning'
    case 'provider_disagreement':
      return 'caution'
    case 'inconclusive':
      return 'neutral'
  }
}

/** Thresholds are exported so the tests assert against one definition. */
export const THRESHOLDS = {
  DISAGREEMENT_POINTS,
  MODERATE_THRESHOLD,
  HIGH_THRESHOLD,
  SIMILARITY_NOTABLE,
}
