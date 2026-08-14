/**
 * coverMetadata.ts
 * ------------------------------------------------------------------
 * Parses a report's cover page into labelled fields, and refuses to guess.
 *
 * Why this module exists
 * ----------------------
 * A generated title slide carried two different matric numbers - one on the
 * name line and a different one beneath it, the second stale from another
 * document - and a department field that had swallowed the degree statement
 * ("Computer Engineering In Partial Fulfilment Of The Requirements For...").
 *
 * Three rules follow from that:
 *   1. Every field records WHERE it came from, so a conflict can be reported
 *      with both source lines rather than silently resolved.
 *   2. A field stops at the next labelled field or at a sentence-cased clause;
 *      it never runs to the end of the block.
 *   3. Two different values for one field FAIL THE BUILD. Picking one is how
 *      the wrong matric number reached a slide in the first place.
 *
 * Nothing is cached at module scope: `parseCover` builds a fresh object from
 * its argument on every call, so a field cannot survive between jobs.
 */

export type CoverField =
  | 'title'
  | 'author'
  | 'matricNo'
  | 'department'
  | 'school'
  | 'institution'
  | 'supervisorName'
  | 'degree'
  | 'session'
  | 'date'

export interface FieldHit {
  value: string
  /** The cover line the value was read from, verbatim. */
  sourceLine: string
  lineIndex: number
}

export interface CoverConflict {
  field: CoverField
  hits: FieldHit[]
}

export interface CoverMetadata {
  title: string | null
  author: string | null
  matricNo: string | null
  department: string | null
  school: string | null
  institution: string | null
  supervisorName: string | null
  degree: string | null
  session: string | null
  date: string | null
  /** Fields the extractor could not find. The caller must ask, never guess. */
  missing: CoverField[]
  /** Fields with more than one distinct value. A non-empty list fails the build. */
  conflicts: CoverConflict[]
}

export class CoverConflictError extends Error {
  conflicts: CoverConflict[]

  constructor(conflicts: CoverConflict[]) {
    const detail = conflicts
      .map(
        c =>
          `  ${c.field}:\n` +
          c.hits.map(h => `    "${h.value}"  (line ${h.lineIndex + 1}: "${h.sourceLine}")`).join('\n')
      )
      .join('\n')
    super(`The cover page gives conflicting values and cannot be resolved automatically:\n${detail}`)
    this.name = 'CoverConflictError'
    this.conflicts = conflicts
  }
}

// --- Line shapes --------------------------------------------------------

/** A matric / registration number: slash- or dash-separated with digits. */
const ID_TOKEN = /\b([A-Z0-9]{1,8}(?:[\/-][A-Z0-9]{1,10}){2,})\b/i

/** Anything that opens a new labelled field, used as a stop condition. */
const LABEL_LINE =
  /^\s*(matric(?:ulation)?\s*(?:no|number)?|supervis(?:ed\s+by|or)|presented\s+by|submitted\s+by|by|department|faculty|school|session|date|name|reg(?:istration)?\s*(?:no|number)?)\b\s*:?\s*$/i

/**
 * A degree / submission statement. These are sentence-cased clauses that
 * routinely get swallowed into whichever field precedes them.
 */
const DEGREE_CLAUSE =
  /\b(in\s+partial\s+fulfil?ment|in\s+fulfil?ment|submitted\s+in|for\s+the\s+award\s+of|requirements?\s+for)\b/i

const DEGREE_NAME =
  /\b(higher\s+national\s+diploma|national\s+diploma|bachelor\s+of\s+\w+|master\s+of\s+\w+|b\.?\s?sc\.?|m\.?\s?sc\.?|b\.?\s?eng\.?|m\.?\s?eng\.?|hnd|ond|pgd)\b/i

const INSTITUTION_SHAPE =
  /\b(college\s+of\s+technology|polytechnic|university|institute\s+of\s+technology|school\s+of\s+technology)\b/i

const COVER_BOILERPLATE =
  /^(a\s+)?(seminar|project|thesis|dissertation)?\s*(report|presentation|paper|work)?\s*(submitted|presented|written)\b|^being\s+a\b|^this\s+(report|seminar)\b|^(seminar|project)\s*$|^on\s*$|^by:?\s*$/i

/** Normalised for comparison: case, punctuation and spacing ignored. */
function sameValue(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  return norm(a) === norm(b)
}

/** Trims a captured value at a degree clause or a trailing label. */
function boundValue(value: string): string {
  let out = value.trim()

  const degreeAt = out.search(DEGREE_CLAUSE)
  if (degreeAt > 0) out = out.slice(0, degreeAt)

  return out
    .replace(/^[\s:,\-–—]+/, '')
    .replace(/[\s:,\-–—.]+$/, '')
    .trim()
}

// --- Extraction ---------------------------------------------------------

interface Collector {
  add(field: CoverField, value: string, lineIndex: number, sourceLine: string): void
}

function makeCollector(hits: Map<CoverField, FieldHit[]>): Collector {
  return {
    add(field, value, lineIndex, sourceLine) {
      const clean = boundValue(value)
      if (!clean || clean.length < 2) return

      const list = hits.get(field) ?? []
      // Same value seen twice is not a conflict; record it once.
      if (!list.some(h => sameValue(h.value, clean))) {
        list.push({ value: clean, sourceLine, lineIndex })
      }
      hits.set(field, list)
    },
  }
}

/**
 * Reads the identity block off the cover page.
 *
 * Returns nulls for what it cannot find and lists conflicts rather than
 * resolving them. There is deliberately no filename fallback.
 */
export function parseCover(rawLines: string[]): CoverMetadata {
  const lines = rawLines
    .flatMap(l => l.split(/\n+/))
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const hits = new Map<CoverField, FieldHit[]>()
  const collect = makeCollector(hits)

  /** The next line that could be a value: not blank, not a label, not boilerplate. */
  const valueAfter = (i: number): { value: string; index: number } | null => {
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      const next = lines[j]
      if (!next) continue
      if (LABEL_LINE.test(next)) return null
      if (COVER_BOILERPLATE.test(next)) continue
      if (DEGREE_CLAUSE.test(next)) continue
      return { value: next, index: j }
    }
    return null
  }

  lines.forEach((line, i) => {
    // --- Matric / registration number.
    const labelledId = line.match(/\bmatric(?:ulation)?\s*(?:no\.?|number)?\b\s*[:.\-]?\s*(.+)$/i)
    if (labelledId) {
      const token = labelledId[1].match(ID_TOKEN)
      collect.add('matricNo', token ? token[1] : labelledId[1], i, line)
    } else {
      // Bare ID on its own line, or trailing a name.
      const bare = line.match(ID_TOKEN)
      if (bare && !INSTITUTION_SHAPE.test(line) && !/\d{4}\s*\/\s*\d{4}/.test(line)) {
        collect.add('matricNo', bare[1], i, line)
      }
    }

    // --- Supervisor.
    const supervisorInline = line.match(/\bsupervis(?:ed\s+by|or)\b\s*[:.\-]?\s*(.+)$/i)
    if (supervisorInline && supervisorInline[1].trim().length > 2) {
      collect.add('supervisorName', supervisorInline[1], i, line)
    } else if (/\bsupervis(?:ed\s+by|or)\b/i.test(line)) {
      const next = valueAfter(i)
      if (next) collect.add('supervisorName', next.value, next.index, lines[next.index])
    }

    // --- Author.
    const authorInline = line.match(/\b(?:presented|submitted)\s+by\b\s*[:.\-]?\s*(.+)$/i)
    if (authorInline && authorInline[1].trim().length > 2) {
      collect.add('author', stripIdFrom(authorInline[1]), i, line)
    } else if (/^\s*(?:presented\s+by|submitted\s+by|by)\s*:?\s*$/i.test(line)) {
      const next = valueAfter(i)
      if (next) collect.add('author', stripIdFrom(next.value), next.index, lines[next.index])
    }

    // --- Department, faculty/school.
    const dept = line.match(/\bdepartment\s+of\s+(.+)$/i)
    if (dept) collect.add('department', dept[1], i, line)

    const school = line.match(/\b((?:school|faculty)\s+of\s+.+)$/i)
    if (school) collect.add('school', school[1], i, line)

    // --- Institution.
    if (INSTITUTION_SHAPE.test(line) && line.length < 90 && !/\bdepartment\b/i.test(line)) {
      collect.add('institution', line.replace(/[.,]\s*$/, ''), i, line)
    }

    // --- Degree.
    const degree = line.match(DEGREE_NAME)
    if (degree) collect.add('degree', degree[0], i, line)

    // --- Session and date.
    const session = line.match(/\b(20\d{2}\s*\/\s*20\d{2})\b/)
    if (session) collect.add('session', session[1].replace(/\s+/g, ''), i, line)

    const date = line.match(
      /\b((?:january|february|march|april|may|june|july|august|september|october|november|december)[,\s]+20\d{2})\b/i
    )
    if (date) collect.add('date', date[1], i, line)
  })

  const title = extractTitle(lines, hits)
  if (title) collect.add('title', title.value, title.index, lines[title.index] ?? title.value)

  // --- Resolve.
  const conflicts: CoverConflict[] = []
  const value = (field: CoverField): string | null => {
    const list = hits.get(field) ?? []
    if (list.length === 0) return null
    if (list.length > 1) {
      conflicts.push({ field, hits: list })
      return null
    }
    return list[0].value
  }

  const resolved = {
    title: value('title'),
    author: value('author'),
    matricNo: value('matricNo'),
    department: value('department'),
    school: value('school'),
    institution: value('institution'),
    supervisorName: value('supervisorName'),
    degree: value('degree'),
    session: value('session'),
    date: value('date'),
  }

  const missing = (Object.keys(resolved) as CoverField[]).filter(
    k => !resolved[k as keyof typeof resolved]
  )

  return { ...resolved, missing, conflicts }
}

/**
 * Splits a trailing ID off a name line.
 *
 * "EKPAWHA PRINCEWILL DAVID F/HD/24/3410037" is a name AND an ID sharing a
 * line. Rendering the line as the author printed the number twice on the title
 * slide - once inside the name, once as the matric field.
 */
export function stripIdFrom(text: string): string {
  return text.replace(ID_TOKEN, '').replace(/\s{2,}/g, ' ').replace(/[\s,;:-]+$/, '').trim()
}

/**
 * The report's real title: the longest run of consecutive cover lines that is
 * not boilerplate, not a labelled field, and not a value already identified.
 */
function extractTitle(
  lines: string[],
  hits: Map<CoverField, FieldHit[]>
): { value: string; index: number } | null {
  const explicit = lines.findIndex(l => /^\s*(topic|title)\s*[:.\-]/i.test(l))
  if (explicit !== -1) {
    const inline = lines[explicit].replace(/^\s*(topic|title)\s*[:.\-]\s*/i, '').trim()
    if (inline.length > 10) return { value: inline, index: explicit }
  }

  const known = new Set<string>()
  for (const list of hits.values()) {
    for (const hit of list) known.add(hit.value.toLowerCase())
  }

  const isCandidate = (line: string): boolean => {
    const l = line.toLowerCase()
    if (line.length < 8 || line.length > 200) return false
    if (COVER_BOILERPLATE.test(line)) return false
    if (LABEL_LINE.test(line)) return false
    if (DEGREE_CLAUSE.test(line) || DEGREE_NAME.test(line)) return false
    if (INSTITUTION_SHAPE.test(line)) return false
    if (/\b(matric|supervis|department|faculty|school of|session)\b/i.test(line)) return false
    if (ID_TOKEN.test(line)) return false
    if (/^\d/.test(line)) return false
    if ([...known].some(v => v && (l.includes(v) || v.includes(l)))) return false
    return true
  }

  // The title usually wraps over two or three lines; the longest RUN wins.
  let best: { value: string; index: number } | null = null
  let run: string[] = []
  let runStart = 0

  const closeRun = () => {
    if (run.length === 0) return
    const joined = run.join(' ').replace(/\s+/g, ' ').trim()
    if (joined.length >= 12 && (!best || joined.length > best.value.length)) {
      best = { value: joined, index: runStart }
    }
    run = []
  }

  lines.forEach((line, i) => {
    if (isCandidate(line)) {
      if (run.length === 0) runStart = i
      run.push(line)
    } else {
      closeRun()
    }
  })
  closeRun()

  return best
}
