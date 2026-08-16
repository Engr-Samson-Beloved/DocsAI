/**
 * GPTZero adapter — independent AI-writing detection.
 *
 *   POST https://api.gptzero.me/v2/predict/text
 *   header: x-api-key
 *   body:   { document, version? }
 *
 * A candid note on the response shape, because it drove the design here.
 *
 * GPTZero's own documentation names `document_classification`
 * (HUMAN_ONLY | MIXED | AI_ONLY), `class_probabilities`, `confidence_category`
 * and a sentence-level `highlight_sentence_for_ai`, but does not publish a
 * complete schema. A widely-mirrored third-party OpenAPI description instead
 * shows a flat body with `completely_generated_prob` and a `classification`
 * enum. Both shapes are in circulation and I could not establish from the
 * public docs which one a given account receives.
 *
 * Inventing one and hoping is how this breaks silently in production — a
 * missing field reads as `undefined`, `undefined` becomes 0, and the user is
 * told their thesis is 0% AI. So the reader below accepts either shape,
 * prefers the richer one, and returns a *failed* result rather than a zero
 * when it recognises neither. That is the same defensive posture
 * `src/app/api/humanize/[jobId]/route.ts` already takes with its own
 * under-specified upstream.
 */

import type {
  AIDetectionResult,
  IntegrityProvider,
  ProviderRequest,
  SectionDetectionResult,
} from '../types'
import { chunkText, countWords } from '../extract'
import {
  classifyFetchFailure,
  classifyHttpFailure,
  PermanentProviderError,
  withRetry,
} from '../retry'

const API_BASE = 'https://api.gptzero.me/v2'

/**
 * Conservative chunk size. GPTZero publishes no hard character cap for
 * `/predict/text`; this is a self-imposed bound so a dissertation is sent as
 * several sized requests rather than one that may be rejected or time out.
 * It is not a documented limit and should not be read as one.
 */
const MAX_CHARACTERS = 50_000

/** Short inputs produce noise rather than signal; matched to Copyleaks' floor. */
const MIN_CHARACTERS = 255

function apiKey(): string | null {
  return process.env.GPTZERO_API_KEY?.trim() || null
}

/** The per-document record, whichever envelope it arrived in. */
interface GptZeroDocument {
  document_classification?: unknown
  classification?: unknown
  predicted_class?: unknown
  confidence_category?: unknown
  confidence_score?: unknown
  class_probabilities?: { human?: unknown; ai?: unknown; mixed?: unknown }
  completely_generated_prob?: unknown
  average_generated_prob?: unknown
  sentences?: unknown
  paragraphs?: unknown
}

/**
 * Finds the document record in either envelope.
 *
 * `documents[0]` when the response wraps results in an array, otherwise the
 * root object — but only if the root actually carries a recognised field, so a
 * `{ error: ... }` body is not mistaken for a result.
 */
function documentRecord(body: unknown): GptZeroDocument | null {
  if (!body || typeof body !== 'object') return null

  const wrapped = (body as { documents?: unknown }).documents
  if (Array.isArray(wrapped) && wrapped.length && typeof wrapped[0] === 'object') {
    return wrapped[0] as GptZeroDocument
  }

  const root = body as GptZeroDocument
  const recognised =
    root.class_probabilities !== undefined ||
    root.completely_generated_prob !== undefined ||
    root.average_generated_prob !== undefined ||
    root.document_classification !== undefined ||
    root.classification !== undefined

  return recognised ? root : null
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Document-level AI probability, in preference order.
 *
 * `class_probabilities.ai` is the most direct statement of the quantity we
 * want. `completely_generated_prob` is the flat-schema equivalent.
 * `average_generated_prob` is a last resort: it is a mean over sentences and
 * so is biased by sentence length, but it beats reporting nothing.
 *
 * A MIXED classification deliberately does NOT fall back to a hand-made number.
 * §9 forbids inventing a score, and "mixed with no probability" is information
 * the engine can represent honestly as `null`.
 */
function aiProbabilityOf(record: GptZeroDocument): number | null {
  const direct = finiteNumber(record.class_probabilities?.ai)
  if (direct !== null) return clamp01(direct)

  const completely = finiteNumber(record.completely_generated_prob)
  if (completely !== null) return clamp01(completely)

  const average = finiteNumber(record.average_generated_prob)
  if (average !== null) return clamp01(average)

  return null
}

function humanProbabilityOf(record: GptZeroDocument, ai: number | null): number | null {
  const direct = finiteNumber(record.class_probabilities?.human)
  if (direct !== null) return clamp01(direct)
  return ai === null ? null : 1 - ai
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/**
 * Reads sentence-level results and locates each sentence in our own text.
 *
 * GPTZero returns sentence *strings*, not offsets. Rather than trusting an
 * index it never sent, each sentence is found by scanning forward from the end
 * of the previous match — we submitted the text, so the sentences are in it and
 * in order. A sentence that cannot be located is dropped rather than
 * approximated, because a highlight on the wrong paragraph is worse than no
 * highlight.
 */
function sentenceSections(
  record: GptZeroDocument,
  sourceText: string,
  chunkOffset: number,
  sectionAt?: (offset: number) => string | undefined
): SectionDetectionResult[] {
  if (!Array.isArray(record.sentences)) return []

  const sections: SectionDetectionResult[] = []
  let cursor = 0

  for (const entry of record.sentences) {
    if (!entry || typeof entry !== 'object') continue
    const sentence = entry as {
      sentence?: unknown
      generated_prob?: unknown
      highlight_sentence_for_ai?: unknown
    }

    const text = typeof sentence.sentence === 'string' ? sentence.sentence.trim() : ''
    if (!text) continue

    const found = sourceText.indexOf(text, cursor)
    if (found === -1) continue
    cursor = found + text.length

    const probability = finiteNumber(sentence.generated_prob)
    const highlighted = sentence.highlight_sentence_for_ai === true

    // Only flag what the provider actually leaned AI on. Without this the
    // dashboard highlights every sentence in the document.
    const isFlagged = highlighted || (probability !== null && probability >= 0.5)
    if (!isFlagged) continue

    const absolute = found + chunkOffset
    sections.push({
      span: { start: absolute, length: text.length },
      aiProbability: probability === null ? null : clamp01(probability),
      classification: 'ai',
      section: sectionAt?.(absolute),
    })
  }

  return sections
}

async function predictChunk(text: string): Promise<unknown> {
  const key = apiKey()
  if (!key) {
    throw new PermanentProviderError('GPTZero is not configured. Set GPTZERO_API_KEY.')
  }

  return withRetry(async () => {
    let res: Response
    try {
      res = await fetch(`${API_BASE}/predict/text`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-api-key': key,
        },
        body: JSON.stringify({ document: text }),
        signal: AbortSignal.timeout(120_000),
      })
    } catch (err) {
      throw classifyFetchFailure(err, 'GPTZero')
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw classifyHttpFailure(
        res.status,
        res.status === 401 || res.status === 403
          ? 'GPTZero rejected the API key.'
          : `GPTZero request failed (${res.status}). ${detail.slice(0, 200)}`.trim(),
        res.headers.get('Retry-After')
      )
    }

    return res.json()
  })
}

export class GPTZeroProvider implements IntegrityProvider {
  readonly id = 'gptzero'
  readonly label = 'GPTZero'
  readonly maxCharacters = MAX_CHARACTERS
  readonly minCharacters = MIN_CHARACTERS

  isConfigured(): boolean {
    return apiKey() !== null
  }

  /** GPTZero detects AI authorship only; similarity is Copyleaks' job. */
  supportsPlagiarism(): boolean {
    return false
  }

  async checkAI(request: ProviderRequest): Promise<AIDetectionResult> {
    const base: AIDetectionResult = {
      provider: this.id,
      aiProbability: null,
      humanProbability: null,
      analyzedWords: 0,
      analyzedCharacters: request.text.length,
      status: 'failed',
      providerReference: request.scanId,
    }

    if (request.text.length < MIN_CHARACTERS) {
      return {
        ...base,
        error: `GPTZero needs at least ${MIN_CHARACTERS} characters to analyse.`,
      }
    }

    const chunks = chunkText(request.text, MAX_CHARACTERS)
    const sections: SectionDetectionResult[] = []
    let weightedAi = 0
    let weightTotal = 0
    let analyzedWords = 0
    let confidence: string | undefined
    const failures: string[] = []
    let unreadable = 0

    for (const chunk of chunks) {
      try {
        const body = await predictChunk(chunk.text)
        const record = documentRecord(body)

        if (!record) {
          unreadable++
          failures.push('GPTZero returned a response in an unrecognised format.')
          continue
        }

        const words = countWords(chunk.text)
        analyzedWords += words

        const probability = aiProbabilityOf(record)
        if (probability !== null) {
          // Weighted by length, for the same reason as the Copyleaks adapter:
          // a short chunk must not outvote a long one.
          weightedAi += probability * words
          weightTotal += words
        }

        if (typeof record.confidence_category === 'string') {
          confidence = record.confidence_category
        }

        sections.push(...sentenceSections(record, chunk.text, chunk.offset, request.sectionAt))
      } catch (err) {
        failures.push(err instanceof Error ? err.message : String(err))
      }
    }

    if (failures.length === chunks.length) {
      return { ...base, error: failures[0] }
    }

    // Recognised the envelope but found no usable score anywhere. Reporting
    // this as 0% would be a fabrication, so it is a failure.
    if (weightTotal === 0) {
      return {
        ...base,
        analyzedWords,
        error:
          unreadable > 0
            ? 'GPTZero returned a response in an unrecognised format.'
            : 'GPTZero returned no AI probability for this document.',
      }
    }

    const aiProbability = weightedAi / weightTotal

    return {
      provider: this.id,
      aiProbability,
      humanProbability: 1 - aiProbability,
      analyzedWords,
      analyzedCharacters: request.text.length,
      sections,
      status: failures.length ? 'partial' : 'completed',
      // GPTZero versions its model but does not return a version string on
      // this endpoint; its self-reported confidence is the nearest useful
      // equivalent and is recorded rather than discarded.
      modelVersion: confidence ? `confidence:${confidence}` : undefined,
      error: failures.length
        ? `${failures.length} of ${chunks.length} sections could not be analysed.`
        : undefined,
      providerReference: request.scanId,
      sandbox: request.sandbox === true,
    }
  }
}

/** Exported for the tests that lock the dual-shape reader. */
export const __testing = { documentRecord, aiProbabilityOf, humanProbabilityOf, sentenceSections }
