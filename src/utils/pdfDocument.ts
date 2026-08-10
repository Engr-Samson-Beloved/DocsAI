/**
 * pdfDocument.ts
 * ------------------------------------------------------------------
 * Builds a single, self-contained HTML document that a server-side
 * Chromium instance renders into a PDF (see /api/export/pdf).
 *
 * Design goals:
 *  - The APP controls every formatting decision (fonts, sizes, bold
 *    headings, line spacing, paragraph spacing, margins, alignment,
 *    tables, images, page breaks, page numbers). Chromium's print
 *    engine does the pagination, which handles long documents, tables
 *    spanning pages, orphans/widows, and "keep heading with its text"
 *    far better than any hand-rolled JS pass.
 *  - Deterministic output for every user: because it renders on the
 *    server with a bundled/loaded font (Tinos — metric-compatible with
 *    Times New Roman), the result does not depend on the user's OS,
 *    browser, or locally installed fonts.
 *  - NO browser print dialog is involved, so Chromium never injects a
 *    URL / date / automatic header or footer. Page numbers and any
 *    running header/footer are supplied by us via Puppeteer templates.
 *
 * This function runs in the browser (it uses DOMParser to split the
 * editor's page nodes) and returns a complete `<!doctype html>` string
 * that is POSTed to the render API.
 */

export interface BuildDocumentOptions {
  /** running header text (optional) */
  docHeader?: string
  /** running footer text (optional) */
  docFooter?: string
  /** body line-height, e.g. '2' (double) or '1.5' */
  lineHeight?: string
  /** which parts to include */
  scope?: 'full' | 'cover' | 'toc' | 'content'
  /** page margin in mm applied by the renderer (kept in sync for the cover height calc) */
  marginMm?: number
  /**
   * Absolute base URL so relative asset URLs (e.g. the cover logo at
   * "/yabatech_logo.png") resolve when Chromium renders the HTML via
   * setContent(). Defaults to window.location.origin in the browser.
   */
  baseHref?: string
}

function isCover(el: Element): boolean {
  return el.getAttribute('data-cover') === 'true' || el.querySelector('[data-cover="true"]') !== null
}
function isToc(el: Element): boolean {
  return el.getAttribute('data-toc') === 'true' || el.querySelector('[data-toc="true"]') !== null
}

/**
 * Academic print stylesheet. `content:` is the flowing body; Chromium
 * paginates it against the @page box. Page breaks are controlled here
 * (headings never orphaned, tables/images never split, manual breaks
 * honoured) rather than by pre-splitting the content.
 */
export function documentCss(lineHeight: string, marginMm: number): string {
  // Usable page height for the cover's vertical centering.
  const coverMinHeight = `calc(297mm - ${marginMm * 2}mm)`
  return `
    /* Tinos is metric-compatible with Times New Roman and is free/OSS,
       so server output matches the intended academic look regardless of
       what fonts the user's machine has. */
    @import url('https://fonts.googleapis.com/css2?family=Tinos:ital,wght@0,400;0,700;1,400;1,700&display=swap');

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000;
      font-family: 'Tinos', 'Times New Roman', Times, serif;
      font-size: 12pt;
      line-height: ${lineHeight};
    }

    /* The renderer sets the printable margins via Puppeteer's margin
       option, so @page only fixes the sheet size here. */
    @page { size: A4 portrait; }

    .content { text-align: justify; }

    p {
      margin: 0;
      text-indent: 0.5in;
      orphans: 3;
      widows: 3;
    }
    /* First paragraph after a heading is not indented (academic style). */
    h1 + p, h2 + p, h3 + p, h4 + p, h5 + p, h6 + p { text-indent: 0; }
    p:empty { min-height: 1em; }

    h1, h2, h3, h4, h5, h6 {
      font-weight: bold;
      text-align: left;
      text-indent: 0;
      line-height: 1.3;
      margin: 0.6em 0 0.35em;
      page-break-after: avoid;
      break-after: avoid;
      page-break-inside: avoid;
    }
    h1 { font-size: 16pt; }
    h2 { font-size: 14pt; }
    h3 { font-size: 13pt; }
    h4, h5, h6 { font-size: 12pt; }

    ul, ol { margin: 0 0 0.4em; padding-left: 0.5in; }
    li { margin: 0 0 0.15em; text-align: left; }

    blockquote {
      margin: 0.5em 0;
      padding-left: 0.4in;
      border-left: 3px solid #999;
      font-style: italic;
    }

    strong, b { font-weight: bold; }
    em, i { font-style: italic; }

    table {
      border-collapse: collapse;
      width: 100%;
      margin: 0.5em 0;
      font-size: 10pt;
      page-break-inside: avoid;
    }
    th, td {
      border: 1px solid #000;
      padding: 4px 6px;
      text-align: left;
      vertical-align: top;
    }
    th { font-weight: bold; }
    thead { display: table-header-group; } /* repeat header row across pages */
    tr, img { page-break-inside: avoid; }

    img { max-width: 100%; height: auto; display: inline-block; }

    /* APA-style hanging indents for reference lists. */
    .apa-reference-entry, .references-list p {
      text-indent: -0.5in;
      padding-left: 0.5in;
      margin-bottom: 0.4em;
      text-align: left;
    }

    /* Front matter each occupies its own page(s). */
    .cover, .toc { page-break-after: always; break-after: page; }
    .cover:last-child, .toc:last-child { page-break-after: auto; break-after: auto; }
    .cover {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-height: ${coverMinHeight};
      text-align: center;
    }
    .cover * { text-align: center; }

    /* Table of contents leader dots. */
    .toc-item-row { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 10px; }
    .toc-item-row .toc-dots { flex-grow: 1; border-bottom: 1px dotted #000; margin: 0 8px; position: relative; top: -4px; }

    /* Manual page breaks inserted by the user in the editor. */
    .page-break, .hard-break { page-break-after: always; break-after: page; height: 0; border: 0; margin: 0; }

    /* Force chapter headings to start on a new page.
       The .chapter-start wrapper is injected by buildPrintFragments
       around each chapter-level heading to guarantee a page break. */
    .chapter-start {
      page-break-before: always;
      break-before: page;
    }
    /* The very first content element should not get a spurious leading page break. */
    .content > .chapter-start:first-child {
      page-break-before: auto;
      break-before: auto;
    }
  `
}

/** Result of splitting the document into printable fragments. */
export interface PrintFragments {
  /** the academic stylesheet (no <style> wrapper) */
  css: string
  /** the body inner HTML (cover + toc + flowing content) */
  body: string
  /** whether a cover page is present (used to skip its page number) */
  hasCover: boolean
}

/**
 * Split the editor HTML into { css, body, hasCover }. Shared by both the
 * server renderer and the client-side html2pdf export so they produce
 * identical formatting. Runs in the browser (uses DOMParser).
 */
export function buildPrintFragments(fullHtml: string, opts: BuildDocumentOptions = {}): PrintFragments {
  const lineHeight = opts.lineHeight || '2'
  const scope = opts.scope || 'full'
  const marginMm = opts.marginMm ?? 25.4

  const parser = new DOMParser()
  const doc = parser.parseFromString(fullHtml || '', 'text/html')

  let sourcePages: Element[] = Array.from(doc.querySelectorAll('div[data-type="page"]'))
  if (sourcePages.length === 0) {
    const wrapper = doc.createElement('div')
    wrapper.innerHTML = fullHtml || '<p></p>'
    sourcePages = [wrapper]
  }

  const coverSections: string[] = []
  const tocSections: string[] = []
  const contentParts: string[] = []

  for (const page of sourcePages) {
    if (isCover(page)) {
      if (scope === 'full' || scope === 'cover') {
        coverSections.push(`<section class="cover">${page.innerHTML}</section>`)
      }
      continue
    }
    if (isToc(page)) {
      if (scope === 'full' || scope === 'toc') {
        tocSections.push(`<section class="toc">${page.innerHTML}</section>`)
      }
      continue
    }
    if (scope === 'full' || scope === 'content') {
      // Convert any manual page-break markers into explicit break elements
      // and flow the rest of the content continuously.
      const clone = page.cloneNode(true) as HTMLElement
      clone.querySelectorAll('.page-break').forEach((br) => {
        const hb = doc.createElement('div')
        hb.className = 'hard-break'
        br.replaceWith(hb)
      })

      // Inject .chapter-start markers before chapter-level headings so each
      // chapter starts on a new page in the exported PDF.
      clone.querySelectorAll('h1, h2').forEach((heading) => {
        const text = (heading.textContent || '').trim().toLowerCase()
        const tag = heading.tagName.toLowerCase()
        const isChapterHeading = tag === 'h1' && (
          /^chapter\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)/i.test(text) ||
          /^(abstract|references|bibliography|appendix|table of contents)/i.test(text)
        )
        if (isChapterHeading) {
          const marker = doc.createElement('div')
          marker.className = 'chapter-start'
          heading.parentNode?.insertBefore(marker, heading)
        }
      })

      contentParts.push(clone.innerHTML)
    }
  }

  const body =
    coverSections.join('') +
    tocSections.join('') +
    (contentParts.length ? `<main class="content">${contentParts.join('')}</main>` : '') ||
    '<main class="content"><p></p></main>'

  return {
    css: documentCss(lineHeight, marginMm),
    body,
    hasCover: coverSections.length > 0,
  }
}

/**
 * Build a complete standalone HTML document (kept for any server-side or
 * download-as-HTML use).
 */
export function buildStandalonePrintDocument(fullHtml: string, opts: BuildDocumentOptions = {}): string {
  const { css, body } = buildPrintFragments(fullHtml, opts)
  const baseHref =
    opts.baseHref || (typeof window !== 'undefined' ? window.location.origin : '')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${baseHref ? `<base href="${baseHref.replace(/"/g, '&quot;')}/" />` : ''}
<style>${css}</style>
</head>
<body>${body}</body>
</html>`
}
