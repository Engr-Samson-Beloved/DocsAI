/**
 * printPagination.ts
 * ------------------------------------------------------------------
 * A single, geometry-accurate pagination engine that re-flows a
 * document's content stream into A4 pages using the *exact* typography
 * that the exported PDF / print output uses.
 *
 * Why this exists:
 *  - The on-screen editor paginates by measuring live `.page-sheet`
 *    DOM nodes. That fails whenever those nodes are `display:none`
 *    (e.g. the whole editor canvas is hidden on mobile), so the page
 *    count and the exported PDF disagree, content gets clipped, and
 *    blank / half-empty pages appear.
 *  - This module measures content in an *off-screen* host that is
 *    always laid out (never display:none), with the real print
 *    typography, so the Preview modal and the PDF export share one
 *    source of truth: identical page counts, identical formatting,
 *    no clipping, no blank pages.
 *
 * All measurements are done in CSS pixels @96dpi (1in = 96px,
 * 1mm ≈ 3.7795px) which is exactly how browsers rasterise `mm` at
 * print time, so the measured layout matches the printed layout.
 */

// ─── A4 print geometry (academic: Times New Roman 12pt, 1" margins) ──
// A4 = 210mm × 297mm. We use 296mm for the sheet height to leave a
// hair of safety so a full page never spills a sliver onto a blank
// following page (a classic print-to-PDF failure mode).
export const SHEET_WIDTH_MM = 210
export const SHEET_HEIGHT_MM = 296
export const PAGE_MARGIN_MM = 25.4 // 1 inch

// Printable content box, in px, that the reflow measures against.
// Kept slightly conservative vs. the rendered box so measured content
// always fits the rendered sheet (never the other way around).
export const CONTENT_WIDTH_PX = 600 // ≈ 210mm − 2×25.4mm
export const CONTENT_HEIGHT_PX = 910 // ≈ 296mm − 2×25.4mm, minus slack

export type PrintPageKind = 'cover' | 'toc' | 'content'

export interface PrintPage {
  kind: PrintPageKind
  /** inner HTML to place inside the sheet's content area */
  html: string
  /** 1-based number shown in the footer (content pages only) */
  pageNumber?: number
}

export interface PaginateOptions {
  /** CSS line-height for body text, e.g. '2', '1.5' */
  lineHeight?: string
}

const MEASURE_HOST_ID = 'wp-print-measure-host'
const MEASURE_STYLE_ID = 'wp-print-measure-style'

/**
 * CSS applied both to the off-screen measuring host AND to the rendered
 * sheets, so what we measure is exactly what we render/print.
 * `scope` lets callers reuse it for `.wp-print-measure` (measuring) or
 * `.wp-sheet__content` (rendering).
 */
export function printContentCss(scope: string, lineHeight: string): string {
  return `
  ${scope} {
    font-family: 'Times New Roman', Times, serif;
    font-size: 12pt;
    line-height: ${lineHeight};
    color: #000;
    text-align: justify;
    box-sizing: border-box;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  ${scope} p { margin: 0; text-indent: 0.5in; }
  ${scope} p:empty { min-height: 1em; }
  ${scope} h1, ${scope} h2, ${scope} h3, ${scope} h4, ${scope} h5, ${scope} h6 {
    font-family: 'Times New Roman', Times, serif;
    font-weight: bold;
    color: #000;
    text-align: left;
    text-indent: 0;
    line-height: 1.5;
    margin: 0.5em 0 0.35em;
    page-break-after: avoid;
  }
  ${scope} h1 { font-size: 16pt; }
  ${scope} h2 { font-size: 14pt; }
  ${scope} h3 { font-size: 13pt; }
  ${scope} h4, ${scope} h5, ${scope} h6 { font-size: 12pt; }
  ${scope} ul, ${scope} ol { margin: 0 0 0.4em; padding-left: 0.5in; text-indent: 0; }
  ${scope} li { margin: 0 0 0.15em; text-indent: 0; text-align: left; }
  ${scope} blockquote { margin: 0.4em 0; padding-left: 0.4in; border-left: 3px solid #999; font-style: italic; }
  ${scope} img { max-width: 100%; height: auto; }
  ${scope} table { border-collapse: collapse; width: 100%; }
  ${scope} td, ${scope} th { border: 1px solid #000; padding: 4px 6px; }
  ${scope} .apa-reference-entry, ${scope} .references-list p {
    text-indent: -0.5in; padding-left: 0.5in; margin-bottom: 0.4em; text-align: left;
  }
  ${scope} .page-break { display: none !important; }
  `
}

function ensureMeasureHost(lineHeight: string): HTMLElement {
  let style = document.getElementById(MEASURE_STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = MEASURE_STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = printContentCss('.wp-print-measure', lineHeight)

  let host = document.getElementById(MEASURE_HOST_ID)
  if (!host) {
    host = document.createElement('div')
    host.id = MEASURE_HOST_ID
    host.className = 'wp-print-measure'
    document.body.appendChild(host)
  }
  // overflow:hidden establishes a block-formatting context so the first
  // child's top margin isn't collapsed away, keeping measurements accurate.
  host.setAttribute(
    'style',
    `position:fixed; left:-100000px; top:0; width:${CONTENT_WIDTH_PX}px; ` +
      `visibility:hidden; pointer-events:none; z-index:-1; background:#fff; overflow:hidden;`
  )
  host.innerHTML = ''
  return host
}

function isCoverPage(el: Element): boolean {
  return el.getAttribute('data-cover') === 'true' || el.querySelector('[data-cover="true"]') !== null
}

function isTocPage(el: Element): boolean {
  return el.getAttribute('data-toc') === 'true' || el.querySelector('[data-toc="true"]') !== null
}

/**
 * Split a single block that is taller than a full page into two blocks
 * by words, so the first part fills (at most) one page and the rest
 * carries over. Formatting inside the split block is flattened — this
 * only triggers for blocks longer than an entire page (rare), so the
 * trade-off is acceptable and prevents content from being clipped.
 */
function splitOversizedBlock(
  block: HTMLElement,
  host: HTMLElement
): [HTMLElement, HTMLElement] | null {
  const text = (block.textContent || '').trim()
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length < 2) return null

  const cloneWith = (slice: string[]): HTMLElement => {
    const c = block.cloneNode(false) as HTMLElement
    c.textContent = slice.join(' ')
    return c
  }

  // Binary-search the largest word count whose height still fits a page.
  let lo = 1
  let hi = words.length
  let best = 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const probe = cloneWith(words.slice(0, mid))
    host.innerHTML = ''
    host.appendChild(probe)
    if (host.scrollHeight <= CONTENT_HEIGHT_PX) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (best >= words.length) return null
  return [cloneWith(words.slice(0, best)), cloneWith(words.slice(best))]
}

export interface HeadingLocation {
  title: string
  level: number // 1..6
  /** content-page number (1-based, cover/TOC excluded) — matches the PDF footer */
  page: number
}

/**
 * Map every heading in the document to the REAL content-page number it lands
 * on, using the exact same pagination engine as the PDF export. This is the
 * single source of truth for an accurate Table of Contents: the numbers here
 * equal the numbers printed in the exported PDF's footer (content pages are
 * numbered from 1, excluding the cover and TOC front matter).
 *
 * Implementation: paginate, then read the headings out of each rendered
 * content page's HTML — so it needs no duplicate flow logic and can't drift
 * from paginateDocumentForPrint.
 */
export function mapHeadingsToContentPages(fullHtml: string, opts: PaginateOptions = {}): HeadingLocation[] {
  if (typeof document === 'undefined') return []
  const pages = paginateDocumentForPrint(fullHtml, opts)
  const parser = new DOMParser()
  const out: HeadingLocation[] = []
  for (const p of pages) {
    if (p.kind !== 'content' || !p.pageNumber) continue
    const doc = parser.parseFromString(p.html, 'text/html')
    doc.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
      const title = (h.textContent || '').trim()
      if (!title) return
      out.push({ title, level: parseInt(h.tagName.charAt(1), 10) || 1, page: p.pageNumber as number })
    })
  }
  return out
}

/**
 * Re-flow the full document HTML into print pages.
 *
 * @param fullHtml  editor.getHTML() — a series of `div[data-type=page]`
 * @param opts      { lineHeight }
 * @returns ordered pages (cover / toc kept whole; content re-flowed)
 */
export function paginateDocumentForPrint(fullHtml: string, opts: PaginateOptions = {}): PrintPage[] {
  const lineHeight = opts.lineHeight || '2'

  if (typeof document === 'undefined') return []

  const parser = new DOMParser()
  const doc = parser.parseFromString(fullHtml || '', 'text/html')

  let sourcePages: Element[] = Array.from(doc.querySelectorAll('div[data-type="page"]'))
  if (sourcePages.length === 0) {
    const wrapper = doc.createElement('div')
    wrapper.setAttribute('data-type', 'page')
    wrapper.innerHTML = fullHtml || '<p></p>'
    sourcePages = [wrapper]
  }

  const host = ensureMeasureHost(lineHeight)
  const measure = (el: HTMLElement): number => {
    host.innerHTML = ''
    host.appendChild(el)
    return host.scrollHeight
  }

  const pages: PrintPage[] = []

  // Working buffer for the current content page.
  let buffer: HTMLElement[] = []

  const flushBuffer = () => {
    if (buffer.length === 0) return
    const wrap = doc.createElement('div')
    buffer.forEach((b) => wrap.appendChild(b))
    // Drop a page that ended up effectively empty (whitespace only).
    if ((wrap.textContent || '').trim().length > 0 || wrap.querySelector('img,table')) {
      pages.push({ kind: 'content', html: wrap.innerHTML })
    }
    buffer = []
  }

  // Add a block to the current page, opening new pages as needed.
  const addBlock = (block: HTMLElement, depth = 0) => {
    // Guard against pathological recursion.
    if (depth > 5000) {
      buffer.push(block)
      return
    }

    const probe = doc.createElement('div')
    buffer.forEach((b) => probe.appendChild(b.cloneNode(true)))
    probe.appendChild(block.cloneNode(true))
    const combinedHeight = measure(probe)

    if (combinedHeight <= CONTENT_HEIGHT_PX) {
      buffer.push(block)
      return
    }

    // Doesn't fit alongside existing content → start a fresh page first.
    if (buffer.length > 0) {
      flushBuffer()
      addBlock(block, depth + 1)
      return
    }

    // Page is empty yet the single block still overflows → try to split.
    const parts = splitOversizedBlock(block, host)
    if (parts) {
      addBlock(parts[0], depth + 1)
      addBlock(parts[1], depth + 1)
      return
    }

    // Cannot split (e.g. a huge image / table) → place it alone.
    buffer.push(block)
    flushBuffer()
  }

  for (const page of sourcePages) {
    if (isCoverPage(page)) {
      flushBuffer()
      pages.push({ kind: 'cover', html: page.innerHTML })
      continue
    }
    if (isTocPage(page)) {
      flushBuffer()
      pages.push({ kind: 'toc', html: page.innerHTML })
      continue
    }

    // Content page: flow its direct-child blocks into the stream,
    // honouring manual page-breaks. Content flows ACROSS the original
    // page-node boundaries — the source split is intentionally ignored.
    const children = Array.from(page.children) as HTMLElement[]
    for (const child of children) {
      if (child.classList && child.classList.contains('page-break')) {
        flushBuffer()
        continue
      }
      // Skip stray empty paragraphs that only add noise between blocks
      // (they still count if they carry a non-breaking space / content).
      addBlock(child)
    }
  }

  flushBuffer()

  // Assign visible page numbers to content pages only.
  let n = 0
  for (const p of pages) {
    if (p.kind === 'content') {
      n += 1
      p.pageNumber = n
    }
  }

  // Cleanup measuring host contents (keep the node for reuse).
  host.innerHTML = ''

  if (pages.length === 0) {
    pages.push({ kind: 'content', html: '<p></p>', pageNumber: 1 })
  }

  return pages
}

/**
 * CSS for the rendered sheets, shared by the Preview modal and the PDF
 * print mount. Pass a `lineHeight` to match the paginated measurement.
 */
export function printSheetCss(lineHeight: string): string {
  return `
  .wp-sheet {
    width: ${SHEET_WIDTH_MM}mm;
    height: ${SHEET_HEIGHT_MM}mm;
    position: relative;
    overflow: hidden;
    background: #fff;
    color: #000;
    box-sizing: border-box;
    margin: 0 auto;
  }
  .wp-sheet__header {
    position: absolute;
    top: 12mm; left: ${PAGE_MARGIN_MM}mm; right: ${PAGE_MARGIN_MM}mm;
    display: flex; justify-content: space-between; align-items: flex-end;
    font-family: 'Times New Roman', Times, serif; font-size: 10pt; color: #000;
  }
  .wp-sheet__content {
    position: absolute;
    top: ${PAGE_MARGIN_MM}mm; left: ${PAGE_MARGIN_MM}mm; right: ${PAGE_MARGIN_MM}mm;
    bottom: ${PAGE_MARGIN_MM}mm;
    overflow: hidden;
  }
  .wp-sheet__pagenum {
    position: absolute;
    bottom: 12mm; left: 0; right: 0;
    text-align: center;
    font-family: 'Times New Roman', Times, serif; font-size: 12pt; color: #000;
  }
  .wp-sheet--cover .wp-sheet__content,
  .wp-sheet--toc .wp-sheet__content {
    top: ${PAGE_MARGIN_MM}mm; bottom: ${PAGE_MARGIN_MM}mm;
  }
  .wp-sheet--cover .wp-sheet__content {
    display: flex; flex-direction: column; justify-content: space-between;
    text-align: center;
  }
  .wp-sheet--cover .wp-sheet__content * { text-align: center; }
  ${printContentCss('.wp-sheet__content', lineHeight)}
  `
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Build the markup for one rendered sheet. Used by the PDF print mount.
 */
export function renderSheetHtml(
  page: PrintPage,
  meta: { docHeader?: string; docFooter?: string }
): string {
  const modifier = page.kind === 'cover' ? ' wp-sheet--cover' : page.kind === 'toc' ? ' wp-sheet--toc' : ''
  const header =
    page.kind === 'content' && meta.docHeader
      ? `<div class="wp-sheet__header"><span>${escapeHtml(meta.docHeader)}</span></div>`
      : ''
  const footer =
    page.kind === 'content'
      ? `<div class="wp-sheet__pagenum">${page.pageNumber ?? ''}</div>`
      : ''
  return (
    `<div class="wp-sheet${modifier}">` +
    header +
    `<div class="wp-sheet__content">${page.html}</div>` +
    footer +
    `</div>`
  )
}

/**
 * Build the complete inner HTML for the #print-mount container.
 */
export function renderPrintMountHtml(
  pages: PrintPage[],
  meta: { docHeader?: string; docFooter?: string } = {}
): string {
  return pages.map((p) => renderSheetHtml(p, meta)).join('')
}

const PRINT_MOUNT_ID = 'print-mount'
const PRINT_STYLE_ID = 'print-mount-styles'

export interface MountPrintOptions {
  docHeader?: string
  docFooter?: string
  lineHeight?: string
  scope?: 'full' | 'cover' | 'toc' | 'content'
}

/**
 * Paginate `fullHtml`, render the sheets into an off-screen #print-mount,
 * and inject the print stylesheet. Returns false if there is nothing to
 * print for the requested scope. Call `unmountPrintDom()` to clean up.
 */
export function mountPrintDom(fullHtml: string, opts: MountPrintOptions = {}): boolean {
  if (typeof document === 'undefined') return false
  const lineHeight = opts.lineHeight || '2'
  const scope = opts.scope || 'full'

  let pages = paginateDocumentForPrint(fullHtml, { lineHeight })

  if (scope === 'cover') pages = pages.filter((p) => p.kind === 'cover')
  else if (scope === 'toc') pages = pages.filter((p) => p.kind === 'toc')
  else if (scope === 'content') pages = pages.filter((p) => p.kind === 'content')

  if (pages.length === 0) return false

  if (scope !== 'full') {
    let n = 0
    pages.forEach((p) => {
      if (p.kind === 'content') p.pageNumber = ++n
    })
  }

  let printMount = document.getElementById(PRINT_MOUNT_ID)
  if (!printMount) {
    printMount = document.createElement('div')
    printMount.id = PRINT_MOUNT_ID
    document.body.appendChild(printMount)
  }
  printMount.innerHTML = renderPrintMountHtml(pages, { docHeader: opts.docHeader, docFooter: opts.docFooter })

  let styleEl = document.getElementById(PRINT_STYLE_ID) as HTMLStyleElement | null
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = PRINT_STYLE_ID
    document.head.appendChild(styleEl)
  }
  styleEl.textContent = `
    #${PRINT_MOUNT_ID} { display: none; }
    @page { size: A4; margin: 0; }
    @media print {
      html, body {
        width: 210mm !important;
        height: auto !important;
        margin: 0 !important;
        padding: 0 !important;
        background: #fff !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      body > *:not(#${PRINT_MOUNT_ID}) { display: none !important; }
      #${PRINT_MOUNT_ID} {
        display: block !important;
        margin: 0 !important;
        padding: 0 !important;
        background: #fff !important;
      }
      .wp-sheet { page-break-after: always; break-after: page; }
      .wp-sheet:last-child { page-break-after: avoid; break-after: avoid; }
    }
    ${printSheetCss(lineHeight)}
  `
  return true
}

export function unmountPrintDom(): void {
  if (typeof document === 'undefined') return
  const printMount = document.getElementById(PRINT_MOUNT_ID)
  if (printMount) printMount.innerHTML = ''
  const styleEl = document.getElementById(PRINT_STYLE_ID)
  if (styleEl) styleEl.remove()
}

