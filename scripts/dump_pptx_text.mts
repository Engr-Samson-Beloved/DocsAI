/**
 * dump_pptx_text.mts
 * ------------------------------------------------------------------
 * Dumps a deck's text, per slide, straight from the OOXML: title, body
 * paragraphs, tables and speaker notes.
 *
 * Used to study the reference deck without a converter in the loop.
 *
 * Usage: node --import ./tests/ts-resolve.mjs scripts/dump_pptx_text.mts <deck.pptx>
 */

import { readFileSync } from 'node:fs'
import { readZipEntries } from './qa_deck.mts'

const path = process.argv[2]
if (!path) {
  console.error('usage: dump_pptx_text.mts <deck.pptx>')
  process.exit(2)
}

const entries = readZipEntries(readFileSync(path))
const EMU = 914400

const slideNames = [...entries.keys()]
  .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
  .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))

const noteNames = [...entries.keys()]
  .filter(n => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n))
  .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

/** Paragraph texts of a shape body, one entry per <a:p>. */
function paragraphsOf(xml: string): string[] {
  return (xml.match(/<a:p[\s>][\s\S]*?<\/a:p>/g) ?? [])
    .map(p =>
      (p.match(/<a:t>([\s\S]*?)<\/a:t>/g) ?? [])
        .map(t => decode(t.replace(/<\/?a:t>/g, '')))
        .join('')
        .trim()
    )
    .filter(Boolean)
}

for (let i = 0; i < slideNames.length; i++) {
  const xml = entries.get(slideNames[i])!.toString('utf8')

  console.log(`\n${'='.repeat(78)}`)
  console.log(`SLIDE ${i + 1}`)
  console.log('='.repeat(78))

  // Each <p:sp> is a shape; report its size so layout can be read off too.
  const shapes = xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) ?? []
  for (const shape of shapes) {
    const off = shape.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/)
    const paras = paragraphsOf(shape)
    if (paras.length === 0) continue

    const size = off
      ? `[${(Number(off[1]) / EMU).toFixed(2)},${(Number(off[2]) / EMU).toFixed(2)} ` +
        `${(Number(off[3]) / EMU).toFixed(2)}x${(Number(off[4]) / EMU).toFixed(2)}]`
      : '[no xfrm]'

    // Largest font size in the shape hints at its role.
    const sizes = [...shape.matchAll(/sz="(\d+)"/g)].map(m => Number(m[1]) / 100)
    const pt = sizes.length ? ` ${Math.max(...sizes)}pt` : ''

    console.log(`  ${size}${pt}`)
    for (const p of paras) console.log(`     | ${p}`)
  }

  const tables = xml.match(/<a:tbl>[\s\S]*?<\/a:tbl>/g) ?? []
  for (const tbl of tables) {
    console.log('  [TABLE]')
    for (const row of tbl.match(/<a:tr[\s\S]*?<\/a:tr>/g) ?? []) {
      const cells = (row.match(/<a:tc[\s>][\s\S]*?<\/a:tc>/g) ?? []).map(c =>
        paragraphsOf(c).join(' ')
      )
      console.log(`     | ${cells.join(' | ')}`)
    }
  }

  if (noteNames[i]) {
    const notes = paragraphsOf(entries.get(noteNames[i])!.toString('utf8'))
      .filter(t => !/^\d+$/.test(t))
      .join(' ')
    if (notes) console.log(`  NOTES (${notes.split(/\s+/).length}w): ${notes}`)
  }
}
