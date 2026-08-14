/**
 * docTree.ts
 * ------------------------------------------------------------------
 * Builds the document STRUCTURE TREE the slide planner consumes, and parses
 * cover-page metadata.
 *
 * Why this module exists
 * ----------------------
 * Two defects share a root here.
 *
 * 1. The planner used to consume a flat string of paragraphs. With no notion of
 *    which chapter a paragraph came from, the eyebrow labels were guesses -
 *    "SCOPE & SIGNIFICANCE" was labelled "Chapter Four" while carrying text
 *    lifted from the conclusion, and a "TESTING & RESULTS" slide was invented
 *    for a literature-based report that has no testing chapter. Every node here
 *    carries its own provenance (`id`, `chapterLabel`, `pages`), so a label can
 *    be DERIVED and then asserted rather than assumed.
 *
 * 2. The title slide used the FILENAME ("PRINCEWILL SEMINAR(SDN)") as the
 *    report title, and identity fields persisted between jobs. `extractCover`
 *    reads the real values off the cover page and returns nulls when it cannot,
 *    so the caller asks the user instead of inventing something.
 *
 * The HTML scanner is deliberately dependency-free and does not need a DOM, so
 * the same tree builder runs in the browser, in Node tests, and in the
 * regeneration harness.
 */

import { normalizeExtractedText, segmentSentences } from './textNormalize'
import { parseCover, type CoverMetadata } from './coverMetadata'
import {
  partFromHeading,
  looksLikeTocBlock,
  looksLikeTocLine,
  looksLikeListingLine,
  stripSectionNumbering,
  cleanSourceSentence,
  NON_CONTENT_PARTS,
  type PartKind,
} from './documentParts'

// --- Minimal HTML scanning -------------------------------------------

export interface HtmlBlock {
  tag: string
  text: string
  attrs: Record<string, string>
  /** Populated for `table`. */
  rows?: string[][]
  /** Populated for `ul`/`ol`. */
  items?: string[]
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return ENTITIES[body.toLowerCase()] ?? match
  })
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function parseAttrs(tagBody: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([a-zA-Z_:][-\w:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(tagBody)) !== null) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '')
  }
  return attrs
}

/**
 * Flattens document HTML into an ordered list of blocks.
 *
 * Handles only the subset this pipeline produces or receives (headings,
 * paragraphs, lists, tables, page wrappers). Anything else contributes its text
 * and nothing more, which is the safe default for imported markup.
 */
export function scanHtmlBlocks(html: string): HtmlBlock[] {
  const blocks: HtmlBlock[] = []
  // Attributes inherited from the enclosing page wrapper, so a block knows
  // whether it sits on the cover or the table of contents.
  let pageAttrs: Record<string, string> = {}

  const blockRe =
    /<(h[1-6]|p|li|table|ul|ol|div)\b([^>]*)>([\s\S]*?)<\/\1\s*>|<(div)\b([^>]*)>/gi

  // Page wrappers first: record their ranges so nested blocks pick up context.
  const pageRanges: { start: number; end: number; attrs: Record<string, string> }[] = []
  const pageRe = /<div\b([^>]*\bdata-type\s*=\s*["']page["'][^>]*)>([\s\S]*?)<\/div\s*>/gi
  let pm: RegExpExecArray | null
  while ((pm = pageRe.exec(html)) !== null) {
    pageRanges.push({
      start: pm.index,
      end: pm.index + pm[0].length,
      attrs: parseAttrs(pm[1]),
    })
  }

  const attrsAt = (index: number): Record<string, string> => {
    for (const range of pageRanges) {
      if (index >= range.start && index < range.end) return range.attrs
    }
    return {}
  }

  const elementRe = /<(h[1-6]|p|table|ul|ol)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi
  let m: RegExpExecArray | null

  while ((m = elementRe.exec(html)) !== null) {
    const tag = m[1].toLowerCase()
    const attrs = { ...parseAttrs(m[2]) }
    const inner = m[3]
    pageAttrs = attrsAt(m.index)

    const merged = { ...pageAttrs, ...attrs }

    if (tag === 'table') {
      const rows: string[][] = []
      const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi
      let rm: RegExpExecArray | null
      while ((rm = rowRe.exec(inner)) !== null) {
        const cells: string[] = []
        const cellRe = /<(td|th)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi
        let cm: RegExpExecArray | null
        while ((cm = cellRe.exec(rm[1])) !== null) cells.push(stripTags(cm[2]))
        if (cells.some(c => c)) rows.push(cells)
      }
      if (rows.length > 0) blocks.push({ tag, text: '', attrs: merged, rows })
      continue
    }

    if (tag === 'ul' || tag === 'ol') {
      const items: string[] = []
      const liRe = /<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi
      let lm: RegExpExecArray | null
      while ((lm = liRe.exec(inner)) !== null) {
        const t = stripTags(lm[1])
        if (t) items.push(t)
      }
      if (items.length > 0) blocks.push({ tag, text: '', attrs: merged, items })
      continue
    }

    const text = stripTags(inner)
    if (text) blocks.push({ tag, text, attrs: merged })
  }

  void blockRe
  return blocks
}

// --- The tree ---------------------------------------------------------

export interface DocTable {
  caption: string
  headers: string[]
  rows: string[][]
}

export interface DocFigure {
  label: string
  caption: string
}

export interface DocSectionNode {
  /** Section number as written: "2", "2.3". Empty when unnumbered. */
  id: string
  /** 1-based chapter number, when the section belongs to one. */
  chapter: number | null
  /** "Chapter Two" - the eyebrow label, DERIVED, never guessed. */
  chapterLabel: string | null
  heading: string
  level: number
  kind: 'front' | 'chapter' | 'back'
  /** What this section IS. Only 'body' and 'abstract' may reach the planner. */
  part: PartKind
  paragraphs: string[]
  /** Complete sentences from `paragraphs`, ready for summarisation. */
  sentences: string[]
  listItems: string[]
  tables: DocTable[]
  figures: DocFigure[]
  pages: number[]
  wordCount: number
}

export interface DocTree {
  sections: DocSectionNode[]
  references: string[]
  metadata: CoverMetadata
}

export { parseCover, CoverConflictError, type CoverMetadata } from './coverMetadata'

const NUM_WORDS = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve',
]

const WORD_TO_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
}

const FRONT_MATTER = /^(abstract|executive\s+summary|acknowledge?ments?|dedication|table of contents|list of)/i
const BACK_MATTER = /^(references?|bibliography|appendix|appendices)\b/i
const CAPTION_RE = /^(figure|fig\.?|table|plate|chart)\s*(\d+(?:\.\d+)?)\s*[:.\-]\s*(.*)$/i

/** "CHAPTER TWO" / "CHAPTER 2" / "2.0 INTRODUCTION" -> chapter number. */
export function parseChapterNumber(heading: string): number | null {
  const text = heading.trim()

  const word = text.match(/^chapter\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\b/i)
  if (word) {
    const token = word[1].toLowerCase()
    return WORD_TO_NUM[token] ?? (Number.parseInt(token, 10) || null)
  }

  const dotZero = text.match(/^(\d+)\.0\b/)
  if (dotZero) return Number.parseInt(dotZero[1], 10)

  return null
}

/** "2.3 Traffic Engineering" -> 2. Null when the heading carries no number. */
export function chapterOfHeading(heading: string): number | null {
  const m = heading.trim().match(/^(\d{1,2})(?:\.\d+)*\.?\s+\S/)
  if (!m) return null
  const n = Number.parseInt(m[1], 10)
  return n >= 1 && n <= 12 ? n : null
}

/** "2.3 Traffic Engineering" -> "2.3"; "CHAPTER TWO" -> "2". */
function sectionId(heading: string, chapter: number | null): string {
  const numbered = heading.match(/^(\d+(?:\.\d+)*)/)
  if (numbered) return numbered[1].replace(/\.0$/, '')
  return chapter !== null ? String(chapter) : ''
}

/** Strips the numeric prefix and chapter word so the heading reads as a topic. */
export function cleanHeading(heading: string): string {
  return heading
    .replace(/^chapter\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s*[:.\-]?\s*/i, '')
    .replace(/^\d+(?:\.\d+)*\.?\s+/, '')
    .replace(/\s*\.{3,}\s*\d*\s*$/, '') // table-of-contents dot leaders
    .trim()
}

function newNode(heading: string, level: number, chapter: number | null): DocSectionNode {
  const clean = cleanHeading(heading) || heading.trim()
  const kind: DocSectionNode['kind'] = BACK_MATTER.test(clean)
    ? 'back'
    : FRONT_MATTER.test(clean)
    ? 'front'
    : 'chapter'

  return {
    part: partFromHeading(heading) ?? 'body',
    id: sectionId(heading, chapter),
    chapter,
    chapterLabel: chapter !== null && NUM_WORDS[chapter] ? `Chapter ${NUM_WORDS[chapter]}` : null,
    heading: clean,
    level,
    kind,
    paragraphs: [],
    sentences: [],
    listItems: [],
    tables: [],
    figures: [],
    pages: [],
    wordCount: 0,
  }
}

/**
 * Builds the tree from document HTML.
 *
 * Cover and table-of-contents pages are excluded from the body: their text is
 * identity and navigation, not argument, and letting it through is how a
 * "Department of Computer Engineering" line ends up as a slide bullet.
 */
export function buildDocTree(html: string): DocTree {
  const blocks = scanHtmlBlocks(html)

  const explicitCover = blocks.filter(b => b.attrs['data-cover'] === 'true')

  // A DOCX has no pages, so mammoth's HTML carries no page wrapper and nothing
  // is ever marked data-cover. Without this the whole cover - title, name,
  // matric number, supervisor - was parsed as body prose and the deck had no
  // metadata at all. The cover is instead the run of blocks before the first
  // real section heading, accepted only if it actually reads like one.
  const coverBlocks = explicitCover.length > 0 ? explicitCover : inferCoverBlocks(blocks)
  const coverSet = new Set(coverBlocks)

  const bodyBlocks = blocks.filter(
    b => !coverSet.has(b) && b.attrs['data-cover'] !== 'true' && b.attrs['data-toc'] !== 'true'
  )

  const sections: DocSectionNode[] = []
  const references: string[] = []

  let current: DocSectionNode | null = null
  let chapter: number | null = null
  /** Set by a bare "CHAPTER TWO" line whose topic title is on the next heading. */
  let pendingChapter: number | null = null
  let pendingCaption = ''
  /**
   * Once the reference list opens, every remaining block belongs to it.
   *
   * Without this latch, APA entries that begin with a numeral ("2206
   * https://doi.org/...") satisfied the numbered-heading test and each opened a
   * new pseudo-chapter, scattering the bibliography across the section tree and
   * leaving the real references list with a handful of entries.
   */
  let inReferences = false

  const push = (node: DocSectionNode) => {
    // Front matter is dropped here rather than filtered later, so no downstream
    // stage can be tempted by it. A table of contents that reaches the planner
    // becomes a slide of numbered headings; the only safe place to lose it is
    // at the door.
    if (NON_CONTENT_PARTS.includes(node.part)) return

    // A section whose body is mostly contents lines IS a table of contents,
    // whatever its heading claims - conversion frequently drops the heading.
    if (node.paragraphs.length >= 3 && looksLikeTocBlock(node.paragraphs)) return

    const hasContent =
      node.paragraphs.length > 0 ||
      node.listItems.length > 0 ||
      node.tables.length > 0 ||
      node.figures.length > 0
    if (hasContent) sections.push(node)
  }

  const open = (heading: string, level: number, chapterNum: number | null) => {
    if (current) push(current)
    current = newNode(heading, level, chapterNum)
  }

  for (const block of bodyBlocks) {
    const page = Number.parseInt(block.attrs['data-page'] ?? '', 10)

    if (/^h[1-6]$/.test(block.tag)) {
      const level = Number.parseInt(block.tag.slice(1), 10)
      const parsedChapter = parseChapterNumber(block.text)
      const clean = cleanHeading(block.text)

      // "Table 2.1: Comparison of …" is a CAPTION, not a section heading, even
      // when the document styles it as one. Treating it as a heading created a
      // section per caption - each carrying a real table, each numbered from
      // the running chapter counter - so the deck filled with duplicate table
      // slides labelled with the wrong chapter.
      const asCaption = block.text.match(CAPTION_RE)
      if (asCaption && current) {
        const label = `${asCaption[1]} ${asCaption[2]}`
        const text = stripTrailingPageNumber(asCaption[3])
        if (/^table/i.test(label)) pendingCaption = text
        else current.figures.push({ label, caption: text })
        continue
      }

      if (BACK_MATTER.test(clean)) {
        if (current) push(current)
        current = null
        chapter = null
        inReferences = true
        continue
      }

      // Inside the reference list, a "heading" is just an entry that opens with
      // a numeral. Keep it as reference text.
      if (inReferences) {
        references.push(block.text)
        continue
      }

      if (parsedChapter !== null) {
        chapter = parsedChapter
        if (!clean) {
          // Bare "CHAPTER TWO": the topic title arrives on the next heading.
          if (current) push(current)
          current = null
          pendingChapter = parsedChapter
          continue
        }
        open(block.text, level, parsedChapter)
        pendingChapter = null
        continue
      }

      if (pendingChapter !== null) {
        open(block.text, level, pendingChapter)
        pendingChapter = null
        continue
      }

      // A numbered heading states its own chapter, and that beats the running
      // counter. Many reports write "CHAPTER ONE" once and then number every
      // later section "2.1", "3.2" without another chapter heading; trusting
      // the counter labelled all of them "Chapter One", which the provenance
      // assertion correctly refused to ship.
      open(block.text, level, chapterOfHeading(block.text) ?? chapter)
      continue
    }

    if (inReferences) {
      if (block.tag === 'p' && block.text.trim()) references.push(block.text)
      else if (block.items) references.push(...block.items)
      continue
    }

    if (!current) {
      // Content before any heading: attach it to an implicit opening section
      // rather than dropping it.
      current = newNode('Overview', 1, chapter)
    }

    if (Number.isFinite(page) && !current.pages.includes(page)) current.pages.push(page)

    if (block.tag === 'table' && block.rows && block.rows.length > 0) {
      const [first, ...rest] = block.rows
      current.tables.push({
        caption: pendingCaption,
        headers: first,
        rows: rest.length > 0 ? rest : [],
      })
      pendingCaption = ''
      continue
    }

    if ((block.tag === 'ul' || block.tag === 'ol') && block.items) {
      current.listItems.push(...block.items)
      current.wordCount += block.items.join(' ').split(/\s+/).length
      continue
    }

    if (block.tag === 'p') {
      const caption = block.text.match(CAPTION_RE)
      if (caption || block.attrs['data-caption'] === 'true') {
        const label = caption ? `${caption[1]} ${caption[2]}` : block.text.slice(0, 24)
        const text = caption ? caption[3] : block.text
        if (/^table/i.test(label)) {
          // A table caption precedes its table; hold it for the next table block.
          pendingCaption = text
        } else {
          current.figures.push({ label, caption: text })
        }
        continue
      }

      // Individual contents/listing lines can survive inside an otherwise
      // ordinary section when the front matter was never headed.
      if (looksLikeTocLine(block.text) || looksLikeListingLine(block.text)) continue

      current.paragraphs.push(block.text)
      current.wordCount += block.text.split(/\s+/).length
    }
  }

  if (current) push(current)

  // Segment once, here, so no downstream stage is tempted to split on newlines,
  // and screen every sentence before anything can select it: section numbering
  // removed, cross-references stripped, scaffolding and stray captions dropped.
  for (const section of sections) {
    section.heading = stripSectionNumbering(section.heading)
    section.sentences = section.paragraphs
      .flatMap(p => segmentSentences(normalizeExtractedText(p)))
      .map(cleanSourceSentence)
      .filter(Boolean)
  }

  return {
    sections,
    // Joined into ONE blob before splitting.
    //
    // A PDF reference list uses a hanging indent, so a single citation arrives
    // as several blocks and splitting each block separately cannot put them
    // back together - it produced "…Computer Communication Review, 44(2), 87-"
    // and "98. https://doi.org/…" as two separate "references". Rejoining first
    // and splitting once on the author-year boundary is the only way to
    // recover entry boundaries.
    references: splitReferenceEntries(references.join(' ')),
    metadata: parseCover(coverBlocks.map(b => b.text).filter(Boolean)),
  }
}

/**
 * Splits a run of bibliography text into individual entries.
 *
 * PDF reference lists use a hanging indent that line-joining collapses, so
 * several entries commonly arrive as one paragraph. Entries are re-separated on
 * the APA author-year signature, which is the only reliable boundary marker.
 */
export function splitReferenceEntries(blob: string): string[] {
  const text = blob
    .replace(/\s+/g, ' ')
    // Editorial notes that sit above the list are not citations.
    .replace(/\(\s*listed\s+in\s+APA[^)]*\)/gi, '')
    .trim()
  if (!text) return []

  // A new entry starts at "Surname, X." - but ONLY when what precedes it ends
  // the previous entry: a full stop, a closing bracket, or the last digit of a
  // page range or DOI.
  //
  // The lookbehind is what keeps the split out of the middle of an author list.
  // Without it, "Al-Shabibi, A., … & Snow, B. (2014)" split at every author and
  // the year filter kept only the tail, so the slide credited "Snow, B." for a
  // seven-author paper.
  const boundary = /(?<=[.\d)])\s+(?=[A-Z][A-Za-z'’\-]{1,}(?:,\s+[A-Z]\.|\s+et\s+al\.))/g

  return text
    .split(boundary)
    .map(s => s.trim())
    // A real citation carries a year in parentheses. Anything shorter than that
    // is a fragment of the previous entry, not an entry of its own.
    .filter(s => s.length > 30 && /\((?:19|20)\d{2}[a-z]?\)/.test(s))
}

/**
 * The leading blocks of a document that has no page markers, when they look
 * like a cover page.
 *
 * Bounded by the first heading that opens the document proper (a chapter, or
 * front matter such as ABSTRACT), and accepted only when the enclosed text
 * carries at least three cover signals - otherwise a report that opens
 * straight into prose would lose its first paragraphs.
 */
function inferCoverBlocks(blocks: HtmlBlock[]): HtmlBlock[] {
  const stop = blocks.findIndex(b => {
    if (!/^h[1-6]$/.test(b.tag)) return false
    const clean = cleanHeading(b.text)
    return parseChapterNumber(b.text) !== null || FRONT_MATTER.test(clean) || BACK_MATTER.test(clean)
  })

  const head = blocks.slice(0, stop === -1 ? Math.min(blocks.length, 30) : stop)
  if (head.length === 0) return []

  const text = head.map(b => b.text).join(' ').toLowerCase()
  const signals = [
    /\bsubmitted (to|in partial)\b/,
    /\bin partial fulfil?lment\b/,
    /\bmatric(?:ulation)?\s*(?:no|number)\b/,
    /\bsupervis(?:or|ed by)\b/,
    /\bdepartment of\b/,
    /\bfaculty of\b/,
    /\bschool of\b/,
    /\bseminar (report|presentation|paper)\b/,
    /\bpresented (by|to|at)\b/,
    /\b(higher national diploma|hnd|b\.?sc|bachelor|master)\b/,
  ].filter(re => re.test(text)).length

  return signals >= 3 ? head : []
}

// --- Cover-page metadata ----------------------------------------------

export interface CoverMetadata {
  title: string | null
  studentName: string | null
  matricNo: string | null
  department: string | null
  school: string | null
  institution: string | null
  supervisorName: string | null
  session: string | null
  date: string | null
  /** Fields the extractor could not find. The caller must ask, never guess. */
  missing: string[]
}

const COVER_BOILERPLATE =
  /^(a\s+)?(seminar|project|thesis|dissertation)?\s*(report|presentation|work)?\s*(submitted|presented|written)\b|^in partial fulfil?lment|^being a\b|^this (report|seminar)|^by:?$|^supervised by:?$|^submitted to:?$|^presented to:?$/i

/** A label like "MATRIC NO:" possibly followed by its value on the same line. */
function labelled(lines: string[], pattern: RegExp): string | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const m = line.match(pattern)
    if (!m) continue

    // Value on the same line, after the label.
    const inline = line.slice(m.index! + m[0].length).replace(/^[\s:.\-–—]+/, '').trim()
    if (inline && inline.length > 1) return inline

    // Otherwise the next non-empty, non-boilerplate line.
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim()
      if (!next) continue
      if (COVER_BOILERPLATE.test(next)) continue
      return next
    }
  }
  return null
}

function firstMatch(lines: string[], pattern: RegExp): string | null {
  for (const line of lines) {
    const m = line.match(pattern)
    if (m) return (m[1] ?? m[0]).trim()
  }
  return null
}

/**
 * Reads the identity block off the cover page.
 *
 * Returns null for anything it cannot find and lists it in `missing`. It never
 * falls back to the filename: "PRINCEWILL SEMINAR(SDN)" as a title slide is the
 * defect this replaces, and a wrong-but-plausible value is worse than an
 * explicit prompt to the user.
 */
export function extractCover(rawLines: string[]): CoverMetadata {
  const lines = rawLines
    .flatMap(l => l.split(/\n+/))
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  // Most covers label the matric number; this one does not - it sits bare under
  // the student's name as "F/HD/24/3410037". Fall back to the ID shape: a
  // slash-separated alphanumeric token containing digits.
  const matricNo =
    labelled(lines, /\bmatric(?:ulation)?\s*(?:no\.?|number)?\b/i) ??
    firstMatch(lines, /^([A-Z0-9]{1,6}(?:\/[A-Z0-9]{1,10}){2,})[.,]?$/i)

  const supervisorName = labelled(lines, /\bsupervis(?:ed\s+by|or)\b/i)
  const department = firstMatch(lines, /\bdepartment\s+of\s+(.+?)[.,]?\s*$/i)
  const school = firstMatch(lines, /\b((?:school|faculty)\s+of\s+.+?)[.,]?\s*$/i)
  // Trailing punctuation is common ("YABA COLLEGE OF TECHNOLOGY,") and must not
  // stop the line from matching.
  const institution = firstMatch(
    lines,
    /^([A-Z][A-Za-z'.\- ]*(?:college of technology|polytechnic|university|institute of technology))[.,]?\s*$/i
  )
  const session = firstMatch(lines, /\b(20\d{2}\s*\/\s*20\d{2})\b/)
  const date = firstMatch(lines, /\b((?:january|february|march|april|may|june|july|august|september|october|november|december)[,\s]+20\d{2})\b/i)

  // The student's name follows a "BY" line on every cover in /sample.
  let studentName = labelled(lines, /^\s*by\s*:?\s*$/i)
  if (!studentName) studentName = labelled(lines, /\bpresented\s+by\b/i)
  // A matric number directly beneath the name is the usual layout; if the "BY"
  // capture grabbed the number instead, step back one line.
  if (studentName && /\d{2,}/.test(studentName) && matricNo && studentName.includes(matricNo)) {
    const idx = lines.findIndex(l => l.includes(matricNo))
    studentName = idx > 0 ? lines[idx - 1] : null
  }

  const title = extractCoverTitle(lines, { institution, department, studentName, supervisorName })

  const found = { title, studentName, matricNo, department, school, institution, supervisorName, session, date }
  const missing = Object.entries(found)
    .filter(([, v]) => !v)
    .map(([k]) => k)

  return { ...found, missing }
}

/**
 * The report's real title.
 *
 * Picked as the longest cover line that is not boilerplate, not a labelled
 * field, and not one of the values already identified. On the /sample covers
 * the title is also the longest such line by a wide margin, which makes this
 * stable without needing font sizes.
 */
function extractCoverTitle(
  lines: string[],
  known: { institution: string | null; department: string | null; studentName: string | null; supervisorName: string | null }
): string | null {
  const explicit = labelled(lines, /^\s*(?:topic|title)\s*:?\s*/i)
  if (explicit && explicit.length > 10) return tidyTitle(explicit)

  const knownValues = Object.values(known).filter(Boolean).map(v => (v as string).toLowerCase())

  const isCandidate = (line: string): boolean => {
    const l = line.toLowerCase()
    if (line.length < 8 || line.length > 220) return false
    if (COVER_BOILERPLATE.test(line)) return false
    if (/\b(matric|supervis|department|faculty|school of|session|higher national diploma|\bhnd\b|\bnd\b|in partial)\b/i.test(line)) return false
    if (/(college of technology|polytechnic|university|institute of technology)/i.test(line)) return false
    if (knownValues.some(v => v && (l.includes(v) || v.includes(l)))) return false
    if (/^\d/.test(line)) return false
    return true
  }

  // A cover title is usually set large and wraps over two or three lines. Taking
  // the single longest line truncates it - the SDN report's title came out as
  // "SOFTWARE DEFINED NETWORKING (SDN) FOR TRAFFIC", losing "MANAGEMENT IN
  // ENTERPRISE NETWORKS" from the following line. Consecutive candidate lines
  // are therefore joined into runs, and the longest RUN wins.
  const runs: string[][] = []
  let run: string[] = []
  for (const line of lines) {
    if (isCandidate(line)) {
      run.push(line)
    } else if (run.length > 0) {
      runs.push(run)
      run = []
    }
  }
  if (run.length > 0) runs.push(run)

  if (runs.length === 0) return null

  const best = runs.sort((a, b) => b.join(' ').length - a.join(' ').length)[0]
  const joined = tidyTitle(best.join(' '))
  return joined.length >= 12 ? joined : null
}

/**
 * Removes the page number a "List of Tables" entry drags along:
 * "Classification of RFID Systems by Frequency Range 8" -> "… Frequency Range".
 */
function stripTrailingPageNumber(text: string): string {
  return text.replace(/\s*\.{2,}\s*\d{1,3}\s*$/, '').replace(/\s+\d{1,3}\s*$/, '').trim()
}

/** ALL-CAPS cover titles are kept, but stray punctuation and runs are cleaned. */
function tidyTitle(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/^[\s"'“”]+|[\s"'“”.]+$/g, '').trim()
}
