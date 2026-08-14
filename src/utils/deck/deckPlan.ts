/**
 * deckPlan.ts
 * ------------------------------------------------------------------
 * Decides what the deck says, and in what shape.
 *
 * Three principles, each replacing a defect:
 *
 *  1. **Roles, not headings.** A reader needs the problem, the aim, the
 *     comparison, the evidence, the findings, the limits and the conclusion.
 *     Mapping headings to slides produced a deck with no problem statement and
 *     no objectives even though the report contained both, because those live
 *     under headings that do not announce themselves. Roles are detected in the
 *     source and each one present is guaranteed a slide.
 *
 *  2. **Titles from content.** A title names the subject, never the subject's
 *     location in the document. See titles.ts.
 *
 *  3. **Layout from content shape.** A comparison gets two cards, a procedure
 *     gets a numbered flow, entities compared on shared attributes get a table,
 *     a system with components gets a diagram. Bullets are what is left when
 *     the content is genuinely a list of points - not the default that
 *     everything falls back to.
 *
 * There are no chapter eyebrows and no divider slides. Both told the reader
 * where text came from rather than what it says.
 */

import type { DocSectionNode, DocTable, DocTree } from './docTree'
import type { PresentationSpec } from './presentationSpec'
import type { PlannedSlide, SlidePlan, SlideStep, DeckMetadata } from './slidePlan'
import { summarizeToBullets, deriveTakeaway, compressSentence } from './summarize'
import { buildNotesFromSlide } from './speakerNotes'
import { titleFromContent, buildDeckTermCounts, type SlideRole } from './titles'
import { isClaim } from './claims'

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

// --- Roles --------------------------------------------------------------

/**
 * Rhetorical roles, in the order a seminar argument runs.
 *
 * Detection is by heading first and content second, so a section called
 * "1.2 Problem Definition and Motivation" and one called "The Congestion
 * Challenge" both land on `problem`.
 */
const ROLE_SIGNALS: { role: SlideRole; heading: RegExp; content?: RegExp }[] = [
  { role: 'problem', heading: /\b(problem|motivation|challenge|congestion|bottleneck|need\s+for)\b/i },
  { role: 'objectives', heading: /\b(aim|objective|goal|purpose)\b/i },
  { role: 'scope', heading: /\b(scope|significance|delimitation|justification)\b/i },
  { role: 'evidence', heading: /\b(literature|existing\s+work|previous\s+(work|research)|related\s+work|case\s+stud|empirical|prior\s+art)\b/i },
  { role: 'limitations', heading: /\b(limitation|drawback|constraint|barrier|challenge|risk|gap)\b/i },
  { role: 'findings', heading: /\b(finding|result|takeaway|discussion|outcome|evaluation)\b/i },
  { role: 'conclusion', heading: /\b(conclusion|future|outlook|recommend|further\s+work)\b/i },
  { role: 'comparison', heading: /\b(comparison|versus|\bvs\b|contrast|alternatives)\b/i },
  { role: 'background', heading: /\b(architecture|framework|principle|fundamental|concept|component|mechanism|how\s+it\s+works|technolog|protocol|design)\b/i },
]

export function detectRole(section: DocSectionNode): SlideRole {
  const heading = section.heading
  for (const { role, heading: pattern } of ROLE_SIGNALS) {
    if (pattern.test(heading)) return role
  }

  // Fall back to the opening prose, which usually announces the role even when
  // the heading does not.
  const opening = section.sentences.slice(0, 3).join(' ')
  for (const { role, heading: pattern } of ROLE_SIGNALS) {
    if (pattern.test(opening)) return role
  }

  return 'other'
}

// --- Content shape ------------------------------------------------------

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'final']
const PHASE_ORDINALS = ['initial', 'first', 'second', 'third', 'fourth', 'fifth', 'final']

const CONTRAST_PAIRS: [RegExp, RegExp][] = [
  [/\badvantage|\bbenefit|\bstrength/i, /\blimitation|\bdrawback|\bchallenge|\bweakness/i],
  [/\btraditional|\blegacy|\bconventional/i, /\bsdn|\bproposed|\bmodern|\bsoftware[- ]defined/i],
  [/\bexisting|\bcurrent/i, /\bproposed|\bfuture/i],
]

/** Flow language: the signal that components form a system rather than a list. */
const FLOW_LANGUAGE =
  /\b(feeds?|passes?\s+to|sends?\s+to|forwards?\s+to|flows?\s+(to|through)|then\s+the|downstream|upstream|in\s+turn|closes?\s+the\s+loop|sits?\s+above|sits?\s+below|layered?|plane|tier)\b/i

// --- Section grouping ---------------------------------------------------

interface SlideGroup {
  sections: DocSectionNode[]
  role: SlideRole
  comparison?: boolean
  merged?: boolean
}

function sameParent(a: DocSectionNode, b: DocSectionNode): boolean {
  const parent = (id: string) => id.split('.').slice(0, -1).join('.')
  return !!a.id && !!b.id && parent(a.id) === parent(b.id) && parent(a.id) !== ''
}

function usableSentences(group: SlideGroup): number {
  return group.sections.reduce((n, s) => n + s.sentences.length, 0)
}

function groupWords(group: SlideGroup): number {
  return group.sections.reduce((n, s) => n + s.wordCount, 0)
}

/** Pairs adjacent sibling sections whose headings form a genuine contrast. */
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
        groups.push({ sections: [a, b], role: 'comparison', comparison: true })
        i++
        continue
      }
    }

    groups.push({ sections: [a], role: detectRole(a) })
  }

  return groups
}

/**
 * Merges neighbouring thin sections so they are summarised TOGETHER.
 *
 * Only merges within a chapter and only when the roles agree, so a merge can
 * never blur two different parts of the argument into one slide.
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
      previous.role === group.role &&
      previous.sections[0].chapter === group.sections[0].chapter &&
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

// --- Tables -------------------------------------------------------------

export function normalizeTable(table: DocTable): DocTable | null {
  const width = table.headers.length
  if (width < 2 || width > 5) return null
  if (table.headers.some(h => !h.trim() || h.split(/\s+/).length > 5)) return null

  const clean = table.rows.filter(r => r.length === width && r.some(c => c.trim()))
  if (clean.length < 2) return null
  if (clean.length / table.rows.length < 0.6) return null

  return { caption: table.caption, headers: table.headers, rows: clean.slice(0, 6) }
}

// --- Step / component extraction ---------------------------------------

export function extractSteps(sentences: string[]): SlideStep[] {
  return (
    extractOrdinalStages(sentences) ||
    extractPhaseTimeline(sentences) ||
    extractEnumeratedComponents(sentences) ||
    []
  )
}

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

    steps.push({ title, body: shortenPredicate(sentences[index + 1] ?? '', 12) })
    if (steps.length >= 5) break
  }

  return steps.length >= 3 ? steps : null
}

function extractPhaseTimeline(sentences: string[]): SlideStep[] | null {
  const steps: SlideStep[] = []
  const used = new Set<number>()

  for (const ordinal of PHASE_ORDINALS) {
    const pattern = new RegExp(`\\b${ordinal}\\b[^.]{0,60}\\bphase\\b`, 'i')
    const index = sentences.findIndex((s, i) => !used.has(i) && pattern.test(s))
    if (index === -1) continue
    used.add(index)

    const sentence = sentences[index]
    const span = sentence.match(/\b((?:19|20)\d{2})\s*(?:to|-|–|—|until)\s*((?:19|20)\d{2})\b/)
    const single = sentence.match(/\b(?:since|from|after)\s+((?:19|20)\d{2})\b/)
    const title = span
      ? `${span[1]}-${span[2]}`
      : single
      ? `${single[1]} onward`
      : /\bcurrent\b/i.test(sentence)
      ? `${capitalise(ordinal)} phase (current)`
      : `${capitalise(ordinal)} phase`

    const body = predicateOf(sentence, /^.*?\bphase\b/i)
    if (!body) continue

    steps.push({ title, body })
    if (steps.length >= 5) break
  }

  return steps.length >= 3 ? steps : null
}

function extractEnumeratedComponents(sentences: string[]): SlideStep[] | null {
  const lead = sentences.find(s =>
    /\b(?:organi[sz]ed|divided|separated|composed|structured)\s+(?:in)?to\b|\b(?:consists?|comprises?)\s+of\b/i.test(s)
  )
  if (!lead) return null

  const noun = lead.match(
    /\b(?:in)?to\s+(?:\w+\s+)?(?:distinct\s+|main\s+|key\s+|separate\s+|broad\s+)?([a-z]+?)s\b/i
  )
  if (!noun) return null
  const singular = noun[1].toLowerCase()
  if (singular.length < 4) return null

  const steps: SlideStep[] = []
  const seen = new Set<string>()

  for (const sentence of sentences) {
    if (sentence === lead) continue

    const m = sentence.match(
      new RegExp(`^(?:The\\s+)?([A-Za-z][\\w-]*(?:\\s+[a-z][\\w-]*)?)\\s+${singular}\\b`, 'i')
    )
    if (!m) continue

    const name = m[1].trim().toLowerCase()
    if (seen.has(name)) continue
    if (/^(each|every|this|that|these|those|both|any|one|another|same|other)$/.test(name)) continue
    seen.add(name)

    const body = predicateOf(sentence, new RegExp(`^.*?${singular}\\b`, 'i'))
    if (!body) continue

    steps.push({ title: `${capitalise(name)} ${singular}`, body })
    if (steps.length >= 5) break
  }

  return steps.length >= 3 ? steps : null
}

function predicateOf(sentence: string, subjectPattern: RegExp): string {
  let rest = sentence.replace(subjectPattern, '').replace(/^[\s,:;-]+/, '')
  rest = rest.replace(/^(?:also\s+)?(?:called|known\s+as|referred\s+to\s+as|termed|named)\s+[^,]{2,60},\s*/i, '')
  rest = rest.replace(/^(?:roughly|approximately|spanning|covering|from|between)\s+[^,]{2,40},\s*/i, '')
  rest = rest.replace(/^(?:was|were|is|are)\s+(?:characteri[sz]ed|defined|marked|dominated|distinguished)\s+by\s+/i, '')
  rest = rest.replace(/^(?:saw|brought|produced)\s+/i, '')
  rest = rest.replace(/^(?:and|of|which)\s+/i, '')
  rest = rest.replace(/^(?:is|are|was|were)\s+/i, '')
  return shortenPredicate(rest, 14)
}

/** Card-body shortening: may cut at a conjunction, unlike a bullet. */
function shortenPredicate(text: string, maxWords: number): string {
  const clean = text.replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim()
  if (!clean) return ''

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  if (countWords(clean) <= maxWords) return cap(clean)

  for (const sep of [', ', '; ', ': ', ' and ', ' which ', ' that ', ' while ']) {
    const at = clean.indexOf(sep)
    if (at > 0) {
      const head = clean.slice(0, at).trim()
      if (countWords(head) >= 4 && countWords(head) <= maxWords) return cap(head)
    }
  }

  const words = clean.split(/\s+/).slice(0, maxWords)
  while (
    words.length > 4 &&
    /^(a|an|the|of|to|in|for|on|with|by|as|at|from|and|or|that|which|its|their|this|these)$/i.test(
      words[words.length - 1]
    )
  ) {
    words.pop()
  }
  return words.length >= 4 ? cap(words.join(' ')) : ''
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// --- Stat ---------------------------------------------------------------

/** A single striking quantity, which earns a callout rather than a bullet. */
function extractStat(sentences: string[]): { value: string; caption: string } | null {
  for (const sentence of sentences) {
    const m = sentence.match(/\b(\d{1,3}(?:[.,]\d+)?\s*(?:[-–]\s*\d{1,3}(?:[.,]\d+)?)?\s*(?:%|percent))/i)
    if (!m) continue
    const caption = shortenPredicate(sentence.replace(m[0], '').trim(), 18)
    if (caption) return { value: m[1].replace(/\s*percent/i, '%').replace(/\s+/g, ''), caption }
  }
  return null
}

// --- Comparison columns -------------------------------------------------

function extractColumns(
  sections: DocSectionNode[],
  spec: PresentationSpec
): { heading: string; bullets: string[] }[] | null {
  if (sections.length !== 2) return null

  const seen = new Set<string>()
  const columns = sections.map(section => ({
    heading: section.heading,
    bullets: summarizeToBullets(section.sentences, { spec, count: 4, wordBudget: 9, seen }),
  }))

  return columns.every(c => c.bullets.length >= 2) ? columns : null
}

// --- References ---------------------------------------------------------

export function shortenCitation(entry: string, maxChars = 78): string {
  const text = entry.replace(/\s+/g, ' ').trim()
  if (!text) return ''

  const m = text.match(/^(.+?)\s*\((\d{4}[a-z]?)\)\.?\s*(.+?)(?:\.\s|$)/)
  if (!m) return ''

  const [, authorsRaw, year, titleRaw] = m
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

  const cut = title.slice(0, room - 1).lastIndexOf(' ')
  if (cut < 16) return ''
  return `${head}${title.slice(0, cut)}…`
}

// --- Planning -----------------------------------------------------------

export interface PlanOptions {
  spec: PresentationSpec
  metadata: DeckMetadata
  maxSlides?: number
}

export interface PlanDiagnostics {
  droppedSections: string[]
  decisions: string[]
  /** Roles found in the source, for the gate's coverage check. */
  rolesPresent: SlideRole[]
}

export interface DeckPlanResult {
  plan: SlidePlan
  diagnostics: PlanDiagnostics
}

/** Content that will become a slide, before titles and notes are written. */
interface DraftSlide {
  role: SlideRole
  layout: PlannedSlide['layout']
  sections: DocSectionNode[]
  bullets?: string[]
  steps?: SlideStep[]
  columns?: { heading: string; bullets: string[] }[]
  table?: DocTable
  stat?: { value: string; caption: string }
  /** One sentence stating what the reader should conclude. */
  caption?: string
}

export function planDeck(tree: DocTree, options: PlanOptions): DeckPlanResult {
  const { spec, metadata } = options
  const decisions: string[] = []
  const maxTotal = Math.min(options.maxSlides ?? spec.deck.maxSlides, spec.deck.maxSlides)

  // Only body prose becomes a content slide. The abstract frames the deck; front
  // matter was already dropped by the tree builder.
  const bodySections = tree.sections.filter(
    s => s.part === 'body' && s.kind !== 'back' && (s.sentences.length > 0 || s.tables.length > 0)
  )
  const abstract = tree.sections.find(s => s.part === 'abstract')

  const groups = mergeThinGroups(groupSections(bodySections))
  const rolesPresent = [...new Set(groups.map(g => g.role))].filter(r => r !== 'other')

  const hasReferences = tree.references.length > 0
  const reserved = 2 + (hasReferences ? 1 : 0)
  const contentBudget = Math.max(1, maxTotal - reserved)

  const selected = selectGroups(groups, contentBudget, decisions)

  // --- Build the content of each slide, then title it from that content.
  const seen = new Set<string>()
  const drafts: DraftSlide[] = []

  for (const group of selected) {
    const draft = buildDraft(group, spec, seen, decisions)
    if (draft) drafts.push(draft)
  }

  dropUnderfilled(drafts, spec, decisions)

  const taken = new Set<string>()
  const deckTerms = buildDeckTermCounts(drafts.map(contentOf))

  const contentSlides: PlannedSlide[] = drafts.map(draft => {
    const content = contentOf(draft)
    const title = titleFromContent({
      role: draft.role,
      content,
      tableHeaders: draft.table?.headers,
      sourceHeading: draft.sections[0]?.heading,
      taken,
      deckTermCounts: deckTerms,
    })
    taken.add(title)

    const sentences = draft.sections.flatMap(s => s.sentences)
    const takeaway = deriveTakeaway(sentences, title)

    const slide: PlannedSlide = {
      layout: draft.layout,
      title,
      role: draft.role,
      bullets: draft.bullets,
      steps: draft.steps,
      columns: draft.columns,
      table: draft.table
        ? { headers: draft.table.headers, rows: draft.table.rows, caption: draft.caption }
        : undefined,
      stat: draft.stat,
      caption: draft.caption,
      notes: '',
      takeaway,
      sourceRefs: sourceRefsFor(draft.sections),
    }

    // Notes are written from the slide's OWN final text, never the source.
    slide.notes = buildNotesFromSlide(slide, spec)
    return slide
  })

  reportVariety(contentSlides, spec, decisions)

  const slides: PlannedSlide[] = [
    buildTitleSlide(metadata, abstract),
    ...contentSlides,
  ]

  if (hasReferences) {
    const refSlide = buildReferencesSlide(tree.references, spec)
    if (refSlide) slides.push(refSlide)
  }
  slides.push(buildClosingSlide(metadata, spec))

  const droppedSections = groups
    .filter(g => !selected.includes(g))
    .map(g => `${g.sections[0].id || g.sections[0].heading}`)

  if (droppedSections.length > 0) {
    decisions.push(`dropped ${droppedSections.length} section(s) to stay within ${maxTotal} slides`)
  }

  return { plan: { metadata, slides }, diagnostics: { droppedSections, decisions, rolesPresent } }
}

/** Every piece of text the slide will actually show. */
function contentOf(draft: DraftSlide): string[] {
  return [
    ...(draft.bullets ?? []),
    ...(draft.steps ?? []).flatMap(s => [s.title, s.body]),
    ...(draft.columns ?? []).flatMap(c => [c.heading, ...c.bullets]),
    ...(draft.table ? [...draft.table.headers, ...draft.table.rows.flat()] : []),
    ...(draft.stat ? [draft.stat.value, draft.stat.caption] : []),
  ].filter(Boolean)
}

/**
 * Chooses the layout from what the content IS.
 *
 * Order matters: the strongest evidence of shape wins. A source table is the
 * strongest, because the author already decided it was tabular.
 */
function buildDraft(
  group: SlideGroup,
  spec: PresentationSpec,
  seen: Set<string>,
  decisions: string[]
): DraftSlide | null {
  const sections = group.sections
  const sentences = sections.flatMap(s => s.sentences)
  const base = { role: group.role, sections }

  // 1. Entities compared on shared attributes.
  const table = sections.flatMap(s => s.tables).map(normalizeTable).find(Boolean)
  if (table) {
    return {
      ...base,
      layout: 'table',
      table,
      caption: tableCaption(table, sentences),
    }
  }

  // 2. A contrast the document itself draws.
  if (group.comparison) {
    const columns = extractColumns(sections, spec)
    if (columns) return { ...base, layout: 'comparison', columns }
  }

  // 3. A system of components, or an ordered procedure.
  const steps = extractSteps(sentences)
  if (steps.length >= 3) {
    const flow = FLOW_LANGUAGE.test(sentences.join(' '))
    const layout = flow ? 'diagram' : 'process'
    // A flow with no bodies renders as bare labels; the compact variant is for
    // exactly that case and is chosen for ALL steps, never a mixture.
    const bodies = steps.filter(s => s.body.trim()).length
    const compact = bodies < steps.length
    if (compact) for (const s of steps) s.body = ''

    decisions.push(`${layout} layout (${steps.length} ${compact ? 'compact ' : ''}items)`)
    return {
      ...base,
      layout,
      steps,
      caption: flow ? deriveTakeaway(sentences, 'the flow') : undefined,
    }
  }

  // 4. A single striking quantity.
  const stat = extractStat(sentences)
  if (stat) {
    const support = summarizeToBullets(sentences, { spec, count: 5, wordBudget: 10, seen })
    if (support.length >= 3) return { ...base, layout: 'stat', stat, bullets: support }
  }

  // 5. Parallel items that are not a sequence read better as cards.
  const bullets = summarizeToBullets(sentences, { spec, count: spec.deck.maxBulletsPerSlide, seen })
  if (bullets.length === 0) return null

  // Parallel items of similar weight sit better as a grid than as a stack: the
  // reader sees a set rather than a ranking. Long or uneven bullets stay a list,
  // because a card grid with one overflowing cell looks broken.
  const even =
    bullets.length >= 3 &&
    bullets.length <= 6 &&
    bullets.every(b => b.length <= 78) &&
    Math.max(...bullets.map(b => b.length)) - Math.min(...bullets.map(b => b.length)) <= 45

  if (even) return { ...base, layout: 'cards', bullets }

  return { ...base, layout: 'bullets', bullets }
}

/**
 * The one-sentence finding printed under a table or diagram.
 *
 * This is what stops a three-row table leaving the bottom half of the slide
 * empty, and it is the line the reference deck uses to tell the reader what to
 * conclude rather than leaving them to infer it.
 */
function tableCaption(table: DocTable, sentences: string[]): string | undefined {
  if (table.caption?.trim()) return table.caption.trim()

  // A sentence that mentions two of the table's own column headers is almost
  // always the author stating the comparison's outcome.
  const headers = table.headers.slice(1).map(h => h.toLowerCase())
  const best = sentences.find(s => {
    const lower = s.toLowerCase()
    return headers.filter(h => h && lower.includes(h.split(/\s+/)[0])).length >= 2
  })

  return best ? shortenPredicate(best, 26) : undefined
}

function selectGroups(groups: SlideGroup[], budget: number, decisions: string[]): SlideGroup[] {
  if (groups.length <= budget) return groups

  const chosen = new Set<SlideGroup>()

  // Every role present keeps its strongest section: role coverage before volume.
  const byRole = new Map<SlideRole, SlideGroup[]>()
  for (const g of groups) {
    const list = byRole.get(g.role)
    if (list) list.push(g)
    else byRole.set(g.role, [g])
  }

  for (const [role, list] of byRole) {
    if (role === 'other') continue
    if (chosen.size >= budget) break
    const best = [...list].sort((a, b) => groupWords(b) - groupWords(a))[0]
    if (best) chosen.add(best)
  }

  for (const g of [...groups].sort((a, b) => groupWords(b) - groupWords(a))) {
    if (chosen.size >= budget) break
    chosen.add(g)
  }

  decisions.push(`selected ${chosen.size} of ${groups.length} sections for ${budget} content slides`)
  return groups.filter(g => chosen.has(g))
}

/** Removes a draft that could not be filled; never ships a one-bullet slide. */
function dropUnderfilled(drafts: DraftSlide[], spec: PresentationSpec, decisions: string[]): void {
  for (let i = drafts.length - 1; i >= 0; i--) {
    const draft = drafts[i]
    if (draft.layout !== 'bullets' && draft.layout !== 'cards') continue
    if ((draft.bullets?.length ?? 0) >= 2) continue

    const host = drafts[i - 1] ?? drafts[i + 1]
    const canHost =
      host &&
      (host.layout === 'bullets' || host.layout === 'cards') &&
      (host.bullets?.length ?? 0) + (draft.bullets?.length ?? 0) <= spec.deck.maxBulletsPerSlide

    if (canHost) {
      host.bullets = [...(host.bullets ?? []), ...(draft.bullets ?? [])]
      host.sections = [...host.sections, ...draft.sections]
      decisions.push(`folded an under-filled slide into its neighbour`)
    } else {
      decisions.push(`dropped an under-filled slide (${draft.bullets?.length ?? 0} bullet(s))`)
    }
    drafts.splice(i, 1)
  }
}

/**
 * Reports the non-bullet ratio. There is deliberately no promotion pass:
 * relabelling bullets as steps asserts a structure the document never claimed.
 */
function reportVariety(slides: PlannedSlide[], spec: PresentationSpec, decisions: string[]): void {
  const nonBullet = slides.filter(s => s.layout !== 'bullets').length
  const ratio = slides.length > 0 ? nonBullet / slides.length : 0
  decisions.push(`non-bullet layouts: ${nonBullet}/${slides.length} (${(ratio * 100).toFixed(0)}%)`)
  void spec
}

function buildTitleSlide(metadata: DeckMetadata, abstract?: DocSectionNode): PlannedSlide {
  // The abstract frames the deck; its first claim becomes the subtitle.
  const framing = abstract?.sentences[0]
    ? shortenPredicate(abstract.sentences[0], 18)
    : ''

  return {
    layout: 'title',
    title: metadata.title,
    subtitle: framing || undefined,
    notes:
      `Introduce yourself and state the title. Name your supervisor. Say in one sentence why ` +
      `${metadata.title.split(/\s+/).slice(0, 5).join(' ').toLowerCase()} matters now, then move on. ` +
      `Keep this under thirty seconds and do not read the identity block aloud.`,
    sourceRefs: ['cover page'],
    takeaway: metadata.title,
  }
}

function buildClosingSlide(metadata: DeckMetadata, spec: PresentationSpec): PlannedSlide {
  void spec
  return {
    layout: 'closing',
    title: 'THANK YOU',
    notes:
      `Thank the panel and invite questions. Have your strongest number and your most serious ` +
      `limitation ready, because those attract the first questions. If asked something outside ` +
      `the scope of the seminar, say so plainly and offer what your sources do support.`,
    sourceRefs: ['closing'],
    takeaway: `${metadata.studentName} closes and takes questions`,
  }
}

function buildReferencesSlide(references: string[], spec: PresentationSpec): PlannedSlide | null {
  void spec
  const shortened = references.map(r => shortenCitation(r)).filter(Boolean).slice(0, 8)
  if (shortened.length === 0) return null

  return {
    layout: 'references',
    title: 'KEY SOURCES',
    citations: shortened,
    notes:
      `These are the sources the argument leans on most. Name the seminal paper and the most ` +
      `recent survey if asked where the field stands. Do not read the list aloud; it is here so ` +
      `the panel can see the work is grounded and you can point to a study when challenged.`,
    sourceRefs: ['references'],
    takeaway: `${shortened.length} sources underpin this seminar`,
  }
}

export { isClaim }
