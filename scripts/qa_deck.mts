/**
 * qa_deck.mts
 * ------------------------------------------------------------------
 * The validation gate. Runs after every generation and fails the job on any
 * error.
 *
 * The static checks live in src/utils/deck/qaChecks.ts so the browser can run
 * them too; this script adds the two that need Node - the OOXML package check
 * and headless visual rendering - plus a CLI.
 *
 * Usage
 *   node --import ./tests/ts-resolve.mjs scripts/qa_deck.mts <deck.pptx> <report.json> [--visual]
 *
 * Visual checks are opt-in via --visual and skip cleanly when LibreOffice or
 * poppler is absent, so the gate still runs everywhere.
 */

import { readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { inflateRawSync } from 'node:zlib'
import { join, dirname, basename } from 'node:path'

import type { RenderReport } from '../src/utils/deck/deckRenderer.ts'
import type { SlidePlan } from '../src/utils/deck/slidePlan.ts'
import type { PresentationSpec } from '../src/utils/deck/presentationSpec.ts'
import { DEFAULT_SPEC } from '../src/utils/deck/presentationSpec.ts'
import { runStaticChecks, formatFindings, err, warn, type QaFinding } from '../src/utils/deck/qaChecks.ts'

export { runStaticChecks, formatFindings, type QaFinding }

// --- 10. Structural validity (OOXML) ------------------------------------

/**
 * Reads a .pptx (a zip) with no third-party dependency.
 *
 * A validation gate that silently skips when an optional library is missing is
 * not a gate, so the central-directory walk is implemented here on Node's
 * built-in zlib rather than taking a dependency on jszip (which is not
 * installed in this project).
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

/** Opens the written .pptx and verifies it is a structurally sound package. */
export async function checkPackage(pptxPath: string): Promise<QaFinding[]> {
  const findings: QaFinding[] = []

  if (!existsSync(pptxPath)) return [err('package', `deck not found at ${pptxPath}`)]

  let entries: Map<string, Buffer>
  try {
    entries = readZipEntries(readFileSync(pptxPath))
  } catch (e) {
    return [err('package', `deck is not a readable OOXML package: ${(e as Error).message}`)]
  }

  for (const part of ['[Content_Types].xml', 'ppt/presentation.xml', '_rels/.rels']) {
    if (!entries.has(part)) findings.push(err('package', `missing required part ${part}`))
  }

  const slideFiles = [...entries.keys()].filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
  if (slideFiles.length === 0) findings.push(err('package', 'the package contains no slides'))

  for (const name of slideFiles.sort()) {
    const xml = entries.get(name)!.toString('utf8')

    const problem = xmlWellFormednessProblem(xml)
    if (problem) findings.push(err('package', `${name} is not well-formed: ${problem}`))

    // The phantom-bullet defect, verified against the emitted XML rather than
    // our own model: a run whose text carries a line break, which PowerPoint
    // renders as a second, empty bulleted paragraph.
    if (/<a:t>[^<]*\n[^<]*<\/a:t>/.test(xml)) {
      findings.push(err('package', `${name} has a newline inside a text run (phantom empty bullets)`))
    }
    if (/<a:t>\s*<\/a:t>/.test(xml)) {
      findings.push(err('package', `${name} contains an empty text run`))
    }
  }

  // Speaker notes must exist as notesSlide parts, not as text boxes - and must
  // actually contain words.
  //
  // Counting parts alone is not enough: pptxgenjs writes a notesSlide part for
  // every slide whether or not addNotes was called, so the deck that shipped
  // with entirely empty notes had a full set of parts and would have passed a
  // part-count check. Measured against sample/Word_PI_Gen/samson123456.pptx:
  // 15 parts, 0 words.
  const noteParts = [...entries.keys()].filter(n => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n))
  if (noteParts.length < slideFiles.length) {
    findings.push(
      err('package', `${noteParts.length} notesSlide parts for ${slideFiles.length} slides; every slide needs speaker notes`)
    )
  }

  let notesWithText = 0
  for (const name of noteParts) {
    if (notesWordCount(entries.get(name)!.toString('utf8')) >= 25) notesWithText++
  }
  if (notesWithText < slideFiles.length) {
    findings.push(
      err(
        'package',
        `only ${notesWithText}/${slideFiles.length} notesSlide parts carry 25+ words; ` +
          `the rest are empty placeholders, which is what an uncalled addNotes looks like`
      )
    )
  }

  return findings
}

/** Words inside a notesSlide, excluding the slide-number placeholder. */
function notesWordCount(xml: string): number {
  const text = (xml.match(/<a:t>([^<]*)<\/a:t>/g) ?? [])
    .map(t => t.replace(/<\/?a:t>/g, ''))
    .filter(t => !/^\d+$/.test(t.trim()))
    .join(' ')
    .trim()
  return text ? text.split(/\s+/).length : 0
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

/**
 * Locates a helper binary.
 *
 * Windows installers routinely leave these off PATH for the current shell -
 * winget's poppler package registers aliases that only resolve in a new
 * session - so the well-known install locations are searched too, and an
 * explicit override is honoured first.
 */
function which(binary: string): string | null {
  const override = process.env[`${binary.toUpperCase()}_BIN`]
  const candidates = [override, binary].filter(Boolean) as string[]

  if (process.platform === 'win32') {
    candidates.push(
      `C:\\Program Files\\LibreOffice\\program\\${binary}.exe`,
      `C:\\Program Files (x86)\\LibreOffice\\program\\${binary}.exe`
    )

    // winget package layout: .../WinGet/Packages/<pkg>/<dist>/Library/bin/<bin>.exe
    const packages = join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Packages')
    if (existsSync(packages)) {
      for (const pkg of readdirSync(packages)) {
        for (const sub of ['Library\\bin', 'bin', '']) {
          const guess = join(packages, pkg, sub, `${binary}.exe`)
          if (existsSync(guess)) candidates.push(guess)
        }
        // Poppler nests one directory deeper (poppler-<version>/Library/bin).
        const root = join(packages, pkg)
        try {
          for (const inner of readdirSync(root)) {
            const guess = join(root, inner, 'Library', 'bin', `${binary}.exe`)
            if (existsSync(guess)) candidates.push(guess)
          }
        } catch {
          /* not a directory */
        }
      }
    }
  }

  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' })
      return candidate
    } catch {
      // Some builds exit non-zero on --version but are still usable.
      if (candidate !== binary && existsSync(candidate)) return candidate
    }
  }
  return null
}

/**
 * Converts the deck to per-slide JPEGs for visual review.
 *
 * Returns warnings, never errors, when LibreOffice or poppler is missing: the
 * static gate is the hard requirement, and a machine without a headless office
 * suite must still be able to run it.
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

// --- Programmatic entry point -------------------------------------------

/** Runs the gate and throws on any error. This is what a generation job calls. */
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
  !!process.argv[1] &&
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
