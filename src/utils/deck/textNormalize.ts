/**
 * textNormalize.ts
 * ------------------------------------------------------------------
 * Turns raw extracted document text into clean sentences, and screens
 * candidate bullets for the defects that made the shipped deck unreadable.
 *
 * Why this module exists
 * ----------------------
 * The PDF extractor emitted one paragraph per PDF *layout line*, so the deck's
 * bullets were raw line slices, capitalised and bulleted:
 *
 *   "Network congestion in enterprise environments occurs when the volume of
 *    data attempting"
 *   "Preconfigured based on anticipated traffic patterns, and changes to
 *    network behavior require time-"
 *   "Globe have explored SDN from multiple angles - architectural design,"
 *
 * Each starts or ends mid-sentence. One ends on a PDF line-break hyphen that
 * was never rejoined. One opens on "Globe" because the source line was
 * "...across the globe have explored...".
 *
 * Nothing downstream can recover from that, so normalisation happens FIRST:
 * de-hyphenate, rejoin wrapped lines, keep true paragraph breaks, then segment
 * into real sentences. `lintBullet` is the backstop that refuses anything that
 * still reads as somebody else's half-sentence.
 */

// --- Line and hyphen repair -----------------------------------------

/**
 * Rejoins words split across a line break by a typesetting hyphen:
 * "conges-\ntion" -> "congestion".
 *
 * Only a hyphen directly between two word characters at a line break is
 * removed. A hyphen with surrounding whitespace ("time - based") is an em-dash
 * substitute and is left alone, and a genuine compound that happens to wrap
 * ("state-\nof-the-art") rejoins to "state-of-the-art" because the following
 * segment starts a new hyphenated part.
 */
/**
 * Second halves of compounds that are genuinely hyphenated in English. When a
 * line break falls inside one of these, the hyphen belongs to the word and must
 * survive - otherwise "bandwidth-\nintensive" rejoins as "bandwidthintensive".
 */
const COMPOUND_TAILS =
  /^(intensive|based|driven|aware|specific|oriented|related|defined|level|side|wide|scale|time|critical|effective|efficient|friendly|free|only|like|type|style|grained|hop|end|to|and|or|of|in|on|by)\b/i

export function dehyphenate(text: string): string {
  // Soft hyphen: an explicit "break here" character that must never survive.
  let out = text.replace(/­/g, '')

  // word- \n word  ->  wordword   (the typesetting case), unless the tail is a
  // recognised compound suffix, in which case the hyphen is real.
  out = out.replace(/([a-z])-[ \t]*\r?\n[ \t]*([a-z]\w*)/g, (match, head: string, tail: string) =>
    COMPOUND_TAILS.test(tail) ? `${head}-${tail}` : `${head}${tail}`
  )

  // A following capital almost always signals a real compound
  // ("Software-\nDefined"), so that hyphen is kept.
  out = out.replace(/([A-Za-z])-[ \t]*\r?\n[ \t]*([A-Z])/g, '$1-$2')

  return out
}

/**
 * True when a line ends mid-sentence and the next line continues it.
 *
 * A paragraph break is signalled by terminal punctuation, a blank line, a
 * bullet/number opening the next line, or a heading-shaped next line.
 */
function continuesOnNextLine(line: string, next: string): boolean {
  const a = line.trim()
  const b = next.trim()
  if (!a || !b) return false

  // Terminal punctuation ends the sentence - unless it is an abbreviation dot.
  if (/[.!?:;]["')\]]?$/.test(a) && !/\b(?:[A-Z]|Fig|Eq|No|Vol|pp|Dr|Prof|Mr|Mrs|Ms|St|approx|etc|al|e\.g|i\.e|cf|vs)\.$/i.test(a)) {
    return false
  }

  // The next line opens a list item, a numbered heading, or a new block.
  if (/^([•‣▶▸*]|\(?[a-z]\)|\(?[ivx]+\)|\d+[.)])\s/i.test(b)) return false
  if (/^\d+\.\d/.test(b)) return false

  // The next line is an ALL-CAPS heading.
  if (b.length < 80 && b === b.toUpperCase() && /[A-Z]{3}/.test(b)) return false

  return true
}

/**
 * Joins lines that are continuations of the same paragraph, while preserving
 * genuine paragraph breaks as blank lines.
 *
 * This is the step whose absence produced one bullet per PDF line.
 */
export function joinWrappedLines(text: string): string {
  const lines = dehyphenate(text).split(/\r?\n/)
  const out: string[] = []
  let buffer = ''

  const flush = () => {
    if (buffer.trim()) out.push(buffer.trim())
    buffer = ''
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (!line.trim()) {
      flush()
      continue
    }

    buffer = buffer ? `${buffer} ${line.trim()}` : line.trim()

    const next = lines[i + 1] ?? ''
    if (!continuesOnNextLine(line, next)) flush()
  }
  flush()

  return out.join('\n\n')
}

/** Collapses runs of whitespace and strips characters that survive import as noise. */
export function collapseWhitespace(text: string): string {
  return text
    .replace(/[�￼]/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .trim()
}

/** The full pre-processing pass: run this before anything else sees the text. */
export function normalizeExtractedText(raw: string): string {
  return collapseWhitespace(joinWrappedLines(raw))
}

// --- Sentence segmentation ------------------------------------------

/**
 * Abbreviations whose trailing dot must not end a sentence. Protected with a
 * sentinel before segmentation and restored after, because neither ICU's
 * sentence breaker nor a regex handles "Fig. 3 shows" reliably on its own.
 */
const ABBREVIATIONS =
  /\b(Fig|Figs|Eq|Eqs|No|Nos|Vol|pp|p|Dr|Prof|Mr|Mrs|Ms|Sr|Jr|St|Inc|Ltd|Co|Univ|Dept|approx|est|etc|al|e\.g|i\.e|cf|vs|Ch|Sec|Ref|Refs)\./gi

const DOT = ''

function protectDots(text: string): string {
  return text
    .replace(ABBREVIATIONS, m => m.replace(/\./g, DOT))
    // Decimals and version numbers: "20.5%", "IEEE 802.1Q", "Section 2.3".
    .replace(/(\d)\.(\d)/g, `$1${DOT}$2`)
    // Single initials: "J. Smith".
    .replace(/\b([A-Z])\.(?=\s+[A-Z])/g, `$1${DOT}`)
}

function restoreDots(text: string): string {
  return text.split(DOT).join('.')
}

/**
 * Splits prose into sentences using `Intl.Segmenter` where available, which is
 * a real ICU sentence breaker rather than a punctuation split.
 *
 * The previous code called `split("\n")`, which is why every bullet was a
 * layout line. There is a regex fallback for runtimes without Segmenter, but it
 * operates on protected text so abbreviations survive either path.
 */
export function segmentSentences(text: string, locale = 'en'): string[] {
  const source = collapseWhitespace(text).replace(/\n+/g, ' ')
  if (!source) return []

  const protectedText = protectDots(source)
  let pieces: string[]

  const Segmenter = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter
  if (typeof Segmenter === 'function') {
    const segmenter = new Segmenter(locale, { granularity: 'sentence' })
    pieces = Array.from(segmenter.segment(protectedText), s => s.segment)
  } else {
    // Split after terminal punctuation followed by an opening capital/quote.
    pieces = protectedText.split(/(?<=[.!?])["')\]]?\s+(?=["'(\[]?[A-Z0-9])/)
  }

  return pieces.map(s => restoreDots(s).trim()).filter(Boolean)
}

/** Segments a normalised document body, respecting paragraph boundaries. */
export function segmentParagraphs(text: string, locale = 'en'): string[][] {
  return normalizeExtractedText(text)
    .split(/\n{2,}/)
    .map(p => segmentSentences(p, locale))
    .filter(sentences => sentences.length > 0)
}

// --- Bullet linting --------------------------------------------------

export type BulletProblem =
  | 'empty'
  | 'contains-newline'
  | 'literal-bullet-glyph'
  | 'starts-lowercase'
  | 'starts-conjunction'
  | 'dangling-end'
  | 'no-verb'
  | 'unbalanced-brackets'
  | 'too-long'
  | 'duplicate'

export interface BulletLintOptions {
  maxWords?: number
  /**
   * Require a finite verb. Appropriate for candidates sliced out of source
   * prose, where a missing verb means the clause was cut. The summariser's own
   * output is allowed deliberate noun phrases ("Three-layer SDN architecture"),
   * so that stage passes `requireVerb: false`.
   */
  requireVerb?: boolean
  /** Lowercased bullets already accepted on this deck, for duplicate detection. */
  seen?: Set<string>
}

/** Words that cannot open an independent statement on a slide. */
const OPENING_CONJUNCTIONS =
  /^(and|but|or|nor|yet|so|which|that|because|although|though|whereas|while|since|unless|until|whether|thus|hence|therefore|however|moreover|furthermore)\b/i

/**
 * Common finite verbs and auxiliaries, plus inflection shapes. A full POS
 * tagger is not worth the dependency here: this only has to catch clauses that
 * were sliced out of the middle of a sentence, which almost always lose their
 * verb along with their subject.
 */
const AUXILIARIES = new Set(
  ('is are was were be been being am has have had do does did can could may might must shall should ' +
    'will would enables enable allows allow provides provide requires require uses use offers offer ' +
    'supports support reduces reduce increases increase improves improve creates create causes cause ' +
    'shows show demonstrates demonstrate achieves achieve remains remain becomes become includes include ' +
    'consists comprises delivers deliver eliminates eliminate introduces introduce')
    .split(/\s+/)
)

function hasVerb(text: string): boolean {
  const words = text.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/).filter(Boolean)
  if (words.length === 0) return false

  for (const w of words) {
    if (AUXILIARIES.has(w)) return true
    // Inflected forms: -ed, -ing, -ises/-izes, -ates. Length-guarded so that
    // "network", "during" and "string" do not read as verbs.
    if (w.length > 4 && /(?:ed|ing|ises|izes|ates|ifies)$/.test(w) && !/^(during|string|nothing|something)$/.test(w)) {
      return true
    }
  }
  return false
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/**
 * Returns every problem with a candidate bullet. Empty array means it is
 * presentable.
 */
export function lintBullet(text: string, options: BulletLintOptions = {}): BulletProblem[] {
  const { maxWords = 14, requireVerb = true, seen } = options
  const problems: BulletProblem[] = []
  const s = text.trim()

  if (!s) return ['empty']

  if (/[\r\n]/.test(text)) problems.push('contains-newline')
  if (/[•‣▶▸·]/.test(text)) problems.push('literal-bullet-glyph')

  if (/^[a-z]/.test(s)) problems.push('starts-lowercase')
  if (OPENING_CONJUNCTIONS.test(s)) problems.push('starts-conjunction')

  // A trailing comma, semicolon or hyphen means the thought was cut short.
  if (/[,;\-–—]$/.test(s)) problems.push('dangling-end')

  const open = (s.match(/\(/g) || []).length
  const close = (s.match(/\)/g) || []).length
  if (open !== close) problems.push('unbalanced-brackets')

  if (wordCount(s) > maxWords) problems.push('too-long')

  if (requireVerb && !hasVerb(s)) problems.push('no-verb')

  if (seen) {
    const key = duplicateKey(s)
    if (seen.has(key)) problems.push('duplicate')
  }

  return problems
}

/**
 * Normalised form used for duplicate detection: case, punctuation and
 * stopwords removed, so "The SDN controller manages flows" and "SDN controller
 * manages the flows" collide.
 */
export function duplicateKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !/^(the|a|an|of|to|in|for|on|with|by|as|is|are|and|or|that|this|it|its)$/.test(w))
    .join(' ')
    .trim()
}

export function isPresentableBullet(text: string, options: BulletLintOptions = {}): boolean {
  return lintBullet(text, options).length === 0
}
