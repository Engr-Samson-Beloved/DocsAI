/**
 * houseStyle.ts
 * ------------------------------------------------------------------
 * THE single source of truth for how generated work is formatted.
 *
 * Every value here was measured from the school-approved documents in /sample,
 * not invented. Cited per field so anyone can re-verify:
 *
 *   REPORT  <- sample/USMAN ABUBAKAR_SEMINAR.docx
 *             (A4, 1in margins, Times New Roman 12pt, justified, double-spaced,
 *              centered ALL-CAPS chapter headings, numbered sub-headings)
 *   DECK    <- sample/Smart_Energy_Management_RFID_Seminar.pptx
 *             (16:9, 36pt slide headers, 19-20pt body, role-titled slides,
 *              two-column layouts with a key-points sidebar)
 *
 * The two /sample artifacts are a matched pair: the same seminar as report and
 * as deck. That pairing is what lets one spec drive both.
 *
 * Consumers: pptxExporter (deck), the DOCX exporter, the PDF renderer and the
 * editor's page chrome should all read from here rather than hardcoding values,
 * so "what the school approves" changes in exactly one place.
 *
 * Re-derive with: node scratch/docx-spec.mjs <file.docx> <outdir>
 *                 node scratch/deck-inspect.mjs <unzipped>/ppt/slides
 */

// ===================================================================
// REPORT (.docx / .pdf / editor canvas)
// ===================================================================

export const REPORT_STYLE = {
  /** A4. The approved report is 8.27in x 11.69in. */
  page: {
    widthIn: 8.27,
    heightIn: 11.69,
    marginIn: { top: 1.0, right: 1.0, bottom: 1.0, left: 1.0 },
    headerIn: 0.49,
    footerIn: 0.49,
  },

  /** Times New Roman throughout; 12pt body dominates the approved report. */
  font: {
    family: 'Times New Roman',
    bodyPt: 12,
    /** Body is double-spaced and justified in the approved report. */
    lineSpacing: 2.0,
    align: 'justify' as const,
    /**
     * The approved report does NOT indent first lines (the second sample does,
     * at 0.5in). Left as 0 to match /sample, which is the authority.
     */
    firstLineIndentIn: 0,
  },

  /**
   * Heading conventions, measured from the approved report's outline.
   *
   * h1 = chapter title: CENTERED, ALL CAPS, unnumbered ("INTRODUCTION",
   *      "SUMMARY AND CONCLUSION", "ABSTRACT", "REFERENCES").
   * h2 = numbered subsection, left, title case ("2.1 Overview of ...").
   * h3 = deeper subsection, left ("2.2.1 Sensors and Smart Metering Devices").
   *
   * Chapter numbering lives in the sub-headings, not the chapter title. The
   * approved report has no "CHAPTER TWO" line above the title.
   */
  headings: {
    h1: { sizePt: 16, bold: true, align: 'center' as const, allCaps: true, numbered: false },
    h2: { sizePt: 13, bold: true, align: 'left' as const, allCaps: false, numbered: true },
    h3: { sizePt: 12, bold: true, align: 'left' as const, allCaps: false, numbered: true },
    /**
     * The sample inherits Word's default heading colour (2E74B5 blue) because
     * the student never overrode it. That is an artifact of Word's default
     * style, not a deliberate house choice, so generated reports use black.
     */
    color: '000000',
  },

  /** Front matter whose h1 sits left rather than centered in the approved report. */
  leftAlignedFrontMatter: ['LIST OF FIGURES', 'LIST OF TABLES', 'TABLE OF CONTENTS'],

  /**
   * Section order of the approved report. `optional` sections are emitted only
   * when the document actually has the content (figures, tables).
   */
  structure: [
    { id: 'cover', title: null, optional: false },
    { id: 'abstract', title: 'ABSTRACT', optional: false },
    { id: 'toc', title: 'TABLE OF CONTENTS', optional: true },
    { id: 'figures', title: 'LIST OF FIGURES', optional: true },
    { id: 'tables', title: 'LIST OF TABLES', optional: true },
    { id: 'body', title: null, optional: false },
    { id: 'references', title: 'REFERENCES', optional: false },
  ],

  /**
   * Cover page lines, in order, from the approved report. `field` names map to
   * the values the wizard collects; `literal` lines are fixed text.
   */
  cover: [
    { literal: 'YABA COLLEGE OF TECHNOLOGY', emphasis: 'strong' },
    { field: 'title', emphasis: 'title' },
    { literal: 'A SEMINAR REPORT PRESENTED TO:', emphasis: 'normal' },
    { field: 'department', prefix: 'THE DEPARTMENT OF ', emphasis: 'strong' },
    { field: 'school', emphasis: 'normal', fallback: 'SCHOOL OF ENGINEERING' },
    { literal: 'BY:', emphasis: 'normal' },
    { field: 'studentName', emphasis: 'strong' },
    { field: 'matricNo', emphasis: 'normal' },
    {
      literal:
        'A SEMINAR REPORT SUBMITTED IN PARTIAL FULFILMENT OF THE REQUIREMENT FOR THE AWARD OF THE HIGHER NATIONAL DIPLOMA (HND)',
      emphasis: 'normal',
    },
    { literal: 'SUPERVISED BY', emphasis: 'normal' },
    { field: 'supervisorName', emphasis: 'strong' },
    { field: 'session', emphasis: 'normal', fallback: '2025/2026' },
  ],

  /** Caption conventions: "Figure 2.1: ..." centered, "Table 2.1: ..." above the table. */
  captions: {
    figure: { prefix: 'Figure', align: 'center' as const, position: 'below' as const },
    table: { prefix: 'Table', align: 'left' as const, position: 'above' as const },
  },
} as const

// -------------------------------------------------------------------
// Derived values for the DOCX writer
// -------------------------------------------------------------------

/** Word measures in twentieths of a point: 1440 per inch. */
export const TWIPS_PER_INCH = 1440

export function inchesToTwip(inches: number): number {
  return Math.round(inches * TWIPS_PER_INCH)
}

/**
 * `line` in docx is 240ths of a line, so double spacing is 480. The exporter
 * previously wrote 360 (1.5x) throughout, against an approved report that is
 * uniformly double-spaced.
 */
export const REPORT_DOCX = {
  page: {
    width: inchesToTwip(REPORT_STYLE.page.widthIn),
    height: inchesToTwip(REPORT_STYLE.page.heightIn),
    margin: {
      top: inchesToTwip(REPORT_STYLE.page.marginIn.top),
      right: inchesToTwip(REPORT_STYLE.page.marginIn.right),
      bottom: inchesToTwip(REPORT_STYLE.page.marginIn.bottom),
      left: inchesToTwip(REPORT_STYLE.page.marginIn.left),
    },
  },
  /** Half-points, as docx expects for run sizes. */
  bodyHalfPt: REPORT_STYLE.font.bodyPt * 2,
  lineSpacing: Math.round(REPORT_STYLE.font.lineSpacing * 240),
  firstLineIndent: inchesToTwip(REPORT_STYLE.font.firstLineIndentIn),
  /** Hanging indent for reference entries. */
  referenceIndent: { left: inchesToTwip(0.5), hanging: inchesToTwip(0.5) },
  headingHalfPt: {
    1: REPORT_STYLE.headings.h1.sizePt * 2,
    2: REPORT_STYLE.headings.h2.sizePt * 2,
    3: REPORT_STYLE.headings.h3.sizePt * 2,
  } as Record<number, number>,
} as const

export interface HeadingFormat {
  text: string
  align: 'center' | 'left'
  sizeHalfPt: number
  bold: boolean
}

/**
 * Applies the approved heading convention.
 *
 * Chapter titles (h1) are CENTERED and ALL CAPS with no number - the approved
 * report carries chapter numbering in the sub-headings ("2.1 Overview of ..."),
 * never as a separate "CHAPTER TWO" line. Front matter listed in
 * `leftAlignedFrontMatter` sits left instead of centered.
 *
 * Sub-headings (h2/h3) keep their own casing and numbering and stay left.
 */
export function headingConvention(level: number, rawText: string): HeadingFormat {
  const text = rawText.trim()

  if (level <= 1) {
    // Strip a leading "CHAPTER TWO:" / "1.0" so the title stands alone.
    const stripped = text
      .replace(/^chapter\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s*[:.\-]?\s*/i, '')
      .replace(/^\d+\.0\s+/, '')
      .trim()
    const upper = (stripped || text).toUpperCase()
    const isFrontMatter = (REPORT_STYLE.leftAlignedFrontMatter as readonly string[]).includes(upper)
    return {
      text: upper,
      align: isFrontMatter ? 'left' : 'center',
      sizeHalfPt: REPORT_DOCX.headingHalfPt[1],
      bold: true,
    }
  }

  return {
    text,
    align: 'left',
    sizeHalfPt: REPORT_DOCX.headingHalfPt[level] ?? REPORT_DOCX.headingHalfPt[3],
    bold: true,
  }
}

// ===================================================================
// DECK (.pptx)
// ===================================================================

/**
 * Geometry and type measured from the approved deck. Its slide headers are
 * 36pt (not the 24pt the exporter used), the content column starts at 0.60in
 * and runs 12.13in wide, and body text sits at 19-20pt.
 */
export const DECK_STYLE = {
  slide: { widthIn: 13.333, heightIn: 7.5, layout: 'LAYOUT_16x9' as const },

  /** Full-bleed content column. */
  marginIn: 0.6,
  get contentWidthIn() {
    return this.slide.widthIn - this.marginIn * 2 // 12.13
  },

  header: { xIn: 0.6, yIn: 0.38, widthIn: 12.13, heightIn: 0.75, sizePt: 36 },

  /** Body box when the slide is a single column. */
  body: { xIn: 0.6, yIn: 1.5, widthIn: 12.13, heightIn: 4.7 },

  /** Body box when a key-points sidebar is present (approved slide 2). */
  bodyWithSidebar: { xIn: 0.6, yIn: 1.5, widthIn: 7.5, heightIn: 4.7 },

  /**
   * Sidebar cards: 3.80in wide at x=8.78, 1.00in tall, 1.18in apart, each a
   * bold 20pt label over a 16pt detail line.
   */
  sidebar: {
    xIn: 8.78,
    widthIn: 3.8,
    cardHeightIn: 1.0,
    firstYIn: 1.6,
    strideIn: 1.18,
    labelPt: 20,
    detailPt: 16,
    maxCards: 4,
  },

  titleSlide: {
    title: { xIn: 0.9, yIn: 0.7, widthIn: 11.5, heightIn: 2.4, sizePt: 34 },
    subtitle: { xIn: 0.9, yIn: 3.25, widthIn: 11.5, heightIn: 0.4, sizePt: 22 },
    details: { xIn: 0.9, yIn: 3.9, widthIn: 11.5, heightIn: 2.6, sizePt: 18 },
    subtitleText: 'A SEMINAR REPORT PRESENTATION',
  },

  /**
   * Body type. The guideline (FROM SLIDES TO SUCCESS, p.11) allows 18-22pt with
   * a 16pt floor; the approved deck sits at 19-20pt. Start at 20 and step down.
   */
  bodyFont: { maxPt: 20, minPt: 16 },

  /** Slide count and density. Guideline: 12-15 slides, one main idea per slide. */
  deck: { minSlides: 12, maxSlides: 15, maxBulletsPerSlide: 6 },

  font: 'Arial',
} as const

/**
 * Slide titles in the approved deck are role/topic labels in ALL CAPS
 * ("BACKGROUND AND MOTIVATION", "PROBLEM, AIM AND SCOPE", "SYSTEM ARCHITECTURE",
 * "LIMITATIONS AND CHALLENGES", "CONCLUSION AND FUTURE OUTLOOK") - never the
 * report's raw numbered sub-heading. This list is the observed running order and
 * the reference for the exporter's role planner.
 */
export const APPROVED_DECK_ORDER = [
  'BACKGROUND AND MOTIVATION',
  'PROBLEM, AIM AND SCOPE',
  'SYSTEM COMPONENTS',
  'SYSTEM ARCHITECTURE',
  'COMPARISON OF TECHNOLOGIES',
  'APPLICATIONS',
  'ADVANTAGES',
  'LIMITATIONS AND CHALLENGES',
  'CONCLUSION AND FUTURE OUTLOOK',
] as const
