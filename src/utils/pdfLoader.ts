"use client"

/**
 * Central PDF.js loader.
 *
 * The worker MUST be the exact same release as the pdfjs-dist API bundle, otherwise
 * pdf.js aborts with "The API version 'x' does not match the worker version 'y'".
 * Nothing here hardcodes a version number: the worker URL is always derived from the
 * package that was actually bundled, so upgrading pdfjs-dist can never desync it again.
 */

type PdfJsApi = any

let apiPromise: Promise<PdfJsApi> | null = null

// Candidate worker URLs, best first. Each is validated before use so a 404 (or an
// SPA fallback returning index.html) falls through to the next candidate.
function workerCandidates(version: string): string[] {
  const candidates: string[] = []

  // 1. Emitted by the bundler straight from node_modules — guaranteed version match, works offline.
  try {
    candidates.push(new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString())
  } catch {
    // Bundler did not rewrite the URL (older webpack config); fall through.
  }

  // 2. Copy placed in /public by scripts/copy-pdf-worker.mjs — also offline-capable.
  candidates.push('/pdf.worker.min.mjs')

  // 3. CDN, pinned to the installed version rather than a floating tag.
  if (version) {
    candidates.push(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/legacy/build/pdf.worker.min.mjs`)
    candidates.push(`https://unpkg.com/pdfjs-dist@${version}/legacy/build/pdf.worker.min.mjs`)
  }

  return candidates
}

async function isUsableWorker(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'GET' })
    if (!res.ok) return false
    // A dev server / host that rewrites unknown paths hands back an HTML shell.
    const type = res.headers.get('content-type') || ''
    if (type.includes('text/html')) return false
    return true
  } catch {
    return false
  }
}

async function resolveWorkerSrc(version: string): Promise<string> {
  for (const candidate of workerCandidates(version)) {
    if (await isUsableWorker(candidate)) return candidate
  }
  throw new Error(
    'Could not load the PDF worker. Check your connection and try again, or import the file as .docx.'
  )
}

export async function getPdfJs(): Promise<PdfJsApi> {
  if (typeof window === 'undefined') {
    throw new Error('PDF parsing is only available in the browser.')
  }

  if (apiPromise) return apiPromise

  apiPromise = (async () => {
    // The legacy build carries the widest mobile-browser support.
    // @ts-ignore - no bundled types for the deep .mjs path
    const mod: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const api: PdfJsApi =
      typeof mod?.getDocument === 'function'
        ? mod
        : typeof mod?.default?.getDocument === 'function'
        ? mod.default
        : null

    if (!api) {
      throw new Error('PDF parsing library failed to load.')
    }

    if (api.GlobalWorkerOptions && !api.GlobalWorkerOptions.workerSrc) {
      api.GlobalWorkerOptions.workerSrc = await resolveWorkerSrc(api.version || '')
    }

    return api
  })()

  // Never cache a failed load — the next attempt should be able to retry.
  apiPromise.catch(() => {
    apiPromise = null
  })

  return apiPromise
}

/**
 * Reads a file's bytes.
 *
 * `Blob.arrayBuffer()` is missing on iOS Safari below 14 and on several Android
 * WebViews, where calling it throws "undefined is not a function". Those are
 * exactly the browsers this app's mobile users are on, so FileReader backs it up.
 */
async function readArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()

  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(new Error('The selected file could not be read.'))
    reader.readAsArrayBuffer(blob)
  })
}

/** Errors carry the stage that failed so the UI can report something actionable. */
export class PdfImportError extends Error {
  stage: string
  constructor(stage: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super(`[${stage}] ${detail}`)
    this.name = 'PdfImportError'
    this.stage = stage
  }
}

/**
 * Opens a PDF and returns the loaded document.
 * Mobile pickers hand over files backed by cloud providers, so the bytes are read
 * up front rather than streamed through a URL the worker cannot reach.
 */
export async function loadPdfDocument(file: File | Blob | ArrayBuffer): Promise<any> {
  let pdfjs: PdfJsApi
  try {
    pdfjs = await getPdfJs()
  } catch (err) {
    throw new PdfImportError('load-pdfjs', err)
  }

  let bytes: Uint8Array
  try {
    const buffer = file instanceof ArrayBuffer ? file : await readArrayBuffer(file)
    bytes = new Uint8Array(buffer)
  } catch (err) {
    throw new PdfImportError('read-file', err)
  }

  try {
    return await pdfjs.getDocument({ data: bytes }).promise
  } catch (err) {
    throw new PdfImportError('parse-pdf', err)
  }
}

/**
 * Extracts a PDF's text as structured HTML (headings + paragraphs).
 *
 * Text items are grouped into paragraphs by Y-coordinate gaps, then lines that
 * look like chapter/section headings are promoted to h1/h2/h3 so downstream
 * consumers (the editor, the audit, the PPTX exporter) see real structure.
 *
 * Returns '' when the PDF holds no extractable text, which is the signal that it
 * is a scanned image rather than a text PDF.
 */
export async function extractPdfAsHtml(file: File | Blob): Promise<string> {
  const pdf = await loadPdfDocument(file)

  let html = ''

  for (let i = 1; i <= pdf.numPages; i++) {
    let items: any[]
    try {
      const page = await pdf.getPage(i)
      const textContent = await page.getTextContent()
      // Defensive: never iterate straight off the library's return value.
      items = Array.isArray(textContent?.items) ? textContent.items : Array.from(textContent?.items || [])
    } catch (err) {
      throw new PdfImportError(`read-page-${i}`, err)
    }

    if (items.length === 0) continue

    const paragraphs: string[] = []
    let currentParagraph = ''
    let lastY: number | null = null

    for (const item of items) {
      const str = (item && item.str) || ''
      if (!str.trim()) continue

      const y = item && item.transform ? item.transform[5] : null

      if (lastY !== null && y !== null) {
        // A Y gap > 5 units typically indicates a new line/paragraph.
        if (Math.abs(lastY - y) > 5) {
          if (currentParagraph.trim()) paragraphs.push(currentParagraph.trim())
          currentParagraph = str
        } else {
          currentParagraph += ' ' + str
        }
      } else {
        currentParagraph += (currentParagraph ? ' ' : '') + str
      }
      lastY = y
    }

    if (currentParagraph.trim()) paragraphs.push(currentParagraph.trim())

    for (const para of paragraphs) {
      const isHeading =
        (para.length < 100 && para === para.toUpperCase() && para.length > 3) ||
        /^(chapter|abstract|references|bibliography|table of contents)\b/i.test(para)

      // A leading dotted number: "1.0", "1.1", "1.2.3". The trailing dot is
      // required so a sentence opening with a bare year ("2024 saw ...") is not
      // mistaken for a heading.
      const numbering = para.match(/^\d+\.(?:\d+\.?)*(?=\s+\S)/)
      const isSectionHeading = numbering !== null && para.length < 120

      if (isHeading) {
        html += `<h1>${escapeHtml(para)}</h1>`
      } else if (isSectionHeading) {
        // Depth comes from the numeric prefix alone: 1.2 -> h2, 1.2.3 -> h3.
        const depth = numbering[0].replace(/\.$/, '').split('.').length
        const hTag = depth <= 2 ? 'h2' : 'h3'
        html += `<${hTag}>${escapeHtml(para)}</${hTag}>`
      } else {
        html += `<p>${escapeHtml(para)}</p>`
      }
    }
  }

  return html
}

/** PDF text is untrusted here — "<" in the source must not become markup. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export type DocumentKind = 'pdf' | 'docx' | 'txt' | 'unknown'

/**
 * Identifies an uploaded file by content first, then MIME type, then extension.
 *
 * Extension sniffing alone is unreliable on mobile: Android's document picker and
 * iOS Files/iCloud routinely deliver PDFs named without an extension, so a
 * `file.name.split('.').pop()` check silently rejects a perfectly valid PDF.
 */
export async function detectDocumentKind(file: File): Promise<DocumentKind> {
  // 1. Magic bytes — authoritative.
  try {
    const header = new Uint8Array(await file.slice(0, 4).arrayBuffer())
    if (header.length >= 4) {
      // "%PDF"
      if (header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46) {
        return 'pdf'
      }
      // "PK\x03\x04" — a zip container; .docx is the only zip format we accept.
      if (header[0] === 0x50 && header[1] === 0x4b && header[2] === 0x03 && header[3] === 0x04) {
        return 'docx'
      }
    }
  } catch {
    // Some providers refuse partial reads; fall through to the metadata checks.
  }

  // 2. MIME type reported by the picker.
  const mime = (file.type || '').toLowerCase()
  if (mime === 'application/pdf' || mime === 'application/x-pdf') return 'pdf'
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
  if (mime.startsWith('text/')) return 'txt'

  // 3. Filename extension.
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'pdf') return 'pdf'
  if (extension === 'docx') return 'docx'
  if (extension === 'txt' || extension === 'md') return 'txt'

  return 'unknown'
}

/**
 * `accept` value for document pickers. Android's picker filters on MIME type and
 * greys out otherwise-valid files when only extensions are listed, so both forms
 * are declared.
 */
export const DOCUMENT_ACCEPT =
  '.docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
