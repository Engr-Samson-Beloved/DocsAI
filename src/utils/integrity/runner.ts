/**
 * The pipeline: document in, stored verdict and report out.
 *
 * Runs after the response has been sent (Next's `after()`), because the
 * providers take anywhere from seconds to minutes and §5 forbids making the
 * browser hold a request open for that. The client polls
 * `/api/integrity/check/[id]/status` in the meantime, exactly as the Humanizer
 * already does for rewrites.
 *
 * The order below is the order in §4, with one deliberate difference: the AI
 * detectors and the similarity submission are started together rather than in
 * sequence. They are independent services and running them serially would make
 * every check as slow as the sum of both.
 *
 * Failure is never allowed to lose a check. Every stage records what happened
 * and the run continues; a check only ends `failed` when there is genuinely
 * nothing to report.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AIDetectionResult,
  CheckStageId,
  CheckedDocument,
  IntegrityCheck,
  PlagiarismResult,
  ProviderRequest,
} from './types'
import { initialStages } from './types'
import { extractDocumentText, sectionResolver } from './extract'
import { configuredProviders, plagiarismProvider, providerById } from './providers/registry'
import { assess } from './engine'
import { loadCheck, saveCheck, saveReport, WEBHOOK_DEADLINE_MS } from './store'

/**
 * Renders the report PDF.
 *
 * Imported lazily rather than at module load because `./report` is a .tsx file
 * and the test suite runs on Node's type stripping, which cannot parse JSX — a
 * static import here would make this whole module untestable. Deferring it
 * also keeps @react-pdf out of the module graph for every request that never
 * generates a report, which is all of them except the last one.
 */
type ReportGenerator = (check: IntegrityCheck) => Promise<Uint8Array>

let reportGenerator: ReportGenerator | null = null

/** Test seam: substitute the renderer. Pass null to restore the real one. */
export function setReportGenerator(generator: ReportGenerator | null): void {
  reportGenerator = generator
}

async function renderReport(check: IntegrityCheck): Promise<Uint8Array> {
  if (reportGenerator) return reportGenerator(check)
  const { generateReportPdf } = await import('./report')
  return generateReportPdf(check)
}

/**
 * Shortest document worth submitting.
 *
 * Both providers reject anything under 255 characters, and a detector's output
 * on a paragraph is closer to noise than to evidence. Rejecting here gives the
 * user a straight answer instead of a provider error relayed through two
 * layers.
 */
export const MIN_CHARACTERS = 255

/** Above this we warn about cost before spending anything. */
export const LARGE_DOCUMENT_WORDS = 5000

export interface PreparedDocument {
  text: string
  wordCount: number
  characterCount: number
  contentHash: string
  sectionAt: (offset: number) => string | undefined
}

export function prepareDocument(content: string | object): PreparedDocument {
  const extracted = extractDocumentText(content)
  return {
    text: extracted.text,
    wordCount: extracted.wordCount,
    characterCount: extracted.characterCount,
    contentHash: extracted.contentHash,
    sectionAt: sectionResolver(extracted.sections),
  }
}

/**
 * What a scan will cost, in the only units we can state honestly.
 *
 * Deliberately not priced in currency: both providers bill per credit against a
 * plan this app does not know, and inventing a naira figure would be a number
 * the user could hold us to. Credits and word counts are facts; a price is not.
 */
export function estimateUsage(wordCount: number): {
  wordCount: number
  providers: { id: string; label: string; note: string }[]
} {
  return {
    wordCount,
    providers: configuredProviders().map(provider => ({
      id: provider.id,
      label: provider.label,
      note:
        provider.id === 'copyleaks'
          ? `≈${Math.max(1, Math.ceil(wordCount / 250))} credits (Copyleaks bills per 250 words)`
          : 'One document scan',
    })),
  }
}

function setStage(
  check: IntegrityCheck,
  id: CheckStageId,
  state: IntegrityCheck['stages'][number]['state'],
  note?: string
): void {
  const stage = check.stages.find(s => s.id === id)
  if (!stage) return
  stage.state = state
  stage.note = note
}

/** Creates the record the route answers with, before any provider is called. */
export function createCheck(
  id: string,
  ownerKey: string,
  document: CheckedDocument,
  prepared: PreparedDocument
): IntegrityCheck {
  return {
    id,
    ownerKey,
    document,
    status: 'queued',
    stages: initialStages(),
    wordCount: prepared.wordCount,
    characterCount: prepared.characterCount,
    contentHash: prepared.contentHash,
    ai: [],
    plagiarism: null,
    verdict: null,
    reportGenerated: false,
    createdAt: Date.now(),
    completedAt: null,
  }
}

/**
 * Runs the providers and either finishes the check or parks it on a webhook.
 *
 * `text` is a parameter rather than something re-read from storage because the
 * document text is never stored — see the note at the top of `store.ts`.
 */
export async function runCheck(
  check: IntegrityCheck,
  prepared: PreparedDocument,
  supabase: SupabaseClient | null,
  options: { sandbox?: boolean; webhookUrl?: string } = {}
): Promise<IntegrityCheck> {
  check.status = 'processing'
  setStage(check, 'prepare', 'done')
  setStage(check, 'ai-detection', 'active')
  await persist(check, supabase)

  const request: ProviderRequest = {
    text: prepared.text,
    scanId: check.id,
    sectionAt: prepared.sectionAt,
    sandbox: options.sandbox,
    webhookUrl: options.webhookUrl,
  }

  const aiProviders = configuredProviders()
  const similarity = plagiarismProvider()

  // Started together: they are independent services, and running them in
  // sequence would make every check as slow as both combined.
  const aiRuns = aiProviders.map(provider =>
    provider.checkAI(request).catch(
      (err): AIDetectionResult => ({
        provider: provider.id,
        aiProbability: null,
        humanProbability: null,
        analyzedWords: 0,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      })
    )
  )

  const plagiarismRun: Promise<PlagiarismResult | null> =
    similarity && similarity.checkPlagiarism
      ? similarity.checkPlagiarism({ ...request, scanId: `${check.id}-sim` }).catch(
          (err): PlagiarismResult => ({
            provider: similarity.id,
            similarityPercentage: 0,
            matchedWords: 0,
            sources: [],
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          })
        )
      : Promise.resolve(null)

  const [aiResults, plagiarismResult] = await Promise.all([
    Promise.all(aiRuns),
    plagiarismRun,
  ])

  check.ai = aiResults
  check.plagiarism = plagiarismResult

  const anyAiSucceeded = aiResults.some(r => r.status === 'completed' || r.status === 'partial')
  setStage(
    check,
    'ai-detection',
    anyAiSucceeded ? 'done' : 'failed',
    anyAiSucceeded
      ? describePartialAi(aiResults)
      : 'No AI detector completed for this document.'
  )

  if (!plagiarismResult) {
    setStage(check, 'plagiarism', 'skipped', 'No similarity provider is configured.')
  } else if (plagiarismResult.status === 'skipped') {
    setStage(check, 'plagiarism', 'skipped', plagiarismResult.error)
  } else if (plagiarismResult.status === 'failed') {
    setStage(check, 'plagiarism', 'failed', plagiarismResult.error)
  } else if (plagiarismResult.awaitingCallback) {
    setStage(check, 'plagiarism', 'active', 'Similarity scan running — results arrive shortly.')
    check.pendingProviderScans = {
      [plagiarismResult.provider]: plagiarismResult.providerReference || `${check.id}-sim`,
    }
    // Park here. The webhook route calls finalizeCheck when the scan lands, and
    // reapCheck finishes without it if the callback never arrives.
    await persist(check, supabase)
    return check
  } else {
    setStage(check, 'plagiarism', 'done')
  }

  return finalizeCheck(check, supabase)
}

function describePartialAi(results: AIDetectionResult[]): string | undefined {
  const failed = results.filter(r => r.status === 'failed')
  if (!failed.length) return undefined
  const names = failed.map(r => (r.provider === 'copyleaks' ? 'Copyleaks' : r.provider === 'gptzero' ? 'GPTZero' : r.provider))
  return `${names.join(' and ')} unavailable — the report was generated with partial results.`
}

/**
 * Produces the verdict and the PDF, then closes the check.
 *
 * Called from three places: the end of a run with no outstanding scan, the
 * webhook when a similarity result lands, and the reaper when one never does.
 */
export async function finalizeCheck(
  check: IntegrityCheck,
  supabase: SupabaseClient | null
): Promise<IntegrityCheck> {
  setStage(check, 'compare', 'active')
  check.verdict = assess(check.ai, check.plagiarism)
  setStage(check, 'compare', 'done')

  // A check with no usable evidence at all is a failure, not a clean result.
  const anyUsable = check.ai.some(r => r.status === 'completed' || r.status === 'partial')
  const similarityUsable = check.plagiarism?.status === 'completed'

  if (!anyUsable && !similarityUsable) {
    check.status = 'failed'
    check.error = 'Integrity check could not be completed. Please try again.'
    setStage(check, 'report', 'skipped')
    check.completedAt = Date.now()
    await persist(check, supabase)
    return check
  }

  setStage(check, 'report', 'active')
  try {
    const pdf = await renderReport(check)
    await saveReport(check.id, pdf, supabase)
    check.reportGenerated = true
    setStage(check, 'report', 'done')
  } catch (err) {
    // A report that failed to render must not discard results the user paid
    // for. The check completes; only the download is unavailable.
    console.error('Integrity report generation failed:', err)
    check.reportGenerated = false
    setStage(
      check,
      'report',
      'failed',
      'The PDF report could not be generated, but your results are shown below.'
    )
  }

  check.status = 'completed'
  check.completedAt = Date.now()
  delete check.pendingProviderScans
  await persist(check, supabase)
  return check
}

/**
 * Closes a check whose webhook never arrived.
 *
 * Called opportunistically from the status route rather than from a scheduler,
 * because this app has no job runner and adding one for a single timeout would
 * be a lot of machinery. The consequence is that an abandoned check is reaped
 * when someone next looks at it, which is precisely when it matters.
 */
export async function reapIfStale(
  check: IntegrityCheck,
  supabase: SupabaseClient | null
): Promise<IntegrityCheck> {
  if (check.status !== 'processing') return check
  if (!check.pendingProviderScans) return check
  if (Date.now() - check.createdAt < WEBHOOK_DEADLINE_MS) return check

  if (check.plagiarism) {
    check.plagiarism = {
      ...check.plagiarism,
      status: 'failed',
      awaitingCallback: false,
      error: 'The similarity scan did not report back in time.',
    }
  }
  setStage(check, 'plagiarism', 'failed', 'The similarity scan did not report back in time.')

  return finalizeCheck(check, supabase)
}

/**
 * Applies a provider's completion callback to a parked check.
 *
 * Returns null when the callback does not correspond to an outstanding scan,
 * which is the case for a replayed or forged webhook.
 */
export async function applyPlagiarismWebhook(
  checkId: string,
  providerId: string,
  payload: unknown,
  supabase: SupabaseClient | null
): Promise<IntegrityCheck | null> {
  const check = await loadCheck(checkId, supabase)
  if (!check) return null
  if (check.status === 'completed' || check.status === 'failed') return check

  const provider = providerById(providerId)
  if (!provider?.resolvePlagiarismWebhook) return null

  const scanId = check.pendingProviderScans?.[providerId]
  if (!scanId) return null

  try {
    check.plagiarism = await provider.resolvePlagiarismWebhook(payload, scanId)
    setStage(
      check,
      'plagiarism',
      check.plagiarism.status === 'completed' ? 'done' : 'failed',
      check.plagiarism.error
    )
  } catch (err) {
    check.plagiarism = {
      provider: providerId,
      similarityPercentage: 0,
      matchedWords: 0,
      sources: [],
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    }
    setStage(check, 'plagiarism', 'failed', check.plagiarism.error)
  }

  return finalizeCheck(check, supabase)
}

/** Save, but never let a storage hiccup abort a run mid-flight. */
async function persist(check: IntegrityCheck, supabase: SupabaseClient | null): Promise<void> {
  try {
    await saveCheck(check, supabase)
  } catch (err) {
    console.error('Could not persist integrity check progress:', err)
  }
}
