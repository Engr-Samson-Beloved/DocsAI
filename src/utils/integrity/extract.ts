/**
 * Document -> normalised text, the first stage of the pipeline.
 *
 * Detection providers score prose. Sending them our markup would spend credits
 * on `<p style="text-align:justify">` and, worse, corrupt the scores: an AI
 * detector reading tag soup is measuring the editor, not the student.
 *
 * So this module flattens a project down to plain text and, separately, records
 * where each heading starts. The offsets are what let the dashboard highlight a
 * flagged sentence and the report say "section 2.1" — without either of them
 * having to store the prose a second time.
 *
 * Two input shapes, because the app has two:
 *   - Tiptap JSON (`doc > page > block`), which is what `Project.content` holds
 *     today. Parsed structurally, so headings are headings.
 *   - HTML, the legacy content format and what an import produces before it is
 *     saved. Parsed with a tag scanner rather than a DOM, because this runs
 *     server-side too and `document` does not exist there.
 *
 * Runs in both environments deliberately: the client uses it to show a word
 * count and cost estimate before the user commits, and the server uses it again
 * on submission rather than trusting a number the browser sent.
 */

/** Blocks whose text is structural noise, not the student's writing. */
const SKIPPED_NODE_TYPES = new Set(['tocItem', 'image', 'horizontalRule'])

/** Tiptap node types that begin a new heading scope. */
const HEADING_TYPES = new Set(['heading'])

export interface ExtractedSection {
  /** Character offset into `text` where this section's heading begins. */
  offset: number
  /** Heading text, trimmed. */
  title: string
  /** 1-6. Cover/untitled content is level 0. */
  level: number
}

export interface ExtractedDocument {
  /** Normalised plain text: paragraphs separated by a single blank line. */
  text: string
  /** Headings in document order, each with its offset into `text`. */
  sections: ExtractedSection[]
  wordCount: number
  characterCount: number
  /** Content hash of the normalised text — the §21 cache key. */
  contentHash: string
}

/**
 * Cheap, stable content hash.
 *
 * Same djb2 construction as `db.ts:hashContent`, duplicated rather than
 * imported because that module is `"use client"` and pulls IndexedDB in with
 * it; importing it from a route handler would drag the browser store into the
 * server bundle. The algorithm is four lines and is covered by a test that
 * asserts the two stay in agreement.
 */
export function hashText(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36) + ':' + text.length.toString(36)
}

/** Words as a detector counts them: whitespace-separated runs with a letter or digit. */
export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu)
  return matches ? matches.length : 0
}

interface Block {
  text: string
  heading?: { level: number }
}

/* ── Tiptap JSON ──────────────────────────────────────────────────── */

interface TiptapNode {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
}

/** Concatenates the inline text of a node, ignoring marks. */
function inlineText(node: TiptapNode): string {
  if (typeof node.text === 'string') return node.text
  if (!Array.isArray(node.content)) return ''
  return node.content.map(inlineText).join('')
}

function collectBlocks(node: TiptapNode, out: Block[]): void {
  const type = node.type || ''

  if (SKIPPED_NODE_TYPES.has(type)) return

  // Leaf-ish blocks: take their whole inline run as one paragraph.
  if (
    type === 'paragraph' ||
    type === 'heading' ||
    type === 'listItem' ||
    type === 'blockquote' ||
    type === 'tableCell' ||
    type === 'tableHeader'
  ) {
    const text = inlineText(node).replace(/\s+/g, ' ').trim()
    if (text) {
      const level = Number(node.attrs?.level) || 1
      out.push(HEADING_TYPES.has(type) ? { text, heading: { level } } : { text })
    }
    // A blockquote or list item can nest further blocks; a paragraph cannot.
    if (type === 'paragraph' || type === 'heading') return
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) collectBlocks(child, out)
  }
}

/* ── HTML ─────────────────────────────────────────────────────────── */

/** Tags that end a paragraph when they close. */
const BLOCK_TAGS = new Set([
  'p', 'div', 'li', 'blockquote', 'td', 'th', 'tr', 'section', 'article',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'figcaption', 'pre',
])

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    const named = NAMED_ENTITIES[body.toLowerCase()]
    return named === undefined ? whole : named
  })
}

/**
 * Flattens HTML to blocks with a tag scanner.
 *
 * Not a DOM parse and not trying to be: it needs to survive on the server and
 * the only structure that matters downstream is "where does a paragraph end"
 * and "is this a heading". `<script>`/`<style>` bodies are dropped outright
 * because their contents are not prose and would otherwise be scored.
 */
function blocksFromHtml(html: string): Block[] {
  const out: Block[] = []
  let buffer = ''
  let heading: { level: number } | undefined
  let skipUntil: string | null = null

  const flush = () => {
    const text = decodeEntities(buffer).replace(/\s+/g, ' ').trim()
    if (text) out.push(heading ? { text, heading } : { text })
    buffer = ''
    heading = undefined
  }

  const tagPattern = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = tagPattern.exec(html)) !== null) {
    const [raw, rawName] = match
    const name = rawName.toLowerCase()
    const closing = raw[1] === '/'

    if (skipUntil) {
      if (closing && name === skipUntil) skipUntil = null
      cursor = tagPattern.lastIndex
      continue
    }

    buffer += html.slice(cursor, match.index)
    cursor = tagPattern.lastIndex

    // Text already gathered stays; everything until the matching close is
    // discarded, so stylesheet and script bodies are never scored as prose.
    if (!closing && (name === 'script' || name === 'style')) {
      skipUntil = name
      continue
    }

    if (BLOCK_TAGS.has(name)) {
      if (!closing && /^h[1-6]$/.test(name)) {
        flush()
        heading = { level: Number(name[1]) }
      } else {
        flush()
      }
    }
  }

  buffer += html.slice(cursor)
  flush()
  return out
}

/* ── public API ───────────────────────────────────────────────────── */

/**
 * Normalises whatever `Project.content` holds into text plus a section map.
 *
 * Accepts the stringified Tiptap JSON the editor saves, a raw Tiptap object,
 * or HTML. Detection is by shape rather than by a flag from the caller,
 * because the app has documents saved in both formats and the caller usually
 * does not know which it is holding.
 */
export function extractDocumentText(content: string | object): ExtractedDocument {
  let blocks: Block[]

  if (typeof content === 'object' && content !== null) {
    blocks = []
    collectBlocks(content as TiptapNode, blocks)
  } else {
    const raw = String(content ?? '').trim()
    let parsed: unknown = null
    if (raw.startsWith('{') || raw.startsWith('[')) {
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = null
      }
    }

    if (parsed && typeof parsed === 'object') {
      blocks = []
      collectBlocks(parsed as TiptapNode, blocks)
    } else {
      blocks = blocksFromHtml(raw)
    }
  }

  const sections: ExtractedSection[] = []
  const pieces: string[] = []
  let offset = 0

  for (const block of blocks) {
    if (block.heading) {
      sections.push({ offset, title: block.text, level: block.heading.level })
    }
    pieces.push(block.text)
    // Paragraphs are joined by a blank line, which is what providers expect as
    // a paragraph boundary and what keeps sentence splitters from running two
    // paragraphs together into one nonsensical sentence.
    offset += block.text.length + 2
  }

  const text = pieces.join('\n\n')

  return {
    text,
    sections,
    wordCount: countWords(text),
    characterCount: text.length,
    contentHash: hashText(text),
  }
}

/**
 * Builds the offset -> heading resolver providers hand back to us.
 *
 * Binary search rather than a linear scan: a dissertation can carry a few
 * hundred headings and a provider can return a few thousand flagged spans, and
 * the naive version made that a visible pause on the dashboard.
 */
export function sectionResolver(
  sections: ExtractedSection[]
): (offset: number) => string | undefined {
  if (!sections.length) return () => undefined

  return (offset: number) => {
    let lo = 0
    let hi = sections.length - 1
    let found: ExtractedSection | undefined

    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (sections[mid].offset <= offset) {
        found = sections[mid]
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return found?.title
  }
}

/**
 * Splits text into provider-sized pieces at paragraph boundaries.
 *
 * Copyleaks caps a single AI-detection call at 100,000 characters, which a
 * dissertation exceeds. Cutting mid-sentence would hand the detector a
 * fragment and get back a score for a fragment, so the split always lands on a
 * paragraph break — falling back to a sentence break, then to a hard cut, for
 * the pathological single-paragraph document.
 *
 * Each chunk carries its own offset so flagged spans can be translated back
 * into positions in the whole document.
 */
export function chunkText(
  text: string,
  maxCharacters: number
): { text: string; offset: number }[] {
  if (text.length <= maxCharacters) return [{ text, offset: 0 }]

  const chunks: { text: string; offset: number }[] = []
  let cursor = 0

  while (cursor < text.length) {
    if (text.length - cursor <= maxCharacters) {
      chunks.push({ text: text.slice(cursor), offset: cursor })
      break
    }

    const limit = cursor + maxCharacters
    let cut = text.lastIndexOf('\n\n', limit)
    if (cut <= cursor) cut = text.lastIndexOf('. ', limit)
    if (cut <= cursor) cut = limit
    else cut += 1 // keep the terminator with the chunk it ends

    chunks.push({ text: text.slice(cursor, cut).trim(), offset: cursor })
    cursor = cut
    // Skip the whitespace we split on so the next chunk starts on prose.
    while (cursor < text.length && /\s/.test(text[cursor])) cursor++
  }

  return chunks.filter(chunk => chunk.text.length > 0)
}
