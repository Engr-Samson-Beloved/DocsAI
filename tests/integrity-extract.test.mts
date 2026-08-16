/**
 * Text extraction and chunking.
 *
 * These are the numbers everything downstream is billed and scored against: if
 * extraction is wrong, the word count is wrong, the cache key is wrong, and
 * every flagged offset points at the wrong sentence.
 *
 * Run: npm test
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const extract = () => import('../src/utils/integrity/extract.ts')

/** A minimal Tiptap document in the app's own shape: doc > page > blocks. */
function tiptap(blocks: unknown[]) {
  return JSON.stringify({
    type: 'doc',
    content: [{ type: 'page', content: blocks }],
  })
}

const heading = (level: number, text: string) => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
})

const paragraph = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
})

describe('extractDocumentText', () => {
  it('flattens Tiptap JSON to prose and records heading offsets', async () => {
    const { extractDocumentText } = await extract()

    const result = extractDocumentText(
      tiptap([
        heading(1, 'INTRODUCTION'),
        paragraph('The first paragraph of the study.'),
        heading(2, '1.1 Background'),
        paragraph('Background prose goes here.'),
      ])
    )

    assert.equal(
      result.text,
      'INTRODUCTION\n\nThe first paragraph of the study.\n\n1.1 Background\n\nBackground prose goes here.'
    )
    assert.equal(result.sections.length, 2)
    assert.equal(result.sections[0].title, 'INTRODUCTION')
    assert.equal(result.sections[0].offset, 0)
    assert.equal(result.sections[1].title, '1.1 Background')

    // The recorded offset must actually be where the heading sits, or every
    // flagged span attributed to it names the wrong chapter.
    assert.equal(
      result.text.slice(result.sections[1].offset, result.sections[1].offset + 14),
      '1.1 Background'
    )
  })

  it('carries no markup through to the providers', async () => {
    const { extractDocumentText } = await extract()

    const result = extractDocumentText(
      '<p style="text-align:justify">Justified <strong>prose</strong>.</p><p>Second.</p>'
    )

    assert.equal(result.text, 'Justified prose.\n\nSecond.')
    assert.ok(!result.text.includes('<'), 'no tags may reach a detector')
    assert.ok(!result.text.includes('text-align'), 'no CSS may reach a detector')
  })

  it('drops script and style bodies rather than scoring them as prose', async () => {
    const { extractDocumentText } = await extract()

    const result = extractDocumentText(
      '<style>.x{color:red}</style><p>Real prose.</p><script>alert(1)</script>'
    )

    assert.equal(result.text, 'Real prose.')
  })

  it('decodes entities so the provider sees the characters the reader sees', async () => {
    const { extractDocumentText } = await extract()

    const result = extractDocumentText('<p>Ohm&rsquo;s law &amp; Kirchhoff&#39;s rules</p>')
    assert.equal(result.text, 'Ohm’s law & Kirchhoff\'s rules')
  })

  it('skips cached TOC entries, which are page numbers rather than writing', async () => {
    const { extractDocumentText } = await extract()

    const result = extractDocumentText(
      tiptap([
        { type: 'tocItem', attrs: { level: 1, page: 4 }, content: [{ type: 'text', text: 'Chapter One' }] },
        paragraph('Actual content.'),
      ])
    )

    assert.equal(result.text, 'Actual content.')
  })

  it('counts words the way a detector bills them', async () => {
    const { extractDocumentText } = await extract()

    const result = extractDocumentText('<p>One two three-four don’t 5</p>')
    // "three-four" and "don’t" are single words; the numeral counts.
    assert.equal(result.wordCount, 5)
  })

  it('produces an empty result for an empty document rather than throwing', async () => {
    const { extractDocumentText } = await extract()

    for (const empty of ['', '<p></p>', tiptap([])]) {
      const result = extractDocumentText(empty)
      assert.equal(result.text, '')
      assert.equal(result.wordCount, 0)
    }
  })

  it('hashes identical content identically and changed content differently', async () => {
    const { extractDocumentText } = await extract()

    const a = extractDocumentText('<p>Unchanged sentence.</p>')
    const b = extractDocumentText('<p>Unchanged sentence.</p>')
    const c = extractDocumentText('<p>Unchanged sentence!</p>')

    assert.equal(a.contentHash, b.contentHash, 'the cache key must be stable')
    assert.notEqual(a.contentHash, c.contentHash, 'an edit must invalidate the cache')
  })

  it('hashes the same way db.ts does, since the two must agree', async () => {
    const { hashText } = await extract()

    // db.ts:hashContent, reproduced. The duplication is deliberate (extract.ts
    // must not import a "use client" module) and this test is what keeps the
    // two implementations honest.
    const reference = (text: string) => {
      let h = 5381
      for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
      return (h >>> 0).toString(36) + ':' + text.length.toString(36)
    }

    for (const sample of ['', 'a', 'A longer sentence with punctuation, and numbers 123.']) {
      assert.equal(hashText(sample), reference(sample))
    }
  })
})

describe('sectionResolver', () => {
  it('attributes an offset to the heading it falls under', async () => {
    const { extractDocumentText, sectionResolver } = await extract()

    const doc = extractDocumentText(
      tiptap([
        heading(1, 'CHAPTER ONE'),
        paragraph('Alpha prose.'),
        heading(2, '2.1 Method'),
        paragraph('Beta prose.'),
      ])
    )
    const resolve = sectionResolver(doc.sections)

    assert.equal(resolve(doc.text.indexOf('Alpha')), 'CHAPTER ONE')
    assert.equal(resolve(doc.text.indexOf('Beta')), '2.1 Method')
  })

  it('returns undefined for text before the first heading', async () => {
    const { sectionResolver } = await extract()
    const resolve = sectionResolver([{ offset: 100, title: 'LATER', level: 1 }])
    assert.equal(resolve(10), undefined)
  })

  it('returns undefined when the document has no headings at all', async () => {
    const { sectionResolver } = await extract()
    assert.equal(sectionResolver([])(0), undefined)
  })
})

describe('chunkText', () => {
  it('returns a single chunk when the text already fits', async () => {
    const { chunkText } = await extract()
    const chunks = chunkText('short text', 1000)
    assert.equal(chunks.length, 1)
    assert.equal(chunks[0].offset, 0)
  })

  it('splits on paragraph boundaries, never mid-sentence', async () => {
    const { chunkText } = await extract()

    const paragraphs = Array.from({ length: 40 }, (_, i) => `Paragraph number ${i} of the study.`)
    const text = paragraphs.join('\n\n')
    const chunks = chunkText(text, 200)

    assert.ok(chunks.length > 1, 'a document over the limit must be split')
    for (const chunk of chunks) {
      assert.ok(chunk.text.length <= 200 + 40, 'chunks stay near the limit')
      // A chunk that begins mid-sentence would be scored as a fragment.
      assert.ok(/^Paragraph number \d+/.test(chunk.text), `bad chunk start: ${chunk.text.slice(0, 30)}`)
    }
  })

  it('keeps offsets that map back into the original text', async () => {
    const { chunkText } = await extract()

    const text = Array.from({ length: 30 }, (_, i) => `Sentence ${i} here.`).join('\n\n')
    const chunks = chunkText(text, 120)

    for (const chunk of chunks) {
      assert.equal(
        text.slice(chunk.offset, chunk.offset + chunk.text.length),
        chunk.text,
        'a chunk offset must locate that chunk in the whole document'
      )
    }
  })

  it('still splits a pathological single-paragraph document', async () => {
    const { chunkText } = await extract()

    const text = 'x'.repeat(5000)
    const chunks = chunkText(text, 1000)

    assert.ok(chunks.length >= 5)
    assert.equal(chunks.map(c => c.text).join('').length, 5000)
  })
})
