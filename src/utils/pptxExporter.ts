/**
 * pptxExporter.ts
 * ------------------------------------------------------------------
 * The browser entry point for deck generation.
 *
 * This file used to be the whole generator: HTML parsing, extractive
 * "summarisation", slide budgeting and rendering, all with hard-coded
 * coordinates. That design produced the defects this rewrite fixes - a canvas
 * mismatch that clipped every slide, phantom empty bullets, mid-sentence text,
 * invented section labels, no tables, no diagrams and no speaker notes.
 *
 * The pipeline now lives in ./deck as separate, testable stages:
 *
 *   docTree      HTML            -> structure tree + cover metadata
 *   deckPlan     structure tree   -> slide plan (layouts chosen from real content)
 *   summarize    sentences        -> <=14-word claims + speaker notes
 *   slidePlan    plan             -> validated plan (repair or reject)
 *   deckRenderer validated plan   -> pptxgenjs shapes + a render report
 *   qa_deck      render report    -> pass/fail
 *
 * What remains here is the adapter: gather metadata, run the stages, enforce
 * the QA gate, and hand the file to the browser.
 */

import { buildDocTree } from './deck/docTree'
import { planDeck } from './deck/deckPlan'
import { validateSlidePlan } from './deck/slidePlan'
import { renderDeck } from './deck/deckRenderer'
import { DEFAULT_SPEC, type PresentationSpec } from './deck/presentationSpec'
import { runStaticChecks, formatFindings } from './deck/qaChecks'
import type { DeckMetadata } from './deck/slidePlan'

export interface PptxMetadata {
  title?: string
  studentName?: string
  matricNo?: string
  department?: string
  supervisorName?: string
  academicLevel?: string
  institution?: string
  school?: string
  session?: string
  docHeader?: string
  /**
   * Footer text for content slides. Empty by default and never defaulted to a
   * product name: the shipped deck carried "WordPIlot Seminar Presentation" on
   * every content slide.
   */
  docFooter?: string
}

export interface PptxOptions {
  minSlides?: number
  maxSlides?: number
  includeAgenda?: boolean
  /** Swap the house standard (fonts, sizes, palette, deck rules). */
  spec?: PresentationSpec
  /** Called with the QA findings after generation. */
  onQaReport?: (summary: string) => void
}

/**
 * Placeholder values the UI historically passed when a field was blank. They
 * must never reach a slide, so they are treated as "not supplied" - which sends
 * the caller to the document's own cover page instead.
 */
const PLACEHOLDERS = new Set(
  [
    'student name', 'matric number', 'supervisor name', 'department name',
    'institution name', 'academic seminar presentation', 'untitled', 'untitled document',
    'computer engineering', 'yaba college of technology',
  ].map(s => s.toLowerCase())
)

function supplied(value: string | undefined): string | null {
  const clean = (value ?? '').trim()
  if (!clean) return null
  if (PLACEHOLDERS.has(clean.toLowerCase())) return null
  return clean
}

export class DeckGenerationError extends Error {
  /** Fields the user must supply before a deck can be built. */
  missingFields: string[]

  constructor(message: string, missingFields: string[] = []) {
    super(message)
    this.name = 'DeckGenerationError'
    this.missingFields = missingFields
  }
}

/**
 * Builds a deck from document HTML and downloads it.
 *
 * Metadata precedence is: the document's own cover page first, then values the
 * caller explicitly supplied, and nothing else. There is deliberately no
 * fallback to the filename - "PRINCEWILL SEMINAR(SDN)" as a title slide is the
 * defect this replaces, and a wrong-but-plausible title is worse than an
 * explicit prompt.
 */
export async function exportPresentationPptx(
  fullHtml: string,
  meta: PptxMetadata = {},
  options: PptxOptions = {}
): Promise<void> {
  const spec = options.spec ?? DEFAULT_SPEC

  const tree = buildDocTree(fullHtml)
  if (tree.sections.length === 0) {
    throw new DeckGenerationError(
      'No presentable content was found. Add chapter headings and body text to the document, then export again.'
    )
  }

  const cover = tree.metadata

  // The document wins. Caller values fill gaps only, and each job starts from
  // the document it was given, so nothing carries over from a previous run.
  const metadata: DeckMetadata = {
    title: cover.title ?? supplied(meta.title) ?? '',
    studentName: cover.author ?? supplied(meta.studentName) ?? '',
    matricNo: cover.matricNo ?? supplied(meta.matricNo) ?? '',
    department: cover.department ?? supplied(meta.department) ?? '',
    school: cover.school ?? supplied(meta.school) ?? '',
    institution: cover.institution ?? supplied(meta.institution) ?? '',
    supervisorName: cover.supervisorName ?? supplied(meta.supervisorName) ?? '',
    session: cover.session ?? supplied(meta.session) ?? '',
    footer: supplied(meta.docFooter) ?? '',
  }

  if (!metadata.title) {
    throw new DeckGenerationError(
      'The report title could not be found on the cover page. Enter the title in the document details and export again.',
      ['title']
    )
  }

  const { plan: draft, diagnostics } = planDeck(tree, {
    spec,
    metadata,
    maxSlides: options.maxSlides,
  })

  const validation = validateSlidePlan(draft, spec)
  if (validation.fatal.length > 0) {
    throw new DeckGenerationError(
      `The deck could not be built: ${validation.fatal.length} slide(s) failed validation. ` +
        validation.fatal.slice(0, 3).map(f => `${f.slideTitle}: ${f.problem}`).join('; ')
    )
  }

  const validPlan = { metadata, slides: validation.plan.slides }
  const { pptx, report } = await renderDeck(validPlan, spec)

  // The gate runs on every generation, not just in CI. An error here means a
  // defect of the kind that shipped, so the download is refused rather than
  // handing the user a broken deck.
  const findings = runStaticChecks(report, validPlan, spec)
  const errors = findings.filter(f => f.severity === 'error')

  options.onQaReport?.(
    [
      `${report.slideCount} slides, ${report.shapes.length} shapes`,
      ...diagnostics.decisions.map(d => `plan: ${d}`),
      ...report.levers.map(l => `fit: ${l}`),
      formatFindings(findings),
    ].join('\n')
  )

  if (errors.length > 0) {
    throw new DeckGenerationError(
      `The generated deck failed ${errors.length} quality check(s):\n${formatFindings(errors)}`
    )
  }

  const stem =
    metadata.title.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase().slice(0, 60) ||
    'presentation'
  await pptx.writeFile({ fileName: `${stem}.pptx` })
}
