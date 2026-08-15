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

/**
 * Maps Word style names onto HTML so structure comes from `styles.xml` rather
 * than being guessed from text patterns further down the pipeline.
 *
 * mammoth's default map already covers Heading 1-6, Title and Quote. The
 * additions here are the ones that were costing us fidelity:
 *
 *  - `toc N` entries are tagged so the importer can DROP them. They are Word's
 *    cached TOC field text: leader dots and stale page numbers baked into
 *    paragraphs. Re-flowing them produced the mangled
 *    "1.1Background of the Study.........41.2Problem Definition" output. The
 *    editor regenerates a real TOC from headings instead.
 *  - `Caption` is tagged so a figure/table caption can be kept on the same page
 *    as the thing it captions.
 *  - `List Paragraph` is tagged because Word uses it both for real numbered
 *    lists and for indented body text; the importer decides which.
 */
const DOCX_STYLE_MAP = [
  "p[style-name='Title'] => h1.doc-title:fresh",
  "p[style-name='Subtitle'] => p.doc-subtitle:fresh",
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Heading 4'] => h4:fresh",
  "p[style-name='Heading 5'] => h5:fresh",
  "p[style-name='Heading 6'] => h6:fresh",
  "p[style-name='TOC Heading'] => h1:fresh",
  // Word emits `toc 1`..`toc 9` for cached TOC field entries.
  ...Array.from({ length: 9 }, (_, i) => `p[style-name='toc ${i + 1}'] => p.docx-toc-entry:fresh`),
  "p[style-name='Caption'] => p.docx-caption:fresh",
  "p[style-name='Body Text'] => p:fresh",
  "p[style-name='List Paragraph'] => p.docx-list-paragraph:fresh",
  "p[style-name='Quote'] => blockquote:fresh",
  "p[style-name='Intense Quote'] => blockquote:fresh",
  "r[style-name='Hyperlink'] => a",
]

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
      const result = await mammoth.convertToHtml(
        { arrayBuffer },
        {
          styleMap: DOCX_STYLE_MAP,
          includeDefaultStyleMap: true,
          // Inline every embedded figure as a data: URI and carry the alt text
          // across. The editor schema now has an Image node to receive these.
          convertImage: mammoth.images.imgElement(async image => {
            const base64 = await image.read('base64')
            // `altText` is present at runtime but missing from mammoth's types.
            const alt = (image as { altText?: string }).altText || ''
            return { src: `data:${image.contentType};base64,${base64}`, alt }
          }),
        }
      )
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
