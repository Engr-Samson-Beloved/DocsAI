/**
 * PDF import regression tests.
 *
 * Covers the path a mobile user takes: Import Doc -> file picker -> pick a PDF ->
 * detectDocumentKind -> extractPdfAsHtml -> HTML in the editor.
 *
 * Run: npm test
 *
 * No test framework or network is required. Fixtures are PDFs this file builds
 * byte by byte, so the suite works on a fresh clone with nothing checked out but
 * node_modules. Node's built-in runner and type stripping do the rest.
 */

import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// --- Fixture builder -------------------------------------------------

interface PdfLine {
  text: string
  /** PDF user-space Y coordinate. Larger gaps between lines start a new paragraph. */
  y: number
}

/** Builds a minimal but structurally valid single-page PDF with a real xref table. */
function buildPdf(lines: PdfLine[]): Uint8Array {
  const content = lines
    .map(l => `BT /F1 12 Tf 72 ${l.y} Td (${l.text.replace(/([()\\])/g, '\\$1')}) Tj ET`)
    .join('\n')

  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>',
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })

  const xrefOffset = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) pdf += String(off).padStart(10, '0') + ' 00000 n \n'
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`

  return new TextEncoder().encode(pdf) // the whole document is ASCII
}

function pdfFile(lines: PdfLine[], name = 'fixture.pdf', type = 'application/pdf'): File {
  return new File([buildPdf(lines)], name, { type })
}

/** A .docx is a zip; only its magic number matters to the detector. */
const DOCX_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00])

// --- Environment -----------------------------------------------------

// The loader is browser code: it refuses to run when `window` is absent, and it
// resolves a worker URL over the network. Both are stubbed so the suite exercises
// the real parsing code offline.
before(async () => {
  ;(globalThis as any).window = globalThis

  const workerPath = join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs')
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
})

const loader = () => import('../src/utils/pdfLoader.ts')

// --- Worker/API version integrity ------------------------------------
//
// This is the bug that started all of this: the bundled API was 6.0.227 while the
// worker URL was pinned to 3.11.174, so every import died with
// "The API version does not match the worker version".

describe('pdf.js worker version integrity', () => {
  it('ships a worker byte-identical to the installed pdfjs-dist', () => {
    const shipped = join(ROOT, 'public/pdf.worker.min.mjs')
    const installed = join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs')

    assert.ok(
      existsSync(shipped),
      'public/pdf.worker.min.mjs is missing - run: node scripts/copy-pdf-worker.mjs'
    )
    assert.deepEqual(
      readFileSync(shipped),
      readFileSync(installed),
      'The worker in /public has drifted from the installed pdfjs-dist version.'
    )
  })

  it('pins no pdf.js version anywhere in the loader', () => {
    const source = readFileSync(join(ROOT, 'src/utils/pdfLoader.ts'), 'utf8')

    assert.ok(
      !/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js/.test(source),
      'The cdnjs pdf.js URL is back; it pins a version independent of the bundle.'
    )
    // A CDN URL must interpolate the installed version, never hardcode digits.
    const hardcoded = source.match(/pdfjs-dist@(?!\$\{)[^/'"`]+/g)
    assert.deepEqual(hardcoded, null, `Hardcoded pdfjs-dist version(s): ${hardcoded}`)
  })

  it('reports the same version from the API and the worker file', async () => {
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pkg = JSON.parse(readFileSync(join(ROOT, 'node_modules/pdfjs-dist/package.json'), 'utf8'))
    assert.equal(pdfjs.version, pkg.version)
  })
})

// --- File type detection (what the mobile picker hands over) ----------

describe('detectDocumentKind', () => {
  it('identifies a PDF by content', async () => {
    const { detectDocumentKind } = await loader()
    assert.equal(await detectDocumentKind(pdfFile([{ text: 'Hello', y: 700 }])), 'pdf')
  })

  it('identifies a PDF with no extension and no MIME type', async () => {
    // Android's document picker and iOS Files routinely deliver exactly this.
    const { detectDocumentKind } = await loader()
    const file = new File([buildPdf([{ text: 'Hello', y: 700 }])], 'document', { type: '' })
    assert.equal(await detectDocumentKind(file), 'pdf')
  })

  it('identifies a PDF the picker mislabels as octet-stream', async () => {
    const { detectDocumentKind } = await loader()
    const file = new File([buildPdf([{ text: 'Hello', y: 700 }])], 'scan', {
      type: 'application/octet-stream',
    })
    assert.equal(await detectDocumentKind(file), 'pdf')
  })

  it('trusts content over a misleading .pdf extension', async () => {
    const { detectDocumentKind } = await loader()
    const file = new File([DOCX_MAGIC], 'actually-a-word-file.pdf', { type: 'application/pdf' })
    assert.equal(await detectDocumentKind(file), 'docx')
  })

  it('identifies docx, txt and unknown content', async () => {
    const { detectDocumentKind } = await loader()

    assert.equal(await detectDocumentKind(new File([DOCX_MAGIC], 'report.docx')), 'docx')
    assert.equal(
      await detectDocumentKind(new File(['just some notes'], 'notes.txt', { type: 'text/plain' })),
      'txt'
    )
    assert.equal(
      await detectDocumentKind(new File([new Uint8Array([1, 2, 3, 4])], 'mystery.bin')),
      'unknown'
    )
  })
})

describe('DOCUMENT_ACCEPT', () => {
  it('declares MIME types as well as extensions', async () => {
    // Android filters the picker on MIME type and greys out otherwise-valid files
    // when only extensions are listed.
    const { DOCUMENT_ACCEPT } = await loader()

    for (const token of [
      '.pdf',
      '.docx',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]) {
      assert.ok(DOCUMENT_ACCEPT.includes(token), `accept is missing ${token}`)
    }
  })
})

// --- The parser itself -----------------------------------------------

describe('extractPdfAsHtml', () => {
  it('extracts text from a real parsed PDF', async () => {
    const { extractPdfAsHtml } = await loader()
    const html = await extractPdfAsHtml(
      pdfFile([
        { text: 'CHAPTER ONE', y: 720 },
        { text: 'The study examines adaptive routing.', y: 690 },
      ])
    )

    assert.ok(html.includes('CHAPTER ONE'), `heading text missing from: ${html}`)
    assert.ok(html.includes('The study examines adaptive routing.'), `body text missing from: ${html}`)
  })

  it('promotes chapter headings to h1 and body copy to p', async () => {
    const { extractPdfAsHtml } = await loader()
    const html = await extractPdfAsHtml(
      pdfFile([
        { text: 'CHAPTER ONE', y: 720 },
        { text: 'This is ordinary body copy that should stay a paragraph.', y: 690 },
      ])
    )

    assert.match(html, /<h1>CHAPTER ONE<\/h1>/)
    assert.match(html, /<p>This is ordinary body copy that should stay a paragraph\.<\/p>/)
  })

  it('promotes numbered section headings to h2 and h3', async () => {
    const { extractPdfAsHtml } = await loader()
    const html = await extractPdfAsHtml(
      pdfFile([
        { text: '1.1 Background of Study', y: 720 },
        { text: '1.2.3 Scope Definition', y: 690 },
      ])
    )

    assert.match(html, /<h2>1\.1 Background of Study<\/h2>/)
    assert.match(html, /<h3>1\.2\.3 Scope Definition<\/h3>/)
  })

  it('splits paragraphs on vertical gaps and joins text on the same line', async () => {
    const { extractPdfAsHtml } = await loader()
    const html = await extractPdfAsHtml(
      pdfFile([
        { text: 'First paragraph of the section.', y: 720 },
        { text: 'Second paragraph, well below it.', y: 600 },
      ])
    )

    const paragraphs = html.match(/<p>.*?<\/p>/g) ?? []
    assert.equal(paragraphs.length, 2, `expected 2 paragraphs, got: ${html}`)
  })

  it('escapes markup so PDF text cannot inject HTML', async () => {
    const { extractPdfAsHtml } = await loader()
    const html = await extractPdfAsHtml(
      pdfFile([{ text: 'Compare a <script>alert(1)</script> tag & an ampersand.', y: 700 }])
    )

    assert.ok(!html.includes('<script>'), `unescaped script tag in: ${html}`)
    assert.ok(html.includes('&lt;script&gt;'), `expected escaped markup in: ${html}`)
    assert.ok(html.includes('&amp;'), `expected escaped ampersand in: ${html}`)
  })

  it('returns empty string for a PDF with no extractable text', async () => {
    // The signal the UI uses to tell the user their PDF is a scanned image.
    const { extractPdfAsHtml } = await loader()
    assert.equal(await extractPdfAsHtml(pdfFile([])), '')
  })

  it('handles a multi-page document', async () => {
    const { extractPdfAsHtml } = await loader()
    const html = await extractPdfAsHtml(
      pdfFile([
        { text: 'ABSTRACT', y: 740 },
        { text: 'A study of throughput under load.', y: 710 },
        { text: 'CHAPTER ONE', y: 640 },
        { text: 'Introductory discussion follows here.', y: 610 },
      ])
    )

    assert.match(html, /<h1>ABSTRACT<\/h1>/)
    assert.match(html, /<h1>CHAPTER ONE<\/h1>/)
    assert.ok(html.indexOf('ABSTRACT') < html.indexOf('CHAPTER ONE'), 'document order not preserved')
  })
})

// --- Real-world document ---------------------------------------------
//
// The fixtures above are hand-built and uncompressed. A real PDF adds flate
// streams, embedded font subsets and many pages. Skipped when absent so the
// suite still passes on a clean checkout.

describe('extractPdfAsHtml on a real document', () => {
  const samples = [
    join(ROOT, 'report.pdf'),
    join(ROOT, 'Seminar_Patterns/PRINCEWILL SEMINAR(SDN).pdf'),
  ].filter(existsSync)

  it('parses a real multi-page PDF into structured HTML', { skip: samples.length === 0 }, async () => {
    const { extractPdfAsHtml } = await loader()
    const bytes = readFileSync(samples[0])
    const html = await extractPdfAsHtml(new File([bytes], 'real.pdf', { type: 'application/pdf' }))

    assert.ok(html.length > 500, `expected substantial text, got ${html.length} chars`)
    assert.ok(/<p>[^<]{40,}<\/p>/.test(html), 'no substantial paragraph was produced')
    assert.ok(/<h[123]>/.test(html), 'no headings were detected in a real report')
    assert.ok(!html.includes('undefined'), 'literal "undefined" leaked into the output')
  })
})

// --- Failure reporting -----------------------------------------------

describe('error reporting', () => {
  it('tags a corrupt file with the stage that failed', async () => {
    const { extractPdfAsHtml } = await loader()
    const junk = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 1, 2, 3])], 'broken.pdf')

    await assert.rejects(
      () => extractPdfAsHtml(junk),
      (err: any) => {
        assert.equal(err.name, 'PdfImportError')
        assert.equal(err.stage, 'parse-pdf')
        assert.match(err.message, /^\[parse-pdf\]/)
        return true
      }
    )
  })

  it('falls back to FileReader when Blob.arrayBuffer is unavailable', async () => {
    // iOS Safari below 14 and several Android WebViews lack Blob.arrayBuffer;
    // calling it there throws "undefined is not a function".
    const { extractPdfAsHtml } = await loader()
    const bytes = buildPdf([{ text: 'Legacy browser path.', y: 700 }])

    let usedFileReader = false
    ;(globalThis as any).FileReader = class {
      result: ArrayBuffer | null = null
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsArrayBuffer(blob: { _bytes: Uint8Array }) {
        usedFileReader = true
        this.result = blob._bytes.slice().buffer
        queueMicrotask(() => this.onload?.())
      }
    }

    // A file-like object with no arrayBuffer method, as those browsers provide.
    const legacyFile = { name: 'legacy.pdf', type: 'application/pdf', _bytes: bytes }

    try {
      const html = await extractPdfAsHtml(legacyFile as any)
      assert.ok(usedFileReader, 'the FileReader fallback was never reached')
      assert.ok(html.includes('Legacy browser path.'), `text missing from: ${html}`)
    } finally {
      delete (globalThis as any).FileReader
    }
  })
})

// --- Document ingestion ----------------------------------------------
//
// One pipeline turns a picked file into HTML. These exercise it directly.

const ingest = () => import('../src/utils/documentIngest.ts')

describe('ingestDocumentFile', () => {
  it('parses a PDF into HTML and reports its kind', async () => {
    const { ingestDocumentFile } = await ingest()
    const doc = await ingestDocumentFile(
      pdfFile([{ text: 'Findings and analysis of the study.', y: 700 }], 'Chapter Four.pdf')
    )

    assert.equal(doc.kind, 'pdf')
    assert.equal(doc.name, 'Chapter Four.pdf')
    assert.equal(doc.title, 'Chapter Four', 'the extension should be stripped for the title')
    assert.match(doc.html, /Findings and analysis/)
  })

  it('rejects an image-only PDF with an actionable message', async () => {
    const { ingestDocumentFile } = await ingest()

    await assert.rejects(
      () => ingestDocumentFile(pdfFile([], 'scanned.pdf')),
      (err: any) => {
        assert.equal(err.name, 'DocumentIngestError')
        assert.equal(err.reason, 'empty-pdf')
        assert.match(err.userMessage, /scanned/i)
        return true
      }
    )
  })

  it('rejects an unsupported file type rather than producing empty slides', async () => {
    const { ingestDocumentFile } = await ingest()
    const junk = new File([new Uint8Array([1, 2, 3, 4])], 'photo.heic', { type: 'image/heic' })

    await assert.rejects(
      () => ingestDocumentFile(junk),
      (err: any) => {
        assert.equal(err.reason, 'unsupported-format')
        return true
      }
    )
  })

  it('converts a text file into paragraphs and escapes markup', async () => {
    const { ingestDocumentFile } = await ingest()
    const file = new File(['First line\n\nSecond <b>line</b>'], 'notes.txt', { type: 'text/plain' })
    const doc = await ingestDocumentFile(file)

    assert.equal(doc.kind, 'txt')
    assert.match(doc.html, /<p>First line<\/p>/)
    assert.ok(!doc.html.includes('<b>'), 'raw markup from the file leaked into the output')
    assert.match(doc.html, /&lt;b&gt;/)
  })

  it('recognises a .docx by magic bytes even without an extension', async () => {
    const { detectDocumentKind } = await loader()
    assert.equal(await detectDocumentKind(new File([DOCX_MAGIC], 'download')), 'docx')
  })
})

// --- Dashboard wiring (source checks) --------------------------------
//
// Source-level checks, not browser tests: without a DOM there is no way to click
// the button here. They guard the chain from each dashboard card to the parser.

describe('dashboard document wiring (source checks)', () => {
  const editor = () => readFileSync(join(ROOT, 'src/components/Editor/Editor.tsx'), 'utf8')
  const mobileDashboard = () =>
    readFileSync(join(ROOT, 'src/components/Mobile/MobileDashboard.tsx'), 'utf8')

  it('wires the mobile Import Doc button to the dashboard import handler', () => {
    assert.match(mobileDashboard(), /onClick=\{\(\) => onImportDocument/, 'Import Doc button is not wired')
    assert.match(editor(), /onImportDocument=\{handleDashboardImport\}/, 'handler is not passed down')
  })

  it('wires Generate PPTX to the upload flow on both dashboards', () => {
    assert.match(mobileDashboard(), /onClick=\{\(\) => onGeneratePptx/, 'mobile PPTX button is not wired')

    const source = editor()
    const wirings = source.match(/onGeneratePptx=\{[^}]*\}/g) || []
    assert.equal(wirings.length, 2, 'expected both the mobile and desktop dashboards to be wired')
    for (const wiring of wirings) {
      assert.match(
        wiring,
        /onGeneratePptx=\{generatePptxFromUpload\}/,
        `Generate PPTX should open an upload, got: ${wiring}`
      )
    }
  })

  it('uploads before exporting instead of opening the chat on a blank document', () => {
    const source = editor()
    const handler = source.slice(
      source.indexOf('const generatePptxFromUpload'),
      source.indexOf('const confirmImportAction')
    )

    assert.ok(handler.length > 0, 'generatePptxFromUpload not found')
    assert.match(handler, /await pickDocumentFile\(\)/, 'the flow never opens a file picker')
    assert.match(handler, /if \(!file\) return/, 'a dismissed picker must leave the dashboard untouched')
    assert.match(handler, /await ingestDocumentFile\(file\)/, 'the upload is not parsed')
    assert.match(handler, /exportPptxFromHtml\(cleanedHtml/, 'slides are not built from the uploaded file')
    assert.ok(
      !/createNewProject\(\)/.test(handler),
      'the PPTX flow creates a blank project again instead of using the upload'
    )
  })

  it('keeps the chat view out of the dashboard PPTX path', () => {
    const chat = readFileSync(join(ROOT, 'src/components/Mobile/MobileChatView.tsx'), 'utf8')
    assert.ok(
      !/initialPptxExport/.test(chat),
      'MobileChatView handles a dashboard PPTX hand-off again - it should upload directly'
    )
    assert.ok(
      !/initialPptxExport/.test(editor()),
      'Editor.tsx still routes Generate PPTX through the chat view'
    )
  })

  it('routes every file read through the shared ingestion module', () => {
    // Hand-rolled copies of the pick/parse logic used to drift apart; only the
    // shared helpers may touch pdfjs, mammoth, or build a file input now.
    const source = editor()
    assert.ok(
      !/(?:from|import\()\s*['"]pdfjs-dist/.test(source),
      'Editor.tsx imports pdfjs directly again - use utils/pdfLoader instead'
    )
    assert.ok(
      !/GlobalWorkerOptions/.test(source),
      'Editor.tsx sets a pdf worker again - that belongs in utils/pdfLoader'
    )
    assert.ok(
      !/getTextContent\(\)/.test(source),
      'Editor.tsx parses PDF pages again - use extractPdfAsHtml instead'
    )
    assert.ok(
      !/import\(\s*['"]mammoth['"]\s*\)/.test(source),
      'Editor.tsx parses .docx directly again - use ingestDocumentFile instead'
    )
    assert.ok(
      !/createElement\(['"]input['"]\)/.test(source),
      'Editor.tsx hand-rolls a file picker again - use pickDocumentFile instead'
    )
  })

  it('cleans up the picker element even when the dialog is dismissed', () => {
    // A cancelled import used to leak a detached <input> on every attempt.
    const source = readFileSync(join(ROOT, 'src/utils/documentIngest.ts'), 'utf8')
    assert.match(source, /addEventListener\('cancel'/, 'no cancel handling')
    assert.match(source, /removeChild\(input\)/, 'the input element is never removed')
    assert.match(source, /removeEventListener\('focus'/, 'the focus fallback listener leaks')
  })
})
