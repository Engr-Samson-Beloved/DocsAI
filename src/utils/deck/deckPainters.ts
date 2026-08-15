/**
 * deckPainters.ts
 * ------------------------------------------------------------------
 * The per-layout drawing, split out of deckRenderer so the recorder and the
 * painters can be read separately.
 *
 * Two rules govern everything here:
 *
 *  1. **The header is MEASURED.** `titleBlock` wraps the title with the shared
 *     `estimateLines` and returns its real height; every painter takes its body
 *     box from `bodyBelow(thatHeight)`. A constant header height is what let a
 *     two-line title collide with the body beneath it.
 *
 *  2. **No shape overlaps another**, except a card that is explicitly a
 *     background for the text on top of it. The recorder marks those, and the
 *     gate fails anything else.
 */

import {
  SLIDE_W, SLIDE_H, MARGIN, SAFE, TITLE, COUNTER, FOOTER, TITLE_TOP, TITLE_MIN_H,
  HERO, rows, columns, bodyBelow, FILL_LIMIT, type Box,
} from './layout'
import type { PresentationSpec } from './presentationSpec'
import type { PlannedSlide, SlidePlan } from './slidePlan'
import { estimateLines, estimateHeightIn } from './fitBudget'
import { hasFiniteVerb } from './textNormalize'
import type { SlideRecorder } from './slideRecorder'

/** Points-to-inches for a single line at a given size. */
const lineIn = (pt: number) => (pt * 1.25) / 72

/**
 * Draws the title and returns the body box beneath it.
 *
 * The title's height is computed from its WRAPPED line count, so a long title
 * pushes the body down instead of overlapping it.
 */
export function titleBlock(
  rec: SlideRecorder,
  slide: PlannedSlide,
  spec: PresentationSpec,
  slideNo: number,
  total: number,
  footer: string
): Box {
  const pt = spec.type.sectionHeading.maxPt
  // Upper case, as in the accredited reference deck. Applied at render so the
  // planner and the model can work in ordinary prose.
  const text = slide.title.toUpperCase()
  const lines = estimateLines(text, TITLE.w, pt, spec.headingFace, true)
  const height = Math.max(TITLE_MIN_H, (lines * lineIn(pt)) / FILL_LIMIT + 0.06)

  rec.text('title', { ...TITLE, h: height }, text, {
    role: 'heading',
    fontPt: pt,
    fontFace: spec.headingFace,
    color: spec.palette.ink,
    bold: true,
    valign: 'middle',
  })

  rec.text('counter', COUNTER, `${slideNo} / ${total}`, {
    role: 'caption',
    fontPt: spec.type.caption.minPt + 1,
    fontFace: spec.bodyFace,
    color: spec.palette.muted,
    align: 'right',
    valign: 'middle',
  })

  if (footer.trim()) {
    rec.text('footer', FOOTER, footer, {
      role: 'caption',
      fontPt: spec.type.caption.minPt,
      fontFace: spec.bodyFace,
      color: spec.palette.muted,
      valign: 'middle',
    })
  }

  return bodyBelow(height)
}

/**
 * The one-sentence finding under a table or diagram.
 * Returns the region left above it.
 */
function captionBand(
  rec: SlideRecorder,
  body: Box,
  caption: string | undefined,
  spec: PresentationSpec
): Box {
  if (!caption?.trim()) return body

  const pt = spec.type.caption.maxPt
  const lines = estimateLines(caption, body.w, pt, spec.bodyFace)
  const h = Math.max(0.34, lines * lineIn(pt) + 0.08)
  const box: Box = { x: body.x, y: body.y + body.h - h, w: body.w, h }

  rec.text('caption', box, caption, {
    role: 'caption',
    fontPt: pt,
    fontFace: spec.bodyFace,
    color: spec.palette.muted,
    italic: true,
    valign: 'top',
  })

  return { ...body, h: body.h - h - 0.18 }
}

// --- Title and closing ---------------------------------------------------

/**
 * The identity block, in the order the accredited cover pages use.
 * Short trailing fields are merged when vertical space runs out.
 */
function identityLines(m: SlidePlan['metadata'], merge: number): string[] {
  const lines = [
    m.studentName,
    m.matricNo ? `Matric No: ${m.matricNo}` : '',
    [m.department && `Department of ${titleCase(m.department)}`, m.school].filter(Boolean).join(', '),
    m.institution ? titleCase(m.institution) : '',
    m.supervisorName ? `Supervisor: ${m.supervisorName}` : '',
    m.session ? `Session ${m.session}` : '',
  ].filter(s => s && s.trim())

  // Fold the last lines together rather than let them overflow: two short
  // fields on one line read fine, a clipped block does not.
  for (let i = 0; i < merge && lines.length > 3; i++) {
    const last = lines.pop()!
    lines[lines.length - 1] = `${lines[lines.length - 1]}  |  ${last}`
  }
  return lines
}

export function paintTitleSlide(rec: SlideRecorder, plan: SlidePlan, spec: PresentationSpec) {
  const m = plan.metadata
  rec.setBackground(spec.palette.inverse)

  const slide = plan.slides[0]
  const titlePt = spec.type.title.minPt
  const titleLines = estimateLines(m.title, HERO.w, titlePt, spec.headingFace, true)
  const titleH = Math.max(1.2, (titleLines * lineIn(titlePt)) / FILL_LIMIT + 0.1)

  // Everything between the hero's top and the bottom margin has to hold the
  // title, an optional subtitle and the identity block.
  const available = SLIDE_H - MARGIN - HERO.y

  const measureIdentity = (lines: string[], pt: number) =>
    estimateHeightIn(lines.map(text => ({ text, fontPt: pt, fontFace: spec.bodyFace })), HERO.w) /
    FILL_LIMIT

  const measureSubtitle = (text: string) =>
    Math.max(0.5, (estimateLines(text, HERO.w, spec.type.body.minPt, spec.bodyFace) * lineIn(spec.type.body.minPt)) / FILL_LIMIT + 0.06)

  /**
   * The fit ladder. Preferences in order: keep the subtitle, keep the body
   * size, keep generous gaps, keep every identity field on its own line.
   *
   * Sizing the identity block from what the title happened to leave over is the
   * production defect this replaces: a cover that supplies school AND session
   * gives six lines where the SDN sample gives four, and six did not fit.
   */
  type Fit = { gapA: number; gapB: number; pt: number; subtitle: boolean; merge: number }
  const ladder: Fit[] = []
  for (const merge of [0, 1, 2]) {
    for (const subtitle of [true, false]) {
      for (const pt of [spec.type.body.minPt, spec.type.bodyAbsoluteMinPt]) {
        for (const [gapA, gapB] of [[0.28, 0.35], [0.2, 0.24], [0.14, 0.16]]) {
          ladder.push({ gapA, gapB, pt, subtitle, merge })
        }
      }
    }
  }

  const wanted = slide?.subtitle?.trim()
  let chosen = ladder[ladder.length - 1]
  let identity = identityLines(m, chosen.merge)
  let identityH = measureIdentity(identity, chosen.pt)

  for (const fit of ladder) {
    const lines = identityLines(m, fit.merge)
    const idH = measureIdentity(lines, fit.pt)
    const subH = wanted && fit.subtitle ? measureSubtitle(wanted) + fit.gapB : 0
    if (titleH + fit.gapA + subH + idH <= available) {
      chosen = fit
      identity = lines
      identityH = idH
      break
    }
  }

  const titleBox: Box = { x: HERO.x, y: HERO.y, w: HERO.w, h: titleH }
  rec.text('deck-title', titleBox, m.title, {
    role: 'title',
    fontPt: titlePt,
    fontFace: spec.headingFace,
    color: spec.palette.inverseInk,
    bold: true,
    align: 'center',
    valign: 'middle',
    lineSpacingMultiple: 1.15,
  })

  let cursor = titleBox.y + titleBox.h + chosen.gapA

  if (wanted && chosen.subtitle) {
    const subBox: Box = { x: HERO.x, y: cursor, w: HERO.w, h: measureSubtitle(wanted) }
    rec.text('deck-subtitle', subBox, wanted, {
      role: 'body',
      fontPt: spec.type.body.minPt,
      fontFace: spec.bodyFace,
      color: spec.palette.inverseMuted,
      align: 'center',
      valign: 'middle',
    })
    cursor += subBox.h + chosen.gapB
  }

  // The block gets the height its own text needs, capped by what is left.
  const identityBox: Box = {
    x: HERO.x,
    y: cursor,
    w: HERO.w,
    h: Math.min(Math.max(identityH, 0.5), SLIDE_H - MARGIN - cursor),
  }
  rec.bullets('deck-identity', identityBox, identity, {
    role: 'body',
    fontPt: chosen.pt,
    fontFace: spec.bodyFace,
    color: spec.palette.inverseMuted,
    bullet: false,
    align: 'center',
  })
}

export function paintClosingSlide(rec: SlideRecorder, plan: SlidePlan, spec: PresentationSpec) {
  const m = plan.metadata
  rec.setBackground(spec.palette.inverse)

  const detail = [
    'Questions and Comments',
    [m.studentName, m.matricNo, m.institution && titleCase(m.institution)]
      .filter(Boolean)
      .join('  |  '),
  ].filter(Boolean)

  // Measured, not halved: the detail line carries three fields and can wrap.
  const detailH =
    estimateHeightIn(
      detail.map(text => ({ text, fontPt: spec.type.body.minPt, fontFace: spec.bodyFace })),
      HERO.w
    ) / FILL_LIMIT

  const area = { x: HERO.x, y: HERO.y + 0.6, w: HERO.w, h: HERO.h - 1.2 }
  const top: Box = { ...area, h: Math.max(0.8, area.h - detailH - 0.4) }
  const bottom: Box = { x: area.x, y: top.y + top.h + 0.4, w: area.w, h: detailH }

  rec.text('closing-title', top, 'THANK YOU', {
    role: 'title',
    fontPt: spec.type.title.minPt,
    fontFace: spec.headingFace,
    color: spec.palette.inverseInk,
    bold: true,
    align: 'center',
    valign: 'bottom',
  })

  rec.bullets('closing-detail', bottom, detail, {
    role: 'body',
    fontPt: spec.type.body.minPt,
    fontFace: spec.bodyFace,
    color: spec.palette.inverseMuted,
    bullet: false,
    align: 'center',
  })
}

// --- Content layouts -----------------------------------------------------

export function paintBullets(
  rec: SlideRecorder,
  slide: PlannedSlide,
  spec: PresentationSpec,
  body: Box,
  fontPt: number
) {
  rec.bullets('body-bullets', body, slide.bullets ?? [], {
    role: 'body',
    fontPt,
    fontFace: spec.bodyFace,
    color: spec.palette.ink,
  })
}

/**
 * 3-6 parallel items as a card grid.
 *
 * A list of things that are alike but not sequential reads better side by side
 * than stacked: the reader sees them as a set rather than a ranking.
 */
export function paintCards(
  rec: SlideRecorder,
  slide: PlannedSlide,
  spec: PresentationSpec,
  body: Box
) {
  const items = (slide.bullets ?? []).slice(0, 6)
  if (items.length === 0) return

  const perRow = items.length <= 4 ? 2 : 3
  const rowCount = Math.ceil(items.length / perRow)
  const rowGap = 0.22
  const colGap = 0.28
  const pad = 0.26
  const innerW = (body.w - colGap * (perRow - 1)) / perRow - pad * 2

  // Size the cells from the TALLEST card's measured content, stepping the body
  // font down until the grid fits. Laying out first and hoping the text fits is
  // what put a 296%-full card on the slide.
  const labelPt = spec.type.body.minPt

  // Either every card carries a label or none does. A label needs at least two
  // words to be a heading rather than a severed subject, so if any card cannot
  // produce one, the whole grid shows plain claims.
  const useLabel = items.every(
    item => cardLabel(item).split(/\s+/).filter(Boolean).length >= 2
  )
  let bodyPt = 0
  let cellH = 0

  for (let pt = spec.type.caption.maxPt; pt >= spec.type.caption.minPt; pt--) {
    const tallest = Math.max(
      ...items.map(item => {
        const labelH = useLabel
          ? (estimateLines(cardLabel(item), innerW, labelPt, spec.headingFace, true) * lineIn(labelPt)) /
            FILL_LIMIT
          : 0
        const textH = (estimateLines(item, innerW, pt, spec.bodyFace) * lineIn(pt)) / FILL_LIMIT
        return pad * 2 + 0.42 + 0.12 + labelH + 0.06 + textH + 0.1
      })
    )
    if (tallest * rowCount + rowGap * (rowCount - 1) <= body.h) {
      bodyPt = pt
      cellH = tallest
      break
    }
  }

  // Cards only when they genuinely fit. Clamping the cell height instead just
  // moves the overflow inside the card, where it is harder to see.
  if (bodyPt === 0) {
    paintBullets(rec, slide, spec, body, spec.type.body.minPt)
    return
  }
  const stackH = cellH * rowCount + rowGap * (rowCount - 1)
  const top = body.y + Math.max(0, (body.h - stackH) / 2)

  const rowBoxes = Array.from({ length: rowCount }, (_, r) => ({
    x: body.x,
    y: top + r * (cellH + rowGap),
    w: body.w,
    h: cellH,
  }))

  items.forEach((item, i) => {
    const r = Math.floor(i / perRow)
    const c = i % perRow
    // Always divide by perRow, so a part-filled final row keeps the grid's
    // column width instead of one card spanning the slide.
    const cell = columns(rowBoxes[r], perRow, colGap)[c]

    rec.card(`card-${i}`, cell, spec.palette.tint)

    const badge: Box = { x: cell.x + pad, y: cell.y + pad, w: 0.42, h: 0.42 }
    rec.card(`card-badge-${i}`, badge, spec.palette.accent)
    rec.text(`card-number-${i}`, badge, String(i + 1), {
      role: 'caption',
      fontPt: spec.type.caption.maxPt,
      fontFace: spec.headingFace,
      color: spec.palette.inverseInk,
      bold: true,
      align: 'center',
      valign: 'middle',
      background: spec.palette.accent,
    })

    // A label above the claim, as the reference deck does: the reader scans the
    // labels, then reads the one they want. The label is the claim's own
    // opening phrase, not new text.
    const label = cardLabel(item)
    const w = cell.w - pad * 2

    const labelH = useLabel
      ? (estimateLines(label, w, labelPt, spec.headingFace, true) * lineIn(labelPt)) / FILL_LIMIT + 0.04
      : 0

    const labelBox: Box = { x: cell.x + pad, y: badge.y + badge.h + 0.12, w, h: labelH }
    if (useLabel) {
      rec.text(`card-label-${i}`, labelBox, label, {
        role: 'body',
        fontPt: labelPt,
        fontFace: spec.headingFace,
        color: spec.palette.ink,
        bold: true,
        background: spec.palette.tint,
        valign: 'top',
      })
    }

    const textBox: Box = {
      x: cell.x + pad,
      y: labelBox.y + labelBox.h + (useLabel ? 0.06 : 0),
      w,
      h: cell.h - (labelBox.y - cell.y) - labelBox.h - pad - (useLabel ? 0.06 : 0),
    }
    rec.text(`card-text-${i}`, textBox, useLabel ? cardBody(item, label) : item, {
      role: 'caption',
      fontPt: bodyPt,
      fontFace: spec.bodyFace,
      color: spec.palette.muted,
      background: spec.palette.tint,
      valign: 'top',
    })
  })
}

/**
 * The rest of the claim, once its label has been lifted out.
 *
 * Without this the card printed "Twenty-first century enterprises depend" as a
 * heading and "Twenty-first century enterprises depend on network
 * infrastructure" underneath it - the same words twice.
 */
function cardBody(claim: string, label: string): string {
  const rest = claim.slice(label.length).replace(/^[\s,;:-]+/, '').trim()
  if (rest.split(/\s+/).filter(Boolean).length < 3) return claim
  return rest.charAt(0).toUpperCase() + rest.slice(1)
}

/**
 * A card's label: the claim's opening noun phrase, up to four words.
 * Derived from the claim itself, so it adds no new assertion.
 */
function cardLabel(claim: string): string {
  const words = claim.split(/\s+/).filter(Boolean)

  // The subject is everything before the first finite verb. Using the shared
  // detector rather than a hand-written verb list is what stops labels like
  // "Conventional networks use a" - "use" was simply missing from the list.
  const stop = words.findIndex(w => hasFiniteVerb(w))
  // Cut AT the verb wherever it is. Falling through to "first three words" when
  // the subject was a single word produced labels like "SDN is" and "Security
  // must be" - a head with its predicate amputated.
  let take = stop >= 1 ? stop : Math.min(3, words.length)

  // Never end a label on a function word: "SDN enables administrators to".
  while (
    take > 1 &&
    /^(a|an|the|of|to|in|for|on|with|by|as|at|from|and|or|that|which|its|their|this|these)$/i.test(
      words[take - 1]
    )
  ) {
    take--
  }

  const label = words.slice(0, take).join(' ').replace(/[,;:.]$/, '')
  // A bare demonstrative names nothing.
  return /^(this|that|these|those|it)$/i.test(label) ? words.slice(0, Math.min(3, words.length)).join(' ') : label
}

export function paintComparison(
  rec: SlideRecorder,
  slide: PlannedSlide,
  spec: PresentationSpec,
  body: Box
) {
  const cols = (slide.columns ?? []).slice(0, 2)
  if (cols.length === 0) return

  const pad = 0.3
  const boxes = columns(body, 2, 0.5)

  cols.forEach((column, i) => {
    // One tinted, one dark: the contrast is the point of the layout.
    const dark = i === 1
    const fill = dark ? spec.palette.inverse : spec.palette.tint
    const ink = dark ? spec.palette.inverseInk : spec.palette.ink
    const box = boxes[i]

    rec.card(`compare-card-${i}`, box, fill)

    const headBox: Box = { x: box.x + pad, y: box.y + pad, w: box.w - pad * 2, h: 0.55 }
    rec.text(`compare-head-${i}`, headBox, column.heading.toUpperCase(), {
      role: 'body',
      fontPt: spec.type.body.maxPt,
      fontFace: spec.headingFace,
      color: ink,
      bold: true,
      background: fill,
      valign: 'middle',
    })

    const listBox: Box = {
      x: box.x + pad,
      y: headBox.y + headBox.h + 0.18,
      w: box.w - pad * 2,
      h: box.h - (headBox.h + pad * 2 + 0.18),
    }
    rec.bullets(`compare-list-${i}`, listBox, column.bullets, {
      role: 'body',
      fontPt: spec.type.body.minPt,
      fontFace: spec.bodyFace,
      color: dark ? spec.palette.inverseMuted : spec.palette.ink,
      background: fill,
    })
  })
}

export function paintStat(
  rec: SlideRecorder,
  slide: PlannedSlide,
  spec: PresentationSpec,
  body: Box
) {
  const stat = slide.stat
  if (!stat) return

  const statBox: Box = { x: body.x, y: body.y, w: body.w * 0.32, h: body.h }
  rec.card('stat-card', statBox, spec.palette.inverse)

  const pad = 0.3
  const valueBox: Box = {
    x: statBox.x + pad,
    y: statBox.y + statBox.h * 0.18,
    w: statBox.w - pad * 2,
    h: statBox.h * 0.3,
  }
  rec.text('stat-value', valueBox, stat.value, {
    role: 'display',
    fontPt: 54,
    fontFace: spec.headingFace,
    color: spec.palette.inverseInk,
    bold: true,
    align: 'center',
    valign: 'middle',
    background: spec.palette.inverse,
  })

  const capBox: Box = {
    x: statBox.x + pad,
    y: valueBox.y + valueBox.h + 0.12,
    w: statBox.w - pad * 2,
    h: statBox.h - (valueBox.y - statBox.y) - valueBox.h - pad - 0.12,
  }
  rec.text('stat-caption', capBox, stat.caption, {
    role: 'body',
    fontPt: spec.type.body.minPt,
    fontFace: spec.bodyFace,
    color: spec.palette.inverseMuted,
    align: 'center',
    valign: 'top',
    background: spec.palette.inverse,
  })

  const listBox: Box = {
    x: statBox.x + statBox.w + 0.55,
    y: body.y,
    w: body.w - statBox.w - 0.55,
    h: body.h,
  }
  rec.bullets('stat-support', listBox, slide.bullets ?? [], {
    role: 'body',
    fontPt: spec.type.body.minPt,
    fontFace: spec.bodyFace,
    color: spec.palette.ink,
  })
}

/** Numbered flow: an ordered procedure, left to right, with arrows between. */
export function paintProcess(
  rec: SlideRecorder,
  slide: PlannedSlide,
  spec: PresentationSpec,
  body: Box
) {
  const steps = (slide.steps ?? []).slice(0, 5)
  if (steps.length === 0) return

  const area = captionBand(rec, body, slide.caption, spec)
  const hasBodies = steps.some(s => s.body.trim())
  const gap = 0.42
  const boxes = columns(area, steps.length, gap)

  // Card height is MEASURED from the widest wrapped title and body, so a long
  // step label cannot overflow its box.
  const pad = 0.22
  const innerW = boxes[0].w - pad * 2
  const titlePt = spec.type.body.minPt
  const titleLines = Math.max(
    ...steps.map(s => estimateLines(s.title, innerW, titlePt, spec.headingFace, true))
  )

  // Divided by the fill limit, not padded by a constant: a fixed +0.08 leaves a
  // three-line label at 92.1% of its box, over the limit by a whisker.
  const titleH = (titleLines * lineIn(titlePt)) / FILL_LIMIT + 0.04

  // Step the body size down until the cards fit the area they have. Clamping
  // the height instead pushes the overflow INSIDE the card, where it renders as
  // text on top of text - which is what a five-step flow did.
  let bodyPt = spec.type.caption.maxPt
  let bodyH = 0
  let cardH = 0

  for (let pt = spec.type.caption.maxPt; pt >= spec.type.caption.minPt; pt--) {
    const lines = hasBodies
      ? Math.max(...steps.map(s => (s.body.trim() ? estimateLines(s.body, innerW, pt, spec.bodyFace) : 0)))
      : 0
    const h = lines > 0 ? (lines * lineIn(pt)) / FILL_LIMIT + 0.04 : 0
    const needed = pad * 2 + 0.44 + 0.12 + titleH + (h > 0 ? h + 0.06 : 0) + 0.08

    bodyPt = pt
    bodyH = h
    cardH = needed
    if (needed <= area.h) break
  }

  cardH = Math.min(area.h, Math.max(1.1, cardH))
  const top = area.y + Math.max(0, (area.h - cardH) / 2)

  steps.forEach((step, i) => {
    const cell: Box = { ...boxes[i], y: top, h: cardH }
    rec.card(`step-card-${i}`, cell, spec.palette.tint)

    const badge: Box = { x: cell.x + pad, y: cell.y + pad, w: 0.44, h: 0.44 }
    rec.card(`step-badge-${i}`, badge, spec.palette.accent)
    rec.text(`step-number-${i}`, badge, String(i + 1), {
      role: 'caption',
      fontPt: spec.type.caption.maxPt,
      fontFace: spec.headingFace,
      color: spec.palette.inverseInk,
      bold: true,
      align: 'center',
      valign: 'middle',
      background: spec.palette.accent,
    })

    const titleBox: Box = {
      x: cell.x + pad,
      y: badge.y + badge.h + 0.12,
      w: cell.w - pad * 2,
      h: hasBodies ? titleH : cell.h - (badge.h + pad * 2 + 0.12),
    }
    rec.text(`step-title-${i}`, titleBox, step.title, {
      role: 'body',
      fontPt: spec.type.body.minPt,
      fontFace: spec.headingFace,
      color: spec.palette.ink,
      bold: true,
      background: spec.palette.tint,
      valign: 'top',
    })

    if (hasBodies && step.body.trim()) {
      // Height taken from the measurement the card was sized with, not from
      // whatever space happens to be left: leftovers drift as the title grows.
      const bodyBox: Box = {
        x: cell.x + pad,
        y: titleBox.y + titleBox.h + 0.06,
        w: cell.w - pad * 2,
        h: Math.min(bodyH, cell.h - (titleBox.y - cell.y) - titleBox.h - pad - 0.06),
      }
      rec.text(`step-body-${i}`, bodyBox, step.body, {
        role: 'caption',
        fontPt: spec.type.caption.maxPt,
        fontFace: spec.bodyFace,
        color: spec.palette.muted,
        background: spec.palette.tint,
        valign: 'top',
      })
    }

    // The arrow sits in the gutter, so it overlaps nothing.
    if (i < steps.length - 1) {
      const arrow: Box = {
        x: cell.x + cell.w + 0.08,
        y: cell.y + cardH / 2 - 0.09,
        w: gap - 0.16,
        h: 0.18,
      }
      rec.arrow(`step-arrow-${i}`, arrow, spec.palette.accent)
    }
  })
}

/**
 * A system of components: boxes with arrows, wrapping to a second row.
 *
 * This is the shape diagram the deck previously had none of. It differs from
 * `process` in that the boxes are a structure rather than a sequence, so the
 * fill alternates to separate layers rather than counting steps.
 */
export function paintDiagram(
  rec: SlideRecorder,
  slide: PlannedSlide,
  spec: PresentationSpec,
  body: Box
) {
  const nodes = (slide.steps ?? []).slice(0, 6)
  if (nodes.length === 0) return

  const area = captionBand(rec, body, slide.caption, spec)
  const perRow = nodes.length <= 4 ? nodes.length : Math.ceil(nodes.length / 2)
  const rowCount = Math.ceil(nodes.length / perRow)
  const gap = 0.4
  const rowGap = 0.55

  // Height from the tallest node's own text. Filling the row instead left a
  // three-box diagram as three near-empty columns.
  const pad = 0.18
  const nodeW = (area.w - gap * (perRow - 1)) / perRow - pad * 2
  const titleIn = (spec.type.body.minPt * 1.25) / 72
  const bodyIn = (spec.type.caption.maxPt * 1.25) / 72
  const nodeH = Math.min(
    (area.h - rowGap * (rowCount - 1)) / rowCount,
    Math.max(
      ...nodes.map(n => {
        const tl = estimateLines(n.title, nodeW, spec.type.body.minPt, spec.headingFace, true)
        const bl = n.body.trim() ? estimateLines(n.body, nodeW, spec.type.caption.maxPt, spec.bodyFace) : 0
        return pad * 2 + (tl * titleIn) / FILL_LIMIT + (bl > 0 ? 0.04 + (bl * bodyIn) / FILL_LIMIT : 0) + 0.08
      })
    )
  )

  const stackH = nodeH * rowCount + rowGap * (rowCount - 1)
  const top = area.y + Math.max(0, (area.h - stackH) / 2)
  const rowBoxes = Array.from({ length: rowCount }, (_, r) => ({
    x: area.x,
    y: top + r * (nodeH + rowGap),
    w: area.w,
    h: nodeH,
  }))

  nodes.forEach((node, i) => {
    const r = Math.floor(i / perRow)
    const c = i % perRow
    const inRow = Math.min(perRow, nodes.length - r * perRow)
    const cell = columns(rowBoxes[r], inRow, gap)[c]

    const dark = i % 2 === 0
    const fill = dark ? spec.palette.inverse : spec.palette.tint
    const ink = dark ? spec.palette.inverseInk : spec.palette.ink
    const sub = dark ? spec.palette.inverseMuted : spec.palette.muted

    rec.card(`node-${i}`, cell, fill)

    const hasBody = !!node.body.trim()
    // Measured, not a fraction of the cell: a two-line node label inside a
    // 38%-of-cell box is exactly the overflow the fixed-header bug produced.
    const titleLines = estimateLines(node.title, cell.w - pad * 2, spec.type.body.minPt, spec.headingFace, true)
    const titleBox: Box = {
      x: cell.x + pad,
      y: cell.y + pad,
      w: cell.w - pad * 2,
      h: hasBody
        ? Math.min(cell.h - pad * 2 - 0.3, titleLines * lineIn(spec.type.body.minPt) + 0.08)
        : cell.h - pad * 2,
    }
    rec.text(`node-title-${i}`, titleBox, node.title, {
      role: 'body',
      fontPt: spec.type.body.minPt,
      fontFace: spec.headingFace,
      color: ink,
      bold: true,
      align: 'center',
      valign: 'middle',
      background: fill,
    })

    if (hasBody) {
      const bodyBox: Box = {
        x: cell.x + pad,
        y: titleBox.y + titleBox.h + 0.04,
        w: cell.w - pad * 2,
        h: cell.h - (titleBox.h + pad * 2 + 0.04),
      }
      rec.text(`node-body-${i}`, bodyBox, node.body, {
        role: 'caption',
        fontPt: spec.type.caption.maxPt,
        fontFace: spec.bodyFace,
        color: sub,
        align: 'center',
        valign: 'top',
        background: fill,
      })
    }

    // Arrow to the next node in the same row.
    if (c < inRow - 1) {
      rec.arrow(
        `node-arrow-${i}`,
        { x: cell.x + cell.w + 0.06, y: cell.y + cell.h / 2 - 0.09, w: gap - 0.12, h: 0.18 },
        spec.palette.accent
      )
    }
  })

  // A connector between rows, so the wrap reads as flow rather than a new list.
  if (rowCount === 2) {
    const from = rowBoxes[0]
    rec.arrowDown(
      'node-arrow-wrap',
      { x: from.x + from.w / 2 - 0.09, y: from.y + from.h + 0.08, w: 0.18, h: 0.39 },
      spec.palette.accent
    )
  }
}

export function paintTable(
  rec: SlideRecorder,
  slide: PlannedSlide,
  spec: PresentationSpec,
  body: Box
) {
  const table = slide.table
  if (!table) return

  const area = captionBand(rec, body, table.caption ?? slide.caption, spec)

  // Rows are sized to fill the area rather than sitting in its top third,
  // which is what left the bottom half of a table slide empty.
  const rowCount = table.rows.length + 1
  const h = Math.min(area.h, Math.max(rowCount * 0.62, area.h * 0.9))

  rec.table('body-table', { ...area, h }, table.headers, table.rows, spec)
}

export function paintReferences(
  rec: SlideRecorder,
  slide: PlannedSlide,
  spec: PresentationSpec,
  body: Box
) {
  rec.bullets('references-list', body, slide.citations ?? [], {
    role: 'caption',
    fontPt: spec.type.caption.maxPt,
    fontFace: spec.bodyFace,
    color: spec.palette.ink,
    bullet: false,
  })
}

export function paintQuote(
  rec: SlideRecorder,
  slide: PlannedSlide,
  spec: PresentationSpec,
  body: Box
) {
  const box: Box = { x: body.x + body.w * 0.08, y: body.y, w: body.w * 0.84, h: body.h }
  rec.card('quote-card', box, spec.palette.tint)
  const pad = 0.4
  rec.text(
    'quote-text',
    { x: box.x + pad, y: box.y + pad, w: box.w - pad * 2, h: box.h - pad * 2 },
    slide.quote ?? '',
    {
      role: 'body',
      fontPt: spec.type.body.maxPt,
      fontFace: spec.bodyFace,
      color: spec.palette.ink,
      align: 'center',
      valign: 'middle',
      background: spec.palette.tint,
    }
  )
}

export function titleCase(text: string): string {
  return text.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

void SLIDE_W
void SAFE
void TITLE_TOP
void FILL_LIMIT
