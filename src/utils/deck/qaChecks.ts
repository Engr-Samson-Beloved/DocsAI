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
import { eyebrowMismatch } from './slidePlan'
import type { PresentationSpec } from './presentationSpec'
import { contrastRatio, DEFAULT_SPEC } from './presentationSpec'
import { canvasViolation, EDGE_CLEARANCE, SLIDE_W, SLIDE_H, FILL_LIMIT } from './layout'
import { wordCount } from './textNormalize'

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

  for (const slide of plan.slides) {
    const mismatch = eyebrowMismatch(slide)
    if (mismatch) findings.push(err('provenance', `slide "${slide.title}": ${mismatch}`))
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

// --- Layout variety and deck length -------------------------------------

export function checkVariety(report: RenderReport, spec: PresentationSpec): QaFinding[] {
  const content = report.slides.filter(s => s.layout !== 'title' && s.layout !== 'closing')
  if (content.length === 0) return []

  const nonBullet = content.filter(s => s.layout !== 'bullets' && s.layout !== 'references')
  const ratio = nonBullet.length / content.length

  if (ratio < spec.deck.minNonBulletRatio) {
    return [
      warn(
        'variety',
        `${nonBullet.length} of ${content.length} content slides use a non-bullet layout ` +
          `(${(ratio * 100).toFixed(0)}%, target ${(spec.deck.minNonBulletRatio * 100).toFixed(0)}%)`
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
  spec: PresentationSpec = DEFAULT_SPEC
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
