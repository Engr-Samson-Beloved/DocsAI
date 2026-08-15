/**
 * True-fidelity document conversion.
 *
 * Proxies an uploaded .docx (or .doc/.odt/.rtf) to a LibreOffice conversion
 * service and streams back the PDF. This is the only path that preserves what
 * the user actually formatted: page size and margins from `sectPr`, style
 * chains from `styles.xml`, tables as tables, embedded images, list numbering
 * with hanging indents, section-based page numbering, headers/footers and live
 * hyperlinks. None of that survives our HTML import pipeline, so for an
 * untouched upload re-rendering it ourselves is strictly worse than converting.
 *
 * `soffice` is a binary and cannot execute inside a standard serverless
 * function, so the actual conversion runs in a container service — Gotenberg is
 * the expected deployment (https://gotenberg.dev), reachable at DOCX_CONVERTER_URL.
 *
 * Deploying the converter:
 *   docker run --rm -p 3000:3000 gotenberg/gotenberg:8
 *   DOCX_CONVERTER_URL=http://localhost:3000
 *
 * Fonts: Times New Roman is not present on Linux. Either bake msttcorefonts
 * into the image or accept metric-compatible Liberation Serif — the response
 * carries an `X-Font-Substitution` header so a substitution is visible in the
 * client rather than silent.
 */

export const runtime = 'nodejs'
export const maxDuration = 60

/** Formats LibreOffice can convert without additional filters. */
const CONVERTIBLE = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.oasis.opendocument.text',
  'application/rtf',
  'text/rtf',
])

const MAX_BYTES = 30 * 1024 * 1024

function converterUrl(): string | null {
  const raw = process.env.DOCX_CONVERTER_URL?.trim()
  if (!raw) return null
  return raw.replace(/\/+$/, '')
}

/** Reports whether conversion is available, so the client can pick a path. */
export async function GET() {
  const base = converterUrl()
  if (!base) {
    return Response.json({ available: false, reason: 'DOCX_CONVERTER_URL is not configured' })
  }

  try {
    const probe = await fetch(`${base}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(4000),
    })
    return Response.json({ available: probe.ok })
  } catch {
    // A converter that is configured but unreachable must not look available —
    // the client falls back to the in-browser renderer instead of failing an
    // export the user already started.
    return Response.json({ available: false, reason: 'converter unreachable' })
  }
}

export async function POST(request: Request) {
  const base = converterUrl()
  if (!base) {
    return new Response(
      JSON.stringify({
        error:
          'Document conversion is not configured. Set DOCX_CONVERTER_URL to a LibreOffice/Gotenberg service to enable exact .docx to PDF conversion.',
      }),
      { status: 501, headers: { 'Content-Type': 'application/json' } }
    )
  }

  let file: File | null = null
  try {
    const form = await request.formData()
    const candidate = form.get('file')
    if (candidate instanceof File) file = candidate
  } catch {
    return Response.json({ error: 'Expected a multipart/form-data upload.' }, { status: 400 })
  }

  if (!file) {
    return Response.json({ error: 'No file was provided.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: `Document is too large to convert (limit ${MAX_BYTES / 1024 / 1024} MB).` },
      { status: 413 }
    )
  }
  if (file.type && !CONVERTIBLE.has(file.type) && !/\.(docx?|odt|rtf)$/i.test(file.name)) {
    return Response.json(
      { error: `Cannot convert files of type "${file.type}".` },
      { status: 415 }
    )
  }

  const upstream = new FormData()
  upstream.append('files', file, file.name || 'document.docx')
  // Keep LibreOffice's own pagination decisions; do not re-impose a page size.
  upstream.append('losslessImageCompression', 'true')
  upstream.append('pdfa', '')

  try {
    const res = await fetch(`${base}/forms/libreoffice/convert`, {
      method: 'POST',
      body: upstream,
      signal: AbortSignal.timeout(55_000),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return Response.json(
        { error: `Conversion failed (${res.status}). ${detail.slice(0, 500)}`.trim() },
        { status: 502 }
      )
    }

    const pdfBytes = await res.arrayBuffer()
    const outName = (file.name || 'document').replace(/\.[^.]+$/, '') + '.pdf'

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${outName.replace(/[\r\n"]/g, '')}"`,
        'Content-Length': String(pdfBytes.byteLength),
        'X-Converted-By': 'libreoffice',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json(
      { error: `Could not reach the conversion service: ${message}` },
      { status: 502 }
    )
  }
}
