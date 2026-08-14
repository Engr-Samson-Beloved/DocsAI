/**
 * layout.ts
 * ------------------------------------------------------------------
 * THE single source of slide geometry. Every coordinate the renderer emits
 * must be derived from the constants in this file.
 *
 * Why this module exists
 * ----------------------
 * The shipped deck positioned every shape for a 13.333 x 7.5in canvas while
 * pptxgenjs was left on its default `LAYOUT_16x9` preset, which is 10 x 5.625in.
 * The body column ran to 12.73in on a 10in slide, so a quarter of every line was
 * clipped; the slide counter (x=10.93) and the footer (y=7.00) rendered entirely
 * off-canvas. The numbers were not wrong in isolation - they were measured
 * against a canvas nobody had actually registered.
 *
 * The fix is structural, not arithmetic: one module owns the canvas, every box
 * is derived from it, and `assertOnCanvas` refuses to write a shape that escapes
 * it. A literal number in a renderer call that is not derived from here is a bug.
 */

// --- The canvas -----------------------------------------------------

/**
 * PowerPoint's true widescreen canvas, and the size both accredited decks in
 * /sample use.
 *
 * `LAYOUT_NAME` is deliberately NOT a pptxgenjs preset name. The presets carry
 * fixed sizes we do not control ('LAYOUT_16x9' is 10 x 5.625in), and naming one
 * here is what caused the original mismatch. A custom name registered via
 * `defineLayout` cannot be silently reinterpreted by the library.
 */
export const SLIDE_W = 13.333
export const SLIDE_H = 7.5
export const LAYOUT_NAME = 'WORDPI_WIDE'

/** Outer margin on every edge of the content area. */
export const MARGIN = 0.6

/** Reserved bands: the title/eyebrow header, and the footer strip. */
export const HEADER_H = 1.4
export const FOOTER_H = 0.75

/**
 * The rectangle body content may occupy. Everything else is derived from this.
 * 13.333 - 1.2 = 12.133 wide; 7.5 - 1.4 - 0.75 = 5.35 tall.
 */
export const SAFE = {
  x: MARGIN,
  y: HEADER_H,
  w: SLIDE_W - 2 * MARGIN,
  h: SLIDE_H - HEADER_H - FOOTER_H,
} as const

/**
 * Minimum clearance between a text box and the slide edge. QA check 1 enforces
 * this separately from the hard on-canvas bound: a box that merely touches the
 * edge is technically on-slide but reads as clipped in the room.
 */
export const EDGE_CLEARANCE = 0.5

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Fraction of a box's height that text may fill before it counts as overflow. */
export const FILL_LIMIT = 0.92

// --- Derived boxes --------------------------------------------------

/**
 * Content-slide chrome. The eyebrow (source-section label) sits above the
 * title, both inside the header band, with the counter parked at its right.
 */
export const COUNTER_W = 1.4

export const EYEBROW: Box = { x: MARGIN, y: 0.34, w: SAFE.w - COUNTER_W - 0.2, h: 0.3 }
export const TITLE: Box = { x: MARGIN, y: 0.66, w: SAFE.w - COUNTER_W - 0.2, h: 0.62 }
export const COUNTER: Box = { x: SLIDE_W - MARGIN - COUNTER_W, y: 0.34, w: COUNTER_W, h: 0.3 }
export const FOOTER: Box = { x: MARGIN, y: SLIDE_H - FOOTER_H + 0.18, w: SAFE.w, h: 0.3 }

/** Single-column body. */
export const BODY: Box = { ...SAFE }

/** Two-column split, used by `comparison`. A 0.5in gutter separates them. */
const GUTTER = 0.5
export const COLUMN_L: Box = { x: SAFE.x, y: SAFE.y, w: (SAFE.w - GUTTER) / 2, h: SAFE.h }
export const COLUMN_R: Box = {
  x: SAFE.x + (SAFE.w - GUTTER) / 2 + GUTTER,
  y: SAFE.y,
  w: (SAFE.w - GUTTER) / 2,
  h: SAFE.h,
}

/** Body when a key-points sidebar occupies the right third. */
export const BODY_NARROW: Box = { x: SAFE.x, y: SAFE.y, w: SAFE.w * 0.6, h: SAFE.h }
export const SIDEBAR: Box = {
  x: SAFE.x + SAFE.w * 0.6 + GUTTER,
  y: SAFE.y,
  w: SAFE.w * 0.4 - GUTTER,
  h: SAFE.h,
}

/** Full-bleed centred block, for the title and closing slides. */
export const HERO: Box = { x: MARGIN, y: 1.3, w: SAFE.w, h: SLIDE_H - 2.6 }

// --- Layout helpers -------------------------------------------------

/**
 * Splits a box into `count` evenly spaced rows with `gap` between them.
 * Used by the process/steps layouts so a row count change cannot push the last
 * row past the footer - the stride is computed from the space that exists.
 */
export function rows(box: Box, count: number, gap = 0.12): Box[] {
  if (count <= 0) return []
  const h = (box.h - gap * (count - 1)) / count
  return Array.from({ length: count }, (_, i) => ({
    x: box.x,
    y: box.y + i * (h + gap),
    w: box.w,
    h,
  }))
}

/** Splits a box into `count` evenly spaced columns. */
export function columns(box: Box, count: number, gap = 0.35): Box[] {
  if (count <= 0) return []
  const w = (box.w - gap * (count - 1)) / count
  return Array.from({ length: count }, (_, i) => ({
    x: box.x + i * (w + gap),
    y: box.y,
    w,
    h: box.h,
  }))
}

/** Centres a box of width `w` horizontally on the slide. */
export function centerX(w: number): number {
  return (SLIDE_W - w) / 2
}

// --- The write-time guard -------------------------------------------

export interface CanvasViolation {
  shape: string
  reason: string
  box: Box
}

/**
 * Returns the reason a box escapes the canvas, or null when it is clean.
 *
 * Tolerance absorbs floating-point drift from the derived arithmetic above
 * (SAFE.w is 12.133000000000001, and 0.6 + 12.133... > 13.333 by 2e-15).
 */
const TOLERANCE = 1e-6

export function canvasViolation(box: Box): string | null {
  if (!Number.isFinite(box.x) || !Number.isFinite(box.y) || !Number.isFinite(box.w) || !Number.isFinite(box.h)) {
    return 'has a non-finite coordinate'
  }
  if (box.w < 0 || box.h < 0) return 'has a negative dimension'
  if (box.x < -TOLERANCE) return `starts at x=${box.x.toFixed(2)}in, left of the slide`
  if (box.y < -TOLERANCE) return `starts at y=${box.y.toFixed(2)}in, above the slide`
  if (box.x + box.w > SLIDE_W + TOLERANCE) {
    return `extends to x=${(box.x + box.w).toFixed(2)}in, past the ${SLIDE_W}in slide width`
  }
  if (box.y + box.h > SLIDE_H + TOLERANCE) {
    return `extends to y=${(box.y + box.h).toFixed(2)}in, past the ${SLIDE_H}in slide height`
  }
  return null
}

export function isOnCanvas(box: Box): boolean {
  return canvasViolation(box) === null
}

/**
 * Throws when a shape would be written outside the canvas.
 *
 * This is the check that would have caught the entire A1 defect class on the
 * first generated deck. It runs on every shape the renderer emits, so a future
 * hard-coded coordinate fails the build instead of shipping a clipped slide.
 */
export function assertOnCanvas(shapeName: string, box: Box): void {
  const reason = canvasViolation(box)
  if (reason) {
    throw new Error(
      `Off-canvas shape "${shapeName}": ${reason}. ` +
        `Every coordinate must be derived from src/utils/deck/layout.ts.`
    )
  }
}

/**
 * Pulls a box back inside the canvas. Used only where clamping is genuinely
 * safer than failing (autosized text the library may grow); the caller is
 * expected to log it, because a clamp still means a coordinate was wrong.
 */
export function clampToCanvas(box: Box): Box {
  const w = Math.max(0, Math.min(box.w, SLIDE_W))
  const h = Math.max(0, Math.min(box.h, SLIDE_H))
  return {
    w,
    h,
    x: Math.max(0, Math.min(box.x, SLIDE_W - w)),
    y: Math.max(0, Math.min(box.y, SLIDE_H - h)),
  }
}
