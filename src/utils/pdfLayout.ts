/**
 * pdfLayout.ts
 * ------------------------------------------------------------------
 * Pure layout decisions for the PDF renderer, kept free of JSX so they can be
 * tested directly. reactPdf.tsx maps its React nodes onto these.
 */

/** How a rendered node participates in pagination. */
export type BreakKind =
  /** A standalone `<View break />` — contributes a break and nothing else. */
  | 'break'
  /** Real content that also carries its own `break` (e.g. a chapter heading). */
  | 'break-carrier'
  /** Ordinary content. */
  | 'content'

/**
 * Decides which nodes survive, given each node's pagination role.
 *
 * Returns the indices to keep. Every dropped index is a page break that would
 * have produced a page with no content on it:
 *
 *  - a break at the very start of the document (blank first page)
 *  - two breaks in a row (blank page between them)
 *  - a standalone break immediately before a node that breaks anyway — this is
 *    the common case: an explicit `.page-break` div followed by a chapter
 *    heading with `break`, which is how the audited export produced its blank
 *    page 2 and blank page 23
 *  - a trailing break (blank final page)
 *
 * This is the pass behind the acceptance criterion "no page with zero content
 * elements; no page holding only a page number".
 */
export function planPageBreaks(kinds: BreakKind[]): number[] {
  const kept: number[] = []

  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i]

    if (kind === 'break') {
      // Nothing before it to break away from.
      if (kept.length === 0) continue
      // The previous surviving node was already a break.
      if (kinds[kept[kept.length - 1]] === 'break') continue
      kept.push(i)
      continue
    }

    // A node that breaks on its own makes a preceding standalone break redundant.
    if (kind === 'break-carrier' && kept.length > 0 && kinds[kept[kept.length - 1]] === 'break') {
      kept.pop()
    }

    kept.push(i)
  }

  // A trailing break appends an empty final page.
  while (kept.length > 0 && kinds[kept[kept.length - 1]] === 'break') kept.pop()

  return kept
}

/**
 * Conservative hyphenation for justified text.
 *
 * Justification without hyphenation is what produced the visible rivers and
 * stretched word gaps in the audited output: @react-pdf ships no hyphenation at
 * all, so every long word had to be pushed whole to the next line and the line
 * above absorbed the slack.
 *
 * Deliberately not a full Liang/TeX pattern set — it breaks only after a vowel
 * that is followed by a consonant, keeps at least 3 characters on each side of
 * a break, and refuses anything under 8 letters. That removes the worst rivers
 * without inventing linguistically wrong breaks in short words.
 */
export const MIN_HYPHENATED_LENGTH = 8
export const MIN_HYPHEN_EDGE = 3
const VOWELS = 'aeiouyAEIOUY'

export function hyphenateWord(word: string): string[] {
  // Split leading/trailing punctuation off so "however," is still hyphenable.
  const m = word.match(/^([^A-Za-z]*)([A-Za-z]+)([^A-Za-z]*)$/)
  if (!m) return [word]
  const [, lead, core, trail] = m
  if (core.length < MIN_HYPHENATED_LENGTH) return [word]

  const pieces: string[] = []
  let start = 0
  for (let i = MIN_HYPHEN_EDGE - 1; i < core.length - MIN_HYPHEN_EDGE; i++) {
    const isVowel = VOWELS.includes(core[i])
    const nextIsConsonant = !VOWELS.includes(core[i + 1])
    const leftOk = i + 1 - start >= MIN_HYPHEN_EDGE
    const rightOk = core.length - (i + 1) >= MIN_HYPHEN_EDGE
    if (isVowel && nextIsConsonant && leftOk && rightOk) {
      pieces.push(core.slice(start, i + 1))
      start = i + 1
      i += MIN_HYPHEN_EDGE - 1
    }
  }
  pieces.push(core.slice(start))

  if (pieces.length === 1) return [word]
  pieces[0] = lead + pieces[0]
  pieces[pieces.length - 1] = pieces[pieces.length - 1] + trail
  return pieces
}

/**
 * Strips a literal bullet glyph Word left in the text of a list paragraph.
 *
 * The audited export contained "·The system shall accept..." — a middot
 * character with no list formatting and no hanging indent, because the source
 * used a Symbol-font bullet that mammoth passes through as ordinary text.
 */
export const BULLET_GLYPH = /^\s*[·•‣▪●⁃-]\s+/

export function stripBulletGlyph(text: string): string {
  return text.replace(BULLET_GLYPH, '')
}

/** True when a paragraph is a figure/table caption that must stay with its subject. */
export function looksLikeCaption(text: string): boolean {
  return /^(figure|fig\.|table|plate|chart)\s*\d+([.:]\d+)*\s*[:.—-]/i.test(text.trim())
}
