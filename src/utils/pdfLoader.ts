"use client"

/**
 * Central PDF.js loader.
 *
 * The worker MUST be the exact same release as the pdfjs-dist API bundle, otherwise
 * pdf.js aborts with "The API version 'x' does not match the worker version 'y'".
 * Nothing here hardcodes a version number: the worker URL is always derived from the
 * package that was actually bundled, so upgrading pdfjs-dist can never desync it again.
 */

import { pageItemsToHtml, type RawTextItem } from './deck/pdfStructure'

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

/** Normalises a pdf.js TextItem into the plain shape pdfStructure consumes. */
function toRawItem(item: any): RawTextItem | null {
  const str = (item && item.str) || ''
  if (!str.trim()) return null

  const transform = item.transform || []
  return {
    str,
    x: typeof transform[4] === 'number' ? transform[4] : 0,
    y: typeof transform[5] === 'number' ? transform[5] : 0,
    width: typeof item.width === 'number' ? item.width : str.length * 4,
    // `height` is absent on some producers; the vertical scale in the transform
    // is the font size in those cases.
    height:
      typeof item.height === 'number' && item.height > 0
        ? item.height
        : Math.abs(typeof transform[3] === 'number' ? transform[3] : 10),
    fontName: item.fontName,
  }
}

/**
 * A cover page carries the report's identity block and none of its argument.
 * It is detected by content, not by page index, because some reports open with
 * a blank or a crest page.
 */
function looksLikeCoverPage(text: string): boolean {
  const t = text.toLowerCase()
  const signals = [
    /\bsubmitted (to|in partial)\b/,
    /\bin partial fulfil?lment\b/,
    /\bmatric(?:ulation)?\s*(?:no|number)\b/,
    /\bsupervis(?:or|ed by)\b/,
    /\bdepartment of\b/,
    /\bfaculty of\b/,
    /\bschool of\b/,
    /\bseminar (report|presentation)\b/,
  ]
  return signals.filter(re => re.test(t)).length >= 3
}

/**
 * Extracts a PDF's text as structured HTML (headings, paragraphs, lists, tables).
 *
 * Structure recovery lives in utils/deck/pdfStructure so it can be unit-tested
 * without pdf.js. This function is only the pdf.js adapter around it.
 *
 * The previous implementation started a new paragraph on any Y move greater
 * than 5 units. That is a new LINE, not a new paragraph, so every wrapped line
 * of prose became its own `<p>` and, eventually, its own slide bullet - the
 * root cause of the mid-sentence bullets in generated decks.
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

    const raw = items.map(toRawItem).filter((it): it is RawTextItem => it !== null)
    if (raw.length === 0) continue

    const pageHtml = pageItemsToHtml(raw, i)
    if (!pageHtml) continue

    // Pages are wrapped so the exporter can exclude the cover and contents
    // pages from the deck's content. Without the wrapper the cover's identity
    // block was parsed as body prose and could reach a slide.
    const plain = raw.map(it => it.str).join(' ')
    const isCover = i <= 2 && looksLikeCoverPage(plain)
    const isToc = /table\s+of\s+contents/i.test(plain) && /\.{4,}/.test(plain)

    const attrs =
      `data-type="page" data-page="${i}"` +
      (isCover ? ' data-cover="true"' : '') +
      (isToc ? ' data-toc="true"' : '')

    html += `<div ${attrs}>${pageHtml}</div>`
  }

  return html
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
