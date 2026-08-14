/**
 * documentParts.ts
 * ------------------------------------------------------------------
 * Decides what each block of a parsed report actually IS, before any of it is
 * considered for a slide.
 *
 * Why this module exists
 * ----------------------
 * The planner used to treat every heading as a candidate section. A report's
 * front matter - declaration, certification, dedication, acknowledgements,
 * table of contents, list of figures - is not argument, and putting it on a
 * slide is worse than dropping it. The clearest symptom was a slide of bullets
 * reading "12 3.1.1 The SDN Architecture": a table of contents, entry by entry,
 * page numbers included.
 *
 * Nothing here summarises or plans. It only classifies, so that later stages
 * cannot see material they should never have been offered.
 */

export type PartKind =
  | 'cover'
  | 'declaration'
  | 'dedication'
  | 'acknowledgements'
  | 'toc'
  | 'listing'
  | 'abstract'
  | 'body'
  | 'references'
  | 'appendix'

/** Parts that may never become a content slide. */
export const NON_CONTENT_PARTS: PartKind[] = [
  'cover', 'declaration', 'dedication', 'acknowledgements', 'toc', 'listing',
]

const HEADING_PATTERNS: [PartKind, RegExp][] = [
  ['declaration', /^(declaration|certification|approval\s+page|attestation)\b/i],
  ['dedication', /^dedications?\b/i],
  ['acknowledgements', /^acknowledge?ments?\b/i],
  ['toc', /^(table\s+of\s+contents|contents)\s*$/i],
  ['listing', /^list\s+of\s+(figures|tables|plates|abbreviations|acronyms|symbols|appendices)\b/i],
  ['abstract', /^(abstract|executive\s+summary)\b/i],
  ['references', /^(references?|bibliography|works\s+cited)\b/i],
  ['appendix', /^appendix|^appendices\b/i],
]

/** Classifies by heading text alone. Null when the heading says nothing. */
export function partFromHeading(heading: string): PartKind | null {
  const clean = heading.replace(/^\d+(\.\d+)*\.?\s*/, '').trim()
  for (const [kind, pattern] of HEADING_PATTERNS) {
    if (pattern.test(clean)) return kind
  }
  return null
}

// --- Shape detectors ----------------------------------------------------

/**
 * A table-of-contents line: text followed by a page number, usually with dot
 * leaders, and often opening with its own section number.
 *
 * Detected by SHAPE as well as by heading, because a TOC frequently loses its
 * heading in conversion - which is exactly how one reached a slide.
 */
export function looksLikeTocLine(line: string): boolean {
  const text = line.trim()
  if (!text || text.length > 140) return false

  // "1.2 Problem Definition ......... 5"  or  "1.2 Problem Definition 5"
  if (/\.{3,}\s*\d{1,3}$/.test(text)) return true
  if (/^\d+(\.\d+)*\s+\S.*\s+\d{1,3}$/.test(text)) return true
  // A leading page number, which is how some converters emit it.
  if (/^\d{1,3}\s+\d+(\.\d+)+\s+\S/.test(text)) return true

  return false
}

/** "Figure 2.1 ... 14" / "Table 3.2 ... 21" - a list-of-figures/tables entry. */
export function looksLikeListingLine(line: string): boolean {
  return /^(figure|fig\.?|table|plate|appendix)\s*\d+(\.\d+)?\b/i.test(line.trim())
}

/**
 * True when a run of lines is a contents block rather than prose.
 * A single line ending in a number is a coincidence; a run of them is a TOC.
 */
export function looksLikeTocBlock(lines: string[]): boolean {
  const usable = lines.filter(l => l.trim())
  if (usable.length < 3) return false
  const hits = usable.filter(l => looksLikeTocLine(l) || looksLikeListingLine(l)).length
  return hits / usable.length >= 0.6
}

// --- Section numbering --------------------------------------------------

/**
 * Removes section numbering, and the heading that conversion glues onto the
 * front of its own body text.
 *
 * "3.3.1 SDN Controllers The choice of SDN controller is fundamental to any
 * deployment." -> "The choice of SDN controller is fundamental to any
 * deployment."
 *
 * Run in the extractor so no later stage can ever see a section number. The
 * heading is detected as the Title Case run between the number and the first
 * word that starts a sentence proper.
 */
export function stripSectionNumbering(text: string): string {
  let out = text.replace(/^\s*\d+(\.\d+)*\.?\s+/, '')

  // A leading page number left by a converter: "12 3.1.3 Traffic Engineering".
  out = out.replace(/^\s*\d{1,3}\s+(?=\d+(\.\d+)+\s)/, '').replace(/^\s*\d+(\.\d+)*\.?\s+/, '')

  // "SDN Controllers The choice of ..." - a Title Case heading followed by a
  // sentence. Only strip when a plausible sentence follows, so a title-cased
  // sentence is not decapitated.
  const glued = out.match(
    /^((?:[A-Z][\w'-]*|and|of|for|in|the|to|with|a|an)(?:\s+(?:[A-Z][\w'-]*|and|of|for|in|the|to|with|a|an)){0,7})\s+((?:The|This|A|An|In|It|These|Such|Modern|Traditional|Most|Many|Each|Every|Software|Network)\s+[a-z].{20,})$/
  )
  if (glued) out = glued[2]

  return out.replace(/\s+/g, ' ').trim()
}

/** True when any section numbering survives. Used by the gate. */
export function hasSectionNumber(text: string): boolean {
  return /(^|\s)\d+(\.\d+)+(\s|$)/.test(text) || /^\s*\d+(\.\d+)*\.?\s+\S/.test(text)
}

// --- Sentence-level filters --------------------------------------------

/**
 * Sentences whose subject is the DOCUMENT rather than the topic.
 *
 * "This chapter begins by defining the problem" tells a reader nothing about
 * networks; it tells them about the report's own table of contents. The bullet
 * "Begins by defining the problem" exists because this filter was missing.
 */
const SCAFFOLDING =
  /\b(this|the)\s+(chapter|section|subsection|paper|seminar|report|study|work|project|dissertation|thesis)\b[^.]{0,80}\b(begins|opens|starts|presents|discusses|describes|examines|explores|covers|outlines|introduces|reviews|concludes|is organised|is organized|is structured|will|aims to|seeks to|sets out)/i

const SCAFFOLDING_OPENER =
  /^(the\s+(?:following|next|remainder|rest)\b|in\s+(?:this|the\s+next|the\s+following)\s+(?:chapter|section|subsection)\b|having\s+(?:examined|discussed|reviewed)\b|as\s+(?:discussed|described|shown|noted|mentioned|explained)\s+(?:in|above|below|earlier|previously)\b)/i

/** "as discussed in Chapter Two", "see Section 3.1", "Figure 2.1 shows". */
const CROSS_REFERENCE =
  /\b(?:as\s+)?(?:discussed|described|shown|illustrated|presented|outlined|summari[sz]ed|noted|explained|mentioned)\s+(?:in|above|below|earlier|later|previously)\b|\bsee\s+(?:section|chapter|figure|table|appendix)\b|\b(?:chapter|section)\s+(?:one|two|three|four|five|six|seven|\d+)\b/i

/** A caption pressed into service as prose. */
const CAPTION_AS_PROSE = /^(figure|fig\.?|table|plate|chart|appendix)\s*\d+(\.\d+)?\s*[:.\-]/i

export interface SentenceFilterResult {
  keep: boolean
  reason?: 'scaffolding' | 'cross-reference' | 'caption' | 'toc-line' | 'too-short'
}

/**
 * Decides whether a source sentence is about the TOPIC.
 *
 * Cross-references are removed rather than rejected where the sentence still
 * stands without them - "SDN reduces latency, as discussed in Chapter Two"
 * is a usable claim once the reference is stripped.
 */
export function screenSentence(sentence: string): SentenceFilterResult {
  const s = sentence.trim()
  if (s.length < 25) return { keep: false, reason: 'too-short' }
  if (CAPTION_AS_PROSE.test(s)) return { keep: false, reason: 'caption' }
  if (looksLikeTocLine(s) || looksLikeListingLine(s)) return { keep: false, reason: 'toc-line' }
  if (SCAFFOLDING.test(s)) return { keep: false, reason: 'scaffolding' }
  if (SCAFFOLDING_OPENER.test(s)) return { keep: false, reason: 'scaffolding' }
  return { keep: true }
}

/** Removes a trailing or parenthetical cross-reference from an otherwise usable sentence. */
export function stripCrossReferences(sentence: string): string {
  return sentence
    .replace(/\s*\((?:as\s+)?(?:see\s+)?(?:section|chapter|figure|table|appendix)[^)]*\)/gi, '')
    .replace(/,?\s*as\s+(?:discussed|described|shown|noted|explained|mentioned)\s+(?:in\s+)?(?:section|chapter)\s+\w+\s*/gi, ' ')
    .replace(/,?\s*(?:see|cf\.)\s+(?:section|chapter|figure|table|appendix)\s*[\d.]+\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim()
}

/** Full screen: reject or clean. Returns '' when the sentence should be dropped. */
export function cleanSourceSentence(sentence: string): string {
  const stripped = stripSectionNumbering(sentence)
  if (!screenSentence(stripped).keep) return ''

  const withoutRefs = stripCrossReferences(stripped)
  if (withoutRefs.length < 25) return ''
  // A cross-reference that survived stripping means the sentence leans on it.
  if (CROSS_REFERENCE.test(withoutRefs)) return ''

  return withoutRefs
}
