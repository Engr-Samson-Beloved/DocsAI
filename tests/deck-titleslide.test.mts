/**
 * Title-slide fit regression.
 *
 * Production defect: "deck-identity text is an estimated 105% of its box
 * height". The identity block was given whatever vertical space the title and
 * subtitle left over, and was never measured against its own content.
 *
 * It survived the SDN sample because that cover supplies neither `school` nor
 * `session`, so the block is four lines. A cover that supplies BOTH gives six,
 * and six did not fit under a three-line title plus a subtitle. These fixtures
 * are therefore built around a FULL cover page, which is the case that broke.
 *
 * Run: npm test
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const renderer = () => import('../src/utils/deck/deckRenderer.ts')
const qa = () => import('../src/utils/deck/qaChecks.ts')
const spec = () => import('../src/utils/deck/presentationSpec.ts')

/** Every cover field populated - the case production hit. */
function fullMetadata(title: string) {
  return {
    title,
    studentName: 'EKPAWHA PRINCEWILL DAVID',
    matricNo: 'F/HD/24/3410037',
    department: 'Computer Engineering',
    school: 'School of Engineering',
    institution: 'Yaba College of Technology',
    supervisorName: 'ENGR. YEKINI NURENI.A',
    session: '2025/2026',
    footer: '',
  }
}

function planFor(title: string, subtitle?: string) {
  return {
    metadata: fullMetadata(title),
    slides: [
      {
        layout: 'title' as const,
        title,
        subtitle,
        notes: 'word '.repeat(45),
        sourceRefs: ['cover page'],
      },
      {
        layout: 'closing' as const,
        title: 'THANK YOU',
        notes: 'word '.repeat(45),
        sourceRefs: ['closing'],
      },
    ],
  }
}

const LONG_TITLE =
  'SOFTWARE DEFINED NETWORKING (SDN) FOR TRAFFIC MANAGEMENT IN CONGESTED ENTERPRISE NETWORKS'
const LONG_SUBTITLE =
  'Enterprise networks today face a growing challenge: conventional networking infrastructure was not designed to handle the sheer volume'

describe('title slide fits its own content', () => {
  it('does not overflow with a full cover page, a long title and a subtitle', async () => {
    const { renderDeck } = await renderer()
    const { runStaticChecks } = await qa()
    const { DEFAULT_SPEC } = await spec()

    const plan = planFor(LONG_TITLE, LONG_SUBTITLE)
    const { report } = await renderDeck(plan, DEFAULT_SPEC)

    const overflow = runStaticChecks(report, plan, DEFAULT_SPEC).filter(f => f.check === 'overflow')
    assert.deepEqual(overflow, [], overflow.map(f => f.message).join('\n'))
  })

  it('does not overflow with no subtitle', async () => {
    const { renderDeck } = await renderer()
    const { runStaticChecks } = await qa()
    const { DEFAULT_SPEC } = await spec()

    const plan = planFor(LONG_TITLE)
    const { report } = await renderDeck(plan, DEFAULT_SPEC)
    const overflow = runStaticChecks(report, plan, DEFAULT_SPEC).filter(f => f.check === 'overflow')
    assert.deepEqual(overflow, [], overflow.map(f => f.message).join('\n'))
  })

  it('survives a title long enough to wrap to four lines', async () => {
    const { renderDeck } = await renderer()
    const { runStaticChecks } = await qa()
    const { DEFAULT_SPEC } = await spec()

    const plan = planFor(
      'AN INVESTIGATION INTO SOFTWARE DEFINED NETWORKING AND ITS APPLICATION TO ADAPTIVE TRAFFIC MANAGEMENT IN LARGE CONGESTED MULTI-TENANT ENTERPRISE NETWORKS',
      LONG_SUBTITLE
    )
    const { report } = await renderDeck(plan, DEFAULT_SPEC)

    const errors = runStaticChecks(report, plan, DEFAULT_SPEC).filter(f => f.severity === 'error')
    assert.deepEqual(errors, [], errors.map(f => `${f.check}: ${f.message}`).join('\n'))
  })

  it('keeps every title-slide shape on the canvas', async () => {
    const { renderDeck } = await renderer()
    const { DEFAULT_SPEC } = await spec()
    const layout = await import('../src/utils/deck/layout.ts')

    const { report } = await renderDeck(planFor(LONG_TITLE, LONG_SUBTITLE), DEFAULT_SPEC)
    for (const shape of report.shapes.filter(s => s.slide === 1)) {
      assert.equal(layout.canvasViolation(shape.box), null, `${shape.name} escapes the canvas`)
    }
  })

  it('never renders the matric number twice', async () => {
    const { renderDeck } = await renderer()
    const { DEFAULT_SPEC } = await spec()

    const { report } = await renderDeck(planFor(LONG_TITLE), DEFAULT_SPEC)
    const text = report.shapes
      .filter(s => s.slide === 1)
      .map(s => s.text)
      .join(' ')

    const occurrences = text.split('F/HD/24/3410037').length - 1
    assert.equal(occurrences, 1, `matric number appears ${occurrences} times`)
  })

  /**
   * Second production defect on the same slide. The fit ladder dropped the
   * identity block to the 16pt floor while it still had a free line-merge and
   * the subtitle in hand, and the gate then rejected the deck for a type-scale
   * violation it never needed to commit.
   */
  it('keeps the identity block in the body range rather than reaching for the floor', async () => {
    const { renderDeck } = await renderer()
    const { DEFAULT_SPEC } = await spec()

    const { report } = await renderDeck(planFor(LONG_TITLE, LONG_SUBTITLE), DEFAULT_SPEC)
    const identity = report.shapes.find(s => s.name === 'deck-identity')

    assert.ok(identity, 'the identity block was not rendered')
    assert.equal(
      identity.fontPt,
      DEFAULT_SPEC.type.body.minPt,
      `identity is ${identity.fontPt}pt; cheaper concessions were still available`
    )
  })

  it('raises no type-scale error on a full cover page', async () => {
    const { renderDeck } = await renderer()
    const { runStaticChecks } = await qa()
    const { DEFAULT_SPEC } = await spec()

    const plan = planFor(LONG_TITLE, LONG_SUBTITLE)
    const { report } = await renderDeck(plan, DEFAULT_SPEC)

    const scale = runStaticChecks(report, plan, DEFAULT_SPEC).filter(
      f => f.check === 'type-scale' && f.severity === 'error'
    )
    assert.deepEqual(scale, [], scale.map(f => f.message).join('\n'))
  })

  /**
   * The standard reads "body 18-22pt with a 16pt floor". The floor has to be
   * usable, or the ladder's last rung fails the build instead of saving it.
   */
  it('treats the 16pt floor as legal and 15pt as an error', async () => {
    const { runStaticChecks } = await qa()
    const { DEFAULT_SPEC } = await spec()

    const { renderDeck } = await renderer()
    const plan = planFor(LONG_TITLE)
    const { report } = await renderDeck(plan, DEFAULT_SPEC)

    const probe = report.shapes.find(s => s.name === 'deck-identity')!
    const at = (pt: number) => {
      const forged = { ...report, shapes: [{ ...probe, fontPt: pt }] }
      return runStaticChecks(forged, plan, DEFAULT_SPEC).filter(f => f.check === 'type-scale')
    }

    const floor = at(DEFAULT_SPEC.type.bodyAbsoluteMinPt)
    assert.deepEqual(floor.filter(f => f.severity === 'error'), [], '16pt should be legal')
    assert.equal(floor.filter(f => f.severity === 'warning').length, 1, '16pt should warn')

    assert.equal(
      at(DEFAULT_SPEC.type.bodyAbsoluteMinPt - 1).filter(f => f.severity === 'error').length,
      1,
      '15pt is below the floor and must be an error'
    )
  })

  it('does not overflow the closing slide when the detail line is long', async () => {
    const { renderDeck } = await renderer()
    const { runStaticChecks } = await qa()
    const { DEFAULT_SPEC } = await spec()

    const plan = planFor(LONG_TITLE)
    plan.metadata.institution = 'Yaba College of Technology, Yaba, Lagos State, Nigeria'
    const { report } = await renderDeck(plan, DEFAULT_SPEC)

    const overflow = runStaticChecks(report, plan, DEFAULT_SPEC).filter(
      f => f.check === 'overflow' && f.slide === 2
    )
    assert.deepEqual(overflow, [], overflow.map(f => f.message).join('\n'))
  })
})
