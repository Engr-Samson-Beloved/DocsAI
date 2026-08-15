/**
 * llmSummarize.ts
 * ------------------------------------------------------------------
 * Optional abstractive summarisation layer.
 *
 * The deterministic planner in `deckPlan.ts` always produces a complete, valid
 * deck. This module tries to do better - genuinely rewriting each bullet in the
 * student's register rather than compressing the source clause - and hands back
 * the deterministic plan unchanged if it cannot.
 *
 * Three rules make this safe to depend on:
 *   1. The model is forced to emit JSON matching SLIDE_PLAN_JSON_SCHEMA.
 *   2. Its output goes through the same `validateSlidePlan` as everything else.
 *   3. On a schema failure the errors are fed back for ONE repair attempt, and
 *      any further failure falls back to the deterministic plan.
 *
 * The model never writes into a shape. It only proposes text that then has to
 * survive validation.
 */

import type { PresentationSpec } from './presentationSpec'
import type { SlidePlan, PlannedSlide } from './slidePlan'
import { validateSlidePlan, SLIDE_PLAN_JSON_SCHEMA, CONTENT_LAYOUTS } from './slidePlan'

/**
 * Failover list, verified against the models API rather than copied.
 *
 * The app's /api/generate route still lists gemini-2.0-flash and
 * gemini-1.5-flash; both now return 404 ("no longer available"), so a run that
 * needed to fail over had no working fallback left. `gemini-flash-latest` is an
 * alias, which keeps this list from going stale the same way again.
 */
const PRIORITIZED_MODELS = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite']

/** The slice of the Gemini client this module uses. */
export interface GenerativeClient {
  getGenerativeModel(config: unknown): {
    generateContent(prompt: string): Promise<{ response?: { text?: () => string } }>
  }
}

export interface LlmOptions {
  spec: PresentationSpec
  apiKey?: string
  /** Set false to skip the model entirely (tests, offline builds). */
  enabled?: boolean
  log?: (message: string) => void
  /**
   * Seam for tests: supply a client instead of constructing a real one.
   *
   * The repair-retry and fallback paths only run when a model misbehaves, and
   * a real model cannot be relied on to misbehave on demand. Without this hook
   * those branches would ship untested, which for error handling is the same
   * as shipping them broken.
   */
  clientFactory?: (apiKey: string) => Promise<GenerativeClient>
}

const SYSTEM_RULES = `You rewrite an academic seminar report into presentation slides.

You are given a DRAFT deck built by a deterministic summariser from the source
document. Improve the wording of each slide. You must not invent content, add
sections, reorder slides, or change any slide's "sourceRefs".

Hard rules for every bullet:
- At most 14 words. Aim for 10.
- A complete, self-contained claim. Never a clause lifted from the source.
- Start with a verb or a noun phrase. Never start with "The", "This" or "It".
- Keep concrete specifics: figures, percentages, dates, names, standards.
- Drop hedging and connective prose.
- No trailing comma, semicolon or hyphen. No newline characters. No bullet glyphs.

Other rules:
- 3 to 6 bullets per slide.
- Some slides carry "sourceSentences". Those slides are UNDER-FILLED: the
  deterministic summariser could not shorten those sentences without breaking
  them. Rewrite them into complete, self-contained claims and RETURN AT LEAST
  THREE bullets for such a slide. Use only what the source sentences say; do not
  add facts. Do not return "sourceSentences" in your response.
- "notes" must be 40-70 words of speaker guidance: what to say, the one number
  or name to emphasise, and the likely examiner question. Fewer than 40 words is
  a failure; count them.
- "takeaway" is one sentence, the spoken hook for the slide.
- Notes may mention ONLY things that appear in that slide's own text. Naming a
  term, number or product that is not on the slide tells the presenter to point
  at something the audience cannot see.
TITLES - rewrite every one:
- 2 to 6 words. Name the SUBJECT of the slide, in the document's own vocabulary.
- A title must never name a location in the document. Banned outright:
  "Chapter One/Two/...", "Front Matter", "Table of Contents", "At a Glance",
  "Overview", "Introduction" alone, "Summary of Existing Works", "Core
  Concepts", "Theoretical Background" alone, "General", "Section 3", and any
  leading section number.
- No colon anywhere in a title. One idea per title.
- Prefer a title that states the finding: "RFID CUTS HOTEL ENERGY 20-35%" beats
  "ADVANTAGES"; "WHY ENTERPRISE NETWORKS CONGEST" beats "INTRODUCTION".
- Every title in the deck must be different from every other.

- Return the SAME number of slides, in the SAME order, with the SAME layouts and
  sourceRefs as the draft.
- Return JSON only.`

/**
 * Improves a deterministic plan with a model, or returns it unchanged.
 *
 * Never throws: a summarisation upgrade must not be able to fail a build that
 * would otherwise have produced a valid deck.
 */
export async function refinePlanWithLlm(
  draft: SlidePlan,
  options: LlmOptions
): Promise<{ plan: SlidePlan; used: 'llm' | 'deterministic'; log: string[] }> {
  const log: string[] = []
  const note = (m: string) => {
    log.push(m)
    options.log?.(m)
  }

  const apiKey = options.apiKey ?? readApiKey()
  if (options.enabled === false || !apiKey) {
    note('summariser: deterministic (no GEMINI_API_KEY configured)')
    return { plan: draft, used: 'deterministic', log }
  }

  let client: GenerativeClient
  try {
    if (options.clientFactory) {
      client = await options.clientFactory(apiKey)
    } else {
      const mod = await import('@google/generative-ai')
      client = new mod.GoogleGenerativeAI(apiKey) as unknown as GenerativeClient
    }
  } catch (err) {
    note(`summariser: deterministic (client unavailable: ${describe(err)})`)
    return { plan: draft, used: 'deterministic', log }
  }

  const payload = draft.slides.map(toDraftShape)

  for (const modelName of PRIORITIZED_MODELS) {
    let attemptFeedback = ''

    // One initial attempt plus one repair attempt, per model.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const model = client.getGenerativeModel({
          model: modelName,
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: toGeminiSchema(SLIDE_PLAN_JSON_SCHEMA),
            temperature: 0.4,
          },
        })

        const prompt =
          `${SYSTEM_RULES}\n\n` +
          (attemptFeedback
            ? `Your previous response was rejected. Fix exactly these problems:\n${attemptFeedback}\n\n`
            : '') +
          `DRAFT DECK:\n${JSON.stringify({ slides: payload }, null, 1)}`

        const result = await model.generateContent(prompt)
        const text = result?.response?.text?.()
        if (!text) throw new Error('empty response')

        const parsed = JSON.parse(text)
        const merged = mergeWithDraft(draft, parsed)
        const validation = validateSlidePlan(merged, options.spec)

        if (validation.fatal.length === 0 && validation.plan.slides.length === draft.slides.length) {
          note(
            `summariser: ${modelName} (${validation.issues.length} repaired issue(s))`
          )
          return {
            plan: { metadata: draft.metadata, slides: validation.plan.slides },
            used: 'llm',
            log,
          }
        }

        attemptFeedback =
          validation.fatal.length > 0
            ? validation.fatal.map(f => `- slide "${f.slideTitle}" ${f.field}: ${f.problem}`).join('\n')
            : `- returned ${validation.plan.slides.length} slides; ${draft.slides.length} were required`
        note(`summariser: ${modelName} attempt ${attempt + 1} rejected`)
      } catch (err) {
        note(`summariser: ${modelName} attempt ${attempt + 1} failed (${describe(err)})`)
        attemptFeedback = ''
        break // try the next model rather than repairing a transport failure
      }
    }
  }

  note('summariser: deterministic (all model attempts rejected)')
  return { plan: draft, used: 'deterministic', log }
}

/** Only the fields the model may rewrite are sent; provenance stays server-side. */
function toDraftShape(slide: PlannedSlide) {
  return {
    layout: slide.layout,
    title: slide.title,
    caption: slide.caption,
    bullets: slide.bullets,
    columns: slide.columns,
    stat: slide.stat,
    steps: slide.steps,
    table: slide.table,
    quote: slide.quote,
    notes: slide.notes,
    takeaway: slide.takeaway,
    sourceRefs: slide.sourceRefs,
    // Present only on under-filled slides; see PlannedSlide.sourceSentences.
    sourceSentences: slide.sourceSentences,
  }
}

/**
 * Re-attaches everything the model was not permitted to change.
 *
 * Provenance in particular is taken from the DRAFT, never from the response:
 * a model that quietly relabels a slide's source would defeat the whole point
 * of the provenance check.
 */
function mergeWithDraft(draft: SlidePlan, response: unknown): SlidePlan {
  const slides = Array.isArray((response as any)?.slides) ? (response as any).slides : []

  return {
    metadata: draft.metadata,
    slides: draft.slides.map((original, i) => {
      const proposed = slides[i] ?? {}
      const layoutOk = CONTENT_LAYOUTS.includes(proposed.layout)
      return {
        ...original,
        // Text the model may improve.
        bullets: Array.isArray(proposed.bullets) && proposed.bullets.length > 0
          ? proposed.bullets
          : original.bullets,
        notes:
          original.layout === 'title' || original.layout === 'closing'
            ? original.notes
            : typeof proposed.notes === 'string' && proposed.notes.trim()
            ? proposed.notes
            : original.notes,
        takeaway:
          typeof proposed.takeaway === 'string' && proposed.takeaway.trim()
            ? proposed.takeaway
            : original.takeaway,
        columns: Array.isArray(proposed.columns) && proposed.columns.length > 0 ? proposed.columns : original.columns,
        steps: Array.isArray(proposed.steps) && proposed.steps.length > 0 ? proposed.steps : original.steps,
        stat: proposed.stat?.value ? proposed.stat : original.stat,
        // The model MAY rewrite the title - naming the subject is exactly the
        // job it is better at than a rule - but a bad one cannot ship: the gate
        // rejects banned vocabulary, duplicates and anything over six words.
        // ...except on the title slide, whose title is the REPORT's title as
        // parsed from the cover page. That is a fact about the document, not a
        // heading to be improved, and a model that "improves" it puts a
        // different title on the student's seminar than the one they submitted.
        title:
          original.layout === 'title' || original.layout === 'closing'
            ? original.title
            : typeof proposed.title === 'string' && proposed.title.trim().length >= 3
            ? proposed.title.trim()
            : original.title,
        caption:
          typeof proposed.caption === 'string' && proposed.caption.trim()
            ? proposed.caption.trim()
            : original.caption,
        // Structure the model may NOT change.
        layout: layoutOk && proposed.layout === original.layout ? original.layout : original.layout,
        table: original.table,
        citations: original.citations,
        sourceRefs: original.sourceRefs,
        // Consumed by the prompt; never rendered.
        sourceSentences: undefined,
      }
    }),
  }
}

/**
 * Gemini's responseSchema accepts a subset of JSON Schema and rejects
 * unsupported keywords, so `minItems`/`maxItems`/`minLength`/`maxLength` and
 * `enum` on non-strings are stripped here rather than duplicating the schema.
 */
function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema)
  if (!schema || typeof schema !== 'object') return schema

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (['minItems', 'maxItems', 'minLength', 'maxLength', 'additionalProperties'].includes(key)) continue
    out[key] = key === 'properties' || key === 'items' ? toGeminiSchema(value) : value
  }
  return out
}

function readApiKey(): string | undefined {
  if (typeof process === 'undefined' || !process.env) return undefined
  return process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY || undefined
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
