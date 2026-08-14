/**
 * speakerNotes.ts
 * ------------------------------------------------------------------
 * Writes speaker notes from the slide's OWN FINAL TEXT.
 *
 * Why this module exists
 * ----------------------
 * Notes were slot-filled from raw source paragraphs, before summarisation. Two
 * failures followed, both visible in shipped decks:
 *
 *   "Open on this point: 12 3.1.3 Traffic Engineering in SDN"
 *       - a table-of-contents line, read out as the opening sentence.
 *   "Stress the figure 50ms"
 *       - a number that appears nowhere on the slide, so the presenter is told
 *         to emphasise something the audience cannot see.
 *
 * Generating from the rendered bullets makes the second failure impossible by
 * construction, and the QA gate re-checks it: any number or proper noun in the
 * notes must appear in that slide's own text.
 *
 * The phrase templates are gone. "Open on this point:" and "Expect a question
 * on how this connects to your overall argument" appeared verbatim on nearly
 * every slide, which is worse than no notes - it teaches the presenter to
 * ignore them.
 */

import type { PlannedSlide } from './slidePlan'
import type { PresentationSpec } from './presentationSpec'
import { wordCount } from './textNormalize'

/** Every string the slide will actually display. */
export function slideText(slide: PlannedSlide): string[] {
  return [
    slide.title,
    slide.subtitle ?? '',
    ...(slide.bullets ?? []),
    ...(slide.citations ?? []),
    ...(slide.steps ?? []).flatMap(s => [s.title, s.body]),
    ...(slide.columns ?? []).flatMap(c => [c.heading, ...c.bullets]),
    ...(slide.table ? [...slide.table.headers, ...slide.table.rows.flat()] : []),
    ...(slide.stat ? [slide.stat.value, slide.stat.caption] : []),
    slide.table?.caption ?? '',
    slide.caption ?? '',
  ].filter(Boolean)
}

/** Numbers and proper nouns, the things a presenter is told to stress. */
export function salientTokens(text: string): string[] {
  const numbers = text.match(/\b\d+(?:[.,–-]\d+)*\s*(?:%|percent|kHz|MHz|GHz|ms|Gbps|Mbps|cm|m\b)?/g) ?? []
  const proper =
    text.match(/\b(?:[A-Z][a-zA-Z]*(?:[A-Z][a-zA-Z]*)+|[A-Z]{2,})\b/g) ?? []
  return [...numbers, ...proper].map(t => t.trim()).filter(Boolean)
}

const COMMON_ACRONYMS = new Set([
  'A', 'I', 'THE', 'AND', 'OR', 'OF', 'IN', 'TO', 'IT', 'IS', 'AS', 'AT', 'BY', 'ON',
])

/**
 * Picks the one fact worth stressing: a figure if the slide has one, else a
 * named standard or product. Returns null when the slide has neither, in which
 * case the notes do not pretend otherwise.
 */
function emphasis(slide: PlannedSlide): string | null {
  const text = slideText(slide).join(' ')

  const figure = text.match(/\b\d{1,4}(?:[.,]\d+)?(?:\s*[-–]\s*\d{1,4}(?:[.,]\d+)?)?\s*(?:%|percent|kHz|MHz|GHz|ms|Gbps|Mbps)\b/i)
  if (figure) return figure[0].trim()

  if (slide.stat?.value) return slide.stat.value

  const named = text.match(/\b(?:[A-Z][a-z]+[A-Z][A-Za-z]*|[A-Z]{3,})\b/g) ?? []
  const useful = named.filter(n => !COMMON_ACRONYMS.has(n.toUpperCase()) && n.length >= 3)
  return useful[0] ?? null
}

/** The question this slide's content tends to attract, phrased from its own subject. */
function likelyQuestion(slide: PlannedSlide): string {
  const subject = slide.title.toLowerCase()

  if (/barrier|limit|challenge|constraint|risk/.test(subject)) {
    return `Be ready to say which of these barriers you would tackle first, and how.`
  }
  if (/why|problem|congest|fall short/.test(subject)) {
    return `Be ready to explain why existing approaches have not already solved this.`
  }
  if (/how|architect|separat|work|component|plane|layer/.test(subject)) {
    return `Be ready to walk through this again in your own words, without the slide.`
  }
  if (/vs|compar|versus/.test(subject)) {
    return `Be ready to justify the criteria on which the comparison is drawn.`
  }
  if (/evidence|stud|research|literature/.test(subject)) {
    return `Be ready to name which study you find most convincing, and why.`
  }
  if (/deliver|finding|result|show/.test(subject)) {
    return `Be ready to say what evidence supports this and how strong it is.`
  }
  if (/head|future|outlook|conclusion/.test(subject)) {
    return `Be ready to say which of these directions you would pursue.`
  }
  return `Be ready to connect this back to the aim of the seminar.`
}

/**
 * 40-70 words of guidance, built from the slide's own points.
 *
 * The opening restates the slide's strongest point in the presenter's voice;
 * the middle names the fact to stress; the close is the likely question. None
 * of it is copied from the source document.
 */
export function buildNotesFromSlide(slide: PlannedSlide, spec: PresentationSpec): string {
  const min = spec.deck.notesMinWords
  const max = spec.deck.notesMaxWords

  // Drawn ONLY from what the slide displays. A table slide has no bullets, so
  // its points come from its own rows; nothing is pulled from the source
  // document, which is how "Stress the figure 50ms" reached a slide that had no
  // such figure on it.
  const points = [
    ...(slide.bullets ?? []),
    ...(slide.steps ?? []).map(s => (s.body ? `${s.title}: ${s.body}` : s.title)),
    ...(slide.columns ?? []).flatMap(c => c.bullets.slice(0, 2)),
    ...(slide.stat ? [`${slide.stat.value} — ${slide.stat.caption}`] : []),
    slide.caption ?? '',
    slide.table?.caption ?? '',
    ...(slide.table ? tableTalkingPoints(slide.table) : []),
    ...(slide.citations ?? []).slice(0, 3),
  ].filter(Boolean)

  const parts: string[] = []
  const said = new Set<string>()

  const push = (text: string) => {
    const clean = text.replace(/\s+/g, ' ').trim()
    if (!clean) return
    const key = clean.toLowerCase().slice(0, 32)
    if (said.has(key)) return
    said.add(key)
    parts.push(clean.replace(/[.\s]*$/, '.'))
  }

  if (points[0]) push(`Lead with ${lowerFirst(points[0])}`)

  const stress = emphasis(slide)
  if (stress) push(`Stress ${stress}; it is the detail the panel will hold on to`)

  for (const point of points.slice(1)) {
    if (wordCount(parts.join(' ')) >= min - 12) break
    push(`Then ${lowerFirst(point)}`)
  }

  push(likelyQuestion(slide))

  let notes = parts.join(' ')

  // Trim from the middle so the opening and the question survive.
  while (wordCount(notes) > max && parts.length > 2) {
    parts.splice(parts.length - 2, 1)
    notes = parts.join(' ')
  }

  // If still short, pad from the slide's own remaining text - never from the
  // takeaway, which is derived from the SOURCE and would reintroduce facts the
  // audience cannot see.
  if (wordCount(notes) < min) {
    for (const extra of slideText(slide).slice(1)) {
      if (wordCount(parts.join(' ')) >= min) break
      parts.splice(parts.length - 1, 0, `Mention ${lowerFirst(extra)}.`)
    }
    notes = parts.join(' ')
  }

  return notes.replace(/\s+/g, ' ').trim()
}

/** A table's most quotable rows, phrased as things to say. */
function tableTalkingPoints(table: NonNullable<PlannedSlide['table']>): string[] {
  return table.rows.slice(0, 3).map(row => {
    const [label, ...rest] = row
    return rest.length > 0 ? `${label}: ${rest.join(' versus ')}` : label
  })
}

function lowerFirst(text: string): string {
  // Leave an acronym or proper noun alone.
  if (/^[A-Z]{2,}/.test(text) || /^[A-Z][a-z]+\s[A-Z]/.test(text)) return text
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text
}
