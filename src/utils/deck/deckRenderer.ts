/**
 * deckRenderer.ts
 * ------------------------------------------------------------------
 * Draws a validated SlidePlan with pptxgenjs.
 *
 * The drawing itself lives in deckPainters.ts and the pptxgenjs boundary in
 * slideRecorder.ts. What remains here is the deck-level orchestration: register
 * the canvas, run the fit pass, pick a painter per slide, attach notes.
 *
 * Structural rules, each fixing a shipped defect:
 *
 *  1. EVERY coordinate comes from `layout.ts`, and the HEADER IS MEASURED -
 *     the body box is derived from the wrapped title's real height, never a
 *     constant. A fixed 0.54in header is what let a two-line title collide
 *     with the body beneath it.
 *  2. Bullets are separate paragraph entries with `breakLine`; no string handed
 *     to pptxgenjs contains a newline.
 *  3. No decorative furniture, and no chapter eyebrow above the title.
 */

import { SLIDE_W, SLIDE_H, LAYOUT_NAME, BODY, TITLE_MIN_H, TITLE_TOP, bodyBelow } from './layout'
import type { PresentationSpec } from './presentationSpec'
import type { PlannedSlide, SlidePlan } from './slidePlan'
import { fitBullets, estimateHeightIn, type FitLever } from './fitBudget'
import { compressSentence } from './summarize'
import { wordCount } from './textNormalize'
import { SlideRecorder, type RenderReport, type RenderedShape } from './slideRecorder'
import {
  titleBlock, paintTitleSlide, paintClosingSlide, paintBullets, paintCards,
  paintComparison, paintStat, paintProcess, paintDiagram, paintTable,
  paintReferences, paintQuote,
} from './deckPainters'

export type { RenderReport, RenderedShape, RenderedSlide, TextRole } from './slideRecorder'

// --- Fit pass ------------------------------------------------------------

/**
 * Applies the fit budget to every bullets slide, splitting where necessary.
 *
 * Runs BEFORE rendering because a split changes the deck length, and the
 * "n / N" counter has to be computed from the final count.
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
      compress: (bullets, wordBudget) => bullets.map(b => compressSentence(b, wordBudget) || b),
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

// --- Entry point ---------------------------------------------------------

export interface RenderResult {
  pptx: any
  report: RenderReport
}

export async function renderDeck(plan: SlidePlan, spec: PresentationSpec): Promise<RenderResult> {
  const module = await import('pptxgenjs')
  const PptxGen: any = (module as any).default || module
  const pptx = new PptxGen()

  // Registered BEFORE any slide is added. pptxgenjs's 'LAYOUT_16x9' preset is
  // 10 x 5.625in; this deck's geometry is 13.333 x 7.5.
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
    let titleHeight = TITLE_MIN_H

    if (slide.layout === 'title') {
      paintTitleSlide(rec, { ...plan, slides }, spec)
    } else if (slide.layout === 'closing') {
      paintClosingSlide(rec, { ...plan, slides }, spec)
    } else {
      // The body box is whatever is left BELOW the measured title.
      const body = titleBlock(rec, slide, spec, slideNo, total, plan.metadata.footer)
      titleHeight = body.y - TITLE_TOP

      switch (slide.layout) {
        case 'cards': paintCards(rec, slide, spec, body); break
        case 'comparison': paintComparison(rec, slide, spec, body); break
        case 'stat': paintStat(rec, slide, spec, body); break
        case 'process': paintProcess(rec, slide, spec, body); break
        case 'diagram': paintDiagram(rec, slide, spec, body); break
        case 'table': paintTable(rec, slide, spec, body); break
        case 'references': paintReferences(rec, slide, spec, body); break
        case 'quote': paintQuote(rec, slide, spec, body); break
        default: paintBullets(rec, slide, spec, body, fontFor.get(slide) ?? spec.type.body.maxPt)
      }
    }

    // Notes are attached here and ONLY here.
    rec.notes(slide.notes)

    report.slides.push({
      index: slideNo,
      layout: slide.layout,
      title: slide.title,
      sourceRefs: slide.sourceRefs,
      notes: slide.notes,
      notesWordCount: wordCount(slide.notes),
      background,
      titleHeight,
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

void bodyBelow
void SLIDE_H
