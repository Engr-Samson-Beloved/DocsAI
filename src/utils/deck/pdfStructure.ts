/**
 * pdfStructure.ts
 * ------------------------------------------------------------------
 * Recovers document STRUCTURE from a PDF's positioned text runs.
 *
 * Why this module exists
 * ----------------------
 * The old extractor walked pdf.js text items and started a new paragraph
 * whenever the Y coordinate moved by more than 5 units. A Y move of more than
 * 5 units is a NEW LINE, not a new paragraph, so every wrapped line of prose
 * became its own `<p>` - and therefore its own bullet:
 *
 *   <p>Network congestion in enterprise environments occurs when the volume
 *      of data attempting</p>
 *   <p>to traverse a link exceeds its capacity.</p>
 *
 * Everything downstream inherited that. Sentence segmentation had nothing to
 * segment, summarisation had no complete thoughts to choose between, and the
 * deck filled with capitalised half-sentences.
 *
 * This module rebuilds the intended hierarchy: runs -> lines -> blocks, using
 * font size, indentation and vertical rhythm, then classifies each block as a
 * heading, paragraph, list item, caption or table row.
 *
 * Everything here is pure and takes plain objects, so it is unit-testable
 * without pdf.js or a browser.
 */

import { joinWrappedLines, collapseWhitespace } from './textNormalize'

// --- Inputs ----------------------------------------------------------

/** A positioned text run, normalised from pdf.js's TextItem. */
export interface RawTextItem {
  str: string
  /** Left edge, PDF units (points), origin bottom-left. */
  x: number
  /** Baseline Y, PDF units. Larger is higher up the page. */
  y: number
  width: number
  height: number
  fontName?: string
}

export interface Span {
  x: number
  endX: number
  text: string
}

export interface PdfLine {
  y: number
  x: number
  endX: number
  fontSize: number
  spans: Span[]
  text: string
  page: number
}

export type BlockKind = 'heading' | 'paragraph' | 'list' | 'caption' | 'table'

export interface PdfBlock {
  kind: BlockKind
  /** Heading depth, 1-3. Only set when kind === 'heading'. */
  level?: number
  /** Joined, de-hyphenated text. Empty for tables. */
  text: string
  /** Grid, only for kind === 'table'. */
  rows?: string[][]
  fontSize: number
  page: number
}

// --- Lines -----------------------------------------------------------

/**
 * Groups runs onto shared baselines.
 *
 * Tolerance scales with font size rather than being a fixed number of units:
 * superscripts and inline maths sit a point or two off the baseline, and a
 * fixed tolerance either splits them onto their own line (small value) or
 * merges genuinely separate lines of small print (large value).
 */
export function groupIntoLines(items: RawTextItem[], page = 1): PdfLine[] {
  const usable = items.filter(it => it && typeof it.str === 'string' && it.str.trim())
  if (usable.length === 0) return []

  const sorted = [...usable].sort((a, b) => (b.y - a.y) || (a.x - b.x))
  const lines: PdfLine[] = []

  for (const item of sorted) {
    const size = item.height > 0 ? item.height : 10
    const tolerance = Math.max(2, size * 0.4)
    const last = lines[lines.length - 1]

    if (last && Math.abs(last.y - item.y) <= tolerance) {
      last.spans.push({ x: item.x, endX: item.x + item.width, text: item.str })
      last.fontSize = Math.max(last.fontSize, size)
      last.x = Math.min(last.x, item.x)
      last.endX = Math.max(last.endX, item.x + item.width)
    } else {
      lines.push({
        y: item.y,
        x: item.x,
        endX: item.x + item.width,
        fontSize: size,
        spans: [{ x: item.x, endX: item.x + item.width, text: item.str }],
        text: '',
        page,
      })
    }
  }

  for (const line of lines) {
    line.spans.sort((a, b) => a.x - b.x)
    line.text = joinSpans(line.spans)
  }

  return lines
}

/**
 * Concatenates spans into line text, inserting a space only where the gap is
 * wide enough to be one. pdf.js splits runs on font changes, so "SDN" and
 * "-based" often arrive as separate items with no gap between them; blindly
 * joining with a space produces "SDN - based", which is exactly the mangling
 * seen in the shipped deck's table header.
 */
export function joinSpans(spans: Span[]): string {
  let out = ''
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]
    if (i > 0) {
      const gap = span.x - spans[i - 1].endX
      const needsSpace = gap > 0.8 && !/\s$/.test(out) && !/^\s/.test(span.text)
      if (needsSpace) out += ' '
    }
    out += span.text
  }
  return collapseWhitespace(out)
}

/** The most common font size on the page - the body text size. */
export function modalFontSize(lines: PdfLine[]): number {
  if (lines.length === 0) return 10
  const counts = new Map<number, number>()
  for (const line of lines) {
    // Bucket to 0.5pt: the same style varies slightly run to run.
    const key = Math.round(line.fontSize * 2) / 2
    counts.set(key, (counts.get(key) || 0) + line.text.length)
  }
  let best = 10
  let bestCount = -1
  for (const [size, count] of counts) {
    if (count > bestCount) {
      bestCount = count
      best = size
    }
  }
  return best
}

/**
 * Median baseline-to-baseline distance - the page's line rhythm.
 *
 * Only gaps that could plausibly be single line spacing are counted. Without
 * that bound a page holding two widely separated lines reports its
 * paragraph-sized gap as the normal rhythm, and the two lines are then merged
 * into one paragraph because nothing looks unusually large next to it.
 */
export function medianLineGap(lines: PdfLine[], bodySize: number): number {
  const plausible = bodySize * 2.5
  const gaps: number[] = []
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y
    if (gap > 0 && gap <= plausible) gaps.push(gap)
  }
  if (gaps.length === 0) return bodySize * 1.2
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]
}

// --- Table detection -------------------------------------------------

/**
 * Column boundaries within a line: gaps wide enough to be deliberate
 * whitespace between cells rather than inter-word spacing.
 */
export function columnGaps(line: PdfLine, bodySize: number): number[] {
  const threshold = Math.max(bodySize * 1.6, 8)
  const gaps: number[] = []
  for (let i = 1; i < line.spans.length; i++) {
    if (line.spans[i].x - line.spans[i - 1].endX >= threshold) gaps.push(i)
  }
  return gaps
}

/** Splits a line into cells at its column gaps. */
export function lineToCells(line: PdfLine, bodySize: number): string[] {
  const breaks = columnGaps(line, bodySize)
  if (breaks.length === 0) return [line.text]

  const cells: string[] = []
  let start = 0
  for (const b of [...breaks, line.spans.length]) {
    cells.push(joinSpans(line.spans.slice(start, b)))
    start = b
  }
  return cells.filter(c => c.length > 0)
}

/**
 * True when consecutive lines share a column structure - the signature of a
 * table. Requires at least two data lines beyond the header so that a single
 * two-column line (a caption beside a figure number) is not misread.
 */
function looksLikeTableRun(lines: PdfLine[], bodySize: number): boolean {
  if (lines.length < 3) return false
  const counts = lines.map(l => lineToCells(l, bodySize).length)
  const multi = counts.filter(c => c >= 2).length
  return multi >= 3 && multi / counts.length >= 0.6
}

// --- Blocks ----------------------------------------------------------

const HEADING_NUMBER = /^(\d+)(?:\.(\d+))*(?:\.)?\s+\S/
const CHAPTER_LINE = /^chapter\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i
const FRONT_BACK_HEADING =
  /^(abstract|acknowledge?ments?|dedication|table of contents|list of (figures|tables|abbreviations)|references?|bibliography|appendix|appendices)\s*$/i
const CAPTION_LINE = /^(figure|fig\.?|table|plate|chart)\s*\d+(\.\d+)?\s*[:.\-]/i
const LIST_LINE = /^([•‣▶▸*]|\(?[a-z]\)|\(?[ivx]+\)|\d+[.)])\s+\S/i
/**
 * Running page furniture: standalone folios and "Page 5 of 20" footers.
 * These sit at a page boundary, so without this filter they are swallowed into
 * whichever paragraph happens to be open and surface later as a bullet reading
 * "Page 15 of 20".
 */
const PAGE_NUMBER_LINE = /^(page\s+)?\d{1,3}$|^page\s+\d{1,3}\s+of\s+\d{1,3}$|^-\s*\d{1,3}\s*-$/i

/** Heading depth from a dotted number: "2" -> 1, "2.3" -> 2, "2.3.1" -> 3. */
function depthFromNumbering(text: string): number | null {
  const m = text.match(/^(\d+(?:\.\d+)*)\.?\s+\S/)
  if (!m) return null
  const parts = m[1].split('.')
  // "2.0 INTRODUCTION" is a chapter root, not a subsection.
  if (parts.length === 2 && parts[1] === '0') return 1
  return Math.min(3, parts.length)
}

function isHeadingLine(line: PdfLine, bodySize: number): { level: number } | null {
  const text = line.text.trim()
  if (!text || text.length > 140) return null
  if (PAGE_NUMBER_LINE.test(text)) return null

  const bigger = line.fontSize >= bodySize * 1.12
  const allCaps = text === text.toUpperCase() && /[A-Z]{3}/.test(text)

  if (CHAPTER_LINE.test(text)) return { level: 1 }
  if (FRONT_BACK_HEADING.test(text)) return { level: 1 }

  const numbered = depthFromNumbering(text)
  if (numbered !== null && (bigger || allCaps || text.length < 90)) return { level: numbered }

  // Unnumbered heading: needs a type signal, not just brevity, or every short
  // line of prose becomes a heading.
  if ((bigger || allCaps) && text.length < 90 && !/[.;,]$/.test(text)) {
    return { level: bigger && !allCaps ? 2 : 1 }
  }

  return null
}

/**
 * Assembles classified blocks from a page's lines.
 *
 * A paragraph break is declared on a vertical gap materially larger than the
 * page's line rhythm, an indentation jump, a heading, a list marker, or a
 * change into or out of a table run - never on a plain new line.
 */
export function buildBlocks(lines: PdfLine[], page = 1): PdfBlock[] {
  if (lines.length === 0) return []

  const bodySize = modalFontSize(lines)
  const rhythm = medianLineGap(lines, bodySize)
  const blocks: PdfBlock[] = []

  // Locate table runs up front so their lines never reach the prose grouper,
  // but emit them from the main loop below so document order is preserved.
  const inTable = new Array<boolean>(lines.length).fill(false)
  const tableStart = new Map<number, string[][]>()

  for (let i = 0; i < lines.length; i++) {
    let j = i
    while (j < lines.length && lineToCells(lines[j], bodySize).length >= 2) j++

    const run = lines.slice(i, j)
    if (looksLikeTableRun(run, bodySize)) {
      for (let k = i; k < j; k++) inTable[k] = true
      tableStart.set(i, run.map(l => lineToCells(l, bodySize)))
    }
    if (j > i) i = j - 1
  }

  let buffer: string[] = []
  const bufferSize = bodySize

  const flush = () => {
    if (buffer.length === 0) return
    const text = joinWrappedLines(buffer.join('\n'))
    if (text.trim()) {
      blocks.push({ kind: 'paragraph', text, fontSize: bufferSize, page })
    }
    buffer = []
  }

  for (let i = 0; i < lines.length; i++) {
    if (inTable[i]) {
      flush()
      const rows = tableStart.get(i)
      if (rows) blocks.push({ kind: 'table', text: '', rows, fontSize: bodySize, page })
      continue
    }

    const line = lines[i]
    const text = line.text.trim()
    if (!text || PAGE_NUMBER_LINE.test(text)) continue

    const heading = isHeadingLine(line, bodySize)
    if (heading) {
      flush()
      blocks.push({ kind: 'heading', level: heading.level, text, fontSize: line.fontSize, page })
      continue
    }

    if (CAPTION_LINE.test(text)) {
      flush()
      blocks.push({ kind: 'caption', text, fontSize: line.fontSize, page })
      continue
    }

    if (LIST_LINE.test(text)) {
      flush()
      blocks.push({ kind: 'list', text, fontSize: line.fontSize, page })
      continue
    }

    // Geometric paragraph break: an unusually large gap above this line, or a
    // first-line indent relative to the previous line.
    const prev = lines[i - 1]
    if (buffer.length > 0 && prev && !inTable[i - 1]) {
      const gap = prev.y - line.y
      const indented = line.x - prev.x > bodySize * 0.8
      if (gap > rhythm * 1.55 || indented) flush()
    }

    buffer.push(text)
  }

  flush()
  return blocks
}

// --- HTML emission ---------------------------------------------------

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Removes the leading bullet glyph or enumerator from a list line. */
export function stripListMarker(text: string): string {
  return text.replace(/^([•‣▶▸*]|\(?[a-z]\)|\(?[ivx]+\)|\d+[.)])\s+/i, '').trim()
}

/**
 * Serialises blocks to the structured HTML the rest of the pipeline consumes.
 * Tables become real `<table>` elements so they can reach a table layout
 * instead of being flattened into a bullet.
 */
export function blocksToHtml(blocks: PdfBlock[]): string {
  let html = ''

  for (const block of blocks) {
    if (block.kind === 'table' && block.rows && block.rows.length > 0) {
      const rows = block.rows
        .map((row, i) => {
          const tag = i === 0 ? 'th' : 'td'
          return `<tr>${row.map(c => `<${tag}>${escapeHtml(c)}</${tag}>`).join('')}</tr>`
        })
        .join('')
      html += `<table>${rows}</table>`
      continue
    }

    if (!block.text.trim()) continue

    if (block.kind === 'heading') {
      const tag = `h${Math.min(3, Math.max(1, block.level ?? 1))}`
      html += `<${tag}>${escapeHtml(block.text)}</${tag}>`
    } else if (block.kind === 'caption') {
      html += `<p data-caption="true">${escapeHtml(block.text)}</p>`
    } else if (block.kind === 'list') {
      html += `<ul><li>${escapeHtml(stripListMarker(block.text))}</li></ul>`
    } else {
      // A block may still hold several paragraphs after line rejoining.
      for (const para of block.text.split(/\n{2,}/)) {
        if (para.trim()) html += `<p>${escapeHtml(para.trim())}</p>`
      }
    }
  }

  return html
}

/** End-to-end for one page: positioned runs in, structured HTML out. */
export function pageItemsToHtml(items: RawTextItem[], page = 1): string {
  return blocksToHtml(buildBlocks(groupIntoLines(items, page), page))
}
