/**
 * pptxExporter.ts
 * ------------------------------------------------------------------
 * Professional Academic PowerPoint Presentation Exporter (.pptx)
 *
 * Design Reference: "FROM SLIDES TO SUCCESS" (HND Seminar Guidelines)
 *
 * Architecture:
 *  Phase 1: Parse HTML → AcademicSection[] (chapter-aware grouping)
 *  Phase 2: AcademicSection[] → SlideData[] (12–15 slides, auto-split)
 *  Phase 3: SlideData[] → pptxgenjs render → .pptx download
 *
 * Rules Enforced:
 *  - 12–15 Slide Deck (Title + 10–13 Content + Q&A)
 *  - Two-line & single-line chapter headings unified into slide headers
 *  - Strict bullet deduplication & prompt noise filtering
 *  - Bullet symbol cleaning (strips unicode artifacts like , •, ▸)
 *  - Max 5 bullets per slide chunking to prevent visual overflow
 *  - Widescreen 16:9 aspect ratio
 *  - Font Sizes: Title 34pt, Headers 24pt, Subheaders 16pt, Body 18pt (min 16pt)
 *  - 60-30-10 Color System: Slate bg, Navy headers, Indigo accents
 */

export interface PptxMetadata {
  title?: string
  studentName?: string
  matricNo?: string
  department?: string
  supervisorName?: string
  academicLevel?: string
  institution?: string
  docHeader?: string
  docFooter?: string
}

// ─── Phase 1: Intelligent Academic Section Extraction ────────────

interface AcademicSection {
  /** Chapter number word (ONE, TWO, etc.) or null for non-chapter sections */
  chapterNum: string | null
  /** Chapter topic title (INTRODUCTION, LITERATURE REVIEW, etc.) */
  title: string
  /** Sub-section headings and their bullet content */
  subsections: { heading: string; bullets: string[] }[]
  /** Tables found in this section */
  tables: string[][][]
  /** Raw paragraph content (before bulletization) */
  rawParagraphs: string[]
}

const NUM_TO_WORD: Record<string, string> = {
  '1': 'ONE', '2': 'TWO', '3': 'THREE', '4': 'FOUR', '5': 'FIVE',
  '6': 'SIX', '7': 'SEVEN', '8': 'EIGHT', '9': 'NINE', '10': 'TEN',
}

function cleanText(txt: string): string {
  return txt
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\uFFFD\uFFFC]/g, '') // remove replacement chars
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanBulletText(str: string): string {
  return str
    .replace(/^[\s\u2022\u2023\u25B6\u25B8\u2013\u2014\u2212\uFFFD*•\-▸\s]+/, '')
    .replace(/[\uFFFD\uFFFC]/g, '')
    .trim()
}

function isNoiseText(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    lower.includes('format the entire document') ||
    lower.includes('standard academic guidelines') ||
    lower.includes('reorganize the document structure') ||
    lower.includes('apply a specific formatting style') ||
    lower.includes('improve the overall readability') ||
    lower.includes('start writing your document') ||
    lower.includes('click here to edit') ||
    lower.includes('bypassing ai detection')
  )
}

function isCoverPage(el: Element): boolean {
  return (
    el.getAttribute('data-cover') === 'true' ||
    el.closest('[data-cover="true"]') !== null
  )
}

function isTocPage(el: Element): boolean {
  return (
    el.getAttribute('data-toc') === 'true' ||
    el.closest('[data-toc="true"]') !== null
  )
}

const TOPIC_PATTERN = /^(abstract|introduction|literature\s+review|related\s+work|methodology|working\s+principle|findings|conclusion|recommendations|future\s+scope|references|bibliography|appendix)/i

function parseChapterHeader(text: string): { chapterNum: string | null; topicTitle: string } | null {
  const clean = text.trim()
  
  // Case A: "CHAPTER ONE" or "CHAPTER 1: INTRODUCTION"
  const m1 = clean.match(/^chapter\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)(?:\s*[:\-]\s*(.*))?$/i)
  if (m1) {
    const rawNum = m1[1].toUpperCase()
    const numWord = NUM_TO_WORD[rawNum] || rawNum
    const rest = m1[2] ? m1[2].trim() : ''
    return { chapterNum: numWord, topicTitle: rest }
  }

  // Case B: "1.0 INTRODUCTION" or "1.1 INTRODUCTION"
  const m2 = clean.match(/^([1-9])\.\d*\s+(.+)$/i)
  if (m2) {
    const numWord = NUM_TO_WORD[m2[1]] || m2[1]
    const topic = m2[2].trim()
    return { chapterNum: numWord, topicTitle: topic }
  }

  return null
}

function summarizeParagraph(text: string, maxBullets: number = 3): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 15 && !/^(however|therefore|moreover|furthermore|in\s+addition)/i.test(s) && !isNoiseText(s))

  if (sentences.length === 0) return isNoiseText(text) ? [] : [text.slice(0, 120)]

  // Score each sentence: prefer those with numbers, technical terms, keywords
  const scored = sentences.map(s => {
    let score = 0
    if (/\d+/.test(s)) score += 2
    if (/\b(system|design|implement|result|performance|accuracy|efficiency|method)\b/i.test(s)) score += 2
    if (s.length > 40 && s.length < 150) score += 1
    if (/\b(proposed|developed|achieved|improved|reduced|increased)\b/i.test(s)) score += 2
    return { text: s, score }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, maxBullets).map(s => {
    if (s.text.length > 120) return s.text.slice(0, 117) + '...'
    return s.text
  })
}

function extractAcademicSections(fullHtml: string): AcademicSection[] {
  if (typeof window === 'undefined' || !fullHtml.trim()) return []

  const parser = new DOMParser()
  const doc = parser.parseFromString(fullHtml, 'text/html')

  const sections: AcademicSection[] = []
  let current: AcademicSection | null = null
  let currentSubHeading = ''
  let currentSubBullets: string[] = []
  let seenBullets = new Set<string>()
  let pendingChapterNum: string | null = null

  const addBullet = (bText: string) => {
    const cleaned = cleanBulletText(bText)
    if (!cleaned || cleaned.length < 4 || isNoiseText(cleaned)) return
    const key = cleaned.toLowerCase()
    if (!seenBullets.has(key)) {
      seenBullets.add(key)
      currentSubBullets.push(cleaned)
    }
  }

  const flushSubsection = () => {
    if (current && currentSubHeading && currentSubBullets.length > 0) {
      current.subsections.push({ heading: currentSubHeading, bullets: [...currentSubBullets] })
    }
    currentSubHeading = ''
    currentSubBullets = []
  }

  const flushCurrent = () => {
    flushSubsection()
    if (current && (current.subsections.length > 0 || current.rawParagraphs.length > 0 || current.tables.length > 0)) {
      if (current.subsections.length === 0 && current.rawParagraphs.length > 0) {
        const allText = current.rawParagraphs.join(' ')
        const bullets = summarizeParagraph(allText, 5)
        const filtered = bullets.map(b => cleanBulletText(b)).filter(b => b.length > 3 && !isNoiseText(b))
        current.subsections.push({ heading: '', bullets: filtered })
      }
      sections.push(current)
    }
    current = null
    seenBullets.clear()
  }

  const pages = Array.from(doc.querySelectorAll('div[data-type="page"]'))
  const contentPages = pages.filter(p => !isCoverPage(p) && !isTocPage(p))
  const containers = contentPages.length > 0 ? contentPages : [doc.body]

  for (const container of containers) {
    const elements = Array.from(container.querySelectorAll('h1, h2, h3, p, ul, ol, table'))

    for (const el of elements) {
      if (isCoverPage(el) || isTocPage(el)) continue

      const tag = el.tagName.toLowerCase()
      const text = cleanText(el.textContent || '')
      if (!text || isNoiseText(text)) continue

      // ── H1: Chapter heading or topic title ──
      if (tag === 'h1') {
        const parsed = parseChapterHeader(text)

        if (parsed) {
          if (parsed.topicTitle) {
            // Full heading: "CHAPTER ONE: INTRODUCTION" or "1.0 INTRODUCTION"
            flushCurrent()
            current = {
              chapterNum: parsed.chapterNum,
              title: parsed.topicTitle.toUpperCase(),
              subsections: [],
              tables: [],
              rawParagraphs: [],
            }
            pendingChapterNum = null
            continue
          } else {
            // "CHAPTER ONE" — store number, wait for topic title
            flushCurrent()
            pendingChapterNum = parsed.chapterNum
            continue
          }
        }

        if (pendingChapterNum) {
          // Topic title following "CHAPTER ONE"
          current = {
            chapterNum: pendingChapterNum,
            title: text.toUpperCase(),
            subsections: [],
            tables: [],
            rawParagraphs: [],
          }
          pendingChapterNum = null
          continue
        }

        // Standalone h1 (ABSTRACT, REFERENCES, etc.)
        if (TOPIC_PATTERN.test(text)) {
          flushCurrent()
          current = {
            chapterNum: null,
            title: text.toUpperCase(),
            subsections: [],
            tables: [],
            rawParagraphs: [],
          }
          continue
        }

        // Generic h1 — start new section
        flushCurrent()
        current = {
          chapterNum: null,
          title: text,
          subsections: [],
          tables: [],
          rawParagraphs: [],
        }
        continue
      }

      // ── H2/H3: Sub-section heading ──
      if (tag === 'h2' || tag === 'h3') {
        const parsed = parseChapterHeader(text)
        if (parsed && parsed.chapterNum && !current) {
          // Chapter heading inside h2/h3
          flushCurrent()
          current = {
            chapterNum: parsed.chapterNum,
            title: (parsed.topicTitle || text).toUpperCase(),
            subsections: [],
            tables: [],
            rawParagraphs: [],
          }
          continue
        }

        if (!current) {
          flushCurrent()
          current = { chapterNum: null, title: text, subsections: [], tables: [], rawParagraphs: [] }
        } else {
          flushSubsection()
          currentSubHeading = cleanBulletText(text)
        }
        continue
      }

      // ── Lists ──
      if (tag === 'ul' || tag === 'ol') {
        const items = Array.from(el.querySelectorAll('li'))
        for (const li of items) {
          const itemText = cleanText(li.textContent || '')
          addBullet(itemText)
        }
        continue
      }

      // ── Tables ──
      if (tag === 'table') {
        if (!current) continue
        const rows = Array.from(el.querySelectorAll('tr'))
        const grid: string[][] = []
        rows.forEach(tr => {
          const cells = Array.from(tr.children)
            .filter(c => c.tagName.toLowerCase() === 'td' || c.tagName.toLowerCase() === 'th')
          const rowText = cells.map(c => cleanText(c.textContent || ''))
          if (rowText.some(t => t.length > 0)) grid.push(rowText)
        })
        if (grid.length > 0) current.tables.push(grid)
        continue
      }

      // ── Paragraphs ──
      if (tag === 'p') {
        if (!current) continue
        if (text.length > 20 && !/^page\s+\d+/i.test(text)) {
          if (currentSubHeading) {
            const bullets = summarizeParagraph(text, 2)
            bullets.forEach(b => addBullet(b))
          } else {
            current.rawParagraphs.push(text)
          }
        }
      }
    }
  }

  if (pendingChapterNum && !current) {
    current = {
      chapterNum: pendingChapterNum,
      title: 'OVERVIEW',
      subsections: [],
      tables: [],
      rawParagraphs: [],
    }
  }

  flushCurrent()
  return sections
}

// ─── Phase 2: Map Sections → Slide Data ─────────────────────────

interface SlideData {
  type: 'chapter' | 'content' | 'table'
  headerText: string     // e.g., "CHAPTER ONE" or "ABSTRACT"
  subHeaderText?: string // e.g., "INTRODUCTION"
  bullets: string[]
  tableRows?: string[][]
}

function buildSlideData(sections: AcademicSection[]): SlideData[] {
  const slides: SlideData[] = []
  const MAX_BULLETS_PER_SLIDE = 5

  for (const sec of sections) {
    const allBullets: string[] = []
    const seenInSec = new Set<string>()

    for (const sub of sec.subsections) {
      if (sub.heading) {
        const cleanH = cleanBulletText(sub.heading)
        if (cleanH && !seenInSec.has(cleanH.toLowerCase())) {
          seenInSec.add(cleanH.toLowerCase())
          allBullets.push(`▸ ${cleanH}`)
        }
      }
      for (const b of sub.bullets) {
        const cleanB = cleanBulletText(b)
        if (cleanB && !seenInSec.has(cleanB.toLowerCase())) {
          seenInSec.add(cleanB.toLowerCase())
          allBullets.push(cleanB)
        }
      }
    }

    const headerText = sec.chapterNum ? `CHAPTER ${sec.chapterNum}` : sec.title
    const subHeaderText = sec.chapterNum ? sec.title : undefined

    if (allBullets.length > MAX_BULLETS_PER_SLIDE) {
      // Chunk bullets into blocks of max 5 per slide
      for (let i = 0; i < allBullets.length; i += MAX_BULLETS_PER_SLIDE) {
        const chunk = allBullets.slice(i, i + MAX_BULLETS_PER_SLIDE)
        const partNum = Math.floor(i / MAX_BULLETS_PER_SLIDE) + 1
        const isFirst = i === 0
        slides.push({
          type: isFirst ? 'chapter' : 'content',
          headerText: isFirst ? (subHeaderText ? `${headerText}: ${subHeaderText}` : headerText) : (subHeaderText || headerText),
          subHeaderText: partNum > 1 ? `Part ${partNum}` : undefined,
          bullets: chunk,
        })
      }
    } else if (allBullets.length > 0) {
      slides.push({
        type: 'chapter',
        headerText,
        subHeaderText,
        bullets: allBullets,
      })
    }

    // Tables get their own slide
    for (const table of sec.tables) {
      slides.push({
        type: 'table',
        headerText: sec.title + ' — Data',
        tableRows: table.slice(0, 8),
        bullets: [],
      })
    }
  }

  // Cap at 13 content slides (+ title + closing = 15 total)
  return slides.slice(0, 13)
}

// ─── Phase 3: pptxgenjs Render ──────────────────────────────────

export async function exportPresentationPptx(fullHtml: string, meta: PptxMetadata = {}): Promise<void> {
  const pptxgenModule = await import('pptxgenjs')
  const pptxgen = pptxgenModule.default || pptxgenModule
  const pptx = new pptxgen()

  pptx.layout = 'LAYOUT_16x9'
  pptx.title = meta.title || 'Seminar Presentation'
  pptx.author = meta.studentName || 'Student Presenter'

  const titleText = meta.title || 'ACADEMIC SEMINAR PRESENTATION'
  const studentName = meta.studentName || 'STUDENT NAME'
  const matricNo = meta.matricNo || 'MATRIC NUMBER'
  const department = meta.department || 'COMPUTER ENGINEERING'
  const supervisor = meta.supervisorName || 'SUPERVISOR NAME'
  const institution = meta.institution || 'YABA COLLEGE OF TECHNOLOGY'

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 1: TITLE SLIDE (Dark Navy)
  // ═══════════════════════════════════════════════════════════════
  const s1 = pptx.addSlide()
  s1.addShape('rect' as any, { x: 0, y: 0, w: '100%', h: '100%', fill: { color: '0F172A' } })
  s1.addShape('rect' as any, { x: 0, y: 0, w: '100%', h: 0.12, fill: { color: '4F46E5' } })

  s1.addText(institution.toUpperCase(), {
    x: 0.8, y: 0.6, w: 11.7, h: 0.4,
    fontSize: 13, bold: true, color: '94A3B8', align: 'center', fontFace: 'Arial',
  })

  s1.addText(titleText.toUpperCase(), {
    x: 0.8, y: 1.5, w: 11.7, h: 2.2,
    fontSize: 34, bold: true, color: 'FFFFFF', align: 'center', fontFace: 'Arial', lineSpacing: 42,
  })

  s1.addShape('rect' as any, { x: 4.66, y: 3.9, w: 4.0, h: 0.04, fill: { color: '4F46E5' } })

  s1.addText(
    `Presented by: ${studentName}  |  ${matricNo}\nDepartment of ${department}\nSupervisor: ${supervisor}`,
    {
      x: 0.8, y: 4.3, w: 11.7, h: 1.8,
      fontSize: 15, color: 'CBD5E1', align: 'center', fontFace: 'Arial', lineSpacing: 24,
    }
  )

  // ═══════════════════════════════════════════════════════════════
  // CONTENT SLIDES
  // ═══════════════════════════════════════════════════════════════
  const academicSections = extractAcademicSections(fullHtml)
  const slideData = buildSlideData(academicSections)
  const totalSlides = slideData.length + 2 // +title +closing

  slideData.forEach((sd, idx) => {
    const slide = pptx.addSlide()

    // Light background
    slide.addShape('rect' as any, { x: 0, y: 0, w: '100%', h: '100%', fill: { color: 'F8FAFC' } })
    // Dark header banner
    slide.addShape('rect' as any, { x: 0, y: 0, w: '100%', h: 1.1, fill: { color: '0F172A' } })
    // Left accent bar
    slide.addShape('rect' as any, { x: 0.55, y: 0.22, w: 0.08, h: 0.66, fill: { color: '4F46E5' } })

    // Slide header (24pt bold white)
    slide.addText(sd.headerText.toUpperCase(), {
      x: 0.85, y: 0.15, w: 10.0, h: sd.subHeaderText ? 0.42 : 0.7,
      fontSize: sd.subHeaderText ? 20 : 24, bold: true, color: 'FFFFFF', fontFace: 'Arial', valign: 'middle',
    })

    // Sub-header (topic title or Part 2/3)
    if (sd.subHeaderText) {
      slide.addText(sd.subHeaderText, {
        x: 0.85, y: 0.55, w: 10.0, h: 0.4,
        fontSize: 16, italic: true, color: 'A5B4FC', fontFace: 'Arial', valign: 'middle',
      })
    }

    // Slide number
    slide.addText(`${idx + 2} / ${totalSlides}`, {
      x: 11.0, y: 0.35, w: 1.8, h: 0.4,
      fontSize: 11, color: '64748B', align: 'right', fontFace: 'Arial',
    })

    // ── Table slide ──
    if (sd.type === 'table' && sd.tableRows && sd.tableRows.length > 0) {
      const formattedRows: any[][] = sd.tableRows.map((row, rIdx) =>
        row.map(cellText => ({
          text: cellText,
          options: {
            fontSize: 12, bold: rIdx === 0,
            color: rIdx === 0 ? 'FFFFFF' : '1E293B',
            fill: rIdx === 0 ? { color: '0F172A' } : rIdx % 2 === 1 ? { color: 'F1F5F9' } : { color: 'FFFFFF' },
            align: 'left' as const, valign: 'middle' as const,
          },
        }))
      )

      slide.addTable(formattedRows, {
        x: 0.8, y: 1.4, w: 11.7, fontSize: 12, border: { pt: 1, color: 'CBD5E1' },
      })
    }

    // ── Bullet content ──
    if (sd.bullets.length > 0) {
      const startY = sd.type === 'table' && sd.tableRows ? 4.5 : 1.5
      const bulletProps = sd.bullets.map((bText, bIdx) => {
        const isSubHeading = bText.startsWith('▸ ')
        const rawText = isSubHeading ? bText.slice(2) : bText
        return {
          text: rawText + (bIdx === sd.bullets.length - 1 ? '' : '\n'),
          options: {
            ...(isSubHeading
              ? { bold: true, fontSize: 17, color: '1E293B', fontFace: 'Arial', lineSpacing: 28 }
              : { bullet: true, fontSize: 18, color: '334155', fontFace: 'Arial', lineSpacing: 26 }),
          },
        }
      })

      slide.addText(bulletProps, {
        x: 0.8, y: startY, w: 11.7, h: 7.5 - startY - 0.8, valign: 'top',
      })
    }

    // Footer
    slide.addText(`DocsAI Seminar Presentation | ${department}`, {
      x: 0.8, y: 7.0, w: 10.0, h: 0.3, fontSize: 9, color: '94A3B8', fontFace: 'Arial',
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // CLOSING SLIDE: Q&A (Dark Navy)
  // ═══════════════════════════════════════════════════════════════
  const closingSlide = pptx.addSlide()
  closingSlide.addShape('rect' as any, { x: 0, y: 0, w: '100%', h: '100%', fill: { color: '0F172A' } })

  closingSlide.addText('THANK YOU', {
    x: 0.8, y: 2.0, w: 11.73, h: 1.2,
    fontSize: 42, bold: true, color: 'FFFFFF', align: 'center', fontFace: 'Arial',
  })

  closingSlide.addShape('rect' as any, { x: 4.66, y: 3.4, w: 4.0, h: 0.04, fill: { color: '4F46E5' } })

  closingSlide.addText('Questions & Answers', {
    x: 0.8, y: 3.8, w: 11.73, h: 0.8,
    fontSize: 20, color: 'CBD5E1', align: 'center', fontFace: 'Arial',
  })

  closingSlide.addText(`${studentName}  |  ${department}\n${institution}`, {
    x: 0.8, y: 5.0, w: 11.73, h: 1.0,
    fontSize: 14, color: '64748B', align: 'center', fontFace: 'Arial', lineSpacing: 22,
  })

  const safeFileName = (titleText.replace(/[^\w\-]+/g, '_').toLowerCase() || 'presentation') + '.pptx'
  await pptx.writeFile({ fileName: safeFileName })
}
