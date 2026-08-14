/**
 * titles.ts
 * ------------------------------------------------------------------
 * Generates a slide title from the slide's OWN CONTENT.
 *
 * The rule: a slide title names the subject, not the location of the subject
 * in the document. `CHAPTER ONE` says where the text came from. `FRONT MATTER`
 * says which pile it was in. `AT A GLANCE` says nothing at all. None of them
 * tells a reader what the slide is about, which is the only job a title has.
 *
 * `BANNED_TITLE_PATTERNS` is exported for the QA gate, which fails the build on
 * a match. Generating a good title and checking for a bad one are deliberately
 * separate: the generator can be improved, the ban is the floor.
 */

import { hasFiniteVerb } from './textNormalize'

// --- The ban ------------------------------------------------------------

/**
 * Structural vocabulary. None of this may appear as a title, and most of it may
 * not appear in rendered text at all.
 *
 * `Introduction`, `Overview` and `Theoretical Background` are banned only as a
 * WHOLE title - they are legitimate inside a sentence, so the patterns anchor.
 */
export const BANNED_TITLE_PATTERNS: { pattern: RegExp; why: string }[] = [
  { pattern: /\bchapter\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i, why: 'names a chapter, not a subject' },
  { pattern: /^\s*chapter\b/i, why: 'names a chapter, not a subject' },
  { pattern: /\bfront\s+matter\b/i, why: 'names a part of the document, not a subject' },
  { pattern: /\btable\s+of\s+contents\b/i, why: 'front matter' },
  { pattern: /\bat\s+a\s+glance\b/i, why: 'says nothing about the subject' },
  { pattern: /^\s*overview\s*$/i, why: 'says nothing about the subject' },
  { pattern: /^\s*introduction\s*$/i, why: 'names a section, not a subject' },
  { pattern: /^\s*abstract(\s*&\s*table\s+of\s+contents)?\s*$/i, why: 'front matter' },
  { pattern: /^\s*summary\s+of\s+existing\s+works\s*$/i, why: 'names a section, not a subject' },
  { pattern: /^\s*review\s+of\s+related\s+studies\s*$/i, why: 'names a section, not a subject' },
  { pattern: /^\s*core\s+concepts\b/i, why: 'says nothing about the subject' },
  { pattern: /^\s*theoretical\s+background\s*$/i, why: 'says nothing about the subject' },
  { pattern: /\bworking\s+principle\s*\/\s*process\s+flow\b/i, why: 'a heading, not a subject' },
  { pattern: /^\s*general\s*$/i, why: 'says nothing about the subject' },
  { pattern: /^\s*miscellaneous\s*$/i, why: 'says nothing about the subject' },
  { pattern: /\bsection\s+\d+\b/i, why: 'names a section, not a subject' },
  { pattern: /^\s*\d+(\.\d+)*\s/, why: 'leading section number' },
]

export function bannedTitleReason(text: string): string | null {
  for (const { pattern, why } of BANNED_TITLE_PATTERNS) {
    if (pattern.test(text)) return `"${text}" ${why}`
  }
  return null
}

// --- Phrase mining ------------------------------------------------------

const STOPWORDS = new Set(
  ('the a an and or of to in for on with by as is are was were be been being that this these those it its from at ' +
    'which such can may will would could should has have had not but also more most other than then there their they ' +
    'we our us into over under between within while when where what who how why both each any all some many much ' +
    'very often across through during however therefore thus hence including include includes such-as').split(/\s+/)
)

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** Contiguous runs of non-stopwords: the noun phrases a title can be built from. */
export function candidatePhrases(text: string, maxWords = 5): string[] {
  const out: string[] = []
  let run: string[] = []

  for (const w of words(text)) {
    if (STOPWORDS.has(w) || w.length < 3) {
      if (run.length > 0) out.push(run.join(' '))
      run = []
    } else {
      run.push(w)
      if (run.length === maxWords) {
        out.push(run.join(' '))
        run = []
      }
    }
  }
  if (run.length > 0) out.push(run.join(' '))

  return out.filter(p => p.split(' ').length >= 1)
}

// --- Title generation ---------------------------------------------------

export type SlideRole =
  | 'problem'
  | 'objectives'
  | 'scope'
  | 'background'
  | 'comparison'
  | 'evidence'
  | 'findings'
  | 'limitations'
  | 'conclusion'
  | 'other'

export interface TitleInput {
  role: SlideRole
  /** The slide's own final text: bullets, step titles, table headers. */
  content: string[]
  /** Table column headers, when the slide is a table. */
  tableHeaders?: string[]
  /** Fallback only, and cleaned of structural vocabulary first. */
  sourceHeading?: string
  /** Titles already used, for uniqueness. */
  taken: Set<string>
  /** Term frequencies across the WHOLE deck, so a title can be distinctive. */
  deckTermCounts?: Map<string, number>
}

/**
 * Role-shaped frames. The subject is the slide's own dominant phrase, so the
 * title is specific rather than a label: "BARRIERS TO SDN ADOPTION", not
 * "LIMITATIONS".
 */
const FRAMES: Record<SlideRole, (subject: string) => string> = {
  problem: s => `WHY ${s} FALLS SHORT`,
  objectives: s => `AIMS FOR ${s}`,
  scope: s => `SCOPE OF ${s}`,
  background: s => `HOW ${s} WORKS`,
  comparison: s => `COMPARING ${s}`,
  evidence: s => `WHAT STUDIES SHOW ON ${s}`,
  findings: s => `WHAT ${s} DELIVERS`,
  limitations: s => `BARRIERS TO ${s}`,
  conclusion: s => `WHERE ${s} IS HEADING`,
  other: s => s,
}

const MAX_TITLE_WORDS = 6

/** Uppercased, punctuation-trimmed, and never spliced with a colon. */
function tidy(text: string): string {
  return text
    .replace(/\s*:\s*/g, ' ') // one idea per title; no label: label
    .replace(/[^\w\s&/–-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

function trimToWords(text: string, max: number): string {
  const parts = text.split(/\s+/).filter(Boolean)
  return parts.slice(0, max).join(' ')
}

/**
 * The slide's dominant subject: the phrase that occurs most in this slide's own
 * text, weighted DOWN by how common it is across the whole deck. Without that
 * weighting every slide in an SDN report is titled "SDN".
 */
export function dominantSubject(content: string[], deckTermCounts?: Map<string, number>): string {
  const local = new Map<string, number>()

  for (const line of content) {
    for (const phrase of candidatePhrases(line)) {
      const n = phrase.split(' ').length
      if (n > 4) continue
      // Multi-word phrases are more informative than single terms.
      local.set(phrase, (local.get(phrase) ?? 0) + (n > 1 ? 2 : 1))
    }
  }

  let best = ''
  let bestScore = 0

  for (const [phrase, count] of local) {
    const spread = deckTermCounts?.get(phrase) ?? 1
    const score = (count * Math.min(phrase.split(' ').length, 3)) / Math.sqrt(spread)
    if (score > bestScore) {
      bestScore = score
      best = phrase
    }
  }

  return best
}

/**
 * Builds a title from the slide's content, falling back through progressively
 * weaker options and never returning banned vocabulary.
 */
export function titleFromContent(input: TitleInput): string {
  const { role, content, tableHeaders, sourceHeading, taken, deckTermCounts } = input

  const attempts: string[] = []

  // 1. A comparison table names the things being compared.
  if (tableHeaders && tableHeaders.length >= 3) {
    const entities = tableHeaders.slice(1).filter(h => h.split(/\s+/).length <= 3)
    if (entities.length >= 2) attempts.push(`${entities[0]} VS ${entities[1]}`)
  }

  const subject = dominantSubject(content, deckTermCounts)

  // 2. A role frame around the slide's own subject.
  if (subject) {
    attempts.push(FRAMES[role](trimToWords(subject, 3)))
    attempts.push(subject)
  }

  // 3. A statement-shaped bullet makes a good title on its own.
  const statement = content.find(c => hasFiniteVerb(c) && c.split(/\s+/).length <= MAX_TITLE_WORDS)
  if (statement) attempts.push(statement)

  // 4. Last resort: the source heading, but only if it is not structural.
  if (sourceHeading) attempts.push(sourceHeading)

  for (const raw of attempts) {
    const candidate = trimToWords(tidy(raw), MAX_TITLE_WORDS)
    const wordCount = candidate.split(/\s+/).filter(Boolean).length
    if (wordCount < 2 || wordCount > MAX_TITLE_WORDS) continue
    if (bannedTitleReason(candidate)) continue
    if (taken.has(candidate)) continue
    return candidate
  }

  // Everything collided or was banned: qualify the subject to make it unique.
  const base = trimToWords(tidy(subject || sourceHeading || 'KEY POINTS'), MAX_TITLE_WORDS - 1)
  for (const qualifier of ['IN PRACTICE', 'IN DETAIL', 'EXPLAINED', 'IN CONTEXT', 'CONTINUED']) {
    const candidate = trimToWords(`${base} ${qualifier}`, MAX_TITLE_WORDS)
    if (!taken.has(candidate) && !bannedTitleReason(candidate)) return candidate
  }

  return base
}

/** Term frequencies across the deck, so `dominantSubject` can be distinctive. */
export function buildDeckTermCounts(allContent: string[][]): Map<string, number> {
  const counts = new Map<string, number>()

  for (const slide of allContent) {
    const seen = new Set<string>()
    for (const line of slide) {
      for (const phrase of candidatePhrases(line)) seen.add(phrase)
    }
    for (const phrase of seen) counts.set(phrase, (counts.get(phrase) ?? 0) + 1)
  }

  return counts
}
