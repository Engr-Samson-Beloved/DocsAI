"use client"

/**
 * Document ingestion: the single path from "user hands us a file" to "we have
 * usable HTML".
 *
 * Before this module the pick-and-parse logic existed in three places inside the
 * editor (toolbar import, dashboard import, wizard source upload), each with
 * slightly different format support and error text, and each building its own
 * `<input type="file">` by hand. Consolidating it means a fix for a mobile
 * picker quirk lands everywhere at once.
 *
 * Parsing is deliberately separate from picking so callers that already hold a
 * File (drag-drop, a chat attachment) can reuse the same pipeline.
 */

import { extractPdfAsHtml, detectDocumentKind, DOCUMENT_ACCEPT } from './pdfLoader'

export type IngestKind = 'pdf' | 'docx' | 'txt'

export interface IngestedDocument {
  /** The file as handed over by the picker */
  file: File
  /** Original filename, extension included */
  name: string
  /** Filename with the extension stripped — a sensible document title */
  title: string
  kind: IngestKind
  /** Parsed content as HTML. Callers apply their own post-processing. */
  html: string
}

export type IngestFailure =
  | 'unsupported-format'
  | 'empty-pdf'
  | 'parse-failed'

/** Carries a message that is safe and useful to show the user directly. */
export class DocumentIngestError extends Error {
  reason: IngestFailure
  userMessage: string

  constructor(reason: IngestFailure, userMessage: string, cause?: unknown) {
    const detail = cause instanceof Error ? cause.message : cause ? String(cause) : ''
    super(detail ? `${userMessage} (${detail})` : userMessage)
    this.name = 'DocumentIngestError'
    this.reason = reason
    this.userMessage = userMessage
  }
}

/** Accept string covering everything ingestDocumentFile can actually parse. */
export const INGEST_ACCEPT = `${DOCUMENT_ACCEPT},.txt,text/plain`

export function stripExtension(filename: string): string {
  return filename.replace(/\.[^/.]+$/, '') || filename
}

/**
 * Opens the system file picker and resolves with the chosen file, or null if the
 * user dismissed it.
 *
 * The input element is always removed from the DOM, including on cancel — the
 * previous hand-rolled version only cleaned up in its change handler, so every
 * cancelled import leaked a detached input.
 */
export function pickDocumentFile(accept: string = INGEST_ACCEPT): Promise<File | null> {
  if (typeof document === 'undefined') {
    return Promise.resolve(null)
  }

  return new Promise<File | null>(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    document.body.appendChild(input)

    let settled = false
    const finish = (file: File | null) => {
      if (settled) return
      settled = true
      window.removeEventListener('focus', onWindowFocus)
      if (input.parentNode) input.parentNode.removeChild(input)
      resolve(file)
    }

    input.addEventListener('change', () => {
      finish(input.files && input.files[0] ? input.files[0] : null)
    })

    // Supported in current browsers; fires when the dialog is dismissed.
    input.addEventListener('cancel', () => finish(null))

    // Fallback for browsers without the cancel event: when the window regains
    // focus the dialog has closed, so give `change` a moment and then treat the
    // silence as a dismissal.
    const onWindowFocus = () => {
      setTimeout(() => {
        if (!settled && !(input.files && input.files.length)) finish(null)
      }, 500)
    }
    window.addEventListener('focus', onWindowFocus)

    input.click()
  })
}

/**
 * Parses a picked file into HTML.
 *
 * Format detection reads magic bytes first (see detectDocumentKind) because
 * mobile pickers routinely hand over extensionless files from cloud providers.
 */
export async function ingestDocumentFile(file: File): Promise<IngestedDocument> {
  const kind = await detectDocumentKind(file)

  const base = {
    file,
    name: file.name,
    title: stripExtension(file.name)
  }

  if (kind === 'docx') {
    try {
      const mammoth = await import('mammoth')
      const arrayBuffer = await file.arrayBuffer()
      const result = await mammoth.convertToHtml({ arrayBuffer })
      return { ...base, kind: 'docx', html: result.value }
    } catch (err) {
      throw new DocumentIngestError(
        'parse-failed',
        'This Word document could not be read. It may be corrupted or password protected.',
        err
      )
    }
  }

  if (kind === 'pdf') {
    let html: string
    try {
      html = await extractPdfAsHtml(file)
    } catch (err) {
      throw new DocumentIngestError(
        'parse-failed',
        'This PDF could not be read. Try re-saving it, or upload a .docx instead.',
        err
      )
    }

    if (!html.trim()) {
      throw new DocumentIngestError(
        'empty-pdf',
        'No text could be extracted from this PDF. Scanned or image-only PDFs are not supported — upload a text-based PDF or a .docx file.'
      )
    }

    return { ...base, kind: 'pdf', html }
  }

  if (kind === 'txt') {
    try {
      const text = await file.text()
      const html = text
        .split('\n')
        .filter(line => line.trim())
        .map(line => `<p>${escapeHtml(line)}</p>`)
        .join('')
      return { ...base, kind: 'txt', html }
    } catch (err) {
      throw new DocumentIngestError('parse-failed', 'This text file could not be read.', err)
    }
  }

  throw new DocumentIngestError(
    'unsupported-format',
    'Unsupported file type. Please upload a .pdf, .docx, or .txt document.'
  )
}

/** Convenience: pick then parse. Resolves null when the picker is dismissed. */
export async function pickAndIngestDocument(
  accept: string = INGEST_ACCEPT
): Promise<IngestedDocument | null> {
  const file = await pickDocumentFile(accept)
  if (!file) return null
  return ingestDocumentFile(file)
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
