/**
 * qa_deck.mts
 * ------------------------------------------------------------------
 * The validation gate. Runs after every generation and fails the job on any
 * error.
 *
 * It validates the RENDER REPORT - the shape-level record the renderer emits as
 * it draws - rather than re-deriving what the geometry ought to be. That
 * distinction matters: the defect that shipped was a mismatch between what the
 * code believed it was drawing and what actually landed on the canvas, and only
 * a check on real emitted shapes can catch that class of bug.
 *
 * Usage
 *   Programmatic: `runStaticChecks(report, plan, spec)` -> QaFinding[]
 *   CLI:          node --import ./tests/ts-resolve.mjs scripts/qa_deck.mts <deck.pptx> <report.json>
 *
 * Visual checks (soffice + pdftoppm) are opt-in via --visual and skip cleanly
 * when the binaries are absent, so the gate still runs in environments without
 * LibreOffice installed.
 */

import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { inflateRawSync } from 'node:zlib'
import { join, dirname, basename } from 'node:path'

import type { RenderReport, RenderedShape } from '../src/utils/deck/deckRenderer.ts'
import { shapeFillRatio } from '../src/utils/deck/deckRenderer.ts'
import type { SlidePlan } from '../src/utils/deck/slidePlan.ts'
import { eyebrowMismatch } from '../src/utils/deck/slidePlan.ts'
import type { PresentationSpec } from '../src/utils/deck/presentationSpec.ts'
import { contrastRatio, DEFAULT_SPEC } from '../src/utils/deck/presentationSpec.ts'
import { canvasViolation, EDGE_CLEARANCE, SLIDE_W, SLIDE_H, FILL_LIMIT } from '../src/utils/deck/layout.ts'
import { wordCount } from '../src/utils/deck/textNormalize.ts'

// --- Findings ----------------------------------------------------------

export interface QaFinding {
  check: string
  severity: 'error' | 'warning'
  slide?: number
  message: string
}

const err = (check: string, message: string, slide?: number): QaFinding => ({
  check, severity: 'error', message, slide,
})
const warn = (check: string, message: string, slide?: number): QaFinding => ({
  check, severity: 'warning', message, slide,
})

/** Layouts whose text is chrome or citation rather than a bulleted claim. */
const NON_CLAIM_SHAPES = new Set([
  'eyebrow', 'title', 'counter', 'footer', 'deck-title', 'deck-identity',
  'closing-title', 'closing-detail', 'references-list', 'body-table',
  'table-caption', 'stat-value',
])

// --- 1. Off-canvas ------------------------------------------------------

function checkOffCanvas(report: RenderReport): QaFinding[] {
  const findings: QaFinding[] = []

  if (report.slideW !== SLIDE_W || report.slideH !== SLIDE_H) {
    findings.push(
      err('off-canvas', `deck canvas is ${report.slideW} x ${report.slideH}in; expected ${SLIDE_W} x ${SLIDE_H}in`)
    )
  }

  for (const shape of report.shapes) {
    const violation = canvasViolation(shape.box)
    if (violation) {
      findings.push(err('off-canvas', `"${shape.name}" ${violation}`, shape.slide))
      continue
    }

    // Text must additionally keep clear of the trim so nothing reads as clipped.
    if (shape.kind !== 'text') continue
    const { x, y, w, h } = shape.box
    const gaps: [string, number][] = [
      ['left', x],
      ['top', y],
      ['right', SLIDE_W - (x + w)],
      ['bottom', SLIDE_H - (y + h)],
    ]
    for (const [edge, gap] of gaps) {
      if (gap < EDGE_CLEARANCE - 1e-6) {
        findings.push(
          err('edge-clearance', `"${shape.name}" is ${gap.toFixed(2)}in from the ${edge} edge (minimum ${EDGE_CLEARANCE}in)`, shape.slide)
        )
      }
    }
  }

  return findings
}

// --- 2. Overflow --------------------------------------------------------

function checkOverflow(report: RenderReport): QaFinding[] {
  const findings: QaFinding[] = []

  for (const shape of report.shapes) {
    if (shape.kind !== 'text') continue
    const ratio = shapeFillRatio(shape)
    if (ratio > FILL_LIMIT) {
      findings.push(
        err(
          'overflow',
          `"${shape.name}" text is an estimated ${(ratio * 100).toFixed(0)}% of its box height ` +
            `(limit ${(FILL_LIMIT * 100).toFixed(0)}%)`,
          shape.slide
        )
      )
    }
  }

  return findings
}

// --- 3. Bullet hygiene --------------------------------------------------

function checkBulletHygiene(report: RenderReport): QaFinding[] {
  const findings: QaFinding[] = []

  for (const shape of report.shapes) {
    if (shape.kind === 'shape') continue

    for (const paragraph of shape.paragraphs) {
      if (!paragraph.trim()) {
        findings.push(err('bullet-hygiene', `"${shape.name}" contains an empty paragraph`, shape.slide))
      }
      if (/[\r\n]/.test(paragraph)) {
        findings.push(
          err('bullet-hygiene', `"${shape.name}" has a newline inside a run: ${JSON.stringify(paragraph.slice(0, 50))}`, shape.slide)
        )
      }
      if (/[•‣▶▸]/.test(paragraph)) {
        findings.push(
          err('bullet-hygiene', `"${shape.name}" contains a literal bullet glyph; use the paragraph bullet property`, shape.slide)
        )
      }
    }

    if (/[\r\n]/.test(shape.text)) {
      findings.push(err('bullet-hygiene', `"${shape.name}" flattened text still holds a newline`, shape.slide))
    }
  }

  return findings
}

// --- 4 & 5. Bullet length and fragments --------------------------------

function checkBulletContent(report: RenderReport, spec: PresentationSpec): QaFinding[] {
  const findings: QaFinding[] = []

  for (const shape of report.shapes) {
    if (shape.kind !== 'text' || !shape.isBulletList) continue
    if (NON_CLAIM_SHAPES.has(shape.name)) continue

    if (shape.paragraphs.length > spec.deck.maxBulletsPerSlide) {
      findings.push(
        err('bullet-count', `"${shape.name}" has ${shape.paragraphs.length} bullets (maximum ${spec.deck.maxBulletsPerSlide})`, shape.slide)
      )
    }

    for (const bullet of shape.paragraphs) {
      const words = wordCount(bullet)
      if (words > spec.deck.maxWordsPerBullet) {
        findings.push(
          err('bullet-length', `${words}-word bullet exceeds ${spec.deck.maxWordsPerBullet}: "${bullet.slice(0, 60)}..."`, shape.slide)
        )
      }
      if (/^[a-z]/.test(bullet.trim())) {
        findings.push(err('fragment', `bullet starts lowercase: "${bullet.slice(0, 60)}"`, shape.slide))
      }
      if (/[,;\-–—]$/.test(bullet.trim())) {
        findings.push(err('fragment', `bullet ends mid-thought: "${bullet.slice(-40)}"`, shape.slide))
      }
    }
  }

  return findings
}

// --- 6. Spec compliance -------------------------------------------------

function rangeFor(shape: RenderedShape, spec: PresentationSpec) {
  switch (shape.role) {
    case 'title': return { name: 'title', range: spec.type.title }
    case 'heading': return { name: 'section heading', range: spec.type.sectionHeading }
    case 'caption': return { name: 'caption', range: spec.type.caption }
    case 'display': return { name: 'display', range: { minPt: spec.type.title.minPt, maxPt: 96 } }
    default: return { name: 'body', range: spec.type.body }
  }
}

function checkSpecCompliance(report: RenderReport, spec: PresentationSpec): QaFinding[] {
  const findings: QaFinding[] = []
  const allowed = new Set(spec.fontAllowList.map(f => f.toLowerCase()))

  for (const shape of report.shapes) {
    if (shape.kind === 'shape') continue

    if (shape.fontFace && !allowed.has(shape.fontFace.toLowerCase())) {
      findings.push(
        err('font', `"${shape.name}" uses "${shape.fontFace}", which is not in the allow-list (${spec.fontAllowList.join(', ')})`, shape.slide)
      )
    }

    const { name, range } = rangeFor(shape, spec)
    if (shape.fontPt > 0 && (shape.fontPt < range.minPt || shape.fontPt > range.maxPt)) {
      findings.push(
        err('type-scale', `"${shape.name}" is ${shape.fontPt}pt; the ${name} range is ${range.minPt}-${range.maxPt}pt`, shape.slide)
      )
    }

    if (shape.fontPt > 0 && shape.role === 'body' && shape.fontPt < spec.type.bodyAbsoluteMinPt) {
      findings.push(
        err('type-scale', `"${shape.name}" is ${shape.fontPt}pt, below the ${spec.type.bodyAbsoluteMinPt}pt absolute floor`, shape.slide)
      )
    }

    if (shape.color && shape.background) {
      const ratio = contrastRatio(shape.color, shape.background)
      if (Number.isNaN(ratio)) {
        findings.push(err('contrast', `"${shape.name}" has an unreadable colour pair (${shape.color} on ${shape.background})`, shape.slide))
      } else if (ratio < spec.minContrast) {
        findings.push(
          err('contrast', `"${shape.name}" is ${ratio.toFixed(2)}:1 (${shape.color} on ${shape.background}); minimum is ${spec.minContrast}:1`, shape.slide)
        )
      }
    }
  }

  return findings
}

// --- 7. Placeholders ----------------------------------------------------

function checkPlaceholders(report: RenderReport, spec: PresentationSpec): QaFinding[] {
  const findings: QaFinding[] = []
  const banned = [...spec.bannedStrings, 'lorem', 'todo', '[insert', 'xxx']

  for (const shape of report.shapes) {
    const haystack = shape.text.toLowerCase()
    for (const needle of banned) {
      if (haystack.includes(needle.toLowerCase())) {
        findings.push(
          err('placeholder', `"${shape.name}" contains the banned string "${needle}"`, shape.slide)
        )
      }
    }
  }

  return findings
}

// --- 8. Provenance ------------------------------------------------------

function checkProvenance(report: RenderReport, plan: SlidePlan): QaFinding[] {
  const findings: QaFinding[] = []

  for (const slide of report.slides) {
    if (slide.sourceRefs.length === 0 || slide.sourceRefs.every(r => !r.trim())) {
      findings.push(err('provenance', `slide "${slide.title}" has no sourceRefs`, slide.index))
    }
  }

  for (const slide of plan.slides) {
    const mismatch = eyebrowMismatch(slide)
    if (mismatch) findings.push(err('provenance', `slide "${slide.title}": ${mismatch}`))
  }

  return findings
}

// --- 9. Speaker notes ---------------------------------------------------

function checkNotes(report: RenderReport): QaFinding[] {
  const findings: QaFinding[] = []

  for (const slide of report.slides) {
    if (slide.notesWordCount < 25) {
      findings.push(
        err('notes', `slide "${slide.title}" has ${slide.notesWordCount} words of speaker notes; 25 is the minimum`, slide.index)
      )
    }
  }

  return findings
}

// --- Layout variety (the A4 "13 of 13 identical slides" defect) ---------

function checkVariety(report: RenderReport, spec: PresentationSpec): QaFinding[] {
  const content = report.slides.filter(s => s.layout !== 'title' && s.layout !== 'closing')
  if (content.length === 0) return []

  const nonBullet = content.filter(s => s.layout !== 'bullets' && s.layout !== 'references')
  const ratio = nonBullet.length / content.length

  if (ratio < spec.deck.minNonBulletRatio) {
    return [
      warn(
        'variety',
        `${nonBullet.length} of ${content.length} content slides use a non-bullet layout ` +
          `(${(ratio * 100).toFixed(0)}%, target ${(spec.deck.minNonBulletRatio * 100).toFixed(0)}%)`
      ),
    ]
  }
  return []
}

/** Deck length against the spec's 12-15 guidance. */
function checkDeckLength(report: RenderReport, spec: PresentationSpec): QaFinding[] {
  const n = report.slideCount
  if (n < spec.deck.minSlides || n > spec.deck.maxSlides) {
    return [warn('deck-length', `deck is ${n} slides; the spec asks for ${spec.deck.minSlides}-${spec.deck.maxSlides}`)]
  }
  return []
}

// --- The static gate ----------------------------------------------------

export function runStaticChecks(
  report: RenderReport,
  plan: SlidePlan,
  spec: PresentationSpec = DEFAULT_SPEC
): QaFinding[] {
  return [
    ...checkOffCanvas(report),
    ...checkOverflow(report),
    ...checkBulletHygiene(report),
    ...checkBulletContent(report, spec),
    ...checkSpecCompliance(report, spec),
    ...checkPlaceholders(report, spec),
    ...checkProvenance(report, plan),
    ...checkNotes(report),
    ...checkVariety(report, spec),
    ...checkDeckLength(report, spec),
  ]
}

// --- 10. Structural validity (OOXML) ------------------------------------

/**
 * Reads a .pptx (a zip) without any third-party dependency.
 *
 * A validation gate that silently skips when an optional library is missing is
 * not a gate, so the central-directory walk is implemented here on Node's
 * built-in zlib rather than taking a dependency on jszip.
 */
export function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>()

  // End of central directory: scan back for its signature (0x06054b50).
  let eocd = -1
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 22 - 65536; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd === -1) throw new Error('no end-of-central-directory record; not a zip file')

  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)

  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error(`bad central directory entry at ${offset}`)

    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLen = buffer.readUInt16LE(offset + 28)
    const extraLen = buffer.readUInt16LE(offset + 30)
    const commentLen = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLen)

    // The local header repeats the name/extra lengths, which may differ.
    const localNameLen = buffer.readUInt16LE(localOffset + 26)
    const localExtraLen = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    const raw = buffer.subarray(dataStart, dataStart + compressedSize)

    entries.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw))

    offset += 46 + nameLen + extraLen + commentLen
  }

  return entries
}

/**
 * Opens the written .pptx and verifies it is a structurally sound package.
 */
export async function checkPackage(pptxPath: string): Promise<QaFinding[]> {
  const findings: QaFinding[] = []

  if (!existsSync(pptxPath)) return [err('package', `deck not found at ${pptxPath}`)]

  let entries: Map<string, Buffer>
  try {
    entries = readZipEntries(readFileSync(pptxPath))
  } catch (e) {
    return [err('package', `deck is not a readable OOXML package: ${(e as Error).message}`)]
  }

  const required = ['[Content_Types].xml', 'ppt/presentation.xml', '_rels/.rels']
  for (const part of required) {
    if (!entries.has(part)) findings.push(err('package', `missing required part ${part}`))
  }

  const slideFiles = [...entries.keys()].filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
  if (slideFiles.length === 0) findings.push(err('package', 'the package contains no slides'))

  for (const name of slideFiles.sort()) {
    const xml = entries.get(name)!.toString('utf8')
    const problem = xmlWellFormednessProblem(xml)
    if (problem) findings.push(err('package', `${name} is not well-formed: ${problem}`))

    // The A2 defect, verified against the emitted XML rather than our own model:
    // a bulleted paragraph whose run text ends in a line break.
    if (/<a:t>[^<]*\n[^<]*<\/a:t>/.test(xml)) {
      findings.push(err('package', `${name} has a newline inside a text run (phantom empty bullets)`))
    }
    if (/<a:t>\s*<\/a:t>/.test(xml)) {
      findings.push(err('package', `${name} contains an empty text run`))
    }
  }

  // Speaker notes must exist as notesSlide parts, not as text boxes.
  const noteParts = [...entries.keys()].filter(n => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n))
  if (noteParts.length < slideFiles.length) {
    findings.push(
      err('package', `${noteParts.length} notesSlide parts for ${slideFiles.length} slides; every slide needs speaker notes`)
    )
  }

  return findings
}

/**
 * A tag-balance check. Not a full parser: enough to catch truncation and
 * mismatched elements, which is what a malformed generated package looks like.
 */
function xmlWellFormednessProblem(xml: string): string | null {
  if (!xml.trimStart().startsWith('<?xml')) return 'missing XML declaration'

  const stack: string[] = []
  const tagRe = /<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g
  let m: RegExpExecArray | null

  while ((m = tagRe.exec(xml)) !== null) {
    const [, closing, name, attrs, selfClose] = m
    if (attrs.startsWith('?') || name.startsWith('!')) continue
    if (selfClose === '/') continue
    if (closing === '/') {
      const open = stack.pop()
      if (open !== name) return `</${name}> closes <${open ?? 'nothing'}>`
    } else {
      stack.push(name)
    }
  }

  return stack.length > 0 ? `unclosed <${stack[stack.length - 1]}>` : null
}

// --- Visual rendering (opt-in) ------------------------------------------

function which(binary: string): string | null {
  const candidates =
    process.platform === 'win32'
      ? [
          binary,
          `C:\\Program Files\\LibreOffice\\program\\${binary}.exe`,
          `C:\\Program Files (x86)\\LibreOffice\\program\\${binary}.exe`,
        ]
      : [binary]

  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' })
      return candidate
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

/**
 * Converts the deck to per-slide JPEGs for visual review.
 *
 * Returns a warning (never an error) when LibreOffice or poppler is missing:
 * the static gate is the hard requirement, and a machine without a headless
 * office suite must still be able to run it.
 */
export function renderSlideImages(pptxPath: string, outDir: string): QaFinding[] {
  const soffice = which('soffice')
  if (!soffice) return [warn('visual', 'soffice not found; skipped visual rendering')]

  mkdirSync(outDir, { recursive: true })

  try {
    execFileSync(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, pptxPath], {
      stdio: 'ignore',
      timeout: 180_000,
    })
  } catch (e) {
    return [warn('visual', `soffice conversion failed: ${(e as Error).message}`)]
  }

  const pdf = join(outDir, basename(pptxPath).replace(/\.pptx$/i, '.pdf'))
  if (!existsSync(pdf)) return [warn('visual', 'soffice produced no PDF')]

  const pdftoppm = which('pdftoppm')
  if (!pdftoppm) return [warn('visual', `PDF written to ${pdf}, but pdftoppm not found for slide images`)]

  try {
    execFileSync(pdftoppm, ['-jpeg', '-r', '150', pdf, join(outDir, 'slide')], {
      stdio: 'ignore',
      timeout: 180_000,
    })
  } catch (e) {
    return [warn('visual', `pdftoppm failed: ${(e as Error).message}`)]
  }

  return []
}

// --- Reporting ----------------------------------------------------------

export function formatFindings(findings: QaFinding[]): string {
  if (findings.length === 0) return '  (none)'
  return findings
    .map(f => {
      const where = f.slide ? ` [slide ${f.slide}]` : ''
      return `  ${f.severity === 'error' ? 'ERROR' : 'warn '} ${f.check}${where}: ${f.message}`
    })
    .join('\n')
}

/**
 * Runs the gate and throws on any error. This is what a generation job calls.
 */
export async function assertDeckQuality(options: {
  report: RenderReport
  plan: SlidePlan
  spec?: PresentationSpec
  pptxPath?: string
}): Promise<QaFinding[]> {
  const spec = options.spec ?? DEFAULT_SPEC
  const findings = runStaticChecks(options.report, options.plan, spec)
  if (options.pptxPath) findings.push(...(await checkPackage(options.pptxPath)))

  const errors = findings.filter(f => f.severity === 'error')
  if (errors.length > 0) {
    throw new Error(`qa_deck failed with ${errors.length} error(s):\n${formatFindings(errors)}`)
  }
  return findings
}

// --- CLI ----------------------------------------------------------------

const isCli =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  /qa_deck\.mts$/.test(process.argv[1].replace(/\\/g, '/'))

if (isCli) {
  const args = process.argv.slice(2)
  const wantVisual = args.includes('--visual')
  const [pptxPath, reportPath] = args.filter(a => !a.startsWith('--'))

  if (!pptxPath || !reportPath) {
    console.error('usage: qa_deck.mts <deck.pptx> <render-report.json> [--visual]')
    process.exit(2)
  }

  const parsed = JSON.parse(readFileSync(reportPath, 'utf8')) as { report: RenderReport; plan: SlidePlan }

  const findings = runStaticChecks(parsed.report, parsed.plan, DEFAULT_SPEC)
  findings.push(...(await checkPackage(pptxPath)))
  if (wantVisual) findings.push(...renderSlideImages(pptxPath, join(dirname(pptxPath), 'slides')))

  const errors = findings.filter(f => f.severity === 'error')
  const warnings = findings.filter(f => f.severity === 'warning')

  console.log(`qa_deck: ${parsed.report.slideCount} slides, ${parsed.report.shapes.length} shapes`)
  console.log(`errors (${errors.length}):`)
  console.log(formatFindings(errors))
  console.log(`warnings (${warnings.length}):`)
  console.log(formatFindings(warnings))

  process.exit(errors.length > 0 ? 1 : 0)
}
