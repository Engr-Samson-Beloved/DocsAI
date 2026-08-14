/**
 * presentationSpec.ts
 * ------------------------------------------------------------------
 * The presentation standard as DATA, not as constants sprinkled through the
 * renderer.
 *
 * Different institutions and brands supply different values, so the renderer
 * consumes a `PresentationSpec` object and holds no typography or colour
 * opinions of its own. Swap the object, get a compliant deck for another house
 * standard, with no renderer changes.
 *
 * Every spec is validated at load (`validateSpec`). Two failures are hard
 * errors rather than warnings, because both ship silently and are invisible in
 * review until somebody is standing in a lecture theatre:
 *   - a body size below the standard's own stated floor,
 *   - a text/background pair below 4.5:1 contrast, COMPUTED (WCAG 2.1
 *     relative luminance), never eyeballed.
 */

// --- Types ----------------------------------------------------------

export interface SizeRange {
  minPt: number
  maxPt: number
}

/** A text colour paired with the background it is drawn on. Both are hex, no '#'. */
export interface ColorPair {
  name: string
  fg: string
  bg: string
}

export interface PresentationSpec {
  id: string
  /** Human label, for error messages and the QA report. */
  label: string

  /**
   * Permitted font faces. The renderer may only emit a face in this list; QA
   * check 6 re-verifies against the rendered shapes.
   */
  fontAllowList: string[]
  headingFace: string
  bodyFace: string

  type: {
    title: SizeRange
    sectionHeading: SizeRange
    body: SizeRange
    /** Hard floor. A body size below this is rejected outright. */
    bodyAbsoluteMinPt: number
    /** Small print (eyebrow, counter, footer, captions, table cells). */
    caption: SizeRange
  }

  palette: {
    /** Page background for content slides. */
    ground: string
    /** Primary body/heading text on `ground`. */
    ink: string
    /** Secondary text on `ground` - eyebrows, captions, counters. */
    muted: string
    /** Dark fill for inverted slides (title, section, closing). */
    inverse: string
    /** Primary text on `inverse`. */
    inverseInk: string
    /** Secondary text on `inverse`. */
    inverseMuted: string
    /** Accent fill. Only ever a FILL behind `inverseInk`, never a text colour. */
    accent: string
    /** Subtle background tint for cards and table banding. */
    tint: string
    /** Hairline for table gridlines only - not a decorative rule. */
    hairline: string
  }

  /**
   * Every text/background combination the renderer is allowed to produce.
   * validateSpec computes the contrast of each; the renderer may not invent one
   * outside this list.
   */
  contrastPairs: ColorPair[]
  minContrast: number

  deck: {
    minSlides: number
    maxSlides: number
    maxBulletsPerSlide: number
    maxWordsPerBullet: number
    /** Target for concise bullets; the summariser aims here first. */
    idealWordsPerBullet: number
    notesMinWords: number
    notesMaxWords: number
    /** Fraction of CONTENT slides that must use a non-bullet layout. */
    minNonBulletRatio: number
    allowAnimations: boolean
  }

  /**
   * Strings that must never reach a rendered slide. Product names live here so
   * a placeholder footer fails the build instead of shipping.
   */
  bannedStrings: string[]
}

// --- Contrast (WCAG 2.1) --------------------------------------------

/** Parses 'RRGGBB' or '#RRGGBB' into 0-255 channels. */
export function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  }
}

/** WCAG relative luminance. Channels are linearised before weighting. */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex)
  if (!rgb) return NaN

  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }

  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}

/**
 * WCAG contrast ratio, 1:1 (identical) to 21:1 (black on white).
 * Returns NaN when either colour is unparseable, which validateSpec treats as
 * a failure rather than silently passing.
 */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg)
  const l2 = relativeLuminance(bg)
  if (Number.isNaN(l1) || Number.isNaN(l2)) return NaN
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

// --- Validation -----------------------------------------------------

export class SpecValidationError extends Error {
  problems: string[]
  constructor(specLabel: string, problems: string[]) {
    super(`Presentation spec "${specLabel}" is invalid:\n  - ${problems.join('\n  - ')}`)
    this.name = 'SpecValidationError'
    this.problems = problems
  }
}

/**
 * Returns every problem with a spec. Empty array means the spec is usable.
 * Collect-all rather than fail-fast: fixing a house standard one error per run
 * is miserable.
 */
export function specProblems(spec: PresentationSpec): string[] {
  const problems: string[] = []

  const range = (name: string, r: SizeRange) => {
    if (!(r.minPt > 0) || !(r.maxPt > 0)) problems.push(`${name} sizes must be positive`)
    else if (r.minPt > r.maxPt) problems.push(`${name} minPt ${r.minPt} exceeds maxPt ${r.maxPt}`)
  }

  range('title', spec.type.title)
  range('sectionHeading', spec.type.sectionHeading)
  range('body', spec.type.body)
  range('caption', spec.type.caption)

  // The headline rule: a standard may not set a body size under its own floor.
  if (spec.type.body.minPt < spec.type.bodyAbsoluteMinPt) {
    problems.push(
      `body minPt ${spec.type.body.minPt} is below the absolute minimum ${spec.type.bodyAbsoluteMinPt}pt`
    )
  }

  if (!spec.fontAllowList.length) problems.push('fontAllowList is empty')
  if (!spec.fontAllowList.includes(spec.headingFace)) {
    problems.push(`headingFace "${spec.headingFace}" is not in the font allow-list`)
  }
  if (!spec.fontAllowList.includes(spec.bodyFace)) {
    problems.push(`bodyFace "${spec.bodyFace}" is not in the font allow-list`)
  }

  for (const [key, value] of Object.entries(spec.palette)) {
    if (!parseHex(value)) problems.push(`palette.${key} "${value}" is not a 6-digit hex colour`)
  }

  if (!spec.contrastPairs.length) problems.push('contrastPairs is empty; contrast cannot be verified')

  for (const pair of spec.contrastPairs) {
    const ratio = contrastRatio(pair.fg, pair.bg)
    if (Number.isNaN(ratio)) {
      problems.push(`contrast pair "${pair.name}" has an unparseable colour (${pair.fg} on ${pair.bg})`)
    } else if (ratio < spec.minContrast) {
      problems.push(
        `contrast pair "${pair.name}" is ${ratio.toFixed(2)}:1 (${pair.fg} on ${pair.bg}), ` +
          `below the required ${spec.minContrast}:1`
      )
    }
  }

  if (spec.deck.minSlides > spec.deck.maxSlides) {
    problems.push(`deck.minSlides ${spec.deck.minSlides} exceeds maxSlides ${spec.deck.maxSlides}`)
  }
  if (spec.deck.maxWordsPerBullet < 1) problems.push('deck.maxWordsPerBullet must be at least 1')
  if (spec.deck.idealWordsPerBullet > spec.deck.maxWordsPerBullet) {
    problems.push('deck.idealWordsPerBullet exceeds maxWordsPerBullet')
  }
  if (spec.deck.notesMinWords > spec.deck.notesMaxWords) {
    problems.push('deck.notesMinWords exceeds notesMaxWords')
  }

  return problems
}

export function validateSpec(spec: PresentationSpec): PresentationSpec {
  const problems = specProblems(spec)
  if (problems.length > 0) throw new SpecValidationError(spec.label, problems)
  return spec
}

/** True when the renderer is permitted to draw `fg` on `bg`. */
export function isApprovedPair(spec: PresentationSpec, fg: string, bg: string): boolean {
  const norm = (c: string) => c.trim().replace(/^#/, '').toUpperCase()
  return spec.contrastPairs.some(p => norm(p.fg) === norm(fg) && norm(p.bg) === norm(bg))
}

// --- The default: HND seminar standard ------------------------------

const PALETTE = {
  ground: 'FFFFFF',
  ink: '0F172A',
  muted: '475569',
  inverse: '0F172A',
  inverseInk: 'FFFFFF',
  inverseMuted: 'CBD5E1',
  accent: '4F46E5',
  tint: 'F1F5F9',
  hairline: 'CBD5E1',
}

/**
 * "FROM SLIDES TO SUCCESS" (HND seminar guidelines), as a spec object:
 * Arial/Calibri/Helvetica/Segoe UI only; title 36-40pt; section heading 24-28pt;
 * body 18-22pt with a 16pt floor; high-contrast pairs only; no animations;
 * 12-15 slides for a 10-15 minute talk.
 *
 * Note there is no decorative colour role here - no "stripe", "bar" or "rule".
 * Separation is carried by `tint`, whitespace and shadow. That omission is
 * deliberate and is what keeps A4 fixed.
 */
export const HND_SEMINAR_SPEC: PresentationSpec = {
  id: 'hnd-seminar',
  label: 'HND Seminar (FROM SLIDES TO SUCCESS)',

  fontAllowList: ['Arial', 'Calibri', 'Helvetica', 'Segoe UI'],
  headingFace: 'Arial',
  bodyFace: 'Calibri',

  type: {
    title: { minPt: 36, maxPt: 40 },
    sectionHeading: { minPt: 24, maxPt: 28 },
    body: { minPt: 18, maxPt: 22 },
    bodyAbsoluteMinPt: 16,
    caption: { minPt: 10, maxPt: 16 },
  },

  palette: PALETTE,

  contrastPairs: [
    { name: 'body on ground', fg: PALETTE.ink, bg: PALETTE.ground },
    { name: 'muted on ground', fg: PALETTE.muted, bg: PALETTE.ground },
    { name: 'body on tint', fg: PALETTE.ink, bg: PALETTE.tint },
    { name: 'muted on tint', fg: PALETTE.muted, bg: PALETTE.tint },
    { name: 'inverse on dark', fg: PALETTE.inverseInk, bg: PALETTE.inverse },
    { name: 'inverse muted on dark', fg: PALETTE.inverseMuted, bg: PALETTE.inverse },
    { name: 'white on accent', fg: PALETTE.inverseInk, bg: PALETTE.accent },
  ],
  minContrast: 4.5,

  deck: {
    minSlides: 12,
    maxSlides: 15,
    maxBulletsPerSlide: 6,
    maxWordsPerBullet: 14,
    idealWordsPerBullet: 10,
    notesMinWords: 40,
    notesMaxWords: 70,
    minNonBulletRatio: 0.3,
    allowAnimations: false,
  },

  bannedStrings: ['wordpilot', 'wordpi', 'lorem', 'todo', '[insert', 'xxx', 'placeholder', 'tbd'],
}

/** The spec used unless a caller supplies another. Validated at module load. */
export const DEFAULT_SPEC: PresentationSpec = validateSpec(HND_SEMINAR_SPEC)
