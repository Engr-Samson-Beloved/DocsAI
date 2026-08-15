/**
 * reactPdf.tsx
 * ------------------------------------------------------------------
 * Generates a TRUE VECTOR, selectable-text PDF from the editor's HTML,
 * using @react-pdf/renderer — entirely in the browser (no server, no
 * headless Chromium, no binary).
 *
 * SCOPE, honestly stated: this renders the EDITOR's document model. It is the
 * right path for documents this app generated or the user has edited here. It
 * is NOT a .docx converter — for an untouched upload the app routes to real
 * LibreOffice conversion instead (see utils/docxConvert.ts), because nothing
 * here can recover page geometry, section breaks or numbering that mammoth
 * already discarded at import.
 *
 * @react-pdf does not consume HTML/CSS; it uses its own primitives
 * (<Document>/<Page>/<View>/<Text>/<Image>/<Link>). So this module walks the
 * editor DOM and maps it to those primitives:
 *   - headings, paragraphs (bold/italic/underline/color/align/indent)
 *   - unordered/ordered lists, blockquotes
 *   - images, tables with real cell boundaries and column widths
 *   - live hyperlink annotations
 *   - cover page, table-of-contents page, manual page breaks
 *   - page numbers matching PHYSICAL page position, running header/footer
 *
 * Fonts: Tinos (public/fonts) — metric-compatible with Times New Roman and
 * actually EMBEDDED in the output. The previous build used the PDF standard-14
 * "Times-Roman" aliases, which are unembeddable by definition, so the file
 * rendered differently on any machine lacking the font.
 */

import React from 'react'
import { Document, Page, Text, View, Image, Link, Font, pdf } from '@react-pdf/renderer'
import { REPORT_STYLE } from './houseStyle'
import {
  planPageBreaks,
  hyphenateWord,
  looksLikeCaption,
  type BreakKind,
} from './pdfLayout'

// ─── units & geometry ───────────────────────────────────────────────
const PT_PER_INCH = 72

export interface PageGeometry {
  widthIn: number
  heightIn: number
  marginIn: { top: number; right: number; bottom: number; left: number }
}

/**
 * Default geometry comes from houseStyle — THE single source of truth the DOCX
 * exporter already reads. Previously this module hardcoded `size="A4"` in three
 * places and a 1in margin constant, so the two exporters were free to drift
 * apart and a Letter source silently became A4.
 */
const DEFAULT_GEOMETRY: PageGeometry = {
  widthIn: REPORT_STYLE.page.widthIn,
  heightIn: REPORT_STYLE.page.heightIn,
  marginIn: { ...REPORT_STYLE.page.marginIn },
}

const INDENT_PT = PT_PER_INCH * 0.5 // 0.5 inch first-line indent

// ─── fonts ──────────────────────────────────────────────────────────
export const BODY_FONT = 'Tinos'

const FONT_FILES = [
  { file: 'Tinos-Regular.ttf', fontWeight: 'normal' as const, fontStyle: 'normal' as const },
  { file: 'Tinos-Bold.ttf', fontWeight: 'bold' as const, fontStyle: 'normal' as const },
  { file: 'Tinos-Italic.ttf', fontWeight: 'normal' as const, fontStyle: 'italic' as const },
  { file: 'Tinos-BoldItalic.ttf', fontWeight: 'bold' as const, fontStyle: 'italic' as const },
]

let fontsRegistered = false

/**
 * Registers the embedded font family.
 *
 * Fails LOUDLY rather than substituting. A silent fallback is how the audited
 * export ended up mixing Helvetica into a document that is entirely Times: the
 * renderer quietly used its built-in default for every node whose style forgot
 * to name a family.
 */
async function ensureFonts(): Promise<void> {
  if (fontsRegistered) return

  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  // Preflight: confirm the files are actually served before handing react-pdf
  // URLs it will fail on deep inside layout with an opaque error.
  const probe = await fetch(`${origin}/fonts/${FONT_FILES[0].file}`, { method: 'HEAD' }).catch(
    () => null
  )
  if (!probe || !probe.ok) {
    throw new Error(
      `Cannot load the ${BODY_FONT} font from /fonts/. The PDF would fall back to a ` +
        `non-embedded substitute and render differently on other machines, so the ` +
        `export has been stopped instead.`
    )
  }

  Font.register({
    family: BODY_FONT,
    fonts: FONT_FILES.map(f => ({
      src: `${origin}/fonts/${f.file}`,
      fontWeight: f.fontWeight,
      fontStyle: f.fontStyle,
    })),
  })

  Font.registerHyphenationCallback(hyphenateWord)
  fontsRegistered = true
}

export interface ReactPdfOptions {
  filename?: string
  docHeader?: string
  docFooter?: string
  lineHeight?: string | number
  scope?: 'full' | 'cover' | 'toc' | 'content'
  /** Page size/margins. Defaults to the house style; pass a source document's
   *  own geometry to reproduce it rather than imposing ours. */
  geometry?: PageGeometry
  /** Return the blob instead of triggering a download. */
  returnBlob?: boolean
}

// ─── inline style parsing ───────────────────────────────────────────
interface RunStyle {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: string
  fontSize?: number
  upper?: boolean
}

function toPt(value: string): number | undefined {
  const m = value.trim().match(/^(-?\d*\.?\d+)\s*(pt|px|em|rem|in|cm|mm)?$/)
  if (!m) return undefined
  const n = parseFloat(m[1])
  const unit = m[2] || 'px'
  if (unit === 'pt') return n
  if (unit === 'px') return n * 0.75 // 96dpi px → pt
  if (unit === 'in') return n * PT_PER_INCH
  if (unit === 'cm') return (n / 2.54) * PT_PER_INCH
  if (unit === 'mm') return (n / 25.4) * PT_PER_INCH
  if (unit === 'em' || unit === 'rem') return n * REPORT_STYLE.font.bodyPt
  return n
}

function parseInlineStyle(styleStr: string | null): RunStyle & { align?: string } {
  const out: RunStyle & { align?: string } = {}
  if (!styleStr) return out
  for (const decl of styleStr.split(';')) {
    const [rawK, rawV] = decl.split(':')
    if (!rawK || !rawV) continue
    const k = rawK.trim().toLowerCase()
    const v = rawV.trim().toLowerCase()
    if (k === 'font-weight') {
      if (v === 'bold' || v === 'bolder' || parseInt(v) >= 600) out.bold = true
    } else if (k === 'font-style') {
      if (v === 'italic' || v === 'oblique') out.italic = true
    } else if (k === 'text-decoration' || k === 'text-decoration-line') {
      if (v.includes('underline')) out.underline = true
    } else if (k === 'color') {
      out.color = rawV.trim()
    } else if (k === 'font-size') {
      const pt = toPt(rawV.trim())
      if (pt) out.fontSize = pt
    } else if (k === 'text-align') {
      out.align = v
    } else if (k === 'text-transform') {
      if (v === 'uppercase') out.upper = true
    }
  }
  return out
}

function applyCase(text: string, upper?: boolean): string {
  return upper ? text.toUpperCase() : text
}

/**
 * Every text node routes through here, so no node can inherit Helvetica.
 * Typed loosely: @react-pdf's Style union rejects inferred object literals.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runStyleFor(s: RunStyle): any {
  return {
    fontFamily: BODY_FONT,
    fontWeight: s.bold ? 'bold' : 'normal',
    fontStyle: s.italic ? 'italic' : 'normal',
    textDecoration: s.underline ? 'underline' : 'none',
    ...(s.color ? { color: s.color } : {}),
    ...(s.fontSize ? { fontSize: s.fontSize } : {}),
  }
}

// ─── inline (text run) rendering ────────────────────────────────────
let runKey = 0

function renderInline(node: Node, inherited: RunStyle): React.ReactNode[] {
  const out: React.ReactNode[] = []

  node.childNodes.forEach(child => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent || ''
      if (!text) return
      out.push(
        <Text key={`r${runKey++}`} style={runStyleFor(inherited)}>
          {applyCase(text, inherited.upper)}
        </Text>
      )
      return
    }

    if (child.nodeType !== Node.ELEMENT_NODE) return
    const el = child as HTMLElement
    const tag = el.tagName.toLowerCase()

    if (tag === 'br') {
      out.push(<Text key={`r${runKey++}`}>{'\n'}</Text>)
      return
    }

    const next: RunStyle = { ...inherited }
    if (tag === 'strong' || tag === 'b') next.bold = true
    if (tag === 'em' || tag === 'i') next.italic = true
    if (tag === 'u') next.underline = true

    const s = parseInlineStyle(el.getAttribute('style'))
    if (s.bold) next.bold = true
    if (s.italic) next.italic = true
    if (s.underline) next.underline = true
    if (s.color) next.color = s.color
    if (s.fontSize) next.fontSize = s.fontSize
    if (s.upper) next.upper = true

    // Real link annotations. Previously <a> fell through to the generic branch:
    // the text survived, the href did not, and every reference DOI in the
    // exported PDF was dead text with zero link annotations in the file.
    if (tag === 'a') {
      const href = el.getAttribute('href')
      if (href && /^(https?:|mailto:|doi:)/i.test(href)) {
        out.push(
          <Link key={`r${runKey++}`} src={href} style={runStyleFor({ ...next, underline: true })}>
            {renderInline(el, next)}
          </Link>
        )
        return
      }
    }

    out.push(...renderInline(el, next))
  })

  return out
}

// ─── block rendering ────────────────────────────────────────────────
interface BlockCtx {
  forceAlign?: string // used for cover page (centered)
  lineHeight: number
}

let blockKey = 0

/** Marks a node as an explicit page break so adjacent breaks can be collapsed. */
const BREAK_MARKER = '__pageBreak__'

function alignOf(el: HTMLElement, ctx: BlockCtx): 'left' | 'center' | 'right' | 'justify' {
  if (ctx.forceAlign) return ctx.forceAlign as 'center'
  const s = parseInlineStyle(el.getAttribute('style'))
  const a = s.align || (el.getAttribute('align') || '').toLowerCase()
  if (a === 'center' || a === 'right' || a === 'justify' || a === 'left') return a
  return REPORT_STYLE.font.align === 'justify' ? 'justify' : 'left'
}

/** Heading sizes come from the house style, not from magic numbers here. */
const HEADING_SIZES: Record<string, number> = {
  h1: REPORT_STYLE.headings.h1.sizePt,
  h2: REPORT_STYLE.headings.h2.sizePt,
  h3: REPORT_STYLE.headings.h3.sizePt,
}

function headingSize(tag: string): number {
  return HEADING_SIZES[tag] ?? REPORT_STYLE.font.bodyPt
}


function renderList(el: HTMLElement, ordered: boolean, ctx: BlockCtx): React.ReactNode {
  const items = Array.from(el.children).filter(
    c => c.tagName.toLowerCase() === 'li'
  ) as HTMLElement[]
  const startAttr = parseInt(el.getAttribute('start') || '1', 10) || 1
  return (
    <View key={`b${blockKey++}`} style={{ marginBottom: 6 }}>
      {items.map((li, i) => (
        // A real hanging indent: the marker sits in a fixed-width gutter and the
        // text block is indented past it, so wrapped lines align under the text
        // rather than under the bullet.
        <View key={i} style={{ flexDirection: 'row', marginBottom: 2, paddingLeft: INDENT_PT }} wrap={false}>
          <Text style={{ width: 20, fontFamily: BODY_FONT, fontSize: REPORT_STYLE.font.bodyPt }}>
            {ordered ? `${startAttr + i}.` : '•'}
          </Text>
          <Text
            style={{
              flex: 1,
              fontFamily: BODY_FONT,
              fontSize: REPORT_STYLE.font.bodyPt,
              lineHeight: ctx.lineHeight,
              textAlign: 'left',
            }}
          >
            {renderInline(li, {})}
          </Text>
        </View>
      ))}
    </View>
  )
}

function absolutizeSrc(src: string): string {
  if (!src) return src
  if (src.startsWith('data:') || /^https?:\/\//i.test(src)) return src
  if (typeof window !== 'undefined' && src.startsWith('/')) return window.location.origin + src
  return src
}

/** Content width available inside the margins, in points. */
function contentWidth(g: PageGeometry): number {
  return (g.widthIn - g.marginIn.left - g.marginIn.right) * PT_PER_INCH
}

function renderImage(el: HTMLElement, g: PageGeometry): React.ReactNode {
  const src = absolutizeSrc(el.getAttribute('src') || '')
  if (!src) return null

  const max = contentWidth(g)
  const styleAttr = el.getAttribute('style') || ''
  const wMatch = styleAttr.match(/width:\s*([\d.]+)(px|pt|in|cm|mm)?/)
  const widthAttr = el.getAttribute('width')

  let width: number | undefined
  if (wMatch) width = toPt(wMatch[1] + (wMatch[2] || 'px'))
  else if (widthAttr) width = toPt(widthAttr + 'px')

  // Never overflow the text block, and never fall back to a 90pt thumbnail —
  // that default is why figures that did survive came out postage-stamp sized.
  const finalWidth = Math.min(width || max, max)

  return (
    <View key={`b${blockKey++}`} style={{ alignItems: 'center', marginVertical: 6 }} wrap={false}>
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      <Image src={src} style={{ width: finalWidth, objectFit: 'contain' }} />
    </View>
  )
}

/**
 * Renders a real table: cell boundaries, column widths from the grid, colspan,
 * and rows that never split across a page boundary.
 */
function renderTable(el: HTMLElement, ctx: BlockCtx, g: PageGeometry): React.ReactNode {
  const rows = Array.from(el.querySelectorAll('tr'))
  if (rows.length === 0) return null

  // Column widths: tiptap/mammoth carry the DOCX grid as <col> widths or
  // per-cell colwidth attributes. Fall back to equal division.
  const cols = Array.from(el.querySelectorAll('colgroup > col')) as HTMLElement[]
  const colWidths: (number | null)[] = cols.map(c => {
    const w = c.getAttribute('width') || (c.getAttribute('style') || '').match(/width:\s*([\d.]+\w*)/)?.[1]
    return w ? toPt(w) ?? null : null
  })
  const totalDeclared = colWidths.reduce<number>((a, b) => a + (b || 0), 0)
  const available = contentWidth(g)
  const scale = totalDeclared > available && totalDeclared > 0 ? available / totalDeclared : 1

  const headerRowCount = el.querySelectorAll('thead tr').length

  return (
    <View
      key={`b${blockKey++}`}
      style={{ marginVertical: 8, borderTopWidth: 1, borderLeftWidth: 1, borderColor: '#000' }}
      // Keep the header row with at least one body row: if fewer than ~60pt
      // remain, push the whole table start to the next page.
      minPresenceAhead={60}
    >
      {rows.map((tr, ri) => {
        const cells = Array.from(tr.children).filter(c => {
          const t = c.tagName.toLowerCase()
          return t === 'td' || t === 'th'
        }) as HTMLElement[]

        let colCursor = 0
        return (
          // wrap={false} per ROW, not per TABLE. The old code set wrap={false} on
          // the whole table, so any table taller than a page was clipped instead
          // of continuing. Rows still never split mid-cell.
          <View key={ri} style={{ flexDirection: 'row' }} wrap={false}>
            {cells.map((cell, ci) => {
              const span = parseInt(cell.getAttribute('colspan') || '1', 10) || 1
              let width: number | null = 0
              for (let k = 0; k < span; k++) {
                const w = colWidths[colCursor + k]
                if (w == null) {
                  width = null
                  break
                }
                width += w
              }
              colCursor += span

              const isHeader = cell.tagName.toLowerCase() === 'th' || ri < headerRowCount
              return (
                <View
                  key={ci}
                  style={{
                    ...(width != null
                      ? { width: width * scale }
                      : { flex: span }),
                    borderRightWidth: 1,
                    borderBottomWidth: 1,
                    borderColor: '#000',
                    padding: 4,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: BODY_FONT,
                      fontWeight: isHeader ? 'bold' : 'normal',
                      fontSize: Math.max(9, REPORT_STYLE.font.bodyPt - 2),
                      lineHeight: 1.2,
                      textAlign: 'left',
                    }}
                  >
                    {renderInline(cell, {})}
                  </Text>
                </View>
              )
            })}
          </View>
        )
      })}
    </View>
  )
}

function isBlockLevel(tag: string): boolean {
  return [
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'blockquote', 'table', 'div', 'section', 'img', 'figure',
  ].includes(tag)
}

function isTocItem(el: HTMLElement): boolean {
  if (el.getAttribute('data-type') === 'toc-item' || el.getAttribute('data-type') === 'toc-item-text')
    return true
  if (el.classList.contains('toc-item-row')) return true
  if (el.querySelector('.toc-title') || el.querySelector('.toc-dots') || el.querySelector('.toc-page'))
    return true
  return false
}

/**
 * Renders one TOC row.
 *
 * Only ever sees entries the app GENERATED (which carry data-level/data-page).
 * Word's own cached TOC field text is dropped at import — re-flowing it is what
 * produced "1.1Background of the Study...........41.2Problem Definition", where
 * the tab was lost, the leader dots became literal text and two entries merged.
 */
function renderTocItem(el: HTMLElement): React.ReactNode {
  const level = parseInt(el.getAttribute('data-level') || '1', 10)

  const titleEl = el.querySelector('.toc-title')
  const pageEl = el.querySelector('.toc-page')

  let titleText = ''
  let pageText = ''

  if (titleEl) {
    titleText = (titleEl.textContent || '').trim()
    pageText = (pageEl?.textContent || el.getAttribute('data-page') || '').trim()
  } else {
    titleText = (el.textContent || '').trim()
    pageText = (el.getAttribute('data-page') || '').trim()
    // Last-resort split, kept strict: require whitespace or 3+ dots before the
    // trailing number so "Section 1.1" is never mistaken for a page reference.
    if (!pageText) {
      const dotMatch = titleText.match(/^(.*?)[\s.]*\.{3,}[\s.]*(\d+)$/) || titleText.match(/^(.*\S)\s+(\d+)$/)
      if (dotMatch) {
        titleText = dotMatch[1].replace(/[.\s]+$/, '').trim()
        pageText = dotMatch[2]
      }
    }
  }

  if (!titleText) return null

  const isLevel1 = level === 1 || /^chapter\s+/i.test(titleText)
  const paddingLeft = Math.max(0, (level - 1) * 16)
  const weight = isLevel1 ? ('bold' as const) : ('normal' as const)
  const size = REPORT_STYLE.font.bodyPt - 1

  return (
    <View
      key={`b${blockKey++}`}
      style={{ flexDirection: 'row', alignItems: 'flex-end', marginBottom: 6, paddingLeft }}
      wrap={false}
    >
      <Text style={{ fontFamily: BODY_FONT, fontWeight: weight, fontSize: size, lineHeight: 1.2 }}>
        {titleText}
      </Text>

      {/* Dotted leader drawn as a border, not as literal '.' characters. */}
      <View
        style={{
          flex: 1,
          borderBottomWidth: 1,
          borderBottomStyle: 'dotted',
          borderBottomColor: '#000000',
          marginHorizontal: 6,
          marginBottom: 2,
        }}
      />

      <Text style={{ fontFamily: BODY_FONT, fontWeight: weight, fontSize: size, lineHeight: 1.2 }}>
        {pageText}
      </Text>
    </View>
  )
}

/** True when this element is a figure/table caption that must stay with its subject. */
/** True when this element is a figure/table caption that must stay with its subject. */
function isCaption(el: HTMLElement): boolean {
  if (el.classList.contains('docx-caption')) return true
  return looksLikeCaption(el.textContent || '')
}

function renderBlock(
  el: HTMLElement,
  ctx: BlockCtx,
  g: PageGeometry
): React.ReactNode | React.ReactNode[] {
  const tag = el.tagName.toLowerCase()

  if (isTocItem(el)) return renderTocItem(el)

  // Manual page breaks — tagged so consecutive breaks can be collapsed later.
  if (el.classList.contains('page-break') || el.classList.contains('hard-break')) {
    return <View key={`${BREAK_MARKER}${blockKey++}`} break />
  }

  if (/^h[1-6]$/.test(tag)) {
    const hs = parseInlineStyle(el.getAttribute('style'))
    const text = (el.textContent || '').trim().toLowerCase()
    const isChapterBreak =
      tag === 'h1' &&
      (/^chapter\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)/i.test(text) ||
        /^(abstract|references|bibliography|appendix|table of contents)/i.test(text))

    return (
      <Text
        key={`${isChapterBreak ? BREAK_MARKER : ''}b${blockKey++}`}
        wrap={false}
        break={isChapterBreak}
        // keepNext: a heading may not be the last thing on a page. If less than
        // ~72pt of body would follow it, the heading moves to the next page.
        minPresenceAhead={72}
        style={{
          fontFamily: BODY_FONT,
          fontWeight: 'bold',
          fontSize: hs.fontSize || headingSize(tag),
          lineHeight: 1.3,
          marginTop: 8,
          marginBottom: 4,
          textAlign: alignOf(el, ctx),
        }}
      >
        {renderInline(el, { bold: true, upper: hs.upper })}
      </Text>
    )
  }

  if (tag === 'p') {
    const ps = parseInlineStyle(el.getAttribute('style'))
    const inline = renderInline(el, {
      bold: ps.bold,
      italic: ps.italic,
      underline: ps.underline,
      color: ps.color,
      fontSize: ps.fontSize,
      upper: ps.upper,
    })
    // Empty paragraphs contribute nothing but were previously emitted as a 12pt
    // spacer View — enough on its own to hold a page open, which is how the
    // audited export got a page containing a single character and two fully
    // blank pages. Spacing is expressed as margin on real content instead.
    if (inline.length === 0) return null

    const align = alignOf(el, ctx)
    const isApaRef =
      el.classList.contains('apa-reference-entry') || el.closest('.references-list') !== null
    const caption = isCaption(el)

    return (
      <Text
        key={`b${blockKey++}`}
        // Widow/orphan control: never leave a single line of a paragraph alone
        // on either side of a page break.
        orphans={2}
        widows={2}
        style={{
          fontFamily: BODY_FONT,
          fontWeight: ps.bold ? 'bold' : 'normal',
          fontStyle: ps.italic ? 'italic' : 'normal',
          fontSize: ps.fontSize || REPORT_STYLE.font.bodyPt,
          lineHeight: ctx.lineHeight,
          marginBottom: isApaRef ? 6 : 2,
          textAlign: caption ? 'center' : isApaRef ? ('left' as const) : align,
          ...(isApaRef
            ? { textIndent: -INDENT_PT, paddingLeft: INDENT_PT }
            : align === 'center' || align === 'right' || caption || ctx.forceAlign
              ? {}
              : REPORT_STYLE.font.firstLineIndentIn > 0
                ? { textIndent: REPORT_STYLE.font.firstLineIndentIn * PT_PER_INCH }
                : {}),
        }}
      >
        {inline}
      </Text>
    )
  }

  if (tag === 'ul') return renderList(el, false, ctx)
  if (tag === 'ol') return renderList(el, true, ctx)

  if (tag === 'blockquote') {
    return (
      <View
        key={`b${blockKey++}`}
        style={{ marginVertical: 6, paddingLeft: 12, borderLeftWidth: 3, borderColor: '#999' }}
      >
        <Text
          style={{
            fontFamily: BODY_FONT,
            fontStyle: 'italic',
            fontSize: REPORT_STYLE.font.bodyPt,
            lineHeight: ctx.lineHeight,
          }}
          orphans={2}
          widows={2}
        >
          {renderInline(el, { italic: true })}
        </Text>
      </View>
    )
  }

  if (tag === 'table') return renderTable(el, ctx, g)

  if (tag === 'img') return renderImage(el, g)

  // A <figure> keeps its image and <figcaption> on one page.
  if (tag === 'figure') {
    return (
      <View key={`b${blockKey++}`} wrap={false} style={{ marginVertical: 6 }}>
        {renderChildren(el, ctx, g)}
      </View>
    )
  }

  if (tag === 'div' || tag === 'section') {
    const hasBlockChild = Array.from(el.children).some(c => isBlockLevel(c.tagName.toLowerCase()))
    if (hasBlockChild) return renderChildren(el, ctx, g)
    const inline = renderInline(el, { upper: parseInlineStyle(el.getAttribute('style')).upper })
    if (inline.length === 0) return null
    return (
      <Text
        key={`b${blockKey++}`}
        style={{
          fontFamily: BODY_FONT,
          fontSize: REPORT_STYLE.font.bodyPt,
          lineHeight: ctx.lineHeight,
          textAlign: alignOf(el, ctx),
        }}
      >
        {inline}
      </Text>
    )
  }

  const inline = renderInline(el, {})
  if (inline.length === 0) return null
  return (
    <Text
      key={`b${blockKey++}`}
      style={{ fontFamily: BODY_FONT, fontSize: REPORT_STYLE.font.bodyPt, lineHeight: ctx.lineHeight }}
    >
      {inline}
    </Text>
  )
}

function renderChildren(parent: HTMLElement, ctx: BlockCtx, g: PageGeometry): React.ReactNode[] {
  const out: React.ReactNode[] = []
  parent.childNodes.forEach(node => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const res = renderBlock(node as HTMLElement, ctx, g)
      if (Array.isArray(res)) out.push(...res)
      else if (res) out.push(res)
    } else if (node.nodeType === Node.TEXT_NODE && (node.textContent || '').trim()) {
      out.push(
        <Text
          key={`b${blockKey++}`}
          style={{
            fontFamily: BODY_FONT,
            fontSize: REPORT_STYLE.font.bodyPt,
            lineHeight: ctx.lineHeight,
            textAlign: ctx.forceAlign as 'center' | undefined,
          }}
        >
          {node.textContent}
        </Text>
      )
    }
  })
  return out
}

/**
 * Removes page breaks that would produce an empty page.
 *
 * Two adjacent breaks (an explicit `.page-break` div immediately followed by a
 * chapter heading that also carries `break`) emitted one page with nothing on
 * it. A break as the very first node did the same at the front of the document.
 * This is the pass that satisfies "no page with zero content elements".
 */
export function collapsePageBreaks(nodes: React.ReactNode[]): React.ReactNode[] {
  const kindOf = (n: React.ReactNode): BreakKind => {
    if (!React.isValidElement(n)) return 'content'
    const key = String(n.key || '')
    if (!key.includes(BREAK_MARKER)) return 'content'
    return n.type === View ? 'break' : 'break-carrier'
  }

  const kept = planPageBreaks(nodes.map(kindOf))
  return kept.map(i => nodes[i])
}

// ─── page classification ────────────────────────────────────────────
function isCover(el: Element): boolean {
  return el.getAttribute('data-cover') === 'true' || el.querySelector('[data-cover="true"]') !== null
}
function isToc(el: Element): boolean {
  return el.getAttribute('data-toc') === 'true' || el.querySelector('[data-toc="true"]') !== null
}

// ─── document assembly ──────────────────────────────────────────────
function buildDocument(fullHtml: string, opts: ReactPdfOptions) {
  const scope = opts.scope || 'full'
  const g = opts.geometry || DEFAULT_GEOMETRY
  const lineHeight =
    typeof opts.lineHeight === 'number'
      ? opts.lineHeight
      : parseFloat(String(opts.lineHeight || REPORT_STYLE.font.lineSpacing)) ||
        REPORT_STYLE.font.lineSpacing
  const ctx: BlockCtx = { lineHeight }
  const docHeader = (opts.docHeader || '').trim()
  const docFooter = (opts.docFooter || '').trim()

  runKey = 0
  blockKey = 0

  const parser = new DOMParser()
  const doc = parser.parseFromString(fullHtml || '', 'text/html')
  let sourcePages = Array.from(doc.querySelectorAll('div[data-type="page"]')) as HTMLElement[]
  if (sourcePages.length === 0) {
    const wrapper = doc.createElement('div')
    wrapper.innerHTML = fullHtml || '<p></p>'
    sourcePages = [wrapper]
  }

  let coverEl: HTMLElement | null = null
  let tocEl: HTMLElement | null = null
  const contentEls: HTMLElement[] = []

  for (const page of sourcePages) {
    if (isCover(page)) {
      if ((scope === 'full' || scope === 'cover') && !coverEl) coverEl = page
    } else if (isToc(page)) {
      if (scope === 'full' || scope === 'toc') tocEl = page
    } else if (scope === 'full' || scope === 'content') {
      contentEls.push(page)
    }
  }

  const pageSize = { width: g.widthIn * PT_PER_INCH, height: g.heightIn * PT_PER_INCH }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pageStyle: any = {
    paddingTop: g.marginIn.top * PT_PER_INCH,
    paddingBottom: g.marginIn.bottom * PT_PER_INCH,
    paddingLeft: g.marginIn.left * PT_PER_INCH,
    paddingRight: g.marginIn.right * PT_PER_INCH,
    fontFamily: BODY_FONT,
    fontSize: REPORT_STYLE.font.bodyPt,
    color: '#000',
  }

  const chromeStyle = { fontFamily: BODY_FONT, fontSize: 9, color: '#000' }

  const pages: React.ReactNode[] = []

  // Cover page — centered, no page number.
  if (coverEl) {
    const groups = Array.from(coverEl.children) as HTMLElement[]
    pages.push(
      <Page key="cover" size={pageSize} style={pageStyle}>
        <View style={{ flexGrow: 1, justifyContent: 'space-between' }}>
          {groups.map((grp, i) => (
            <View key={i} style={{ alignItems: 'center', width: '100%' }}>
              {renderChildren(grp, { ...ctx, forceAlign: 'center' }, g)}
            </View>
          ))}
        </View>
      </Page>
    )
  }

  // Table of contents — its own page, no number.
  if (tocEl) {
    const tocNodes = collapsePageBreaks(renderChildren(tocEl, ctx, g))
    if (tocNodes.length > 0) {
      pages.push(
        <Page key="toc" size={pageSize} style={pageStyle}>
          {tocNodes}
        </Page>
      )
    }
  }

  if (contentEls.length > 0) {
    const raw: React.ReactNode[] = []
    contentEls.forEach(pageEl => {
      raw.push(...renderChildren(pageEl, ctx, g))
    })
    const contentNodes = collapsePageBreaks(raw)

    if (contentNodes.length > 0) {
      pages.push(
        <Page key="content" size={pageSize} style={pageStyle}>
          {docHeader ? (
            <Text
              fixed
              style={{
                ...chromeStyle,
                position: 'absolute',
                top: g.marginIn.top * PT_PER_INCH * 0.5,
                left: g.marginIn.left * PT_PER_INCH,
                right: g.marginIn.right * PT_PER_INCH,
                textAlign: 'left',
              }}
            >
              {docHeader}
            </Text>
          ) : null}

          {contentNodes}

          {docFooter ? (
            <Text
              fixed
              style={{
                ...chromeStyle,
                position: 'absolute',
                bottom: g.marginIn.bottom * PT_PER_INCH * 0.5,
                left: g.marginIn.left * PT_PER_INCH,
              }}
            >
              {docFooter}
            </Text>
          ) : null}

          <Text
            fixed
            style={{
              ...chromeStyle,
              fontSize: 10,
              position: 'absolute',
              bottom: g.marginIn.bottom * PT_PER_INCH * 0.5,
              left: 0,
              right: 0,
              textAlign: 'center',
            }}
            // PHYSICAL page number. `subPageNumber` counts within this single
            // auto-paginating <Page> element, so it restarted at 1 after the
            // cover and TOC — that is why the footer read "1" on physical page 5
            // and every TOC reference pointed at the wrong sheet.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            render={({ pageNumber }: any) => String(pageNumber)}
          />
        </Page>
      )
    }
  }

  if (pages.length === 0) {
    pages.push(
      <Page key="empty" size={pageSize} style={pageStyle}>
        <Text style={{ fontFamily: BODY_FONT }}> </Text>
      </Page>
    )
  }

  return <Document>{pages}</Document>
}

// ─── public API ─────────────────────────────────────────────────────
export async function renderPdfBlob(fullHtml: string, opts: ReactPdfOptions = {}): Promise<Blob> {
  await ensureFonts()
  return pdf(buildDocument(fullHtml, opts)).toBlob()
}

export async function exportPdfReact(
  fullHtml: string,
  opts: ReactPdfOptions = {}
): Promise<Blob | void> {
  const blob = await renderPdfBlob(fullHtml, opts)
  if (opts.returnBlob) return blob

  const filename = (opts.filename || 'document.pdf').replace(/[\r\n"]/g, '')
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
