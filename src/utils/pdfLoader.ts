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
 * Opens a PDF and returns the loaded document.
 * Mobile pickers hand over files backed by cloud providers, so the bytes are read
 * up front rather than streamed through a URL the worker cannot reach.
 */
export async function loadPdfDocument(file: File | ArrayBuffer): Promise<any> {
  const pdfjs = await getPdfJs()
  const buffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer()
  return pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise
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
