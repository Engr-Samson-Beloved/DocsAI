/**
 * documentAudit.ts
 * ------------------------------------------------------------------
 * Deterministic "what's done / what's missing" analysis for a document,
 * plus an accurate Table-of-Contents builder.
 *
 * Powers the import assistant: after a user imports (or opens) a document,
 * analyzeDocument() reports whether it has a cover page, a TOC, how many
 * pages/words it has, its chapters, and which are too short — then produces
 * actionable suggestions (generate cover, generate TOC, expand chapters).
 *
 * buildTocPageHtml() creates a TOC page whose page numbers come from the
 * real print paginator (mapHeadingsToContentPages), so they match the
 * exported PDF, and emits structured `tocItem` rows (data-type="toc-item")
 * that round-trip into the editor's TocItemNode.
 */

import { mapHeadingsToContentPages, type HeadingLocation } from './printPagination'

/** Minimum pages expected of a complete academic document. */
export const MIN_ACADEMIC_PAGES = 20
/** A chapter (h1/h2) shorter than this (approx words) is flagged as thin. */
export const THIN_CHAPTER_WORDS = 500

export interface ChapterInfo {
  title: string
  level: number
  approxWords: number
}

export type AuditSuggestionId = 'generate_cover' | 'generate_toc' | 'expand' | 'add_references' | 'format_chapters' | 'fix_chapter_format' | 'add_abstract' | 'add_keywords' | 'fix_table_font'

export interface AuditSuggestion {
  id: AuditSuggestionId
  label: string
  reason: string
}

export interface DocumentAudit {
  hasCover: boolean
  hasToc: boolean
  hasReferences: boolean
  pageCount: number
  wordCount: number
  chapters: ChapterInfo[]
  underLengthChapters: ChapterInfo[]
  needsExpand: boolean
  suggestions: AuditSuggestion[]
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Remove cover + TOC front matter so analysis only sees body content. */
function bodyContentHtml(editorHtml: string): string {
  if (typeof document === 'undefined') return editorHtml
  try {
    const doc = new DOMParser().parseFromString(editorHtml || '', 'text/html')
    doc.querySelectorAll('div[data-cover="true"], div[data-toc="true"]').forEach((n) => n.remove())
    return doc.body.innerHTML
  } catch {
    return editorHtml
  }
}

/** Parse chapters (headings) with a crude per-section word estimate. */
function extractChapters(contentHtml: string): ChapterInfo[] {
  const chapters: ChapterInfo[] = []
  const re = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi
  const found: { level: number; title: string; index: number; endOfTag: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(contentHtml)) !== null) {
    const title = stripTags(m[2])
    if (title) found.push({ level: parseInt(m[1], 10), title, index: m.index, endOfTag: re.lastIndex })
  }
  for (let i = 0; i < found.length; i++) {
    const start = found[i].endOfTag
    const end = i + 1 < found.length ? found[i + 1].index : contentHtml.length
    const sectionText = stripTags(contentHtml.slice(start, end))
    const approxWords = sectionText ? sectionText.split(/\s+/).filter(Boolean).length : 0
    chapters.push({ title: found[i].title, level: found[i].level, approxWords })
  }
  return chapters
}

/** Check if chapter headings follow the two-line ALL-CAPS format (CHAPTER ONE / INTRODUCTION). */
function hasProperChapterFormat(contentHtml: string): boolean {
  // Look for the two-line pattern: <h1>CHAPTER ONE</h1> immediately followed by <h1>INTRODUCTION</h1>
  return /<h1[^>]*>\s*CHAPTER\s+(ONE|TWO|THREE|FOUR|FIVE)\s*<\/h1>\s*<h1[^>]*>/i.test(contentHtml)
}

/** Check if an Abstract section exists. */
function hasAbstract(contentHtml: string): boolean {
  return /<h[1-3][^>]*>\s*ABSTRACT\s*<\/h[1-3]>/i.test(contentHtml) ||
    /<p[^>]*>\s*ABSTRACT\s*<\/p>/i.test(contentHtml)
}

/** Check if a Keywords line exists (typically at end of Abstract). */
function hasKeywords(contentHtml: string): boolean {
  return /\bKeywords?\s*:/i.test(contentHtml)
}

/** Check if tables exist in the document. */
function countTables(contentHtml: string): number {
  return (contentHtml.match(/<table[\s>]/gi) || []).length
}

/**
 * Inspect a document and report what's present, what's missing, and what to do.
 */
export function analyzeDocument(
  editorHtml: string,
  opts: { totalPages: number; wordCount: number }
): DocumentAudit {
  const html = editorHtml || ''
  const hasCover = /data-cover=["']true["']/i.test(html)
  const hasToc = /data-toc=["']true["']/i.test(html)

  const content = bodyContentHtml(html)
  const chapters = extractChapters(content)
  const hasReferences = /\b(references|bibliography|works\s+cited)\b/i.test(content)

  const pageCount = Math.max(0, opts.totalPages || 0)
  const wordCount = Math.max(0, opts.wordCount || 0)

  // "Chapter-level" headings (h1/h2) that are too thin.
  const underLengthChapters = chapters.filter((c) => c.level <= 2 && c.approxWords < THIN_CHAPTER_WORDS)
  const needsExpand = pageCount > 0 && pageCount < MIN_ACADEMIC_PAGES

  const suggestions: AuditSuggestion[] = []
  if (chapters.length === 0 && wordCount > 30) {
    suggestions.push({
      id: 'format_chapters',
      label: 'Format document into Seminar Chapters',
      reason: 'No structured chapter headings were found in this document.',
    })
  }
  if (!hasCover) {
    suggestions.push({
      id: 'generate_cover',
      label: 'Generate a front cover page',
      reason: 'This document has no cover/title page.',
    })
  }
  if (needsExpand) {
    suggestions.push({
      id: 'expand',
      label: `Expand the chapters (currently ${pageCount} of ${MIN_ACADEMIC_PAGES}+ pages)`,
      reason:
        underLengthChapters.length > 0
          ? `${underLengthChapters.length} chapter(s) look short and the document is under ${MIN_ACADEMIC_PAGES} pages.`
          : `The document is only ${pageCount} page(s); academic reports are usually ${MIN_ACADEMIC_PAGES}+.`,
    })
  }
  if (!hasReferences) {
    suggestions.push({
      id: 'add_references',
      label: 'Add a References section',
      reason: 'No References/Bibliography section was found.',
    })
  }
  // TOC last: it should be generated once the content is settled so its page
  // numbers are accurate.
  if (!hasToc && chapters.length > 0) {
    suggestions.push({
      id: 'generate_toc',
      label: 'Generate a Table of Contents',
      reason: 'No Table of Contents found — I can build one with accurate page numbers.',
    })
  }

  // P1 audit: check two-line chapter heading format
  if (chapters.length > 0 && !hasProperChapterFormat(content)) {
    suggestions.push({
      id: 'fix_chapter_format',
      label: 'Fix chapter headings to standard format',
      reason: 'Chapter headings should use the two-line ALL-CAPS format (e.g. CHAPTER ONE / INTRODUCTION).',
    })
  }

  // P2 audit: check for Abstract
  if (chapters.length > 0 && !hasAbstract(content) && !hasAbstract(editorHtml)) {
    suggestions.push({
      id: 'add_abstract',
      label: 'Add an Abstract page',
      reason: 'No Abstract section was found. Academic reports need a concise 2–3 paragraph abstract with keywords.',
    })
  }

  // P3 audit: check for Keywords line
  if (hasAbstract(content) && !hasKeywords(content)) {
    suggestions.push({
      id: 'add_keywords',
      label: 'Add Keywords to Abstract',
      reason: 'The Abstract is missing a Keywords line (e.g. "Keywords: Term1, Term2, ...").',
    })
  }

  // P4 audit: check table count (informational)
  const tableCount = countTables(content)
  if (tableCount === 0 && wordCount > 2000) {
    suggestions.push({
      id: 'fix_table_font',
      label: 'Consider adding comparison tables',
      reason: 'Academic seminar reports typically include 1–2 comparison/summary tables for visual data presentation.',
    })
  }

  return {
    hasCover,
    hasToc,
    hasReferences,
    pageCount,
    wordCount,
    chapters,
    underLengthChapters,
    needsExpand,
    suggestions,
  }
}

/** A short human summary of the audit for a chat message. */
export function summarizeAudit(audit: DocumentAudit): string {
  const bits: string[] = []
  bits.push(`I looked over your document: **${audit.pageCount} page(s)**, **${audit.wordCount} words**, **${audit.chapters.filter((c) => c.level <= 2).length} chapter(s)**.`)
  const checks: string[] = []
  checks.push(`${audit.hasCover ? '✅' : '❌'} Cover page`)
  checks.push(`${audit.hasToc ? '✅' : '❌'} Table of Contents`)
  checks.push(`${audit.hasReferences ? '✅' : '❌'} References`)
  checks.push(`${!audit.needsExpand ? '✅' : '❌'} Length (${audit.pageCount}/${MIN_ACADEMIC_PAGES}+ pages)`)
  bits.push(checks.join('  •  '))
  return bits.join('\n\n')
}

/**
 * Build a `data-toc="true"` page with ACCURATE page numbers derived from the
 * real print paginator. Rows are structured `tocItem` nodes (data-type=
 * "toc-item") so they round-trip into the editor's TocItemNode.
 *
 * Pass the CURRENT document HTML (without relying on an existing TOC — headings
 * inside cover/TOC pages are excluded by the paginator).
 */
export function buildTocPageHtml(fullHtml: string, opts: { lineHeight?: string } = {}): string {
  const headings: HeadingLocation[] = mapHeadingsToContentPages(fullHtml, { lineHeight: opts.lineHeight })

  const rows = headings
    // Skip a heading that is literally the TOC title, just in case.
    .filter((h) => !/^table\s+of\s+contents$/i.test(h.title))
    .map(
      (h) =>
        `<p data-type="toc-item" data-level="${h.level}" data-page="${h.page}">${escapeHtml(h.title)}</p>`
    )
    .join('')

  const body =
    rows ||
    `<p data-type="toc-item" data-level="1" data-page="1">No headings found — add chapter headings first.</p>`

  return (
    `<div data-type="page" data-toc="true">` +
    `<h1 style="text-align:center; text-transform:uppercase; font-family:'Times New Roman', Times, serif;">Table of Contents</h1>` +
    body +
    `</div>`
  )
}

/**
 * Validate that a document matches the expected seminar structure.
 * Returns a checklist string showing what's found vs missing.
 */
export function validateSeminarStructure(editorHtml: string): {
  report: string
  missingCount: number
  overlongChapters: { title: string; words: number; target: number }[]
} {
  const content = bodyContentHtml(editorHtml)
  const chapters = extractChapters(content)
  const headingTitles = chapters.map(c => c.title.toLowerCase())

  // Expected seminar sections and their target word counts
  const expectedSections = [
    { label: 'Abstract', keywords: ['abstract'], target: 250 },
    { label: 'Chapter 1 (Introduction)', keywords: ['chapter one', 'introduction', 'chapter 1'], target: 1500 },
    { label: 'Chapter 2 (Literature Review)', keywords: ['chapter two', 'literature review', 'related work', 'chapter 2'], target: 1500 },
    { label: 'Chapter 3 (Methodology)', keywords: ['chapter three', 'methodology', 'working principle', 'chapter 3'], target: 2000 },
    { label: 'Chapter 4 (Findings/Conclusion)', keywords: ['chapter four', 'findings', 'conclusion', 'chapter 4'], target: 1200 },
    { label: 'References', keywords: ['references', 'bibliography'], target: 0 },
  ]

  const lines: string[] = ['**📋 Structure Validation:**', '']
  let missingCount = 0
  const overlongChapters: { title: string; words: number; target: number }[] = []

  for (const section of expectedSections) {
    const found = headingTitles.some(t => section.keywords.some(k => t.includes(k)))
    if (found) {
      // Find the matching chapter for word count check
      const matchedChapter = chapters.find(c =>
        section.keywords.some(k => c.title.toLowerCase().includes(k))
      )
      const words = matchedChapter?.approxWords || 0

      if (section.target > 0 && words > section.target * 2) {
        lines.push(`⚠️ ${section.label} — found but **too long** (~${words} words, target ~${section.target})`)
        overlongChapters.push({ title: matchedChapter!.title, words, target: section.target })
      } else {
        lines.push(`✅ ${section.label}`)
      }
    } else {
      lines.push(`❌ ${section.label} — **not found**`)
      missingCount++
    }
  }

  // Check for cover page and TOC
  const hasCover = /<div[^>]*data-cover\s*=\s*["']true["']/i.test(editorHtml)
  const hasToc = /<div[^>]*data-toc\s*=\s*["']true["']/i.test(editorHtml)
  lines.push('')
  lines.push(`${hasCover ? '✅' : '❌'} Cover Page`)
  lines.push(`${hasToc ? '✅' : '❌'} Table of Contents`)

  if (missingCount === 0 && overlongChapters.length === 0) {
    lines.push('')
    lines.push('🎉 **All sections present and within target lengths!**')
  }

  return {
    report: lines.join('\n'),
    missingCount,
    overlongChapters,
  }
}
