/**
 * Deck geometry and layout regression tests.
 *
 * The bug these exist for: every coordinate in pptxExporter was measured against
 * a 13.333 x 7.5in canvas, but the deck shipped with pptxgenjs's 'LAYOUT_16x9'
 * preset, which is 10 x 5.625in. Production decks therefore rendered with the
 * slide counter, the footer and the right quarter of every body column off the
 * slide. Verified against sample/Word_PI_Gen/samson123456.pptx, whose shapes
 * extend to 12.73in wide and 7.30in tall on a 10 x 5.625in canvas.
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
const exporterSource = () => readFileSync(join(ROOT, 'src/utils/pptxExporter.ts'), 'utf8')

// --- Canvas ----------------------------------------------------------

describe('deck canvas', () => {
  it('matches the accredited decks at 13.333 x 7.5in', async () => {
    const { DECK_STYLE } = await style()
    assert.equal(DECK_STYLE.slide.widthIn, 13.333)
    assert.equal(DECK_STYLE.slide.heightIn, 7.5)
  })

  it('registers a custom layout instead of a mismatched pptxgenjs preset', () => {
    const src = exporterSource()

    assert.match(src, /pptx\.defineLayout\(/, 'no custom layout is registered')
    assert.match(
      src,
      /pptx\.layout = DECK_STYLE\.slide\.layout/,
      'the layout is not taken from the house style'
    )
    assert.ok(
      !/pptx\.layout\s*=\s*['"]LAYOUT_16x9['"]/.test(src),
      "the 10 x 5.625in 'LAYOUT_16x9' preset is back - it does not match this deck's coordinates"
    )
  })

  it('never names a pptxgenjs preset as the house layout', async () => {
    // Preset names carry fixed sizes we do not control; a custom name cannot be
    // silently reinterpreted by the library.
    const { DECK_STYLE } = await style()
    const presets = ['LAYOUT_4x3', 'LAYOUT_16x9', 'LAYOUT_16x10', 'LAYOUT_WIDE']
    assert.ok(
      !presets.includes(DECK_STYLE.slide.layout),
      `DECK_STYLE.slide.layout is the preset ${DECK_STYLE.slide.layout}; use a custom name`
    )
  })
})

// --- Every declared box must land on the slide -----------------------

describe('deck geometry fits the canvas', () => {
  it('keeps every house-style box inside the slide bounds', async () => {
    const { DECK_STYLE } = await style()
    const W = DECK_STYLE.slide.widthIn
    const H = DECK_STYLE.slide.heightIn

    const boxes: { name: string; x: number; y: number; w: number; h: number }[] = [
      { name: 'header', x: DECK_STYLE.header.xIn, y: DECK_STYLE.header.yIn, w: DECK_STYLE.header.widthIn, h: DECK_STYLE.header.heightIn },
      { name: 'body', x: DECK_STYLE.body.xIn, y: DECK_STYLE.body.yIn, w: DECK_STYLE.body.widthIn, h: DECK_STYLE.body.heightIn },
      { name: 'bodyWithSidebar', x: DECK_STYLE.bodyWithSidebar.xIn, y: DECK_STYLE.bodyWithSidebar.yIn, w: DECK_STYLE.bodyWithSidebar.widthIn, h: DECK_STYLE.bodyWithSidebar.heightIn },
      { name: 'titleSlide.title', x: DECK_STYLE.titleSlide.title.xIn, y: DECK_STYLE.titleSlide.title.yIn, w: DECK_STYLE.titleSlide.title.widthIn, h: DECK_STYLE.titleSlide.title.heightIn },
      { name: 'titleSlide.subtitle', x: DECK_STYLE.titleSlide.subtitle.xIn, y: DECK_STYLE.titleSlide.subtitle.yIn, w: DECK_STYLE.titleSlide.subtitle.widthIn, h: DECK_STYLE.titleSlide.subtitle.heightIn },
      { name: 'titleSlide.details', x: DECK_STYLE.titleSlide.details.xIn, y: DECK_STYLE.titleSlide.details.yIn, w: DECK_STYLE.titleSlide.details.widthIn, h: DECK_STYLE.titleSlide.details.heightIn },
    ]

    for (const b of boxes) {
      assert.ok(b.x + b.w <= W + 0.001, `${b.name} extends to ${(b.x + b.w).toFixed(2)}in, past the ${W}in slide`)
      assert.ok(b.y + b.h <= H + 0.001, `${b.name} extends to ${(b.y + b.h).toFixed(2)}in, past the ${H}in slide`)
    }
  })

  it('keeps the last sidebar card on the slide', async () => {
    const { DECK_STYLE } = await style()
    const sb = DECK_STYLE.sidebar
    const lastBottom = sb.firstYIn + (sb.maxCards - 1) * sb.strideIn + sb.cardHeightIn
    const lastRight = sb.xIn + sb.widthIn

    assert.ok(lastRight <= DECK_STYLE.slide.widthIn, `sidebar reaches ${lastRight.toFixed(2)}in`)
    assert.ok(lastBottom <= DECK_STYLE.slide.heightIn, `last card ends at ${lastBottom.toFixed(2)}in`)
  })

  it('keeps the last numbered step clear of the footer', async () => {
    const { DECK_STYLE } = await style()
    const st = DECK_STYLE.steps
    const lastBottom = st.firstYIn + (st.maxSteps - 1) * st.strideIn + st.badgeIn

    assert.ok(
      lastBottom <= DECK_STYLE.slide.heightIn - 0.4,
      `the ${st.maxSteps}th step ends at ${lastBottom.toFixed(2)}in, over the footer`
    )
  })

  it('keeps both comparison panels inside the slide', async () => {
    const { DECK_STYLE } = await style()
    const c = DECK_STYLE.comparison

    assert.ok(c.leftXIn + c.leftWidthIn <= c.rightXIn, 'the comparison panels overlap')
    assert.ok(c.rightXIn + c.rightWidthIn <= DECK_STYLE.slide.widthIn, 'the right panel runs off the slide')
    assert.ok(c.yIn + c.heightIn <= DECK_STYLE.slide.heightIn, 'the panels run past the bottom')
  })
})

// --- Layout variety ---------------------------------------------------

describe('layout variety', () => {
  it('plans more than one body arrangement', () => {
    const src = exporterSource()
    assert.match(src, /export function planLayouts/, 'no layout planner')
    assert.match(src, /variant: 'steps'/, 'the numbered-objectives layout is gone')
    assert.match(src, /variant: 'sidebar'/, 'the concept-card layout is gone')
    assert.match(src, /planLayouts\(buildSlideSpecs/, 'the planner is never applied to the deck')
  })

  it('pairs a heading face with a separate body face, as both samples do', async () => {
    const { DECK_STYLE } = await style()
    assert.notEqual(
      DECK_STYLE.headingFont,
      DECK_STYLE.bodyFont2,
      'headings and body use the same face; the accredited decks pair Arial with Calibri'
    )
    assert.match(exporterSource(), /fontFace: BODY_FACE/, 'body text does not use the body face')
  })
})
