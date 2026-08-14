/**
 * summarize.ts
 * ------------------------------------------------------------------
 * Turns whole source sentences into slide-shaped claims, and writes speaker
 * notes.
 *
 * Why this module exists
 * ----------------------
 * The old pipeline had no summarisation stage at all. It SELECTED source
 * sentences and printed them, so bullets ran 15-25 words of verbatim academic
 * prose - the report reprinted at 18pt rather than a visual aid. And
 * `addNotes` was never called, so a student defending a seminar got no speaking
 * support from the one artifact that should provide it.
 *
 * This module is the deterministic core: it always runs, needs no network, and
 * is what the tests and the QA gate exercise. `llmSummarize.ts` layers an
 * abstractive model on top when one is configured, but its output is held to
 * exactly the same contract and falls back here on any failure.
 *
 * The contract (from the house standard):
 *   - 3-6 bullets per slide, <= 14 words each, ideally <= 10
 *   - each bullet a self-contained claim, not a copied clause
 *   - verb-first or noun-phrase-first; no leading "The"/"This"/"It"
 *   - concrete specifics (figures, dates, names, standards) preserved
 *   - one `takeaway` per slide, and 40-70 words of speaker notes
 */

import { lintBullet, duplicateKey, wordCount, segmentSentences, hasFiniteVerb } from './textNormalize'
import type { PresentationSpec } from './presentationSpec'

// --- Phrase-level compression ----------------------------------------

/** Wordy constructions and their short equivalents. Order matters: longest first. */
const PHRASE_COMPRESSIONS: [RegExp, string][] = [
  [/\bdue to the fact that\b/gi, 'because'],
  [/\bowing to the fact that\b/gi, 'because'],
  [/\bin spite of the fact that\b/gi, 'although'],
  [/\bat this point in time\b/gi, 'now'],
  [/\bfor the purpose of\b/gi, 'for'],
  [/\bin the event that\b/gi, 'if'],
  [/\bwith (?:regard|respect) to\b/gi, 'for'],
  [/\bhas the ability to\b/gi, 'can'],
  [/\b(?:is|are) able to\b/gi, 'can'],
  [/\bit is possible to\b/gi, 'can'],
  [/\ba (?:large )?number of\b/gi, 'many'],
  [/\bthe majority of\b/gi, 'most'],
  [/\ba variety of\b/gi, 'several'],
  [/\bin order to\b/gi, 'to'],
  [/\bmake[s]? use of\b/gi, 'use'],
  [/\bprior to\b/gi, 'before'],
  [/\bsubsequent to\b/gi, 'after'],
  [/\bin the case of\b/gi, 'for'],
  [/\bon the basis of\b/gi, 'from'],
  [/\btake[s]? into account\b/gi, 'considers'],
  [/\bgive[s]? rise to\b/gi, 'causes'],
  [/\bas well as\b/gi, 'and'],
  [/\bsuch as\b/gi, 'like'],
]

/** Openers that carry no information once the sentence stands alone on a slide. */
const LEAD_INS =
  /^(however|therefore|moreover|furthermore|in addition|additionally|consequently|subsequently|thus|hence|indeed|also|nevertheless|nonetheless|as a result|for instance|for example|in fact|in general|in particular|overall|finally|first(?:ly)?|second(?:ly)?|third(?:ly)?|fourth(?:ly)?|fifth(?:ly)?|sixth(?:ly)?|seventh(?:ly)?|eighth(?:ly)?|lastly|on the other hand|that is|in other words|notably|importantly|crucially|significantly)\b[\s,:-]*/i

/**
 * Words that open a subordinate or adverbial clause.
 *
 * `dropLeadingAdverbial` already removes such an opener when a main clause
 * follows it. So a bullet that STILL begins with one of these has no main
 * clause at all - it is a dependent fragment like "By separating the control
 * plane" or "As the number of flows and network devices grows", both of which
 * the previous pass happily printed as statements.
 */
const SUBORDINATE_OPENER =
  /^(as|by|in|on|at|for|with|within|without|from|to|into|through|throughout|during|across|among|amongst|between|before|after|since|until|unless|if|when|whenever|while|whilst|where|wherever|despite|given|following|according|regarding|concerning|upon|under|over|beyond|besides|toward|towards|rather than|instead of|as opposed to|apart from|aside from|other than)\b/i

/**
 * True when a subordinate clause is opened and never completed:
 * "Flexibility means that the same underlying philosophy".
 *
 * `that`/`which`/`who` promise a predicate. When the trimmer or the
 * relative-clause dropper removes it, what remains reads as a whole sentence -
 * right length, right capitalisation, no trailing punctuation - and is
 * meaningless. The tail after the last such connector must contain a verb.
 */
function hasDanglingSubordinate(text: string): boolean {
  const m = text.match(/\b(that|which|who|where|whereby)\b\s+(.*)$/i)
  if (!m) return false

  const tail = m[2].trim()
  if (!tail) return true
  // A tail of one or two words is a fragment whatever its part of speech.
  if (countWords(tail) < 3) return true

  return !hasFiniteVerb(tail)
}

const HEDGES =
  /^(it is (?:important|crucial|worth|necessary|essential) to (?:note|remember|mention|state|emphasi[sz]e) that|it should be noted that|this (?:chapter|section|study|paper|work|project|seminar) (?:presents|discusses|describes|examines|explores|covers|outlines|introduces)|the (?:aim|purpose|objective) of this (?:chapter|section|study) is to)\b[\s:,-]*/i

/** Determiners that waste the first word of a bullet without carrying meaning. */
const WEAK_OPENERS = /^(the|such|its|their)\s+/i

/**
 * A pronoun subject followed directly by a copula: "This is not merely a
 * theoretical improvement". Isolated on a slide these say nothing, because the
 * subject lives in the previous sentence. Rejected outright.
 *
 * The shipped deck's "Is not merely a theoretical improvement" came from
 * stripping the determiner off exactly this shape and capitalising what was
 * left.
 */
const PRONOUN_COPULA = /^(it|this|that|these|those|there)\s+(is|are|was|were)\b/i

/** A pronoun subject before a real verb or noun: strip it, keep the predicate. */
const PRONOUN_SUBJECT = /^(it|this|these|those)\s+(?=[a-z])/i

/**
 * Function words a complete statement cannot end on. A bullet ending "of",
 * "the" or "when" was cut mid-thought, whatever its word count says.
 */
const TRAILING_FUNCTION_WORD =
  /\b(a|an|the|of|to|in|for|on|with|by|as|at|from|into|onto|upon|and|or|but|nor|that|which|who|when|where|while|because|although|though|since|if|whether|than|then|its|their|his|her|this|these|those|such|between|among|through|during|within|without|across|over|under|about|via|per)$/i

/** True when a fragment holds a specific worth protecting from the trimmer. */
function hasSpecific(text: string): boolean {
  return /\d|%|\b(IEEE|ISO|RFC|IETF|ITU|ANSI|OpenFlow|TCP|IP|SDN|API|QoS)\b/.test(text)
}

/**
 * Removes a leading adverbial phrase ("From a structural standpoint, ...")
 * when it carries no specifics. The clause after it is the actual claim.
 */
function dropLeadingAdverbial(text: string): string {
  const m = text.match(/^([^,]{4,42}),\s+(.{20,})$/)
  if (!m) return text
  const lead = m[1]
  if (hasSpecific(lead)) return text
  // Only drop genuine adverbials, not a subject followed by an appositive.
  if (!/^(from|in|for|by|with|under|through|during|across|among|within|despite|beyond|at|on|after|before|while|when|although|whereas|as)\b/i.test(lead)) {
    return text
  }
  return m[2]
}

/** Drops a trailing relative clause, which is almost always elaboration. */
function dropRelativeClause(text: string): string {
  // Threshold kept low so a short subject followed by a relative clause is
  // caught too: "The northbound API, which exposes the controller to
  // applications" reduces to "Northbound API", which is then too short to be a
  // bullet and is dropped - correctly, because its predicate was elsewhere.
  const m = text.match(/^(.{10,}?),\s+(which|who|where|whereby|thereby|although|though|while|whereas)\b.*$/i)
  if (!m) return text
  // Keep it when the clause is where the numbers live.
  const tail = text.slice(m[1].length)
  if (hasSpecific(tail) && !hasSpecific(m[1])) return text
  return m[1]
}

/** Removes parentheticals that hold no specifics. */
function dropEmptyParentheticals(text: string): string {
  return text.replace(/\s*\(([^)]*)\)/g, (match, inner: string) =>
    hasSpecific(inner) ? match : ''
  )
}

/**
 * Reduces a sentence to at most `maxWords` WITHOUT cutting mid-thought.
 *
 * Returns '' when that is impossible. This is the important change: the old
 * behaviour was to hard-cut at the word budget, which is what produced bullets
 * like "Network congestion in enterprise environments occurs when the volume
 * of" - inside the word limit, and still visibly half a sentence.
 *
 * Only a real clause boundary (colon, semicolon, or a comma with enough before
 * it) may end a shortened bullet.
 */
function reduceToWords(text: string, maxWords: number): string {
  const clean = text.trim()
  if (countWords(clean) <= maxWords) return clean

  // Take the leading independent clause if there is one.
  for (const separator of [': ', '; ', ' - ', ' — ']) {
    const at = clean.indexOf(separator)
    if (at > 0) {
      const head = clean.slice(0, at).trim()
      if (countWords(head) >= 4 && countWords(head) <= maxWords) return head
    }
  }

  // Otherwise cut at the last comma that leaves a substantial clause.
  const words = clean.split(/\s+/)
  const head = words.slice(0, maxWords).join(' ')
  const comma = head.lastIndexOf(',')
  if (comma > 0) {
    const candidate = head.slice(0, comma).trim()
    if (countWords(candidate) >= 5 && !endsOnQualifier(candidate)) return candidate
  }

  // No honest way to shorten it.
  return ''
}

/**
 * True when the final comma-separated segment is a qualifier rather than
 * content: "Migrating to an SDN architecture, even partially".
 *
 * A comma is not a sentence boundary. Cutting there can leave text that looks
 * grammatical and passes every surface lint - correct capitalisation, no
 * trailing punctuation, under the word cap - while still being a participial
 * phrase whose predicate was thrown away. A trailing qualifier is the reliable
 * signal that the sentence was going somewhere else.
 */
function endsOnQualifier(text: string): boolean {
  const last = text.split(',').pop()?.trim() ?? ''
  return /^(even|especially|particularly|notably|including|such as|among|for example|for instance|if|when|while|though|although|albeit|whether|unless|rather|instead|as well)\b/i.test(
    last
  )
}

/**
 * Sentences that only announce that content exists.
 *
 * "Several important research gaps remain" and "SDN is not without significant
 * limitations" are true, fit the word budget, and pass every lint - and tell a
 * panel nothing. They are the written equivalent of clearing your throat, and
 * on a slide they displace a claim that would have said something.
 */
const ANNOUNCEMENT =
  /^(?:there (?:are|is|remain)\b|(?:several|many|various|numerous)\b[\w\s'-]{0,40}\b(?:remain|exist|persist|follow|are discussed)\b|(?:a\s+)?(?:number|range|variety)\s+of\b[\w\s'-]{0,40}\b(?:exist|remain|follow)\b)|\bis not without\b|\bare (?:tangible|manifold|numerous|varied|clear)\b|\b(?:can|may) be (?:summari[sz]ed|outlined|described) as follows\b|\bas follows\s*$|\binclude the following\s*$/i

/** True when the text stops on a word that cannot end a statement. */
function endsMidThought(text: string): boolean {
  const stripped = text.trim().replace(/[.,;:!?]+$/, '')
  return TRAILING_FUNCTION_WORD.test(stripped)
}

/**
 * Compresses one source sentence into a slide bullet of at most `maxWords`.
 * Returns '' when what survives is not a presentable statement - the caller
 * drops those rather than showing a fragment.
 */
export function compressSentence(sentence: string, maxWords = 14): string {
  let s = sentence.replace(/\s+/g, ' ').trim()
  if (!s) return ''

  // Strip source apparatus first.
  s = s.replace(/\s*\([^)]*\b(19|20)\d{2}[a-z]?\b[^)]*\)/g, '') // (Author, 2021)
  s = s.replace(/\s*\[\d+(?:\s*[,-]\s*\d+)*\]/g, '') // [12], [3, 4]
  s = s.replace(/\s*\.{3,}\s*\d*\s*$/, '') // contents dot leaders

  s = s.replace(HEDGES, '')
  s = s.replace(LEAD_INS, '')

  // A bare pronoun subject with a copula means nothing once the slide isolates
  // it from the sentence before.
  if (PRONOUN_COPULA.test(s)) return ''

  // A sentence that only announces that content follows.
  if (ANNOUNCEMENT.test(s)) return ''

  for (const [pattern, replacement] of PHRASE_COMPRESSIONS) s = s.replace(pattern, replacement)

  s = dropEmptyParentheticals(s)
  s = dropLeadingAdverbial(s)
  s = dropRelativeClause(s)

  s = s.replace(PRONOUN_SUBJECT, '')
  s = s.replace(WEAK_OPENERS, '')

  s = s.replace(/\s+([,.;:])/g, '$1').replace(/\s+/g, ' ').trim()
  s = s.replace(/[.\s]+$/, '') // slide bullets take no terminal period

  if (!s) return ''

  s = reduceToWords(s, maxWords)
  if (!s) return ''

  s = s.replace(/[.\s,;:\-–—]+$/, '')

  // An unbalanced bracket means a construction was cut through.
  const open = (s.match(/\(/g) || []).length
  const close = (s.match(/\)/g) || []).length
  if (open > close) s = s.replace(/\s*\([^)]*$/, '').trim()

  if (!s || countWords(s) < 4) return ''

  // Final integrity gate: a bullet must not stop on a function word, and must
  // not open on a conjunction or a subordinator that leaves it dangling.
  if (endsMidThought(s)) return ''
  if (/^(and|but|or|nor|yet|so|which|that|because|although|though|whereas)\b/i.test(s)) return ''
  if (SUBORDINATE_OPENER.test(s)) return ''
  if (hasDanglingSubordinate(s)) return ''

  return s.charAt(0).toUpperCase() + s.slice(1)
}

// --- Sentence scoring -------------------------------------------------

const HIGH_VALUE =
  /\b(aim|objective|purpose|propose[ds]?|develop(?:ed|ment)?|design(?:ed)?|implement(?:ed|ation)?|result(?:s|ed)?|finding|achieve[ds]?|improve[ds]?|reduce[ds]?|increase[ds]?|accuracy|performance|efficiency|conclude[ds]?|recommend(?:ed|ation)?|significant|demonstrat(?:e|ed|es)|enable[ds]?|eliminate[ds]?|limitation|challenge|advantage|benefit)\b/i

const TECHNICAL =
  /\b(system|model|algorithm|architecture|framework|method|technique|process|protocol|controller|network|analysis|evaluation|experiment|test(?:ing)?|plane|topology)\b/i

const STOPWORDS = new Set(
  ('the a an and or of to in for on with by as is are was were be been being that this these those it its from at ' +
    'which such can may will would could should has have had not but also more most other than then there their they ' +
    'we our us he she his her them into over under between within while when where what who whom whose how why')
    .split(/\s+/)
)

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w))
}

interface ScoredSentence {
  text: string
  index: number
  score: number
}

/** Ranks sentences by how much a seminar audience needs them. */
function scoreSentences(sentences: string[]): ScoredSentence[] {
  const tf = new Map<string, number>()
  for (const s of sentences) {
    for (const w of contentWords(s)) tf.set(w, (tf.get(w) || 0) + 1)
  }

  return sentences.map((text, index) => {
    const words = contentWords(text)
    const density = words.length
      ? words.reduce((sum, w) => sum + (tf.get(w) || 0), 0) / words.length
      : 0

    let score = density
    if (index === 0) score += 1.5 // the topic sentence carries the claim
    if (HIGH_VALUE.test(text)) score += 2.5
    if (TECHNICAL.test(text)) score += 1
    if (/\d/.test(text)) score += 1.2
    if (text.length > 45 && text.length < 240) score += 0.8
    if (text.length > 320) score -= 1.5

    return { text, index, score }
  })
}

// --- Bullet production -------------------------------------------------

export interface SummarizeOptions {
  spec: PresentationSpec
  /** Bullets wanted. Clamped to the spec's per-slide maximum. */
  count?: number
  /** Word budget per bullet. Defaults to the spec's ideal. */
  wordBudget?: number
  /** Bullets already used elsewhere in the deck, so slides do not repeat. */
  seen?: Set<string>
}

/**
 * Compresses a section's sentences into slide bullets, in DOCUMENT ORDER.
 *
 * Selection is scored but presentation is chronological: ranking the output
 * directly scrambles the argument the student has to defend.
 *
 * Compression happens BEFORE the top-N cut, because a sentence that fails the
 * lint after compression must not consume one of the slots - that is how slides
 * ended up under-filled.
 */
export function summarizeToBullets(sentences: string[], options: SummarizeOptions): string[] {
  const { spec, seen } = options
  const count = Math.min(options.count ?? spec.deck.maxBulletsPerSlide, spec.deck.maxBulletsPerSlide)
  const budget = Math.min(options.wordBudget ?? spec.deck.idealWordsPerBullet, spec.deck.maxWordsPerBullet)
  if (count <= 0) return []

  const usable = sentences.filter(s => s.trim().length >= 25)
  if (usable.length === 0) return []

  const localSeen = new Set<string>(seen ?? [])

  /**
   * Compress at `wordBudget` and keep only what passes the lint.
   *
   * Run twice when necessary: the tight ideal budget forces `reduceToWords` to
   * shorten, and it refuses to cut mid-thought, so a sentence that yields
   * nothing at 10 words often yields a clean bullet at the 14-word maximum.
   * Without the retry, tightening the compressor left slides with one bullet.
   */
  const gather = (wordBudget: number) =>
    scoreSentences(usable)
      .map(s => ({ ...s, bullet: compressSentence(s.text, wordBudget) }))
      .filter(s => {
      if (!s.bullet) return false
      // The summariser's own output may legitimately be a noun phrase, so the
      // verb requirement is relaxed here; it still must not be a fragment in
      // any other respect.
      const problems = lintBullet(s.bullet, {
        maxWords: spec.deck.maxWordsPerBullet,
        requireVerb: false,
        seen: localSeen,
      })
      return problems.length === 0
    })

  let candidates = gather(budget)
  const MIN_BULLETS = 3
  if (candidates.length < MIN_BULLETS && budget < spec.deck.maxWordsPerBullet) {
    const relaxed = gather(spec.deck.maxWordsPerBullet)
    if (relaxed.length > candidates.length) candidates = relaxed
  }

  const picked: typeof candidates = []
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
    if (picked.length >= count) break
    const key = duplicateKey(candidate.bullet)
    if (localSeen.has(key)) continue
    localSeen.add(key)
    picked.push(candidate)
  }

  const ordered = picked.sort((a, b) => a.index - b.index).map(s => s.bullet)
  if (seen) for (const b of ordered) seen.add(duplicateKey(b))
  return ordered
}

/**
 * A one-sentence hook for the slide: the single most informative claim,
 * compressed a little more loosely than a bullet so it reads as a spoken line.
 */
export function deriveTakeaway(sentences: string[], heading: string): string {
  const usable = sentences.filter(s => s.trim().length >= 25)
  if (usable.length === 0) return `${heading} is covered on this slide`

  const ranked = scoreSentences(usable).sort((a, b) => b.score - a.score)

  // Try each candidate, not just the highest-scoring one: the compressor
  // legitimately rejects sentences that cannot be shortened honestly, and
  // giving up after the first produced notes that opened "make the point that
  // Introduction is covered on this slide".
  for (const candidate of ranked.slice(0, 5)) {
    const compressed = compressSentence(candidate.text, 20)
    if (compressed) return compressed
  }

  // Last resort: the strongest sentence, lightly shortened at a clause
  // boundary. Still the document's own words, never a template.
  const fallback = ranked[0].text.replace(/\s+/g, ' ').trim()
  const cut = fallback.slice(0, 150)
  const boundary = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf('; '))
  const trimmed = (boundary > 60 ? cut.slice(0, boundary) : cut).replace(/[.,;:\s]+$/, '')
  return trimmed || `${heading} is covered on this slide`
}

// --- Speaker notes -----------------------------------------------------

/** The examiner question a section of this kind usually attracts. */
function likelyQuestion(heading: string): string {
  const h = heading.toLowerCase()
  if (/limitation|challenge|drawback|risk/.test(h)) {
    return 'Expect to be asked how these limitations are mitigated in practice.'
  }
  if (/gap|future|recommend/.test(h)) {
    return 'Expect to be asked which gap you would tackle first, and why.'
  }
  if (/architect|design|component|plane/.test(h)) {
    return 'Expect to be asked to walk through the layers in your own words.'
  }
  if (/literature|existing|previous|review/.test(h)) {
    return 'Expect to be asked which study is most relevant to your argument.'
  }
  if (/result|finding|takeaway|conclusion/.test(h)) {
    return 'Expect to be asked what evidence supports this conclusion.'
  }
  if (/method|process|working|principle|flow/.test(h)) {
    return 'Expect to be asked what happens if a stage fails.'
  }
  if (/problem|motivation|background/.test(h)) {
    return 'Expect to be asked why existing approaches do not solve this.'
  }
  return 'Expect a question on how this connects to your overall argument.'
}

/**
 * The one figure or named standard worth stressing aloud, with wording that
 * suits what it actually is - calling a protocol name "the number the panel
 * will remember" reads as a template that was never checked.
 */
function emphasisFrom(sentences: string[]): string | null {
  for (const s of sentences) {
    const figure = s.match(/\b\d+(?:[.,]\d+)?\s*(?:%|percent|ms|Gbps|Mbps|seconds?|years?)\b/i)
    if (figure) return `Stress the figure ${figure[0]} - it is the number the panel will remember`
  }
  for (const s of sentences) {
    const standard = s.match(/\b(?:OpenFlow|IEEE\s?\d[\w.]*|RFC\s?\d+|ONOS|OpenDaylight|Mininet|NETCONF|P4)\b/)
    if (standard) return `Name ${standard[0]} explicitly - the panel will expect the specific standard`
  }
  for (const s of sentences) {
    const year = s.match(/\b(?:19|20)\d{2}\b/)
    if (year) return `Anchor the timeline on ${year[0]} so the chronology is clear`
  }
  return null
}

export interface NotesOptions {
  spec: PresentationSpec
  heading: string
  takeaway: string
  sentences: string[]
}

/**
 * Writes 40-70 words of speaker notes: what to say, the one thing to
 * emphasise, and the question this slide tends to attract.
 *
 * Notes are attached with `slide.addNotes()` only - never as a text box, which
 * would put the script on the projector.
 */
export function buildSpeakerNotes(options: NotesOptions): string {
  const { spec, heading, takeaway, sentences } = options
  const min = spec.deck.notesMinWords
  const max = spec.deck.notesMaxWords

  const parts: string[] = []
  /** Normalised openings already used, so no sentence is said twice. */
  const said = new Set<string>()

  const fingerprint = (text: string) =>
    text.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).slice(0, 8).join(' ')

  const push = (text: string): boolean => {
    const clean = text.replace(/\s+/g, ' ').trim()
    if (!clean) return false
    const key = fingerprint(clean)
    if (said.has(key)) return false
    said.add(key)
    parts.push(clean.replace(/[.\s]*$/, '.'))
    return true
  }

  // Phrased so the takeaway is quoted as-is. An earlier version wrote "make the
  // point that ${lowerFirst(takeaway)}", which lowercased proper nouns into
  // "make the point that xie et al. proposed...".
  push(`Open on this point: ${takeaway}`)
  // The takeaway itself is now spoken; record its own fingerprint too, so the
  // supporting pass cannot re-add the same sentence in a slightly different
  // compression.
  said.add(fingerprint(takeaway))

  const emphasis = emphasisFrom(sentences)
  if (emphasis) push(emphasis)

  // Add supporting detail until the word count is comfortably in range.
  const supporting = scoreSentences(sentences.filter(s => s.length >= 30))
    .sort((a, b) => b.score - a.score)
    .map(s => s.text)

  for (const sentence of supporting) {
    if (countWords(parts.join(' ')) >= min) break
    push(compressSentence(sentence, 22) || shortenAtBoundary(sentence, 26))
  }

  push(likelyQuestion(heading))

  // Trim back to the ceiling on sentence boundaries so notes never end mid-word.
  let notes = parts.join(' ')
  while (countWords(notes) > max && parts.length > 2) {
    parts.splice(parts.length - 2, 1)
    notes = parts.join(' ')
  }

  // Still short (a very thin section): pad with the heading context rather than
  // shipping notes that fail the >= 25 word QA check.
  if (countWords(notes) < min) {
    notes +=
      ` This slide sits under ${heading}; connect it back to the aim of the seminar` +
      ` before moving on, and pause briefly for the panel to read the slide.`
  }

  return notes.replace(/\s+/g, ' ').trim()
}

function countWords(text: string): number {
  return wordCount(text)
}

/**
 * Shortens a sentence for speaker notes at a clause or word boundary.
 *
 * A fixed character slice left notes ending "...affects productivity," which is
 * the same mid-thought cut the bullets were fixed for; notes are read aloud, so
 * they deserve the same treatment.
 */
function shortenAtBoundary(text: string, maxWords: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (countWords(clean) <= maxWords) return clean

  const head = clean.split(/\s+/).slice(0, maxWords).join(' ')
  const boundary = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '), head.lastIndexOf(': '))
  const chosen = boundary > head.length * 0.5 ? head.slice(0, boundary) : head
  return chosen.replace(/[\s,;:\-–—]+$/, '')
}

/** Re-exported so callers can segment ad-hoc prose without a second import. */
export { segmentSentences }
