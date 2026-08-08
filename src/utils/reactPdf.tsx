/**
 * reactPdf.tsx
 * ------------------------------------------------------------------
 * Generates a TRUE VECTOR, selectable-text PDF from the editor's HTML,
 * using @react-pdf/renderer — entirely in the browser (no server, no
 * headless Chromium, no binary). This keeps the zero-infrastructure
 * reliability of the client approach while producing crisp, searchable,
 * small PDFs.
 *
 * @react-pdf does not consume HTML/CSS; it uses its own primitives
 * (<Document>/<Page>/<View>/<Text>/<Image>). So this module walks the
 * editor DOM and maps it to those primitives:
 *   - headings, paragraphs (bold/italic/underline/color/align/indent)
 *   - unordered/ordered lists, blockquotes
 *   - images, basic tables
 *   - cover page, table-of-contents page, manual page breaks
 *   - page numbers (content pages only), running header/footer
 *
 * Fonts: we use the built-in standard PDF font "Times-Roman" (and its
 * Bold/Italic/BoldItalic variants). These require NO font files and are
 * metric-compatible with Times New Roman — reliable everywhere.
 */

import React from 'react'
import { Document, Page, Text, View, Image, pdf } from '@react-pdf/renderer'

// ─── units ──────────────────────────────────────────────────────────
const PT_PER_INCH = 72
const MARGIN_PT = PT_PER_INCH // 1 inch
const INDENT_PT = PT_PER_INCH * 0.5 // 0.5 inch first-line indent

export interface ReactPdfOptions {
  filename?: string
  docHeader?: string
  docFooter?: string
  lineHeight?: string | number
  scope?: 'full' | 'cover' | 'toc' | 'content'
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

function fontFamilyFor(bold?: boolean, italic?: boolean): string {
  if (bold && italic) return 'Times-BoldItalic'
  if (bold) return 'Times-Bold'
  if (italic) return 'Times-Italic'
  return 'Times-Roman'
}

function toPt(value: string): number | undefined {
  const m = value.trim().match(/^(-?\d*\.?\d+)\s*(pt|px|em|rem)?$/)
  if (!m) return undefined
  const n = parseFloat(m[1])
  const unit = m[2] || 'px'
  if (unit === 'pt') return n
  if (unit === 'px') return n * 0.75 // 96dpi px → pt
  if (unit === 'em' || unit === 'rem') return n * 12 // relative to 12pt base
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

// ─── inline (text run) rendering ────────────────────────────────────
let runKey = 0

function renderInline(node: Node, inherited: RunStyle): React.ReactNode[] {
  const out: React.ReactNode[] = []

  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent || ''
      if (!text) return
      out.push(
        <Text
          key={`r${runKey++}`}
          style={{
            fontFamily: fontFamilyFor(inherited.bold, inherited.italic),
            textDecoration: inherited.underline ? 'underline' : 'none',
            ...(inherited.color ? { color: inherited.color } : {}),
            ...(inherited.fontSize ? { fontSize: inherited.fontSize } : {}),
          }}
        >
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

function alignOf(el: HTMLElement, ctx: BlockCtx): 'left' | 'center' | 'right' | 'justify' {
  if (ctx.forceAlign) return ctx.forceAlign as 'center'
  const s = parseInlineStyle(el.getAttribute('style'))
  const a = s.align || (el.getAttribute('align') || '').toLowerCase()
  if (a === 'center' || a === 'right' || a === 'justify') return a
  return 'left'
}

function headingSize(tag: string): number {
  switch (tag) {
    case 'h1':
      return 16
    case 'h2':
      return 14
    case 'h3':
      return 13
    default:
      return 12
  }
}

function renderList(el: HTMLElement, ordered: boolean, ctx: BlockCtx): React.ReactNode {
  const items = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'li') as HTMLElement[]
  return (
    <View key={`b${blockKey++}`} style={{ marginBottom: 6, paddingLeft: INDENT_PT }}>
      {items.map((li, i) => (
        <View key={i} style={{ flexDirection: 'row', marginBottom: 2 }}>
          <Text style={{ width: 18, fontFamily: 'Times-Roman', fontSize: 12 }}>
            {ordered ? `${i + 1}.` : '•'}
          </Text>
          <Text style={{ flex: 1, fontFamily: 'Times-Roman', fontSize: 12, lineHeight: ctx.lineHeight, textAlign: 'left' }}>
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

function renderImage(el: HTMLElement): React.ReactNode {
  const src = absolutizeSrc(el.getAttribute('src') || '')
  if (!src) return null
  const widthAttr = el.getAttribute('width')
  const styleW = (() => {
    const m = (el.getAttribute('style') || '').match(/width:\s*([\d.]+)(px|pt)?/)
    if (m) return toPt(m[1] + (m[2] || 'px'))
    if (widthAttr) return toPt(widthAttr + 'px')
    return 90
  })()
  return (
    <View key={`b${blockKey++}`} style={{ alignItems: 'center', marginVertical: 6 }}>
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      <Image src={src} style={{ width: styleW || 90 }} />
    </View>
  )
}

function renderTable(el: HTMLElement, ctx: BlockCtx): React.ReactNode {
  const rows = Array.from(el.querySelectorAll('tr'))
  return (
    <View
      key={`b${blockKey++}`}
      style={{ marginVertical: 8, borderTopWidth: 1, borderLeftWidth: 1, borderColor: '#000' }}
    >
      {rows.map((tr, ri) => {
        const cells = Array.from(tr.children).filter((c) => {
          const t = c.tagName.toLowerCase()
          return t === 'td' || t === 'th'
        }) as HTMLElement[]
        return (
          <View key={ri} style={{ flexDirection: 'row' }}>
            {cells.map((cell, ci) => (
              <View
                key={ci}
                style={{
                  flex: 1,
                  borderRightWidth: 1,
                  borderBottomWidth: 1,
                  borderColor: '#000',
                  padding: 4,
                }}
              >
                <Text
                  style={{
                    fontFamily: cell.tagName.toLowerCase() === 'th' ? 'Times-Bold' : 'Times-Roman',
                    fontSize: 11,
                    lineHeight: 1.2,
                    textAlign: 'left',
                  }}
                >
                  {renderInline(cell, {})}
                </Text>
              </View>
            ))}
          </View>
        )
      })}
    </View>
  )
}

function isBlockLevel(tag: string): boolean {
  return [
    'p',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'ul',
    'ol',
    'blockquote',
    'table',
    'div',
    'section',
    'img',
    'figure',
  ].includes(tag)
}

function renderBlock(el: HTMLElement, ctx: BlockCtx): React.ReactNode | React.ReactNode[] {
  const tag = el.tagName.toLowerCase()

  // Manual page breaks.
  if (el.classList.contains('page-break') || el.classList.contains('hard-break')) {
    return <View key={`b${blockKey++}`} break />
  }

  if (/^h[1-6]$/.test(tag)) {
    const hs = parseInlineStyle(el.getAttribute('style'))
    return (
      <Text
        key={`b${blockKey++}`}
        wrap={false}
        style={{
          fontFamily: 'Times-Bold',
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
    if (inline.length === 0) {
      return <View key={`b${blockKey++}`} style={{ height: 12 }} />
    }
    const align = alignOf(el, ctx)
    return (
      <Text
        key={`b${blockKey++}`}
        style={{
          fontFamily: fontFamilyFor(ps.bold, ps.italic),
          fontSize: ps.fontSize || 12,
          lineHeight: ctx.lineHeight,
          marginBottom: 2,
          textAlign: align,
          // First-line indent only for normal left/justified body text
          // (not for centered cover/heading-like lines).
          ...(align === 'center' || align === 'right' || ctx.forceAlign ? {} : { textIndent: INDENT_PT }),
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
        <Text style={{ fontFamily: 'Times-Italic', fontSize: 12, lineHeight: ctx.lineHeight }}>
          {renderInline(el, { italic: true })}
        </Text>
      </View>
    )
  }

  if (tag === 'table') return renderTable(el, ctx)

  if (tag === 'img') return renderImage(el)

  if (tag === 'figure') return renderChildren(el, ctx)

  if (tag === 'div' || tag === 'section') {
    // Container: if it holds block children, render them; otherwise treat
    // its inline content as a paragraph.
    const hasBlockChild = Array.from(el.children).some((c) => isBlockLevel(c.tagName.toLowerCase()))
    if (hasBlockChild) return renderChildren(el, ctx)
    const inline = renderInline(el, { upper: parseInlineStyle(el.getAttribute('style')).upper })
    if (inline.length === 0) return null
    return (
      <Text
        key={`b${blockKey++}`}
        style={{ fontFamily: 'Times-Roman', fontSize: 12, lineHeight: ctx.lineHeight, textAlign: alignOf(el, ctx) }}
      >
        {inline}
      </Text>
    )
  }

  // Fallback: render any inline text.
  const inline = renderInline(el, {})
  if (inline.length === 0) return null
  return (
    <Text key={`b${blockKey++}`} style={{ fontFamily: 'Times-Roman', fontSize: 12, lineHeight: ctx.lineHeight }}>
      {inline}
    </Text>
  )
}

function renderChildren(parent: HTMLElement, ctx: BlockCtx): React.ReactNode[] {
  const out: React.ReactNode[] = []
  parent.childNodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const res = renderBlock(node as HTMLElement, ctx)
      if (Array.isArray(res)) out.push(...res)
      else if (res) out.push(res)
    } else if (node.nodeType === Node.TEXT_NODE && (node.textContent || '').trim()) {
      out.push(
        <Text
          key={`b${blockKey++}`}
          style={{ fontFamily: 'Times-Roman', fontSize: 12, lineHeight: ctx.lineHeight, textAlign: ctx.forceAlign as 'center' | undefined }}
        >
          {node.textContent}
        </Text>
      )
    }
  })
  return out
}

// ─── page classification ────────────────────────────────────────────
function isCover(el: Element): boolean {
  return el.getAttribute('data-cover') === 'true' || el.querySelector('[data-cover="true"]') !== null
}
function isToc(el: Element): boolean {
  return el.getAttribute('data-toc') === 'true' || el.querySelector('[data-toc="true"]') !== null
}

// ─── document assembly ──────────────────────────────────────────────
function buildDocument(fullHtml: string, opts: ReactPdfOptions): React.ReactElement {
  const scope = opts.scope || 'full'
  const lineHeight = typeof opts.lineHeight === 'number' ? opts.lineHeight : parseFloat(String(opts.lineHeight || '2')) || 2
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

  // Typed loosely: @react-pdf's Style unions reject inferred string types
  // from a standalone object; inline literal styles elsewhere are fine.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pageStyle: any = {
    paddingTop: MARGIN_PT,
    paddingBottom: MARGIN_PT,
    paddingLeft: MARGIN_PT,
    paddingRight: MARGIN_PT,
    fontFamily: 'Times-Roman',
    fontSize: 12,
    color: '#000',
  }

  const pages: React.ReactNode[] = []

  // Cover page — centered, no page number.
  if (coverEl) {
    const groups = Array.from(coverEl.children) as HTMLElement[]
    pages.push(
      <Page key="cover" size="A4" style={pageStyle}>
        <View style={{ flexGrow: 1, justifyContent: 'space-between' }}>
          {groups.map((g, i) => (
            <View key={i} style={{ alignItems: 'center', width: '100%' }}>
              {renderChildren(g, { ...ctx, forceAlign: 'center' })}
            </View>
          ))}
        </View>
      </Page>
    )
  }

  // Table of contents — its own page, no number.
  if (tocEl) {
    pages.push(
      <Page key="toc" size="A4" style={pageStyle}>
        {renderChildren(tocEl, ctx)}
      </Page>
    )
  }

  // Content — a single Page that auto-paginates; numbered via subPageNumber
  // so numbering starts at 1 on the first content page (cover/toc excluded).
  if (contentEls.length > 0) {
    const contentNodes: React.ReactNode[] = []
    contentEls.forEach((pageEl) => {
      contentNodes.push(...renderChildren(pageEl, ctx))
    })

    pages.push(
      <Page key="content" size="A4" style={pageStyle}>
        {docHeader ? (
          <Text
            fixed
            style={{ position: 'absolute', top: MARGIN_PT * 0.5, left: MARGIN_PT, right: MARGIN_PT, fontSize: 9, color: '#000', textAlign: 'left' }}
          >
            {docHeader}
          </Text>
        ) : null}

        {contentNodes}

        {docFooter ? (
          <Text
            fixed
            style={{ position: 'absolute', bottom: MARGIN_PT * 0.5, left: MARGIN_PT, fontSize: 9, color: '#000' }}
          >
            {docFooter}
          </Text>
        ) : null}

        <Text
          fixed
          style={{ position: 'absolute', bottom: MARGIN_PT * 0.5, left: 0, right: 0, textAlign: 'center', fontSize: 10, color: '#000' }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          render={({ subPageNumber }: any) => String(subPageNumber)}
        />
      </Page>
    )
  }

  if (pages.length === 0) {
    pages.push(
      <Page key="empty" size="A4" style={pageStyle}>
        <Text> </Text>
      </Page>
    )
  }

  return <Document>{pages}</Document>
}

// ─── public API ─────────────────────────────────────────────────────
export async function exportPdfReact(fullHtml: string, opts: ReactPdfOptions = {}): Promise<void> {
  const filename = (opts.filename || 'document.pdf').replace(/[\r\n"]/g, '')
  const docEl = buildDocument(fullHtml, opts)
  const blob = await pdf(docEl).toBlob()

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
