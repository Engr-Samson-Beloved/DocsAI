/**
 * Regression tests for the DOCX → PDF export audit.
 *
 * Every case here corresponds to a defect found in a shipped export of a
 * 22-page project report: 13 figures dropped, 6 tables flattened to prose,
 * blank and orphaned pages, a mangled table of contents, footer numbering that
 * did not match the physical page, unembedded fonts, and dead hyperlinks.
 *
 * The pure-logic tests exercise src/utils/pdfLayout.ts directly. The rest are
 * source-level assertions in the style of house-style.test.mts — the renderer
 * itself needs a DOM and a font server, so what is locked here is that the
 * fixes cannot be quietly reverted.
 *
 * Run: npm test
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const layout = () => import('../src/utils/pdfLayout.ts')

/**
 * Strips comments so a "we no longer do X" assertion cannot be tripped by a
 * comment explaining why X was wrong. The `[^:]` guard keeps `https://` intact.
 */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const editorSource = () => read('src/components/Editor/Editor.tsx')
const rendererSource = () => read('src/utils/reactPdf.tsx')
const rendererCode = () => codeOnly(rendererSource())
const ingestSource = () => read('src/utils/documentIngest.ts')
const routeSource = () => read('src/app/api/export/pdf/route.ts')

// --- Blank and orphaned pages ---------------------------------------
//
// The audited PDF had an empty page 2, a page 5 containing only a page number,
// and an empty page 23. All three came from page breaks landing next to each
// other with no content in between.

describe('page break planning', () => {
  it('drops a break at the start of the document', async () => {
    const { planPageBreaks } = await layout()
    assert.deepEqual(planPageBreaks(['break', 'content']), [1])
  })

  it('drops a trailing break so there is no empty final page', async () => {
    const { planPageBreaks } = await layout()
    assert.deepEqual(planPageBreaks(['content', 'break']), [0])
  })

  it('collapses two consecutive breaks into one', async () => {
    const { planPageBreaks } = await layout()
    assert.deepEqual(planPageBreaks(['content', 'break', 'break', 'content']), [0, 1, 3])
  })

  it('drops an explicit break before a heading that breaks anyway', async () => {
    // This is the exact shape that produced the blank pages: a `.page-break`
    // div immediately followed by a chapter heading carrying break={true}.
    const { planPageBreaks } = await layout()
    assert.deepEqual(planPageBreaks(['content', 'break', 'break-carrier', 'content']), [0, 2, 3])
  })

  it('keeps a break that genuinely separates content', async () => {
    const { planPageBreaks } = await layout()
    assert.deepEqual(planPageBreaks(['content', 'break', 'content']), [0, 1, 2])
  })

  it('never leaves a break as the only surviving node', async () => {
    const { planPageBreaks } = await layout()
    assert.deepEqual(planPageBreaks(['break']), [])
    assert.deepEqual(planPageBreaks(['break', 'break', 'break']), [])
  })

  it('leaves ordinary content untouched', async () => {
    const { planPageBreaks } = await layout()
    assert.deepEqual(planPageBreaks(['content', 'content', 'content']), [0, 1, 2])
  })
})

// --- Justification without hyphenation -------------------------------

describe('hyphenation', () => {
  it('splits a long word so justified text does not open rivers', async () => {
    const { hyphenateWord } = await layout()
    const parts = hyphenateWord('multimodal')
    assert.ok(parts.length > 1, `expected a split, got ${JSON.stringify(parts)}`)
    assert.equal(parts.join(''), 'multimodal', 'hyphenation must be lossless')
  })

  it('refuses to split short words', async () => {
    const { hyphenateWord } = await layout()
    for (const word of ['the', 'model', 'study', 'result']) {
      assert.deepEqual(hyphenateWord(word), [word], word)
    }
  })

  it('keeps at least three characters on each side of every break', async () => {
    const { hyphenateWord, MIN_HYPHEN_EDGE } = await layout()
    for (const word of ['classification', 'convolutional', 'representation', 'architecture']) {
      const parts = hyphenateWord(word)
      assert.equal(parts.join(''), word, `${word} round-trip`)
      assert.ok(parts[0].length >= MIN_HYPHEN_EDGE, `${word}: leading fragment too short`)
      assert.ok(
        parts[parts.length - 1].length >= MIN_HYPHEN_EDGE,
        `${word}: trailing fragment too short`
      )
    }
  })

  it('hyphenates a word carrying punctuation without losing it', async () => {
    const { hyphenateWord } = await layout()
    const parts = hyphenateWord('(evaluation),')
    assert.equal(parts.join(''), '(evaluation),')
  })

  it('leaves numbers and symbols alone', async () => {
    const { hyphenateWord } = await layout()
    assert.deepEqual(hyphenateWord('10.1109/ACCESS'), ['10.1109/ACCESS'])
  })
})

// --- Literal bullet glyphs -------------------------------------------

describe('list glyph handling', () => {
  it('strips the middot Word left in the text of a list paragraph', async () => {
    const { stripBulletGlyph } = await layout()
    // The audited PDF rendered "·The system shall accept..." verbatim.
    assert.equal(stripBulletGlyph('· The system shall accept'), 'The system shall accept')
    assert.equal(stripBulletGlyph('• Accuracy above 90%'), 'Accuracy above 90%')
  })

  it('leaves ordinary text and negative numbers alone', async () => {
    const { stripBulletGlyph } = await layout()
    assert.equal(stripBulletGlyph('The system shall accept'), 'The system shall accept')
    assert.equal(stripBulletGlyph('-0.42 correlation'), '-0.42 correlation')
  })
})

describe('caption detection', () => {
  it('recognises figure and table captions', async () => {
    const { looksLikeCaption } = await layout()
    assert.ok(looksLikeCaption('Figure 4.1: Confusion matrix for the unimodal model'))
    assert.ok(looksLikeCaption('Table 4.2: Comparative performance'))
    assert.ok(looksLikeCaption('Fig. 3.1 - System architecture'))
  })

  it('does not mistake body text for a caption', async () => {
    const { looksLikeCaption } = await layout()
    assert.ok(!looksLikeCaption('The table below summarises the results.'))
    assert.ok(!looksLikeCaption('Figures were produced with matplotlib.'))
  })
})

// --- Figures and tables reaching the exporter at all ------------------
//
// The 13 dropped figures and 6 flattened tables were never a renderer bug: the
// editor schema had no table or image node, so ProseMirror discarded them on
// setContent. A <table> collapsed into loose text, an <img> vanished outright.

describe('editor schema carries tables and figures', () => {
  it('registers the table nodes', () => {
    const src = editorSource()
    assert.match(src, /from '@tiptap\/extension-table'/, 'table extension is not imported')
    for (const node of ['Table', 'TableRow', 'TableHeader', 'TableCell']) {
      assert.match(
        src,
        new RegExp(`^\\s*${node}[,.]`, 'm'),
        `${node} is not registered in the extensions list`
      )
    }
  })

  it('registers the image node and allows data URIs', () => {
    const src = editorSource()
    assert.match(src, /from '@tiptap\/extension-image'/, 'image extension is not imported')
    assert.match(
      src,
      /Image\.configure\(\{[^}]*allowBase64:\s*true/,
      'mammoth inlines figures as data: URIs; without allowBase64 every one is stripped'
    )
  })

  it('declares both extensions as dependencies', () => {
    const pkg = JSON.parse(read('package.json'))
    assert.ok(pkg.dependencies['@tiptap/extension-table'], '@tiptap/extension-table missing')
    assert.ok(pkg.dependencies['@tiptap/extension-image'], '@tiptap/extension-image missing')
  })
})

// --- Ingest fidelity --------------------------------------------------

describe('docx ingest', () => {
  it('maps Word styles by name instead of leaving structure to be guessed', () => {
    const src = ingestSource()
    assert.match(src, /styleMap:\s*DOCX_STYLE_MAP/, 'the style map is not passed to mammoth')
    assert.match(src, /Heading 1'\] => h1/, 'Heading 1 is not mapped')
    assert.match(src, /toc \$\{i \+ 1\}'\] => p\.docx-toc-entry/, 'cached TOC entries are not tagged')
    assert.match(src, /Caption'\] => p\.docx-caption/, 'captions are not tagged')
  })

  it('inlines embedded images', () => {
    const src = ingestSource()
    assert.match(src, /convertImage/, 'images are not converted')
    assert.match(src, /data:\$\{image\.contentType\};base64/, 'images are not inlined as data URIs')
  })
})

describe('import cleaning no longer destroys structure', () => {
  it('drops the cached Word TOC rather than re-flowing it as paragraphs', () => {
    const src = editorSource()
    assert.match(
      src,
      /querySelectorAll\('p\.docx-toc-entry'\)\.forEach\(p => p\.remove\(\)\)/,
      "Word's cached TOC field text is still being re-flowed"
    )
  })

  it('does not guess headings when the parser already produced an outline', () => {
    const src = editorSource()
    assert.match(src, /const hasParsedOutline =/, 'the outline check is missing')
    assert.match(
      src,
      /if \(!hasParsedOutline\) body\.querySelectorAll\('p'\)\.forEach/,
      'heading promotion is not gated on the absence of a parsed outline'
    )
  })

  it('preserves inline markup when promoting a paragraph to a heading', () => {
    const src = editorSource()
    assert.match(
      src,
      /while \(p\.firstChild\) heading\.appendChild\(p\.firstChild\)/,
      'promotion still flattens the paragraph to text, discarding bold/italic/links'
    )
    assert.doesNotMatch(
      src,
      /heading\.textContent = text/,
      'the markup-destroying assignment is back'
    )
  })

  it('only strips page-number noise for PDF extraction', () => {
    const src = editorSource()
    // A .docx keeps running headers in headerN.xml, never in the body, so this
    // rule only ever deleted real content from Word imports.
    assert.match(src, /if \(kind === 'pdf'\) \{/, 'page-number stripping is not scoped to PDFs')
  })
})

// --- Renderer invariants ---------------------------------------------

describe('pdf renderer', () => {
  it('takes page geometry from the house style, not a hardcoded A4', () => {
    const src = rendererSource()
    assert.doesNotMatch(rendererCode(), /size="A4"/, 'page size is still hardcoded')
    assert.match(src, /REPORT_STYLE\.page\.widthIn/, 'width does not come from the spec')
    assert.match(src, /REPORT_STYLE\.page\.marginIn/, 'margins do not come from the spec')
    assert.match(src, /size=\{pageSize\}/, 'pages are not sized from the computed geometry')
  })

  it('accepts a source document geometry so a Letter page is not forced to A4', () => {
    const src = rendererSource()
    assert.match(src, /geometry\?:\s*PageGeometry/, 'no way to pass the source geometry in')
    assert.match(src, /opts\.geometry \|\| DEFAULT_GEOMETRY/, 'the passed geometry is ignored')
  })

  it('embeds a real font family instead of the unembeddable standard-14 aliases', () => {
    const src = rendererSource()
    assert.match(src, /Font\.register\(/, 'no font is registered')
    assert.match(src, /Tinos-Regular\.ttf/, 'the regular face is not registered')
    assert.match(src, /Tinos-BoldItalic\.ttf/, 'the bold-italic face is not registered')
    // Times-Roman/Times-Bold are PDF standard-14 names and can never be embedded.
    const code = rendererCode()
    assert.doesNotMatch(code, /'Times-Roman'/, 'the non-embeddable Times alias is back')
    assert.doesNotMatch(code, /'Times-Bold'/, 'the non-embeddable Times alias is back')
  })

  it('ships the font files it registers', () => {
    for (const face of ['Regular', 'Bold', 'Italic', 'BoldItalic']) {
      const path = join(ROOT, 'public', 'fonts', `Tinos-${face}.ttf`)
      assert.ok(existsSync(path), `public/fonts/Tinos-${face}.ttf is missing`)
      assert.ok(statSync(path).size > 10_000, `Tinos-${face}.ttf looks truncated`)
    }
  })

  it('fails loudly rather than silently substituting a font', () => {
    const src = rendererSource()
    assert.match(src, /async function ensureFonts/, 'there is no font preflight')
    assert.match(src, /throw new Error\(/, 'a missing font does not stop the export')
  })

  it('names a font family on every page-chrome element', () => {
    const src = rendererSource()
    // Anything without an explicit family inherits @react-pdf's Helvetica —
    // which is how Helvetica appeared in a document that is entirely Times.
    assert.match(
      src,
      /const chromeStyle = \{ fontFamily: BODY_FONT/,
      'header/footer/page-number styles do not pin a font family'
    )
  })

  it('numbers pages by physical position', () => {
    const src = rendererSource()
    // The sub-page counter runs within a single auto-paginating <Page>, so it
    // restarted at 1 after the cover and TOC — the footer read "1" on the
    // fifth physical sheet and every TOC reference pointed at the wrong page.
    assert.doesNotMatch(
      rendererCode(),
      /subPageNumber/,
      'numbering is still relative to the content Page'
    )
    assert.match(src, /render=\{\(\{ pageNumber \}/, 'the footer does not use the physical page')
  })

  it('emits real link annotations', () => {
    const src = rendererSource()
    assert.match(src, /\bLink\b.*from '@react-pdf\/renderer'/s, 'Link is not imported')
    assert.match(src, /<Link\s/, 'links are never rendered')
    assert.match(src, /tag === 'a'/, '<a> elements are not handled')
  })

  it('lets a long table split between rows instead of clipping it', () => {
    const src = rendererSource()
    // wrap={false} on the whole table meant anything taller than a page was
    // simply cut off. It belongs on the row.
    assert.match(
      src,
      /flexDirection: 'row' \}\} wrap=\{false\}/,
      'rows are not protected from splitting'
    )
    assert.match(src, /minPresenceAhead=\{60\}/, 'a table header can be stranded at a page foot')
  })

  it('honours declared column widths and colspan', () => {
    const src = rendererSource()
    assert.match(src, /colgroup > col/, 'grid column widths are ignored')
    assert.match(src, /getAttribute\('colspan'\)/, 'merged cells are ignored')
  })

  it('keeps headings with the text that follows them', () => {
    const src = rendererSource()
    assert.match(src, /minPresenceAhead=\{72\}/, 'a heading can still be the last line on a page')
  })

  it('applies widow and orphan control to body paragraphs', () => {
    const src = rendererSource()
    assert.match(src, /orphans=\{2\}/, 'orphan control is missing')
    assert.match(src, /widows=\{2\}/, 'widow control is missing')
  })

  it('does not emit a spacer view for an empty paragraph', () => {
    // A 12pt spacer was enough on its own to hold a page open.
    assert.doesNotMatch(
      rendererCode(),
      /style=\{\{ height: 12 \}\}/,
      'empty paragraphs still materialise as spacer views'
    )
  })

  it('draws TOC leaders as a rule, never as literal dots', () => {
    const src = rendererSource()
    assert.match(src, /borderBottomStyle: 'dotted'/, 'the leader is not drawn as a border')
  })
})

// --- True-fidelity conversion ----------------------------------------

describe('libreoffice conversion path', () => {
  it('exposes an availability probe and a conversion endpoint', () => {
    const src = routeSource()
    assert.match(src, /export async function GET/, 'there is no availability probe')
    assert.match(src, /export async function POST/, 'there is no conversion endpoint')
    assert.match(src, /forms\/libreoffice\/convert/, 'the converter is not called')
  })

  it('reports unavailable instead of failing when unconfigured', () => {
    const src = routeSource()
    assert.match(src, /DOCX_CONVERTER_URL/, 'the service URL is not configurable')
    assert.match(src, /status: 501/, 'an unconfigured deployment does not say so clearly')
  })

  it('runs on the node runtime, since soffice is a binary', () => {
    const src = routeSource()
    assert.match(src, /export const runtime = 'nodejs'/, 'the route is not on the node runtime')
  })

  it('retains the original upload so it can be converted later', () => {
    const src = editorSource()
    assert.match(src, /saveOriginalUpload\(\{/, 'the uploaded file is discarded at import')
    assert.match(src, /decideExportPath\(/, 'export never considers converting the original')
  })

  it('stands down as soon as the document is edited', () => {
    const src = editorSource()
    assert.match(
      src,
      /pristineImportRef\.current = null/,
      'an edited document could still be exported from stale original bytes'
    )
  })

  it('falls back to the renderer when conversion fails', () => {
    const src = editorSource()
    assert.match(
      src,
      /Faithful conversion failed, falling back to render/,
      'a converter outage would lose the user their export'
    )
  })
})
