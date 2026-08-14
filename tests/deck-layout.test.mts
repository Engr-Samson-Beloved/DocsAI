/**
 * Deck geometry and rendering regression tests.
 *
 * The bug these exist for: every coordinate in the exporter was measured
 * against a 13.333 x 7.5in canvas, but the deck shipped with pptxgenjs's
 * 'LAYOUT_16x9' preset, which is 10 x 5.625in. Production decks therefore
 * rendered with the slide counter, the footer and the right quarter of every
 * body column off the slide.
 *
 * These tests now target src/utils/deck/, which owns the geometry. The old
 * DECK_STYLE object was removed rather than kept alongside it: two sources of
 * truth for where a shape goes is precisely what allowed the mismatch to hide.
 *
 * Run: npm test
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const layout = () => import('../src/utils/deck/layout.ts')
const spec = () => import('../src/utils/deck/presentationSpec.ts')

const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8')

// --- Canvas ----------------------------------------------------------

describe('deck canvas', () => {
  it('matches the accredited decks at 13.333 x 7.5in', async () => {
    const { SLIDE_W, SLIDE_H } = await layout()
    assert.equal(SLIDE_W, 13.333)
    assert.equal(SLIDE_H, 7.5)
  })

  it('registers a custom layout before any slide is added', () => {
    const src = read('src/utils/deck/deckRenderer.ts')

    assert.match(src, /pptx\.defineLayout\(\s*\{\s*name: LAYOUT_NAME/, 'no custom layout is registered')
    assert.match(src, /pptx\.layout = LAYOUT_NAME/, 'the layout is never assigned')

    // The registration must precede the first addSlide call, or pptxgenjs
    // sizes slides with its default preset.
    assert.ok(
      src.indexOf('pptx.layout = LAYOUT_NAME') < src.indexOf('addSlide()'),
      'the layout is set after slides are added'
    )
  })

  it('never names a pptxgenjs preset as the house layout', async () => {
    const { LAYOUT_NAME } = await layout()
    const presets = ['LAYOUT_4x3', 'LAYOUT_16x9', 'LAYOUT_16x10', 'LAYOUT_WIDE']
    assert.ok(!presets.includes(LAYOUT_NAME), `LAYOUT_NAME is the preset ${LAYOUT_NAME}; use a custom name`)
  })
})

// --- Derived geometry ------------------------------------------------

describe('deck geometry fits the canvas', () => {
  it('derives the safe area from the canvas and margins', async () => {
    const { SAFE, SLIDE_W, SLIDE_H, MARGIN, HEADER_H, FOOTER_H } = await layout()
    assert.equal(SAFE.x, MARGIN)
    assert.equal(SAFE.y, HEADER_H)
    assert.ok(Math.abs(SAFE.w - (SLIDE_W - 2 * MARGIN)) < 1e-9)
    assert.ok(Math.abs(SAFE.h - (SLIDE_H - HEADER_H - FOOTER_H)) < 1e-9)
  })

  it('keeps every exported box inside the slide bounds', async () => {
    const mod = await layout()
    const boxes = ['SAFE', 'BODY', 'EYEBROW', 'TITLE', 'COUNTER', 'FOOTER', 'COLUMN_L', 'COLUMN_R', 'BODY_NARROW', 'SIDEBAR', 'HERO']

    for (const name of boxes) {
      const box = (mod as Record<string, any>)[name]
      assert.ok(box, `${name} is not exported`)
      assert.equal(mod.canvasViolation(box), null, `${name} escapes the canvas`)
    }
  })

  it('keeps every text box clear of the trim', async () => {
    const mod = await layout()
    const { SLIDE_W, SLIDE_H, EDGE_CLEARANCE } = mod

    // QA check 1 requires 0.5in of clearance; the chrome is the tightest case.
    for (const name of ['EYEBROW', 'TITLE', 'COUNTER', 'FOOTER', 'BODY']) {
      const b = (mod as Record<string, any>)[name]
      assert.ok(b.x >= EDGE_CLEARANCE - 1e-9, `${name} is ${b.x}in from the left edge`)
      assert.ok(b.y >= EDGE_CLEARANCE - 1e-9, `${name} is ${b.y}in from the top edge`)
      assert.ok(SLIDE_W - (b.x + b.w) >= EDGE_CLEARANCE - 1e-9, `${name} is too close to the right edge`)
      assert.ok(SLIDE_H - (b.y + b.h) >= EDGE_CLEARANCE - 1e-9, `${name} is too close to the bottom edge`)
    }
  })

  it('does not let the title overlap the body', async () => {
    const { TITLE, BODY, EYEBROW } = await layout()
    assert.ok(EYEBROW.y + EYEBROW.h <= TITLE.y, 'the eyebrow overlaps the title')
    assert.ok(TITLE.y + TITLE.h <= BODY.y, 'the title overlaps the body box')
  })

  it('does not let the title collide with the slide counter', async () => {
    const { TITLE, COUNTER } = await layout()
    assert.ok(TITLE.x + TITLE.w <= COUNTER.x, 'the title runs into the counter')
  })

  it('separates the two comparison columns without overlap', async () => {
    const { COLUMN_L, COLUMN_R } = await layout()
    assert.ok(COLUMN_L.x + COLUMN_L.w <= COLUMN_R.x, 'the comparison columns overlap')
  })

  it('keeps generated row and column splits on the slide', async () => {
    const { rows, columns, BODY, canvasViolation } = await layout()
    for (const box of [...rows(BODY, 5), ...rows(BODY, 3), ...columns(BODY, 2), ...columns(BODY, 3)]) {
      assert.equal(canvasViolation(box), null, 'a generated sub-box escapes the canvas')
    }
  })
})

// --- No hard-coded coordinates ---------------------------------------

describe('the renderer holds no literal geometry', () => {
  it('imports its geometry from layout.ts', () => {
    const src = read('src/utils/deck/deckRenderer.ts')
    assert.match(src, /from '\.\/layout'/, 'the renderer does not import the layout module')
    assert.match(src, /assertOnCanvas/, 'the renderer does not assert shapes are on canvas')
  })

  it('routes every shape through the recorder, which asserts on canvas', () => {
    const src = read('src/utils/deck/deckRenderer.ts')
    // addText/addShape/addTable must only be called from inside SlideRecorder.
    const recorderEnd = src.indexOf('// --- Fit pass')
    const afterRecorder = src.slice(recorderEnd)
    for (const call of ['.addText(', '.addShape(', '.addTable(']) {
      assert.ok(
        !afterRecorder.includes(`slide${call}`) && !afterRecorder.includes(`raw${call}`),
        `${call} is called outside the recording wrapper, bypassing the on-canvas assertion`
      )
    }
  })
})

// --- Bullets must not carry newlines ---------------------------------

describe('bullet rendering', () => {
  it('uses breakLine rather than embedding newlines in runs', () => {
    const src = read('src/utils/deck/deckRenderer.ts')
    assert.match(src, /breakLine: i < clean\.length - 1/, 'bullets do not use breakLine')
    assert.ok(
      !/text: b\.text \+ \(i === /.test(src),
      'the newline-appending bullet pattern is back; it creates a phantom empty bullet per item'
    )
  })

  it('strips newlines before any string reaches pptxgenjs', () => {
    const src = read('src/utils/deck/deckRenderer.ts')
    const strips = src.match(/replace\(\/\\s\*\[\\r\\n\]\+\\s\*\/g, ' '\)/g) ?? []
    assert.ok(strips.length >= 2, `expected newline stripping in text and bullets, found ${strips.length}`)
  })
})

// --- Style-guide compliance ------------------------------------------

describe('no decorative furniture', () => {
  it('draws no accent bar, stripe or rule', () => {
    const src = read('src/utils/deck/deckRenderer.ts')

    // The shipped deck had a full-width bar on the title slide, a vertical
    // stripe beside every heading and a rule under the subtitle.
    assert.ok(!/w: '100%'/.test(src), 'a full-width bar is back on the title slide')
    assert.ok(!/h: 0\.0[0-9]/.test(src), 'a hairline rule shape is back')
    assert.ok(!/w: 0\.09/.test(src), 'the vertical accent stripe is back')
  })

  it('defaults the footer to empty and never hard-codes a product name', () => {
    const renderer = read('src/utils/deck/deckRenderer.ts')
    const exporter = read('src/utils/pptxExporter.ts')

    assert.ok(!/WordPI/i.test(renderer), 'a product name is hard-coded in the renderer')
    assert.match(renderer, /if \(footer\.trim\(\)\)/, 'the footer is drawn even when empty')
    assert.match(exporter, /footer: supplied\(meta\.docFooter\) \?\? ''/, 'the footer does not default to empty')
  })

  it('bans the product name in the spec so it cannot reach a slide', async () => {
    const { DEFAULT_SPEC } = await spec()
    assert.ok(
      DEFAULT_SPEC.bannedStrings.some(s => /wordpi/i.test(s)),
      'the product name is not in the banned list'
    )
  })
})

// --- Typography is spec-driven ---------------------------------------

describe('typography comes from the spec, not the renderer', () => {
  it('takes every font size from the spec object', () => {
    const src = read('src/utils/deck/deckRenderer.ts')
    // A numeric literal is the thing to forbid: every size must be read from
    // the spec (optionally offset within its band) or computed by the fit
    // budget. Type annotations and pass-through plumbing are not sizes.
    const literals = src.match(/fontPt: -?\d/g) ?? []
    assert.deepEqual(literals, [], `hard-coded font sizes in the renderer: ${literals.join(', ')}`)
    assert.match(src, /fontPt: spec\.type\./, 'no size is read from the spec at all')
  })

  it('holds no hard-coded colours either', () => {
    const src = read('src/utils/deck/deckRenderer.ts')
    const hexes = src.match(/['"][0-9A-Fa-f]{6}['"]/g) ?? []
    assert.deepEqual(hexes, [], `hard-coded colours: ${hexes.join(', ')}`)
  })

  it('holds the guideline bands: title 36-40, heading 24-28, body 18-22, floor 16', async () => {
    const { DEFAULT_SPEC } = await spec()
    assert.deepEqual(DEFAULT_SPEC.type.title, { minPt: 36, maxPt: 40 })
    assert.deepEqual(DEFAULT_SPEC.type.sectionHeading, { minPt: 24, maxPt: 28 })
    assert.deepEqual(DEFAULT_SPEC.type.body, { minPt: 18, maxPt: 22 })
    assert.equal(DEFAULT_SPEC.type.bodyAbsoluteMinPt, 16)
  })

  it('allows only the approved faces', async () => {
    const { DEFAULT_SPEC } = await spec()
    assert.deepEqual(DEFAULT_SPEC.fontAllowList, ['Arial', 'Calibri', 'Helvetica', 'Segoe UI'])
  })

  it('asks for 12-15 slides and at most 6 bullets each', async () => {
    const { DEFAULT_SPEC } = await spec()
    assert.equal(DEFAULT_SPEC.deck.minSlides, 12)
    assert.equal(DEFAULT_SPEC.deck.maxSlides, 15)
    assert.equal(DEFAULT_SPEC.deck.maxBulletsPerSlide, 6)
    assert.equal(DEFAULT_SPEC.deck.maxWordsPerBullet, 14)
  })
})

// --- Speaker notes ----------------------------------------------------

describe('speaker notes', () => {
  it('attaches notes via addNotes and never as a text box', () => {
    const src = read('src/utils/deck/deckRenderer.ts')
    assert.match(src, /addNotes\(/, 'addNotes is never called')
    assert.match(src, /rec\.notes\(slide\.notes\)/, 'notes are not attached for every slide')
  })
})

// --- The exporter runs the gate ---------------------------------------

describe('generation is gated', () => {
  it('runs the QA checks and refuses to download on an error', () => {
    const src = read('src/utils/pptxExporter.ts')
    assert.match(src, /runStaticChecks\(/, 'the exporter does not run the QA checks')
    assert.ok(
      src.indexOf('runStaticChecks(') < src.indexOf('pptx.writeFile'),
      'the deck is written before it is checked'
    )
    assert.match(src, /if \(errors\.length > 0\)[\s\S]{0,200}throw new DeckGenerationError/, 'errors do not block the download')
  })

  it('never falls back to the filename for the deck title', () => {
    const src = read('src/utils/pptxExporter.ts')
    assert.ok(!/fileName|documentTitle/.test(src.split('const stem')[0]), 'a filename is used as metadata')
    assert.match(src, /The report title could not be found on the cover page/, 'no explicit prompt when the title is missing')
  })
})
