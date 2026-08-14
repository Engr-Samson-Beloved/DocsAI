/**
 * deckRenderer.ts
 * ------------------------------------------------------------------
 * Draws a validated SlidePlan with pptxgenjs.
 *
 * Three structural rules, each fixing a shipped defect:
 *
 *  1. EVERY coordinate comes from `layout.ts`. There are no literal positions
 *     in this file. `assertOnCanvas` runs on every shape before it is added, so
 *     an off-canvas coordinate throws at build time instead of clipping in the
 *     lecture theatre.
 *
 *  2. Bullets are separate array entries carrying `bullet: true` and
 *     `breakLine: true`. No string handed to pptxgenjs ever contains a newline.
 *     The old renderer appended "\n" to each bullet's text, and because the
 *     paragraph was already bulleted, that trailing newline produced a second,
 *     EMPTY bulleted paragraph between every real one - half the body box spent
 *     on blank bullets.
 *
 *  3. No decorative furniture. No accent bar across the title slide, no
 *     vertical stripe beside the heading, no rule under the subtitle. Grouping
 *     is carried by background tint and whitespace, which is what the standard
 *     asks for and what stops the deck looking machine-generated.
 *
 * Every shape is also RECORDED as it is drawn. `scripts/qa_deck.mts` validates
 * that recording, so the QA gate checks what was actually emitted rather than
 * re-deriving what it thinks should have been.
 */

import {
  SLIDE_W, SLIDE_H, LAYOUT_NAME, MARGIN, SAFE, BODY, EYEBROW, TITLE, COUNTER, FOOTER,
  COLUMN_L, COLUMN_R, HERO, rows, assertOnCanvas, type Box,
} from './layout'
import type { PresentationSpec } from './presentationSpec'
import type { PlannedSlide, SlidePlan, SlideLayout } from './slidePlan'
import { fitBullets, estimateHeightIn, type FitLever } from './fitBudget'
import { compressSentence } from './summarize'
import { wordCount } from './textNormalize'

// --- The render recording --------------------------------------------

/**
 * What a piece of text IS, so the QA gate can check its size against the right
 * band of the spec instead of guessing from the shape's name.
 */
export type TextRole = 'title' | 'heading' | 'body' | 'caption' | 'display'

export interface RenderedShape {
  slide: number
  slideLayout: SlideLayout
  name: string
  kind: 'text' | 'shape' | 'table'
  role: TextRole
  box: Box
  /** Flattened text, for placeholder and glyph checks. */
  text: string
  /** One entry per bulleted paragraph. */
  paragraphs: string[]
  fontPt: number
  fontFace: string
  /** Text colour, hex without '#'. */
  color: string
  /** Effective background immediately behind this shape. */
  background: string
  isBulletList: boolean
}

export interface RenderedSlide {
  index: number
  layout: SlideLayout
  title: string
  eyebrow: string
  sourceRefs: string[]
  notes: string
  notesWordCount: number
  background: string
}

export interface RenderReport {
  slideW: number
  slideH: number
  slideCount: number
  shapes: RenderedShape[]
  slides: RenderedSlide[]
  /** Fit-budget escalations, per slide title. */
  levers: string[]
  spec: { id: string; label: string }
}

/**
 * Records every shape and refuses any that escapes the canvas.
 *
 * This wrapper is the single choke point between the renderer and pptxgenjs,
 * which is what makes "no shape may leave the slide" enforceable rather than
 * aspirational.
 */
class SlideRecorder {
  // Written out longhand rather than as TypeScript parameter properties:
  // Node's strip-only type removal (which the test runner and the generation
  // harness both rely on) rejects that syntax.
  private readonly slide: any
  private readonly report: RenderReport
  private readonly index: number
  private readonly layout: SlideLayout
  private background: string

  constructor(slide: any, report: RenderReport, index: number, layout: SlideLayout, background: string) {
    this.slide = slide
    this.report = report
    this.index = index
    this.layout = layout
    this.background = background
  }

  private record(
    name: string,
    kind: RenderedShape['kind'],
    box: Box,
    opts: Partial<RenderedShape> = {}
  ) {
    assertOnCanvas(`slide ${this.index} / ${name}`, box)
    this.report.shapes.push({
      slide: this.index,
      slideLayout: this.layout,
      name,
      kind,
      role: opts.role ?? 'body',
      box,
      text: opts.text ?? '',
      paragraphs: opts.paragraphs ?? (opts.text ? [opts.text] : []),
      fontPt: opts.fontPt ?? 0,
      fontFace: opts.fontFace ?? '',
      color: opts.color ?? '',
      background: opts.background ?? this.background,
      isBulletList: opts.isBulletList ?? false,
    })
  }

  /** A filled rectangle used for grouping. Never a stripe, bar or rule. */
  card(name: string, box: Box, fill: string) {
    this.record(name, 'shape', box, { background: fill, role: 'body' })
    this.slide.addShape('roundRect', {
      ...box,
      fill: { color: fill },
      line: { color: fill, width: 0 },
      rectRadius: 0.06,
    })
    return fill
  }

  text(
    name: string,
    box: Box,
    content: string,
    style: {
      role: TextRole
      fontPt: number
      fontFace: string
      color: string
      bold?: boolean
      align?: 'left' | 'center' | 'right'
      valign?: 'top' | 'middle' | 'bottom'
      background?: string
      lineSpacingMultiple?: number
    }
  ) {
    if (!content.trim()) return
    // A newline inside a run is the A2 defect. Multi-line content must be
    // passed as separate paragraphs, never as an embedded break.
    const flat = content.replace(/\s*[\r\n]+\s*/g, ' ').trim()

    this.record(name, 'text', box, {
      text: flat,
      paragraphs: [flat],
      role: style.role,
      fontPt: style.fontPt,
      fontFace: style.fontFace,
      color: style.color,
      background: style.background,
    })

    this.slide.addText(flat, {
      ...box,
      fontSize: style.fontPt,
      fontFace: style.fontFace,
      color: style.color,
      bold: style.bold ?? false,
      align: style.align ?? 'left',
      valign: style.valign ?? 'top',
      lineSpacingMultiple: style.lineSpacingMultiple ?? 1.2,
      margin: 0,
    })
  }

  /**
   * A bulleted list. Each item becomes its own paragraph object - never one
   * string with newlines in it.
   */
  bullets(
    name: string,
    box: Box,
    items: string[],
    style: {
      role: TextRole
      fontPt: number
      fontFace: string
      color: string
      background?: string
      bullet?: boolean
    }
  ) {
    const clean = items
      .map(i => i.replace(/\s*[\r\n]+\s*/g, ' ').trim())
      .filter(Boolean)
    if (clean.length === 0) return

    this.record(name, 'text', box, {
      text: clean.join(' '),
      paragraphs: clean,
      role: style.role,
      fontPt: style.fontPt,
      fontFace: style.fontFace,
      color: style.color,
      background: style.background,
      isBulletList: style.bullet !== false,
    })

    this.slide.addText(
      clean.map((text, i) => ({
        text,
        options: {
          bullet: style.bullet === false ? false : { indent: 18 },
          // breakLine ends the paragraph. The last item does not need one, and
          // adding it would leave a trailing empty paragraph.
          breakLine: i < clean.length - 1,
        },
      })),
      {
        ...box,
        fontSize: style.fontPt,
        fontFace: style.fontFace,
        color: style.color,
        valign: 'top',
        lineSpacingMultiple: 1.25,
        paraSpaceAfter: style.fontPt * 0.45,
        margin: 0,
      }
    )
  }

  table(name: string, box: Box, headers: string[], body: string[][], spec: PresentationSpec) {
    this.record(name, 'table', box, {
      text: [...headers, ...body.flat()].join(' '),
      paragraphs: [headers.join(' | '), ...body.map(r => r.join(' | '))],
      role: 'caption',
      fontPt: spec.type.caption.maxPt,
      fontFace: spec.bodyFace,
      color: spec.palette.ink,
    })

    const headerRow = headers.map(text => ({
      text,
      options: {
        bold: true,
        color: spec.palette.inverseInk,
        fill: { color: spec.palette.inverse },
      },
    }))

    const bodyRows = body.map((row, r) =>
      row.map(text => ({
        text,
        options: {
          color: spec.palette.ink,
          fill: { color: r % 2 === 0 ? spec.palette.ground : spec.palette.tint },
        },
      }))
    )

    this.slide.addTable([headerRow, ...bodyRows], {
      ...box,
      fontSize: spec.type.caption.maxPt,
      fontFace: spec.bodyFace,
      border: { pt: 1, color: spec.palette.hairline },
      valign: 'middle',
      autoPage: false,
    })
  }

  notes(text: string) {
    this.slide.addNotes(text)
  }

  setBackground(color: string) {
    this.background = color
    this.slide.background = { color }
  }
}

// --- Fit pass ----------------------------------------------------------

/**
 * Applies the fit budget to every bullets slide, splitting where necessary.
 *
 * This runs BEFORE rendering because a split changes the deck length, and the
 * "n / N" counter has to be computed from the final count. The old renderer
 * hard-coded "n / 13" regardless of how many slides it actually produced.
 */
export function applyFitBudget(
  plan: SlidePlan,
  spec: PresentationSpec
): { slides: PlannedSlide[]; fontFor: Map<PlannedSlide, number>; levers: string[] } {
  const out: PlannedSlide[] = []
  const fontFor = new Map<PlannedSlide, number>()
  const levers: string[] = []

  for (const slide of plan.slides) {
    if (slide.layout !== 'bullets' || !slide.bullets || slide.bullets.length === 0) {
      out.push(slide)
      continue
    }

    const result = fitBullets(slide.bullets, {
      box: BODY,
      spec,
      fontFace: spec.bodyFace,
      maxSlides: 2,
      // Lever 1: ask for shorter bullets at a tighter word budget.
      compress: (bullets, wordBudget) =>
        bullets.map(b => compressSentence(b, wordBudget) || b),
    })

    if (result.levers.some((l: FitLever) => l !== 'none')) {
      levers.push(`${slide.title}: ${result.log.join('; ')}`)
    }

    for (const fitted of result.slides) {
      const copy: PlannedSlide = {
        ...slide,
        title: slide.title + fitted.titleSuffix.toUpperCase(),
        bullets: fitted.bullets,
      }
      fontFor.set(copy, fitted.fontPt)
      out.push(copy)
    }
  }

  return { slides: out, fontFor, levers }
}

// --- Chrome ------------------------------------------------------------

/**
 * Eyebrow, title, counter and footer.
 *
 * Deliberately absent: the navy header band, the indigo vertical stripe beside
 * the title, and the accent rule. Hierarchy is carried by size and weight.
 */
function paintChrome(
  rec: SlideRecorder,
  slide: PlannedSlide,
  spec: PresentationSpec,
  slideNo: number,
  total: number,
  footer: string
) {
  if (slide.eyebrow) {
    rec.text('eyebrow', EYEBROW, slide.eyebrow.toUpperCase(), {
      role: 'caption',
      fontPt: spec.type.caption.minPt + 2,
      fontFace: spec.headingFace,
      color: spec.palette.muted,
      bold: true,
      valign: 'middle',
    })
  }

  rec.text('title', TITLE, slide.title, {
    role: 'heading',
    fontPt: spec.type.sectionHeading.minPt + 2,
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

  // Caller-supplied and empty by default. The shipped deck carried a product
  // placeholder here on every content slide.
  if (footer.trim()) {
    rec.text('footer', FOOTER, footer, {
      role: 'caption',
      fontPt: spec.type.caption.minPt,
      fontFace: spec.bodyFace,
      color: spec.palette.muted,
      valign: 'middle',
    })
  }
}

// --- Layout painters ----------------------------------------------------

function paintTitleSlide(rec: SlideRecorder, plan: SlidePlan, spec: PresentationSpec) {
  const m = plan.metadata
  rec.setBackground(spec.palette.inverse)

  const titleBox: Box = { x: HERO.x, y: HERO.y, w: HERO.w, h: 2.4 }
  rec.text('deck-title', titleBox, m.title, {
    role: 'title',
    fontPt: spec.type.title.minPt,
    fontFace: spec.headingFace,
    color: spec.palette.inverseInk,
    bold: true,
    align: 'center',
    valign: 'middle',
    lineSpacingMultiple: 1.15,
  })

  // The identity block: separate paragraphs, not one newline-joined string.
  const identity = [
    m.studentName,
    m.matricNo ? `Matric No: ${m.matricNo}` : '',
    [m.department && `Department of ${titleCase(m.department)}`, m.school].filter(Boolean).join(', '),
    m.institution ? titleCase(m.institution) : '',
    m.supervisorName ? `Supervisor: ${m.supervisorName}` : '',
    m.session ? `Session ${m.session}` : '',
  ].filter(s => s && s.trim())

  const identityBox: Box = {
    x: HERO.x,
    y: titleBox.y + titleBox.h + 0.5,
    w: HERO.w,
    h: SLIDE_H - (titleBox.y + titleBox.h + 0.5) - MARGIN,
  }

  rec.bullets('deck-identity', identityBox, identity, {
    role: 'body',
    fontPt: spec.type.body.minPt,
    fontFace: spec.bodyFace,
    color: spec.palette.inverseMuted,
    bullet: false,
  })
}

function paintClosingSlide(rec: SlideRecorder, plan: SlidePlan, spec: PresentationSpec) {
  const m = plan.metadata
  rec.setBackground(spec.palette.inverse)

  const [top, bottom] = rows({ x: HERO.x, y: HERO.y + 0.6, w: HERO.w, h: HERO.h - 1.2 }, 2, 0.4)

  rec.text('closing-title', top, 'THANK YOU', {
    role: 'title',
    fontPt: spec.type.title.minPt,
    fontFace: spec.headingFace,
    color: spec.palette.inverseInk,
    bold: true,
    align: 'center',
    valign: 'bottom',
  })

  rec.bullets(
    'closing-detail',
    bottom,
    ['Questions & Answers', [m.studentName, m.institution && titleCase(m.institution)].filter(Boolean).join('  |  ')].filter(Boolean),
    {
      role: 'body',
      fontPt: spec.type.body.minPt,
      fontFace: spec.bodyFace,
      color: spec.palette.inverseMuted,
      bullet: false,
    }
  )
}

function paintBullets(rec: SlideRecorder, slide: PlannedSlide, spec: PresentationSpec, fontPt: number) {
  rec.bullets('body-bullets', BODY, slide.bullets ?? [], {
    role: 'body',
    fontPt,
    fontFace: spec.bodyFace,
    color: spec.palette.ink,
  })
}

function paintComparison(rec: SlideRecorder, slide: PlannedSlide, spec: PresentationSpec) {
  const columns = slide.columns ?? []
  const boxes = [COLUMN_L, COLUMN_R]

  columns.slice(0, 2).forEach((column, i) => {
    const box = boxes[i]
    rec.card(`compare-card-${i}`, box, spec.palette.tint)

    const pad = 0.28
    const headBox: Box = { x: box.x + pad, y: box.y + pad, w: box.w - pad * 2, h: 0.6 }
    rec.text(`compare-head-${i}`, headBox, column.heading.toUpperCase(), {
      role: 'body',
      fontPt: spec.type.body.maxPt,
      fontFace: spec.headingFace,
      color: spec.palette.ink,
      bold: true,
      background: spec.palette.tint,
      valign: 'middle',
    })

    const listBox: Box = {
      x: box.x + pad,
      y: headBox.y + headBox.h + 0.15,
      w: box.w - pad * 2,
      h: box.h - (headBox.h + pad * 2 + 0.15),
    }
    rec.bullets(`compare-list-${i}`, listBox, column.bullets, {
      role: 'body',
      fontPt: spec.type.body.minPt,
      fontFace: spec.bodyFace,
      color: spec.palette.ink,
      background: spec.palette.tint,
    })
  })
}

function paintStat(rec: SlideRecorder, slide: PlannedSlide, spec: PresentationSpec) {
  const stat = slide.stat
  if (!stat) return

  const statBox: Box = { x: SAFE.x, y: SAFE.y, w: SAFE.w * 0.34, h: SAFE.h }
  rec.card('stat-card', statBox, spec.palette.accent)

  const pad = 0.3
  const valueBox: Box = { x: statBox.x + pad, y: statBox.y + pad, w: statBox.w - pad * 2, h: statBox.h * 0.45 }
  rec.text('stat-value', valueBox, stat.value, {
    role: 'display',
    fontPt: spec.type.title.maxPt,
    fontFace: spec.headingFace,
    color: spec.palette.inverseInk,
    bold: true,
    align: 'center',
    valign: 'middle',
    background: spec.palette.accent,
  })

  const captionBox: Box = {
    x: statBox.x + pad,
    y: valueBox.y + valueBox.h,
    w: statBox.w - pad * 2,
    h: statBox.h - valueBox.h - pad * 2,
  }
  rec.text('stat-caption', captionBox, stat.caption, {
    role: 'body',
    fontPt: spec.type.body.minPt,
    fontFace: spec.bodyFace,
    color: spec.palette.inverseInk,
    align: 'center',
    valign: 'top',
    background: spec.palette.accent,
  })

  const listBox: Box = {
    x: statBox.x + statBox.w + 0.5,
    y: SAFE.y,
    w: SAFE.w - statBox.w - 0.5,
    h: SAFE.h,
  }
  rec.bullets('stat-support', listBox, slide.bullets ?? [], {
    role: 'body',
    fontPt: spec.type.body.maxPt - 2,
    fontFace: spec.bodyFace,
    color: spec.palette.ink,
  })
}

/**
 * Numbered stages as cards. This is the shape-based diagram the deck previously
 * had none of: real drawn boxes carrying a sequence, not a bullet list.
 */
function paintProcess(rec: SlideRecorder, slide: PlannedSlide, spec: PresentationSpec) {
  const steps = (slide.steps ?? []).slice(0, 5)
  if (steps.length === 0) return

  const boxes = rows(BODY, steps.length, 0.14)

  steps.forEach((step, i) => {
    const box = boxes[i]
    rec.card(`step-card-${i}`, box, spec.palette.tint)

    const badge: Box = { x: box.x + 0.2, y: box.y + (box.h - 0.44) / 2, w: 0.44, h: 0.44 }
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

    const textX = badge.x + badge.w + 0.25
    const textW = box.x + box.w - textX - 0.2

    const hasBody = !!step.body.trim()
    const titleBox: Box = {
      x: textX,
      y: box.y + (hasBody ? 0.1 : 0),
      w: textW,
      h: hasBody ? box.h * 0.44 : box.h,
    }
    rec.text(`step-title-${i}`, titleBox, step.title, {
      role: 'body',
      fontPt: spec.type.body.minPt,
      fontFace: spec.headingFace,
      color: spec.palette.ink,
      bold: true,
      valign: 'middle',
      background: spec.palette.tint,
    })

    if (hasBody) {
      const bodyBox: Box = {
        x: textX,
        y: titleBox.y + titleBox.h,
        w: textW,
        h: box.h - titleBox.h - 0.15,
      }
      rec.text(`step-body-${i}`, bodyBox, step.body, {
        role: 'caption',
        fontPt: spec.type.caption.maxPt,
        fontFace: spec.bodyFace,
        color: spec.palette.muted,
        valign: 'top',
        background: spec.palette.tint,
      })
    }
  })
}

function paintTable(rec: SlideRecorder, slide: PlannedSlide, spec: PresentationSpec) {
  const table = slide.table
  if (!table) return

  let box = BODY
  if (table.caption) {
    const captionBox: Box = { x: BODY.x, y: BODY.y, w: BODY.w, h: 0.32 }
    rec.text('table-caption', captionBox, table.caption, {
      role: 'caption',
      fontPt: spec.type.caption.maxPt,
      fontFace: spec.bodyFace,
      color: spec.palette.muted,
    })
    box = { x: BODY.x, y: BODY.y + 0.42, w: BODY.w, h: BODY.h - 0.42 }
  }

  // Height the rows actually need, so a 2-row table is not stretched over 5in.
  const rowCount = table.rows.length + 1
  const neededH = Math.min(box.h, rowCount * 0.52 + 0.1)
  rec.table('body-table', { ...box, h: neededH }, table.headers, table.rows, spec)
}

function paintReferences(rec: SlideRecorder, slide: PlannedSlide, spec: PresentationSpec) {
  rec.bullets('references-list', BODY, slide.citations ?? [], {
    role: 'caption',
    fontPt: spec.type.caption.maxPt,
    fontFace: spec.bodyFace,
    color: spec.palette.ink,
    bullet: false,
  })
}

function paintQuote(rec: SlideRecorder, slide: PlannedSlide, spec: PresentationSpec) {
  const box: Box = { x: SAFE.x + SAFE.w * 0.08, y: SAFE.y, w: SAFE.w * 0.84, h: SAFE.h }
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

// --- Entry point --------------------------------------------------------

export interface RenderResult {
  pptx: any
  report: RenderReport
}

/**
 * Renders a validated plan. Returns the pptxgenjs instance (unsaved) and the
 * render report the QA gate consumes.
 */
export async function renderDeck(plan: SlidePlan, spec: PresentationSpec): Promise<RenderResult> {
  const module = await import('pptxgenjs')
  const PptxGen: any = (module as any).default || module
  const pptx = new PptxGen()

  // Registered BEFORE any slide is added. pptxgenjs's 'LAYOUT_16x9' preset is
  // 10 x 5.625in; this deck's geometry is 13.333 x 7.5. Shipping the preset
  // while positioning for the larger canvas is what pushed the counter, the
  // footer and the right quarter of every body column off the slide.
  pptx.defineLayout({ name: LAYOUT_NAME, width: SLIDE_W, height: SLIDE_H })
  pptx.layout = LAYOUT_NAME
  pptx.title = plan.metadata.title
  pptx.author = plan.metadata.studentName

  const { slides, fontFor, levers } = applyFitBudget(plan, spec)

  const report: RenderReport = {
    slideW: SLIDE_W,
    slideH: SLIDE_H,
    slideCount: slides.length,
    shapes: [],
    slides: [],
    levers,
    spec: { id: spec.id, label: spec.label },
  }

  const total = slides.length

  slides.forEach((slide, i) => {
    const slideNo = i + 1
    const isInverse = slide.layout === 'title' || slide.layout === 'closing'
    const background = isInverse ? spec.palette.inverse : spec.palette.ground

    const raw = pptx.addSlide()
    raw.background = { color: background }

    const rec = new SlideRecorder(raw, report, slideNo, slide.layout, background)

    if (slide.layout === 'title') {
      paintTitleSlide(rec, plan, spec)
    } else if (slide.layout === 'closing') {
      paintClosingSlide(rec, plan, spec)
    } else {
      paintChrome(rec, slide, spec, slideNo, total, plan.metadata.footer)

      switch (slide.layout) {
        case 'comparison': paintComparison(rec, slide, spec); break
        case 'stat': paintStat(rec, slide, spec); break
        case 'process': paintProcess(rec, slide, spec); break
        case 'table': paintTable(rec, slide, spec); break
        case 'references': paintReferences(rec, slide, spec); break
        case 'quote': paintQuote(rec, slide, spec); break
        default: paintBullets(rec, slide, spec, fontFor.get(slide) ?? spec.type.body.maxPt)
      }
    }

    // Notes are attached here and ONLY here. The old exporter never called
    // addNotes at all, so every slide shipped with empty speaker notes.
    rec.notes(slide.notes)

    report.slides.push({
      index: slideNo,
      layout: slide.layout,
      title: slide.title,
      eyebrow: slide.eyebrow ?? '',
      sourceRefs: slide.sourceRefs,
      notes: slide.notes,
      notesWordCount: wordCount(slide.notes),
      background,
    })
  })

  return { pptx, report }
}

/** Estimated fill of a text shape's box, for the overflow check. */
export function shapeFillRatio(shape: RenderedShape): number {
  if (shape.kind !== 'text' || shape.box.h <= 0 || shape.paragraphs.length === 0) return 0
  const height = estimateHeightIn(
    shape.paragraphs.map(text => ({ text, fontPt: shape.fontPt, fontFace: shape.fontFace })),
    shape.box.w
  )
  return height / shape.box.h
}

function titleCase(text: string): string {
  return text.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}
