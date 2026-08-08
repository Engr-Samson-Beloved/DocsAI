/**
 * clientPdf.ts
 * ------------------------------------------------------------------
 * Generates the formatted PDF entirely in the user's browser using
 * html2pdf.js (html2canvas + jsPDF). No server, no headless Chromium,
 * no binary/pack download — so it can't fail at deploy time and works
 * identically on any host (including Vercel static hosting).
 *
 * This is NOT the browser Print dialog: the PDF is built programmatically,
 * so there is no automatic URL/date header/footer. We add our own page
 * numbers (and optional running header/footer) via the jsPDF instance.
 *
 * Formatting comes from the shared academic stylesheet in pdfDocument.ts,
 * so the output matches the app's document styling. Trade-off: output is
 * raster (text is high-resolution images, not selectable). For selectable
 * vector text, migrate to @react-pdf/renderer.
 */

import { buildPrintFragments, type BuildDocumentOptions } from './pdfDocument'

// A4 in mm.
const A4_WIDTH_MM = 210
const A4_HEIGHT_MM = 297

export interface ClientPdfOptions extends BuildDocumentOptions {
  filename?: string
  docHeader?: string
  docFooter?: string
}

/**
 * Build and download a PDF from the editor HTML, in the browser.
 */
export async function exportPdfClient(fullHtml: string, opts: ClientPdfOptions = {}): Promise<void> {
  const marginMm = opts.marginMm ?? 25.4
  const filename = (opts.filename || 'document.pdf').replace(/[\r\n"]/g, '')
  const docHeader = (opts.docHeader || '').trim()
  const docFooter = (opts.docFooter || '').trim()

  const { css, body, hasCover } = buildPrintFragments(fullHtml, { ...opts, marginMm })

  // Render the document off-screen at the true printable content width
  // (page width minus both margins) so 12pt renders at 12pt and html2pdf
  // maps it 1:1 into the page's content area.
  const contentWidthMm = A4_WIDTH_MM - marginMm * 2
  const host = document.createElement('div')
  host.setAttribute(
    'style',
    `position:fixed; left:-100000px; top:0; width:${contentWidthMm}mm; background:#ffffff; color:#000; z-index:-1;`
  )
  host.innerHTML = `<style>${css}</style>${body}`
  document.body.appendChild(host)

  try {
    // Wait for the Tinos web font (and any images) to be ready so the
    // canvas capture uses the correct glyphs.
    try {
      const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts
      if (fonts?.ready) await fonts.ready
    } catch {
      /* non-fatal */
    }

    // html2pdf.js ships only minimal types; treat its fluent worker as any.
    const html2pdf = (await import('html2pdf.js')).default as unknown as (...args: unknown[]) => any

    const opt = {
      margin: [marginMm, marginMm, marginMm, marginMm] as [number, number, number, number],
      filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        windowWidth: host.scrollWidth,
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
      // Honour our CSS page-breaks and avoid splitting these elements.
      pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', 'img', 'h1', 'h2', 'h3', 'blockquote'] },
    }

    // Build the PDF, then stamp page numbers (and optional header/footer)
    // onto the jsPDF instance before saving.
    const worker = html2pdf().set(opt).from(host).toPdf()

    await worker.get('pdf').then((pdf: any) => {
      const total: number = pdf.internal.getNumberOfPages()
      const pageW: number = pdf.internal.pageSize.getWidth()
      const pageH: number = pdf.internal.pageSize.getHeight()
      // Cover page (if any) is not numbered; body numbering starts at 1.
      const firstNumbered = hasCover ? 2 : 1
      let shown = 0

      for (let p = 1; p <= total; p++) {
        pdf.setPage(p)
        pdf.setTextColor(0, 0, 0)

        if (docHeader) {
          pdf.setFont('times', 'normal')
          pdf.setFontSize(9)
          pdf.text(docHeader, marginMm, marginMm * 0.6, { baseline: 'top' })
        }

        if (p >= firstNumbered) {
          shown++
          pdf.setFont('times', 'normal')
          pdf.setFontSize(10)
          pdf.text(String(shown), pageW / 2, pageH - marginMm * 0.5, { align: 'center' })
          if (docFooter) {
            pdf.setFontSize(9)
            pdf.text(docFooter, marginMm, pageH - marginMm * 0.5, { baseline: 'alphabetic' })
          }
        }
      }
    })

    await worker.save()
  } finally {
    host.remove()
  }
}

// Keep the A4 constants referenced (avoids tree-shake / unused warnings).
export const A4 = { widthMm: A4_WIDTH_MM, heightMm: A4_HEIGHT_MM }
