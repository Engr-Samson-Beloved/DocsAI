/**
 * Tests for the LLM summarisation layer's failure handling.
 *
 * These are the branches that only execute when a model misbehaves, and a real
 * model cannot be relied on to misbehave on demand. The `clientFactory` seam
 * injects a stub so the repair retry and the fallback are exercised for real
 * rather than assumed to work.
 *
 * The rule being verified throughout: a summarisation UPGRADE must never be
 * able to fail a build that would otherwise have produced a valid deck.
 *
 * Run: npm test
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const llm = () => import('../src/utils/deck/llmSummarize.ts')
const spec = () => import('../src/utils/deck/presentationSpec.ts')

/** A minimal but valid deterministic plan, standing in for the draft. */
function draftPlan() {
  return {
    metadata: {
      title: 'A REAL TITLE', studentName: 'A Student', matricNo: 'F/HD/24/1',
      department: 'Computer Engineering', school: '', institution: 'A College',
      supervisorName: 'A Supervisor', session: '2025/2026', footer: '',
    },
    slides: [
      {
        layout: 'bullets' as const,
        title: 'PROBLEM STATEMENT',
        bullets: ['Congestion degrades enterprise application performance'],
        notes: 'word '.repeat(45),
        takeaway: 'Congestion degrades performance',
        sourceRefs: ['Â§1.2', 'p. 5'],
      },
    ],
  }
}

/** Builds a stub client whose responses are taken from `replies` in order. */
function stubClient(replies: (string | Error)[]) {
  const calls: string[] = []
  const client = {
    getGenerativeModel() {
      return {
        async generateContent(prompt: string) {
          calls.push(prompt)
          const reply = replies.shift()
          if (reply === undefined) throw new Error('no more stubbed replies')
          if (reply instanceof Error) throw reply
          return { response: { text: () => reply } }
        },
      }
    },
  }
  return { client, calls }
}

const goodResponse = JSON.stringify({
  slides: [
    {
      layout: 'bullets',
      title: 'PROBLEM STATEMENT',
      bullets: ['Enterprise congestion degrades application performance measurably'],
      notes: 'spoken '.repeat(45),
      takeaway: 'Congestion has a measurable cost',
      sourceRefs: ['Â§1.2', 'p. 5'],
    },
  ],
})

describe('refinePlanWithLlm', () => {
  it('skips the model entirely when no key is configured', async () => {
    const { refinePlanWithLlm } = await llm()
    const { DEFAULT_SPEC } = await spec()

    const result = await refinePlanWithLlm(draftPlan(), { spec: DEFAULT_SPEC, apiKey: '' })
    assert.equal(result.used, 'deterministic')
    assert.match(result.log.join(' '), /no GEMINI_API_KEY/)
  })

  it('uses the model when it returns a valid plan', async () => {
    const { refinePlanWithLlm } = await llm()
    const { DEFAULT_SPEC } = await spec()
    const { client } = stubClient([goodResponse])

    const result = await refinePlanWithLlm(draftPlan(), {
      spec: DEFAULT_SPEC, apiKey: 'k', clientFactory: async () => client,
    })

    assert.equal(result.used, 'llm')
    assert.match(result.plan.slides[0].bullets![0], /Enterprise congestion/)
  })

  it('repairs on a second attempt after an invalid first response', async () => {
    const { refinePlanWithLlm } = await llm()
    const { DEFAULT_SPEC } = await spec()

    // First reply is well-formed JSON but violates the contract: no notes, so
    // validateSlidePlan rejects the slide. The errors are fed back and the
    // second attempt succeeds.
    const invalid = JSON.stringify({
      slides: [
        {
          layout: 'bullets',
          title: 'PROBLEM STATEMENT',
          bullets: ['Something happens here'],
          notes: 'too short',
          sourceRefs: ['Â§1.2'],
        },
      ],
    })

    const { client, calls } = stubClient([invalid, goodResponse])
    const result = await refinePlanWithLlm(draftPlan(), {
      spec: DEFAULT_SPEC, apiKey: 'k', clientFactory: async () => client,
    })

    assert.equal(result.used, 'llm', result.log.join('\n'))
    assert.equal(calls.length, 2, 'the repair attempt was not made')
    assert.match(calls[1], /previous response was rejected/i, 'the retry did not include the errors')
    assert.match(calls[1], /notes/i, 'the retry did not name the failing field')
  })

  it('falls back to the deterministic plan when every attempt is rejected', async () => {
    const { refinePlanWithLlm } = await llm()
    const { DEFAULT_SPEC } = await spec()

    // Notes below the 25-word floor make the slide irreparable, so every
    // attempt is rejected. Two attempts per model across three models.
    const invalid = JSON.stringify({
      slides: [
        {
          layout: 'bullets',
          title: 'PROBLEM STATEMENT',
          bullets: ['Something happens here'],
          notes: 'far too short',
          sourceRefs: ['Â§1.2'],
        },
      ],
    })
    const { client } = stubClient(Array(6).fill(invalid))

    const result = await refinePlanWithLlm(draftPlan(), {
      spec: DEFAULT_SPEC, apiKey: 'k', clientFactory: async () => client,
    })

    assert.equal(result.used, 'deterministic', result.log.join('\n'))
    assert.deepEqual(result.plan, draftPlan(), 'the draft was not returned untouched')
  })

  it('degrades to the draft content when the model omits fields', async () => {
    const { refinePlanWithLlm } = await llm()
    const { DEFAULT_SPEC } = await spec()

    // A response that names the slide but proposes no text is not a failure:
    // the merge keeps the draft's bullets and notes, and the result validates.
    // Worth pinning down, because it is the difference between "the model added
    // nothing" and "the model broke the deck".
    const sparse = JSON.stringify({ slides: [{ layout: 'bullets', title: 'PROBLEM STATEMENT' }] })
    const { client } = stubClient([sparse])

    const result = await refinePlanWithLlm(draftPlan(), {
      spec: DEFAULT_SPEC, apiKey: 'k', clientFactory: async () => client,
    })

    assert.deepEqual(result.plan.slides[0].bullets, draftPlan().slides[0].bullets)
    assert.ok(result.plan.slides[0].notes.split(/\s+/).length >= 25)
  })

  it('falls back when the model returns text that is not JSON', async () => {
    const { refinePlanWithLlm } = await llm()
    const { DEFAULT_SPEC } = await spec()
    const { client } = stubClient(Array(6).fill('I am afraid I cannot do that.'))

    const result = await refinePlanWithLlm(draftPlan(), {
      spec: DEFAULT_SPEC, apiKey: 'k', clientFactory: async () => client,
    })
    assert.equal(result.used, 'deterministic')
  })

  it('falls back when the transport throws, and never propagates the error', async () => {
    const { refinePlanWithLlm } = await llm()
    const { DEFAULT_SPEC } = await spec()
    const { client } = stubClient([
      new Error('503 model overloaded'),
      new Error('503 model overloaded'),
      new Error('503 model overloaded'),
    ])

    const result = await refinePlanWithLlm(draftPlan(), {
      spec: DEFAULT_SPEC, apiKey: 'k', clientFactory: async () => client,
    })

    assert.equal(result.used, 'deterministic')
    assert.match(result.log.join(' '), /503/)
  })

  it('falls back when the client cannot be constructed', async () => {
    const { refinePlanWithLlm } = await llm()
    const { DEFAULT_SPEC } = await spec()

    const result = await refinePlanWithLlm(draftPlan(), {
      spec: DEFAULT_SPEC,
      apiKey: 'k',
      clientFactory: async () => {
        throw new Error('module missing')
      },
    })
    assert.equal(result.used, 'deterministic')
  })

  it('refuses a response that changes the slide count', async () => {
    const { refinePlanWithLlm } = await llm()
    const { DEFAULT_SPEC } = await spec()

    // A model that "helpfully" adds a slide must not be able to extend the deck.
    const extra = JSON.parse(goodResponse)
    extra.slides.push({ ...extra.slides[0], title: 'INVENTED SLIDE' })
    const { client } = stubClient(Array(6).fill(JSON.stringify(extra)))

    const result = await refinePlanWithLlm(draftPlan(), {
      spec: DEFAULT_SPEC, apiKey: 'k', clientFactory: async () => client,
    })

    assert.equal(result.plan.slides.length, 1)
    assert.ok(!result.plan.slides.some(s => s.title === 'INVENTED SLIDE'))
  })

  it('never lets the model rewrite provenance, but may rewrite the title', async () => {
    const { refinePlanWithLlm } = await llm()
    const { DEFAULT_SPEC } = await spec()

    const tampered = JSON.parse(goodResponse)
    tampered.slides[0].sourceRefs = ['Â§9.9']
    tampered.slides[0].title = 'A DIFFERENT TITLE'
    const { client } = stubClient([JSON.stringify(tampered)])

    const result = await refinePlanWithLlm(draftPlan(), {
      spec: DEFAULT_SPEC, apiKey: 'k', clientFactory: async () => client,
    })

    const slide = result.plan.slides[0]
    assert.deepEqual(slide.sourceRefs, ['Â§1.2', 'p. 5'], 'provenance was overwritten by the model')
    assert.equal(slide.title, 'A DIFFERENT TITLE', 'the model may rename a slide; the gate polices the result')
    assert.equal(slide.layout, 'bullets')
  })
})
