/**
 * slidePlan.ts
 * ------------------------------------------------------------------
 * The contract between "what goes on the slides" and "how they are drawn".
 *
 * Why this module exists
 * ----------------------
 * The renderer used to receive loose strings and write them straight into
 * shapes. Nothing sat between a summariser's output and a text box, so a
 * mid-sentence fragment, a 25-word bullet or an invented section label reached
 * PowerPoint unchallenged.
 *
 * Now every slide is a validated object. A model (or the deterministic
 * planner) must produce data matching this schema; `validateSlidePlan` repairs
 * what is safely repairable, rejects what is not, and reports both. The
 * renderer only ever sees a plan that has passed.
 */

import type { PresentationSpec } from './presentationSpec'
import { lintBullet, duplicateKey, wordCount } from './textNormalize'

// --- Types -------------------------------------------------------------

export type SlideLayout =
  | 'title'
  | 'section'
  | 'bullets'
  | 'comparison'
  | 'stat'
  | 'process'
  | 'table'
  | 'quote'
  | 'references'
  | 'closing'

/** Layouts a content model is allowed to choose. */
export const CONTENT_LAYOUTS: SlideLayout[] = [
  'bullets', 'comparison', 'stat', 'process', 'table', 'quote', 'section', 'closing',
]

/** Layouts that are not a plain title-and-bullets slide, for the variety rule. */
export const NON_BULLET_LAYOUTS: SlideLayout[] = ['comparison', 'stat', 'process', 'table', 'quote']

export interface SlideColumn {
  heading: string
  bullets: string[]
}

export interface SlideStat {
  value: string
  caption: string
}

export interface SlideStep {
  title: string
  body: string
}

export interface SlideTable {
  headers: string[]
  rows: string[][]
  caption?: string
}

export interface PlannedSlide {
  layout: SlideLayout
  title: string
  /** Source-derived label, e.g. "Chapter Two". Never invented. */
  eyebrow?: string
  bullets?: string[]
  /**
   * Shortened citations for the references slide.
   *
   * Deliberately NOT `bullets`: a citation is a reference, not a claim, so the
   * 14-word cap and the fragment lint do not apply to it. Keeping them in a
   * separate field is what lets the QA gate hold real bullets to the standard
   * without mangling a bibliography.
   */
  citations?: string[]
  columns?: SlideColumn[]
  stat?: SlideStat
  steps?: SlideStep[]
  table?: SlideTable
  quote?: string
  /** 40-70 words, attached via addNotes only. */
  notes: string
  /** One-sentence spoken hook. */
  takeaway?: string
  /** Provenance: which part of the source this was built from. Never empty. */
  sourceRefs: string[]
}

export interface DeckMetadata {
  title: string
  studentName: string
  matricNo: string
  department: string
  school: string
  institution: string
  supervisorName: string
  session: string
  /** Caller-supplied footer. Defaults to empty - never a product name. */
  footer: string
}

export interface SlidePlan {
  metadata: DeckMetadata
  slides: PlannedSlide[]
}

// --- The schema handed to a model ---------------------------------------

/**
 * JSON Schema for the model's response. Kept in sync with the types above by
 * `slide-plan.test.mts`, which checks that every required property exists on
 * both sides.
 */
export const SLIDE_PLAN_JSON_SCHEMA = {
  type: 'object',
  required: ['slides'],
  properties: {
    slides: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['layout', 'title', 'notes', 'sourceRefs'],
        properties: {
          layout: { type: 'string', enum: CONTENT_LAYOUTS },
          title: { type: 'string', minLength: 2, maxLength: 60 },
          eyebrow: { type: 'string', maxLength: 40 },
          bullets: {
            type: 'array',
            maxItems: 6,
            items: { type: 'string', minLength: 3, maxLength: 110 },
          },
          columns: {
            type: 'array',
            maxItems: 2,
            items: {
              type: 'object',
              required: ['heading', 'bullets'],
              properties: {
                heading: { type: 'string', maxLength: 40 },
                bullets: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 90 } },
              },
            },
          },
          stat: {
            type: 'object',
            required: ['value', 'caption'],
            properties: {
              value: { type: 'string', maxLength: 16 },
              caption: { type: 'string', maxLength: 120 },
            },
          },
          steps: {
            type: 'array',
            maxItems: 5,
            items: {
              type: 'object',
              required: ['title', 'body'],
              properties: {
                title: { type: 'string', maxLength: 40 },
                body: { type: 'string', maxLength: 110 },
              },
            },
          },
          table: {
            type: 'object',
            required: ['headers', 'rows'],
            properties: {
              headers: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 40 } },
              rows: {
                type: 'array',
                maxItems: 6,
                items: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 60 } },
              },
              caption: { type: 'string', maxLength: 90 },
            },
          },
          quote: { type: 'string', maxLength: 220 },
          notes: { type: 'string', minLength: 120 },
          takeaway: { type: 'string', maxLength: 160 },
          sourceRefs: { type: 'array', minItems: 1, items: { type: 'string', maxLength: 24 } },
        },
      },
    },
  },
} as const

// --- Validation ---------------------------------------------------------

export interface PlanIssue {
  slideIndex: number
  slideTitle: string
  field: string
  problem: string
  /** true when validation repaired it; false when the slide was rejected. */
  repaired: boolean
}

export interface ValidationResult {
  plan: SlidePlan
  issues: PlanIssue[]
  /** Issues that could not be repaired. A non-empty list must fail the build. */
  fatal: PlanIssue[]
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter(isStr).map(s => s.trim()) : []

/**
 * Validates and repairs a slide plan against the spec.
 *
 * Repairable: over-long bullets (trimmed), bullets that fail the lint
 * (dropped), too many bullets (truncated), embedded newlines (flattened),
 * missing takeaway (derived from the first bullet).
 *
 * Fatal: a slide with no provenance, no notes, no title, or - after repair -
 * no content at all. These indicate the planner produced something it could
 * not justify, and shipping them is how "Chapter Four" ended up on Chapter Two
 * content.
 */
export function validateSlidePlan(raw: unknown, spec: PresentationSpec): ValidationResult {
  const issues: PlanIssue[] = []
  const slides: PlannedSlide[] = []

  const source = (raw ?? {}) as Partial<SlidePlan>
  const rawSlides = Array.isArray(source.slides) ? source.slides : []

  const seen = new Set<string>()

  rawSlides.forEach((rawSlide, index) => {
    const s = (rawSlide ?? {}) as Partial<PlannedSlide>
    const title = isStr(s.title) ? s.title.trim() : ''
    const note = (field: string, problem: string, repaired: boolean) =>
      issues.push({ slideIndex: index, slideTitle: title || `slide ${index + 1}`, field, problem, repaired })

    if (!title) {
      note('title', 'slide has no title', false)
      return
    }

    const layout: SlideLayout = (CONTENT_LAYOUTS as string[]).includes(s.layout as string)
      ? (s.layout as SlideLayout)
      : 'bullets'
    if (s.layout && layout !== s.layout) {
      note('layout', `unknown layout "${String(s.layout)}"; treated as bullets`, true)
    }

    // --- Provenance is non-negotiable.
    const sourceRefs = strArray(s.sourceRefs)
    if (sourceRefs.length === 0) {
      note('sourceRefs', 'no provenance; a slide must record where its content came from', false)
      return
    }

    // --- Bullets.
    let bullets = strArray(s.bullets).map(b => b.replace(/\s*[\r\n]+\s*/g, ' ').trim())

    const cleaned: string[] = []
    for (const bullet of bullets) {
      const flat = bullet.replace(/^[•‣▶▸*\-\s]+/, '').trim()
      if (!flat) continue

      let candidate = flat
      if (wordCount(candidate) > spec.deck.maxWordsPerBullet) {
        candidate = candidate
          .split(/\s+/)
          .slice(0, spec.deck.maxWordsPerBullet)
          .join(' ')
          .replace(/[\s,;:\-–—]+$/, '')
        note('bullets', `"${flat.slice(0, 40)}..." exceeded ${spec.deck.maxWordsPerBullet} words; trimmed`, true)
      }

      const problems = lintBullet(candidate, {
        maxWords: spec.deck.maxWordsPerBullet,
        requireVerb: false,
        seen,
      })
      if (problems.length > 0) {
        note('bullets', `dropped "${candidate.slice(0, 40)}..." (${problems.join(', ')})`, true)
        continue
      }

      seen.add(duplicateKey(candidate))
      cleaned.push(candidate)
    }

    if (cleaned.length > spec.deck.maxBulletsPerSlide) {
      note('bullets', `${cleaned.length} bullets exceeds the ${spec.deck.maxBulletsPerSlide} cap; truncated`, true)
    }
    bullets = cleaned.slice(0, spec.deck.maxBulletsPerSlide)

    // --- Layout-specific payloads.
    const columns = Array.isArray(s.columns)
      ? s.columns
          .filter(c => c && isStr(c.heading))
          .map(c => ({ heading: c.heading.trim(), bullets: strArray(c.bullets).slice(0, 4) }))
          .slice(0, 2)
      : undefined

    const steps = Array.isArray(s.steps)
      ? s.steps
          .filter(st => st && isStr(st.title))
          .map(st => ({ title: st.title.trim(), body: isStr(st.body) ? st.body.trim() : '' }))
          .slice(0, 5)
      : undefined

    const table =
      s.table && Array.isArray(s.table.headers) && Array.isArray(s.table.rows)
        ? {
            headers: strArray(s.table.headers).slice(0, 5),
            rows: s.table.rows
              .filter(Array.isArray)
              .map(r => (r as unknown[]).map(c => String(c ?? '').trim()).slice(0, 5))
              .slice(0, 6),
            caption: isStr(s.table.caption) ? s.table.caption.trim() : undefined,
          }
        : undefined

    const stat =
      s.stat && isStr(s.stat.value)
        ? { value: s.stat.value.trim(), caption: isStr(s.stat.caption) ? s.stat.caption.trim() : '' }
        : undefined

    // Citations bypass the bullet lint by design (see PlannedSlide.citations),
    // but still must not carry newlines into a run.
    const citations = strArray(s.citations).map(c => c.replace(/\s*[\r\n]+\s*/g, ' ').trim())

    // --- A slide must actually say something.
    const hasContent =
      bullets.length > 0 ||
      citations.length > 0 ||
      (columns?.length ?? 0) > 0 ||
      (steps?.length ?? 0) > 0 ||
      (table?.rows.length ?? 0) > 0 ||
      !!stat ||
      isStr(s.quote)
    if (!hasContent) {
      note('content', 'nothing left to render after validation', false)
      return
    }

    // --- Notes.
    const notes = isStr(s.notes) ? s.notes.replace(/\s+/g, ' ').trim() : ''
    if (wordCount(notes) < 25) {
      note('notes', `speaker notes are ${wordCount(notes)} words; at least 25 are required`, false)
      return
    }

    const takeaway = isStr(s.takeaway) ? s.takeaway.trim() : bullets[0] ?? title
    if (!isStr(s.takeaway)) note('takeaway', 'missing; derived from the first bullet', true)

    slides.push({
      layout,
      title,
      eyebrow: isStr(s.eyebrow) ? s.eyebrow.trim() : undefined,
      bullets: bullets.length > 0 ? bullets : undefined,
      citations: citations.length > 0 ? citations : undefined,
      columns: columns && columns.length > 0 ? columns : undefined,
      steps: steps && steps.length > 0 ? steps : undefined,
      table: table && table.rows.length > 0 ? table : undefined,
      stat,
      quote: isStr(s.quote) ? s.quote.trim() : undefined,
      notes,
      takeaway,
      sourceRefs,
    })
  })

  const metadata: DeckMetadata = {
    title: '',
    studentName: '',
    matricNo: '',
    department: '',
    school: '',
    institution: '',
    supervisorName: '',
    session: '',
    footer: '',
    ...(source.metadata ?? {}),
  }

  return {
    plan: { metadata, slides },
    issues,
    fatal: issues.filter(i => !i.repaired),
  }
}

/**
 * Asserts that a slide's eyebrow agrees with its provenance.
 *
 * The shipped deck labelled "SCOPE & SIGNIFICANCE" as "Chapter Four" while its
 * text came from the conclusion. Because eyebrows are now derived from
 * `sourceRefs`, a mismatch means something reassigned content without
 * relabelling it, and that must fail the build rather than mislead a panel.
 */
export function eyebrowMismatch(slide: PlannedSlide): string | null {
  if (!slide.eyebrow) return null

  const claimed = slide.eyebrow.match(/chapter\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)/i)
  if (!claimed) return null

  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  }
  const token = claimed[1].toLowerCase()
  const claimedNum = words[token] ?? Number.parseInt(token, 10)

  // Provenance refs look like "§2.3" or "p. 11"; the chapter is the leading
  // number of a section ref.
  const sectionRefs = slide.sourceRefs
    .map(ref => ref.match(/§\s*(\d+)/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map(m => Number.parseInt(m[1], 10))

  if (sectionRefs.length === 0) return null
  if (sectionRefs.includes(claimedNum)) return null

  return (
    `eyebrow claims "${slide.eyebrow}" but the content comes from ` +
    `section${sectionRefs.length > 1 ? 's' : ''} ${sectionRefs.map(n => `${n}.x`).join(', ')}`
  )
}
