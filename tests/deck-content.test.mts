/**
 * Unit tests for the pure functions behind the deck generator.
 *
 * Each block names the shipped defect it guards. These are the functions the
 * whole pipeline rests on, and every one of them was either absent or wrong in
 * the version that produced the broken deck.
 *
 * Run: npm test
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const textNormalize = () => import('../src/utils/deck/textNormalize.ts')
const fitBudget = () => import('../src/utils/deck/fitBudget.ts')
const layout = () => import('../src/utils/deck/layout.ts')
const spec = () => import('../src/utils/deck/presentationSpec.ts')
const summarize = () => import('../src/utils/deck/summarize.ts')
const deckPlan = () => import('../src/utils/deck/deckPlan.ts')
const slidePlan = () => import('../src/utils/deck/slidePlan.ts')
const pdfStructure = () => import('../src/utils/deck/pdfStructure.ts')
const docTree = () => import('../src/utils/deck/docTree.ts')

// --- De-hyphenation ----------------------------------------------------
//
// Defect: "changes to network behavior require time-" appeared as a bullet,
// because a PDF line-break hyphen was never rejoined.

describe('dehyphenate', () => {
  it('rejoins a word split across a line break', async () => {
    const { dehyphenate } = await textNormalize()
    assert.equal(dehyphenate('conges-\ntion is rising'), 'congestion is rising')
  })

  it('keeps the hyphen in a real compound that happens to wrap', async () => {
    const { dehyphenate } = await textNormalize()
    // "bandwidthintensive" was a real regression from the naive rule.
    assert.equal(dehyphenate('bandwidth-\nintensive traffic'), 'bandwidth-intensive traffic')
    assert.equal(dehyphenate('domain-\nspecific research'), 'domain-specific research')
  })

  it('keeps the hyphen before a capitalised second element', async () => {
    const { dehyphenate } = await textNormalize()
    assert.equal(dehyphenate('Software-\nDefined Networking'), 'Software-Defined Networking')
  })

  it('leaves a spaced dash alone', async () => {
    const { dehyphenate } = await textNormalize()
    assert.equal(dehyphenate('time - based routing'), 'time - based routing')
  })

  it('strips soft hyphens entirely', async () => {
    const { dehyphenate } = await textNormalize()
    assert.equal(dehyphenate('net­work'), 'network')
  })
})

// --- Line rejoining ----------------------------------------------------
//
// Defect: one <p> per PDF layout line, so every bullet was a line slice.

describe('joinWrappedLines', () => {
  it('joins a paragraph broken across layout lines', async () => {
    const { joinWrappedLines } = await textNormalize()
    const input = 'Network congestion occurs when the volume of data\nexceeds the capacity of a link.'
    assert.equal(
      joinWrappedLines(input),
      'Network congestion occurs when the volume of data exceeds the capacity of a link.'
    )
  })

  it('keeps a genuine paragraph break', async () => {
    const { joinWrappedLines } = await textNormalize()
    const out = joinWrappedLines('First paragraph ends here.\n\nSecond paragraph starts here.')
    assert.equal(out.split('\n\n').length, 2)
  })

  it('does not join across a terminal full stop', async () => {
    const { joinWrappedLines } = await textNormalize()
    const out = joinWrappedLines('This sentence is complete.\nA NEW HEADING')
    assert.ok(out.includes('\n\n'), `expected a break, got: ${JSON.stringify(out)}`)
  })
})

// --- Sentence segmentation ---------------------------------------------
//
// Defect: the extractor used split("\n") and never segmented at all.

describe('segmentSentences', () => {
  it('splits on sentence boundaries', async () => {
    const { segmentSentences } = await textNormalize()
    const out = segmentSentences('SDN separates the planes. The controller programs flows.')
    assert.equal(out.length, 2)
  })

  it('does not split on an abbreviation', async () => {
    const { segmentSentences } = await textNormalize()
    assert.equal(segmentSentences('McKeown et al. introduced OpenFlow in 2008.').length, 1)
    assert.equal(segmentSentences('Fig. 3 shows the topology.').length, 1)
  })

  it('does not split inside a decimal or a standard number', async () => {
    const { segmentSentences } = await textNormalize()
    assert.equal(segmentSentences('Utilisation rose by 20.5% under IEEE 802.1Q.').length, 1)
  })

  it('returns nothing for empty input', async () => {
    const { segmentSentences } = await textNormalize()
    assert.deepEqual(segmentSentences('   '), [])
  })
})

// --- Bullet linter -----------------------------------------------------

describe('lintBullet', () => {
  it('accepts a clean statement', async () => {
    const { lintBullet } = await textNormalize()
    assert.deepEqual(lintBullet('Centralised control shortens policy deployment time'), [])
  })

  it('rejects a bullet that starts lowercase', async () => {
    const { lintBullet } = await textNormalize()
    assert.ok(lintBullet('globe have explored SDN from multiple angles').includes('starts-lowercase'))
  })

  it('rejects a bullet ending on a dangling hyphen or comma', async () => {
    const { lintBullet } = await textNormalize()
    assert.ok(lintBullet('Changes to network behavior require time-').includes('dangling-end'))
    assert.ok(lintBullet('Increased latency, dropped packets,').includes('dangling-end'))
  })

  it('rejects an embedded newline and a literal bullet glyph', async () => {
    const { lintBullet } = await textNormalize()
    assert.ok(lintBullet('Latency falls sharply\n').includes('contains-newline'))
    assert.ok(lintBullet('• Latency falls sharply').includes('literal-bullet-glyph'))
  })

  it('enforces the word cap', async () => {
    const { lintBullet, wordCount } = await textNormalize()
    const long =
      'Network congestion in enterprise environments occurs when the volume of data attempting to traverse a link exceeds capacity'
    assert.ok(wordCount(long) > 14, `fixture is only ${wordCount(long)} words`)
    assert.ok(lintBullet(long).includes('too-long'))
    // Exactly at the cap is allowed.
    assert.ok(!lintBullet('One two three four five six seven eight nine ten eleven twelve thirteen fourteen').includes('too-long'))
  })

  it('detects a duplicate against what the deck has already used', async () => {
    const { lintBullet, duplicateKey } = await textNormalize()
    const seen = new Set([duplicateKey('The SDN controller manages flows')])
    assert.ok(lintBullet('SDN controller manages the flows', { seen }).includes('duplicate'))
  })

  it('flags a verb-less fragment when a verb is required', async () => {
    const { lintBullet } = await textNormalize()
    assert.ok(lintBullet('Border data-governance regimes', { requireVerb: true }).includes('no-verb'))
  })
})

// --- Compression -------------------------------------------------------
//
// Defect: bullets were 15-25 words of verbatim source prose, and shortening
// them hard-cut at a word count, leaving half-sentences.

describe('compressSentence', () => {
  it('shortens within the word budget', async () => {
    const { compressSentence } = await summarize()
    const out = compressSentence(
      'The decoupling of the control and data planes eliminates the need for proprietary intelligence.',
      14
    )
    assert.ok(out.split(/\s+/).length <= 14, out)
  })

  it('refuses to cut mid-thought rather than emitting a fragment', async () => {
    const { compressSentence } = await summarize()
    // No clause boundary inside the budget, so there is no honest shortening.
    const out = compressSentence(
      'Network congestion in enterprise environments occurs when the volume of data attempting to traverse a network link exceeds its capacity',
      10
    )
    assert.ok(
      out === '' || !/\b(of|the|to|when|and|in|for)$/i.test(out),
      `emitted a mid-thought bullet: "${out}"`
    )
  })

  it('rejects a pronoun subject with a copula', async () => {
    const { compressSentence } = await summarize()
    // "This is not merely a theoretical improvement" once became
    // "Is not merely a theoretical improvement".
    assert.equal(compressSentence('This is not merely a theoretical improvement in routing', 14), '')
  })

  it('rejects a dependent clause with no main clause', async () => {
    const { compressSentence } = await summarize()
    assert.equal(compressSentence('As the number of flows and network devices grows steadily', 14), '')
    assert.equal(compressSentence('By separating the control plane from the data plane', 14), '')
  })

  it('strips citations but keeps concrete specifics', async () => {
    const { compressSentence } = await summarize()
    const out = compressSentence('Throughput improved by 35% under load (Kreutz et al., 2015).', 14)
    assert.ok(out.includes('35%'), out)
    assert.ok(!out.includes('Kreutz'), out)
  })

  it('never returns text with a terminal period or a leading determiner', async () => {
    const { compressSentence } = await summarize()
    const out = compressSentence('The controller installs flow rules on every switch.', 14)
    assert.ok(!out.endsWith('.'), out)
    assert.ok(!/^The\s/i.test(out), out)
  })
})

// --- estimateLines / fit budget ----------------------------------------
//
// Defect: overflow was never modelled; <a:normAutofit/> shrank nothing.

describe('estimateLines', () => {
  it('reports a single line for text that fits', async () => {
    const { estimateLines } = await fitBudget()
    assert.equal(estimateLines('Short bullet', 12.13, 18, 'Calibri'), 1)
  })

  it('grows with text length', async () => {
    const { estimateLines } = await fitBudget()
    const short = estimateLines('a'.repeat(50), 6, 18, 'Calibri')
    const long = estimateLines('a'.repeat(500), 6, 18, 'Calibri')
    assert.ok(long > short, `${long} should exceed ${short}`)
  })

  it('grows as the box narrows and as the font grows', async () => {
    const { estimateLines } = await fitBudget()
    const wide = estimateLines('a'.repeat(300), 12, 18, 'Calibri')
    const narrow = estimateLines('a'.repeat(300), 4, 18, 'Calibri')
    const large = estimateLines('a'.repeat(300), 12, 32, 'Calibri')
    assert.ok(narrow > wide)
    assert.ok(large > wide)
  })

  it('treats empty text as zero lines and never returns less than one for real text', async () => {
    const { estimateLines } = await fitBudget()
    assert.equal(estimateLines('   ', 12, 18), 0)
    assert.equal(estimateLines('x', 12, 18), 1)
  })
})

describe('estimateHeightIn', () => {
  it('charges paragraph spacing between items only', async () => {
    const { estimateHeightIn, PARA_SPACE_AFTER_IN } = await fitBudget()
    const one = estimateHeightIn([{ text: 'One line', fontPt: 18 }], 12)
    const two = estimateHeightIn(
      [{ text: 'One line', fontPt: 18 }, { text: 'Two line', fontPt: 18 }],
      12
    )
    // Exactly one gap is added, not two. Charging a gap after the last
    // paragraph reported 103% fill on single-line chrome that plainly fits.
    assert.ok(Math.abs(two - 2 * one - PARA_SPACE_AFTER_IN) < 1e-9, `${one} -> ${two}`)
  })
})

describe('fitBullets escalation ladder', () => {
  it('reports no escalation when the content already fits', async () => {
    const { fitBullets } = await fitBudget()
    const { BODY } = await layout()
    const { DEFAULT_SPEC } = await spec()

    const result = fitBullets(['Latency falls sharply', 'Throughput improves'], { box: BODY, spec: DEFAULT_SPEC })
    assert.deepEqual(result.levers, ['none'])
    assert.equal(result.slides.length, 1)
    assert.equal(result.slides[0].fontPt, DEFAULT_SPEC.type.body.maxPt)
  })

  it('tries compression before shrinking the font', async () => {
    const { fitBullets } = await fitBudget()
    const { DEFAULT_SPEC } = await spec()
    const box = { x: 0.6, y: 1.4, w: 4, h: 1.2 }

    const calls: number[] = []
    const result = fitBullets(['A fairly long bullet that will not fit in this small box at all'], {
      box,
      spec: DEFAULT_SPEC,
      compress: (bullets, budget) => {
        calls.push(budget)
        return bullets.map(b => b.split(/\s+/).slice(0, budget).join(' '))
      },
    })

    assert.ok(calls.length > 0, 'the compressor was never asked')
    assert.equal(result.levers[0], 'compress', `first lever was ${result.levers[0]}`)
  })

  it('steps the font down before splitting', async () => {
    const { fitBullets } = await fitBudget()
    const { DEFAULT_SPEC } = await spec()
    const box = { x: 0.6, y: 1.4, w: 8, h: 1.4 }

    const result = fitBullets(
      ['Centralised control shortens deployment', 'Global visibility improves load distribution'],
      { box, spec: DEFAULT_SPEC }
    )
    const firstEscalation = result.levers.find(l => l !== 'none')
    assert.ok(
      firstEscalation === 'font-step' || firstEscalation === undefined,
      `expected a font step first, got ${firstEscalation}`
    )
  })

  it('splits onto a continuation slide when nothing else is enough', async () => {
    const { fitBullets } = await fitBudget()
    const { DEFAULT_SPEC } = await spec()
    const box = { x: 0.6, y: 1.4, w: 6, h: 1.6 }

    const bullets = Array.from({ length: 6 }, (_, i) => `Bullet number ${i + 1} describing an outcome`)
    const result = fitBullets(bullets, { box, spec: DEFAULT_SPEC })

    assert.ok(result.slides.length >= 2, 'never split')
    assert.equal(result.slides[1].titleSuffix, ' (cont.)')
    assert.ok(result.log.length > 0, 'escalation was not logged')
  })

  it('never returns a body size below the spec floor', async () => {
    const { fitBullets } = await fitBudget()
    const { DEFAULT_SPEC } = await spec()
    const box = { x: 0.6, y: 1.4, w: 2, h: 0.6 }

    const result = fitBullets(['A bullet far too long for this tiny box to hold'], { box, spec: DEFAULT_SPEC })
    for (const slide of result.slides) {
      assert.ok(slide.fontPt >= DEFAULT_SPEC.type.bodyAbsoluteMinPt, `${slide.fontPt}pt is below the floor`)
    }
  })
})

// --- Off-canvas assertion ----------------------------------------------
//
// Defect: shapes positioned for 13.333 x 7.5 on a 10 x 5.625 canvas.

describe('off-canvas assertion', () => {
  it('accepts a box inside the canvas', async () => {
    const { assertOnCanvas, BODY } = await layout()
    assert.doesNotThrow(() => assertOnCanvas('body', BODY))
  })

  it('rejects the exact geometry that shipped broken', async () => {
    const { canvasViolation } = await layout()
    // Body box from the shipped deck: x=0.60 w=12.13 on a 10in slide. On the
    // correct canvas it fits; the check exists for the shapes that do not.
    assert.equal(canvasViolation({ x: 0.6, y: 1.4, w: 12.13, h: 5.35 }), null)
    assert.ok(canvasViolation({ x: 10.93, y: 0.35, w: 1.8, h: 0.4 }) === null)
    // A footer at y=7.00 with height 0.30 fits 7.5 but not 5.625.
    assert.ok(canvasViolation({ x: 0.6, y: 7.3, w: 12.13, h: 0.3 }) !== null)
  })

  it('rejects negative coordinates and overhang', async () => {
    const { canvasViolation, assertOnCanvas } = await layout()
    assert.ok(canvasViolation({ x: -0.1, y: 1, w: 2, h: 1 }))
    assert.ok(canvasViolation({ x: 1, y: -0.1, w: 2, h: 1 }))
    assert.ok(canvasViolation({ x: 12, y: 1, w: 2, h: 1 }))
    assert.throws(() => assertOnCanvas('runaway', { x: 12, y: 1, w: 2, h: 1 }), /Off-canvas/)
  })

  it('tolerates floating-point drift in derived geometry', async () => {
    const { canvasViolation, SAFE, MARGIN, SLIDE_W } = await layout()
    // SAFE.w is 12.133000000000001; MARGIN + SAFE.w must still count as inside.
    assert.equal(canvasViolation({ x: MARGIN, y: 1.4, w: SAFE.w, h: 1 }), null)
    assert.ok(MARGIN + SAFE.w <= SLIDE_W + 1e-6)
  })

  it('clamps rather than throwing when asked to', async () => {
    const { clampToCanvas, SLIDE_W } = await layout()
    const clamped = clampToCanvas({ x: 13, y: 1, w: 3, h: 1 })
    assert.ok(clamped.x + clamped.w <= SLIDE_W + 1e-9)
  })
})

// --- Presentation spec --------------------------------------------------

describe('presentationSpec', () => {
  it('computes WCAG contrast correctly', async () => {
    const { contrastRatio } = await spec()
    assert.ok(Math.abs(contrastRatio('000000', 'FFFFFF') - 21) < 0.01)
    assert.ok(Math.abs(contrastRatio('FFFFFF', 'FFFFFF') - 1) < 0.01)
  })

  it('validates the default spec', async () => {
    const { specProblems, DEFAULT_SPEC } = await spec()
    assert.deepEqual(specProblems(DEFAULT_SPEC), [])
  })

  it('every declared colour pair clears 4.5:1', async () => {
    const { DEFAULT_SPEC, contrastRatio } = await spec()
    for (const pair of DEFAULT_SPEC.contrastPairs) {
      const ratio = contrastRatio(pair.fg, pair.bg)
      assert.ok(ratio >= 4.5, `${pair.name} is only ${ratio.toFixed(2)}:1`)
    }
  })

  it('rejects a body size below the stated minimum', async () => {
    const { specProblems, DEFAULT_SPEC } = await spec()
    const bad = {
      ...DEFAULT_SPEC,
      type: { ...DEFAULT_SPEC.type, body: { minPt: 12, maxPt: 22 } },
    }
    assert.ok(specProblems(bad).some(p => /below the absolute minimum/.test(p)))
  })

  it('rejects a low-contrast pair', async () => {
    const { specProblems, DEFAULT_SPEC } = await spec()
    const bad = {
      ...DEFAULT_SPEC,
      contrastPairs: [{ name: 'grey on white', fg: 'BBBBBB', bg: 'FFFFFF' }],
    }
    assert.ok(specProblems(bad).some(p => /below the required 4.5/.test(p)))
  })

  it('rejects a font face outside the allow-list', async () => {
    const { specProblems, DEFAULT_SPEC } = await spec()
    const bad = { ...DEFAULT_SPEC, bodyFace: 'Comic Sans MS' }
    assert.ok(specProblems(bad).some(p => /not in the font allow-list/.test(p)))
  })
})

// --- Citations ----------------------------------------------------------
//
// Defect: "IEEE Communications Magazine, 50(12)," - a citation cut mid-entry.

describe('shortenCitation', () => {
  it('shortens to author, year and title', async () => {
    const { shortenCitation } = await deckPlan()
    const out = shortenCitation(
      'Kreutz, D., Ramos, F., & Verissimo, P. (2015). Software-defined networking: A comprehensive survey. Proceedings of the IEEE, 103(1), 14-76.'
    )
    assert.ok(out.includes('(2015)'), out)
    assert.ok(out.includes('Kreutz'), out)
  })

  it('drops an entry rather than truncating it mid-string', async () => {
    const { shortenCitation } = await deckPlan()
    const out = shortenCitation(
      'Author, A. (2012). An extraordinarily long title that cannot possibly be shortened to fit. IEEE Communications Magazine, 50(12), 114-119.',
      40
    )
    assert.ok(out === '' || !/,$/.test(out), `truncated mid-entry: "${out}"`)
  })

  it('never ends on a bare comma or open bracket', async () => {
    const { shortenCitation } = await deckPlan()
    const entries = [
      'Nunes, B., Mendonca, M., Nguyen, X., Obraczka, K., & Turletti, T. (2014). A survey of software-defined networking. IEEE Communications Surveys, 16(3), 1617-1634.',
      'Jain, S., Kumar, A., & Mandal, S. (2013). B4: Experience with a globally deployed software defined WAN. ACM SIGCOMM, 43(4), 3-14.',
    ]
    for (const entry of entries) {
      const out = shortenCitation(entry)
      if (out) assert.ok(!/[,(]$/.test(out), `bad ending: "${out}"`)
    }
  })
})

// --- Table sanity -------------------------------------------------------
//
// Defect: "Characteristic Traditional Network SDN - Based Network" flattened
// into a bullet, and a mis-parsed grid rendered as an authoritative table.

describe('normalizeTable', () => {
  it('keeps a consistent table', async () => {
    const { normalizeTable } = await deckPlan()
    const out = normalizeTable({
      caption: '',
      headers: ['Characteristic', 'Traditional Network', 'SDN-Based Network'],
      rows: [
        ['Control Plane', 'Distributed', 'Centralised'],
        ['Configuration', 'Per-device CLI', 'Central API'],
      ],
    })
    assert.ok(out)
    assert.equal(out!.rows.length, 2)
  })

  it('salvages a table with one ragged row', async () => {
    const { normalizeTable } = await deckPlan()
    const out = normalizeTable({
      caption: '',
      headers: ['A', 'B', 'C'],
      rows: [['1', '2', '3'], ['4', '5', '6'], ['wrapped cell']],
    })
    assert.ok(out, 'a single ragged row should not discard the whole table')
    assert.equal(out!.rows.length, 2)
  })

  it('rejects a mostly ragged grid rather than rendering nonsense', async () => {
    const { normalizeTable } = await deckPlan()
    const out = normalizeTable({
      caption: '',
      headers: ['SDN', 'Language Southbound', 'Key Strength', 'Enterprise'],
      rows: [['Controller', 'Protocol', 'Suitability'], ['ONOS', 'Java'], ['NETCONF']],
    })
    assert.equal(out, null)
  })

  it('rejects a header made of sentence fragments', async () => {
    const { normalizeTable } = await deckPlan()
    const out = normalizeTable({
      caption: '',
      headers: ['This is a whole sentence pretending to be a column header', 'B'],
      rows: [['1', '2'], ['3', '4']],
    })
    assert.equal(out, null)
  })
})

// --- Slide plan validation ----------------------------------------------

describe('validateSlidePlan', () => {
  it('drops a bullet that fails the lint and trims one that is too long', async () => {
    const { validateSlidePlan } = await slidePlan()
    const { DEFAULT_SPEC } = await spec()

    const result = validateSlidePlan(
      {
        slides: [
          {
            layout: 'bullets',
            title: 'PROBLEM STATEMENT',
            bullets: [
              'Centralised control shortens deployment',
              'globe have explored SDN from many angles',
              'A bullet with far too many words in it to be acceptable on any slide anywhere at all',
            ],
            notes: 'w '.repeat(40),
            sourceRefs: ['§1.2'],
          },
        ],
      },
      DEFAULT_SPEC
    )

    assert.equal(result.fatal.length, 0)
    const bullets = result.plan.slides[0].bullets ?? []
    assert.ok(!bullets.some(b => /^globe/.test(b)), 'the lowercase fragment survived')
    assert.ok(bullets.every(b => b.split(/\s+/).length <= DEFAULT_SPEC.deck.maxWordsPerBullet))
  })

  it('flattens a newline inside a bullet instead of shipping it', async () => {
    const { validateSlidePlan } = await slidePlan()
    const { DEFAULT_SPEC } = await spec()

    const result = validateSlidePlan(
      {
        slides: [
          {
            layout: 'bullets',
            title: 'X',
            bullets: ['Latency falls sharply\n'],
            notes: 'w '.repeat(40),
            sourceRefs: ['§1.1'],
          },
        ],
      },
      DEFAULT_SPEC
    )
    for (const bullet of result.plan.slides[0].bullets ?? []) {
      assert.ok(!/[\r\n]/.test(bullet), 'a newline reached the renderer')
    }
  })

  it('rejects a slide with no provenance', async () => {
    const { validateSlidePlan } = await slidePlan()
    const { DEFAULT_SPEC } = await spec()
    const result = validateSlidePlan(
      { slides: [{ layout: 'bullets', title: 'X', bullets: ['Something happens here'], notes: 'w '.repeat(40), sourceRefs: [] }] },
      DEFAULT_SPEC
    )
    assert.ok(result.fatal.some(f => f.field === 'sourceRefs'))
  })

  it('rejects a slide with too few speaker notes', async () => {
    const { validateSlidePlan } = await slidePlan()
    const { DEFAULT_SPEC } = await spec()
    const result = validateSlidePlan(
      { slides: [{ layout: 'bullets', title: 'X', bullets: ['Something happens here'], notes: 'too short', sourceRefs: ['§1'] }] },
      DEFAULT_SPEC
    )
    assert.ok(result.fatal.some(f => f.field === 'notes'))
  })

  it('does not require body content on a title or closing slide', async () => {
    const { validateSlidePlan } = await slidePlan()
    const { DEFAULT_SPEC } = await spec()
    const result = validateSlidePlan(
      {
        slides: [
          { layout: 'title', title: 'A REAL TITLE', notes: 'w '.repeat(40), sourceRefs: ['cover page'] },
          { layout: 'closing', title: 'THANK YOU', notes: 'w '.repeat(40), sourceRefs: ['closing'] },
        ],
      },
      DEFAULT_SPEC
    )
    assert.equal(result.fatal.length, 0)
    assert.equal(result.plan.slides.length, 2)
  })
})

describe('eyebrowMismatch', () => {
  it('passes when the label agrees with the provenance', async () => {
    const { eyebrowMismatch } = await slidePlan()
    assert.equal(
      eyebrowMismatch({
        layout: 'bullets', title: 'X', eyebrow: 'Chapter Two',
        notes: '', sourceRefs: ['§2.3', 'p. 10'],
      }),
      null
    )
  })

  it('catches the shipped defect: a Chapter Four label on Chapter Two content', async () => {
    const { eyebrowMismatch } = await slidePlan()
    const problem = eyebrowMismatch({
      layout: 'bullets', title: 'SCOPE & SIGNIFICANCE', eyebrow: 'Chapter Four',
      notes: '', sourceRefs: ['§2.1', 'p. 8'],
    })
    assert.ok(problem, 'the mismatch was not detected')
    assert.match(problem!, /Chapter Four/)
  })
})

// --- PDF structure ------------------------------------------------------

describe('pdfStructure', () => {
  it('joins runs on one line without inserting a false space', async () => {
    const { joinSpans } = await pdfStructure()
    // "SDN" and "-Based" arrive as separate runs; "SDN - Based Network" was the
    // mangled header that reached a bullet in the shipped deck.
    assert.equal(
      joinSpans([
        { x: 0, endX: 20, text: 'SDN' },
        { x: 20, endX: 50, text: '-Based' },
        { x: 54, endX: 90, text: 'Network' },
      ]),
      'SDN-Based Network'
    )
  })

  it('groups runs onto shared baselines', async () => {
    const { groupIntoLines } = await pdfStructure()
    const lines = groupIntoLines([
      { str: 'Hello', x: 10, y: 700, width: 30, height: 12 },
      { str: 'world', x: 45, y: 700, width: 30, height: 12 },
      { str: 'Next', x: 10, y: 680, width: 30, height: 12 },
    ])
    assert.equal(lines.length, 2)
    assert.equal(lines[0].text, 'Hello world')
  })

  it('treats a large vertical gap as a paragraph break, not every new line', async () => {
    const { buildBlocks, groupIntoLines } = await pdfStructure()
    const items = [
      { str: 'First line of a paragraph that continues', x: 72, y: 700, width: 200, height: 12 },
      { str: 'onto the next line here.', x: 72, y: 686, width: 200, height: 12 },
      { str: 'A separate paragraph well below.', x: 72, y: 600, width: 200, height: 12 },
    ]
    const blocks = buildBlocks(groupIntoLines(items))
    const paragraphs = blocks.filter(b => b.kind === 'paragraph')
    assert.equal(paragraphs.length, 2, JSON.stringify(paragraphs.map(p => p.text)))
    assert.match(paragraphs[0].text, /continues onto the next line/)
  })
})

// --- Cover metadata -----------------------------------------------------
//
// Defect: the title slide used the FILENAME, and identity fields persisted
// between jobs.

describe('extractCover', () => {
  const COVER = [
    'SEMINAR', 'ON',
    'SOFTWARE DEFINED NETWORKING (SDN) FOR TRAFFIC',
    'MANAGEMENT',
    'IN CONGESTED ENTERPRISE NETWORKS',
    'PRESENTED AT THE DEPARTMENT OF COMPUTER ENGINEERING',
    'IN PARTIAL FULFILMENT OF THE REQUIREMENTS FOR THE AWARD OF',
    'HIGHER NATIONAL DIPLOMA (HND)',
    'PRESENTED BY:', 'EKPAWHA PRINCEWILL DAVID', 'F/HD/24/3410037',
    'YABA COLLEGE OF TECHNOLOGY,', 'YABA, LAGOS',
    'SUPERVISED BY:', 'ENGR. YEKINI NURENI.A', 'JUNE 2026',
  ]

  it('recovers the wrapped title in full', async () => {
    const { extractCover } = await docTree()
    const meta = extractCover(COVER)
    assert.equal(
      meta.title,
      'SOFTWARE DEFINED NETWORKING (SDN) FOR TRAFFIC MANAGEMENT IN CONGESTED ENTERPRISE NETWORKS'
    )
  })

  it('recovers the identity fields', async () => {
    const { extractCover } = await docTree()
    const meta = extractCover(COVER)
    assert.equal(meta.studentName, 'EKPAWHA PRINCEWILL DAVID')
    assert.equal(meta.matricNo, 'F/HD/24/3410037')
    assert.equal(meta.department, 'COMPUTER ENGINEERING')
    assert.equal(meta.institution, 'YABA COLLEGE OF TECHNOLOGY')
    assert.equal(meta.supervisorName, 'ENGR. YEKINI NURENI.A')
  })

  it('reports what it could not find instead of inventing it', async () => {
    const { extractCover } = await docTree()
    const meta = extractCover(COVER)
    assert.ok(meta.missing.includes('session'), 'session is absent and must be reported')
    assert.equal(meta.school, null)
  })

  it('returns a null title rather than guessing from nothing', async () => {
    const { extractCover } = await docTree()
    const meta = extractCover(['BY:', 'A. STUDENT'])
    assert.equal(meta.title, null)
    assert.ok(meta.missing.includes('title'))
  })
})
