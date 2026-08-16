/**
 * The provider-independent vocabulary of the Integrity Checker.
 *
 * Nothing in this file mentions Copyleaks or GPTZero. That is the point: the
 * engine, the store, the API routes, the dashboard and the PDF all read these
 * shapes, so adding Turnitin or Originality.ai later is a new file under
 * `providers/` and one line in the registry, not a change to any consumer.
 *
 * Provider ids are a plain `string` rather than a union for the same reason —
 * a union would force every switch statement in the app to be revisited the
 * day a third provider appears. Display names come from the provider itself
 * (see `IntegrityProvider.label`).
 */

/** Where a check is in its lifecycle. Mirrors the humanizer's job vocabulary. */
export type IntegrityStatus = 'queued' | 'processing' | 'completed' | 'failed'

/**
 * WordPI's own reading of the evidence.
 *
 * `provider_disagreement` is deliberately a peer of the concern levels rather
 * than a modifier on them. When two detectors disagree materially, the honest
 * output is "we don't know", not a concern level with an asterisk.
 */
export type IntegrityAssessment =
  | 'low_concern'
  | 'moderate_concern'
  | 'high_concern'
  | 'provider_disagreement'
  | 'inconclusive'

/** Per-provider outcome. `skipped` means we never asked (unconfigured//disabled). */
export type ProviderRunStatus = 'completed' | 'failed' | 'skipped' | 'partial'

/**
 * A span of the analysed text, addressed by character offset into the
 * normalised plain text (see `extract.ts`).
 *
 * Offsets rather than quoted text: quoting means storing the student's prose a
 * second time, and §20 asks us not to keep document content we do not need.
 * The dashboard resolves offsets back to text it already holds.
 */
export interface TextSpan {
  start: number
  length: number
}

/** A passage a provider flagged, with enough context to explain why. */
export interface SectionDetectionResult {
  span: TextSpan
  /** 0..1. Null when the provider flags a span without scoring it. */
  aiProbability: number | null
  /** Heading path the span falls under, e.g. "2.1 Overview". Best effort. */
  section?: string
  /** Provider's own label, normalised: human | ai | mixed. */
  classification?: 'human' | 'ai' | 'mixed'
}

/** One provider's AI-detection verdict for one submission. */
export interface AIDetectionResult {
  provider: string
  /** 0..1, or null when the provider could not produce a document-level score. */
  aiProbability: number | null
  humanProbability: number | null
  analyzedWords: number
  analyzedCharacters?: number
  sections?: SectionDetectionResult[]
  status: ProviderRunStatus
  /** Provider's model/engine version, recorded so a cached result can be
   *  invalidated when the provider retrains (see §21's cache key). */
  modelVersion?: string
  /** Safe-to-display reason when status is `failed` or `partial`. */
  error?: string
  /** Provider-side identifier, kept so a bad run can be investigated (§6). */
  providerReference?: string
  /** True when the run used the provider's free sandbox rather than credits. */
  sandbox?: boolean
}

export interface PlagiarismSource {
  title?: string
  url?: string
  author?: string
  /** 0..100, as a share of the analysed document. */
  similarityPercentage?: number
  matchedWords?: number
  /** Coarse bucket used by the dashboard's breakdown. */
  category: 'internet' | 'academic' | 'repository' | 'other'
  /** Where in our text this source matched. */
  spans?: TextSpan[]
}

export interface PlagiarismResult {
  provider: string
  /** 0..100. Overall matched share of the document. */
  similarityPercentage: number
  matchedWords: number
  sources: PlagiarismSource[]
  status: ProviderRunStatus
  error?: string
  providerReference?: string
  sandbox?: boolean
}

/**
 * What the engine concluded, in a form the dashboard and the PDF can render
 * without re-deriving anything.
 */
export interface IntegrityVerdict {
  assessment: IntegrityAssessment
  /** One sentence, already phrased for a student. Never asserts certainty. */
  headline: string
  /** Supporting sentences. May be empty. */
  detail: string[]
  /**
   * The spread between the highest and lowest provider AI probability, in
   * percentage points. Surfaced rather than hidden — §11 forbids concealing
   * disagreement.
   */
  spreadPoints: number | null
  /** Providers that actually returned an AI score, in the order they ran. */
  contributingProviders: string[]
  /** Actionable next steps, ordered most-important first. */
  recommendations: string[]
}

/** Document identity as it appears on the report cover. */
export interface CheckedDocument {
  projectId: string
  title: string
  documentType?: string
  academicLevel?: string
  studentName?: string
  department?: string
  institution?: string
}

/**
 * The stored record. This is what the store persists and every route returns.
 *
 * Note what is NOT here: the document text. It is sent to providers, held in
 * memory for the duration of a run, and dropped. Only offsets survive.
 */
export interface IntegrityCheck {
  id: string
  ownerKey: string
  document: CheckedDocument
  status: IntegrityStatus
  /** Progress stages, so the UI can render §26's checklist without guessing. */
  stages: CheckStage[]
  wordCount: number
  characterCount: number
  /** djb2 hash of the normalised text — the §21 cache key. */
  contentHash: string
  ai: AIDetectionResult[]
  plagiarism: PlagiarismResult | null
  verdict: IntegrityVerdict | null
  /** Set when the report PDF has been generated and stored. */
  reportGenerated: boolean
  /** Present only while a Copyleaks scan is outstanding. */
  pendingProviderScans?: Record<string, string>
  createdAt: number
  completedAt: number | null
  /** Populated only when status is `failed`. */
  error?: string
}

export type CheckStageId =
  | 'prepare'
  | 'ai-detection'
  | 'plagiarism'
  | 'compare'
  | 'report'

export interface CheckStage {
  id: CheckStageId
  label: string
  state: 'pending' | 'active' | 'done' | 'skipped' | 'failed'
  /** Shown beneath the stage when it did not simply succeed. */
  note?: string
}

/** The five stages every check walks through, in order. */
export function initialStages(): CheckStage[] {
  return [
    { id: 'prepare', label: 'Preparing document', state: 'pending' },
    { id: 'ai-detection', label: 'Checking AI patterns', state: 'pending' },
    { id: 'plagiarism', label: 'Checking similarity', state: 'pending' },
    { id: 'compare', label: 'Comparing results', state: 'pending' },
    { id: 'report', label: 'Generating report', state: 'pending' },
  ]
}

/**
 * What a provider needs in order to run. Deliberately minimal: providers
 * receive normalised text and nothing about our storage, auth or UI.
 */
export interface ProviderRequest {
  /** Normalised plain text. Paragraph boundaries preserved as blank lines. */
  text: string
  /** Stable id for this submission, reused as the provider's scan id. */
  scanId: string
  /** Resolves a character offset to its enclosing heading, for `section`. */
  sectionAt?: (offset: number) => string | undefined
  /** Use the provider's free test mode instead of spending credits. */
  sandbox?: boolean
  /** Public URL the provider should call on completion, when it supports it. */
  webhookUrl?: string
  /** ISO-639-1, when the caller knows it. */
  language?: string
}

/**
 * The contract every detection service is adapted to.
 *
 * `checkPlagiarism` is optional because most AI detectors do not offer it —
 * GPTZero being the case in hand. The engine asks `supportsPlagiarism` rather
 * than probing for the method, so a provider can also decline at runtime when
 * it is configured without the necessary plan.
 */
export interface IntegrityProvider {
  /** Stable machine id, e.g. "copyleaks". Persisted in results. */
  readonly id: string
  /** Human-facing name for tables and the report, e.g. "Copyleaks". */
  readonly label: string
  /** False when required credentials are absent; the engine then skips it. */
  isConfigured(): boolean
  supportsPlagiarism(): boolean
  /**
   * Longest text this provider accepts in one call, in characters. The engine
   * chunks anything larger and merges the results.
   */
  readonly maxCharacters: number
  /** Shortest text worth submitting. Below this the provider rejects outright. */
  readonly minCharacters: number
  checkAI(request: ProviderRequest): Promise<AIDetectionResult>
  checkPlagiarism?(request: ProviderRequest): Promise<PlagiarismResult>
  /**
   * Converts a provider's completion callback into a finished result.
   * Only implemented by providers whose plagiarism scan is webhook-driven.
   */
  resolvePlagiarismWebhook?(
    payload: unknown,
    scanId: string
  ): Promise<PlagiarismResult>
}
