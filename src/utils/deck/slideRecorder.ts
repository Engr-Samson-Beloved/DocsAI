/**
 * slideRecorder.ts
 * ------------------------------------------------------------------
 * The single choke point between the painters and pptxgenjs.
 *
 * Every shape passes through here, which is what makes three rules
 * enforceable rather than aspirational:
 *
 *   - no shape may leave the canvas (`assertOnCanvas`, at write time);
 *   - no string handed to pptxgenjs may contain a newline (the phantom-bullet
 *     defect: a trailing "\n" in a bulleted run creates a second, empty
 *     bulleted paragraph);
 *   - every shape is RECORDED, so the QA gate validates what was actually
 *     emitted rather than re-deriving what it thinks should have been.
 *
 * Cards register themselves as backgrounds. The overlap check needs to know
 * that a tinted card is *meant* to sit behind its text, while any other pair of
 * overlapping shapes is a collision.
 */

import { assertOnCanvas, type Box } from './layout'
import type { PresentationSpec } from './presentationSpec'
import type { SlideLayout } from './slidePlan'

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
  /** One entry per paragraph. */
  paragraphs: string[]
  fontPt: number
  fontFace: string
  color: string
  background: string
  isBulletList: boolean
  /** True for a card drawn deliberately behind other shapes. */
  isBackground: boolean
}

export interface RenderedSlide {
  index: number
  layout: SlideLayout
  title: string
  sourceRefs: string[]
  notes: string
  notesWordCount: number
  background: string
  /** The measured height of the title block, for the header check. */
  titleHeight: number
}

export interface RenderReport {
  slideW: number
  slideH: number
  slideCount: number
  shapes: RenderedShape[]
  slides: RenderedSlide[]
  levers: string[]
  spec: { id: string; label: string }
}

export interface TextStyle {
  role: TextRole
  fontPt: number
  fontFace: string
  color: string
  bold?: boolean
  italic?: boolean
  align?: 'left' | 'center' | 'right'
  valign?: 'top' | 'middle' | 'bottom'
  background?: string
  lineSpacingMultiple?: number
}

export class SlideRecorder {
  // Longhand fields: Node's strip-only type removal, which the test runner and
  // the generation harness rely on, rejects TypeScript parameter properties.
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
      isBackground: opts.isBackground ?? false,
    })
  }

  /** A filled rectangle used for grouping. Registered as a background. */
  card(name: string, box: Box, fill: string) {
    this.record(name, 'shape', box, { background: fill, isBackground: true })
    this.slide.addShape('roundRect', {
      ...box,
      fill: { color: fill },
      line: { color: fill, width: 0 },
      rectRadius: 0.06,
    })
  }

  /** A right-pointing connector. Drawn in a gutter, so it overlaps nothing. */
  arrow(name: string, box: Box, color: string) {
    this.record(name, 'shape', box, { background: color })
    this.slide.addShape('rightArrow', {
      ...box,
      fill: { color },
      line: { color, width: 0 },
    })
  }

  /** A downward connector, for a diagram that wraps to a second row. */
  arrowDown(name: string, box: Box, color: string) {
    this.record(name, 'shape', box, { background: color })
    this.slide.addShape('downArrow', {
      ...box,
      fill: { color },
      line: { color, width: 0 },
    })
  }

  text(name: string, box: Box, content: string, style: TextStyle) {
    if (!content.trim()) return
    // A newline inside a run is the phantom-bullet defect. Multi-line content
    // must be passed as separate paragraphs, never as an embedded break.
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
      italic: style.italic ?? false,
      align: style.align ?? 'left',
      valign: style.valign ?? 'top',
      lineSpacingMultiple: style.lineSpacingMultiple ?? 1.2,
      margin: 0,
    })
  }

  /** A list. Each item is its own paragraph object - never one string with newlines. */
  bullets(
    name: string,
    box: Box,
    items: string[],
    style: TextStyle & { bullet?: boolean }
  ) {
    const clean = items.map(i => i.replace(/\s*[\r\n]+\s*/g, ' ').trim()).filter(Boolean)
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
        align: style.align ?? 'left',
        valign: style.valign ?? 'top',
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
      options: { bold: true, color: spec.palette.inverseInk, fill: { color: spec.palette.inverse } },
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
