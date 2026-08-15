/**
 * qaChecks.ts
 * ------------------------------------------------------------------
 * The static half of the validation gate: every check that needs nothing but
 * the render report, so it can run in the browser after each generation as
 * well as in CI.
 *
 * The Node-only checks (OOXML package structure, headless visual rendering)
 * live in scripts/qa_deck.mts and build on these.
 *
 * These checks validate the RENDER REPORT - the shape-level record the renderer
 * produces as it draws - rather than re-deriving what the geometry ought to be.
 * That distinction is the point: the defect that shipped was a mismatch between
 * what the code believed it was drawing and what actually landed on the canvas,
 * and only a check on real emitted shapes can catch that class of bug.
 */

import type { RenderReport, RenderedShape } from './deckRenderer'
import { shapeFillRatio } from './deckRenderer'
import type { SlidePlan } from './slidePlan'
import { NON_BULLET_CONTENT } from './slidePlan'
import type { PresentationSpec } from './presentationSpec'
import { contrastRatio, DEFAULT_SPEC } from './presentationSpec'
import { canvasViolation, EDGE_CLEARANCE, SLIDE_W, SLIDE_H, FILL_LIMIT } from './layout'
import { wordCount } from './textNormalize'
import { BANNED_TITLE_PATTERNS } from './titles'
import { hasSectionNumber } from './documentParts'
import { isCompleteClaim } from './claims'
import { estimateLines } from './fitBudget'
import { slideText, salientTokens } from './speakerNotes'

export interface QaFinding {
  check: string
  severity: 'error' | 'warning'
  slide?: number
  message: string
}

export const err = (check: string, message: string, slide?: number): QaFinding => ({
  check, severity: 'error', message, slide,
})
export const warn = (check: string, message: string, slide?: number): QaFinding => ({
  check, severity: 'warning', message, slide,
})

/**
 * Shapes whose text is chrome, a citation or tabular data rather than a
 * bulleted claim. The 14-word cap and the fragment lint do not apply to them.
 */
const NON_CLAIM_SHAPES = new Set([
  'eyebrow', 'title', 'counter', 'footer', 'deck-title', 'deck-identity',
  'closing-title', 'closing-detail', 'references-list', 'body-table',
  'table-caption', 'stat-value',
])

// --- 1. Off-canvas ------------------------------------------------------

export function checkOffCanvas(report: RenderReport): QaFinding[] {
  const findings: QaFinding[] = []

  if (report.slideW !== SLIDE_W || report.slideH !== SLIDE_H) {
    findings.push(
      err('off-canvas', `deck canvas is ${report.slideW} x ${report.slideH}in; expected ${SLIDE_W} x ${SLIDE_H}in`)
    )
  }

  for (const shape of report.shapes) {
    const violation = canvasViolation(shape.box)
    if (violation) {
      findings.push(err('off-canvas', `"${shape.name}" ${violation}`, shape.slide))
      continue
    }

    // Text must additionally keep clear of the trim so nothing reads as clipped.
    if (shape.kind !== 'text') continue
    const { x, y, w, h } = shape.box
    const gaps: [string, number][] = [
      ['left', x],
      ['top', y],
      ['right', SLIDE_W - (x + w)],
      ['bottom', SLIDE_H - (y + h)],
    ]
    for (const [edge, gap] of gaps) {
      if (gap < EDGE_CLEARANCE - 1e-6) {
        findings.push(
          err('edge-clearance', `"${shape.name}" is ${gap.toFixed(2)}in from the ${edge} edge (minimum ${EDGE_CLEARANCE}in)`, shape.slide)
        )
      }
    }
  }

  return findings
}

// --- 2. Overflow --------------------------------------------------------

export function checkOverflow(report: RenderReport): QaFinding[] {
  const findings: QaFinding[] = []

  for (const shape of report.shapes) {
    if (shape.kind !== 'text') continue
    const ratio = shapeFillRatio(shape)
    // Epsilon, because a box sized to exactly the limit lands a few ulps above
    // it and would fail a strict comparison for no real reason.
    if (ratio > FILL_LIMIT + 1e-9) {
      findings.push(
        err(
          'overflow',
          `"${shape.name}" text is an estimated ${(ratio * 100).toFixed(0)}% of its box height ` +
            `(limit ${(FILL_LIMIT * 100).toFixed(0)}%)`,
          shape.slide
        )
      )
    }
  }

  return findings
}

// --- 3. Bullet hygiene --------------------------------------------------

export function checkBulletHygiene(report: RenderReport): QaFinding[] {
  const findings: QaFinding[] = []

  for (const shape of report.shapes) {
    if (shape.kind === 'shape') continue

    for (const paragraph of shape.paragraphs) {
      if (!paragraph.trim()) {
        findings.push(err('bullet-hygiene', `"${shape.name}" contains an empty paragraph`, shape.slide))
      }
      if (/[\r\n]/.test(paragraph)) {
        findings.push(
          err('bullet-hygiene', `"${shape.name}" has a newline inside a run: ${JSON.stringify(paragraph.slice(0, 50))}`, shape.slide)
        )
      }
      if (/[•‣▶▸]/.test(paragraph)) {
        findings.push(
          err('bullet-hygiene', `"${shape.name}" contains a literal bullet glyph; use the paragraph bullet property`, shape.slide)
        )
      }
    }

    if (/[\r\n]/.test(shape.text)) {
      findings.push(err('bullet-hygiene', `"${shape.name}" flattened text still holds a newline`, shape.slide))
    }
  }

  return findings
}

// --- 4 & 5. Bullet length and fragments --------------------------------

export function checkBulletContent(report: RenderReport, spec: PresentationSpec): QaFinding[] {
  const findings: QaFinding[] = []

  for (const shape of report.shapes) {
    if (shape.kind !== 'text' || !shape.isBulletList) continue
    if (NON_CLAIM_SHAPES.has(shape.name)) continue

    if (shape.paragraphs.length > spec.deck.maxBulletsPerSlide) {
      findings.push(
        err('bullet-count', `"${shape.name}" has ${shape.paragraphs.length} bullets (maximum ${spec.deck.maxBulletsPerSlide})`, shape.slide)
      )
    }

    for (const bullet of shape.paragraphs) {
      const words = wordCount(bullet)
      if (words > spec.deck.maxWordsPerBullet) {
        findings.push(
          err('bullet-length', `${words}-word bullet exceeds ${spec.deck.maxWordsPerBullet}: "${bullet.slice(0, 60)}..."`, shape.slide)
        )
      }
      if (/^[a-z]/.test(bullet.trim())) {
        findings.push(err('fragment', `bullet starts lowercase: "${bullet.slice(0, 60)}"`, shape.slide))
      }
      if (/[,;\-–—]$/.test(bullet.trim())) {
        findings.push(err('fragment', `bullet ends mid-thought: "${bullet.slice(-40)}"`, shape.slide))
      }
    }
  }

  return findings
}

// --- 6. Spec compliance -------------------------------------------------

function rangeFor(shape: RenderedShape, spec: PresentationSpec) {
  switch (shape.role) {
    case 'title': return { name: 'title', range: spec.type.title }
    case 'heading': return { name: 'section heading', range: spec.type.sectionHeading }
    case 'caption': return { name: 'caption', range: spec.type.caption }
    case 'display': return { name: 'display', range: { minPt: spec.type.title.minPt, maxPt: 96 } }
    default: return { name: 'body', range: spec.type.body }
  }
}

export function checkSpecCompliance(report: RenderReport, spec: PresentationSpec): QaFinding[] {
  const findings: QaFinding[] = []
  const allowed = new Set(spec.fontAllowList.map(f => f.toLowerCase()))

  for (const shape of report.shapes) {
    if (shape.kind === 'shape') continue

    if (shape.fontFace && !allowed.has(shape.fontFace.toLowerCase())) {
      findings.push(
        err('font', `"${shape.name}" uses "${shape.fontFace}", which is not in the allow-list (${spec.fontAllowList.join(', ')})`, shape.slide)
      )
    }

    const { name, range } = rangeFor(shape, spec)
    if (shape.fontPt > 0 && (shape.fontPt < range.minPt || shape.fontPt > range.maxPt)) {
      findings.push(
        err('type-scale', `"${shape.name}" is ${shape.fontPt}pt; the ${name} range is ${range.minPt}-${range.maxPt}pt`, shape.slide)
      )
    }

    if (shape.fontPt > 0 && shape.role === 'body' && shape.fontPt < spec.type.bodyAbsoluteMinPt) {
      findings.push(
        err('type-scale', `"${shape.name}" is ${shape.fontPt}pt, below the ${spec.type.bodyAbsoluteMinPt}pt absolute floor`, shape.slide)
      )
    }

    if (shape.color && shape.background) {
      const ratio = contrastRatio(shape.color, shape.background)
      if (Number.isNaN(ratio)) {
        findings.push(err('contrast', `"${shape.name}" has an unreadable colour pair (${shape.color} on ${shape.background})`, shape.slide))
      } else if (ratio < spec.minContrast) {
        findings.push(
          err('contrast', `"${shape.name}" is ${ratio.toFixed(2)}:1 (${shape.color} on ${shape.background}); minimum is ${spec.minContrast}:1`, shape.slide)
        )
      }
    }
  }

  return findings
}

// --- 7. Placeholders ----------------------------------------------------

export function checkPlaceholders(report: RenderReport, spec: PresentationSpec): QaFinding[] {
  const findings: QaFinding[] = []
  const banned = [...spec.bannedStrings, 'lorem', 'todo', '[insert', 'xxx']

  for (const shape of report.shapes) {
    const haystack = shape.text.toLowerCase()
    for (const needle of banned) {
      if (haystack.includes(needle.toLowerCase())) {
        findings.push(err('placeholder', `"${shape.name}" contains the banned string "${needle}"`, shape.slide))
      }
    }
  }

  return findings
}

// --- 8. Provenance ------------------------------------------------------

export function checkProvenance(report: RenderReport, plan: SlidePlan): QaFinding[] {
  const findings: QaFinding[] = []

  for (const slide of report.slides) {
    if (slide.sourceRefs.length === 0 || slide.sourceRefs.every(r => !r.trim())) {
      findings.push(err('provenance', `slide "${slide.title}" has no sourceRefs`, slide.index))
    }
  }

  return findings
}

// --- 9. Speaker notes ---------------------------------------------------

/**
 * Speaker notes.
 *
 * Two numbers are in play and they disagree: the QA specification sets the hard
 * floor at 25 words, while the house standard asks for 40-70. Rather than pick
 * one silently, the hard floor fails the build and the standard's own minimum
 * warns - so a deck that is legal but below the standard is visible rather than
 * invisible.
 */
export function checkNotes(report: RenderReport, spec: PresentationSpec): QaFinding[] {
  const HARD_FLOOR = 25
  const findings: QaFinding[] = []

  for (const slide of report.slides) {
    const words = slide.notesWordCount
    if (words < HARD_FLOOR) {
      findings.push(
        err('notes', `slide "${slide.title}" has ${words} words of speaker notes; ${HARD_FLOOR} is the hard minimum`, slide.index)
      )
    } else if (words < spec.deck.notesMinWords) {
      findings.push(
        warn(
          'notes',
          `slide "${slide.title}" has ${words} words; the standard asks for ` +
            `${spec.deck.notesMinWords}-${spec.deck.notesMaxWords}`,
          slide.index
        )
      )
    }
  }

  return findings
}

/**
 * A content slide must actually fill itself.
 *
 * A single bullet on an otherwise empty slide displays nothing incorrect and
 * still reads as broken. The planner merges thin sections to avoid this; this
 * check is the backstop that stops one shipping if the merge could not.
 */
export function checkUnderfilled(report: RenderReport): QaFinding[] {
  const findings: QaFinding[] = []

  for (const shape of report.shapes) {
    if (shape.name !== 'body-bullets') continue
    if (shape.paragraphs.length >= 2) continue

    findings.push(
      err(
        'underfilled',
        `slide "${report.slides.find(s => s.index === shape.slide)?.title ?? shape.slide}" has ` +
          `${shape.paragraphs.length} bullet(s); a content slide needs at least 2`,
        shape.slide
      )
    )
  }

  return findings
}

// --- Collisions ---------------------------------------------------------

/** Area of the intersection of two boxes, in square inches. */
function overlapArea(a: RenderedShape['box'], b: RenderedShape['box']): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/**
 * No two TEXT boxes on a slide may overlap.
 *
 * This is the analytical half of "inspect every rendered slide for overlap and
 * collisions". Text drawn over text is the failure a reviewer spots instantly
 * in a screenshot, and it is fully determined by the geometry, so it does not
 * need a screenshot to detect.
 *
 * Card fills are excluded: a step card is *meant* to sit behind its label.
 * Only text-on-text is a collision.
 */
export function checkCollisions(report: RenderReport): QaFinding[] {
  const findings: QaFinding[] = []
  const bySlide = new Map<number, RenderedShape[]>()

  for (const shape of report.shapes) {
    if (shape.kind === 'shape') continue
    const list = bySlide.get(shape.slide)
    if (list) list.push(shape)
    else bySlide.set(shape.slide, [shape])
  }

  for (const [slide, shapes] of bySlide) {
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        const area = overlapArea(shapes[i].box, shapes[j].box)
        // A sliver of overlap is rounding in derived geometry, not a collision.
        if (area > 0.01) {
          findings.push(
            err(
              'collision',
              `"${shapes[i].name}" and "${shapes[j].name}" overlap by ${area.toFixed(2)} sq in`,
              slide
            )
          )
        }
      }
    }
  }

  return findings
}

// --- Structural vocabulary, titles and claims ---------------------------

/**
 * Structural vocabulary anywhere in rendered text.
 *
 * Not just titles: "Chapter Two" is equally wrong in a bullet or in the notes,
 * because it tells the audience where the text came from rather than what it
 * says.
 */
/**
 * Chrome, not content.
 *
 * The slide counter reads "3 / 14", which the leading-section-number pattern
 * matches and the audience reads as a page number. Excluding it is not a
 * loophole - the rule is about what the deck SAYS, and a counter says nothing.
 */
const CHROME_SHAPES = new Set(['counter', 'footer'])

export function checkBannedVocabulary(report: RenderReport): QaFinding[] {
  const findings: QaFinding[] = []

  for (const shape of report.shapes) {
    if (!shape.text.trim() || CHROME_SHAPES.has(shape.name)) continue
    for (const { pattern, why } of BANNED_TITLE_PATTERNS) {
      if (pattern.test(shape.text)) {
        findings.push(
          err('banned-vocabulary', `"${shape.name}" contains structural vocabulary — ${why}`, shape.slide)
        )
        break
      }
    }
  }

  for (const slide of report.slides) {
    for (const { pattern, why } of BANNED_TITLE_PATTERNS) {
      if (pattern.test(slide.notes)) {
        findings.push(err('banned-vocabulary', `notes on "${slide.title}" — ${why}`, slide.index))
        break
      }
    }
  }

  return findings
}

/** A section number anywhere in a title or a bullet. */
export function checkSectionNumbers(report: RenderReport): QaFinding[] {
  const findings: QaFinding[] = []

  for (const shape of report.shapes) {
    if (shape.kind !== 'text' || CHROME_SHAPES.has(shape.name)) continue
    for (const paragraph of shape.paragraphs) {
      if (hasSectionNumber(paragraph)) {
        findings.push(
          err('section-number', `"${shape.name}" carries a section number: "${paragraph.slice(0, 60)}"`, shape.slide)
        )
        break
      }
    }
  }

  return findings
}

/** Two slides may not share a title. */
export function checkDuplicateTitles(report: RenderReport): QaFinding[] {
  const seen = new Map<string, number>()
  const findings: QaFinding[] = []

  for (const slide of report.slides) {
    const key = slide.title.trim().toUpperCase()
    if (!key) continue
    const first = seen.get(key)
    if (first !== undefined) {
      findings.push(
        err('duplicate-title', `"${slide.title}" is also the title of slide ${first}`, slide.index)
      )
    } else {
      seen.set(key, slide.index)
    }
  }

  return findings
}

/** Title length: 2-6 words, the reference deck's range. */
export function checkTitleLength(report: RenderReport): QaFinding[] {
  const findings: QaFinding[] = []

  for (const slide of report.slides) {
    if (slide.layout === 'title' || slide.layout === 'closing') continue

    // One idea per title. None of the reference deck's titles carries a colon.
    if (slide.title.includes(':')) {
      findings.push(
        err('title-colon', `"${slide.title}" splices two labels with a colon`, slide.index)
      )
    }

    const n = wordCount(slide.title)
    if (n < 2 || n > 6) {
      findings.push(err('title-length', `"${slide.title}" is ${n} words; titles are 2-6`, slide.index))
    }
  }

  return findings
}

/** Every bullet must be a claim. */
export function checkClaims(report: RenderReport, spec: PresentationSpec): QaFinding[] {
  const findings: QaFinding[] = []

  for (const shape of report.shapes) {
    if (shape.kind !== 'text' || !shape.isBulletList) continue
    if (NON_CLAIM_SHAPES.has(shape.name)) continue

    for (const bullet of shape.paragraphs) {
      const problems = isCompleteClaim(bullet, { maxWords: spec.deck.maxWordsPerBullet })
      if (problems.length > 0) {
        findings.push(
          err('not-a-claim', `"${bullet.slice(0, 55)}" is not a claim (${problems.join(', ')})`, shape.slide)
        )
      }
    }
  }

  return findings
}

// --- Geometry -----------------------------------------------------------

/**
 * The header block must be at least as tall as its wrapped title.
 *
 * The regression this catches: a title that wrapped to two lines inside a box
 * fixed at 0.54in, colliding with the line above and the body below.
 */
export function checkHeaderHeight(report: RenderReport, spec: PresentationSpec): QaFinding[] {
  const findings: QaFinding[] = []

  for (const shape of report.shapes) {
    if (shape.name !== 'title') continue
    const lines = estimateLines(shape.text, shape.box.w, shape.fontPt, shape.fontFace)
    const needed = (lines * shape.fontPt * 1.25) / 72
    if (shape.box.h + 1e-6 < needed) {
      findings.push(
        err(
          'header-height',
          `the title block is ${shape.box.h.toFixed(2)}in but its ${lines} wrapped line(s) need ` +
            `${needed.toFixed(2)}in`,
          shape.slide
        )
      )
    }
  }

  void spec
  return findings
}

/**
 * The largest empty region on a slide.
 *
 * Catches the half-empty table slide: content correct, gate green, and the
 * bottom 55% of the slide blank. Measured on a coarse grid, which is enough to
 * find a large contiguous void without needing exact geometry.
 */
export function checkEmptySpace(report: RenderReport): QaFinding[] {
  const findings: QaFinding[] = []
  const COLS = 24
  const ROWS = 14
  const cellW = SLIDE_W / COLS
  const cellH = SLIDE_H / ROWS

  for (const slide of report.slides) {
    if (slide.layout === 'title' || slide.layout === 'closing') continue

    const shapes = report.shapes.filter(s => s.slide === slide.index)
    const filled: boolean[][] = Array.from({ length: ROWS }, () => new Array(COLS).fill(false))

    for (const shape of shapes) {
      const c0 = Math.max(0, Math.floor(shape.box.x / cellW))
      const c1 = Math.min(COLS - 1, Math.ceil((shape.box.x + shape.box.w) / cellW) - 1)
      const r0 = Math.max(0, Math.floor(shape.box.y / cellH))
      const r1 = Math.min(ROWS - 1, Math.ceil((shape.box.y + shape.box.h) / cellH) - 1)
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) filled[r][c] = true
    }

    // Largest all-empty rectangle, by the classic histogram scan.
    const heights = new Array(COLS).fill(0)
    let largest = 0

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) heights[c] = filled[r][c] ? 0 : heights[c] + 1
      largest = Math.max(largest, largestRectangle(heights))
    }

    const ratio = largest / (COLS * ROWS)
    if (ratio > 0.35) {
      findings.push(
        err(
          'empty-space',
          `slide "${slide.title}" has an empty region covering ${(ratio * 100).toFixed(0)}% of the slide`,
          slide.index
        )
      )
    }
  }

  return findings
}

/** Largest rectangle in a histogram, in cells. */
function largestRectangle(heights: number[]): number {
  const stack: number[] = []
  let best = 0

  for (let i = 0; i <= heights.length; i++) {
    const h = i === heights.length ? 0 : heights[i]
    while (stack.length > 0 && heights[stack[stack.length - 1]] >= h) {
      const height = heights[stack.pop()!]
      const width = stack.length === 0 ? i : i - stack[stack.length - 1] - 1
      best = Math.max(best, height * width)
    }
    stack.push(i)
  }

  return best
}

// --- Notes grounding ----------------------------------------------------

/**
 * Every number and proper noun in the notes must appear on the slide.
 *
 * The defect: "Stress the figure 50ms" where no such figure appears anywhere on
 * the slide. A presenter told to emphasise something the audience cannot see is
 * worse off than one given no notes.
 */
export function checkNotesGrounded(report: RenderReport, plan: SlidePlan): QaFinding[] {
  const findings: QaFinding[] = []

  for (const slide of report.slides) {
    const planned = plan.slides[slide.index - 1]
    if (!planned) continue

    const onSlide = slideText(planned).join(' ').toLowerCase()
    const tokens = new Set(salientTokens(slide.notes))

    for (const token of tokens) {
      const needle = token.toLowerCase().trim()
      if (needle.length < 3) continue
      // Common words that happen to capitalise at a sentence start.
      if (/^(the|and|but|be|ready|then|lead|stress|expect|open)$/i.test(needle)) continue
      if (!onSlide.includes(needle)) {
        findings.push(
          err(
            'notes-ungrounded',
            `notes on "${slide.title}" mention "${token}", which appears nowhere on the slide`,
            slide.index
          )
        )
      }
    }
  }

  return findings
}

// --- Role coverage ------------------------------------------------------

/**
 * Every rhetorical role detected in the source must have a slide.
 *
 * The planner guarantees this; the check exists because the failure mode is
 * silent - a deck with no problem statement and no objectives looks fine until
 * someone asks what the seminar is actually about.
 */
export function checkRoleCoverage(rolesPresent: string[], plan: SlidePlan): QaFinding[] {
  if (rolesPresent.length === 0) return []

  const covered = new Set(plan.slides.map(s => s.role).filter(Boolean))
  return rolesPresent
    .filter(role => !covered.has(role))
    .map(role => err('role-coverage', `the source contains "${role}" but no slide covers it`))
}

// --- Layout variety and deck length -------------------------------------

/**
 * The non-bullet ratio, now an ERROR rather than a warning.
 *
 * The reference deck runs about 85% non-bullet. The floor here is 40%: below
 * that the deck reads as one template repeated, which is what it looked like
 * before layouts were chosen by content shape.
 */
export function checkVariety(report: RenderReport, spec: PresentationSpec): QaFinding[] {
  // Title, closing and references are fixed structural slides, not places where
  // a layout choice was available. Counting references in the denominator
  // penalises the deck for having a bibliography.
  const content = report.slides.filter(
    s => s.layout !== 'title' && s.layout !== 'closing' && s.layout !== 'references'
  )
  if (content.length === 0) return []

  const nonBullet = content.filter(s => NON_BULLET_CONTENT.includes(s.layout))
  const ratio = nonBullet.length / content.length

  if (ratio < spec.deck.minNonBulletRatio) {
    return [
      err(
        'variety',
        `${nonBullet.length} of ${content.length} content slides use a non-bullet layout ` +
          `(${(ratio * 100).toFixed(0)}%, minimum ${(spec.deck.minNonBulletRatio * 100).toFixed(0)}%)`
      ),
    ]
  }
  return []
}

export function checkDeckLength(report: RenderReport, spec: PresentationSpec): QaFinding[] {
  const n = report.slideCount
  if (n < spec.deck.minSlides || n > spec.deck.maxSlides) {
    return [warn('deck-length', `deck is ${n} slides; the spec asks for ${spec.deck.minSlides}-${spec.deck.maxSlides}`)]
  }
  return []
}

// --- The static gate ----------------------------------------------------

export function runStaticChecks(
  report: RenderReport,
  plan: SlidePlan,
  spec: PresentationSpec = DEFAULT_SPEC,
  rolesPresent: string[] = []
): QaFinding[] {
  return [
    ...checkOffCanvas(report),
    ...checkOverflow(report),
    ...checkBulletHygiene(report),
    ...checkBulletContent(report, spec),
    ...checkSpecCompliance(report, spec),
    ...checkPlaceholders(report, spec),
    ...checkProvenance(report, plan),
    ...checkNotes(report, spec),
    ...checkUnderfilled(report),
    ...checkCollisions(report),
    ...checkVariety(report, spec),
    ...checkDeckLength(report, spec),
    // Added for the "what the deck says" pass.
    ...checkBannedVocabulary(report),
    ...checkSectionNumbers(report),
    ...checkDuplicateTitles(report),
    ...checkTitleLength(report),
    ...checkClaims(report, spec),
    ...checkHeaderHeight(report, spec),
    ...checkEmptySpace(report),
    ...checkNotesGrounded(report, plan),
    ...checkRoleCoverage(rolesPresent, plan),
  ]
}

export function formatFindings(findings: QaFinding[]): string {
  if (findings.length === 0) return '  (none)'
  return findings
    .map(f => {
      const where = f.slide ? ` [slide ${f.slide}]` : ''
      return `  ${f.severity === 'error' ? 'ERROR' : 'warn '} ${f.check}${where}: ${f.message}`
    })
    .join('\n')
}
