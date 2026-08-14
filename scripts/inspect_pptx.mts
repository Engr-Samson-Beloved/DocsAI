/**
 * inspect_pptx.mts
 * ------------------------------------------------------------------
 * Measures a .pptx straight from its OOXML, with no reference to the code that
 * produced it.
 *
 * This exists so the before/after comparison is evidence rather than assertion:
 * it reads the shipped deck and the regenerated deck the same way, and reports
 * the four defects that are visible in the XML - canvas mismatch, off-canvas
 * shapes, newlines inside text runs, and missing speaker notes.
 *
 * Usage: node --import ./tests/ts-resolve.mjs scripts/inspect_pptx.mts <deck.pptx>
 */

import { readFileSync } from 'node:fs'
import { readZipEntries } from './qa_deck.mts'

const path = process.argv[2]
if (!path) {
  console.error('usage: inspect_pptx.mts <deck.pptx>')
  process.exit(2)
}

const entries = readZipEntries(readFileSync(path))

/** EMU (English Metric Units) per inch, the unit OOXML stores geometry in. */
const EMU = 914400

const presentation = entries.get('ppt/presentation.xml')?.toString('utf8') ?? ''
const size = presentation.match(/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/)
const slideW = size ? Number(size[1]) / EMU : NaN
const slideH = size ? Number(size[2]) / EMU : NaN

const slideNames = [...entries.keys()]
  .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
  .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))

const noteNames = [...entries.keys()].filter(n => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n))

console.log(`file            ${path}`)
console.log(`slide size      ${slideW.toFixed(3)} x ${slideH.toFixed(3)} in`)
console.log(`slides          ${slideNames.length}`)
console.log(`notesSlides     ${noteNames.length}${noteNames.length < slideNames.length ? '   <-- slides without speaker notes' : ''}`)

let offCanvas = 0
let newlineRuns = 0
let emptyRuns = 0
const worst: { slide: number; right: number; bottom: number }[] = []

slideNames.forEach((name, i) => {
  const xml = entries.get(name)!.toString('utf8')

  // Every shape's offset and extent.
  const xfrmRe = /<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/g
  let m: RegExpExecArray | null
  let slideOff = 0
  let maxRight = 0
  let maxBottom = 0

  while ((m = xfrmRe.exec(xml)) !== null) {
    const x = Number(m[1]) / EMU
    const y = Number(m[2]) / EMU
    const w = Number(m[3]) / EMU
    const h = Number(m[4]) / EMU
    maxRight = Math.max(maxRight, x + w)
    maxBottom = Math.max(maxBottom, y + h)
    if (x < -0.01 || y < -0.01 || x + w > slideW + 0.01 || y + h > slideH + 0.01) {
      slideOff++
      offCanvas++
    }
  }

  // A newline inside <a:t> creates a second, empty bulleted paragraph.
  newlineRuns += (xml.match(/<a:t>[^<]*\n[^<]*<\/a:t>/g) ?? []).length
  emptyRuns += (xml.match(/<a:t>\s*<\/a:t>/g) ?? []).length

  if (slideOff > 0) worst.push({ slide: i + 1, right: maxRight, bottom: maxBottom })
})

// A notesSlide part can exist and still be empty - pptxgenjs writes the part
// regardless - so the part count alone does not prove a deck has notes. Count
// the words actually inside them.
let notesWords = 0
let notesWithText = 0
for (const name of noteNames) {
  const xml = entries.get(name)!.toString('utf8')
  // Drop the slide-number placeholder that every notesSlide carries.
  const text = (xml.match(/<a:t>([^<]*)<\/a:t>/g) ?? [])
    .map(t => t.replace(/<\/?a:t>/g, ''))
    .filter(t => !/^\d+$/.test(t.trim()))
    .join(' ')
    .trim()
  const words = text ? text.split(/\s+/).length : 0
  notesWords += words
  if (words >= 25) notesWithText++
}

console.log(`notes with text ${notesWithText}/${noteNames.length} slides have >= 25 words (${notesWords} words total)`)
console.log(`off-canvas      ${offCanvas} shape(s)`)
console.log(`newline runs    ${newlineRuns}   (each creates a phantom empty bullet)`)
console.log(`empty runs      ${emptyRuns}`)

// --- Layout variety, measured rather than asserted ----------------------
//
// "Identical title + bullets on 13 of 13 slides" is a claim about layout, and
// layout is fully determined by geometry. Two slides whose shapes sit at the
// same positions with the same sizes ARE the same layout, whatever the text
// says. Grouping slides by that signature turns the claim into a measurement.

const signatures = new Map<string, number[]>()
let tableSlides = 0

slideNames.forEach((name, i) => {
  const xml = entries.get(name)!.toString('utf8')
  if (/<a:tbl>/.test(xml)) tableSlides++

  const boxes: string[] = []
  const xfrmRe = /<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/g
  let m: RegExpExecArray | null
  while ((m = xfrmRe.exec(xml)) !== null) {
    // Round to 0.05in so trivial differences do not split a shared layout.
    const round = (v: string) => (Math.round((Number(v) / EMU) * 20) / 20).toFixed(2)
    boxes.push(`${round(m[1])},${round(m[2])},${round(m[3])},${round(m[4])}`)
  }

  const key = boxes.sort().join(' | ') || '(no positioned shapes)'
  const list = signatures.get(key)
  if (list) list.push(i + 1)
  else signatures.set(key, [i + 1])
})

const groups = [...signatures.values()].sort((a, b) => b.length - a.length)
console.log(`tables          ${tableSlides} slide(s) contain a real <a:tbl>`)
console.log(`distinct layouts ${groups.length} across ${slideNames.length} slides`)
console.log(`largest group   ${groups[0].length} slides share one identical geometry: ${groups[0].slice(0, 14).join(',')}${groups[0].length > 14 ? '…' : ''}`)

if (worst.length > 0) {
  console.log('\nslides with shapes past the canvas:')
  for (const w of worst.slice(0, 6)) {
    console.log(
      `  slide ${String(w.slide).padStart(2)}: content extends to ${w.right.toFixed(2)} x ${w.bottom.toFixed(2)} in ` +
        `on a ${slideW.toFixed(2)} x ${slideH.toFixed(2)} in canvas`
    )
  }
  if (worst.length > 6) console.log(`  ... and ${worst.length - 6} more`)
}
