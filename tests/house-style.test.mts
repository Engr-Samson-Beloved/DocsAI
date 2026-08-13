/**
 * House-style regression tests.
 *
 * Locks the formatting spec to what was measured from the school-approved
 * documents in /sample, and checks the DOCX exporter actually reads from the
 * spec instead of re-hardcoding values.
 *
 * Re-derive the measurements with:
 *   node scratch/docx-spec.mjs "sample/USMAN ABUBAKAR_SEMINAR.docx" scratch/out
 *
 * Run: npm test
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const style = () => import('../src/utils/houseStyle.ts')
const editorSource = () => readFileSync(join(ROOT, 'src/components/Editor/Editor.tsx'), 'utf8')

describe('report spec matches the approved document', () => {
  it('is A4 with one-inch margins', async () => {
    const { REPORT_STYLE, REPORT_DOCX } = await style()

    assert.equal(REPORT_STYLE.page.widthIn, 8.27)
    assert.equal(REPORT_STYLE.page.heightIn, 11.69)
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      assert.equal(REPORT_STYLE.page.marginIn[side], 1.0, `${side} margin`)
    }
    // 1in = 1440 twips; A4 width 8.27in = 11909 twips.
    assert.equal(REPORT_DOCX.page.margin.top, 1440)
    assert.equal(REPORT_DOCX.page.width, 11909)
  })

  it('is Times New Roman 12pt, justified and double-spaced with no first-line indent', async () => {
    const { REPORT_STYLE, REPORT_DOCX } = await style()

    assert.equal(REPORT_STYLE.font.family, 'Times New Roman')
    assert.equal(REPORT_STYLE.font.bodyPt, 12)
    assert.equal(REPORT_STYLE.font.align, 'justify')
    assert.equal(REPORT_STYLE.font.lineSpacing, 2.0)
    assert.equal(REPORT_STYLE.font.firstLineIndentIn, 0)

    assert.equal(REPORT_DOCX.bodyHalfPt, 24) // docx uses half-points
    assert.equal(REPORT_DOCX.lineSpacing, 480) // 240ths of a line; 480 = double
    assert.equal(REPORT_DOCX.firstLineIndent, 0)
  })

  it('renders headings in black, not Word default blue', async () => {
    // The approved sample inherits Word's 2E74B5 because the student never
    // overrode the style. That is an artifact, not a house choice.
    const { REPORT_STYLE } = await style()
    assert.equal(REPORT_STYLE.headings.color, '000000')
  })
})

describe('heading convention', () => {
  it('centers chapter titles and forces caps', async () => {
    const { headingConvention } = await style()
    const h = headingConvention(1, 'Introduction')

    assert.equal(h.text, 'INTRODUCTION')
    assert.equal(h.align, 'center')
    assert.equal(h.bold, true)
  })

  it('strips a "CHAPTER TWO" prefix from the chapter title', async () => {
    // The approved report carries numbering in the sub-headings; there is no
    // separate "CHAPTER TWO" line above the title.
    const { headingConvention } = await style()

    assert.equal(headingConvention(1, 'CHAPTER TWO: Literature Review').text, 'LITERATURE REVIEW')
    assert.equal(headingConvention(1, 'Chapter 3 - Methodology').text, 'METHODOLOGY')
    assert.equal(headingConvention(1, '1.0 Introduction').text, 'INTRODUCTION')
  })

  it('keeps a bare chapter heading rather than emptying it', async () => {
    const { headingConvention } = await style()
    assert.equal(headingConvention(1, 'CHAPTER TWO').text, 'CHAPTER TWO')
  })

  it('left-aligns front matter lists', async () => {
    const { headingConvention } = await style()
    for (const t of ['LIST OF FIGURES', 'LIST OF TABLES', 'TABLE OF CONTENTS']) {
      assert.equal(headingConvention(1, t).align, 'left', t)
    }
    assert.equal(headingConvention(1, 'ABSTRACT').align, 'center')
  })

  it('leaves numbered sub-headings left-aligned with their numbering intact', async () => {
    const { headingConvention } = await style()

    const h2 = headingConvention(2, '2.1 Overview of Smart Energy Management Systems')
    assert.equal(h2.text, '2.1 Overview of Smart Energy Management Systems')
    assert.equal(h2.align, 'left')

    const h3 = headingConvention(3, '2.2.1 Sensors and Smart Metering Devices')
    assert.equal(h3.text, '2.2.1 Sensors and Smart Metering Devices')
    assert.equal(h3.align, 'left')
  })

  it('sizes headings above body copy and h1 above h2', async () => {
    const { headingConvention, REPORT_DOCX } = await style()
    const h1 = headingConvention(1, 'INTRODUCTION').sizeHalfPt
    const h2 = headingConvention(2, '1.0 Background').sizeHalfPt

    assert.ok(h1 > h2, 'h1 should outrank h2')
    assert.ok(h2 >= REPORT_DOCX.bodyHalfPt, 'h2 should not be smaller than body text')
  })
})

describe('DOCX exporter reads from the spec', () => {
  it('does not re-hardcode line spacing or indents', () => {
    const source = editorSource()

    assert.ok(
      !/spacing:\s*\{[^}]*line:\s*360/.test(source),
      'line: 360 (1.5x) is back - the approved report is double-spaced'
    )
    assert.ok(
      !/indent:\s*\{\s*firstLine:\s*720/.test(source),
      'a 0.5in first-line indent is back - the approved report has none'
    )
  })

  it('sets A4 page size and document defaults from the spec', () => {
    const source = editorSource()

    assert.match(source, /size:\s*\{[\s\S]{0,120}REPORT_DOCX\.page\.width/, 'page size not set from spec')
    assert.match(source, /margin:\s*REPORT_DOCX\.page\.margin/, 'margins not set from spec')
    assert.match(source, /size:\s*REPORT_DOCX\.bodyHalfPt/, 'default run size not set from spec')
    assert.match(source, /line:\s*REPORT_DOCX\.lineSpacing/, 'line spacing not set from spec')
  })

  it('applies the heading convention rather than plain title casing', () => {
    const source = editorSource()
    assert.match(source, /headingConvention\(level,/, 'headings do not use the convention helper')
  })

  it('justifies body copy', () => {
    const source = editorSource()
    assert.match(source, /AlignmentType\.JUSTIFIED/, 'body paragraphs are not justified')
  })
})

describe('cover page follows the approved order', () => {
  it('opens with the institution and uses the approved wording', () => {
    const source = editorSource()
    const start = source.indexOf('const SEMINAR_TEMPLATE')
    assert.ok(start > -1, 'SEMINAR_TEMPLATE not found')

    // The cover runs to the first content page. Slicing at the first "</div>"
    // would stop at the nested logo element instead.
    const cover = source.slice(start, source.indexOf('<div data-type="page">', start))

    // Approved order: institution, title, "PRESENTED TO:", department, school,
    // "BY:", name, matric, fulfilment, "SUPERVISED BY", supervisor, session.
    const sequence = [
      'YABA COLLEGE OF TECHNOLOGY',
      'A SEMINAR REPORT PRESENTED TO:',
      'THE DEPARTMENT OF COMPUTER ENGINEERING',
      'SCHOOL OF ENGINEERING',
      'BY:',
      '[STUDENT NAME]',
      '[MATRIC NUMBER]',
      'PARTIAL FULFILMENT',
      'SUPERVISED BY',
      '[SUPERVISOR NAME]',
    ]

    let cursor = -1
    for (const line of sequence) {
      const at = cover.indexOf(line)
      assert.ok(at > -1, `cover is missing "${line}"`)
      assert.ok(at > cursor, `"${line}" is out of the approved order`)
      cursor = at
    }
  })

  it('uses the approved section structure in the body template', () => {
    const source = editorSource()
    const template = source.slice(
      source.indexOf('const SEMINAR_TEMPLATE'),
      source.indexOf('const PROPOSAL_TEMPLATE')
    )

    for (const section of ['ABSTRACT', 'LIST OF FIGURES', 'LIST OF TABLES', 'REFERENCES']) {
      assert.match(template, new RegExp(`<h1>${section}</h1>`), `missing <h1>${section}</h1>`)
    }

    // Chapter titles are h1; numbered sub-headings are h2. The old template had
    // this inverted (h2 "Chapter 1." with h3 "1.1. Introduction").
    assert.match(template, /<h1>INTRODUCTION<\/h1>/)
    assert.match(template, /<h2>1\.0 Background of the Study<\/h2>/)
    assert.ok(!/<h2>Chapter \d/.test(template), 'chapters are still h2 "Chapter N" headings')
  })
})
