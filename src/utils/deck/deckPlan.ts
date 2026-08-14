/**
 * deckPlan.ts
 * ------------------------------------------------------------------
 * Chooses the deck's skeleton from the document's ACTUAL heading tree.
 *
 * Why this module exists
 * ----------------------
 * The old planner worked from a fixed list of roles a seminar deck "should"
 * have and went looking for content to fill each one. When the document had no
 * such section, it filled the slot anyway with whatever scored highest - which
 * is how a literature-based SDN report acquired a "TESTING & RESULTS" slide
 * carrying summary-of-findings prose, and how "SCOPE & SIGNIFICANCE" ended up
 * labelled "Chapter Four" with text lifted from the conclusion.
 *
 * The direction is now reversed. Sections that exist produce slides; sections
 * that do not exist produce nothing. The slide count falls out of the document
 * and is only then clamped into the spec's 12-15 range by merging the weakest
 * neighbours or splitting the heaviest.
 *
 * Every slide carries `sourceRefs`, and its eyebrow is DERIVED from them, so
 * the label cannot drift from the content.
 */

import type { DocSectionNode, DocTable, DocTree } from './docTree'
import type { PresentationSpec } from './presentationSpec'
import type { PlannedSlide, SlidePlan, SlideStep, DeckMetadata } from './slidePlan'
import { summarizeToBullets, deriveTakeaway, buildSpeakerNotes, compressSentence } from './summarize'

// --- Provenance ---------------------------------------------------------

/** "§2.3" plus the pages the content came from. Never empty. */
function sourceRefsFor(sections: DocSectionNode[]): string[] {
  const refs: string[] = []
  for (const s of sections) {
    if (s.id) refs.push(`§${s.id}`)
    else if (s.heading) refs.push(s.heading)
  }
  const pages = [...new Set(sections.flatMap(s => s.pages))].sort((a, b) => a - b)
  if (pages.length === 1) refs.push(`p. ${pages[0]}`)
  else if (pages.length > 1) refs.push(`pp. ${pages[0]}-${pages[pages.length - 1]}`)
  return refs.length > 0 ? refs : ['(source unrecorded)']
}

/**
 * The eyebrow is the chapter the content actually came from, or the front/back
 * matter name. When sections from different chapters are merged, no chapter
 * eyebrow is claimed - saying "Chapter Two" over mixed content is the defect.
 */
function eyebrowFor(sections: DocSectionNode[]): string | undefined {
  const labels = new Set(sections.map(s => s.chapterLabel).filter(Boolean))
  if (labels.size === 1) return [...labels][0] as string

  const kinds = new Set(sections.map(s => s.kind))
  if (kinds.size === 1 && kinds.has('front')) return 'Front matter'
  return undefined
}

// --- Layout detection ---------------------------------------------------

const PROCESS_SIGNALS = /\b(stage|step|phase)s?\b/i
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'final']

const CONTRAST_PAIRS: [RegExp, RegExp][] = [
  [/\badvantage|\bbenefit|\bstrength/i, /\blimitation|\bdrawback|\bchallenge|\bweakness/i],
  [/\btraditional|\blegacy|\bconventional/i, /\bsdn|\bproposed|\bmodern|\bsoftware[- ]defined/i],
  [/\bexisting|\bcurrent/i, /\bproposed|\bfuture/i],
]

/**
 * Recovers an ordered sequence from a section, with LABELS THAT MEAN SOMETHING.
 *
 * A process layout has to earn its place. The first version of this code fell
 * back to relabelling a section's bullets as "Step 1 … Step 5" whenever the
 * deck was short of non-bullet slides - which is decoration, not information:
 * the reader learns nothing from "Step 3" that the bullet did not already say.
 * That fallback is gone. Each strategy below keys on structure the document
 * actually states, and each derives a label from the source text.
 *
 * Returns [] when the section is genuinely just a list of points. A bullets
 * slide is the honest rendering of a list of points.
 */
export function extractSteps(sentences: string[]): SlideStep[] {
  return (
    extractOrdinalStages(sentences) ||
    extractPhaseTimeline(sentences) ||
    extractEnumeratedComponents(sentences) ||
    []
  )
}

/** "The first stage is network discovery and topology mapping." */
function extractOrdinalStages(sentences: string[]): SlideStep[] | null {
  const steps: SlideStep[] = []

  for (const ordinal of ORDINALS) {
    const pattern = new RegExp(`\\b${ordinal}\\b[^.]*\\b(stage|step)\\b`, 'i')
    const index = sentences.findIndex(s => pattern.test(s))
    if (index === -1) continue

    const sentence = sentences[index]
    const m = sentence.match(/\b(?:is|involves|covers|concerns|begins with)\b\s+(.+)$/i)
    const rawTitle = m ? m[1] : sentence.replace(pattern, '').replace(/^[\s,:-]+/, '')
    const title = compressSentence(rawTitle, 6)
    if (!title) continue

    steps.push({ title, body: compressSentence(sentences[index + 1] ?? '', 12) })
    if (steps.length >= 5) break
  }

  return steps.length >= 3 ? steps : null
}

const PHASE_ORDINALS = ['initial', 'first', 'second', 'third', 'fourth', 'fifth', 'final']

/**
 * A chronology: "The initial phase, roughly 2008 to 2012, was characterised by
 * foundational work..." -> { title: '2008-2012', body: '...' }.
 *
 * The period is the label, because the period is what the sequence conveys.
 * Rendering this as bullets loses the one thing it is telling the reader: that
 * the field moved through eras in order.
 */
function extractPhaseTimeline(sentences: string[]): SlideStep[] | null {
  const steps: SlideStep[] = []
  const used = new Set<number>()

  for (const ordinal of PHASE_ORDINALS) {
    const pattern = new RegExp(`\\b${ordinal}\\b[^.]{0,60}\\bphase\\b`, 'i')
    const index = sentences.findIndex((s, i) => !used.has(i) && pattern.test(s))
    if (index === -1) continue
    used.add(index)

    const sentence = sentences[index]

    // Prefer a real period as the label.
    const span = sentence.match(/\b((?:19|20)\d{2})\s*(?:to|-|–|—|until)\s*((?:19|20)\d{2})\b/)
    const single = sentence.match(/\b(?:since|from|after)\s+((?:19|20)\d{2})\b/)
    const title = span
      ? `${span[1]}-${span[2]}`
      : single
      ? `${single[1]} onward`
      : /\bcurrent\b/i.test(sentence)
      ? `${capitalise(ordinal)} phase (current)`
      : `${capitalise(ordinal)} phase`

    // The body is what happened in that period - not the period again. The
    // label already carries the years, so a body of "Initial phase, roughly
    // 2008 to 2012" says nothing twice.
    const body = predicateOf(sentence, /^.*?\bphase\b/i)
    if (!body) continue

    steps.push({ title, body })
    if (steps.length >= 5) break
  }

  return steps.length >= 3 ? steps : null
}

/**
 * An enumerated structure: "The SDN architecture is organised into three
 * distinct planes" followed by "The data plane...", "The control plane...",
 * "The application plane...".
 *
 * The layers and their order are the content. Flattened into bullets the
 * reader has to reconstruct the stack themselves.
 */
function extractEnumeratedComponents(sentences: string[]): SlideStep[] | null {
  const lead = sentences.find(s =>
    /\b(?:organi[sz]ed|divided|separated|composed|structured)\s+(?:in)?to\b|\b(?:consists?|comprises?)\s+of\b/i.test(s)
  )
  if (!lead) return null

  // The noun being enumerated: "...into three distinct planes" -> "plane".
  const noun = lead.match(
    /\b(?:in)?to\s+(?:\w+\s+)?(?:distinct\s+|main\s+|key\s+|separate\s+|broad\s+)?([a-z]+?)s\b/i
  )
  if (!noun) return null
  const singular = noun[1].toLowerCase()
  if (singular.length < 4) return null

  const steps: SlideStep[] = []
  const seen = new Set<string>()

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i]
    if (sentence === lead) continue

    // "The data plane, also called ..." / "The application plane sits above ..."
    const m = sentence.match(
      new RegExp(`^(?:The\\s+)?([A-Za-z][\\w-]*(?:\\s+[a-z][\\w-]*)?)\\s+${singular}\\b`, 'i')
    )
    if (!m) continue

    const name = m[1].trim().toLowerCase()
    if (seen.has(name)) continue
    // Guard against "each plane", "every plane", "this plane".
    if (/^(each|every|this|that|these|those|both|any|one|another|same|other)$/.test(name)) continue
    seen.add(name)

    const title = `${capitalise(name)} ${singular}`
    // A step with no body is worse than no step: the card renders as a bare
    // label floating in empty space, which is what "Application plane" did.
    const body = predicateOf(sentence, new RegExp(`^.*?${singular}\\b`, 'i'))
    if (!body) continue

    steps.push({ title, body })
    if (steps.length >= 5) break
  }

  return steps.length >= 3 ? steps : null
}

/**
 * Extracts the PREDICATE of a sentence once its subject has become the step's
 * title, so the body reads as a statement rather than a severed fragment.
 *
 * "The data plane, also called the infrastructure layer, consists of the
 * physical devices" became "Called the infrastructure layer, consists of the
 * physical devices" - the appositive was left dangling where the subject used
 * to be. Both the appositive and the linking verb are removed so the body
 * starts on the verb that carries the meaning.
 */
function predicateOf(sentence: string, subjectPattern: RegExp): string {
  let rest = sentence.replace(subjectPattern, '').replace(/^[\s,:;-]+/, '')

  // ", also called the infrastructure layer," / ", known as the control layer,"
  rest = rest.replace(
    /^(?:also\s+)?(?:called|known\s+as|referred\s+to\s+as|termed|named)\s+[^,]{2,60},\s*/i,
    ''
  )
  // ", roughly 2008 to 2012," / ", spanning approximately 2012 to 2016,"
  rest = rest.replace(
    /^(?:roughly|approximately|spanning|covering|from|between)\s+[^,]{2,40},\s*/i,
    ''
  )
  // Leading linking verbs: "was characterised by", "is defined by", "saw".
  rest = rest.replace(
    /^(?:was|were|is|are)\s+(?:characteri[sz]ed|defined|marked|dominated|distinguished)\s+by\s+/i,
    ''
  )
  rest = rest.replace(/^(?:saw|brought|produced)\s+/i, '')
  rest = rest.replace(/^(?:and|of|which)\s+/i, '')
  // A bare copula left at the front reads as a severed clause ("Is embodied by
  // the SDN controller"); dropping it leaves a clean participle.
  rest = rest.replace(/^(?:is|are|was|were)\s+/i, '')

  return shortenPredicate(rest, 14)
}

/**
 * Shortens a card body.
 *
 * A step body is descriptive text on a card, not a claim that has to stand
 * alone, so it may be cut at a coordinating conjunction - which the bullet
 * shortener deliberately refuses to do. Using the bullet rules here returned
 * nothing for "sits above the control layer and consists of network
 * applications that interact with the controller", and the card rendered as a
 * bare label with empty space under it.
 */
function shortenPredicate(text: string, maxWords: number): string {
  const clean = text.replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim()
  if (!clean) return ''

  const capitalise1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  if (countWords(clean) <= maxWords) return capitalise1(clean)

  // Prefer a clause boundary, then a coordinating/relative boundary.
  for (const sep of [', ', '; ', ': ', ' and ', ' which ', ' that ', ' while ']) {
    const at = clean.indexOf(sep)
    if (at > 0) {
      const head = clean.slice(0, at).trim()
      if (countWords(head) >= 4 && countWords(head) <= maxWords) return capitalise1(head)
    }
  }

  // Otherwise trim to the budget and back off any trailing function word.
  const words = clean.split(/\s+/).slice(0, maxWords)
  while (
    words.length > 4 &&
    /^(a|an|the|of|to|in|for|on|with|by|as|at|from|and|or|that|which|its|their|this|these)$/i.test(
      words[words.length - 1]
    )
  ) {
    words.pop()
  }
  return words.length >= 4 ? capitalise1(words.join(' ')) : ''
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * True when an extracted table is coherent enough to render.
 *
 * PDF tables whose header cells wrap onto a second line come out of extraction
 * as ragged rows - the SDN report's controller comparison produced a header of
 * "SDN | Language Southbound | Key Strength | Enterprise" followed by a row of
 * "Controller | Protocol | Suitability". Rendering that is worse than not
 * rendering it: the slide looks authoritative and says nothing. A ragged table
 * is dropped and the section falls back to bullets.
 */
export function normalizeTable(table: DocTable): DocTable | null {
  const width = table.headers.length
  if (width < 2 || width > 5) return null

  // Header cells must be short labels, not sentence fragments. A header that
  // reads as prose means the column detection split the wrong gaps.
  if (table.headers.some(h => !h.trim() || h.split(/\s+/).length > 5)) return null

  // Keep only rows that match the header width. A single ragged row - usually a
  // cell that wrapped onto a second line - should not discard an otherwise
  // sound table, but a table that is mostly ragged was mis-parsed and is worse
  // than useless on a slide: it looks authoritative and says nothing.
  const clean = table.rows.filter(r => r.length === width && r.some(c => c.trim()))
  if (clean.length < 2) return null
  if (clean.length / table.rows.length < 0.6) return null

  return { caption: table.caption, headers: table.headers, rows: clean.slice(0, 6) }
}

/** Splits a section into two contrasting columns when its content is a comparison. */
function extractColumns(
  sections: DocSectionNode[],
  spec: PresentationSpec
): { heading: string; bullets: string[] }[] | null {
  if (sections.length !== 2) return null

  const [a, b] = sections
  const matches = CONTRAST_PAIRS.some(
    ([left, right]) =>
      (left.test(a.heading) && right.test(b.heading)) || (right.test(a.heading) && left.test(b.heading))
  )
  if (!matches) return null

  const seen = new Set<string>()
  const columns = [a, b].map(section => ({
    heading: section.heading,
    bullets: summarizeToBullets(section.sentences, { spec, count: 4, wordBudget: 9, seen }),
  }))

  return columns.every(c => c.bullets.length >= 2) ? columns : null
}

/** A headline figure worth its own slide. */
function extractStat(sentences: string[]): { value: string; caption: string } | null {
  for (const sentence of sentences) {
    const m = sentence.match(/\b(\d{1,3}(?:[.,]\d+)?\s*(?:%|percent))/i)
    if (!m) continue
    const caption = compressSentence(sentence.replace(m[0], '').trim(), 14)
    if (caption) return { value: m[1].replace(/\s*percent/i, '%'), caption }
  }
  return null
}

// --- Section merging ----------------------------------------------------

interface SlideGroup {
  sections: DocSectionNode[]
  /** Set when the group is a contrast pair destined for a comparison layout. */
  comparison?: boolean
  /** Set when thin neighbours were combined so they could fill one slide. */
  merged?: boolean
}

/**
 * Merges adjacent sibling sections whose headings form a natural contrast
 * ("Advantages" then "Limitations") into a single comparison slide.
 *
 * This does double duty: it is a merge pass for the slide budget, and it is the
 * most honest source of a non-bullet layout, because the contrast is the
 * document's own structure rather than something imposed on it.
 */
function groupSections(sections: DocSectionNode[]): SlideGroup[] {
  const groups: SlideGroup[] = []

  for (let i = 0; i < sections.length; i++) {
    const a = sections[i]
    const b = sections[i + 1]

    if (b && sameParent(a, b)) {
      const contrast = CONTRAST_PAIRS.some(
        ([left, right]) =>
          (left.test(a.heading) && right.test(b.heading)) ||
          (right.test(a.heading) && left.test(b.heading))
      )
      if (contrast) {
        groups.push({ sections: [a, b], comparison: true })
        i++
        continue
      }
    }

    groups.push({ sections: [a] })
  }

  return groups
}

/** "1.3.1" and "1.3.2" share the parent "1.3". */
function sameParent(a: DocSectionNode, b: DocSectionNode): boolean {
  const parent = (id: string) => id.split('.').slice(0, -1).join('.')
  return !!a.id && !!b.id && parent(a.id) === parent(b.id) && parent(a.id) !== ''
}

/**
 * A section thin enough that it cannot fill a slide on its own.
 *
 * Measured in usable sentences rather than words: the summariser rejects
 * anything it cannot shorten honestly, so a 200-word section of dense,
 * unshortenable prose yields as little as a 60-word one.
 */
function usableSentences(group: SlideGroup): number {
  return group.sections.reduce(
    (n, s) => n + s.sentences.filter(x => x.trim().length >= 25).length,
    0
  )
}

/** Combined length, used to stop a merge producing an overstuffed slide. */
function groupWords(group: SlideGroup): number {
  return group.sections.reduce((n, s) => n + s.wordCount, 0)
}

/**
 * Merges neighbouring thin sections so they are summarised TOGETHER.
 *
 * This is the fix for the deck's worst remaining weakness. The strict "never
 * cut mid-thought" rule means a thin section can yield one bullet, and a
 * one-bullet slide reads as broken even though nothing on it is wrong. Merging
 * before summarisation - rather than padding afterwards - lets the summariser
 * choose the best six bullets from a larger pool, which is both fuller and
 * better than two half-empty slides.
 *
 * Only adjacent sections from the SAME chapter merge, so provenance stays
 * truthful and the eyebrow can still name one chapter.
 */
function mergeThinGroups(groups: SlideGroup[]): SlideGroup[] {
  const MIN_SENTENCES = 8
  const MAX_MERGED_WORDS = 520

  const out: SlideGroup[] = []

  for (const group of groups) {
    const previous = out[out.length - 1]

    const canMerge =
      previous &&
      !previous.comparison &&
      !group.comparison &&
      previous.sections[0].chapter === group.sections[0].chapter &&
      previous.sections[0].kind === group.sections[0].kind &&
      (usableSentences(previous) < MIN_SENTENCES || usableSentences(group) < MIN_SENTENCES) &&
      groupWords(previous) + groupWords(group) <= MAX_MERGED_WORDS

    if (canMerge) {
      previous.sections = [...previous.sections, ...group.sections]
      previous.merged = true
    } else {
      out.push({ ...group, sections: [...group.sections] })
    }
  }

  return out
}

// --- Section importance -------------------------------------------------

function importanceOf(section: DocSectionNode): number {
  const t = `${section.heading} ${section.id}`.toLowerCase()
  if (/reference|bibliograph/.test(t)) return 0.3
  if (/appendix|acknowledge|dedication/.test(t)) return 0.2
  if (/conclusion|finding|takeaway|result|discussion/.test(t)) return 1.5
  if (/problem|motivation/.test(t)) return 1.4
  if (/aim|objective/.test(t)) return 1.4
  if (/architect|working principle|process|methodolog|design/.test(t)) return 1.3
  if (/gap|limitation|challenge/.test(t)) return 1.2
  if (/future|recommend/.test(t)) return 1.1
  if (/abstract|introduction/.test(t)) return 1.0
  if (/literature|existing|previous|review/.test(t)) return 0.9
  return 0.8
}

function groupWeight(group: SlideGroup): number {
  const words = group.sections.reduce((n, s) => n + s.wordCount, 0)
  const importance = Math.max(...group.sections.map(importanceOf))
  return importance * Math.sqrt(Math.max(1, words))
}

// --- References ---------------------------------------------------------

/**
 * Shortens a citation to "Author (year) - Title".
 *
 * Returns '' when it cannot be shortened without cutting mid-string. The
 * shipped deck truncated entries at a fixed character count, producing
 * "IEEE Communications Magazine, 50(12)," on the slide; dropping an entry is
 * strictly better than showing half of one.
 */
export function shortenCitation(entry: string, maxChars = 78): string {
  const text = entry.replace(/\s+/g, ' ').trim()
  if (!text) return ''

  const m = text.match(/^(.+?)\s*\((\d{4}[a-z]?)\)\.?\s*(.+?)(?:\.\s|$)/)
  // Strict: no author-year, not a citation. The permissive version passed
  // short non-citations straight through, which is how "(Listed in APA 7th
  // Edition format)" and "programmable networks. ACM SIGCOMM…" reached the
  // references slide as if they were sources.
  if (!m) return ''

  const [, authorsRaw, year, titleRaw] = m

  // "Surname, A., Other, B., & Third, C." -> "Surname et al."
  const surnames = authorsRaw
    .split(/,\s*(?:&\s*)?|\s+&\s+/)
    .map(part => part.trim())
    .filter(part => /^[A-Z][A-Za-z'’\-]{1,}$/.test(part))

  const authors =
    surnames.length === 0
      ? authorsRaw.split(',')[0].trim()
      : surnames.length === 1
      ? surnames[0]
      : surnames.length === 2
      ? `${surnames[0]} & ${surnames[1]}`
      : `${surnames[0]} et al.`

  const title = titleRaw.replace(/\.$/, '').trim()
  const head = `${authors} (${year}) - `

  const room = maxChars - head.length
  if (room < 16) return ''

  if (title.length <= room) return head + title

  // Trim the TITLE at a word boundary only, and mark the elision so nothing
  // reads as a complete but wrong citation.
  const cut = title.slice(0, room - 1).lastIndexOf(' ')
  if (cut < 16) return ''
  return `${head}${title.slice(0, cut)}…`
}

// --- The planner ---------------------------------------------------------

export interface PlanOptions {
  spec: PresentationSpec
  metadata: DeckMetadata
  /** Overrides the spec's slide ceiling; still clamped to the spec range. */
  maxSlides?: number
}

export interface PlanDiagnostics {
  /** Sections the document has but the deck had no room for. */
  droppedSections: string[]
  /** Escalation and layout decisions, for the build log. */
  decisions: string[]
}

export interface DeckPlanResult {
  plan: SlidePlan
  diagnostics: PlanDiagnostics
}

/**
 * Builds the deck from the document tree.
 *
 * Order is document order throughout: the argument a student defends has to
 * read in the order they wrote it.
 */
export function planDeck(tree: DocTree, options: PlanOptions): DeckPlanResult {
  const { spec, metadata } = options
  const decisions: string[] = []

  const maxTotal = Math.min(options.maxSlides ?? spec.deck.maxSlides, spec.deck.maxSlides)

  const bodySections = tree.sections.filter(
    s => s.kind !== 'back' && (s.sentences.length > 0 || s.tables.length > 0)
  )

  const groups = mergeThinGroups(groupSections(bodySections))
  for (const g of groups) {
    if (g.comparison) {
      decisions.push(
        `merged §${g.sections[0].id} and §${g.sections[1].id} into one comparison slide`
      )
    } else if (g.merged) {
      decisions.push(
        `merged thin sections ${g.sections.map(s => `§${s.id || s.heading}`).join(' + ')} onto one slide`
      )
    }
  }

  // Reserve: title, closing, a references slide, and a slot for each source
  // table that a comparison slide will not itself display.
  const hasReferences = tree.references.length > 0
  const harvestable = countHarvestableTables(groups)
  const reserved = 2 + (hasReferences ? 1 : 0) + harvestable
  const contentBudget = Math.max(1, maxTotal - reserved)

  // Every chapter keeps at least its strongest section, then the budget goes to
  // the heaviest groups. This is what stops a long Chapter Two from crowding
  // Chapter Four out of the deck entirely.
  const selected = selectGroups(groups, contentBudget, decisions)

  const seen = new Set<string>()
  const contentSlides: PlannedSlide[] = []

  for (const group of selected) {
    const slide = buildSlide(group, spec, seen, decisions)
    if (slide) contentSlides.push(slide)
  }

  // Order matters: fold under-filled slides away BEFORE harvesting tables, so a
  // table is never inserted next to a slide that is about to disappear.
  mergeUnderfilledSlides(contentSlides, spec, decisions)
  harvestTables(contentSlides, selected, spec, decisions)
  ensureLayoutVariety(contentSlides, spec, decisions)

  const slides: PlannedSlide[] = [
    buildTitleSlide(metadata),
    ...contentSlides,
  ]

  if (hasReferences) {
    const refSlide = buildReferencesSlide(tree.references)
    if (refSlide) slides.push(refSlide)
  }

  slides.push(buildClosingSlide(metadata))

  const droppedSections = groups
    .filter(g => !selected.includes(g))
    .map(g => `§${g.sections[0].id} ${g.sections[0].heading}`)

  if (droppedSections.length > 0) {
    decisions.push(`dropped ${droppedSections.length} section(s) to stay within ${maxTotal} slides`)
  }
  // A deck under the spec minimum is padded with CHAPTER DIVIDERS rather than
  // by loosening the bullet rules. A divider is real structure - it names a
  // chapter the document actually has - so it adds navigation for the audience
  // instead of filler, and it is the one place where extra slides do not mean
  // extra claims to defend.
  if (slides.length < spec.deck.minSlides) {
    const added = insertChapterDividers(slides, spec.deck.minSlides)
    if (added > 0) decisions.push(`inserted ${added} chapter divider slide(s) to reach the ${spec.deck.minSlides}-slide minimum`)
    if (slides.length < spec.deck.minSlides) {
      decisions.push(
        `deck is ${slides.length} slides, under the spec minimum of ${spec.deck.minSlides}; ` +
          `the document does not carry enough distinct sections to fill it`
      )
    }
  }

  return {
    plan: { metadata, slides },
    diagnostics: { droppedSections, decisions },
  }
}

/** Picks which groups make the deck: chapter coverage first, then weight. */
function selectGroups(groups: SlideGroup[], budget: number, decisions: string[]): SlideGroup[] {
  if (groups.length <= budget) return groups

  const chosen = new Set<SlideGroup>()

  // One slide per chapter, so no chapter vanishes.
  const byChapter = new Map<number | null, SlideGroup[]>()
  for (const g of groups) {
    const chapter = g.sections[0].chapter
    const list = byChapter.get(chapter)
    if (list) list.push(g)
    else byChapter.set(chapter, [g])
  }

  for (const [, list] of byChapter) {
    if (chosen.size >= budget) break
    const best = [...list].sort((a, b) => groupWeight(b) - groupWeight(a))[0]
    if (best) chosen.add(best)
  }

  // Fill the rest by weight.
  for (const g of [...groups].sort((a, b) => groupWeight(b) - groupWeight(a))) {
    if (chosen.size >= budget) break
    chosen.add(g)
  }

  decisions.push(`selected ${chosen.size} of ${groups.length} sections for ${budget} content slides`)

  // Restore document order.
  return groups.filter(g => chosen.has(g))
}

/** Builds one content slide, choosing the layout its content justifies. */
function buildSlide(
  group: SlideGroup,
  spec: PresentationSpec,
  seen: Set<string>,
  decisions: string[]
): PlannedSlide | null {
  const sections = group.sections
  const primary = sections[0]
  const sentences = sections.flatMap(s => s.sentences)
  // "vs" only where the document genuinely draws a contrast. Merged thin
  // sections are joined with "&"; three or more keep the leading heading rather
  // than growing an unreadable chain.
  const title = (
    sections.length === 1
      ? primary.heading
      : group.comparison
      ? `${primary.heading} vs ${sections[1].heading}`
      : sections.length === 2
      ? `${primary.heading} & ${sections[1].heading}`
      : primary.heading
  ).toUpperCase()

  const base = {
    title: title.length > 58 ? `${title.slice(0, 55).trim()}...` : title,
    eyebrow: eyebrowFor(sections),
    sourceRefs: sourceRefsFor(sections),
  }

  const takeaway = deriveTakeaway(sentences, primary.heading)
  const notes = buildSpeakerNotes({ spec, heading: primary.heading, takeaway, sentences })

  // 1. A contrast the document itself drew beats anything inferred. Its tables
  //    are not lost: they are harvested onto their own slides afterwards.
  if (group.comparison) {
    const columns = extractColumns(sections, spec)
    if (columns) {
      decisions.push(`${base.title}: comparison layout`)
      return { ...base, layout: 'comparison', columns, notes, takeaway }
    }
  }

  // 2. A real table in the source beats prose about it.
  const table = sections.map(s => s.tables).flat().map(normalizeTable).find(Boolean)
  if (table) {
    // The caption describes the TABLE; the section heading describes the prose
    // the table displaced. Titling the slide "User Interface / Mobile
    // Application" over a table of RFID frequency ranges is simply wrong.
    const captioned = tableHeading(table, '')
    const title = captioned ? captioned.toUpperCase().slice(0, 58) : base.title
    decisions.push(`${title}: table layout (source table with ${table.rows.length} rows)`)
    return {
      ...base,
      title,
      eyebrow: tableEyebrow(table, sections),
      layout: 'table',
      // The caption is now the title; repeating it above the grid is noise.
      table: { ...table, caption: undefined },
      notes,
      takeaway,
    }
  }

  // 3. An ordered sequence the document itself states: numbered stages, a
  //    chronology of phases, or an enumerated set of layers/components.
  //    extractSteps returns [] unless one of those is genuinely present, so it
  //    is safe to always ask rather than gating on a keyword.
  const steps = extractSteps(sentences)
  if (steps.length >= 3) {
    decisions.push(
      `${base.title}: process layout (${steps.length} x ${steps.map(s => s.title).join(' / ')})`
    )
    return { ...base, layout: 'process', steps, notes, takeaway }
  }

  // 4. A headline figure.
  const stat = extractStat(sentences)
  if (stat) {
    const support = summarizeToBullets(sentences, { spec, count: 3, wordBudget: 9, seen })
    if (support.length >= 2) {
      decisions.push(`${base.title}: stat layout (${stat.value})`)
      return { ...base, layout: 'stat', stat, bullets: support, notes, takeaway }
    }
  }

  // 5. Otherwise, bullets.
  const bullets = summarizeToBullets(sentences, {
    spec,
    count: spec.deck.maxBulletsPerSlide,
    seen,
  })
  if (bullets.length === 0) return null

  // Under-filled: hand the model the source so it can REWRITE what the rule
  // based compressor could only reject. Capped, because the whole section is
  // not needed to write three more bullets.
  const sourceSentences =
    bullets.length < 3
      ? sentences.filter(s => s.trim().length >= 25).slice(0, 12)
      : undefined
  if (sourceSentences) {
    decisions.push(`${base.title}: only ${bullets.length} bullet(s); source attached for the model to rewrite`)
  }

  return { ...base, layout: 'bullets', bullets, notes, takeaway, sourceSentences }
}

/** Tables that a comparison slide will not itself display, capped at two. */
const MAX_HARVESTED_TABLES = 2

function countHarvestableTables(groups: SlideGroup[]): number {
  let n = 0
  for (const group of groups) {
    if (!group.comparison) continue
    n += group.sections.flatMap(s => s.tables).map(normalizeTable).filter(Boolean).length
  }
  return Math.min(n, MAX_HARVESTED_TABLES)
}

/**
 * Gives a source table its own slide when the slide built from its section
 * used a different layout.
 *
 * Without this, merging "Advantages" and "Limitations" into one comparison
 * slide silently discarded the "Traditional vs SDN" table those sections
 * carried - and that table is the single most presentable artifact in the
 * document. The table slide is inserted directly after its source slide so the
 * argument still reads in order.
 */
function harvestTables(
  slides: PlannedSlide[],
  groups: SlideGroup[],
  spec: PresentationSpec,
  decisions: string[]
): void {
  let added = 0
  // The same table can be reachable from more than one section after merging,
  // which put the identical grid on two slides. Keyed on content, not identity.
  const seenTables = new Set<string>()

  for (const group of groups) {
    if (added >= MAX_HARVESTED_TABLES) break

    const refs = sourceRefsFor(group.sections)
    // Recomputed per insertion: a previous splice shifts every later index, and
    // carrying a running offset instead placed tables under the wrong slide.
    const sourceIndex = slides.findIndex(s => sameRefs(s.sourceRefs, refs))
    if (sourceIndex === -1) continue
    if (slides[sourceIndex].layout === 'table') continue

    for (const raw of group.sections.flatMap(s => s.tables)) {
      if (added >= MAX_HARVESTED_TABLES) break

      const table = normalizeTable(raw)
      if (!table) continue

      const key = [table.headers.join('|'), ...table.rows.map(r => r.join('|'))].join('#')
      if (seenTables.has(key)) continue
      seenTables.add(key)

      const heading = tableHeading(table, group.sections[0].heading)
      const sentences = group.sections.flatMap(s => s.sentences)
      const takeaway = deriveTakeaway(sentences, heading)

      const insertAt = slides.findIndex(s => sameRefs(s.sourceRefs, refs))
      slides.splice(insertAt + 1, 0, {
        layout: 'table',
        title: heading.toUpperCase().slice(0, 58),
        eyebrow: tableEyebrow(table, group.sections),
        table,
        notes: buildSpeakerNotes({ spec, heading, takeaway, sentences }),
        takeaway,
        sourceRefs: refs,
      })
      added++
      decisions.push(`harvested a ${table.rows.length}-row table from §${group.sections[0].id} onto its own slide`)
    }
  }
}

/** Caption without its "Table 2.2:" label, which the slide title does not need. */
function tableHeading(table: DocTable, fallback: string): string {
  const caption = (table.caption ?? '').replace(/^\s*table\s*\d+(\.\d+)?\s*[:.\-]\s*/i, '').trim()
  return caption || `${fallback} at a glance`
}

/**
 * A table's eyebrow, and no eyebrow at all when the evidence conflicts.
 *
 * A caption reading "Table 2.2" places the table in Chapter Two. When that
 * disagrees with the chapter of the section the parser attached it to - which
 * happens in DOCX, where a table can be lifted away from its heading - neither
 * source is trustworthy enough to print, so nothing is claimed. Asserting the
 * wrong chapter is the defect the provenance check exists to stop.
 */
function tableEyebrow(table: DocTable, sections: DocSectionNode[]): string | undefined {
  const derived = eyebrowFor(sections)
  const captioned = (table.caption ?? '').match(/^\s*table\s*(\d+)\./i)
  if (!captioned || !derived) return derived

  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  }
  const claimed = derived.toLowerCase().replace('chapter ', '')
  const claimedNum = words[claimed] ?? Number.parseInt(claimed, 10)

  return claimedNum === Number.parseInt(captioned[1], 10) ? derived : undefined
}

function sameRefs(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * Last resort for a slide the summariser could not fill: fold it into a
 * neighbour from the same chapter, or drop it.
 *
 * The pre-summarisation merge works on sentence counts, which is a proxy. This
 * runs on the ACTUAL bullet yield, so it catches the case the proxy misses -
 * a section with plenty of sentences, almost all of which the compressor
 * rightly refuses to shorten.
 */
function mergeUnderfilledSlides(
  slides: PlannedSlide[],
  spec: PresentationSpec,
  decisions: string[]
): void {
  for (let i = slides.length - 1; i >= 0; i--) {
    const slide = slides[i]
    if (slide.layout !== 'bullets') continue
    if ((slide.bullets?.length ?? 0) >= 2) continue

    const isHost = (other: PlannedSlide | undefined) =>
      !!other &&
      other.layout === 'bullets' &&
      other.eyebrow === slide.eyebrow &&
      (other.bullets?.length ?? 0) + (slide.bullets?.length ?? 0) <= spec.deck.maxBulletsPerSlide

    const before = slides[i - 1]
    const after = slides[i + 1]
    const host = isHost(before) ? before : isHost(after) ? after : null

    if (host) {
      const merged = isHost(before)
        ? [...(host.bullets ?? []), ...(slide.bullets ?? [])]
        : [...(slide.bullets ?? []), ...(host.bullets ?? [])]
      host.bullets = merged
      host.sourceRefs = [...new Set([...host.sourceRefs, ...slide.sourceRefs])]
      decisions.push(`folded under-filled "${slide.title}" into "${host.title}"`)
    } else {
      decisions.push(`dropped under-filled "${slide.title}" (${slide.bullets?.length ?? 0} bullet(s), no neighbour to merge with)`)
    }

    slides.splice(i, 1)
  }
}

/**
 * Enforces the spec's non-bullet ratio.
 *
 * The shipped deck used an identical title-and-bullets layout on 13 of 13
 * slides. Where a bullets slide has enough structure to carry a richer layout,
 * it is promoted; where none does, the shortfall is logged rather than faked.
 */
function ensureLayoutVariety(slides: PlannedSlide[], spec: PresentationSpec, decisions: string[]): void {
  const target = Math.ceil(slides.length * spec.deck.minNonBulletRatio)
  const nonBullet = () => slides.filter(s => s.layout !== 'bullets').length

  if (nonBullet() >= target) return

  // Deliberately no promotion pass.
  //
  // This used to relabel a slide's bullets as "Step 1 ... Step 5" whenever the
  // deck was short of non-bullet layouts. That is decoration masquerading as
  // structure: "Step 3" tells the reader nothing the bullet did not, and it
  // asserts a sequence the document never claimed. A layout has to be earned by
  // content that is genuinely a table, a contrast or an ordered sequence, so a
  // shortfall is reported and left alone.
  decisions.push(
    `only ${nonBullet()} of ${slides.length} content slides use a non-bullet layout ` +
      `(target ${target}); the source did not provide enough tables, contrasts or sequences, ` +
      `and inventing one would not help the reader`
  )
}

/**
 * Inserts a divider before the first slide of each chapter, in document order,
 * until the deck reaches `target`. Returns how many were added.
 *
 * The divider carries the chapter's own name and the sections that follow it,
 * so it is derived entirely from the source. Chapters are visited in order, so
 * a deck one slide short gets a divider at Chapter One rather than an
 * arbitrary one somewhere in the middle.
 */
function insertChapterDividers(slides: PlannedSlide[], target: number): number {
  const firstOfChapter = new Map<string, number>()

  slides.forEach((slide, i) => {
    if (!slide.eyebrow || !/^chapter /i.test(slide.eyebrow)) return
    if (!firstOfChapter.has(slide.eyebrow)) firstOfChapter.set(slide.eyebrow, i)
  })

  let added = 0
  // Insert from the back so earlier indices stay valid.
  const targets = [...firstOfChapter.entries()].sort((a, b) => b[1] - a[1])

  for (const [eyebrow, index] of targets) {
    if (slides.length >= target) break

    // What this chapter covers, taken from the titles that follow it.
    const covers = slides
      .filter(s => s.eyebrow === eyebrow && s.layout !== 'section')
      .map(s => titleCaseWords(s.title))
      .slice(0, 4)
    if (covers.length === 0) continue

    slides.splice(index, 0, {
      layout: 'section',
      title: eyebrow.toUpperCase(),
      bullets: covers,
      notes:
        `Signpost the change of chapter before you move on. Say in one sentence what ${eyebrow} ` +
        `establishes and why it follows from the last chapter, then name the ${covers.length} ` +
        `areas listed here so the panel knows what is coming. Keep this to about fifteen seconds ` +
        `and do not read the list aloud verbatim.`,
      takeaway: `${eyebrow} covers ${covers.slice(0, 2).join(' and ')}`,
      sourceRefs: [eyebrow.toLowerCase().replace('chapter ', '§')],
    })
    added++
  }

  return added
}

/** "SUMMARY OF EXISTING WORKS" -> "Summary of existing works". */
function titleCaseWords(text: string): string {
  const lower = text.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

function buildTitleSlide(metadata: DeckMetadata): PlannedSlide {
  return {
    layout: 'title',
    title: metadata.title,
    notes:
      'Introduce yourself, state the title, and name your supervisor. Say in one sentence why this ' +
      'topic matters to enterprise networks today, then move on quickly - the panel wants the argument, ' +
      'not the preamble. Keep this slide to under thirty seconds and do not read the identity block aloud.',
    sourceRefs: ['cover page'],
    takeaway: metadata.title,
  }
}

function buildClosingSlide(metadata: DeckMetadata): PlannedSlide {
  return {
    layout: 'closing',
    title: 'THANK YOU',
    notes:
      'Thank the panel and invite questions. Have your key figure and your strongest limitation ready, ' +
      'because those attract the first questions. If you are asked something outside the scope of the ' +
      'seminar, say so plainly and offer what your sources do support rather than speculating.',
    sourceRefs: ['closing'],
    takeaway: `${metadata.studentName} closes and takes questions`,
  }
}

function buildReferencesSlide(references: string[]): PlannedSlide | null {
  const shortened = references
    .map(r => shortenCitation(r))
    .filter(Boolean)
    .slice(0, 8)

  if (shortened.length === 0) return null

  return {
    layout: 'references',
    title: 'KEY SOURCES',
    citations: shortened,
    notes:
      'These are the sources the argument leans on most heavily. Name the seminal paper and the most ' +
      'recent survey if asked where the field stands. Do not read the list aloud; it is here so the ' +
      'panel can see the work is grounded, and so you can point to a specific study when challenged.',
    sourceRefs: ['references'],
    takeaway: `${shortened.length} sources underpin this seminar`,
  }
}
