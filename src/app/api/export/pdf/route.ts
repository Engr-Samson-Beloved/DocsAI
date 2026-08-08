import type { NextRequest } from 'next/server'

/**
 * POST /api/export/pdf
 * ------------------------------------------------------------------
 * Renders a self-contained HTML document (built by the client via
 * utils/pdfDocument.buildStandalonePrintDocument) into a PDF using a
 * headless Chromium instance, and returns it as a downloadable file.
 *
 * Why server-side Chromium instead of the browser's Print dialog:
 *  - The browser's Print → Save as PDF injects an automatic URL/date
 *    header and footer that the user often cannot disable. Rendering on
 *    the server with `displayHeaderFooter` + our OWN templates means the
 *    output contains ONLY the header/footer/page-numbers we specify.
 *  - Output is deterministic for every user (same engine, same fonts),
 *    independent of the user's OS/browser settings.
 *  - Full HTML/CSS fidelity: real page-break control, tables spanning
 *    pages, images, alignment, spacing, vector (selectable) text.
 *
 * Vercel notes:
 *  - Runs on the Node.js runtime (NOT Edge) — Chromium needs Node.
 *  - Uses @sparticuz/chromium (a Lambda/Vercel-friendly Chromium build)
 *    in production and a locally installed Chrome in development.
 *  - `next.config` marks these as server-external packages so Next does
 *    not try to bundle the native binary.
 */

export const runtime = 'nodejs'
export const maxDuration = 60 // seconds — allow for cold start + render
export const dynamic = 'force-dynamic'

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function launchBrowser() {
  const puppeteer = (await import('puppeteer-core')).default
  const onServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_VERSION)

  if (onServerless) {
    const chromium = (await import('@sparticuz/chromium')).default
    return puppeteer.launch({
      args: [...chromium.args, '--font-render-hinting=none'],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: true,
    })
  }

  // Local development: use an installed Chrome/Chromium. Set CHROME_PATH
  // to point at a specific binary, otherwise the 'chrome' channel is used.
  const executablePath = process.env.CHROME_PATH
  return puppeteer.launch({
    headless: true,
    ...(executablePath ? { executablePath } : { channel: 'chrome' as const }),
  })
}

export async function POST(req: NextRequest) {
  let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined

  try {
    const body = await req.json()
    const html: string = body?.html
    const filename: string = (body?.filename || 'document.pdf').toString().replace(/[\r\n"]/g, '')
    const docHeader: string = (body?.docHeader || '').toString()
    const docFooter: string = (body?.docFooter || '').toString()
    const marginMm: number = typeof body?.marginMm === 'number' ? body.marginMm : 25.4

    if (!html || typeof html !== 'string') {
      return new Response('Missing "html" in request body.', { status: 400 })
    }

    const margin = `${marginMm}mm`

    browser = await launchBrowser()
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 })
    await page.emulateMediaType('print')
    // Make sure web fonts (Tinos) are loaded before rendering.
    try {
      await page.evaluate(async () => {
        // @ts-expect-error document.fonts exists in the page context
        if (document.fonts && document.fonts.ready) await document.fonts.ready
      })
    } catch {
      /* non-fatal */
    }

    // Our own header/footer templates → NO automatic URL/date. Page
    // numbers via the built-in `.pageNumber` class Puppeteer substitutes.
    const headerTemplate = `<div style="width:100%; font-family:'Tinos','Times New Roman',serif; font-size:9pt; color:#000; padding:0 ${margin};">${
      docHeader ? `<span>${esc(docHeader)}</span>` : '&nbsp;'
    }</div>`
    const footerTemplate = `<div style="width:100%; font-family:'Tinos','Times New Roman',serif; font-size:10pt; color:#000; padding:0 ${margin}; display:flex; justify-content:space-between; align-items:center;"><span>${esc(
      docFooter
    )}</span><span class="pageNumber" style="margin:0 auto;"></span><span></span></div>`

    const pdfBytes = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      margin: { top: margin, bottom: margin, left: margin, right: margin },
      preferCSSPageSize: false,
    })

    await browser.close()
    browser = undefined

    return new Response(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err: unknown) {
    if (browser) {
      try {
        await browser.close()
      } catch {
        /* ignore */
      }
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error('[export/pdf] failed:', message)
    return new Response(`PDF generation failed: ${message}`, { status: 500 })
  }
}
