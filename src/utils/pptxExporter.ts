/**
 * pptxExporter.ts
 * ------------------------------------------------------------------
 * Professional Academic PowerPoint Presentation Exporter (.pptx)
 *
 * Design Reference: "FROM SLIDES TO SUCCESS" (HND Seminar Guidelines)
 *
 * Architecture:
 *  Phase 1: Parse HTML   -> DocSection[]  (chapter-aware, document order preserved)
 *  Phase 2: DocSection[] -> Bullet[]      (extractive summarisation + compression)
 *  Phase 3: DocSection[] -> SlideSpec[]   (slide-budget allocation + overflow packing)
 *  Phase 4: SlideSpec[]  -> pptxgenjs render -> .pptx download
 *
 * Rules enforced (and how):
 *  - 12-15 slide deck: a slide BUDGET is allocated across every chapter
 *    (largest-remainder over weight = importance x volume) so the whole document
 *    is represented. The previous version simply truncated the slide list at 13,
 *    which silently dropped Chapters 4 and 5 from long reports.
 *  - Every chapter is guaranteed at least one slide.
 *  - Bullets keep DOCUMENT ORDER. Sentences are scored for selection, then
 *    re-sorted back into the order they appear so the argument still reads.
 *  - Bullets are compressed (citations, hedges and lead-ins stripped, clause-aware
 *    trimming) rather than hard-cut mid-word.
 *  - Overflow is prevented by measuring estimated text lines against the body box
 *    and stepping the font down 22 -> 16pt before splitting onto another slide.
 *  - Typography matches the guideline exactly: Title 36pt (spec 36-40), Section
 *    Heading 24pt (spec 24-28), Body 22-18pt (spec 18-22), floor 16pt.
 *  - Deck order follows the guideline's recommended structure: Title (with name,
 *    matric no, department, supervisor) -> body chapters, with Aim & Objectives
 *    lifted onto its own slide -> Questions. No outline slide: the guideline's
 *    structure does not include one (opt in via options.includeAgenda).
 *  - Max 6 bullets per slide, supporting "limit each slide to one main idea".
 *  - Widescreen 16:9, 60-30-10 colour system, white-on-navy and dark-on-light
 *    pairings from the guideline's contrast table.
 *
 * Note: this file is deliberately ASCII-only. Literal box-drawing and bullet
 * glyphs here have been corrupted by tooling before; where a non-ASCII character
 * is semantically required it is built from char codes.
 */

import { DECK_STYLE } from './houseStyle'

export interface PptxMetadata {
  title?: string
  studentName?: string
  matricNo?: string
  department?: string
  supervisorName?: string
  academicLevel?: string
  institution?: string
  /** e.g. "School of Engineering" - the approved title slide names it. */
  school?: string
  /** Academic session, e.g. "2025/2026". Shown on the title slide. */
  session?: string
  docHeader?: string
  docFooter?: string
}

/** "COMPUTER ENGINEERING" -> "Computer Engineering" for the identity block. */
function toTitleCase(text: string): string {
  return text.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

export interface PptxOptions {
  /** Total slides including title and Q&A. Defaults to the 12-15 guideline. */
  minSlides?: number
  maxSlides?: number
  /**
   * Add an outline/agenda slide. Off by default: the guideline's recommended deck
   * goes Title -> Problem Statement -> Aim & Objectives, with no outline slide.
   */
  includeAgenda?: boolean
}

// --- Layout & theme (LAYOUT_16x9 = 13.333in x 7.5in) ---------------

const SLIDE_W = DECK_STYLE.slide.widthIn
const SLIDE_H = DECK_STYLE.slide.heightIn

const MARGIN_X = DECK_STYLE.marginIn
const BODY_W = DECK_STYLE.body.widthIn
const BODY_TOP = DECK_STYLE.body.yIn
const BODY_H = DECK_STYLE.body.heightIn
const BODY_BOTTOM = BODY_TOP + BODY_H

// Typography comes from the approved deck (sample/Smart_Energy_Management_RFID_
// Seminar.pptx) via houseStyle, cross-checked against the guideline's
// "TYPOGRAPHY AND VISUAL HIERARCHY" page: Title 36-40pt, Section Heading 24-28pt,
// Body 18-22pt, floor 16pt. The approved deck sets slide headers at 36pt - the
// exporter previously used 24pt, which reads as a subtitle from the back of a hall.
const FONT = DECK_STYLE.font
/**
 * Both approved decks pair a grotesque for headings with a humanist for body
 * copy (Arial / Calibri). Setting one face everywhere, as this exporter did,
 * flattens the hierarchy the samples rely on.
 */
const HEAD_FONT = DECK_STYLE.headingFont
const BODY_FACE = DECK_STYLE.bodyFont2
const TITLE_FONT = DECK_STYLE.titleSlide.title.sizePt
const HEADER_FONT = DECK_STYLE.header.sizePt
const SUBHEADER_FONT = 18
const BODY_FONT_MAX = DECK_STYLE.bodyFont.maxPt
const BODY_FONT_MIN = DECK_STYLE.bodyFont.minPt

/**
 * Hard readability cap. Line-fitting alone would happily put nine short bullets
 * on one slide, which is a wall of text at presentation distance even though it
 * technically fits the box. Sub-headings count toward the total.
 */
const MAX_BULLETS_PER_SLIDE = DECK_STYLE.deck.maxBulletsPerSlide

const COLOR = {
  navy: '0F172A',
  ground: 'F8FAFC',
  indigo: '4F46E5',
  indigoLight: 'A5B4FC',
  slate: '334155',
  slateDark: '1E293B',
  muted: '64748B',
  mutedLight: '94A3B8',
  paleRow: 'F1F5F9',
  border: 'CBD5E1',
  white: 'FFFFFF',
  dim: 'CBD5E1',
}

// Characters that survive a PDF/DOCX import as garbage, plus the bullet glyphs
// authors paste into headings. Built from char codes so the source stays ASCII.
const REPLACEMENT_CHARS = new RegExp('[' + String.fromCharCode(0xfffd, 0xfffc) + ']', 'g')
const LEADING_BULLETS = new RegExp(
  '^[\\s' + String.fromCharCode(0x2022, 0x2023, 0x25b6, 0x25b8, 0x2013, 0x2014, 0x2212, 0xfffd) + '*\\-]+'
)

// --- Phase 1: Academic section extraction --------------------------

export type SectionKind = 'front' | 'chapter' | 'back'

export interface Subsection {
  heading: string
  /** Paragraph text belonging to this subsection, in document order. */
  paragraphs: string[]
  /** Explicit list items - already bullet-shaped, so they bypass summarisation. */
  listItems: string[]
}

export interface DocSection {
  kind: SectionKind
  /** Chapter number word (ONE, TWO, ...) or null. */
  chapterNum: string | null
  /** Chapter topic title (INTRODUCTION, LITERATURE REVIEW, ...). */
  title: string
  subsections: Subsection[]
  tables: string[][][]
}

const NUM_TO_WORD: Record<string, string> = {
  '1': 'ONE', '2': 'TWO', '3': 'THREE', '4': 'FOUR', '5': 'FIVE',
  '6': 'SIX', '7': 'SEVEN', '8': 'EIGHT', '9': 'NINE', '10': 'TEN',
}

const WORD_NUMS = 'one|two|three|four|five|six|seven|eight|nine|ten'

function cleanText(txt: string): string {
  return txt
    .replace(/<[^>]*>/g, ' ')
    .replace(REPLACEMENT_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanBulletText(str: string): string {
  return str.replace(LEADING_BULLETS, '').replace(REPLACEMENT_CHARS, '').trim()
}

function isNoiseText(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    lower.includes('format the entire document') ||
    lower.includes('standard academic guidelines') ||
    lower.includes('reorganize the document structure') ||
    lower.includes('apply a specific formatting style') ||
    lower.includes('improve the overall readability') ||
    lower.includes('start writing your document') ||
    lower.includes('click here to edit') ||
    lower.includes('bypassing ai detection')
  )
}

function isCoverPage(el: Element): boolean {
  return el.getAttribute('data-cover') === 'true' || el.closest('[data-cover="true"]') !== null
}

function isTocPage(el: Element): boolean {
  return el.getAttribute('data-toc') === 'true' || el.closest('[data-toc="true"]') !== null
}

const FRONT_MATTER = /^(abstract|executive\s+summary|acknowledge?ments?|dedication)\b/i
const BACK_MATTER = /^(references?|bibliography|appendix|appendices)\b/i
const TOPIC_PATTERN =
  /^(abstract|introduction|literature\s+review|related\s+work|methodology|working\s+principle|findings|results|discussion|conclusion|recommendations?|future\s+scope|references?|bibliography|appendix)/i

/**
 * Recognises a CHAPTER-level heading.
 *
 * Only "CHAPTER X" and the "X.0" form open a new chapter. The previous version
 * also treated "1.1 Background" as a chapter opener, which shattered a five
 * chapter report into a dozen pseudo-chapters and wrecked the slide budget.
 */
function parseChapterHeader(text: string): { chapterNum: string | null; topicTitle: string } | null {
  const clean = text.trim()

  const m1 = clean.match(new RegExp('^chapter\\s+(' + WORD_NUMS + '|\\d+)(?:\\s*[:\\-]\\s*(.*))?$', 'i'))
  if (m1) {
    const rawNum = m1[1].toUpperCase()
    return { chapterNum: NUM_TO_WORD[rawNum] || rawNum, topicTitle: (m1[2] || '').trim() }
  }

  // "1.0 INTRODUCTION" - the .0 marks a chapter root, not a subsection.
  const m2 = clean.match(/^([1-9])\.0\s+(.+)$/)
  if (m2) {
    return { chapterNum: NUM_TO_WORD[m2[1]] || m2[1], topicTitle: m2[2].trim() }
  }

  return null
}

/** "1.1 Background", "2.3.1 Data Flow" - a heading inside a chapter. */
function isSubsectionHeader(text: string): boolean {
  return /^\d+\.\d+(\.\d+)*\s+\S/.test(text.trim())
}

function newSection(kind: SectionKind, chapterNum: string | null, title: string): DocSection {
  return { kind, chapterNum, title, subsections: [], tables: [] }
}

function sectionKindFor(title: string): SectionKind {
  if (BACK_MATTER.test(title)) return 'back'
  if (FRONT_MATTER.test(title)) return 'front'
  return 'chapter'
}

export function extractSections(fullHtml: string): DocSection[] {
  if (typeof window === 'undefined' || !fullHtml.trim()) return []

  const doc = new DOMParser().parseFromString(fullHtml, 'text/html')

  const sections: DocSection[] = []

  // Held on an object rather than in `let` bindings: these are mutated from the
  // helper closures below, and TypeScript's flow analysis cannot follow that for
  // plain locals (it narrows `current` to `never` at the use sites).
  const state: {
    current: DocSection | null
    sub: Subsection | null
    pendingChapterNum: string | null
  } = { current: null, sub: null, pendingChapterNum: null }

  const flushSubsection = () => {
    const { current, sub } = state
    if (current && sub && (sub.paragraphs.length > 0 || sub.listItems.length > 0)) {
      current.subsections.push(sub)
    }
    state.sub = null
  }

  const openSubsection = (heading: string) => {
    flushSubsection()
    state.sub = { heading: cleanBulletText(heading), paragraphs: [], listItems: [] }
  }

  const ensureSubsection = (): Subsection => {
    if (!state.sub) state.sub = { heading: '', paragraphs: [], listItems: [] }
    return state.sub
  }

  const closeSection = () => {
    flushSubsection()
    const { current } = state
    if (current && (current.subsections.length > 0 || current.tables.length > 0)) {
      sections.push(current)
    }
    state.current = null
  }

  const openSection = (kind: SectionKind, chapterNum: string | null, title: string) => {
    closeSection()
    state.current = newSection(kind, chapterNum, title)
  }

  const pages = Array.from(doc.querySelectorAll('div[data-type="page"]'))
  const contentPages = pages.filter(p => !isCoverPage(p) && !isTocPage(p))
  const containers: Element[] = contentPages.length > 0 ? contentPages : [doc.body]

  for (const container of containers) {
    const elements = Array.from(container.querySelectorAll('h1, h2, h3, h4, p, ul, ol, table'))

    for (const el of elements) {
      if (isCoverPage(el) || isTocPage(el)) continue

      const tag = el.tagName.toLowerCase()
      const text = cleanText(el.textContent || '')
      if (!text || isNoiseText(text)) continue

      if (tag === 'h1' || tag === 'h2') {
        const parsed = parseChapterHeader(text)

        if (parsed) {
          if (parsed.topicTitle) {
            openSection('chapter', parsed.chapterNum, parsed.topicTitle.toUpperCase())
            state.pendingChapterNum = null
          } else {
            // Bare "CHAPTER TWO" - the topic title lands on the next heading.
            closeSection()
            state.pendingChapterNum = parsed.chapterNum
          }
          continue
        }

        if (state.pendingChapterNum) {
          openSection('chapter', state.pendingChapterNum, text.toUpperCase())
          state.pendingChapterNum = null
          continue
        }

        // A numbered subsection styled as h1/h2 belongs to the open chapter.
        if (isSubsectionHeader(text) && state.current) {
          openSubsection(text)
          continue
        }

        if (tag === 'h1' || TOPIC_PATTERN.test(text)) {
          openSection(sectionKindFor(text), null, text.toUpperCase())
          continue
        }

        if (!state.current) openSection(sectionKindFor(text), null, text.toUpperCase())
        else openSubsection(text)
        continue
      }

      if (tag === 'h3' || tag === 'h4') {
        if (!state.current) openSection(sectionKindFor(text), null, text.toUpperCase())
        else openSubsection(text)
        continue
      }

      if (tag === 'ul' || tag === 'ol') {
        if (!state.current) continue
        const target = ensureSubsection()
        for (const li of Array.from(el.querySelectorAll('li'))) {
          const itemText = cleanBulletText(cleanText(li.textContent || ''))
          if (itemText.length > 3 && !isNoiseText(itemText)) target.listItems.push(itemText)
        }
        continue
      }

      if (tag === 'table') {
        const section = state.current
        if (!section) continue
        const grid: string[][] = []
        for (const tr of Array.from(el.querySelectorAll('tr'))) {
          const cells = Array.from(tr.children).filter(
            c => c.tagName.toLowerCase() === 'td' || c.tagName.toLowerCase() === 'th'
          )
          const rowText = cells.map(c => cleanText(c.textContent || ''))
          if (rowText.some(t => t.length > 0)) grid.push(rowText)
        }
        if (grid.length > 0) section.tables.push(grid)
        continue
      }

      if (tag === 'p') {
        if (!state.current) continue
        if (text.length > 20 && !/^page\s+\d+$/i.test(text)) {
          ensureSubsection().paragraphs.push(text)
        }
      }
    }
  }

  closeSection()
  return sections
}

// --- Phase 2: Extractive summarisation -----------------------------

/**
 * Sentence split that survives "Fig. 3", "et al.", "i.e." and decimals:
 * non-terminal periods are swapped for a sentinel, split, then restored.
 */
const DOT_SENTINEL = String.fromCharCode(1)

function splitSentences(text: string): string[] {
  const guarded = text
    .replace(
      /\b(Fig|Figs|Eq|No|Vol|pp|Dr|Prof|Mr|Mrs|Ms|St|approx|etc|al|e\.g|i\.e|cf|vs)\./gi,
      m => m.slice(0, -1) + DOT_SENTINEL
    )
    .replace(/(\d)\.(\d)/g, '$1' + DOT_SENTINEL + '$2')

  return guarded
    .split(/(?<=[.!?])\s+(?=["'(\[]?[A-Z0-9])/)
    .map(s => s.split(DOT_SENTINEL).join('.').trim())
    .filter(Boolean)
}

const LEAD_INS =
  /^(however|therefore|moreover|furthermore|in addition|additionally|consequently|subsequently|thus|hence|indeed|also|nevertheless|nonetheless|as a result|for instance|for example|in fact|in general|in particular|overall|finally|firstly|secondly|thirdly|lastly|on the other hand|that is|in other words|notably|importantly)\b[\s,:-]*/i

const HEDGES =
  /^(it is (?:important|crucial|worth|necessary|essential) to (?:note|remember|mention|state|emphasi[sz]e) that|it should be noted that|this (?:chapter|section|study|paper|work|project) (?:presents|discusses|describes|examines|explores|covers|outlines|introduces))\b[\s:,-]*/i

/** Scoring cues - the sentences an examiner actually wants on a slide. */
const HIGH_VALUE =
  /\b(aim|objective|purpose|propose[ds]?|develop(?:ed|ment)?|design(?:ed)?|implement(?:ed|ation)?|result(?:s|ed)?|finding|achieve[ds]?|improve[ds]?|reduce[ds]?|increase[ds]?|accuracy|performance|efficiency|conclude[ds]?|recommend(?:ed|ation)?|significant|demonstrat(?:e|ed|es)|show(?:s|ed|n)?)\b/i
const TECHNICAL =
  /\b(system|model|algorithm|architecture|framework|method|technique|process|data|network|analysis|evaluation|experiment|test(?:ing)?)\b/i

const STOPWORDS = new Set(
  ('the a an and or of to in for on with by as is are was were be been being that this these those it its from at ' +
    'which such can may will would could should has have had not but also more most other than then there their they ' +
    'we our us he she his her them into over under between within while when where what who whom whose how why').split(
    /\s+/
  )
)

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w))
}

/**
 * Trims to `maxChars` without cutting a word in half, preferring a natural clause
 * boundary in the back half of the budget so the bullet still ends as a phrase.
 */
function trimToLength(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text

  const window = text.slice(0, maxChars + 1)
  const floor = Math.floor(maxChars * 0.6)

  const clause = Math.max(
    window.lastIndexOf('; '),
    window.lastIndexOf(', '),
    window.lastIndexOf(' which '),
    window.lastIndexOf(' because '),
    window.lastIndexOf(' so that ')
  )
  if (clause > floor) return text.slice(0, clause).replace(/[,;\s]+$/, '')

  const space = window.lastIndexOf(' ')
  return text.slice(0, space > floor ? space : maxChars).replace(/[,;\s]+$/, '')
}

/**
 * True when a candidate reads as the middle of somebody else's sentence.
 *
 * Imported PDFs and DOCX files break paragraphs on layout, not grammar, so the
 * sentence splitter regularly hands back continuations like "Compete effectively
 * on the international stage, which in turn limits ...". Rendered as bullets and
 * force-capitalised, those look like statements the student wrote, and the
 * accredited decks contain nothing of the kind.
 */
function isSentenceFragment(text: string): boolean {
  const s = text.trim()
  if (!s) return true

  // Opens with a lowercase word: unambiguously a continuation.
  if (/^[a-z]/.test(s)) return true

  // Opens with a word that cannot start an independent clause.
  if (/^(and|but|or|nor|yet|so|which|that|because|although|though|whereas|while|since|as|if|unless|until|whether|thus|hence)\b/i.test(s)) {
    return true
  }

  // Opens with a subordinating participle/preposition fragment, e.g.
  // "Border data-governance regimes ...", "Skills, particularly in ...".
  if (/^(?:[A-Z][a-z]+),\s/.test(s)) return true

  // Unbalanced brackets mean the clause was cut out of a longer construction.
  const open = (s.match(/\(/g) || []).length
  const close = (s.match(/\)/g) || []).length
  if (open !== close) return true

  return false
}

/**
 * Turns a full academic sentence into slide-shaped text.
 *
 * Returns '' when the input is a mid-sentence fragment. Callers drop those
 * rather than presenting them as bullets: a dangling clause with a capital
 * letter bolted on reads as a broken statement to an examiner.
 */
function condense(sentence: string, maxChars: number): string {
  let s = cleanBulletText(sentence)

  // Dot leaders from an imported table of contents:
  // "Development of the African Tech Ecosystem ..............."
  s = s.replace(/\s*\.{4,}\s*\d*\s*$/, '')

  s = s.replace(HEDGES, '')
  s = s.replace(LEAD_INS, '')
  s = s.replace(/\s*\([^)]*\b(19|20)\d{2}[a-z]?\b[^)]*\)/g, '') // (Author, 2021)
  s = s.replace(/\s*\[\d+(?:\s*[,-]\s*\d+)*\]/g, '') // [12], [3, 4]
  s = s.replace(/\s+([,.;:])/g, '$1')
  s = s.replace(/\s+/g, ' ').trim()

  // Judge the fragment before trimming: stripping a lead-in can leave a clause
  // that only looked complete because of the connector in front of it.
  if (isSentenceFragment(s)) return ''

  s = trimToLength(s, maxChars)
  s = s.replace(/[.\s]+$/, '') // slide bullets do not take terminal periods

  if (s.length > 0) s = s.charAt(0).toUpperCase() + s.slice(1)
  return s
}

/**
 * Picks the `limit` most informative sentences from a block of prose and returns
 * them IN DOCUMENT ORDER. Selection is scored, presentation is chronological -
 * ranking the output directly (as this file used to) scrambles the argument.
 */
function summarizeProse(paragraphs: string[], limit: number, maxChars: number): string[] {
  if (limit <= 0) return []

  const sentences: { text: string; index: number; posInPara: number }[] = []
  for (const para of paragraphs) {
    if (isNoiseText(para)) continue
    splitSentences(para).forEach((s, posInPara) => {
      const trimmed = s.trim()
      if (trimmed.length < 25 || isNoiseText(trimmed)) return
      sentences.push({ text: trimmed, index: sentences.length, posInPara })
    })
  }

  if (sentences.length === 0) return []

  // Term frequency across the whole block drives topical relevance.
  const tf = new Map<string, number>()
  for (const s of sentences) {
    for (const w of contentWords(s.text)) tf.set(w, (tf.get(w) || 0) + 1)
  }

  const scored = sentences.map(s => {
    const words = contentWords(s.text)
    const density = words.length ? words.reduce((sum, w) => sum + (tf.get(w) || 0), 0) / words.length : 0

    let score = density
    if (s.posInPara === 0) score += 1.5 // topic sentences carry the paragraph's claim
    if (HIGH_VALUE.test(s.text)) score += 2.5
    if (TECHNICAL.test(s.text)) score += 1
    if (/\d/.test(s.text)) score += 1.2
    if (s.text.length > 45 && s.text.length < 220) score += 0.8
    if (s.text.length > 300) score -= 1.5
    if (LEAD_INS.test(s.text)) score -= 0.5 // reads as a continuation once isolated

    return { text: s.text, index: s.index, score }
  })

  // Condense BEFORE the top-`limit` cut. Fragments are dropped by condense(),
  // and discarding them afterwards would silently under-fill the slide - the
  // selection has to choose among sentences that will actually survive.
  const usable = scored
    .map(s => ({ ...s, bullet: condense(s.text, maxChars) }))
    .filter(s => s.bullet.length > 12)

  const picked = [...usable]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index) // restore document order

  const seen = new Set<string>()
  const out: string[] = []
  for (const s of picked) {
    const key = s.bullet.toLowerCase().slice(0, 60)
    if (!seen.has(key)) {
      seen.add(key)
      out.push(s.bullet)
    }
  }
  return out
}

// --- Phase 3: Slide budgeting & mapping ----------------------------

type BulletKind = 'point' | 'sub'

export interface Bullet {
  text: string
  kind: BulletKind
}

interface SlideSpec {
  headerText: string
  subHeaderText?: string
  bullets: Bullet[]
  tableRows?: string[][]
  /**
   * How the body is laid out.
   *  bullets    - single column list (the default)
   *  table      - a rendered table
   *  references - compact citation list
   *  steps      - numbered badge rows, for aims and objectives
   *  sidebar    - narrative column with concept cards alongside
   *
   * `steps` and `sidebar` mirror the approved decks in /sample, which vary the
   * layout per slide instead of repeating one template for the whole deck.
   */
  variant?: 'bullets' | 'table' | 'references' | 'steps' | 'sidebar'
  /** sidebar variant: card labels taken from the section's sub-headings. */
  cards?: { label: string; detail: string }[]
}

/** Presentation importance by section topic - what a seminar audience needs. */
function importanceOf(section: DocSection): number {
  const t = section.title.toLowerCase()
  if (/reference|bibliograph/.test(t)) return 0.35
  if (/appendix|appendices|acknowledge|dedication/.test(t)) return 0.2
  if (/result|finding|discussion|evaluation|analysis/.test(t)) return 1.4
  if (/methodolog|design|implementation|working principle|material/.test(t)) return 1.3
  if (/conclusion|recommend|future/.test(t)) return 1.2
  if (/aim|objective/.test(t)) return 1.2
  if (/abstract|introduction|background/.test(t)) return 1.0
  if (/literature|related work|review/.test(t)) return 0.8
  return 1.0
}

function volumeOf(section: DocSection): number {
  let words = 0
  for (const sub of section.subsections) {
    words += sub.paragraphs.reduce((n, p) => n + p.split(/\s+/).length, 0)
    words += sub.listItems.reduce((n, p) => n + p.split(/\s+/).length, 0)
  }
  return words
}

function isReferenceSection(section: DocSection): boolean {
  return /reference|bibliograph/.test(section.title.toLowerCase())
}

function isCappedSection(section: DocSection): boolean {
  return /reference|bibliograph|appendix|appendices/.test(section.title.toLowerCase())
}

// --- Phase 3a: Role-based deck planning ------------------------------
//
// The guideline prescribes WHAT a seminar deck must cover, in order:
//   Title -> Problem Statement -> Aim & Objectives -> Literature Review ->
//   System Architecture -> Hardware Design -> Software Design ->
//   Testing & Results -> Prototype -> Conclusion -> Questions
//
// Walking the chapters and summarising each in turn does not produce that. It
// produces decks like "1.1 INTRODUCTION (CONTINUED)" followed by "2.1 SUMMARY OF
// EXISTING WORKS (CONTINUED)" - no problem statement, no objectives, no results,
// and the subsection numbering leaking into the slide titles.
//
// So the planner works the other way round: it searches the whole document for
// the content that fills each required role, labels the slide by that role, and
// DROPS material that earns no place. Slides are a summary of the argument, not
// a compressed copy of the report.

interface SlideRole {
  id: string
  /** Slide title. Deliberately the role, not the source heading. */
  title: string
  match: RegExp
  /** 1 = named by the guideline's structure; 3 = only if budget remains. */
  priority: 1 | 2 | 3
  /** Ceiling on slides this role may claim when there is content to justify it. */
  maxSlides: number
}

/**
 * Canonical deck order. This array is the order slides appear in.
 *
 * Patterns anchor on the left only. These are stems, so a trailing \b would be
 * wrong: /\bmethodolog\b/ cannot match "Methodology" because the boundary it
 * demands after "methodolog" runs into "y". That silently dropped the
 * Methodology slide - a priority-1 role - while priority-3 roles took its place.
 */
const SLIDE_ROLES: SlideRole[] = [
  { id: 'problem', title: 'Problem Statement', priority: 1, maxSlides: 1,
    match: /\b(problem|motivation|challenges? facing|need for|background of (the )?study)/i },
  { id: 'aim', title: 'Aim & Objectives', priority: 1, maxSlides: 1,
    match: /\b(aims?\b|objective|purpose of (the )?study)/i },
  { id: 'scope', title: 'Scope & Significance', priority: 3, maxSlides: 1,
    match: /\b(scope|significan|justification|relevance)/i },
  { id: 'literature', title: 'Literature Review', priority: 2, maxSlides: 2,
    match: /\b(literature|related works?|existing (works?|systems?)|previous (works?|studies))/i },
  { id: 'concepts', title: 'Theoretical Background', priority: 3, maxSlides: 1,
    match: /\b(core concepts?|theoretical|fundamental|principle)/i },
  { id: 'gap', title: 'Research Gap', priority: 2, maxSlides: 1,
    match: /\b(research gaps?|gaps? in|limitations? of existing|open (issues|problems))/i },
  { id: 'methodology', title: 'Methodology', priority: 1, maxSlides: 1,
    match: /\b(methodolog|approach|procedure|materials? and methods?|research design)/i },
  { id: 'architecture', title: 'System Architecture', priority: 1, maxSlides: 2,
    match: /\b(architectur|system design|block diagram|data ?flow|framework|model design)/i },
  { id: 'hardware', title: 'Hardware Design', priority: 2, maxSlides: 1,
    match: /\b(hardware|circuit|sensor|components? used)/i },
  { id: 'software', title: 'Software Design', priority: 2, maxSlides: 1,
    match: /\b(software|algorithm|flowchart|pseudo ?code|program logic|implementation)/i },
  { id: 'results', title: 'Testing & Results', priority: 1, maxSlides: 2,
    match: /\b(results?\b|testing|evaluation|performance|finding|key takeaway|discussion)/i },
  { id: 'application', title: 'Applications & Benefits', priority: 3, maxSlides: 1,
    match: /\b(application|benefit|advantage|use cases?)/i },
  { id: 'challenges', title: 'Challenges & Limitations', priority: 2, maxSlides: 1,
    match: /\b(challenge|limitation|drawback|constraint)/i },
  { id: 'conclusion', title: 'Conclusion', priority: 1, maxSlides: 1,
    match: /\b(conclusion|concluding)/i },
  { id: 'recommendation', title: 'Recommendations & Future Work', priority: 2, maxSlides: 1,
    match: /\b(recommend|future (work|scope|direction|research))/i },
]

interface ContentUnit extends Subsection {
  chapterNum: string | null
  sectionTitle: string
  words: number
}

function flattenUnits(sections: DocSection[]): ContentUnit[] {
  const units: ContentUnit[] = []
  for (const section of sections) {
    if (section.kind === 'back') continue // references are handled separately
    for (const sub of section.subsections) {
      const words =
        sub.paragraphs.reduce((n, p) => n + p.split(/\s+/).length, 0) +
        sub.listItems.reduce((n, p) => n + p.split(/\s+/).length, 0)
      if (words < 15) continue // too thin to say anything on a slide
      units.push({ ...sub, chapterNum: section.chapterNum, sectionTitle: section.title, words })
    }
  }
  return units
}

/** How well a block of content answers a given slide role. */
function roleScore(role: SlideRole, unit: ContentUnit): number {
  let score = 0
  if (role.match.test(unit.heading)) score += 10
  if (role.match.test(unit.sectionTitle)) score += 4
  // A weak signal from the prose itself, so an unnamed subsection can still land.
  if (role.match.test(unit.paragraphs.join(' ').slice(0, 800))) score += 1
  return score
}

function assignUnits(units: ContentUnit[]): Map<string, ContentUnit[]> {
  const byRole = new Map<string, ContentUnit[]>()

  for (const unit of units) {
    let best: SlideRole | null = null
    let bestScore = 0
    for (const role of SLIDE_ROLES) {
      const score = roleScore(role, unit)
      if (score > bestScore) {
        bestScore = score
        best = role
      }
    }
    // Below this, only the weak prose signal fired - not enough to claim a slide.
    if (!best || bestScore < 4) continue

    const list = byRole.get(best.id)
    if (list) list.push(unit)
    else byRole.set(best.id, [unit])
  }

  return byRole
}

function normalizeHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/^\d+(\.\d+)*\s*/, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * True when a source heading just restates the slide title. "PROBLEM STATEMENT"
 * should not open with a "Problem Definition and Motivation" bullet - the title
 * already said it, and the bullet costs a line of the body box.
 */
function echoesTitle(heading: string, roleTitle: string): boolean {
  const h = normalizeHeading(heading)
  const t = normalizeHeading(roleTitle)
  if (!h) return true
  if (h.includes(t) || t.includes(h)) return true

  const titleWords = new Set(t.split(' ').filter(w => w.length > 3))
  if (titleWords.size === 0) return false
  const headingWords = h.split(' ')
  const shared = headingWords.filter(w => titleWords.has(w)).length
  return shared / titleWords.size >= 0.5
}

/** "Chapter Two" when a role's content all comes from one chapter. */
function chapterLabel(units: ContentUnit[]): string | undefined {
  const nums = new Set(units.map(u => u.chapterNum).filter(Boolean))
  if (nums.size !== 1) return undefined
  const num = [...nums][0] as string
  return 'Chapter ' + num.charAt(0) + num.slice(1).toLowerCase()
}

/**
 * Builds a deck around the guideline's required slides. Returns [] when the
 * document does not look like a seminar report, so the caller can fall back to
 * proportional chapter coverage.
 */
function planRoleSlides(sections: DocSection[], budget: number): SlideSpec[] {
  const byRole = assignUnits(flattenUnits(sections))
  const present = SLIDE_ROLES.filter(r => (byRole.get(r.id)?.length ?? 0) > 0)

  // Too few recognisable roles: this is not a structured report.
  if (present.length < 3) return []

  // One slide per role, most important first, until the budget runs out.
  const quota = new Map<string, number>()
  let left = budget
  for (const priority of [1, 2, 3] as const) {
    for (const role of present) {
      if (left <= 0) break
      if (role.priority !== priority) continue
      quota.set(role.id, 1)
      left--
    }
  }

  // Spend anything left on roles with enough material to justify a second slide.
  let grew = true
  while (left > 0 && grew) {
    grew = false
    for (const role of present) {
      if (left <= 0) break
      const current = quota.get(role.id) ?? 0
      if (current === 0 || current >= role.maxSlides) continue
      const words = (byRole.get(role.id) ?? []).reduce((n, u) => n + u.words, 0)
      if (words < 220 * (current + 1)) continue
      quota.set(role.id, current + 1)
      left--
      grew = true
    }
  }

  const specs: SlideSpec[] = []
  for (const role of present) {
    const slots = quota.get(role.id) ?? 0
    if (slots === 0) continue

    const units = byRole.get(role.id) ?? []

    // Sub-headings only earn a line when the slide merges several subsections,
    // and never when they just echo the slide title.
    const sourced = units.map(u => ({
      ...u,
      heading: units.length > 1 && !echoesTitle(u.heading, role.title) ? u.heading : '',
    }))

    const bullets = bulletsFrom(sourced, slots, false)
    if (bullets.length === 0) continue

    const label = chapterLabel(units)
    const { chunks } = packBullets(bullets, slots)
    chunks.forEach((chunk, ci) => {
      specs.push({
        headerText: role.title.toUpperCase(),
        subHeaderText: ci === 0 ? label : label ? label + ' (cont.)' : 'continued',
        bullets: chunk,
        variant: 'bullets',
      })
    })
  }

  return specs
}

/**
 * Distributes `budget` content slides across sections using largest-remainder
 * over `importance x sqrt(volume)`, with one slide guaranteed per section.
 * This is what keeps Chapter 5 in the deck when Chapter 2 is enormous.
 */
function allocateSlides(sections: DocSection[], budget: number): number[] {
  const n = sections.length
  if (n === 0) return []
  if (budget <= n) return sections.map(() => 1)

  const weights = sections.map(s =>
    Math.max(0.1, importanceOf(s) * Math.sqrt(Math.max(1, volumeOf(s))))
  )
  const total = weights.reduce((a, b) => a + b, 0)

  const spare = budget - n // every section already holds one slide
  const exact = weights.map(w => (w / total) * spare)
  const base = exact.map(v => Math.floor(v))

  let remaining = spare - base.reduce((a, b) => a + b, 0)
  const order = exact.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac)

  for (let k = 0; remaining > 0 && k < order.length; k++, remaining--) base[order[k].i]++
  // Leftover (budget far exceeding weights) goes to the heaviest sections.
  for (let k = 0; remaining > 0; k = (k + 1) % order.length, remaining--) base[order[k].i]++

  // Back matter never needs more than one slide, however long it is.
  return sections.map((s, i) => (isCappedSection(s) ? 1 : 1 + base[i]))
}

// Visual budgeting: how much of the body box a bullet consumes.
function charsPerLine(fontSize: number): number {
  // Arial averages ~0.5em per glyph; body box width in points / average glyph width.
  return Math.floor((BODY_W * 72) / (fontSize * 0.5))
}

function linesFor(bullet: Bullet, fontSize: number): number {
  const cpl = charsPerLine(bullet.kind === 'sub' ? fontSize + 1 : fontSize)
  return Math.max(1, Math.ceil(bullet.text.length / cpl))
}

function lineCapacity(fontSize: number): number {
  const lineHeightPt = fontSize * 1.45
  return Math.floor((BODY_H * 72) / lineHeightPt)
}

/**
 * Packs bullets into at most `maxSlides` slides without overflowing the body box,
 * stepping the font down before giving up any content.
 */
export function packBullets(bullets: Bullet[], maxSlides: number): { chunks: Bullet[][]; fontSize: number } {
  const chunkAt = (fontSize: number, stopAt: number) => {
    const capacity = lineCapacity(fontSize)
    const chunks: Bullet[][] = []
    let currentChunk: Bullet[] = []
    let used = 0

    for (const b of bullets) {
      const cost = linesFor(b, fontSize) + 0.4 // inter-bullet spacing
      const full = used + cost > capacity || currentChunk.length >= MAX_BULLETS_PER_SLIDE
      if (currentChunk.length > 0 && full) {
        chunks.push(currentChunk)
        if (chunks.length >= stopAt) return chunks
        currentChunk = []
        used = 0
      }
      currentChunk.push(b)
      used += cost
    }
    if (currentChunk.length > 0 && chunks.length < stopAt) chunks.push(currentChunk)
    return chunks
  }

  for (let fontSize = BODY_FONT_MAX; fontSize >= BODY_FONT_MIN; fontSize -= 1) {
    const chunks = chunkAt(fontSize, Number.MAX_SAFE_INTEGER)
    if (chunks.length <= maxSlides) return { chunks, fontSize }
  }

  // Still too much at the smallest legible size: keep what fits the quota.
  return { chunks: chunkAt(BODY_FONT_MIN, maxSlides), fontSize: BODY_FONT_MIN }
}

/**
 * The guideline devotes Slide 3 to Aim & Objectives, so a subsection covering it
 * is lifted onto its own slide instead of being flattened into the chapter.
 */
const AIM_HEADING = /\b(aims?|objectives?)\b/i

/** Builds the bullet stream for a set of subsections, sized to its slide quota. */
function bulletsFrom(subsections: Subsection[], slideQuota: number, references: boolean): Bullet[] {
  const bullets: Bullet[] = []
  const seen = new Set<string>()

  // Roughly six bullets fill a slide comfortably; that sets the extraction target.
  const targetBullets = Math.max(3, slideQuota * MAX_BULLETS_PER_SLIDE)
  const subsectionCount = Math.max(1, subsections.length)
  const perSubsection = Math.max(1, Math.round(targetBullets / subsectionCount))

  const push = (text: string, kind: BulletKind) => {
    // Headings lifted straight from an imported table of contents drag their dot
    // leaders and page number along: "Barriers to Global Scaling ....... 14".
    const clean = cleanBulletText(text).replace(/\s*\.{4,}\s*\d*\s*$/, '').trim()
    if (!clean || clean.length < 4 || isNoiseText(clean)) return
    const key = clean.toLowerCase().slice(0, 60)
    if (seen.has(key)) return
    seen.add(key)
    bullets.push({ text: clean, kind })
  }

  for (const sub of subsections) {
    if (references) {
      // Reference entries are already atomic - never summarise them.
      sub.paragraphs.forEach(p => push(trimToLength(p, 150), 'point'))
      sub.listItems.forEach(p => push(trimToLength(p, 150), 'point'))
      continue
    }

    if (sub.heading && !isNoiseText(sub.heading)) {
      push(sub.heading.replace(/^\d+(\.\d+)*\s+/, ''), 'sub')
    }

    // Author-written list items are already slide-shaped; keep them near-verbatim.
    const takenFromList = Math.min(sub.listItems.length, perSubsection + 2)
    for (const item of sub.listItems.slice(0, takenFromList)) {
      push(condense(item, 130), 'point')
    }

    const room = perSubsection - Math.min(takenFromList, perSubsection)
    if (room > 0) {
      for (const line of summarizeProse(sub.paragraphs, room, 130)) push(line, 'point')
    }
  }

  // Drop a trailing sub-heading that ended up with nothing underneath it.
  while (bullets.length > 0 && bullets[bullets.length - 1].kind === 'sub') bullets.pop()

  return bullets
}

export function buildSlideSpecs(sections: DocSection[], contentBudget: number): SlideSpec[] {
  if (sections.length === 0) return []

  // Sections with no usable content should not consume budget.
  const usable = sections.filter(s => volumeOf(s) > 0 || s.tables.length > 0)
  if (usable.length === 0) return []

  const referenceSection = usable.find(isReferenceSection)
  // Hold a slide back for references so the planner cannot spend the whole budget.
  const roleBudget = referenceSection ? contentBudget - 1 : contentBudget

  const roleSpecs = planRoleSlides(usable, roleBudget)
  if (roleSpecs.length > 0) {
    if (referenceSection) {
      const refBullets = bulletsFrom(referenceSection.subsections, 1, true)
      if (refBullets.length > 0) {
        roleSpecs.push({
          headerText: 'REFERENCES',
          bullets: refBullets.slice(0, 7),
          variant: 'references',
        })
      }
    }
    return roleSpecs
  }

  // Unstructured document: fall back to proportional coverage of its chapters.
  return buildProportionalSpecs(usable, contentBudget)
}

function buildProportionalSpecs(usable: DocSection[], contentBudget: number): SlideSpec[] {

  // Tables each claim a slide up front; the rest of the budget goes to prose.
  const tableSlideCount = usable.reduce((n, s) => n + Math.min(s.tables.length, 2), 0)
  const proseBudget = Math.max(usable.length, contentBudget - Math.min(tableSlideCount, 3))

  const quotas = allocateSlides(usable, proseBudget)
  const specs: SlideSpec[] = []

  usable.forEach((section, i) => {
    const headerText = section.chapterNum ? 'CHAPTER ' + section.chapterNum : section.title
    const subHeaderText = section.chapterNum ? section.title : undefined
    const references = isReferenceSection(section)

    let quota = quotas[i]
    let subsections = section.subsections

    // Lift Aim & Objectives onto a dedicated slide, ahead of the chapter body.
    if (!references && quota > 1) {
      const aimSubs = subsections.filter(s => AIM_HEADING.test(s.heading))
      if (aimSubs.length > 0 && aimSubs.length < subsections.length) {
        const aimBullets = bulletsFrom(aimSubs, 1, false).filter(b => b.kind === 'point')
        if (aimBullets.length > 0) {
          const { chunks } = packBullets(aimBullets, 1)
          specs.push({
            headerText,
            subHeaderText: 'Aim & Objectives',
            bullets: chunks[0] ?? aimBullets,
            variant: 'bullets',
          })
          subsections = subsections.filter(s => !AIM_HEADING.test(s.heading))
          quota -= 1
        }
      }
    }

    const bullets = bulletsFrom(subsections, quota, references)

    if (bullets.length > 0) {
      if (references) {
        specs.push({ headerText, subHeaderText, bullets: bullets.slice(0, 7), variant: 'references' })
      } else {
        const { chunks } = packBullets(bullets, quota)
        chunks.forEach((chunk, ci) => {
          specs.push({
            headerText,
            // Continuation slides keep the chapter identity, marked "(cont.)".
            subHeaderText: ci === 0 ? subHeaderText : (subHeaderText || headerText) + ' (cont.)',
            bullets: chunk,
            variant: 'bullets',
          })
        })
      }
    }

    for (const table of section.tables.slice(0, 2)) {
      specs.push({
        headerText,
        subHeaderText: (subHeaderText ? subHeaderText + ' - ' : '') + 'Data',
        bullets: [],
        tableRows: table.slice(0, 8).map(row => row.slice(0, 6)),
        variant: 'table',
      })
    }
  })

  return specs
}

// --- Phase 3b: Layout planning -------------------------------------

const OBJECTIVE_HEADER = /\b(aim|objective|goal)s?\b/i

/**
 * Chooses a body layout per slide.
 *
 * Content selection has already happened; this only decides how a slide is
 * arranged. Both approved decks in /sample use a different arrangement on most
 * slides (numbered badges for objectives, a narrative column beside concept
 * cards, panels, tables), where this exporter previously repeated one bullet
 * template for all 13 content slides.
 *
 * Nothing here invents content: `steps` renumbers the bullets it was given, and
 * `sidebar` promotes sub-headings the document already carries into cards.
 */
export function planLayouts(specs: SlideSpec[]): SlideSpec[] {
  let sinceSidebar = 0

  return specs.map(spec => {
    // Tables and reference lists already have a dedicated treatment.
    if (spec.variant === 'table' || spec.variant === 'references') return spec

    const points = spec.bullets.filter(b => b.kind !== 'sub')
    const subs = spec.bullets.filter(b => b.kind === 'sub')

    // Aims and objectives read as an enumerated list, not prose bullets.
    if (
      OBJECTIVE_HEADER.test(spec.headerText) &&
      points.length >= 3 &&
      points.length <= DECK_STYLE.steps.maxSteps
    ) {
      sinceSidebar++
      return { ...spec, variant: 'steps' as const, bullets: points }
    }

    // A section that carries its own sub-headings can show them as cards beside
    // the narrative. Spaced out so the deck alternates rather than repeats.
    if (subs.length >= 2 && points.length >= 2 && sinceSidebar >= 2) {
      sinceSidebar = 0
      return {
        ...spec,
        variant: 'sidebar' as const,
        bullets: points,
        cards: subs.slice(0, DECK_STYLE.sidebar.maxCards).map(s => ({
          label: trimToLength(s.text, 34),
          detail: '',
        })),
      }
    }

    sinceSidebar++
    return spec
  })
}

// --- Phase 4: Render -----------------------------------------------

/** Numbered badge rows - the approved deck's objectives slide. */
function renderSteps(slide: any, spec: SlideSpec) {
  const st = DECK_STYLE.steps
  const rows = spec.bullets.slice(0, st.maxSteps)

  // Fit the stride to the space actually available so five steps cannot spill
  // past the footer.
  const available = SLIDE_H - 0.75 - st.firstYIn
  const stride = Math.min(st.strideIn, available / Math.max(1, rows.length))

  rows.forEach((b, i) => {
    const y = st.firstYIn + i * stride

    slide.addShape('ellipse' as any, {
      x: MARGIN_X,
      y,
      w: st.badgeIn,
      h: st.badgeIn,
      fill: { color: COLOR.indigo },
    })

    slide.addText(String(i + 1), {
      x: MARGIN_X,
      y,
      w: st.badgeIn,
      h: st.badgeIn,
      fontSize: st.numberPt,
      bold: true,
      color: COLOR.white,
      align: 'center',
      valign: 'middle',
      fontFace: HEAD_FONT,
    })

    slide.addText(b.text, {
      x: st.textXIn,
      y: y - 0.05,
      w: Math.min(st.textWidthIn, SLIDE_W - st.textXIn - MARGIN_X),
      h: st.badgeIn + 0.1,
      fontSize: st.textPt,
      color: COLOR.slate,
      fontFace: BODY_FACE,
      valign: 'middle',
      fit: 'shrink',
    })
  })
}

/** Narrative column with concept cards alongside - the approved deck's slide 2. */
function renderSidebar(slide: any, spec: SlideSpec, fontSize: number) {
  const body = DECK_STYLE.bodyWithSidebar
  const sb = DECK_STYLE.sidebar

  slide.addText(
    spec.bullets.map((b, i) => ({
      text: b.text + (i === spec.bullets.length - 1 ? '' : '\n'),
      options: {
        bullet: true,
        fontSize,
        color: COLOR.slate,
        fontFace: BODY_FACE,
        lineSpacing: fontSize * 1.45,
      },
    })),
    { x: body.xIn, y: body.yIn, w: body.widthIn, h: body.heightIn, valign: 'top', fit: 'shrink' }
  )

  const cards = (spec.cards || []).slice(0, sb.maxCards)
  cards.forEach((card, i) => {
    const y = sb.firstYIn + i * sb.strideIn
    // Alternating fills give the column rhythm, as in the approved deck.
    const dark = i % 2 === 0

    slide.addShape('roundRect' as any, {
      x: sb.xIn,
      y,
      w: sb.widthIn,
      h: sb.cardHeightIn,
      fill: { color: dark ? COLOR.navy : COLOR.paleRow },
      line: { color: dark ? COLOR.navy : COLOR.border, width: 1 },
      rectRadius: 0.08,
    })

    slide.addText(card.label, {
      x: sb.xIn + 0.25,
      y,
      w: sb.widthIn - 0.5,
      h: sb.cardHeightIn,
      fontSize: sb.labelPt,
      bold: true,
      color: dark ? COLOR.white : COLOR.navy,
      fontFace: BODY_FACE,
      valign: 'middle',
      fit: 'shrink',
    })
  })
}

function paintContentChrome(
  slide: any,
  spec: SlideSpec,
  slideNo: number,
  totalSlides: number,
  department: string
) {
  slide.background = { color: COLOR.ground }

  // Header band sized to clear the approved deck's 36pt slide title.
  const bandH = spec.subHeaderText ? 1.45 : 1.25
  slide.addShape('rect' as any, { x: 0, y: 0, w: '100%', h: bandH, fill: { color: COLOR.navy } })
  slide.addShape('rect' as any, { x: 0.25, y: 0.3, w: 0.09, h: bandH - 0.6, fill: { color: COLOR.indigo } })

  slide.addText(spec.headerText.toUpperCase(), {
    x: DECK_STYLE.header.xIn,
    y: DECK_STYLE.header.yIn - 0.18,
    w: DECK_STYLE.header.widthIn - 1.9, // clear of the slide counter
    h: DECK_STYLE.header.heightIn,
    fontSize: HEADER_FONT,
    bold: true,
    color: COLOR.white,
    fontFace: FONT,
    valign: 'middle',
    fit: 'shrink',
  })

  if (spec.subHeaderText) {
    slide.addText(spec.subHeaderText, {
      x: DECK_STYLE.header.xIn,
      y: DECK_STYLE.header.yIn + 0.62,
      w: DECK_STYLE.header.widthIn - 1.9,
      h: 0.36,
      fontSize: SUBHEADER_FONT,
      italic: true,
      color: COLOR.indigoLight,
      fontFace: FONT,
      valign: 'middle',
      fit: 'shrink',
    })
  }

  slide.addText(slideNo + ' / ' + totalSlides, {
    x: SLIDE_W - MARGIN_X - 1.8,
    y: 0.35,
    w: 1.8,
    h: 0.4,
    fontSize: 11,
    color: COLOR.mutedLight,
    align: 'right',
    fontFace: FONT,
  })

  slide.addText('WordPIlot Seminar Presentation  |  ' + department, {
    x: MARGIN_X,
    y: SLIDE_H - 0.5,
    w: BODY_W,
    h: 0.3,
    fontSize: 9,
    color: COLOR.mutedLight,
    fontFace: FONT,
  })
}

export async function exportPresentationPptx(
  fullHtml: string,
  meta: PptxMetadata = {},
  options: PptxOptions = {}
): Promise<void> {
  const pptxgenModule = await import('pptxgenjs')
  const pptxgen: any = (pptxgenModule as any).default || pptxgenModule
  const pptx = new pptxgen()

  // Register the canvas every coordinate in this file was measured against.
  // pptxgenjs's built-in 'LAYOUT_16x9' is 10 x 5.625in, not 13.333 x 7.5 - the
  // deck used to ship with that preset, pushing page numbers, footers and the
  // right quarter of every body column off the slide.
  pptx.defineLayout({
    name: DECK_STYLE.slide.layout,
    width: DECK_STYLE.slide.widthIn,
    height: DECK_STYLE.slide.heightIn,
  })
  pptx.layout = DECK_STYLE.slide.layout
  pptx.title = meta.title || 'Seminar Presentation'
  pptx.author = meta.studentName || 'Student Presenter'

  const titleText = meta.title || 'ACADEMIC SEMINAR PRESENTATION'
  const studentName = meta.studentName || 'STUDENT NAME'
  const matricNo = meta.matricNo || 'MATRIC NUMBER'
  const department = meta.department || 'COMPUTER ENGINEERING'
  const supervisor = meta.supervisorName || 'SUPERVISOR NAME'
  const institution = meta.institution || 'YABA COLLEGE OF TECHNOLOGY'
  const session = meta.session || '2025/2026'

  const sections = extractSections(fullHtml)
  if (sections.length === 0) {
    throw new Error(
      'No presentable content was found. Add chapter headings and body text to the document, then export again.'
    )
  }

  const maxSlides = Math.max(6, options.maxSlides ?? 15)

  // Title + Q&A are fixed; the agenda is dropped when there is little to outline.
  const chapterTitles = sections.filter(s => s.kind === 'chapter').map(s => s.title)
  const includeAgenda = (options.includeAgenda ?? false) && chapterTitles.length >= 3
  const reserved = 2 + (includeAgenda ? 1 : 0)

  const contentBudget = Math.max(1, maxSlides - reserved)
  const specs = planLayouts(buildSlideSpecs(sections, contentBudget).slice(0, contentBudget))
  const totalSlides = specs.length + reserved

  // --- Slide 1: Title ---
  const s1 = pptx.addSlide()
  s1.background = { color: COLOR.navy }
  s1.addShape('rect' as any, { x: 0, y: 0, w: '100%', h: 0.12, fill: { color: COLOR.indigo } })

  // Title slide geometry copied from the approved deck: title block high on the
  // slide, a report-presentation subtitle, then the identity block beneath it.
  const ts = DECK_STYLE.titleSlide

  s1.addText(titleText.toUpperCase(), {
    x: ts.title.xIn,
    y: ts.title.yIn,
    w: ts.title.widthIn,
    h: ts.title.heightIn,
    fontSize: ts.title.sizePt,
    bold: true,
    color: COLOR.white,
    align: 'center',
    fontFace: FONT,
    lineSpacing: 42,
    fit: 'shrink',
  })

  s1.addText(ts.subtitleText, {
    x: ts.subtitle.xIn,
    y: ts.subtitle.yIn,
    w: ts.subtitle.widthIn,
    h: ts.subtitle.heightIn,
    fontSize: ts.subtitle.sizePt,
    color: COLOR.indigoLight,
    align: 'center',
    fontFace: FONT,
  })

  s1.addShape('rect' as any, { x: (SLIDE_W - 4) / 2, y: ts.subtitle.yIn + 0.62, w: 4.0, h: 0.04, fill: { color: COLOR.indigo } })

  // Identity block, in the approved deck's order.
  const identity = [
    studentName,
    'Matric No: ' + matricNo,
    'Department of ' + toTitleCase(department) + ', ' + (meta.school?.trim() || 'School of Engineering'),
    institution.replace(/\b\w+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()),
    'Supervisor: ' + supervisor,
    (meta.academicLevel || 'HND') + ' ' + toTitleCase(department) + '  |  Session ' + (session || '2025/2026'),
  ]

  s1.addText(identity.join('\n'), {
    x: ts.details.xIn,
    y: ts.details.yIn,
    w: ts.details.widthIn,
    h: ts.details.heightIn,
    fontSize: ts.details.sizePt,
    color: COLOR.dim,
    align: 'center',
    fontFace: FONT,
    lineSpacing: 30,
    fit: 'shrink',
  })

  // --- Slide 2: Agenda ---
  let slideNo = 2
  if (includeAgenda) {
    const agenda = pptx.addSlide()
    paintContentChrome(
      agenda,
      { headerText: 'PRESENTATION OUTLINE', bullets: [] },
      slideNo,
      totalSlides,
      department
    )

    const outlineItems = chapterTitles.slice(0, 8)
    agenda.addText(
      outlineItems.map((t, i) => ({
        text: t + (i === outlineItems.length - 1 ? '' : '\n'),
        options: {
          bullet: { type: 'number' as const },
          fontSize: 18,
          color: COLOR.slate,
          fontFace: FONT,
          lineSpacing: 30,
        },
      })),
      { x: MARGIN_X + 0.2, y: BODY_TOP, w: BODY_W - 0.4, h: BODY_H, valign: 'top' }
    )
    slideNo++
  }

  // --- Content slides ---
  for (const spec of specs) {
    const slide = pptx.addSlide()
    paintContentChrome(slide, spec, slideNo, totalSlides, department)

    if (spec.variant === 'table' && spec.tableRows && spec.tableRows.length > 0) {
      const colCount = Math.max(1, spec.tableRows[0].length)
      const cellFont = colCount > 4 ? 10 : 12

      const rows = spec.tableRows.map((row, rIdx) =>
        row.map(cellText => ({
          text: trimToLength(cellText, 90),
          options: {
            fontSize: cellFont,
            bold: rIdx === 0,
            color: rIdx === 0 ? COLOR.white : COLOR.slateDark,
            fill:
              rIdx === 0
                ? { color: COLOR.navy }
                : rIdx % 2 === 1
                ? { color: COLOR.paleRow }
                : { color: COLOR.white },
            align: 'left' as const,
            valign: 'middle' as const,
          },
        }))
      )

      slide.addTable(rows, {
        x: MARGIN_X,
        y: BODY_TOP,
        w: BODY_W,
        h: BODY_H,
        fontSize: cellFont,
        border: { pt: 1, color: COLOR.border },
        autoPage: false,
      })
      slideNo++
      continue
    }

    if (spec.variant === 'references') {
      slide.addText(
        spec.bullets.map((b, i) => ({
          text: b.text + (i === spec.bullets.length - 1 ? '' : '\n'),
          options: { fontSize: 13, color: COLOR.slate, fontFace: FONT, lineSpacing: 20 },
        })),
        { x: MARGIN_X, y: BODY_TOP, w: BODY_W, h: BODY_H, valign: 'top', fit: 'shrink' }
      )
      slideNo++
      continue
    }

    if (spec.variant === 'steps' && spec.bullets.length > 0) {
      renderSteps(slide, spec)
      slideNo++
      continue
    }

    if (spec.variant === 'sidebar' && spec.bullets.length > 0) {
      const { fontSize } = packBullets(spec.bullets, 1)
      renderSidebar(slide, spec, fontSize)
      slideNo++
      continue
    }

    if (spec.bullets.length > 0) {
      const { fontSize } = packBullets(spec.bullets, 1)

      slide.addText(
        spec.bullets.map((b, i) => ({
          text: b.text + (i === spec.bullets.length - 1 ? '' : '\n'),
          options:
            b.kind === 'sub'
              ? {
                  bold: true,
                  fontSize: fontSize + 1,
                  color: COLOR.slateDark,
                  fontFace: HEAD_FONT,
                  lineSpacing: fontSize * 1.6,
                }
              : {
                  bullet: true,
                  fontSize,
                  color: COLOR.slate,
                  fontFace: BODY_FACE,
                  lineSpacing: fontSize * 1.45,
                },
        })),
        { x: MARGIN_X, y: BODY_TOP, w: BODY_W, h: BODY_H, valign: 'top', fit: 'shrink' }
      )
    }

    slideNo++
  }

  // --- Closing slide: Q&A ---
  const closing = pptx.addSlide()
  closing.background = { color: COLOR.navy }

  closing.addText('THANK YOU', {
    x: MARGIN_X,
    y: 2.0,
    w: BODY_W,
    h: 1.2,
    fontSize: 42,
    bold: true,
    color: COLOR.white,
    align: 'center',
    fontFace: FONT,
  })

  closing.addShape('rect' as any, { x: (SLIDE_W - 4) / 2, y: 3.4, w: 4.0, h: 0.04, fill: { color: COLOR.indigo } })

  closing.addText('Questions & Answers', {
    x: MARGIN_X,
    y: 3.8,
    w: BODY_W,
    h: 0.8,
    fontSize: 20,
    color: COLOR.dim,
    align: 'center',
    fontFace: FONT,
  })

  closing.addText(studentName + '  |  ' + department + '\n' + institution, {
    x: MARGIN_X,
    y: 5.0,
    w: BODY_W,
    h: 1.0,
    fontSize: 14,
    color: COLOR.muted,
    align: 'center',
    fontFace: FONT,
    lineSpacing: 22,
  })

  const safeFileName = (titleText.replace(/[^\w\-]+/g, '_').toLowerCase() || 'presentation') + '.pptx'
  await pptx.writeFile({ fileName: safeFileName })
}
