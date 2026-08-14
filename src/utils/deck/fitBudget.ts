/**
 * fitBudget.ts
 * ------------------------------------------------------------------
 * Decides whether a slide's text actually fits its box BEFORE it is rendered,
 * and escalates through a fixed ladder of remedies when it does not.
 *
 * Why this module exists
 * ----------------------
 * The shipped deck put 6-8 bullets of 15-25 words at 18pt with fixed 26.1pt
 * line spacing into a 4.7in box, and emitted `<a:normAutofit/>` with no
 * `fontScale` - an autofit element that shrinks nothing. Overflow was never
 * modelled at any point in the pipeline; text simply ran off the bottom.
 *
 * The rule this module enforces: never render a slide whose estimated height
 * exceeds its box. Remedies are applied in a fixed order, cheapest first, and
 * every escalation is logged so the reason a slide looks the way it does is
 * recoverable from the build output.
 */

import type { Box } from './layout'
import { FILL_LIMIT } from './layout'
import type { PresentationSpec } from './presentationSpec'

// --- Estimation ------------------------------------------------------

/**
 * Average glyph width as a fraction of the em, per face. 0.5 is the figure the
 * house standard quotes for Arial/Calibri and is the default.
 */
const CHAR_WIDTH_RATIO: Record<string, number> = {
  Arial: 0.5,
  Helvetica: 0.5,
  Calibri: 0.48,
  'Segoe UI': 0.5,
}

export const DEFAULT_CHAR_WIDTH_RATIO = 0.5

/** Points per inch. Font sizes are in points, boxes in inches. */
const PT_PER_IN = 72

/** Line box as a multiple of font size. */
export const LINE_HEIGHT_RATIO = 1.25

/** Vertical gap after each bullet paragraph, in inches. */
export const PARA_SPACE_AFTER_IN = 0.08

/**
 * Estimated line count for one run of text in a box of a given width.
 *
 * The house standard states this as
 *   ceil(len / floor(boxWidthIn * 96 / (fontPt * 0.5)))
 * which mixes units - it multiplies inches by 96 (pixels per inch) but divides
 * by a width expressed in points, making the result about 33% optimistic. An
 * optimistic overflow guard is worse than none, because it reports "fits" for
 * slides that clip. The conversion is corrected here (points -> inches via
 * /72), which is the same formula with consistent units, and the planner and
 * the QA gate both call THIS function so they can never disagree.
 */
export function estimateLines(
  text: string,
  boxWidthIn: number,
  fontPt: number,
  fontFace = 'Calibri'
): number {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return 0
  if (boxWidthIn <= 0 || fontPt <= 0) return 1

  const ratio = CHAR_WIDTH_RATIO[fontFace] ?? DEFAULT_CHAR_WIDTH_RATIO
  const charWidthIn = (fontPt * ratio) / PT_PER_IN
  const charsPerLine = Math.max(1, Math.floor(boxWidthIn / charWidthIn))

  return Math.max(1, Math.ceil(trimmed.length / charsPerLine))
}

export interface MeasuredItem {
  text: string
  fontPt: number
  fontFace?: string
  /** Extra space beneath this item, in inches. Defaults to PARA_SPACE_AFTER_IN. */
  spaceAfterIn?: number
}

/**
 * Total estimated height of a stack of text runs, in inches.
 *
 * Paragraph spacing is counted BETWEEN items only. Charging it after the last
 * paragraph as well overstates every box by one gap, which for single-line
 * chrome (a 12pt eyebrow in a 0.28in box) is enough to report 103% fill on text
 * that plainly fits.
 */
export function estimateHeightIn(items: MeasuredItem[], boxWidthIn: number): number {
  return items.reduce((total, item, i) => {
    const lines = estimateLines(item.text, boxWidthIn, item.fontPt, item.fontFace)
    const lineHeightIn = (item.fontPt * LINE_HEIGHT_RATIO) / PT_PER_IN
    const spaceAfter = i < items.length - 1 ? item.spaceAfterIn ?? PARA_SPACE_AFTER_IN : 0
    return total + lines * lineHeightIn + spaceAfter
  }, 0)
}

/** The height a box will actually accept: 92% of it, leaving optical headroom. */
export function usableHeightIn(box: Box): number {
  return box.h * FILL_LIMIT
}

export function fitsInBox(items: MeasuredItem[], box: Box): boolean {
  return estimateHeightIn(items, box.w) <= usableHeightIn(box)
}

// --- The escalation ladder -------------------------------------------

export type FitLever = 'none' | 'compress' | 'font-step' | 'split' | 'autofit'

export interface FitSlide {
  /** '' on the first slide of a split; ' (cont.)' thereafter. */
  titleSuffix: string
  bullets: string[]
  fontPt: number
  /** True only when every earlier lever was exhausted. */
  autofit: boolean
}

export interface FitResult {
  slides: FitSlide[]
  /** Every lever pulled, in order, for the build log. */
  levers: FitLever[]
  /** Human-readable trace, one line per escalation. */
  log: string[]
}

export interface FitOptions {
  box: Box
  spec: PresentationSpec
  /**
   * Lever 1: re-ask the summariser for shorter bullets. Given a word budget,
   * returns rewritten bullets. Omit to skip straight to the font step.
   */
  compress?: (bullets: string[], wordBudget: number) => string[]
  /** Maximum slides this content may occupy after splitting. */
  maxSlides?: number
  fontFace?: string
}

function measure(bullets: string[], fontPt: number, fontFace: string): MeasuredItem[] {
  return bullets.map(text => ({ text, fontPt, fontFace }))
}

/**
 * Greedily packs bullets into as few slides as each will hold at `fontPt`,
 * respecting both the height budget and the spec's bullets-per-slide cap.
 */
function packIntoSlides(
  bullets: string[],
  box: Box,
  fontPt: number,
  fontFace: string,
  maxBullets: number
): string[][] {
  const chunks: string[][] = []
  let current: string[] = []

  for (const bullet of bullets) {
    const candidate = [...current, bullet]
    const tooTall = estimateHeightIn(measure(candidate, fontPt, fontFace), box.w) > usableHeightIn(box)
    const tooMany = candidate.length > maxBullets

    if (current.length > 0 && (tooTall || tooMany)) {
      chunks.push(current)
      current = [bullet]
    } else {
      current = candidate
    }
  }

  if (current.length > 0) chunks.push(current)
  return chunks
}

/**
 * Fits `bullets` into `box`, escalating in the order the house standard
 * requires:
 *   1. compress the text (lower word budget from the summariser),
 *   2. step the font down one notch, within the spec's range,
 *   3. split onto a second slide, titled "(cont.)",
 *   4. and only then fall back to autofit shrink.
 */
export function fitBullets(bullets: string[], options: FitOptions): FitResult {
  const { box, spec, compress, maxSlides = 2, fontFace = spec.bodyFace } = options
  const maxBullets = spec.deck.maxBulletsPerSlide
  const minPt = Math.max(spec.type.body.minPt, spec.type.bodyAbsoluteMinPt)
  const maxPt = spec.type.body.maxPt

  const levers: FitLever[] = []
  const log: string[] = []

  let working = bullets.filter(b => b && b.trim())
  let fontPt = maxPt

  const single = (items: string[], pt: number) =>
    items.length <= maxBullets && fitsInBox(measure(items, pt, fontFace), box)

  // Level 0: it already fits.
  if (single(working, fontPt)) {
    return {
      slides: [{ titleSuffix: '', bullets: working, fontPt, autofit: false }],
      levers: ['none'],
      log: [`fits at ${fontPt}pt with no escalation`],
    }
  }

  // Level 1: compress. Step the word budget down from the ideal toward a floor
  // of 6 words, re-checking after each pass.
  if (compress) {
    for (let budget = spec.deck.idealWordsPerBullet; budget >= 6; budget -= 2) {
      const shorter = compress(working, budget).filter(b => b && b.trim())
      if (shorter.length === 0) break
      working = shorter
      levers.push('compress')
      log.push(`compressed bullets to a ${budget}-word budget`)
      if (single(working, fontPt)) {
        return {
          slides: [{ titleSuffix: '', bullets: working, fontPt, autofit: false }],
          levers,
          log,
        }
      }
    }
  }

  // Level 2: step the font down one notch at a time.
  while (fontPt > minPt) {
    fontPt -= 1
    levers.push('font-step')
    log.push(`stepped body font down to ${fontPt}pt`)
    if (single(working, fontPt)) {
      return { slides: [{ titleSuffix: '', bullets: working, fontPt, autofit: false }], levers, log }
    }
  }

  // Level 3: split. Re-raise the font first - a split slide has a full box
  // again, so it should not inherit the shrink that the single slide needed.
  for (let pt = maxPt; pt >= minPt; pt -= 1) {
    const chunks = packIntoSlides(working, box, pt, fontFace, maxBullets)
    if (chunks.length <= maxSlides) {
      levers.push('split')
      log.push(`split onto ${chunks.length} slides at ${pt}pt`)
      return {
        slides: chunks.map((chunk, i) => ({
          titleSuffix: i === 0 ? '' : ' (cont.)',
          bullets: chunk,
          fontPt: pt,
          autofit: false,
        })),
        levers,
        log,
      }
    }
  }

  // Level 4: last resort. Keep what the allowed slides can hold at the floor
  // size and let PowerPoint shrink the remainder.
  const chunks = packIntoSlides(working, box, minPt, fontFace, maxBullets).slice(0, maxSlides)
  levers.push('autofit')
  log.push(
    `exhausted compress/font/split; ${chunks.length} slides at ${minPt}pt with autofit shrink` +
      (chunks.flat().length < working.length
        ? `, dropping ${working.length - chunks.flat().length} bullet(s) that could not fit`
        : '')
  )

  return {
    slides: chunks.map((chunk, i) => ({
      titleSuffix: i === 0 ? '' : ' (cont.)',
      bullets: chunk,
      fontPt: minPt,
      autofit: true,
    })),
    levers,
    log,
  }
}
