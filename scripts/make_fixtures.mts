/**
 * make_fixtures.mts
 * ------------------------------------------------------------------
 * Builds the two document shapes the repo has no real example of:
 * a TWO-COLUMN PDF and a SCANNED (image-only) PDF.
 *
 * These are synthesized, not real-world documents. A real two-column journal
 * PDF has ligatures, embedded font subsets, running heads and footnotes that a
 * hand-built file does not, so passing here is weaker evidence than passing on
 * a genuine paper. They do exercise the two behaviours that matter: whether
 * column text is interleaved by the Y-based line grouper, and whether a PDF
 * with no text layer is rejected with an actionable message rather than
 * producing an empty deck.
 *
 * Usage: node --import ./tests/ts-resolve.mjs scripts/make_fixtures.mts [outDir]
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const outDir = process.argv[2] ?? join('out', 'fixtures')
mkdirSync(outDir, { recursive: true })

interface Run {
  text: string
  x: number
  y: number
  size?: number
}

/** Minimal but structurally valid multi-page PDF with a real xref table. */
function buildPdf(pages: Run[][]): Uint8Array {
  const objects: string[] = []
  const pageIds: number[] = []

  // 1 = catalog, 2 = pages tree, then per page: page obj + content obj, then font.
  const contentIds: number[] = []
  let nextId = 3

  for (const runs of pages) {
    pageIds.push(nextId++)
    contentIds.push(nextId++)
  }
  const fontId = nextId++

  objects[0] = '<</Type/Catalog/Pages 2 0 R>>'
  objects[1] = `<</Type/Pages/Kids[${pageIds.map(id => `${id} 0 R`).join(' ')}]/Count ${pages.length}>>`

  pages.forEach((runs, i) => {
    const content = runs
      .map(
        r =>
          `BT /F1 ${r.size ?? 11} Tf ${r.x} ${r.y} Td (${r.text.replace(/([()\\])/g, '\\$1')}) Tj ET`
      )
      .join('\n')

    objects[pageIds[i] - 1] =
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]` +
      `/Resources<</Font<</F1 ${fontId} 0 R>>>>/Contents ${contentIds[i]} 0 R>>`
    objects[contentIds[i] - 1] = `<</Length ${content.length}>>\nstream\n${content}\nendstream`
  })

  objects[fontId - 1] = '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'

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

  return new TextEncoder().encode(pdf)
}

// --- Fixture 1: two-column paper ---------------------------------------

const LEFT_X = 60
const RIGHT_X = 320
const TOP = 700
const LEAD = 14

/** Lays a paragraph out as wrapped lines in one column. */
function column(lines: string[], x: number, startY: number, size = 10): Run[] {
  return lines.map((text, i) => ({ text, x, y: startY - i * LEAD, size }))
}

const coverRuns: Run[] = [
  { text: 'ADAPTIVE CONGESTION CONTROL IN', x: 120, y: 640, size: 18 },
  { text: 'MULTI-TENANT DATA CENTRE FABRICS', x: 110, y: 615, size: 18 },
  { text: 'PRESENTED AT THE DEPARTMENT OF COMPUTER ENGINEERING', x: 80, y: 540, size: 11 },
  { text: 'IN PARTIAL FULFILMENT OF THE REQUIREMENTS FOR THE AWARD OF', x: 70, y: 515, size: 11 },
  { text: 'HIGHER NATIONAL DIPLOMA (HND)', x: 170, y: 490, size: 11 },
  { text: 'PRESENTED BY:', x: 240, y: 440, size: 11 },
  { text: 'ADAEZE NWACHUKWU OKONKWO', x: 180, y: 415, size: 12 },
  { text: 'F/HD/23/7781204', x: 240, y: 393, size: 11 },
  { text: 'YABA COLLEGE OF TECHNOLOGY,', x: 175, y: 350, size: 11 },
  { text: 'SUPERVISED BY:', x: 240, y: 300, size: 11 },
  { text: 'DR. OLUFEMI ADEBAYO', x: 210, y: 278, size: 11 },
  { text: 'MARCH 2026', x: 255, y: 230, size: 11 },
]

// Page 2: a genuine two-column body. Both columns share Y coordinates, which is
// exactly the case a Y-based line grouper gets wrong.
const page2: Run[] = [
  { text: 'CHAPTER ONE', x: LEFT_X, y: 740, size: 13 },
  { text: '1.1 Introduction', x: LEFT_X, y: 720, size: 11 },
  ...column(
    [
      'Modern data centre fabrics carry traffic for',
      'many tenants at once. Each tenant expects',
      'predictable latency, yet the underlying links',
      'are shared. Congestion therefore arises from',
      'the interaction of independent workloads',
      'rather than from any single heavy sender.',
    ],
    LEFT_X,
    TOP
  ),
  ...column(
    [
      'Classical congestion control reacts only after',
      'a queue has already built up. By that point',
      'the latency penalty has been paid. Adaptive',
      'schemes instead predict the onset of',
      'congestion and shift traffic before queues',
      'grow, which preserves tail latency.',
    ],
    RIGHT_X,
    TOP
  ),
  { text: '1.2 Problem Statement', x: LEFT_X, y: 600, size: 11 },
  ...column(
    [
      'Operators cannot currently attribute a',
      'latency spike to a specific tenant without',
      'per-flow telemetry, which is expensive to',
      'collect at line rate across a large fabric.',
    ],
    LEFT_X,
    580
  ),
  ...column(
    [
      'This work evaluates whether coarse sampling',
      'plus a learned model can identify the',
      'responsible tenant accurately enough to act',
      'on, at a fraction of the telemetry cost.',
    ],
    RIGHT_X,
    580
  ),
]

const page3: Run[] = [
  { text: 'CHAPTER TWO', x: LEFT_X, y: 740, size: 13 },
  { text: '2.1 Related Work', x: LEFT_X, y: 720, size: 11 },
  ...column(
    [
      'Early work on data centre congestion focused',
      'on end-host pacing. Later studies moved the',
      'decision into the fabric itself, using switch',
      'telemetry to drive rerouting decisions.',
    ],
    LEFT_X,
    TOP
  ),
  ...column(
    [
      'More recent systems combine both, pacing at',
      'the host while the fabric supplies a global',
      'view. The remaining gap is attribution: who',
      'caused the congestion, not merely that it',
      'occurred.',
    ],
    RIGHT_X,
    TOP
  ),
  { text: 'REFERENCES', x: LEFT_X, y: 560, size: 13 },
  ...column(
    [
      'Alizadeh, M., Greenberg, A., & Maltz, D. (2010). Data center TCP (DCTCP). ACM SIGCOMM, 40(4), 63-74.',
      'Mittal, R., Lam, V., & Dukkipati, N. (2015). TIMELY: RTT-based congestion control. ACM SIGCOMM, 45(4), 537-550.',
      'Handley, M., Raiciu, C., & Agache, A. (2017). Re-architecting datacenter networks. ACM SIGCOMM, 47(4), 29-42.',
    ],
    LEFT_X,
    540,
    9
  ),
]

writeFileSync(join(outDir, 'two_column_paper.pdf'), buildPdf([coverRuns, page2, page3]))

// --- Fixture 2: scanned / image-only ------------------------------------
//
// Pages with no text operators at all. This is what a scan produces: pixels and
// no text layer. The pipeline must reject it with an actionable message rather
// than emit an empty deck.

writeFileSync(join(outDir, 'scanned_no_text.pdf'), buildPdf([[], [], []]))

console.log(`wrote ${join(outDir, 'two_column_paper.pdf')}`)
console.log(`wrote ${join(outDir, 'scanned_no_text.pdf')}`)
