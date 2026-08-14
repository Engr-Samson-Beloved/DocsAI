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

import type { DocSectionNode, DocTree } from './docTree'
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
 * Extracts a process from ordinal stage sentences: "The first stage is network
 * discovery and topology mapping." -> { title: 'Network discovery and topology
 * mapping', body: <the following sentence, compressed> }.
 */
export function extractSteps(sentences: string[]): SlideStep[] {
  const steps: SlideStep[] = []

  for (const ordinal of ORDINALS) {
    const pattern = new RegExp(`\\b${ordinal}\\b[^.]*\\b(stage|step|phase)\\b`, 'i')
    const index = sentences.findIndex(s => pattern.test(s))
    if (index === -1) continue

    const sentence = sentences[index]
    // Take what follows "is"/"involves"/":" as the step's name.
    const m = sentence.match(/\b(?:is|involves|covers|concerns|begins with)\b\s+(.+)$/i)
    const rawTitle = m ? m[1] : sentence.replace(pattern, '').replace(/^[\s,:-]+/, '')
    const title = compressSentence(rawTitle, 6)
    if (!title) continue

    const body = compressSentence(sentences[index + 1] ?? '', 12)
    steps.push({ title, body })
    if (steps.length >= 5) break
  }

  return steps.length >= 3 ? steps : []
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
  if (!m) return text.length <= maxChars ? text : ''

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

  const groups = groupSections(bodySections)
  for (const g of groups) {
    if (g.comparison) {
      decisions.push(
        `merged §${g.sections[0].id} and §${g.sections[1].id} into one comparison slide`
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
  if (slides.length < spec.deck.minSlides) {
    decisions.push(
      `deck is ${slides.length} slides, under the spec minimum of ${spec.deck.minSlides}; ` +
        `the document does not carry enough distinct sections to fill it`
    )
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
  const title = (sections.length > 1
    ? `${primary.heading} vs ${sections[1].heading}`
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
    decisions.push(`${base.title}: table layout (source table with ${table.rows.length} rows)`)
    return { ...base, layout: 'table', table, notes, takeaway }
  }

  // 3. An explicit sequence of stages.
  if (PROCESS_SIGNALS.test(sentences.join(' '))) {
    const steps = extractSteps(sentences)
    if (steps.length >= 3) {
      decisions.push(`${base.title}: process layout (${steps.length} stages)`)
      return { ...base, layout: 'process', steps, notes, takeaway }
    }
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

  return { ...base, layout: 'bullets', bullets, notes, takeaway }
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

  for (const group of groups) {
    if (added >= MAX_HARVESTED_TABLES) break

    const sourceIndex = slides.findIndex(s => sameRefs(s.sourceRefs, sourceRefsFor(group.sections)))
    if (sourceIndex === -1) continue
    if (slides[sourceIndex].layout === 'table') continue

    for (const raw of group.sections.flatMap(s => s.tables)) {
      if (added >= MAX_HARVESTED_TABLES) break
      const table = normalizeTable(raw)
      if (!table) continue

      const heading = table.caption || `${group.sections[0].heading} at a glance`
      const sentences = group.sections.flatMap(s => s.sentences)
      const takeaway = deriveTakeaway(sentences, heading)

      slides.splice(sourceIndex + 1 + added, 0, {
        layout: 'table',
        title: heading.toUpperCase().slice(0, 58),
        eyebrow: eyebrowFor(group.sections),
        table,
        notes: buildSpeakerNotes({ spec, heading, takeaway, sentences }),
        takeaway,
        sourceRefs: sourceRefsFor(group.sections),
      })
      added++
      decisions.push(`harvested a ${table.rows.length}-row table from §${group.sections[0].id} onto its own slide`)
    }
  }
}

function sameRefs(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
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

  for (const slide of slides) {
    if (nonBullet() >= target) break
    if (slide.layout !== 'bullets' || !slide.bullets) continue

    // Four or more short bullets read well as a numbered process.
    if (slide.bullets.length >= 4 && slide.bullets.every(b => b.length <= 70)) {
      slide.steps = slide.bullets.slice(0, 5).map((b, i) => ({
        title: `Step ${i + 1}`,
        body: b,
      }))
      slide.layout = 'process'
      slide.bullets = undefined
      decisions.push(`${slide.title}: promoted to a process layout to meet the variety rule`)
    }
  }

  if (nonBullet() < target) {
    decisions.push(
      `only ${nonBullet()} of ${slides.length} content slides use a non-bullet layout ` +
        `(target ${target}); the source did not provide enough tables, contrasts or sequences`
    )
  }
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
