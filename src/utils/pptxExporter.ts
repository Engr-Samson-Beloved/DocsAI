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
 *    and stepping the font down 18 -> 16pt before splitting onto another slide.
 *  - Fonts: Title 34pt, Headers 24pt, Subheaders 16pt, Body 18pt (never below 16pt).
 *  - Widescreen 16:9, 60-30-10 colour system (slate ground, navy headers, indigo accent).
 *
 * Note: this file is deliberately ASCII-only. Literal box-drawing and bullet
 * glyphs here have been corrupted by tooling before; where a non-ASCII character
 * is semantically required it is built from char codes.
 */

export interface PptxMetadata {
  title?: string
  studentName?: string
  matricNo?: string
  department?: string
  supervisorName?: string
  academicLevel?: string
  institution?: string
  docHeader?: string
  docFooter?: string
}

export interface PptxOptions {
  /** Total slides including title, agenda and Q&A. Defaults to the 12-15 guideline. */
  minSlides?: number
  maxSlides?: number
  /** Include the agenda/outline slide (skipped automatically for very short docs). */
  includeAgenda?: boolean
}

// --- Layout & theme (LAYOUT_16x9 = 13.333in x 7.5in) ---------------

const SLIDE_W = 13.333
const SLIDE_H = 7.5

const MARGIN_X = 0.8
const BODY_W = SLIDE_W - MARGIN_X * 2 // 11.73
const BODY_TOP = 1.5
const BODY_BOTTOM = 6.85 // footer sits below this
const BODY_H = BODY_BOTTOM - BODY_TOP

const FONT = 'Arial'
const BODY_FONT_MAX = 18
const BODY_FONT_MIN = 16

/**
 * Hard readability cap. Line-fitting alone would happily put nine short bullets
 * on one slide, which is a wall of text at presentation distance even though it
 * technically fits the box. Sub-headings count toward the total.
 */
const MAX_BULLETS_PER_SLIDE = 6

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

/** Turns a full academic sentence into slide-shaped text. */
function condense(sentence: string, maxChars: number): string {
  let s = cleanBulletText(sentence)

  s = s.replace(HEDGES, '')
  s = s.replace(LEAD_INS, '')
  s = s.replace(/\s*\([^)]*\b(19|20)\d{2}[a-z]?\b[^)]*\)/g, '') // (Author, 2021)
  s = s.replace(/\s*\[\d+(?:\s*[,-]\s*\d+)*\]/g, '') // [12], [3, 4]
  s = s.replace(/\s+([,.;:])/g, '$1')
  s = s.replace(/\s+/g, ' ').trim()

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

  const picked = [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index) // restore document order

  const seen = new Set<string>()
  const out: string[] = []
  for (const s of picked) {
    const bullet = condense(s.text, maxChars)
    const key = bullet.toLowerCase().slice(0, 60)
    if (bullet.length > 12 && !seen.has(key)) {
      seen.add(key)
      out.push(bullet)
    }
  }
  return out
}

// --- Phase 3: Slide budgeting & mapping ----------------------------

type BulletKind = 'point' | 'sub'

interface Bullet {
  text: string
  kind: BulletKind
}

interface SlideSpec {
  headerText: string
  subHeaderText?: string
  bullets: Bullet[]
  tableRows?: string[][]
  /** References render as a compact list rather than bullets. */
  variant?: 'bullets' | 'table' | 'references'
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
function packBullets(bullets: Bullet[], maxSlides: number): { chunks: Bullet[][]; fontSize: number } {
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

/** Builds the bullet stream for a section, sized to the slides it was allotted. */
function bulletsForSection(section: DocSection, slideQuota: number): Bullet[] {
  const bullets: Bullet[] = []
  const seen = new Set<string>()
  const references = isReferenceSection(section)

  // Roughly six bullets fill a slide comfortably; that sets the extraction target.
  const targetBullets = Math.max(3, slideQuota * 6)
  const subsectionCount = Math.max(1, section.subsections.length)
  const perSubsection = Math.max(1, Math.round(targetBullets / subsectionCount))

  const push = (text: string, kind: BulletKind) => {
    const clean = cleanBulletText(text)
    if (!clean || clean.length < 4 || isNoiseText(clean)) return
    const key = clean.toLowerCase().slice(0, 60)
    if (seen.has(key)) return
    seen.add(key)
    bullets.push({ text: clean, kind })
  }

  for (const sub of section.subsections) {
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

  // Tables each claim a slide up front; the rest of the budget goes to prose.
  const tableSlideCount = usable.reduce((n, s) => n + Math.min(s.tables.length, 2), 0)
  const proseBudget = Math.max(usable.length, contentBudget - Math.min(tableSlideCount, 3))

  const quotas = allocateSlides(usable, proseBudget)
  const specs: SlideSpec[] = []

  usable.forEach((section, i) => {
    const headerText = section.chapterNum ? 'CHAPTER ' + section.chapterNum : section.title
    const subHeaderText = section.chapterNum ? section.title : undefined

    const bullets = bulletsForSection(section, quotas[i])

    if (bullets.length > 0) {
      if (isReferenceSection(section)) {
        specs.push({ headerText, subHeaderText, bullets: bullets.slice(0, 7), variant: 'references' })
      } else {
        const { chunks } = packBullets(bullets, quotas[i])
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

// --- Phase 4: Render -----------------------------------------------

function paintContentChrome(
  slide: any,
  spec: SlideSpec,
  slideNo: number,
  totalSlides: number,
  department: string
) {
  slide.background = { color: COLOR.ground }
  slide.addShape('rect' as any, { x: 0, y: 0, w: '100%', h: 1.1, fill: { color: COLOR.navy } })
  slide.addShape('rect' as any, { x: 0.55, y: 0.22, w: 0.08, h: 0.66, fill: { color: COLOR.indigo } })

  slide.addText(spec.headerText.toUpperCase(), {
    x: 0.85,
    y: 0.14,
    w: 9.6,
    h: spec.subHeaderText ? 0.42 : 0.7,
    fontSize: spec.subHeaderText ? 20 : 24,
    bold: true,
    color: COLOR.white,
    fontFace: FONT,
    valign: 'middle',
    fit: 'shrink',
  })

  if (spec.subHeaderText) {
    slide.addText(spec.subHeaderText, {
      x: 0.85,
      y: 0.55,
      w: 9.6,
      h: 0.4,
      fontSize: 16,
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

  pptx.layout = 'LAYOUT_16x9'
  pptx.title = meta.title || 'Seminar Presentation'
  pptx.author = meta.studentName || 'Student Presenter'

  const titleText = meta.title || 'ACADEMIC SEMINAR PRESENTATION'
  const studentName = meta.studentName || 'STUDENT NAME'
  const matricNo = meta.matricNo || 'MATRIC NUMBER'
  const department = meta.department || 'COMPUTER ENGINEERING'
  const supervisor = meta.supervisorName || 'SUPERVISOR NAME'
  const institution = meta.institution || 'YABA COLLEGE OF TECHNOLOGY'

  const sections = extractSections(fullHtml)
  if (sections.length === 0) {
    throw new Error(
      'No presentable content was found. Add chapter headings and body text to the document, then export again.'
    )
  }

  const maxSlides = Math.max(6, options.maxSlides ?? 15)

  // Title + Q&A are fixed; the agenda is dropped when there is little to outline.
  const chapterTitles = sections.filter(s => s.kind === 'chapter').map(s => s.title)
  const includeAgenda = (options.includeAgenda ?? true) && chapterTitles.length >= 3
  const reserved = 2 + (includeAgenda ? 1 : 0)

  const contentBudget = Math.max(1, maxSlides - reserved)
  const specs = buildSlideSpecs(sections, contentBudget).slice(0, contentBudget)
  const totalSlides = specs.length + reserved

  // --- Slide 1: Title ---
  const s1 = pptx.addSlide()
  s1.background = { color: COLOR.navy }
  s1.addShape('rect' as any, { x: 0, y: 0, w: '100%', h: 0.12, fill: { color: COLOR.indigo } })

  s1.addText(institution.toUpperCase(), {
    x: MARGIN_X,
    y: 0.6,
    w: BODY_W,
    h: 0.4,
    fontSize: 13,
    bold: true,
    color: COLOR.mutedLight,
    align: 'center',
    fontFace: FONT,
  })

  s1.addText(titleText.toUpperCase(), {
    x: MARGIN_X,
    y: 1.5,
    w: BODY_W,
    h: 2.2,
    fontSize: 34,
    bold: true,
    color: COLOR.white,
    align: 'center',
    fontFace: FONT,
    lineSpacing: 42,
    fit: 'shrink',
  })

  s1.addShape('rect' as any, { x: (SLIDE_W - 4) / 2, y: 3.9, w: 4.0, h: 0.04, fill: { color: COLOR.indigo } })

  s1.addText(
    'Presented by: ' + studentName + '  |  ' + matricNo + '\nDepartment of ' + department + '\nSupervisor: ' + supervisor,
    {
      x: MARGIN_X,
      y: 4.3,
      w: BODY_W,
      h: 1.8,
      fontSize: 15,
      color: COLOR.dim,
      align: 'center',
      fontFace: FONT,
      lineSpacing: 24,
    }
  )

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
                  fontFace: FONT,
                  lineSpacing: fontSize * 1.6,
                }
              : {
                  bullet: true,
                  fontSize,
                  color: COLOR.slate,
                  fontFace: FONT,
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
