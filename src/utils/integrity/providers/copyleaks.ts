/**
 * Copyleaks adapter — AI detection and similarity.
 *
 * Written against the current API reference (verified August 2026):
 *   login       POST https://id.copyleaks.com/v3/account/login/api
 *   AI detector POST https://api.copyleaks.com/v2/writer-detector/{scanId}/check
 *   similarity  PUT  https://api.copyleaks.com/v3/scans/submit/file/{scanId}
 *
 * Two facts about this API shape the whole file:
 *
 * 1. Login is rate limited to 12 requests per account per 15 minutes, and the
 *    token it returns is good for 48 hours. Minting one per scan would trip
 *    that limit on a busy afternoon and lock the account out for five minutes,
 *    so the token is cached in module scope and reused.
 *
 * 2. AI detection is SYNCHRONOUS — results come back on the same call — while
 *    similarity is asynchronous and reports only by webhook. They are therefore
 *    not two halves of one flow, and the engine treats them separately.
 *
 * Nothing here reaches for our storage, auth or UI: this module speaks HTTP to
 * Copyleaks and returns the shapes in `../types.ts`.
 */

import type {
  AIDetectionResult,
  IntegrityProvider,
  PlagiarismResult,
  PlagiarismSource,
  ProviderRequest,
  SectionDetectionResult,
  TextSpan,
} from '../types'
import { chunkText, countWords } from '../extract'
import {
  classifyFetchFailure,
  classifyHttpFailure,
  PermanentProviderError,
  withRetry,
} from '../retry'

const ID_BASE = 'https://id.copyleaks.com'
const API_BASE = 'https://api.copyleaks.com'

/** Documented bounds of the AI detector's `text` field. */
const MAX_CHARACTERS = 100_000
const MIN_CHARACTERS = 255

/** Renew a little early; a token that expires mid-scan costs a whole run. */
const TOKEN_SAFETY_MARGIN_MS = 5 * 60 * 1000

interface CachedToken {
  token: string
  expiresAt: number
}

let cachedToken: CachedToken | null = null
/** In-flight login, so concurrent scans share one request instead of racing. */
let loginInFlight: Promise<CachedToken> | null = null

function credentials(): { email: string; key: string } | null {
  const email = process.env.COPYLEAKS_EMAIL?.trim()
  const key = process.env.COPYLEAKS_API_KEY?.trim()
  if (!email || !key) return null
  return { email, key }
}

/** Exposed for tests, which must not inherit a token from a previous case. */
export function resetCopyleaksToken(): void {
  cachedToken = null
  loginInFlight = null
}

async function login(): Promise<CachedToken> {
  const creds = credentials()
  if (!creds) {
    throw new PermanentProviderError(
      'Copyleaks is not configured. Set COPYLEAKS_EMAIL and COPYLEAKS_API_KEY.'
    )
  }

  let res: Response
  try {
    res = await fetch(`${ID_BASE}/v3/account/login/api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email: creds.email, key: creds.key }),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    throw classifyFetchFailure(err, 'Copyleaks')
  }

  if (!res.ok) {
    // The body can echo the submitted key back; it is never surfaced or logged.
    throw classifyHttpFailure(
      res.status,
      res.status === 401
        ? 'Copyleaks rejected the account credentials.'
        : `Copyleaks login failed (${res.status}).`,
      res.headers.get('Retry-After')
    )
  }

  const body = (await res.json().catch(() => null)) as
    | { access_token?: string; '.expires'?: string }
    | null

  const token = body?.access_token
  if (!token) {
    throw new PermanentProviderError('Copyleaks login returned no access token.')
  }

  const expiresAt = body?.['.expires']
    ? Date.parse(body['.expires'])
    : Date.now() + 47 * 60 * 60 * 1000

  return {
    token,
    expiresAt: (Number.isFinite(expiresAt) ? expiresAt : Date.now() + 47 * 3600_000) -
      TOKEN_SAFETY_MARGIN_MS,
  }
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token

  if (!loginInFlight) {
    loginInFlight = login()
      .then(result => {
        cachedToken = result
        return result
      })
      .finally(() => {
        loginInFlight = null
      })
  }

  return (await loginInFlight).token
}

/**
 * Maps Copyleaks' `classification` integer onto our vocabulary.
 *
 * The reference does not spell the enum out, so this is written to be safe
 * under either reading: 2 (and anything above) is AI, 1 is human, 0 is treated
 * as unknown rather than being forced into one of the two. A per-span
 * `probability` is preferred over this field wherever one is present, and the
 * document-level score never depends on it at all — see `summaryProbability`.
 */
function classificationOf(value: unknown): 'human' | 'ai' | 'mixed' | undefined {
  const n = Number(value)
  if (!Number.isFinite(n)) return undefined
  if (n >= 2) return 'ai'
  if (n === 1) return 'human'
  return undefined
}

/**
 * Document-level AI share, from the `summary` word counts.
 *
 * Derived from `summary` rather than from the per-result `probability` values
 * because probability is per matched span: averaging spans would weight a
 * six-word fragment the same as six paragraphs, which is how a lightly-flagged
 * document ends up reading as 80% AI.
 */
function summaryProbability(summary: unknown): number | null {
  if (!summary || typeof summary !== 'object') return null
  const { human, ai } = summary as { human?: unknown; ai?: unknown }
  const humanWords = Number(human)
  const aiWords = Number(ai)
  if (!Number.isFinite(humanWords) || !Number.isFinite(aiWords)) return null
  const total = humanWords + aiWords
  if (total <= 0) return null
  return aiWords / total
}

interface WriterDetectorResponse {
  modelVersion?: string
  summary?: { human?: number; ai?: number }
  results?: Array<{
    classification?: number
    probability?: number
    matches?: Array<{
      text?: {
        chars?: { starts?: number[]; lengths?: number[] }
        words?: { starts?: number[]; lengths?: number[] }
      }
    }>
  }>
  scannedDocument?: {
    scanId?: string
    totalWords?: number
    actualCredits?: number
    expectedCredits?: number
  }
}

/** Turns one chunk's response into spans addressed against the whole document. */
function sectionsFrom(
  body: WriterDetectorResponse,
  chunkOffset: number,
  sectionAt?: (offset: number) => string | undefined
): SectionDetectionResult[] {
  const sections: SectionDetectionResult[] = []

  for (const result of body.results ?? []) {
    const classification = classificationOf(result.classification)
    // Only AI-leaning spans are worth surfacing; highlighting every human span
    // would paint the whole document and tell the student nothing.
    if (classification === 'human') continue

    const probability =
      typeof result.probability === 'number' && Number.isFinite(result.probability)
        ? result.probability
        : null

    for (const match of result.matches ?? []) {
      const starts = match.text?.chars?.starts ?? []
      const lengths = match.text?.chars?.lengths ?? []
      for (let i = 0; i < starts.length; i++) {
        const start = Number(starts[i])
        const length = Number(lengths[i])
        if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0) continue

        const absolute = start + chunkOffset
        sections.push({
          span: { start: absolute, length },
          aiProbability: probability,
          classification: classification ?? 'mixed',
          section: sectionAt?.(absolute),
        })
      }
    }
  }

  return sections
}

async function detectChunk(
  text: string,
  scanId: string,
  request: ProviderRequest
): Promise<WriterDetectorResponse> {
  return withRetry(async () => {
    const token = await accessToken()

    let res: Response
    try {
      res = await fetch(`${API_BASE}/v2/writer-detector/${encodeURIComponent(scanId)}/check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          text,
          sandbox: request.sandbox === true,
          ...(request.language ? { language: request.language } : {}),
        }),
        signal: AbortSignal.timeout(120_000),
      })
    } catch (err) {
      throw classifyFetchFailure(err, 'Copyleaks')
    }

    if (res.status === 401) {
      // The cached token was revoked or rotated server-side. Drop it so the
      // retry mints a fresh one instead of replaying the dead credential.
      resetCopyleaksToken()
      throw classifyHttpFailure(429, 'Copyleaks session expired; retrying.', null)
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw classifyHttpFailure(
        res.status,
        `Copyleaks AI detection failed (${res.status}). ${detail.slice(0, 200)}`.trim(),
        res.headers.get('Retry-After')
      )
    }

    return (await res.json()) as WriterDetectorResponse
  })
}

export class CopyleaksProvider implements IntegrityProvider {
  readonly id = 'copyleaks'
  readonly label = 'Copyleaks'
  readonly maxCharacters = MAX_CHARACTERS
  readonly minCharacters = MIN_CHARACTERS

  isConfigured(): boolean {
    return credentials() !== null
  }

  supportsPlagiarism(): boolean {
    return true
  }

  /**
   * Scores the document for AI-writing indicators.
   *
   * Long documents are split at paragraph boundaries and each part scored
   * separately, then recombined by word count. A straight mean of the parts
   * would let a 300-word acknowledgements page outvote a 9,000-word chapter.
   */
  async checkAI(request: ProviderRequest): Promise<AIDetectionResult> {
    const base: AIDetectionResult = {
      provider: this.id,
      aiProbability: null,
      humanProbability: null,
      analyzedWords: 0,
      analyzedCharacters: request.text.length,
      status: 'failed',
      sandbox: request.sandbox === true,
      providerReference: request.scanId,
    }

    if (request.text.length < MIN_CHARACTERS) {
      return {
        ...base,
        error: `Copyleaks needs at least ${MIN_CHARACTERS} characters to analyse.`,
      }
    }

    const chunks = chunkText(request.text, MAX_CHARACTERS)
    const sections: SectionDetectionResult[] = []
    let weightedAi = 0
    let weightTotal = 0
    let analyzedWords = 0
    let modelVersion: string | undefined
    const failures: string[] = []

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      // One scan id per chunk: Copyleaks answers 409 on a reused id.
      const chunkScanId = chunks.length > 1 ? `${request.scanId}-${i}` : request.scanId

      try {
        const body = await detectChunk(chunk.text, chunkScanId, request)

        modelVersion = body.modelVersion ?? modelVersion
        const words = Number(body.scannedDocument?.totalWords) || countWords(chunk.text)
        analyzedWords += words

        const probability = summaryProbability(body.summary)
        if (probability !== null) {
          weightedAi += probability * words
          weightTotal += words
        }

        sections.push(...sectionsFrom(body, chunk.offset, request.sectionAt))
      } catch (err) {
        failures.push(err instanceof Error ? err.message : String(err))
      }
    }

    // Every part failed — this is a failed run, not a 0% result.
    if (failures.length === chunks.length) {
      return { ...base, error: failures[0] }
    }

    const aiProbability = weightTotal > 0 ? weightedAi / weightTotal : null

    return {
      provider: this.id,
      aiProbability,
      humanProbability: aiProbability === null ? null : 1 - aiProbability,
      analyzedWords,
      analyzedCharacters: request.text.length,
      sections,
      // A document whose parts partly failed is reported as partial, so the
      // dashboard can say the score covers less than the whole document.
      status: failures.length ? 'partial' : 'completed',
      modelVersion,
      error: failures.length
        ? `${failures.length} of ${chunks.length} sections could not be analysed.`
        : undefined,
      providerReference: request.scanId,
      sandbox: request.sandbox === true,
    }
  }

  /**
   * Submits the document for a similarity scan.
   *
   * Returns as soon as Copyleaks accepts the job. The scan itself can take
   * minutes and reports only to the webhook URL, so the result comes back
   * through `resolvePlagiarismWebhook` rather than from here — see
   * `awaitingCallback` in ../types.ts.
   */
  async checkPlagiarism(request: ProviderRequest): Promise<PlagiarismResult> {
    const base: PlagiarismResult = {
      provider: this.id,
      similarityPercentage: 0,
      matchedWords: 0,
      sources: [],
      status: 'failed',
      providerReference: request.scanId,
      sandbox: request.sandbox === true,
    }

    if (!request.webhookUrl) {
      return {
        ...base,
        status: 'skipped',
        error:
          'Similarity scanning needs a publicly reachable callback URL. Set NEXT_PUBLIC_APP_URL to a public address to enable it.',
      }
    }

    try {
      await withRetry(async () => {
        const token = await accessToken()

        let res: Response
        try {
          res = await fetch(
            `${API_BASE}/v3/scans/submit/file/${encodeURIComponent(request.scanId)}`,
            {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                base64: Buffer.from(request.text, 'utf-8').toString('base64'),
                filename: `${request.scanId}.txt`,
                properties: {
                  // {STATUS} is substituted by Copyleaks with completed/error.
                  webhooks: { status: request.webhookUrl },
                  sandbox: request.sandbox === true,
                },
              }),
              signal: AbortSignal.timeout(60_000),
            }
          )
        } catch (err) {
          throw classifyFetchFailure(err, 'Copyleaks')
        }

        if (res.status === 401) {
          resetCopyleaksToken()
          throw classifyHttpFailure(429, 'Copyleaks session expired; retrying.', null)
        }

        if (!res.ok) {
          const detail = await res.text().catch(() => '')
          throw classifyHttpFailure(
            res.status,
            `Copyleaks similarity submission failed (${res.status}). ${detail.slice(0, 200)}`.trim(),
            res.headers.get('Retry-After')
          )
        }
      })
    } catch (err) {
      return { ...base, error: err instanceof Error ? err.message : String(err) }
    }

    return { ...base, status: 'partial', awaitingCallback: true }
  }

  /**
   * Turns a completion callback into a finished similarity result.
   *
   * `status: 0` is success; anything else means Copyleaks gave up on the scan.
   * Sources arrive in four separate arrays by origin, which is exactly the
   * breakdown §10 asks the dashboard to show, so the origin is preserved as a
   * category rather than being flattened into one list.
   */
  async resolvePlagiarismWebhook(payload: unknown, scanId: string): Promise<PlagiarismResult> {
    const base: PlagiarismResult = {
      provider: this.id,
      similarityPercentage: 0,
      matchedWords: 0,
      sources: [],
      status: 'failed',
      providerReference: scanId,
    }

    if (!payload || typeof payload !== 'object') {
      return { ...base, error: 'Copyleaks sent an unreadable completion callback.' }
    }

    const body = payload as {
      status?: unknown
      scannedDocument?: { totalWords?: number }
      results?: {
        score?: {
          aggregatedScore?: number
          identicalWords?: number
          minorChangedWords?: number
          relatedMeaningWords?: number
        }
        internet?: unknown[]
        database?: unknown[]
        batch?: unknown[]
        repositories?: unknown[]
      }
    }

    const status = Number(body.status)
    if (Number.isFinite(status) && status !== 0) {
      return { ...base, error: 'Copyleaks could not complete the similarity scan.' }
    }

    const score = body.results?.score ?? {}
    const matchedWords =
      (Number(score.identicalWords) || 0) +
      (Number(score.minorChangedWords) || 0) +
      (Number(score.relatedMeaningWords) || 0)

    const sources: PlagiarismSource[] = [
      ...readSources(body.results?.internet, 'internet'),
      ...readSources(body.results?.database, 'academic'),
      ...readSources(body.results?.batch, 'other'),
      ...readSources(body.results?.repositories, 'repository'),
    ]

    // aggregatedScore is already a percentage of the document.
    const aggregated = Number(score.aggregatedScore)

    return {
      provider: this.id,
      similarityPercentage: Number.isFinite(aggregated) ? clampPercent(aggregated) : 0,
      matchedWords,
      sources: sources.sort(
        (a, b) => (b.similarityPercentage ?? 0) - (a.similarityPercentage ?? 0)
      ),
      status: 'completed',
      providerReference: scanId,
    }
  }
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function readSources(
  raw: unknown,
  category: PlagiarismSource['category']
): PlagiarismSource[] {
  if (!Array.isArray(raw)) return []

  return raw.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return []
    const source = entry as {
      title?: unknown
      url?: unknown
      matchedWords?: unknown
      totalWords?: unknown
      metadata?: { author?: unknown }
    }

    const matchedWords = Number(source.matchedWords)
    const totalWords = Number(source.totalWords)

    return [{
      title: typeof source.title === 'string' ? source.title : undefined,
      url: typeof source.url === 'string' ? source.url : undefined,
      author:
        typeof source.metadata?.author === 'string' ? source.metadata.author : undefined,
      matchedWords: Number.isFinite(matchedWords) ? matchedWords : undefined,
      similarityPercentage:
        Number.isFinite(matchedWords) && Number.isFinite(totalWords) && totalWords > 0
          ? clampPercent((matchedWords / totalWords) * 100)
          : undefined,
      category,
    }]
  })
}

/** Spans are addressed against our normalised text; re-exported for tests. */
export type { TextSpan }
