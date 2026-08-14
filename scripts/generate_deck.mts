/**
 * generate_deck.mts
 * ------------------------------------------------------------------
 * Regenerates a deck from a source document, outside the browser, and runs the
 * QA gate over the result.
 *
 * This is the harness that proves the fix: it drives the same modules the app
 * uses (extraction -> tree -> plan -> validate -> render), writes the .pptx and
 * a machine-readable render report, and fails on any QA error.
 *
 * Usage
 *   node --import ./tests/ts-resolve.mjs scripts/generate_deck.mts <source.pdf> [outDir] [--llm] [--visual]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { basename, join, extname } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Loads GEMINI_API_KEY from .env.local, the way Next.js would.
 *
 * The harness runs outside Next, so nothing else populates process.env, and
 * --llm would silently fall back to the deterministic summariser - reporting a
 * pass for a path that never actually ran.
 */
function loadEnvLocal() {
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i)
      if (!m) continue
      const value = m[2].trim().replace(/^["']|["']$/g, '')
      if (value && !process.env[m[1]]) process.env[m[1]] = value
    }
  }
}
loadEnvLocal()

// The extraction path is browser code: it refuses to run without `window` and
// resolves its pdf.js worker over the network. Both are stubbed here so the
// harness exercises the real modules rather than a parallel implementation.
;(globalThis as any).window = globalThis
const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
  'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs'
).href

const { extractPdfAsHtml } = await import('../src/utils/pdfLoader.ts')
const { buildDocTree } = await import('../src/utils/deck/docTree.ts')
const { planDeck } = await import('../src/utils/deck/deckPlan.ts')
const { validateSlidePlan } = await import('../src/utils/deck/slidePlan.ts')
const { renderDeck } = await import('../src/utils/deck/deckRenderer.ts')
const { refinePlanWithLlm } = await import('../src/utils/deck/llmSummarize.ts')
const { DEFAULT_SPEC } = await import('../src/utils/deck/presentationSpec.ts')
const qa = await import('./qa_deck.mts')

const args = process.argv.slice(2)
const flags = new Set(args.filter(a => a.startsWith('--')))
const [source, outDirArg] = args.filter(a => !a.startsWith('--'))

if (!source) {
  console.error('usage: generate_deck.mts <source.pdf> [outDir] [--llm] [--visual]')
  process.exit(2)
}

const outDir = outDirArg ?? 'out'
mkdirSync(outDir, { recursive: true })

// --- 1. Extract ---------------------------------------------------------

console.log(`\n[1/6] extracting ${source}`)
const bytes = readFileSync(source)
const kind = extname(source).toLowerCase()

let html: string
if (kind === '.docx') {
  // DOCX carries real heading styles, so mammoth's h1/h2/h3 output feeds the
  // same tree builder the PDF path uses - no separate code path.
  const mammoth: any = await import('mammoth')
  const result = await (mammoth.default ?? mammoth).convertToHtml({ buffer: bytes })
  html = result.value
} else {
  html = await extractPdfAsHtml(new File([bytes], basename(source), { type: 'application/pdf' }))
}
console.log(`      ${kind} -> ${html.length} chars of structured HTML`)

// --- 2. Structure tree --------------------------------------------------

console.log('[2/6] building the document tree')
const tree = buildDocTree(html)
const tables = tree.sections.reduce((n, s) => n + s.tables.length, 0)
console.log(
  `      ${tree.sections.length} sections, ${tables} tables, ${tree.references.length} references`
)

const missing = tree.metadata.missing
if (missing.length > 0) {
  // Never invented, never taken from the filename. A real UI prompts the user.
  console.log(`      cover fields not found (the UI must ask for these): ${missing.join(', ')}`)
}

// --- 3. Plan ------------------------------------------------------------

console.log('[3/6] planning the deck')
const metadata = {
  title: tree.metadata.title ?? '',
  studentName: tree.metadata.author ?? '',
  matricNo: tree.metadata.matricNo ?? '',
  department: tree.metadata.department ?? '',
  school: tree.metadata.school ?? '',
  institution: tree.metadata.institution ?? '',
  supervisorName: tree.metadata.supervisorName ?? '',
  session: tree.metadata.session ?? '',
  // Caller-supplied and empty by default: no product placeholder may reach a slide.
  footer: '',
}

if (!metadata.title) {
  console.error('      FATAL: no title found on the cover page. Refusing to fall back to the filename.')
  process.exit(1)
}

const { plan: draftPlan, diagnostics } = planDeck(tree, { spec: DEFAULT_SPEC, metadata })
for (const decision of diagnostics.decisions) console.log(`      - ${decision}`)

// --- 4. Validate (and optionally refine) --------------------------------

console.log('[4/6] validating the slide plan')
let plan = draftPlan
let summariser: 'llm' | 'deterministic' = 'deterministic'

if (flags.has('--llm')) {
  const refined = await refinePlanWithLlm(plan, { spec: DEFAULT_SPEC })
  for (const line of refined.log) console.log(`      ${line}`)
  plan = refined.plan
  summariser = refined.used
  // Keep the deterministic draft so the two can be read side by side.
  writeFileSync(
    join(outDir, `${basename(source).replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').toLowerCase()}.deterministic.json`),
    JSON.stringify(draftPlan, null, 2)
  )
}

const validation = validateSlidePlan(plan, DEFAULT_SPEC)
for (const issue of validation.issues.slice(0, 12)) {
  console.log(`      ${issue.repaired ? 'repaired' : 'REJECTED'} [${issue.slideTitle}] ${issue.field}: ${issue.problem}`)
}
if (validation.issues.length > 12) {
  console.log(`      ... and ${validation.issues.length - 12} more`)
}

if (validation.fatal.length > 0) {
  console.error(`      FATAL: ${validation.fatal.length} slide(s) could not be repaired`)
  process.exit(1)
}

// Metadata is not part of what the validator rebuilds, so re-attach it.
const validPlan = { metadata, slides: validation.plan.slides }

// --- 5. Render ----------------------------------------------------------

console.log('[5/6] rendering')
const { pptx, report } = await renderDeck(validPlan, DEFAULT_SPEC)
for (const lever of report.levers) console.log(`      fit: ${lever}`)

const stem = basename(source).replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').toLowerCase()
const pptxPath = join(outDir, `${stem}.pptx`)
const reportPath = join(outDir, `${stem}.report.json`)

const buffer = await pptx.write({ outputType: 'nodebuffer' })
writeFileSync(pptxPath, buffer as Buffer)
writeFileSync(reportPath, JSON.stringify({ report, plan: validPlan }, null, 2))

console.log(`      wrote ${pptxPath} (${report.slideCount} slides, ${report.shapes.length} shapes)`)

// --- 6. QA gate ---------------------------------------------------------

console.log('[6/6] qa_deck')
const findings = qa.runStaticChecks(report, validPlan, DEFAULT_SPEC)
findings.push(...(await qa.checkPackage(pptxPath)))
if (flags.has('--visual')) findings.push(...qa.renderSlideImages(pptxPath, join(outDir, 'slides')))

const errors = findings.filter(f => f.severity === 'error')
const warnings = findings.filter(f => f.severity === 'warning')

console.log(`\nerrors (${errors.length}):`)
console.log(qa.formatFindings(errors))
console.log(`warnings (${warnings.length}):`)
console.log(qa.formatFindings(warnings))

// --- Summary ------------------------------------------------------------

const content = report.slides.filter(s => s.layout !== 'title' && s.layout !== 'closing')
const nonBullet = content.filter(s => s.layout !== 'bullets' && s.layout !== 'references')

console.log('\n--- deck summary ---')
console.log(`summariser   ${summariser}`)
console.log(`title        ${validPlan.metadata.title}`)
console.log(`slides       ${report.slideCount}`)
console.log(`layouts      ${[...new Set(report.slides.map(s => s.layout))].join(', ')}`)
console.log(`non-bullet   ${nonBullet.length}/${content.length} content slides`)
console.log(`notes        min ${Math.min(...report.slides.map(s => s.notesWordCount))} words`)
for (const s of report.slides) {
  console.log(
    `  ${String(s.index).padStart(2)}. [${s.layout.padEnd(10)}] ${s.title.slice(0, 48).padEnd(48)} ` +
      `${s.sourceRefs.join(' ')}`
  )
}

process.exit(errors.length > 0 ? 1 : 0)
