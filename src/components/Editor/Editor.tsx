"use client"

import React, { useState, useEffect, useRef } from 'react'
import { useEditor, EditorContent, NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer } from '@tiptap/react'
import { Node, mergeAttributes } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import FontFamily from '@tiptap/extension-font-family'
import { LineHeight } from './LineHeightExtension'
import { Underline } from './UnderlineExtension'
import Dashboard, { Project } from '../Dashboard/Dashboard'
import { 
  saveSource, 
  getSourcesForProject, 
  deleteSource, 
  deleteSourcesForProject,
  saveProject,
  getAllProjects,
  deleteProject as dbDeleteProject,
  saveProjectsBatch
} from '../../utils/db'
import { chunkDocument, retrieveRelevantChunks } from '../../utils/rag'
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Underline as UnderlineIcon,
  Strikethrough as StrikeIcon,
  Code as CodeIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List as BulletListIcon,
  ListOrdered as OrderedListIcon,
  Quote as QuoteIcon,
  Undo as UndoIcon,
  Redo as RedoIcon,
  Download,
  Moon,
  Sun,
  CheckCircle2,
  Clock,
  FileText,
  ChevronRight,
  ChevronLeft,
  Minimize2,
  Maximize2,
  Scissors,
  Upload,
  Check,
  Trash2,
  Plus,
  Search,
  LayoutGrid,
  Calendar,
  Edit3,
  Folder,
  Sparkles
} from 'lucide-react'

// Default template content for the editor
const DEFAULT_CONTENT = `
<h1>An Analysis of AI-Assisted Document Editing for Academic Workflows</h1>
<p>This document is created using <strong>WordPI</strong>, a client-side word processor optimized for educational and research tasks. It is running entirely in your browser without requiring a backend server.</p>
<h2>1. Project Vision</h2>
<p>Students face significant hurdles when compiling academic projects, including formatting compliance, citation structuring, and outline design. Traditional word processors offer formatting tools but lack context-aware assistance. WordPI attempts to solve this by providing a highly responsive editor coupled with an offline-first data model.</p>
<blockquote>
  "The future of academic software lies in Zero-Server architectures that grant students absolute control over their content privacy and tool availability without subscription limits."
</blockquote>
<h2>2. Technical Highlights</h2>
<ul>
  <li><strong>Zero Hosting Fees:</strong> The system is designed to compile static files that can run serverless.</li>
  <li><strong>Local Autonomy:</strong> Autosaving leverages browser storage, ensuring zero risk of document loss on tab refresh.</li>
  <li><strong>Surgical AI Ingestion (Phase 2):</strong> Content streams directly into specific paragraph chunks.</li>
</ul>
<p>Feel free to select text, change typography styles, or try out the formatting toolbar at the top!</p>
`

const SEMINAR_TEMPLATE = `
<div data-type="page">
  <p style="text-align: center;"><strong>&nbsp;</strong></p>
  <p style="text-align: center;"><strong>&nbsp;</strong></p>
  <h1 style="text-align: center; line-height: 1.5; font-size: 1.5rem; text-transform: uppercase;"><strong>[Insert Seminar Topic Here]</strong></h1>
  <div data-type="yabatech-logo"></div>
  <p style="text-align: center;"><strong>&nbsp;</strong></p>
  <p style="text-align: center; text-transform: uppercase; font-weight: bold; font-size: 0.95rem;">A SEMINAR REPORT</p>
  <p style="text-align: center; font-size: 0.9rem; text-transform: uppercase;">PRESENTED TO</p>
  <p style="text-align: center; font-weight: bold; font-size: 0.95rem; text-transform: uppercase;">THE DEPARTMENT OF COMPUTER ENGINEERING<br>SCHOOL OF ENGINEERING<br>YABA COLLEGE OF TECHNOLOGY, YABA.</p>
  <p style="text-align: center;"><strong>&nbsp;</strong></p>
  <p style="text-align: center; font-size: 0.9rem; text-transform: uppercase;">BY</p>
  <p style="text-align: center; font-weight: bold; font-size: 0.95rem; text-transform: uppercase;">[STUDENT NAME]<br>[MATRIC NUMBER]</p>
  <p style="text-align: center;"><strong>&nbsp;</strong></p>
  <p style="text-align: center; font-size: 0.85rem; line-height: 1.6; text-transform: uppercase; max-width: 600px; margin: 0 auto;">A SEMINAR REPORT SUBMITTED IN PARTIAL FULFILMENT OF THE REQUIREMENTS FOR THE AWARD OF THE HIGHER NATIONAL DIPLOMA (HND) IN COMPUTER ENGINEERING</p>
  <p style="text-align: center;"><strong>&nbsp;</strong></p>
  <p style="text-align: center; font-size: 0.9rem; text-transform: uppercase;">SUPERVISED BY</p>
  <p style="text-align: center; font-weight: bold; font-size: 0.95rem; text-transform: uppercase;">[SUPERVISOR NAME]</p>
  <p style="text-align: center;"><strong>&nbsp;</strong></p>
  <p style="text-align: center; font-weight: bold; font-size: 0.95rem;">2025/2026</p>
</div>
<div data-type="page">
  <h2>Chapter 1.</h2>
  <h3>1.1. Introduction</h3>
  <p>Start writing your seminar introduction here...</p>
  <h3>1.2. Problem Definition and Motivation</h3>
  <p>Define the core problem and research motivation here...</p>
  <h3>1.4. Advantages and Limitations</h3>
  <p>Detail the key advantages and technical limitations of the proposed approach...</p>
</div>
<div data-type="page">
  <h2>Chapter 2</h2>
  <h3>Literature Review/Related work</h3>
  <p>Perform a thorough literature survey here...</p>
  <h3>2.1. Summary of exit works</h3>
  <p>Summarize relevant existing/exit works and state-of-the-art literature...</p>
  <h3>2.2. Overview of previous research</h3>
  <p>Provide a comprehensive overview of historical research findings...</p>
  <h3>Research Gaps</h3>
  <p>Identify the key research gaps in existing systems...</p>
</div>
<div data-type="page">
  <h2>Chapter 3</h2>
  <h3>Methodology/Working Principle</h3>
  <p>Describe the research design or experimental methodology here...</p>
  <h3>3.1. Core Concepts: Theoretical Background</h3>
  <p>Explain the theoretical background and fundamental concepts...</p>
  <h3>3.2. Working Principle/Process Flow</h3>
  <p>Provide a detailed description of the process flow or system architecture...</p>
  <h3>3.3. Techniques/Tool Used</h3>
  <p>Enumerate and describe the research techniques or engineering tools utilized...</p>
</div>
<div data-type="page">
  <h2>Chapter 4</h2>
  <h3>4.1. Summary of key takeaways and main findings</h3>
  <p>Summarize the key takeaways and major experimental findings of the seminar...</p>
  <h3>4.2. Future Scope</h3>
  <p>Detail potential areas of future extension and development...</p>
</div>
<div data-type="page">
  <h2>References</h2>
  <p>[Insert your bibliography citations in the latest APA style here]</p>
</div>
`


const PROPOSAL_TEMPLATE = `
<h1>Research Proposal: [Insert Topic Here]</h1>
<div data-type="page">
  <h2>Chapter 1: Introduction</h2>
  <h3>1.1. Background of the Study</h3>
  <p>Provide the foundational background details of your research here...</p>
  <h3>1.2. Problem Statement</h3>
  <p>Surgically define the core problem statement being addressed...</p>
  <h3>1.3. Aim and Objectives</h3>
  <p>Detail the overall aim and list specific research objectives...</p>
  <h3>1.4. Research Questions</h3>
  <p>Formulate the primary research questions your study attempts to answer...</p>
  <h3>1.5. Scope and Significance of the Study</h3>
  <p>Define the boundary scope and discuss the clinical, scientific, or socioeconomic significance of this study...</p>
</div>
<div data-type="page">
  <h2>Chapter 2: Literature Review</h2>
  <h3>2.1. Theoretical Framework</h3>
  <p>Examine current literature models and establish your theoretical framework...</p>
  <h3>2.2. Empirical Review</h3>
  <p>Conduct a thorough critical review of past empirical research related to the topic...</p>
</div>
<div data-type="page">
  <h2>Chapter 3: Research Methodology</h2>
  <h3>3.1. Research Design</h3>
  <p>Describe the methodological research design adopted for this study...</p>
  <h3>3.2. Data Collection Methods</h3>
  <p>Outline your target population, sample sizes, and instrumentation methods...</p>
  <h3>3.3. Data Analysis Plan</h3>
  <p>Explain how collected variables will be processed, modeled, and evaluated...</p>
</div>
<div data-type="page">
  <h2>References</h2>
  <p>[Insert references in APA or Harvard style here]</p>
</div>
`

const PROJECT_TEMPLATE = `
<h1>Thesis Project: [Insert Topic Here]</h1>
<div data-type="page">
  <h2>Chapter 1: Introduction</h2>
  <h3>1.1. Study Background</h3>
  <p>Detail the historical and academic background of your thesis topic here...</p>
  <h3>1.2. Problem Statement</h3>
  <p>Clearly state the specific issue or challenge this project aims to solve...</p>
  <h3>1.3. Project Aim and Objectives</h3>
  <p>Write your project's high-level goal and specific design milestones...</p>
  <h3>1.4. Significance of the Study</h3>
  <p>Explain how this study contributes to the field and its practical benefits...</p>
</div>
<div data-type="page">
  <h2>Chapter 2: Literature Review</h2>
  <h3>2.1. Overview and Key Theories</h3>
  <p>Review the standard academic literature, historical developments, and theories related to this work...</p>
  <h3>2.2. Analysis of State-of-the-Art Systems</h3>
  <p>Contrast existing solutions, highlight their merits, and point out operational limitations...</p>
</div>
<div data-type="page">
  <h2>Chapter 3: System Design & Methodology</h2>
  <h3>3.1. Methodology Framework</h3>
  <p>Detail the research methodology, engineering design, or mathematical framework used...</p>
  <h3>3.2. Process Design & System Architecture</h3>
  <p>Explain the step-by-step process flow or architecture details of your system...</p>
</div>
<div data-type="page">
  <h2>Chapter 4: Implementation & Experimental Results</h2>
  <h3>4.1. Implementation Overview</h3>
  <p>Describe the practical execution, software code, or hardware builds...</p>
  <h3>4.2. Results Analysis & Performance Comparison</h3>
  <p>Present and discuss experimental findings, tables, charts, or comparative statistics...</p>
</div>
<div data-type="page">
  <h2>Chapter 5: Conclusion & Recommendations</h2>
  <h3>5.1. Summary of Contributions</h3>
  <p>Summarize the major findings and contributions of this project...</p>
  <h3>5.2. Recommendations for Future Work</h3>
  <p>Provide recommendations for future study expansions and next phases...</p>
</div>
<div data-type="page">
  <h2>References</h2>
  <p>[Insert your academic citations here]</p>
</div>
`

const toTitleCase = (str: string): string => {
  if (!str) return ''
  const minorWords = ['and', 'as', 'but', 'for', 'if', 'nor', 'or', 'so', 'yet', 'a', 'an', 'the', 'at', 'by', 'for', 'in', 'of', 'on', 'to', 'with', 'from', 'into', 'onto', 'upon', 'about', 'above', 'across', 'after', 'against', 'along', 'among', 'around', 'before', 'behind', 'below', 'beneath', 'beside', 'between', 'beyond', 'during', 'except', 'inside', 'outside', 'over', 'through', 'under', 'underneath', 'until', 'within', 'without']
  
  return str.replace(/\b[a-zA-Z']+\b/g, (word, index) => {
    const isFirstOrLast = index === 0 || index + word.length === str.length
    const lowerWord = word.toLowerCase()
    
    if (!isFirstOrLast && minorWords.includes(lowerWord)) {
      return lowerWord
    }
    
    if (word === word.toUpperCase() && word.length > 3) {
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    }
    
    return word.charAt(0).toUpperCase() + word.slice(1)
  })
}

// Helper function to format raw markdown or code-blocked AI outputs to clean HTML tags.
// This ensures content inserts cleanly into the Tiptap document tree with proper styles.
const formatAiResponseToHtml = (text: string): string => {
  // Strip any raw replacement tags that might leak
  let cleaned = text
    .replace(/<+\s*ORIGINAL\s*>+/gi, '')
    .replace(/<+\s*REPLACEMENT\s*>+/gi, '')
    .replace(/<+\s*NEW\s*>+/gi, '')
    .replace(/<+\s*END\s*>+/gi, '')
    .replace(/<<<+/g, '')
    .replace(/>>>+/g, '')
    .replace(/<<+/g, '')
    .replace(/>>+/g, '')
    .trim()

  // Remove markdown code block wraps (e.g., ```html ... ``` or ``` ... ```)
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '')
  }

  // If it's already full HTML (e.g. starts with <p, <h, <ul, <ol), we return it as is.
  if (/<(p|h[1-6]|ul|ol|li|blockquote|pre|code|strong|em|table|tr|td|th)\b[^>]*>/i.test(cleaned)) {
    return cleaned
  }

  // Split by lines to compile block elements
  const lines = cleaned.split(/\r?\n/)
  const result: string[] = []
  
  let inList: 'ul' | 'ol' | null = null
  let inBlockquote = false
  let inCodeBlock = false
  let codeBlockLines: string[] = []

  const closeList = () => {
    if (inList === 'ul') {
      result.push('</ul>')
    } else if (inList === 'ol') {
      result.push('</ol>')
    }
    inList = null
  }

  const closeBlockquote = () => {
    if (inBlockquote) {
      result.push('</blockquote>')
      inBlockquote = false
    }
  }

  const parseInline = (str: string): string => {
    return str
      // Bold **text**
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      // Italic *text*
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/_([^_]+)_/g, '<em>$1</em>')
      // Inline code `code`
      .replace(/`([^`]+)`/g, '<code>$1</code>')
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Handle code blocks
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        result.push(`<pre><code>${codeBlockLines.join('\n')}</code></pre>`)
        codeBlockLines = []
        inCodeBlock = false
      } else {
        closeList()
        closeBlockquote()
        inCodeBlock = true
      }
      continue
    }

    if (inCodeBlock) {
      codeBlockLines.push(line)
      continue
    }

    // Empty lines
    if (trimmed === '') {
      closeList()
      closeBlockquote()
      continue
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      closeList()
      closeBlockquote()
      const level = headingMatch[1].length
      const content = parseInline(headingMatch[2])
      result.push(`<h${level}>${content}</h${level}>`)
      continue
    }

    // Blockquotes
    if (trimmed.startsWith('>')) {
      closeList()
      if (!inBlockquote) {
        result.push('<blockquote>')
        inBlockquote = true
      }
      const content = parseInline(trimmed.substring(1).trim())
      result.push(`<p>${content}</p>`)
      continue
    } else {
      closeBlockquote()
    }

    // Unordered list items
    const ulMatch = trimmed.match(/^[-*+]\s+(.*)$/)
    if (ulMatch) {
      if (inList !== 'ul') {
        closeList()
        result.push('<ul>')
        inList = 'ul'
      }
      const content = parseInline(ulMatch[1])
      result.push(`<li>${content}</li>`)
      continue
    }

    // Ordered list items
    const olMatch = trimmed.match(/^(\d+)\.\s+(.*)$/)
    if (olMatch) {
      if (inList !== 'ol') {
        closeList()
        result.push('<ol>')
        inList = 'ol'
      }
      const content = parseInline(olMatch[2])
      result.push(`<li>${content}</li>`)
      continue
    }

    // Regular text paragraph
    closeList()
    const content = parseInline(trimmed)
    result.push(`<p>${content}</p>`)
  }

  closeList()
  closeBlockquote()

  return result.join('')
}

const findTextRange = (editor: any, searchText: string): { from: number; to: number } | null => {
  if (!searchText || !editor) return null
  const target = searchText.trim().replace(/\s+/g, ' ')
  if (!target) return null

  // Accumulate all text nodes with their start and end positions
  const textBlocks: { text: string; startPos: number }[] = []
  editor.state.doc.descendants((node: any, pos: number) => {
    if (node.isText) {
      textBlocks.push({ text: node.text || '', startPos: pos })
    }
    return true
  })

  // Concatenate them to build a single text string and map indices
  let fullText = ''
  const positions: number[] = []

  for (const block of textBlocks) {
    for (let i = 0; i < block.text.length; i++) {
      fullText += block.text[i]
      positions.push(block.startPos + i)
    }
  }

  // Now find the target in fullText
  const index = fullText.indexOf(target)
  if (index !== -1) {
    const from = positions[index]
    const to = positions[Math.min(index + target.length - 1, positions.length - 1)] + 1
    return { from, to }
  }

  // If exact match fails, let's try case-insensitive and normalized spacing
  const normText = fullText.toLowerCase().replace(/\s+/g, ' ')
  const normTarget = target.toLowerCase()
  const normIndex = normText.indexOf(normTarget)
  if (normIndex !== -1) {
    const escapedTarget = target.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/\s+/g, '\\s+')
    const regex = new RegExp(escapedTarget, 'i')
    const match = fullText.match(regex)
    if (match && match.index !== undefined) {
      const startIdx = match.index
      const endIdx = startIdx + match[0].length
      const from = positions[startIdx]
      const to = positions[Math.min(endIdx - 1, positions.length - 1)] + 1
      return { from, to }
    }
  }

  return null
}

interface ParsedReplacement {
  isReplacementMode: boolean;
  originalText: string;
  replacementText: string;
}

const parseStreamingReplacement = (accumulated: string): ParsedReplacement => {
  const origMatch = accumulated.match(/<+\s*ORIGINAL\s*>+/i)
  const replMatch = accumulated.match(/<+\s*(REPLACEMENT|NEW)\s*>+/i)
  const endMatch = accumulated.match(/<+\s*END\s*>+/i)

  if (!origMatch) {
    return { isReplacementMode: false, originalText: '', replacementText: '' }
  }

  const origStart = origMatch.index!
  const origLength = origMatch[0].length
  const origEnd = origStart + origLength

  if (!replMatch) {
    const originalText = accumulated.substring(origEnd).trim()
    return { isReplacementMode: true, originalText, replacementText: '' }
  }

  const replStart = replMatch.index!
  const replLength = replMatch[0].length
  const replEnd = replStart + replLength

  const originalText = accumulated.substring(origEnd, replStart).trim()

  let replacementText = ''
  if (endMatch) {
    replacementText = accumulated.substring(replEnd, endMatch.index!).trim()
  } else {
    replacementText = accumulated.substring(replEnd).trim()
  }

  return { isReplacementMode: true, originalText, replacementText }
}

// Helper to pre-wrap raw HTML in a page block tag if not already paginated.
// This ensures that all imported or reset content is correctly parsed into a page node.
const ensurePaginatedHtml = (html: string): string => {
  const trimmed = html.trim()
  if (!trimmed) return '<div data-type="page"><p></p></div>'
  if (trimmed.includes('data-type="page"') || trimmed.includes('class="page-sheet"')) {
    return html
  }
  return `<div data-type="page">${html}</div>`
}

// Helper to pre-process loaded JSON content to wrap flat block nodes into a page node.
// This preserves backward compatibility for flat document drafts in local storage.
const ensurePaginatedJson = (json: any): any => {
  if (!json) return { type: 'doc', content: [{ type: 'page', content: [{ type: 'paragraph' }] }] }
  if (json.type !== 'doc') return json
  
  const content = json.content || []
  const hasPageNodes = content.some((child: any) => child.type === 'page')
  if (hasPageNodes) {
    return json
  }
  
  return {
    type: 'doc',
    content: [
      {
        type: 'page',
        content: content.length > 0 ? content : [{ type: 'paragraph' }]
      }
    ]
  }
}

// Pure JavaScript NodeView for synchronous page rendering
class PageNodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  editor: any
  node: any
  getPos: any

  constructor(node: any, editor: any, getPos: any) {
    this.node = node
    this.editor = editor
    this.getPos = getPos

    // Outer sheet box representing A4
    this.dom = document.createElement('div')
    this.dom.className = 'page-sheet group relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1)] mx-auto my-4 w-[794px] h-[1123px] select-none text-zinc-850 dark:text-white overflow-hidden box-border print:shadow-none print:border-none print:m-0'

    // Header container
    const headerEl = document.createElement('div')
    headerEl.className = 'absolute top-0 left-0 right-0 h-[96px] px-[72px] flex items-end justify-between border-b border-dashed border-zinc-100 dark:border-zinc-800 pb-2 select-none pointer-events-none text-xs text-zinc-400 dark:text-zinc-500 font-sans'
    headerEl.innerHTML = `
      <span class="header-text truncate max-w-[400px]"></span>
      <span class="text-[10px] tracking-wider uppercase font-semibold text-zinc-300 dark:text-zinc-700">WordPI</span>
    `
    this.dom.appendChild(headerEl)

    // Editable block contents container
    this.contentDOM = document.createElement('div')
    this.contentDOM.className = 'page-content absolute top-[96px] left-0 right-0 h-[931px] px-[72px] overflow-hidden focus:outline-none text-left select-text'
    this.dom.appendChild(this.contentDOM)

    // Footer container
    const footerEl = document.createElement('div')
    footerEl.className = 'absolute bottom-0 left-0 right-0 h-[96px] px-[72px] flex items-start justify-between border-t border-dashed border-zinc-100 dark:border-zinc-800 pt-2 select-none pointer-events-none text-xs text-zinc-400 dark:text-zinc-500 font-sans'
    footerEl.innerHTML = `
      <span class="footer-text truncate max-w-[450px]"></span>
      <div class="flex items-center gap-3">
        <button class="delete-page-btn pointer-events-auto cursor-pointer opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 flex items-center gap-1 text-[10px] font-bold transition-all duration-150 print:hidden" title="Delete this page and all its contents">
          Delete Page
        </button>
        <span class="page-number"></span>
      </div>
    `
    this.dom.appendChild(footerEl)

    const deleteBtn = footerEl.querySelector('.delete-page-btn')
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (event) => {
        event.stopPropagation()
        event.preventDefault()

        const pos = typeof this.getPos === 'function' ? this.getPos() : undefined
        if (pos !== undefined) {
          // Count total pages in Prosemirror doc state
          let totalPageCount = 0
          this.editor.state.doc.descendants((n: any) => {
            if (n.type.name === 'page') {
              totalPageCount++
            }
            return false // Top level only
          })

          if (totalPageCount <= 1) {
            alert('Cannot delete the last remaining page.')
            return
          }

          const indexAttr = this.dom.getAttribute('data-page-index')
          const displayIndex = indexAttr !== null ? parseInt(indexAttr) + 1 : 1

          if (window.confirm(`Are you sure you want to delete Page ${displayIndex} and all of its content?`)) {
            const pageNode = this.editor.state.doc.nodeAt(pos)
            if (pageNode) {
              const size = pageNode.nodeSize
              
              // Perform deletion
              this.editor.view.focus()
              this.editor.chain().deleteRange({ from: pos, to: pos + size }).run()
            }
          }
        }
      })
    }

    this.updateLabels()
  }

  update(node: any) {
    if (node.type.name !== 'page') return false
    this.node = node
    this.updateLabels()
    return true
  }

  updateLabels() {
    let pageIndex = 0
    let totalPages = 1

    if (this.dom.parentNode) {
      const sheets = Array.from(this.dom.parentNode.children).filter(el => el.classList.contains('page-sheet'))
      const idx = sheets.indexOf(this.dom)
      if (idx !== -1) {
        pageIndex = idx
        totalPages = sheets.length
      }
    } else if (this.editor && typeof this.getPos === 'function') {
      try {
        const pos = this.getPos()
        if (pos !== undefined) {
          this.editor.state.doc.descendants((n: any, p: number) => {
            if (n.type.name === 'page') {
              if (p < pos) {
                pageIndex++
              }
            }
            return true
          })
          
          let count = 0
          this.editor.state.doc.descendants((n: any) => {
            if (n.type.name === 'page') {
              count++
            }
            return true
          })
          totalPages = count || 1
        }
      } catch (e) {
        // Fallback default
      }
    }

    const docHeader = (this.editor.storage as any)?.page?.docHeader || ''
    const docFooter = (this.editor.storage as any)?.page?.docFooter || ''

    const headerTextEl = this.dom.querySelector('.header-text')
    if (headerTextEl) headerTextEl.textContent = docHeader

    const footerTextEl = this.dom.querySelector('.footer-text')
    if (footerTextEl) footerTextEl.textContent = docFooter

    const pageNumEl = this.dom.querySelector('.page-number')
    if (pageNumEl) pageNumEl.textContent = `Page ${pageIndex + 1} of ${totalPages}`

    this.dom.setAttribute('data-page-index', pageIndex.toString())

    if (!(window as any)._pageNumTimeout) {
      (window as any)._pageNumTimeout = setTimeout(() => {
        (window as any)._pageNumTimeout = null
        const allSheets = document.querySelectorAll('.page-sheet')
        const total = allSheets.length
        allSheets.forEach((sheet, idx) => {
          const numEl = sheet.querySelector('.page-number')
          if (numEl) {
            numEl.textContent = `Page ${idx + 1} of ${total}`
          }
          sheet.setAttribute('data-page-index', idx.toString())
        })
      }, 0)
    }
  }
}

// Custom Document and Page Nodes
const CustomDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: 'page+',
})

const PageNode = Node.create({
  name: 'page',
  group: 'page',
  content: 'block+',
  defining: true,

  addStorage() {
    return {
      docHeader: '',
      docFooter: ''
    }
  },

  addAttributes() {
    return {
      cover: {
        default: null,
        parseHTML: element => element.getAttribute('data-cover'),
        renderHTML: attributes => {
          if (!attributes.cover) return {}
          return { 'data-cover': attributes.cover }
        }
      },
      toc: {
        default: null,
        parseHTML: element => element.getAttribute('data-toc'),
        renderHTML: attributes => {
          if (!attributes.toc) return {}
          return { 'data-toc': attributes.toc }
        }
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="page"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'page' }), 0]
  },

  addNodeView() {
    return ({ node, editor, getPos }) => new PageNodeView(node, editor, getPos)
  }
})

const CustomParagraph = Node.create({
  name: 'paragraph',
  group: 'block',
  content: 'inline*',
  
  parseHTML() {
    return [{ tag: 'p' }]
  },
  
  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes), 0]
  },
  
  addAttributes() {
    return {
      style: {
        default: null,
        parseHTML: element => element.getAttribute('style'),
        renderHTML: attributes => {
          if (!attributes.style) return {}
          return { style: attributes.style }
        }
      },
      class: {
        default: null,
        parseHTML: element => element.getAttribute('class'),
        renderHTML: attributes => {
          if (!attributes.class) return {}
          return { class: attributes.class }
        }
      },
      'data-level': {
        default: null,
        parseHTML: element => element.getAttribute('data-level'),
        renderHTML: attributes => {
          if (!attributes['data-level']) return {}
          return { 'data-level': attributes['data-level'] }
        }
      },
      'data-page': {
        default: null,
        parseHTML: element => element.getAttribute('data-page'),
        renderHTML: attributes => {
          if (!attributes['data-page']) return {}
          return { 'data-page': attributes['data-page'] }
        }
      }
    }
  },

  addCommands() {
    return {
      setParagraph: () => ({ commands }) => {
        return commands.setNode(this.name)
      },
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-0': () => this.editor.commands.setParagraph(),
    }
  }
})

const TocItemNode = Node.create({
  name: 'tocItem',
  group: 'block',
  content: 'inline*',
  defining: true,
  
  addAttributes() {
    return {
      level: {
        default: 1,
        parseHTML: element => parseInt(element.getAttribute('data-level') || '1'),
        renderHTML: attributes => ({ 'data-level': attributes.level })
      },
      page: {
        default: 1,
        parseHTML: element => parseInt(element.getAttribute('data-page') || '1'),
        renderHTML: attributes => ({ 'data-page': attributes.page })
      }
    }
  },
  
  parseHTML() {
    return [{ tag: 'p[data-type="toc-item"]' }]
  },
  
  renderHTML({ node, HTMLAttributes }) {
    const level = node.attrs.level || 1
    const page = node.attrs.page || 1
    const paddingLeft = (level - 1) * 20
    const fontWeight = level === 1 ? 'bold' : 'normal'
    
    return [
      'p',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'toc-item',
        class: 'toc-item-row',
        style: `display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 10px; font-family: 'Times New Roman', Times, serif; padding-left: ${paddingLeft}px; font-weight: ${fontWeight};`
      }),
      [
        'span',
        { class: 'toc-title' },
        0
      ],
      [
        'span',
        { 
          class: 'toc-dots', 
          style: 'flex-grow: 1; border-bottom: 1px dotted #71717a; margin: 0 10px; position: relative; top: -4px;' 
        }
      ],
      [
        'span',
        { class: 'toc-page', style: 'flex-shrink: 0;' },
        page.toString()
      ]
    ]
  }
})

const YabatechLogo = Node.create({
  name: 'yabatechLogo',
  group: 'block',
  selectable: true,
  draggable: true,
  
  parseHTML() {
    return [
      {
        tag: 'div[data-type="yabatech-logo"]',
      }
    ]
  },
  
  renderHTML({ HTMLAttributes }) {
    return [
      'div', 
      mergeAttributes(HTMLAttributes, { 
        'data-type': 'yabatech-logo',
        style: 'text-align: center; margin: 15px 0;'
      }), 
      [
        'img', 
        { 
          src: '/yabatech_logo.png', 
          alt: 'Yabatech Logo', 
          style: 'width: 100px; height: 100px; object-fit: contain; display: inline-block;' 
        }
      ]
    ]
  }
})

interface OutlineItem {
  text: string;
  level: number;
  id: string;
  page: number;
}



const STORAGE_KEY_PROJECTS = 'wordpi-writings';
const STORAGE_KEY_ACTIVE_ID = 'wordpi-active-id';

export default function Editor() {
  // Dashboard & Multi-Project Storage States
  const [showDashboard, setShowDashboard] = useState(true)
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<'updated' | 'title' | 'words'>('updated')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')

  const [documentTitle, setDocumentTitle] = useState('Untitled Document')
  const [isSaved, setIsSaved] = useState(true)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [wordCount, setWordCount] = useState(0)
  const [charCount, setCharCount] = useState(0)
  const [readTime, setReadTime] = useState(0)
  const [aiPrompt, setAiPrompt] = useState('')
  const [isSimulatingAI, setIsSimulatingAI] = useState(false)
  const [simulatedAiResult, setSimulatedAiResult] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const [docHeader, setDocHeader] = useState('')
  const [docFooter, setDocFooter] = useState('')
  const [loadingMessage, setLoadingMessage] = useState('Processing Document...')
  const [activeAiModel, setActiveAiModel] = useState('')
  const [aiSelectedText, setAiSelectedText] = useState('')
  const [aiSelectionRange, setAiSelectionRange] = useState<{ from: number; to: number } | null>(null)
  const [showFloatingPopup, setShowFloatingPopup] = useState(false)
  const [popupCoords, setPopupCoords] = useState<{ top: number; left: number } | null>(null)
  const [popupContextText, setPopupContextText] = useState('')
  const [popupContextRange, setPopupContextRange] = useState<{ from: number; to: number } | null>(null)
  const [popupPrompt, setPopupPrompt] = useState('')
  const [popupBlockStart, setPopupBlockStart] = useState<number | null>(null)
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)
  const [showLayoutSettings, setShowLayoutSettings] = useState(false)
  const layoutSettingsRef = useRef<HTMLDivElement | null>(null)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement | null>(null)

  // Import document and styling modal states
  const [showImportModal, setShowImportModal] = useState(false)
  const [importFileData, setImportFileData] = useState<{
    name: string
    htmlContent: string
    extension: string
  } | null>(null)
  const [importOption, setImportOption] = useState<'maintain' | 'seminar' | 'apa' | 'ieee' | 'text_only'>('maintain')

  // Document Outline Left Sidebar States
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true)
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [activeHeadingIndex, setActiveHeadingIndex] = useState<number | null>(null)
  const [zoomScale, setZoomScale] = useState(1)
  const isPaginatingRef = useRef(false)
  const paginationTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  // WordPI Setup Wizard & Context Window States
  const [showWizard, setShowWizard] = useState(false)
  const [showGeneratorPopup, setShowGeneratorPopup] = useState(false)
  const [wizardStep, setWizardStep] = useState(1) // 1: Welcome/Details, 2: Ingestion, 3: Setup Choice
  const [wizardTopic, setWizardTopic] = useState('')
  const [wizardAcademicLevel, setWizardAcademicLevel] = useState('Undergraduate')
  const [wizardAcademicTone, setWizardAcademicTone] = useState('Analytical')
  const [aiEngine, setAiEngine] = useState<'gemini' | 'grok' | 'groq'>('gemini')
  const [wizardDocType, setWizardDocType] = useState<'Seminar' | 'Proposal' | 'Project' | 'Custom'>('Project')
  
  const [studentName, setStudentName] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('studentName') || ''
    }
    return ''
  })
  const [matricNumber, setMatricNumber] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('matricNumber') || ''
    }
    return ''
  })
  const [supervisorName, setSupervisorName] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('supervisorName') || ''
    }
    return ''
  })

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('studentName', studentName)
      localStorage.setItem('matricNumber', matricNumber)
      localStorage.setItem('supervisorName', supervisorName)
    }
  }, [studentName, matricNumber, supervisorName])

  const [showCoverPageModal, setShowCoverPageModal] = useState(false)
  const [coverDetails, setCoverDetails] = useState({
    title: '',
    studentName: studentName || '',
    matricNo: matricNumber || '',
    department: '',
    faculty: '',
    institution: 'Yaba College of Technology',
    supervisorName: supervisorName || '',
    academicSession: '2025/2026',
    submissionDate: 'July 2026'
  })

  useEffect(() => {
    setCoverDetails(prev => ({
      ...prev,
      studentName: studentName,
      matricNo: matricNumber,
      supervisorName: supervisorName
    }))
  }, [studentName, matricNumber, supervisorName])

  useEffect(() => {
    if (showCoverPageModal && !coverDetails.title) {
      setCoverDetails(prev => ({ ...prev, title: documentTitle.toUpperCase() }))
    }
  }, [showCoverPageModal, documentTitle, coverDetails.title])

  const [wizardFontFamily, setWizardFontFamily] = useState<'default' | 'arial' | 'georgia' | 'playfair' | 'inter' | 'courier'>('default')
  const [wizardLineSpacing, setWizardLineSpacing] = useState<string>('1.5')
  const [customChapterOutline, setCustomChapterOutline] = useState<string>('')
  const [projectSources, setProjectSources] = useState<{ id?: number; name: string; content: string; type: string }[]>([])
  const [isProcessingSource, setIsProcessingSource] = useState(false)

  const handleDocTypeChange = (val: 'Seminar' | 'Proposal' | 'Project' | 'Custom') => {
    setWizardDocType(val)
    if (val === 'Seminar') {
      setWizardFontFamily('playfair') // Times New Roman / Playfair (APA)
      setWizardLineSpacing('2.0') // Double spacing
    } else if (val === 'Proposal') {
      setWizardFontFamily('arial')
      setWizardLineSpacing('1.5') // 1.5 spacing
    } else if (val === 'Project') {
      setWizardFontFamily('arial')
      setWizardLineSpacing('1.5') // 1.5 spacing
    }
  }

  // Create a blank project directly without popup
  const createNewProject = () => {
    const finalTitle = 'Untitled Document'
    const newProjId = 'proj_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
    
    // Set active states
    setActiveProjectId(newProjId)
    localStorage.setItem(STORAGE_KEY_ACTIVE_ID, newProjId)
    setDocumentTitle(finalTitle)
    setDocHeader('')
    setDocFooter('')
    window.history.pushState({}, '', `/?project=${newProjId}`)
    setShowDashboard(false)
    setProjectSources([])
    
    // Set defaults
    setWizardDocType('Custom')
    setWizardFontFamily('default')
    setWizardLineSpacing('1.5')
    setWizardTopic(finalTitle)
    
    const templateContent = `<h1>${finalTitle}</h1><div data-type="page"><p>Start writing your document here...</p></div>`
    const formattedHtml = ensurePaginatedHtml(templateContent)

    if (editor) {
      editor.commands.setContent(formattedHtml)
      setTimeout(() => {
        editor.chain().focus().selectAll().unsetFontFamily().setLineHeight('1.5').run()
        runPagination(editor)
      }, 150)
    }

    const newProj: Project = {
      id: newProjId,
      title: finalTitle,
      content: JSON.stringify(editor ? editor.getJSON() : {}),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      wordCount: 0,
      charCount: 0,
      documentType: 'Custom',
      academicLevel: 'Undergraduate',
      academicTone: 'Analytical',
      docHeader: '',
      docFooter: ''
    }

    setProjects(prev => {
      const filtered = prev.filter(p => p.id !== newProjId)
      const updated = [newProj, ...filtered]
      saveProject(newProj).catch(e => console.error("Failed to save project to IndexedDB", e))
      return updated
    })
    setIsSaved(true)
  }

  // Create project from templates directly in dashboard without popup
  const createNewProjectWithTemplate = (type: 'Seminar' | 'Proposal' | 'Project' | 'Custom') => {
    const finalTitle = type === 'Seminar' ? 'Seminar Report Blueprint' 
                     : type === 'Proposal' ? 'Research Proposal Outline' 
                     : type === 'Project' ? 'Graduation Thesis Project' 
                     : 'Untitled Document'
    const newProjId = 'proj_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
    
    // Determine settings
    let fontFamily: 'default' | 'arial' | 'georgia' | 'playfair' | 'inter' | 'courier' = 'default'
    let lineSpacing = '1.5'
    
    if (type === 'Seminar') {
      fontFamily = 'playfair'
      lineSpacing = '2.0'
    } else if (type === 'Proposal') {
      fontFamily = 'arial'
      lineSpacing = '1.5'
    } else if (type === 'Project') {
      fontFamily = 'arial'
      lineSpacing = '1.5'
    }

    // Determine content template
    let templateContent = ''
    if (type === 'Seminar') {
      templateContent = SEMINAR_TEMPLATE
        .replace('[Insert Seminar Topic Here]', finalTitle)
        .replace('[STUDENT NAME]', studentName.trim() || 'STUDENT NAME')
        .replace('[MATRIC NUMBER]', matricNumber.trim() || 'MATRIC NUMBER')
        .replace('[SUPERVISOR NAME]', supervisorName.trim() || 'SUPERVISOR NAME')
    } else if (type === 'Proposal') {
      templateContent = PROPOSAL_TEMPLATE.replace('[Insert Topic Here]', finalTitle)
    } else if (type === 'Project') {
      templateContent = PROJECT_TEMPLATE.replace('[Insert Topic Here]', finalTitle)
    } else {
      templateContent = `<h1>${finalTitle}</h1><div data-type="page"><p>Start writing your document here...</p></div>`
    }

    const formattedHtml = ensurePaginatedHtml(templateContent)

    // Set active states
    setActiveProjectId(newProjId)
    localStorage.setItem(STORAGE_KEY_ACTIVE_ID, newProjId)
    setDocumentTitle(finalTitle)
    setDocHeader('')
    setDocFooter('')
    window.history.pushState({}, '', `/?project=${newProjId}`)
    setShowDashboard(false)
    setProjectSources([])
    
    // Set settings
    setWizardDocType(type)
    setWizardFontFamily(fontFamily)
    setWizardLineSpacing(lineSpacing)
    setWizardTopic(finalTitle)

    if (editor) {
      editor.commands.setContent(formattedHtml)
      setTimeout(() => {
        let chain = editor.chain().focus().selectAll()
        if (fontFamily === 'default') {
          chain = chain.unsetFontFamily()
        } else {
          chain = chain.setFontFamily(fontFamily)
        }
        chain.setLineHeight(lineSpacing).run()
        runPagination(editor)
      }, 150)
    }

    const newProj: Project = {
      id: newProjId,
      title: finalTitle,
      content: JSON.stringify(editor ? editor.getJSON() : {}),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      wordCount: editor ? (editor.getText().trim() ? editor.getText().trim().split(/\s+/).length : 0) : 0,
      charCount: editor ? editor.getText().length : 0,
      documentType: type,
      academicLevel: 'Undergraduate',
      academicTone: 'Analytical',
      docHeader: '',
      docFooter: ''
    }

    setProjects(prev => {
      const filtered = prev.filter(p => p.id !== newProjId)
      const updated = [newProj, ...filtered]
      saveProject(newProj).catch(e => console.error("Failed to save project to IndexedDB", e))
      return updated
    })
    setIsSaved(true)
  }

  // Delete a project
  const deleteProject = (id: string) => {
    if (window.confirm('Are you sure you want to delete this project writing? This action cannot be undone.')) {
      const updated = projects.filter(p => p.id !== id)
      setProjects(updated)
      
      // Async IndexedDB delete (which deletes project and its sources)
      dbDeleteProject(id).catch(e => console.error("Failed to delete project from IndexedDB", e))
      
      // If deleted project is active, reset active project ID
      if (activeProjectId === id) {
        setActiveProjectId(null)
        localStorage.removeItem(STORAGE_KEY_ACTIVE_ID)
        window.history.pushState({}, '', '/')
        setShowDashboard(true)
        // Clear editor content
        if (editor) {
          editor.commands.setContent(ensurePaginatedHtml(''))
        }
        setDocumentTitle('Untitled Document')
        setDocHeader('')
        setDocFooter('')
      }
    }
  }

  // Rename a project
  const renameProjectPrompt = (id: string) => {
    const project = projects.find(p => p.id === id)
    if (!project) return
    const newTitle = window.prompt('Enter new title for this project:', project.title)
    if (newTitle !== null && newTitle.trim()) {
      const updated = projects.map(p => {
        if (p.id === id) {
          return {
            ...p,
            title: newTitle.trim(),
            updatedAt: Date.now()
          }
        }
        return p
      })
      setProjects(updated)
      const updatedProj = updated.find(p => p.id === id)
      if (updatedProj) {
        saveProject(updatedProj).catch(e => console.error("Failed to save project to IndexedDB", e))
      }

      // If active project is renamed, update state title
      if (activeProjectId === id) {
        setDocumentTitle(newTitle.trim())
      }
    }
  }

  // Load project
  const loadProject = async (id: string) => {
    const project = projects.find(p => p.id === id)
    if (!project) return

    setActiveProjectId(project.id)
    localStorage.setItem(STORAGE_KEY_ACTIVE_ID, project.id)
    setDocumentTitle(project.title)
    setDocHeader(project.docHeader || '')
    setDocFooter(project.docFooter || '')
    setWordCount(project.wordCount)
    setCharCount(project.charCount)
    setWizardAcademicLevel(project.academicLevel || 'Undergraduate')
    setWizardAcademicTone(project.academicTone || 'Analytical')
    setWizardDocType(project.documentType || 'Project')

    // Load ingested sources from IndexedDB
    try {
      const dbSources = await getSourcesForProject(project.id)
      setProjectSources(dbSources.map(s => ({
        id: s.id,
        name: s.name,
        content: s.content,
        type: s.type
      })))
    } catch (e) {
      console.error("Failed to load project sources from IndexedDB:", e)
      setProjectSources([])
    }

    if (editor) {
      try {
        editor.commands.setContent(JSON.parse(project.content))
        applyOnboardingStyles(editor)
        runPagination(editor)
      } catch (e) {
        console.error("Failed to parse project content:", e)
      }
    }

    window.history.pushState({}, '', `/?project=${project.id}`)
    setShowDashboard(false)
    setIsSaved(true)
  }

  // Delete reference source from IndexedDB and state
  const deleteIngestedSourceAtIndex = async (index: number) => {
    const source = projectSources[index]
    if (source && source.id !== undefined) {
      try {
        await deleteSource(source.id)
      } catch (e) {
        console.error("Failed to delete source from IndexedDB:", e)
      }
    }
    const updated = projectSources.filter((_, idx) => idx !== index)
    setProjectSources(updated)
  }

  // Utility to extract text snippet from stringified Tiptap JSON content
  const getContentSnippet = (contentStr: string): string => {
    try {
      const json = JSON.parse(contentStr)
      let text = ''
      
      const extractText = (node: any) => {
        if (node.text) {
          text += node.text + ' '
        }
        if (node.content) {
          node.content.forEach(extractText)
        }
      }
      
      extractText(json)
      const cleaned = text.replace(/\s+/g, ' ').trim()
      return cleaned.slice(0, 120) + (cleaned.length > 120 ? '...' : '')
    } catch (e) {
      return 'No preview available.'
    }
  }

  // Utility to format timestamp
  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays}d ago`
    
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }

  // Filter and sort projects
  const filteredProjects = projects
    .filter(p => p.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                 p.documentType.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'title') {
        return a.title.localeCompare(b.title)
      }
      if (sortBy === 'words') {
        return b.wordCount - a.wordCount
      }
      return b.updatedAt - a.updatedAt // Default: 'updated'
    })

  // Save title, header, and footer changes to active project
  useEffect(() => {
    if (!activeProjectId || projects.length === 0) return

    const timer = setTimeout(() => {
      setProjects(prevProjects => {
        const project = prevProjects.find(p => p.id === activeProjectId)
        if (project && (project.title !== documentTitle || project.docHeader !== docHeader || project.docFooter !== docFooter)) {
          const updatedProj = {
            ...project,
            title: documentTitle,
            docHeader,
            docFooter,
            updatedAt: Date.now()
          }
          const updated = prevProjects.map(p => p.id === activeProjectId ? updatedProj : p)
          saveProject(updatedProj).catch(e => console.error("Failed to save project to IndexedDB", e))
          setIsSaved(true)
          return updated
        }
        return prevProjects
      })
    }, 500) // Debounce saves to 500ms

    return () => clearTimeout(timer)
  }, [documentTitle, docHeader, docFooter, activeProjectId, projects.length])

  // Load/initialize projects list and active project on mount (with IndexedDB migration support)
  useEffect(() => {
    const initializeStorage = async () => {
      let list: Project[] = []
      
      try {
        // 1. Try to load projects from IndexedDB
        list = await getAllProjects()
        
        // 2. If IndexedDB is empty, check for legacy localStorage projects to migrate
        const storedProjects = localStorage.getItem(STORAGE_KEY_PROJECTS)
        const legacyContent = localStorage.getItem('tiptap-content')
        const legacyTitle = localStorage.getItem('docTitle') || 'Untitled Document'

        if (list.length === 0) {
          if (storedProjects) {
            try {
              const legacyList = JSON.parse(storedProjects) as Project[]
              if (legacyList && legacyList.length > 0) {
                // Batch migrate legacy projects to IndexedDB
                await saveProjectsBatch(legacyList)
                list = legacyList
                console.log(`Successfully migrated ${legacyList.length} legacy projects to IndexedDB.`)
                // Clean up legacy localStorage keys
                localStorage.removeItem(STORAGE_KEY_PROJECTS)
              }
            } catch (e) {
              console.error("Failed to parse/migrate legacy projects list", e)
            }
          } else if (legacyContent) {
            // Migration fallback for legacy single-document data (very old version)
            const migratedProj: Project = {
              id: 'proj_migrated_' + Date.now(),
              title: legacyTitle,
              content: legacyContent,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              wordCount: wordCount || 0,
              charCount: charCount || 0,
              documentType: 'Custom',
              academicLevel: 'Undergraduate',
              academicTone: 'Analytical',
              docHeader: localStorage.getItem('docHeader') || '',
              docFooter: localStorage.getItem('docFooter') || ''
            }
            await saveProject(migratedProj)
            list = [migratedProj]
            localStorage.setItem(STORAGE_KEY_ACTIVE_ID, migratedProj.id)
            
            // Clean up single legacy keys
            localStorage.removeItem('tiptap-content')
            localStorage.removeItem('docTitle')
            localStorage.removeItem('docHeader')
            localStorage.removeItem('docFooter')
          }
        }
      } catch (err) {
        console.error("Failed to initialize IndexedDB storage", err)
      }

      // Update React state with loaded/migrated projects
      setProjects(list)

      // 3. Setup the active project based on URL parameter or stored active ID
      const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
      const targetProjId = searchParams ? searchParams.get('project') : null
      
      const activeId = targetProjId || localStorage.getItem(STORAGE_KEY_ACTIVE_ID)

      if (activeId && list.some(p => p.id === activeId)) {
        setActiveProjectId(activeId)
        localStorage.setItem(STORAGE_KEY_ACTIVE_ID, activeId)
        
        const project = list.find(p => p.id === activeId)!
        setDocumentTitle(project.title)
        setDocHeader(project.docHeader || '')
        setDocFooter(project.docFooter || '')
        setWordCount(project.wordCount)
        setCharCount(project.charCount)
        setWizardAcademicLevel(project.academicLevel || 'Undergraduate')
        setWizardAcademicTone(project.academicTone || 'Analytical')
        setWizardDocType(project.documentType || 'Project')
        
        // If loaded from target URL query param, go straight to the editor!
        if (targetProjId) {
          setShowDashboard(false)
        } else {
          setShowDashboard(true)
        }

        // Load project reference documents from IndexedDB
        getSourcesForProject(activeId).then(projSources => {
          setProjectSources(projSources.map(s => ({
            id: s.id,
            name: s.name,
            content: s.content,
            type: s.type
          })))
        }).catch(e => {
          console.error("Failed to load project sources on mount:", e)
        })
      } else {
        setShowDashboard(true)
        // Clear project query param from URL if it's invalid
        if (targetProjId) {
          window.history.replaceState({}, '', '/')
        }
      }
    }

    initializeStorage()
  }, [])

  // Listen to popstate (browser back/forward navigation)
  useEffect(() => {
    const handlePopState = () => {
      const searchParams = new URLSearchParams(window.location.search)
      const targetProjId = searchParams.get('project')

      if (targetProjId && projects.some(p => p.id === targetProjId)) {
        setActiveProjectId(targetProjId)
        localStorage.setItem(STORAGE_KEY_ACTIVE_ID, targetProjId)
        
        const project = projects.find(p => p.id === targetProjId)!
        setDocumentTitle(project.title)
        setDocHeader(project.docHeader || '')
        setDocFooter(project.docFooter || '')
        setWordCount(project.wordCount)
        setCharCount(project.charCount)
        setWizardAcademicLevel(project.academicLevel || 'Undergraduate')
        setWizardAcademicTone(project.academicTone || 'Analytical')
        setWizardDocType(project.documentType || 'Project')
        setShowDashboard(false)
      } else {
        setShowDashboard(true)
        setActiveProjectId('')
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [projects])

  // Toggle dark/light theme
  useEffect(() => {
    // Load preference
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null
    const docTitle = localStorage.getItem('docTitle')
    
    if (savedTheme) {
      setTheme(savedTheme)
      document.documentElement.classList.toggle('dark', savedTheme === 'dark')
      document.documentElement.classList.toggle('light', savedTheme === 'light')
    } else {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      setTheme(systemTheme)
      document.documentElement.classList.toggle('dark', systemTheme === 'dark')
      document.documentElement.classList.toggle('light', systemTheme === 'light')
    }

    if (docTitle) {
      setDocumentTitle(docTitle)
    }
  }, [])

  // Document Outline Calculations
  const updateOutline = () => {
    if (!editor) return
    const headingElements = document.querySelectorAll('.page-content h1, .page-content h2, .page-content h3, .page-content h4, .page-content h5, .page-content h6')
    const items: OutlineItem[] = []

    headingElements.forEach((el, index) => {
      const htmlEl = el as HTMLElement
      const pageSheet = htmlEl.closest('.page-sheet') as HTMLElement
      let pageNum = 1
      if (pageSheet) {
        const indexAttr = pageSheet.getAttribute('data-page-index')
        if (indexAttr !== null) {
          pageNum = parseInt(indexAttr) + 1
        }
      }
      
      items.push({
        text: htmlEl.textContent || '',
        level: parseInt(htmlEl.tagName.substring(1)),
        id: `heading-${index}`,
        page: pageNum
      })
    })

    setOutline(items)
  }

  const handleScroll = () => {
    const container = scrollContainerRef.current
    if (!container) return

    const pageSheets = container.querySelectorAll('.page-sheet')
    if (pageSheets.length === 0) return

    // Calculate active page mathematically to avoid forced synchronous layout thrashing
    const scrollTop = container.scrollTop
    const containerHeight = container.clientHeight
    const pageHeightWithGap = 1139 * zoomScale
    const midScroll = scrollTop + containerHeight / 2

    let activePage = Math.floor(midScroll / pageHeightWithGap) + 1
    activePage = Math.max(1, Math.min(pageSheets.length, activePage))

    if (activePage !== currentPage) {
      setCurrentPage(activePage)
    }
    if (pageSheets.length !== totalPages) {
      setTotalPages(pageSheets.length)
    }

    // Calculate active outline heading ONLY if the outline sidebar is actually open
    if (leftSidebarOpen) {
      const headingElements = container.querySelectorAll('.page-content h1, .page-content h2, .page-content h3, .page-content h4, .page-content h5, .page-content h6')
      if (headingElements.length === 0) return

      const containerRect = container.getBoundingClientRect()
      let currentActiveIdx: number | null = null
      let minHeadingDiff = Infinity

      headingElements.forEach((el, index) => {
        const htmlEl = el as HTMLElement
        const rect = htmlEl.getBoundingClientRect()
        const diff = Math.abs(rect.top - containerRect.top - 100)
        if (rect.top <= containerRect.top + 200 && diff < minHeadingDiff) {
          minHeadingDiff = diff
          currentActiveIdx = index
        }
      })

      if (currentActiveIdx !== activeHeadingIndex) {
        setActiveHeadingIndex(currentActiveIdx)
      }
    }
  }

  const scrollToHeading = (index: number) => {
    const headingElements = document.querySelectorAll('.page-content h1, .page-content h2, .page-content h3, .page-content h4, .page-content h5, .page-content h6')
    const target = headingElements[index] as HTMLElement
    if (target) {
      // Restore the smooth browser-native scrollIntoView logic from commit 6c40eeb
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })

      // Set active heading index in sidebar outline immediately
      setActiveHeadingIndex(index)

      // Place editor focus and text selection on the heading content
      if (editor) {
        try {
          const pos = editor.view.posAtDOM(target, 0)
          if (pos !== undefined && pos >= 0) {
            const headingNode = editor.state.doc.nodeAt(pos)
            if (headingNode) {
              const startPos = pos + 1
              const endPos = pos + headingNode.nodeSize - 1
              
              // Update text selection in editor
              editor.commands.setTextSelection({ from: startPos, to: endPos })
              
              // Focus editor DOM container without default jumpy browser scroll
              const domEl = editor.view.dom as HTMLElement
              if (domEl) {
                domEl.focus({ preventScroll: true })
              }
            }
          }
        } catch (err) {
          console.warn("Could not set editor selection for heading:", err)
        }
      }
      
      // Visual feedback highlight
      target.classList.add('bg-indigo-50', 'dark:bg-indigo-950/40', 'transition-all', 'duration-500')
      setTimeout(() => {
        target.classList.remove('bg-indigo-50', 'dark:bg-indigo-950/40')
      }, 1500)
    }
  }

  // Track latest handleScroll closure to avoid stale states in the event listener
  const handleScrollRef = useRef(handleScroll)
  useEffect(() => {
    handleScrollRef.current = handleScroll
  })



  // Pagination Engine: Splits and joins pages dynamically based on client heights
  const triggerPagination = (editorInstance: any) => {
    if (paginationTimeoutRef.current) {
      clearTimeout(paginationTimeoutRef.current)
    }
    paginationTimeoutRef.current = setTimeout(() => {
      runPagination(editorInstance)
    }, 500) // 500ms typing debounce for performance
  }

  const runPagination = (editorInstance: any) => {
    if (!editorInstance || !editorInstance.view || isPaginatingRef.current) return
    isPaginatingRef.current = true

    const scale = zoomScale || 1

    try {
      const { doc } = editorInstance.state
      let tr = editorInstance.state.tr
      let hasChanged = false

      // Step 1: Flow content backwards if a page is underflowing and can receive the next page's first child
      const pageContentElements = document.querySelectorAll('.page-content')
      if (pageContentElements.length === 0) {
        isPaginatingRef.current = false
        return
      }

      const joinPositions: number[] = []
      doc.forEach((node: any, offset: number) => {
        if (offset > 0 && node.type.name === 'page') {
          joinPositions.push(offset)
        }
      })

      for (let i = 0; i < joinPositions.length; i++) {
        const pageEl = pageContentElements[i] as HTMLElement
        if (!pageEl) continue

        const pageHeight = pageEl.scrollHeight
        const clientHeight = 931
        const remainingSpace = clientHeight - pageHeight

        // If there is substantial empty space at the bottom of the page
        if (remainingSpace > 20) {
          const pos = joinPositions[i]
          const $pos = tr.doc.resolve(pos)
          const nextPageNode = $pos.nodeAfter

          if (nextPageNode && nextPageNode.childCount > 0) {
            const nextPageEl = pageContentElements[i + 1] as HTMLElement
            const firstChildDom = nextPageEl?.firstElementChild as HTMLElement
            if (firstChildDom) {
              // Measure first child height including margins
              const rect = firstChildDom.getBoundingClientRect()
              const style = window.getComputedStyle(firstChildDom)
              const marginTop = parseFloat(style.marginTop) || 0
              const marginBottom = parseFloat(style.marginBottom) || 0
              const childHeight = (rect.height / scale) + marginTop + marginBottom

              // Pull child backwards only if it fits without overflowing Page i
              if (childHeight <= remainingSpace) {
                if (nextPageNode.childCount === 1) {
                  // Join pages completely if it was the last node
                  tr = tr.join(pos)
                } else {
                  // Shift the first block to Page i by joining and splitting after it
                  const firstChildNode = nextPageNode.firstChild
                  if (firstChildNode) {
                    const size = firstChildNode.nodeSize
                    tr = tr.join(pos).split(pos - 1 + size, 1)
                  }
                }
                hasChanged = true
                break // Stop and let DOM render before doing next passes
              }
            }
          }
        }
      }

      if (hasChanged) {
        editorInstance.view.dispatch(tr.setMeta('paginating', true))
        // Schedule next pagination step to check for splits after DOM has updated
        if (paginationTimeoutRef.current) {
          clearTimeout(paginationTimeoutRef.current)
        }
        paginationTimeoutRef.current = setTimeout(() => {
          isPaginatingRef.current = false // Release lock right before execution
          runPagination(editorInstance)
        }, 150)
        return
      }

      // Step 2: Measure element heights and split overflowing pages
      for (let pageIdx = 0; pageIdx < pageContentElements.length; pageIdx++) {
        const pageEl = pageContentElements[pageIdx] as HTMLElement
        if (!pageEl) continue

        const clientHeight = 931 // Safe content area height boundary

        if (pageEl.scrollHeight > clientHeight) {
          const children = Array.from(pageEl.children) as HTMLElement[]
          let accumulatedHeight = 0
          let splitChildIdx = -1

          for (let i = 0; i < children.length; i++) {
            const child = children[i]
            const rect = child.getBoundingClientRect()
            const style = window.getComputedStyle(child)
            const marginTop = parseFloat(style.marginTop) || 0
            const marginBottom = parseFloat(style.marginBottom) || 0
            const childHeight = (rect.height > 0 ? (rect.height / scale) : 20) + marginTop + marginBottom

            accumulatedHeight += childHeight

            if (accumulatedHeight > clientHeight) {
              splitChildIdx = i
              break
            }
          }

          // Mitigate infinite looping on giant elements or first child overflows
          if (splitChildIdx === 0) {
            if (children.length > 1) {
              splitChildIdx = 1
            } else {
              // Giant single child: can't split, skip to next page to prevent freeze
              continue
            }
          }

          if (splitChildIdx !== -1) {
            const childDom = children[splitChildIdx]
            try {
              const absolutePos = editorInstance.view.posAtDOM(childDom, 0)
              if (absolutePos !== undefined) {
                const $pos = editorInstance.state.doc.resolve(absolutePos)
                const depth = Math.min($pos.depth, 2)
                const posBeforeBlock = $pos.before(depth)
                const freshTr = editorInstance.state.tr.split(posBeforeBlock, 1)
                editorInstance.view.dispatch(freshTr.setMeta('paginating', true))
                
                // Exit and schedule the next split on the next tick
                if (paginationTimeoutRef.current) {
                  clearTimeout(paginationTimeoutRef.current)
                }
                paginationTimeoutRef.current = setTimeout(() => {
                  isPaginatingRef.current = false // Release lock right before execution
                  runPagination(editorInstance)
                }, 150)
                
                setTimeout(() => {
                  updateOutline()
                  handleScroll()
                }, 150)
                
                return // Exit now to let browser recalculate DOM layout
              }
            } catch (e) {
              console.error("Error paginating split position:", e)
            }
          }
        }
      }

      // No more splits or joins needed, pagination is complete and stable
      isPaginatingRef.current = false
    } catch (err) {
      console.error("Pagination processor error:", err)
      isPaginatingRef.current = false
    }
  }

  // Screen size check for sidebars auto-collapsing & Zoom Scale calculations
  const handleResize = () => {
    const width = window.innerWidth
    if (width < 1440) {
      setSidebarOpen(false)
    } else {
      setSidebarOpen(true)
    }
    
    if (width < 1024) {
      setLeftSidebarOpen(false)
    } else {
      setLeftSidebarOpen(true)
    }

    // Trigger zoom calculation check
    calculateScale()
  }

  const calculateScale = () => {
    const container = scrollContainerRef.current
    if (!container) return
    
    // Page width is 794px. Standard desktop viewport can have vertical scrollbars and sidebars.
    // Target width of editor area including padding is 794 + 64 = 858px.
    const containerWidth = container.clientWidth
    if (containerWidth < 858) {
      const scale = (containerWidth - 32) / 794
      setZoomScale(Math.max(0.4, scale))
    } else {
      setZoomScale(1)
    }
  }

  useEffect(() => {
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Recalculate zoom when sidebars open/close as container width changes
  useEffect(() => {
    // Wait for sidebar transitions to finish before calculating final width
    const timer = setTimeout(calculateScale, 300)
    return () => clearTimeout(timer)
  }, [leftSidebarOpen, sidebarOpen])



  // Click outside handler for floating AI popup, layout settings, & export dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showFloatingPopup && popupRef.current && !popupRef.current.contains(event.target as any)) {
        const editorEl = document.querySelector('.tiptap')
        if (editorEl && !editorEl.contains(event.target as any)) {
          setShowFloatingPopup(false)
          setSimulatedAiResult('')
          setAiSelectedText('')
          setAiSelectionRange(null)
        }
      }
      if (showLayoutSettings && layoutSettingsRef.current && !layoutSettingsRef.current.contains(event.target as any)) {
        setShowLayoutSettings(false)
      }
      if (showExportMenu && exportMenuRef.current && !exportMenuRef.current.contains(event.target as any)) {
        setShowExportMenu(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showFloatingPopup, showLayoutSettings, showExportMenu])

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light'
    setTheme(nextTheme)
    localStorage.setItem('theme', nextTheme)
    document.documentElement.classList.toggle('dark', nextTheme === 'dark')
    document.documentElement.classList.toggle('light', nextTheme === 'light')
  }

  // Ref for activeProjectId to prevent stale closures inside Tiptap event handlers
  const activeProjectIdRef = useRef<string | null>(null)
  useEffect(() => {
    activeProjectIdRef.current = activeProjectId
  }, [activeProjectId])

  // Tiptap Editor configuration
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      CustomDocument,
      PageNode,
      TocItemNode,
      YabatechLogo,
      StarterKit.configure({
        document: false,
        underline: false,
        paragraph: false,
      }),
      CustomParagraph,
      TextStyle,
      FontFamily,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Underline,
      LineHeight.configure({
        types: ['paragraph', 'heading'],
        defaultLineHeight: '1.5',
      }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'tiptap focus:outline-none w-full print:w-full',
      },
    },
    onUpdate: ({ editor, transaction }) => {
      // Skip all processing and re-renders if this is a pagination-induced transaction
      if (transaction && transaction.getMeta('paginating')) {
        return
      }

      setIsSaved(false)
      
      // Hide floating popup only if we moved to a different block
      if (showFloatingPopup && popupBlockStart !== null) {
        const { $from } = editor.state.selection
        if ($from.start() !== popupBlockStart) {
          setShowFloatingPopup(false)
          setSimulatedAiResult('')
          setAiSelectedText('')
          setAiSelectionRange(null)
        }
      }
      
      // Calculate Stats
      const text = editor.getText()
      const chars = text.length
      const words = text.trim() ? text.trim().split(/\s+/).length : 0
      
      setCharCount(chars)
      setWordCount(words)
      setReadTime(Math.ceil(words / 200)) // ~200 WPM

      // Local storage draft save trigger on edit
      const contentJSON = editor.getJSON()

      if (activeProjectIdRef.current) {
        setProjects(prevProjects => {
          let updatedProj: Project | null = null
          const updated = prevProjects.map(p => {
            if (p.id === activeProjectIdRef.current) {
              updatedProj = {
                ...p,
                content: JSON.stringify(contentJSON),
                updatedAt: Date.now(),
                wordCount: words,
                charCount: chars
              }
              return updatedProj
            }
            return p
          })
          if (updatedProj) {
            saveProject(updatedProj).catch(e => console.error("Failed to auto-save project to IndexedDB", e))
          }
          return updated
        })
        setIsSaved(true)
      } else {
        localStorage.setItem('tiptap-content', JSON.stringify(contentJSON))
      }

      // Update outline dynamic values
      setTimeout(() => {
        updateOutline()
        handleScroll()
      }, 50)

      // Schedule pagination
      triggerPagination(editor)
    },
    onSelectionUpdate: ({ editor }) => {
      // Clear existing idle timer
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
      }

      const { selection } = editor.state
      const { from, to, $from } = selection

      // If selection is empty, hide the popup and return
      if (selection.empty || !editor.isFocused) {
        if (showFloatingPopup) {
          setShowFloatingPopup(false)
          setSimulatedAiResult('')
          setAiSelectedText('')
          setAiSelectionRange(null)
        }
        return
      }

      const selectedText = editor.state.doc.textBetween(from, to, ' ').trim()
      if (selectedText.length <= 3) {
        return
      }

      // Start a short delay timer (800ms) to show the popup after user completes selection
      idleTimerRef.current = setTimeout(() => {
        try {
          // Get coordinates at the end of the selection (to)
          const coords = editor.view.coordsAtPos(to)
          setPopupCoords({ top: coords.top, left: coords.left })
          setPopupContextText(selectedText)
          setPopupContextRange({ from, to })
          setPopupBlockStart($from.start())
          setShowFloatingPopup(true)
        } catch (e) {
          console.error("Failed to get coords for selection popup:", e)
        }
      }, 800)
    },
  })

  // Listen to scroll events to update current page and active outline item
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    let lastRun = 0
    let timeoutId: any = null

    const listener = () => {
      const now = Date.now()
      // Throttle to 100ms to eliminate scroll frame lag and UI stuttering
      if (now - lastRun >= 100) {
        handleScrollRef.current()
        lastRun = now
      } else {
        if (timeoutId) clearTimeout(timeoutId)
        timeoutId = setTimeout(() => {
          handleScrollRef.current()
          lastRun = Date.now()
        }, 100)
      }
    }
    
    container.addEventListener('scroll', listener)
    
    // Initial run
    setTimeout(() => {
      handleScrollRef.current()
    }, 200)

    return () => {
      container.removeEventListener('scroll', listener)
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [editor])

  // Enable scrolling with keyboard when focus is outside the editor
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const container = scrollContainerRef.current
      if (!container) return

      // Don't intercept if the user is typing in a text input or textarea
      const activeEl = document.activeElement
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        return
      }

      // If user is focused in a contenteditable (the editor), only intercept page-navigation keys
      // that don't conflict with normal typing (PageUp, PageDown, Home, End).
      const isEditable = activeEl && activeEl.getAttribute('contenteditable') === 'true'
      const isScrollKey = ['PageUp', 'PageDown', 'Home', 'End'].includes(e.key)
      if (isEditable && !isScrollKey) {
        return
      }

      // Check which key is pressed and scroll the container
      const scrollAmount = 80 // normal arrow key scroll speed
      const pageScrollAmount = container.clientHeight - 40 // page up/down scroll amount

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          container.scrollBy({ top: scrollAmount, behavior: 'auto' })
          break
        case 'ArrowUp':
          e.preventDefault()
          container.scrollBy({ top: -scrollAmount, behavior: 'auto' })
          break
        case 'PageDown':
        case ' ': // Spacebar (only when not in editor)
          if (e.key === ' ' && e.shiftKey) {
            e.preventDefault()
            container.scrollBy({ top: -pageScrollAmount, behavior: 'auto' })
          } else {
            e.preventDefault()
            container.scrollBy({ top: pageScrollAmount, behavior: 'auto' })
          }
          break
        case 'PageUp':
          e.preventDefault()
          container.scrollBy({ top: -pageScrollAmount, behavior: 'auto' })
          break
        case 'Home':
          e.preventDefault()
          container.scrollTo({ top: 0, behavior: 'auto' })
          break
        case 'End':
          e.preventDefault()
          container.scrollTo({ top: container.scrollHeight, behavior: 'auto' })
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown)
    }
  }, [])

  // Explicit mouse wheel scrolling handler to guarantee mouse wheel scroll works on pages.
  // Wheel events over .page-sheet / .page-content (overflow:hidden) do NOT bubble
  // up to the scroll container natively. We listen at window level to catch them.
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      const container = scrollContainerRef.current
      if (!container) return

      if (e.ctrlKey) return // Allow browser/system pinch-to-zoom

      // Only intercept wheel events when cursor is inside the scroll container area.
      // If the target has been detached from the DOM during rendering, we bypass the containment check.
      const target = e.target as HTMLElement
      if (target && target.ownerDocument && target.ownerDocument.body.contains(target)) {
        if (!container.contains(target) && target !== container) return
      }

      // Normalize delta values across different hardware and OS scroll settings (lines vs pixels)
      let dy = e.deltaY
      let dx = e.deltaX

      if (e.deltaMode === 1) { // DOM_DELTA_LINE
        dy *= 20
        dx *= 20
      } else if (e.deltaMode === 2) { // DOM_DELTA_PAGE
        dy *= container.clientHeight
        dx *= container.clientWidth
      }

      if (dy !== 0 || dx !== 0) {
        e.preventDefault()
        // Directly adjust scroll coordinates to allow fluid trackpad momentum and precision
        container.scrollTop += dy
        container.scrollLeft += dx
      }
    }

    // Attach to window to catch events trapped by overflow:hidden children
    window.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      window.removeEventListener('wheel', handleWheel)
    }
  }, [])

  // Touch scroll handler for touchscreen drag scrolling over pages
  useEffect(() => {
    let lastTouchY = 0
    let lastTouchX = 0

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        lastTouchY = e.touches[0].clientY
        lastTouchX = e.touches[0].clientX
      }
    }

    const handleTouchMove = (e: TouchEvent) => {
      const container = scrollContainerRef.current
      if (!container) return

      const target = e.target as HTMLElement
      if (!container.contains(target) && target !== container) return

      if (e.touches.length === 1) {
        const touchY = e.touches[0].clientY
        const touchX = e.touches[0].clientX
        const deltaY = lastTouchY - touchY
        const deltaX = lastTouchX - touchX

        if (deltaY !== 0 || deltaX !== 0) {
          if (target.closest('.page-sheet')) {
            container.scrollTop += deltaY
            container.scrollLeft += deltaX
            e.preventDefault()
          }
        }

        lastTouchY = touchY
        lastTouchX = touchX
      }
    }

    window.addEventListener('touchstart', handleTouchStart, { passive: true })
    window.addEventListener('touchmove', handleTouchMove, { passive: false })
    return () => {
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchmove', handleTouchMove)
    }
  }, [])

  // Keep totalPages in sync with the actual page count in the editor document
  const pageCount = editor ? editor.state.doc.childCount : 1
  useEffect(() => {
    if (totalPages !== pageCount) {
      setTotalPages(pageCount)
    }
  }, [pageCount, totalPages])

  // Sync headers and footers with Tiptap storage
  useEffect(() => {
    if (editor && editor.storage && (editor.storage as any).page) {
      (editor.storage as any).page.docHeader = docHeader;
      (editor.storage as any).page.docFooter = docFooter;
      
      // Trigger a dummy ProseMirror transaction to force all page node views to update labels
      const { state, view } = editor
      const tr = state.tr.setMeta('paginating', true)
      view.dispatch(tr)
    }
  }, [docHeader, docFooter, editor])

  // Load editor content on mount (multi-project active document loading)
  useEffect(() => {
    if (!editor) return

    const loadActiveContent = async () => {
      const storedActiveId = localStorage.getItem(STORAGE_KEY_ACTIVE_ID)
      let loaded = false

      if (storedActiveId) {
        try {
          // Attempt to load from the projects state first, or fallback to IndexedDB directly
          let project = projects.find(p => p.id === storedActiveId)
          if (!project) {
            const allProj = await getAllProjects()
            project = allProj.find(p => p.id === storedActiveId)
          }

          if (project) {
            editor.commands.setContent(ensurePaginatedJson(JSON.parse(project.content)))
            applyOnboardingStyles(editor)
            loaded = true
          }
        } catch (e) {
          console.error("Failed to load active project content on editor mount:", e)
        }
      }

      if (!loaded) {
        // Check for legacy single-document content
        const legacyContent = localStorage.getItem('tiptap-content')
        if (legacyContent) {
          try {
            editor.commands.setContent(ensurePaginatedJson(JSON.parse(legacyContent)))
            applyOnboardingStyles(editor)
          } catch (e) {
            editor.commands.setContent(ensurePaginatedHtml(DEFAULT_CONTENT))
          }
        } else {
          editor.commands.setContent(ensurePaginatedHtml(''))
        }
      }

      // Initial stat calculations
      setTimeout(() => {
        const text = editor.getText()
        setCharCount(text.length)
        setWordCount(text.trim() ? text.trim().split(/\s+/).length : 0)
        setReadTime(Math.ceil((text.trim() ? text.trim().split(/\s+/).length : 0) / 200))
        updateOutline()
        handleScroll()
        
        // Run pagination immediately on mount
        runPagination(editor)
      }, 150)
    }

    loadActiveContent()
  }, [editor])

  // Periodic Auto-save effect
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isSaved) {
        localStorage.setItem('docTitle', documentTitle)
        setIsSaved(true)
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [isSaved, documentTitle])

  useEffect(() => {
    return () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
      }
    }
  }, [])

  if (!editor) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 h-screen bg-zinc-50 dark:bg-zinc-950">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-zinc-600 dark:text-zinc-400 font-medium">Bootstrapping Editor...</span>
        </div>
      </div>
    )
  }

  // Formatting utility shortcuts
  const toggleBold = () => editor.chain().focus().toggleBold().run()
  const toggleItalic = () => editor.chain().focus().toggleItalic().run()
  const toggleUnderline = () => editor.chain().focus().toggleUnderline().run()
  const toggleStrike = () => editor.chain().focus().toggleStrike().run()
  const toggleCode = () => editor.chain().focus().toggleCode().run()
  const setAlignLeft = () => editor.chain().focus().setTextAlign('left').run()
  const setAlignCenter = () => editor.chain().focus().setTextAlign('center').run()
  const setAlignRight = () => editor.chain().focus().setTextAlign('right').run()
  const setAlignJustify = () => editor.chain().focus().setTextAlign('justify').run()
  const toggleBulletList = () => editor.chain().focus().toggleBulletList().run()
  const toggleOrderedList = () => editor.chain().focus().toggleOrderedList().run()
  const toggleBlockquote = () => editor.chain().focus().toggleBlockquote().run()
  const triggerUndo = () => editor.chain().focus().undo().run()
  const triggerRedo = () => editor.chain().focus().redo().run()
  const clearFormatting = () => {
    editor.chain().focus().clearContent().run()
  }

  const setHeading = (level: 1 | 2 | 3 | 0) => {
    if (level === 0) {
      editor.chain().focus().setParagraph().run()
    } else {
      editor.chain().focus().toggleHeading({ level }).run()
    }
  }

  const setFont = (fontFamily: string) => {
    if (fontFamily === 'default') {
      editor.chain().focus().unsetFontFamily().run()
    } else {
      editor.chain().focus().setFontFamily(fontFamily).run()
    }
  }

  const setLineSpacing = (height: string) => {
    editor.chain().focus().setLineHeight(height).run()
  }

  // Get active text alignment
  const getActiveAlign = () => {
    if (editor.isActive({ textAlign: 'center' })) return 'center'
    if (editor.isActive({ textAlign: 'right' })) return 'right'
    if (editor.isActive({ textAlign: 'justify' })) return 'justify'
    return 'left'
  }

  // Get active font size/type
  const getActiveHeading = () => {
    if (editor.isActive('heading', { level: 1 })) return 'h1'
    if (editor.isActive('heading', { level: 2 })) return 'h2'
    if (editor.isActive('heading', { level: 3 })) return 'h3'
    return 'p'
  }

  // Get active font family
  const getActiveFont = () => {
    const attrs = editor.getAttributes('textStyle')
    return attrs.fontFamily || 'default'
  }

  // Export options (HTML/Plain Text)
  const exportDoc = (format: 'html' | 'txt') => {
    const filename = `${documentTitle.replace(/\s+/g, '_').toLowerCase()}.${format === 'html' ? 'html' : 'txt'}`
    const content = format === 'html' ? editor.getHTML() : editor.getText()
    const blob = new Blob([content], { type: format === 'html' ? 'text/html' : 'text/plain' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = filename
    link.click()
    URL.revokeObjectURL(link.href)
  }


  // Export to PDF using browser native print engine (Fast, Searchable Vector format)
  const exportToPdfPrint = () => {
    // Find all pages, check if they have a heading with "References" or "Bibliography"
    const pages = document.querySelectorAll('.page-sheet')
    const modifiedElements: HTMLElement[] = []
    const originalHeadingsText: { el: HTMLElement; text: string }[] = []
    
    // Temporarily capitalize all headings in the editor print canvas to Title Case
    const allHeadings = document.querySelectorAll('.page-sheet h1, .page-sheet h2, .page-sheet h3, .page-sheet h4, .page-sheet h5, .page-sheet h6')
    allHeadings.forEach((h) => {
      const htmlEl = h as HTMLElement
      originalHeadingsText.push({ el: htmlEl, text: htmlEl.innerText })
      htmlEl.innerText = toTitleCase(htmlEl.innerText)
    })

    pages.forEach((page) => {
      const headings = page.querySelectorAll('h1, h2, h3, h4, h5, h6')
      let hasReferencesHeading = false
      headings.forEach((h) => {
        const text = h.textContent?.trim().toLowerCase() || ''
        if (text === 'references' || text === 'bibliography') {
          hasReferencesHeading = true
        }
      })
      
      if (hasReferencesHeading) {
        // Add class to paragraphs for APA 7th hanging indent style
        const paragraphs = page.querySelectorAll('p')
        paragraphs.forEach((p) => {
          p.classList.add('apa-reference-entry')
          modifiedElements.push(p as HTMLElement)
        })
      }
    })
    
    window.print()
    
    // Clean up classes and restore headings after print dialog opens
    setTimeout(() => {
      modifiedElements.forEach((el) => {
        el.classList.remove('apa-reference-entry')
      })
      originalHeadingsText.forEach(({ el, text }) => {
        el.innerText = text
      })
    }, 100)
  }

  const applyCoverPage = (details: typeof coverDetails) => {
    if (!editor) return
    
    const coverPageHtml = `
<div data-type="page" data-cover="true" style="page-break-after: always; break-after: page; display: flex; flex-direction: column; justify-content: space-between; height: 100%; box-sizing: border-box; text-align: center; padding: 40mm 20mm 40mm 20mm;">
  <h1 style="font-size: 24pt; font-weight: bold; text-transform: uppercase; margin-bottom: 20px; line-height: 1.3; font-family: 'Times New Roman', Times, serif; text-align: center;">${details.title}</h1>
  <p style="font-size: 14pt; margin-top: 60px; font-family: 'Times New Roman', Times, serif; text-align: center; font-weight: bold;">BY</p>
  <p style="font-size: 16pt; font-weight: bold; text-transform: uppercase; margin-bottom: 5px; font-family: 'Times New Roman', Times, serif; text-align: center;">${details.studentName}</p>
  <p style="font-size: 14pt; text-transform: uppercase; font-family: 'Times New Roman', Times, serif; text-align: center; font-weight: bold;">(${details.matricNo})</p>
  <p style="font-size: 12pt; text-transform: uppercase; line-height: 1.6; max-width: 550px; margin: 60px auto; font-family: 'Times New Roman', Times, serif; text-align: center; font-weight: bold;">
    A PROJECT REPORT SUBMITTED TO THE DEPARTMENT OF ${details.department}, FACULTY OF ${details.faculty}, ${details.institution} IN PARTIAL FULFILLMENT OF THE REQUIREMENTS FOR THE AWARD OF THE DEGREE OF BACHELOR OF SCIENCE.
  </p>
  <p style="font-size: 14pt; text-transform: uppercase; font-family: 'Times New Roman', Times, serif; text-align: center; font-weight: bold; margin-top: 60px;">SUPERVISOR: ${details.supervisorName}</p>
  <p style="font-size: 14pt; text-transform: uppercase; margin-top: 30px; font-weight: bold; font-family: 'Times New Roman', Times, serif; text-align: center;">SESSION: ${details.academicSession}</p>
  <p style="font-size: 14pt; text-transform: uppercase; font-weight: bold; font-family: 'Times New Roman', Times, serif; text-align: center;">SUBMISSION DATE: ${details.submissionDate}</p>
</div>
`
    const currentContent = editor.getHTML()
    let newContent = ''
    
    if (currentContent.includes('data-cover="true"')) {
      const parser = new DOMParser()
      const doc = parser.parseFromString(currentContent, 'text/html')
      const firstPage = doc.body.querySelector('div[data-type="page"]')
      if (firstPage && firstPage.getAttribute('data-cover') === 'true') {
        const tempDiv = doc.createElement('div')
        tempDiv.innerHTML = coverPageHtml.trim()
        const newCoverPage = tempDiv.firstElementChild
        if (newCoverPage) {
          doc.body.replaceChild(newCoverPage, firstPage)
        }
      }
      newContent = doc.body.innerHTML
    } else {
      newContent = coverPageHtml + currentContent
    }
    
    editor.commands.setContent(newContent)
    setIsSaved(false)
    setShowCoverPageModal(false)

    setTimeout(() => {
      runPagination(editor)
      updateOutline()
    }, 100)
  }

  const generateTableOfContents = () => {
    if (!editor) return

    const pageSheets = document.querySelectorAll('.page-sheet')
    const items: { text: string; level: number; page: number }[] = []

    pageSheets.forEach((pageSheet) => {
      const pageIndexAttr = pageSheet.getAttribute('data-page-index')
      let pageNum = 1
      if (pageIndexAttr !== null) {
        pageNum = parseInt(pageIndexAttr) + 1
      }

      const headings = pageSheet.querySelectorAll('.page-content h1, .page-content h2, .page-content h3, .page-content h4, .page-content h5, .page-content h6')
      headings.forEach((h) => {
        const text = h.textContent?.trim() || ''
        const level = parseInt(h.tagName.substring(1))
        
        if (text.toLowerCase() === 'table of contents') return

        items.push({
          text,
          level,
          page: pageNum
        })
      })
    })

    if (items.length === 0) {
      alert('No headings found in the document to generate a Table of Contents.')
      return
    }

    let tocItemsHtml = ''
    items.forEach((item) => {
      tocItemsHtml += `
<p data-type="toc-item" data-level="${item.level}" data-page="${item.page}">${toTitleCase(item.text)}</p>
`
    })

    const tocPageHtml = `
<div data-type="page" data-toc="true" style="page-break-after: always; break-after: page;">
  <h2 style="text-align: center; font-weight: bold; font-size: 18pt; margin-bottom: 30px; font-family: 'Times New Roman', Times, serif; text-transform: uppercase;">Table of Contents</h2>
  ${tocItemsHtml}
</div>
`

    const currentHtml = editor.getHTML()
    const parser = new DOMParser()
    const doc = parser.parseFromString(currentHtml, 'text/html')
    
    const existingToc = doc.body.querySelector('div[data-toc="true"]')
    if (existingToc) {
      const tempDiv = doc.createElement('div')
      tempDiv.innerHTML = tocPageHtml.trim()
      const newTocElement = tempDiv.firstElementChild
      if (newTocElement) {
        doc.body.replaceChild(newTocElement, existingToc)
      }
    } else {
      const existingCover = doc.body.querySelector('div[data-cover="true"]')
      const tempDiv = doc.createElement('div')
      tempDiv.innerHTML = tocPageHtml.trim()
      const newTocElement = tempDiv.firstElementChild
      
      if (newTocElement) {
        if (existingCover && existingCover.nextElementSibling) {
          doc.body.insertBefore(newTocElement, existingCover.nextElementSibling)
        } else if (existingCover) {
          doc.body.appendChild(newTocElement)
        } else {
          doc.body.insertBefore(newTocElement, doc.body.firstElementChild)
        }
      }
    }

    editor.commands.setContent(doc.body.innerHTML)
    setIsSaved(false)
    
    setTimeout(() => {
      runPagination(editor)
      updateOutline()
    }, 100)
  }

  // Clear the document completely, leaving it with a blank document (one blank page)
  const clearDocument = () => {
    if (!editor) return
    if (window.confirm('Are you sure you want to clear the entire document? This will wipe out all content and pages.')) {
      editor.commands.setContent('<div data-type="page"><p></p></div>')
      setDocumentTitle('Untitled Document')
      setIsSaved(false)
    }
  }

  // Export to Word Document (.docx) using docx.js (dynamic load)
  const exportToDocx = async () => {
    setLoadingMessage('Compiling Word Document...')
    setIsExporting(true)
    try {
      const docx = await import('docx')
      const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, TabStopType, LeaderType, PageBreak } = docx

      const json = editor.getJSON()
      const pages = json.content || []
      const children: any[] = []

      // Helper to map alignments
      const getAlignment = (align?: string) => {
        if (align === 'center') return AlignmentType.CENTER
        if (align === 'right') return AlignmentType.RIGHT
        if (align === 'justify') return AlignmentType.JUSTIFIED
        return AlignmentType.LEFT
      }

      // Helper to map headings
      const getHeadingLevel = (level: number) => {
        if (level === 1) return HeadingLevel.HEADING_1
        if (level === 2) return HeadingLevel.HEADING_2
        if (level === 3) return HeadingLevel.HEADING_3
        return undefined
      }

      let inReferencesSection = false
      pages.forEach((pageNode: any, pageIdx: number) => {
        if (pageNode.type !== 'page') return
        const isCover = pageNode.attrs?.cover === 'true' || pageNode.attrs?.cover === true
        const isToc = pageNode.attrs?.toc === 'true' || pageNode.attrs?.toc === true
        const nodes = pageNode.content || []

        nodes.forEach((node: any) => {
          const align = isCover ? AlignmentType.CENTER : getAlignment(node.attrs?.textAlign)

          if (node.type === 'tocItem') {
            const level = node.attrs?.level || 1
            const pageNum = node.attrs?.page || 1
            const headingText = (node.content || []).map((c: any) => c.text || '').join('')
            
            // Indent subheadings in Word
            const indentLeft = (level - 1) * 360
            
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: headingText,
                    bold: level === 1,
                    font: 'Times New Roman'
                  }),
                  new TextRun("\t"),
                  new TextRun({
                    text: pageNum.toString(),
                    bold: level === 1,
                    font: 'Times New Roman'
                  })
                ],
                indent: indentLeft > 0 ? { left: indentLeft } : undefined,
                tabStops: [
                  {
                    type: TabStopType.RIGHT,
                    position: 9000,
                    leader: LeaderType.DOT
                  }
                ],
                spacing: { after: 120, line: 360 }
              })
            )
          } else if (node.type === 'heading') {
            const level = node.attrs?.level || 1
            const headingText = (node.content || []).map((c: any) => c.text || '').join('').trim().toLowerCase()
            if (headingText === 'references' || headingText === 'bibliography') {
              inReferencesSection = true
            } else {
              inReferencesSection = false
            }

            const runs = (node.content || []).map((childNode: any) => {
              const marks = childNode.marks || []
              return new TextRun({
                text: toTitleCase(childNode.text || ''),
                bold: true,
                color: "000000", // black / uncolored
                italics: marks.some((m: any) => m.type === 'italic'),
                underline: marks.some((m: any) => m.type === 'underline') ? {} : undefined,
                strike: marks.some((m: any) => m.type === 'strike'),
                font: 'Times New Roman'
              })
            })

            children.push(
              new Paragraph({
                children: runs,
                heading: getHeadingLevel(level),
                alignment: align,
                spacing: { before: 240, after: 120, line: 360 }
              })
            )
          } else if (node.type === 'paragraph') {
            const runs = (node.content || []).map((childNode: any) => {
              const marks = childNode.marks || []
              return new TextRun({
                text: childNode.text || '',
                bold: marks.some((m: any) => m.type === 'bold') || isCover,
                italics: marks.some((m: any) => m.type === 'italic'),
                underline: marks.some((m: any) => m.type === 'underline') ? {} : undefined,
                strike: marks.some((m: any) => m.type === 'strike'),
                font: 'Times New Roman'
              })
            })

            let spacingBefore = 0
            let spacingAfter = 120
            if (isCover) {
              const textContent = (node.content || []).map((c: any) => c.text || '').join('').trim().toLowerCase()
              if (textContent.includes('submitted to') || textContent.includes('partial fulfillment')) {
                spacingBefore = 960
                spacingAfter = 960
              } else if (textContent.startsWith('supervisor:')) {
                spacingBefore = 960
              } else if (textContent.startsWith('by') || textContent.startsWith('session:') || textContent.startsWith('submission date:')) {
                spacingBefore = 480
              }
            }

            children.push(
              new Paragraph({
                children: runs,
                alignment: align,
                indent: inReferencesSection ? { left: 720, hanging: 720 } : undefined,
                spacing: { before: spacingBefore, after: spacingAfter, line: 360 }
              })
            )
          } else if (node.type === 'bulletList' || node.type === 'orderedList') {
            const isOrdered = node.type === 'orderedList'
            node.content?.forEach((listItem: any) => {
              listItem.content?.forEach((listItemPara: any) => {
                const runs = (listItemPara.content || []).map((childNode: any) => {
                  const marks = childNode.marks || []
                  return new TextRun({
                    text: childNode.text || '',
                    bold: marks.some((m: any) => m.type === 'bold'),
                    italics: marks.some((m: any) => m.type === 'italic'),
                    underline: marks.some((m: any) => m.type === 'underline') ? {} : undefined,
                    font: 'Times New Roman'
                  })
                })

                children.push(
                  new Paragraph({
                    children: runs,
                    bullet: isOrdered ? undefined : { level: 0 },
                    indent: isOrdered ? { left: 720 } : undefined,
                    spacing: { after: 80, line: 360 }
                  })
                )
              })
            })
          } else if (node.type === 'blockquote') {
            const runs: any[] = []
            node.content?.forEach((p: any) => {
              p.content?.forEach((childNode: any) => {
                runs.push(
                  new TextRun({
                    text: childNode.text || '',
                    italics: true,
                    color: '52525b', // Zinc 600
                    font: 'Times New Roman'
                  })
                )
              })
            })

            children.push(
              new Paragraph({
                children: runs,
                indent: { left: 720 },
                spacing: { before: 120, after: 120, line: 360 }
              })
            )
          }
        })

        if (pageIdx < pages.length - 1) {
          children.push(
            new Paragraph({
              children: [new PageBreak()]
            })
          )
        }
      })

      const doc = new Document({
        sections: [
          {
            properties: {},
            headers: {
              default: new docx.Header({
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: docHeader || "WordPI Document Draft",
                        size: 18, // 9pt (half-points in docx)
                        color: "71717a", // Zinc 500
                        font: "Times New Roman"
                      })
                    ],
                    alignment: AlignmentType.RIGHT,
                    spacing: { after: 120, line: 360 }
                  })
                ]
              })
            },
            footers: {
              default: new docx.Footer({
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: docFooter ? `${docFooter} | ` : "Page ",
                        size: 18,
                        color: "71717a",
                        font: "Times New Roman"
                      }),
                      new TextRun({
                        children: [docx.PageNumber.CURRENT],
                        size: 18,
                        color: "71717a",
                        font: "Times New Roman"
                      })
                    ],
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 120, line: 360 }
                  })
                ]
              })
            },
            children: children,
          },
        ],
      })

      const blob = await Packer.toBlob(doc)
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `${documentTitle.replace(/\s+/g, '_').toLowerCase()}.docx`
      link.click()
      URL.revokeObjectURL(link.href)
    } catch (err: any) {
      console.error('Word export error:', err)
      alert(`Failed to export Word document: ${err.message || err}`)
    } finally {
      setIsExporting(false)
    }
  }

  // Export to PowerPoint Presentation (.pptx) using pptxgenjs (dynamic load)
  const exportToPptx = async () => {
    if (!editor) {
      alert('Editor is not initialized yet.')
      return
    }

    setLoadingMessage('Compiling PowerPoint Slides...')
    setIsExporting(true)
    try {
      const pptxgen = (await import('pptxgenjs')).default
      const pptx = new pptxgen()
      pptx.layout = 'LAYOUT_16x9'

      // 1. ADD TITLE SLIDE
      const titleSlide = pptx.addSlide()
      titleSlide.addShape('rect' as any, {
        x: 0,
        y: 0,
        w: '100%',
        h: '100%',
        fill: { color: '0f172a' } // Slate 900
      })

      // Elegant horizontal line accent above subtitle
      titleSlide.addShape('rect' as any, {
        x: 4.66,
        y: 4.2,
        w: 4.0,
        h: 0.04,
        fill: { color: '6366f1' } // Indigo 500
      })

      titleSlide.addText(documentTitle || 'Academic Presentation', {
        x: 0.8,
        y: 2.0,
        w: 11.73,
        h: 2.0,
        fontSize: 36,
        bold: true,
        color: 'FFFFFF',
        align: 'center',
        fontFace: 'Arial'
      })

      const subtitleText = `Generated on ${new Date().toLocaleDateString()}\nDocsAI Research Platform`
      titleSlide.addText(subtitleText, {
        x: 0.8,
        y: 4.5,
        w: 11.73,
        h: 1.5,
        fontSize: 16,
        color: '94a3b8', // Slate 400
        align: 'center',
        fontFace: 'Arial'
      })

      // 2. PARSE PAGES INTO SECTIONS
      interface SlideContentItem {
        type: 'bullet' | 'number' | 'paragraph' | 'blockquote'
        text: string
      }

      interface SlideSection {
        title: string
        items: SlideContentItem[]
      }

      const json = editor.getJSON()
      const pages = json.content || []
      const sections: SlideSection[] = []
      let currentSection: SlideSection = { title: 'Overview', items: [] }

      pages.forEach((pageNode: any) => {
        if (pageNode.type !== 'page') return
        const nodes = pageNode.content || []

        nodes.forEach((node: any) => {
          if (node.type === 'heading' && (node.attrs?.level === 1 || node.attrs?.level === 2 || node.attrs?.level === 3)) {
            const headingText = node.content?.map((c: any) => c.text).join('') || ''
            if (headingText.trim()) {
              if (currentSection.items.length > 0 || currentSection.title !== 'Overview') {
                sections.push(currentSection)
                currentSection = { title: headingText.trim(), items: [] }
              } else {
                currentSection.title = headingText.trim()
              }
            }
          } else if (node.type === 'bulletList' || node.type === 'orderedList') {
            const isOrdered = node.type === 'orderedList'
            node.content?.forEach((listItem: any) => {
              let itemText = ''
              if (listItem.content) {
                itemText = listItem.content.map((p: any) => {
                  if (p.content) {
                    return p.content.map((t: any) => t.text).join('')
                  }
                  return p.text || ''
                }).join('\n')
              } else {
                itemText = listItem.text || ''
              }
              if (itemText.trim()) {
                currentSection.items.push({
                  type: isOrdered ? 'number' : 'bullet',
                  text: itemText.trim()
                })
              }
            })
          } else if (node.type === 'blockquote') {
            let quoteText = ''
            if (node.content) {
              quoteText = node.content.map((p: any) => {
                if (p.content) {
                  return p.content.map((t: any) => t.text).join('')
                }
                return p.text || ''
              }).join('\n')
            } else {
              quoteText = node.text || ''
            }
            if (quoteText.trim()) {
              currentSection.items.push({
                type: 'blockquote',
                text: quoteText.trim()
              })
            }
          } else if (node.type === 'paragraph') {
            const paraText = node.content?.map((c: any) => c.text).join('') || ''
            if (paraText.trim()) {
              currentSection.items.push({
                type: 'paragraph',
                text: paraText.trim()
              })
            }
          }
        })
      })

      // Push final section
      if (currentSection.items.length > 0 || currentSection.title !== 'Overview') {
        sections.push(currentSection)
      }

      // 3. GENERATE SEPARATE SLIDES FROM SECTIONS WITHOUT CHUNKING OR MERGING
      sections.forEach((section) => {
        const slide = pptx.addSlide()

        // Subtle slate-50 background for content slides
        slide.addShape('rect' as any, {
          x: 0,
          y: 0,
          w: '100%',
          h: '100%',
          fill: { color: 'f8fafc' } // Slate 50
        })

        // Left accent vertical bar next to slide title
        slide.addShape('rect' as any, {
          x: 0.6,
          y: 0.5,
          w: 0.1,
          h: 0.7,
          fill: { color: '4f46e5' } // Indigo 600
        })

        slide.addText(toTitleCase(section.title), {
          x: 0.9,
          y: 0.5,
          w: 11.5,
          h: 0.7,
          fontSize: 24,
          bold: true,
          color: '000000', // uncolored (black)
          fontFace: 'Arial',
          valign: 'middle'
        })

        // Separator line under title
        slide.addShape('rect' as any, {
          x: 0.6,
          y: 1.3,
          w: 12.13,
          h: 0.02,
          fill: { color: 'e2e8f0' } // Slate 200
        })

        const itemCount = section.items.length
        // Determine font size and line spacing based on the number of items to scale appropriately
        let fontSize = 15
        let lineSpacing = 22
        if (itemCount <= 3) {
          fontSize = 18
          lineSpacing = 28
        } else if (itemCount === 4) {
          fontSize = 16
          lineSpacing = 24
        } else if (itemCount === 5) {
          fontSize = 14
          lineSpacing = 22
        } else if (itemCount <= 7) {
          fontSize = 12
          lineSpacing = 18
        } else {
          fontSize = 10
          lineSpacing = 14
        }

        if (itemCount > 0) {
          const textPropsArray: any[] = section.items.map((item, idx) => {
            const isLast = idx === itemCount - 1
            const spacing = isLast ? "" : (item.type === 'paragraph' || item.type === 'blockquote' ? "\n\n" : "\n")
            
            if (item.type === 'bullet') {
              return {
                text: item.text + spacing,
                options: {
                  bullet: true,
                  fontSize: fontSize,
                  color: '334155', // Slate 700
                  fontFace: 'Arial',
                  lineSpacing: lineSpacing
                }
              }
            } else if (item.type === 'number') {
              return {
                text: item.text + spacing,
                options: {
                  bullet: { type: 'number' },
                  fontSize: fontSize,
                  color: '334155', // Slate 700
                  fontFace: 'Arial',
                  lineSpacing: lineSpacing
                }
              }
            } else if (item.type === 'blockquote') {
              return {
                text: `“ ${item.text} ”` + spacing,
                options: {
                  italic: true,
                  fontSize: fontSize,
                  color: '4f46e5', // Indigo 600
                  fontFace: 'Arial',
                  lineSpacing: Math.max(12, lineSpacing - 2)
                }
              }
            } else { // paragraph
              return {
                text: item.text + spacing,
                options: {
                  fontSize: fontSize,
                  color: '0f172a', // Slate 900
                  fontFace: 'Arial',
                  lineSpacing: lineSpacing
                }
              }
            }
          })

          slide.addText(textPropsArray, {
            x: 0.8,
            y: 1.7,
            w: 11.7,
            h: 4.8,
            valign: 'top'
          })
        } else {
          slide.addText("No content in this section.", {
            x: 0.8,
            y: 1.7,
            w: 11.7,
            h: 4.8,
            fontSize: 14,
            italic: true,
            color: '94a3b8',
            valign: 'top'
          })
        }

        // Small footer
        slide.addText(`DocsAI | ${documentTitle}`, {
          x: 0.8,
          y: 6.9,
          w: 10.0,
          h: 0.3,
          fontSize: 10,
          color: '94a3b8',
          fontFace: 'Arial'
        })
      })

      // 4. ADD CLOSING SLIDE
      const closingSlide = pptx.addSlide()
      closingSlide.addShape('rect' as any, {
        x: 0,
        y: 0,
        w: '100%',
        h: '100%',
        fill: { color: '0f172a' } // Slate 900
      })

      closingSlide.addText('Thank You', {
        x: 0.8,
        y: 2.5,
        w: 11.73,
        h: 1.2,
        fontSize: 44,
        bold: true,
        color: 'FFFFFF',
        align: 'center',
        fontFace: 'Arial'
      })

      closingSlide.addShape('rect' as any, {
        x: 4.66,
        y: 3.9,
        w: 4.0,
        h: 0.04,
        fill: { color: '6366f1' }
      })

      closingSlide.addText('End of Presentation', {
        x: 0.8,
        y: 4.2,
        w: 11.73,
        h: 1.0,
        fontSize: 18,
        color: '94a3b8',
        align: 'center',
        fontFace: 'Arial'
      })

      await pptx.writeFile({ fileName: `${documentTitle.replace(/\s+/g, '_').toLowerCase()}.pptx` })
    } catch (err: any) {
      console.error('PPTX export error:', err)
      alert(`Failed to export PowerPoint: ${err.message || err}`)
    } finally {
      setIsExporting(false)
    }
  }

  // Import document file (.docx or .pdf) dynamically using mammoth or pdfjs-dist
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setLoadingMessage('Importing and Parsing File...')
    setIsExporting(true)
    try {
      const extension = file.name.split('.').pop()?.toLowerCase()
      if (extension === 'docx') {
        const mammoth = await import('mammoth')
        const arrayBuffer = await file.arrayBuffer()
        const result = await mammoth.convertToHtml({ arrayBuffer })
        
        setImportFileData({
          name: file.name,
          htmlContent: result.value,
          extension: 'docx'
        })
        setImportOption('maintain')
        setShowImportModal(true)
      } else if (extension === 'pdf') {
        // Renders PDF text content extracted from pdfjs-dist
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`
        
        const arrayBuffer = await file.arrayBuffer()
        const loadingTask = pdfjs.getDocument({ data: arrayBuffer })
        const pdf = await loadingTask.promise
        
        let accumulatedHtml = ''
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const textContent = await page.getTextContent()
          const pageStrings = textContent.items.map((item: any) => item.str).join(' ')
          accumulatedHtml += `<p>${pageStrings}</p>`
        }
        
        setImportFileData({
          name: file.name,
          htmlContent: accumulatedHtml,
          extension: 'pdf'
        })
        setImportOption('maintain')
        setShowImportModal(true)
      } else {
        alert('Unsupported document format. Please upload a .docx or .pdf file.')
      }
    } catch (err: any) {
      console.error('File import failure:', err)
      alert(`Failed to import document: ${err.message || err}`)
    } finally {
      setIsExporting(false)
      // Reset input element value to allow re-upload of same file
      if (e.target) e.target.value = ''
    }
  }

  const confirmImportAction = () => {
    if (!importFileData || !editor) return

    let contentToLoad = importFileData.htmlContent

    // 1. If Text Only option is selected, strip all HTML formatting tags
    if (importOption === 'text_only') {
      const tempDiv = document.createElement('div')
      tempDiv.innerHTML = importFileData.htmlContent
      const paragraphs = (tempDiv.textContent || tempDiv.innerText || '')
        .split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0)
      
      contentToLoad = paragraphs.map(p => `<p>${p}</p>`).join('')
    }

    // 2. Load the content into Tiptap
    editor.commands.setContent(ensurePaginatedHtml(contentToLoad))
    setIsSaved(false)

    // 3. Apply Style Formats
    if (importOption === 'seminar') {
      // Apply Arial, 1.5 line height
      setTimeout(() => {
        editor.chain().focus().selectAll().setFontFamily('arial').setLineHeight('1.5').run()
        runPagination(editor)
      }, 100)
    } else if (importOption === 'apa') {
      // Apply Playfair (academic serif), 2.0 line height
      setTimeout(() => {
        editor.chain().focus().selectAll().setFontFamily('playfair').setLineHeight('2.0').run()
        runPagination(editor)
      }, 100)
    } else if (importOption === 'ieee') {
      // Apply Arial, 1.0 line height
      setTimeout(() => {
        editor.chain().focus().selectAll().setFontFamily('arial').setLineHeight('1.0').run()
        runPagination(editor)
      }, 100)
    } else {
      // Maintain default/custom original layout, run pagination to lay out pages
      setTimeout(() => {
        runPagination(editor)
      }, 100)
    }

    // Set Document Title
    const cleanName = importFileData.name.replace(/\.[^/.]+$/, "")
    setDocumentTitle(cleanName)

    // Clean up states
    setShowImportModal(false)
    setImportFileData(null)
  }

  // Phase 2 AI Prompt execution (Streams response from WordPI AI route proxy)
  const handleAiAction = async (action: string) => {
    setIsSimulatingAI(true)
    setSimulatedAiResult('')
    setActiveAiModel('')
    
    // Select editor text if highlighted to provide context
    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to, ' ')

    if (from !== to) {
      setAiSelectedText(selectedText)
      setAiSelectionRange({ from, to })
    } else {
      setAiSelectedText('')
      setAiSelectionRange(null)
    }

    let promptText = ''
    if (action === 'intro') {
      promptText = 'Generate a detailed academic introductory segment (Chapter 1) for a research project on this topic. Return the content styled with standard HTML tags like <h2>, <h3>, and <p>.'
    } else if (action === 'rephrase') {
      if (!selectedText) {
        alert('Please highlight some text in the document first to rephrase!')
        setIsSimulatingAI(false)
        return
      }
      promptText = `Rephrase the highlighted text to sound highly academic, formal, and authoritative. Return only the revised text enclosed in HTML <p> tags: "${selectedText}"`
    } else if (action === 'humanize') {
      if (!selectedText) {
        alert('Please highlight some text in the document first to humanize!')
        setIsSimulatingAI(false)
        return
      }
      promptText = 
        `You are a professional academic copyeditor specializing in bypassing AI detection. ` +
        `Rewrite the highlighted text below to look 100% human-written, ensuring it easily passes Turnitin AI, GPTZero, and other AI detectors.\n\n` +
        `Follow these strict rules:\n` +
        `- BURSTINESS: Aggressively mix short, punchy sentences (5-10 words) with long, complex analytical clauses (30-40 words).\n` +
        `- PERPLEXITY: Use varied, natural academic vocabulary. Eliminate all typical AI clichés and robotic transitions like 'furthermore', 'moreover', 'consequently', 'subsequently', 'in addition', 'delve', 'tapestry', 'testament to', 'beacon of'.\n` +
        `- GRAMMAR VARIATION: Do not start consecutive sentences with the same grammatical structure (e.g. avoid starting sentences with identical transitional adverbs or gerunds).\n` +
        `- Keep all original citations (e.g., APA/IEEE formatting) and factual claims intact.\n` +
        `- Return ONLY the rewritten text, formatted in standard HTML <p> tags.\n\n` +
        `Text to humanize:\n"${selectedText}"`
    } else if (action === 'outline') {
      promptText = 'Generate a comprehensive academic thesis outline (Chapters 1 to 5) with subheadings formatted in structured HTML lists (<ul>/<li>).'
    } else {
      promptText = aiPrompt
    }

    try {
      // Build optimized context to save tokens and improve relevance
      let documentContext = ''
      let contextLocationText = 'Cursor Sliding Window'

      // Parse prompt for page/section location targets
      const pageMatch = promptText.match(/(?:page\s+|p\.\s*)(\d+)/i)
      const sectionMatch = promptText.match(/(?:section\s+|sec\.\s*|chapter\s+)(\d+\.\d+|\d+)/i)

      if (selectedText) {
        documentContext = selectedText
        contextLocationText = 'Highlighted Selection'
      } else if (pageMatch) {
        const pageNum = parseInt(pageMatch[1])
        const targetPageIdx = pageNum - 1
        let pageText = ''
        let count = 0
        
        editor.state.doc.forEach((node) => {
          if (node.type.name === 'page') {
            if (count === targetPageIdx) {
              pageText = node.textContent
            }
            count++
          }
        })

        if (pageText) {
          documentContext = pageText
          contextLocationText = `Page ${pageNum}`
        } else {
          // Fallback to cursor sliding window
          const { state } = editor
          const { from } = state.selection
          const startPos = Math.max(0, from - 2000)
          const endPos = Math.min(state.doc.content.size, from + 1000)
          documentContext = state.doc.textBetween(startPos, endPos, ' ')
          contextLocationText = `Cursor Sliding Window (Page ${pageNum} not found)`
        }
      } else if (sectionMatch) {
        const sectionNum = sectionMatch[1]
        let headingText = ''
        let sectionText = ''
        let capture = false
        
        editor.state.doc.descendants((node) => {
          if (node.type.name === 'heading') {
            const hText = node.textContent
            if (hText.toLowerCase().includes(sectionNum.toLowerCase()) || 
                hText.toLowerCase().replace(/[^a-z0-9]/g, '').includes(sectionNum.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
              headingText = hText
              capture = true
              sectionText = '' // Reset and capture from here
            } else if (capture) {
              capture = false // Stop capturing on next heading
            }
          } else if (capture && node.isTextblock) {
            sectionText += node.textContent + '\n'
          }
          return true
        })

        if (sectionText.trim()) {
          documentContext = `Heading: ${headingText}\nContent:\n${sectionText}`
          contextLocationText = `Section ${sectionNum}`
        } else {
          // Fallback to cursor sliding window
          const { state } = editor
          const { from } = state.selection
          const startPos = Math.max(0, from - 2000)
          const endPos = Math.min(state.doc.content.size, from + 1000)
          documentContext = state.doc.textBetween(startPos, endPos, ' ')
          contextLocationText = `Cursor Sliding Window (Section ${sectionNum} not found)`
        }
      } else {
        // Extract cursor-centered sliding window: 2000 chars before, 1000 chars after cursor position
        const { state } = editor
        const { selection } = state
        const { from } = selection
        const startPos = Math.max(0, from - 2000)
        const endPos = Math.min(state.doc.content.size, from + 1000)
        documentContext = state.doc.textBetween(startPos, endPos, ' ')
      }

      let unifiedContext = documentContext
      if (projectSources.length > 0) {
        // Pre-chunk all ingested sources to support local retrieval
        const allChunks = projectSources.flatMap(s => 
          chunkDocument(s.name, s.content.replace(/<[^>]*>/g, ''))
        )
        // Retrieve top 3 most relevant source chunks matching the user's prompt text
        const relevantChunks = retrieveRelevantChunks(promptText, allChunks, 3)
        
        if (relevantChunks.length > 0) {
          const sourcesText = relevantChunks
            .map(c => `[Source Research File: ${c.sourceName}]\n... ${c.text} ...`)
            .join('\n\n')
          unifiedContext = `Relevant Ingested Source Excerpts:\n\"\"\"\n${sourcesText}\n\"\"\"\n\nDocument Context [${contextLocationText}]:\n\"\"\"\n${documentContext}\n\"\"\"`
        } else {
          unifiedContext = `Document Context [${contextLocationText}]:\n\"\"\"\n${documentContext}\n\"\"\"`
        }
      } else {
        unifiedContext = `Document Context [${contextLocationText}]:\n\"\"\"\n${documentContext}\n\"\"\"`
      }

      const activeProject = projects.find(p => p.id === activeProjectId)
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptText,
          context: unifiedContext,
          academicLevel: activeProject?.academicLevel || wizardAcademicLevel || 'Undergraduate',
          documentType: activeProject?.documentType || wizardDocType || 'Custom',
          modelTarget: aiEngine
        })
      })

      if (!response.ok) {
        let errMsg = 'Failed to generate content.'
        try {
          const errorData = await response.json()
          errMsg = errorData.error || errMsg
        } catch (e) {
          errMsg = `Server Error (${response.status}): ${response.statusText}`
        }
        setSimulatedAiResult(`<p class="text-red-500 font-semibold">API Error: ${errMsg}</p>`)
        setIsSimulatingAI(false)
        return
      }

      const reader = response.body?.getReader()
      if (!reader) {
        setSimulatedAiResult('<p class="text-red-500 font-semibold">Error: Failed to open response stream reader.</p>')
        setIsSimulatingAI(false)
        return
      }

      const decoder = new TextDecoder()
      let accumulatedText = ''
      let detectedOriginalMode = false

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        // Split chunk into Server-Sent Event lines
        const lines = chunk.split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim()
            if (dataStr === '[DONE]') {
              break
            }
            try {
              const data = JSON.parse(dataStr)
              if (data.meta?.model) {
                setActiveAiModel(data.meta.model)
              } else if (data.error) {
                accumulatedText += `<p class="text-red-500 font-semibold">${data.error}</p>`
              } else if (data.text) {
                accumulatedText += data.text
              }

              // Call our robust parser
              const parsed = parseStreamingReplacement(accumulatedText)
              if (parsed.isReplacementMode) {
                detectedOriginalMode = true
                if (parsed.originalText) {
                  setAiSelectedText(parsed.originalText)
                  const range = findTextRange(editor, parsed.originalText)
                  if (range) {
                    setAiSelectionRange(range)
                    editor.chain().setTextSelection(range).scrollIntoView().run()
                  }
                }
                setSimulatedAiResult(parsed.replacementText)
              } else if (!detectedOriginalMode) {
                setSimulatedAiResult(accumulatedText)
              }
            } catch (e) {
              // Handle partial JSON chunk splits
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Streaming API failure:', error)
      setSimulatedAiResult(`<p class="text-red-500 font-semibold">Network Error: ${error.message || 'Could not connect to generator proxy.'}</p>`)
    } finally {
      setIsSimulatingAI(false)
    }
  }

  const insertAiContent = () => {
    if (simulatedAiResult) {
      const formatted = formatAiResponseToHtml(simulatedAiResult)
      editor.chain().focus().insertContent(formatted).run()
      setSimulatedAiResult('')
      setAiPrompt('')
      setAiSelectedText('')
      setAiSelectionRange(null)
    }
  }

  const replaceSelectionContent = () => {
    if (simulatedAiResult) {
      const formatted = formatAiResponseToHtml(simulatedAiResult)
      if (aiSelectionRange) {
        editor.chain().focus().setTextSelection(aiSelectionRange).insertContent(formatted).run()
      } else {
        editor.chain().focus().insertContent(formatted).run()
      }
      setSimulatedAiResult('')
      setAiPrompt('')
      setAiSelectedText('')
      setAiSelectionRange(null)
    }
  }

  const discardAiContent = () => {
    setSimulatedAiResult('')
    setAiPrompt('')
    setAiSelectedText('')
    setAiSelectionRange(null)
  }

  const handlePopupAiAction = async (presetPrompt?: string) => {
    const finalPrompt = presetPrompt || popupPrompt
    if (!finalPrompt.trim()) return

    setIsSimulatingAI(true)
    setSimulatedAiResult('')
    setActiveAiModel('')
    
    if (popupContextRange) {
      setAiSelectionRange(popupContextRange)
      setAiSelectedText(popupContextText)
    }

    const promptText = `Rewrite or edit the following text context as requested: "${finalPrompt}". Return ONLY the revised version of this paragraph/sentence, styled with standard HTML if needed.`

    try {
      // Build optimized context to save tokens and improve relevance
      let unifiedContext = popupContextText
      if (projectSources.length > 0) {
        // Pre-chunk all ingested sources to support local retrieval
        const allChunks = projectSources.flatMap(s => 
          chunkDocument(s.name, s.content.replace(/<[^>]*>/g, ''))
        )
        // Retrieve top 3 most relevant source chunks matching the rewrite request query
        const relevantChunks = retrieveRelevantChunks(promptText, allChunks, 3)
        
        if (relevantChunks.length > 0) {
          const sourcesText = relevantChunks
            .map(c => `[Source Research File: ${c.sourceName}]\n... ${c.text} ...`)
            .join('\n\n')
          unifiedContext = `Relevant Ingested Source Excerpts:\n\"\"\"\n${sourcesText}\n\"\"\"\n\nText Context to Edit:\n\"\"\"\n${popupContextText}\n\"\"\"`
        }
      }

      const activeProject = projects.find(p => p.id === activeProjectId)
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptText,
          context: unifiedContext,
          academicLevel: activeProject?.academicLevel || wizardAcademicLevel || 'Undergraduate',
          documentType: activeProject?.documentType || wizardDocType || 'Custom',
          modelTarget: aiEngine
        })
      })

      if (!response.ok) {
        let errMsg = 'Failed.'
        try {
          const errorData = await response.json()
          errMsg = errorData.error || errMsg
        } catch (e) {
          errMsg = `Server Error (${response.status}): ${response.statusText}`
        }
        setSimulatedAiResult(`<p class="text-red-500 font-semibold">API Error: ${errMsg}</p>`)
        setIsSimulatingAI(false)
        return
      }

      const reader = response.body?.getReader()
      if (!reader) {
        setSimulatedAiResult('<p class="text-red-500 font-semibold">Error: Stream reader failed.</p>')
        setIsSimulatingAI(false)
        return
      }

      const decoder = new TextDecoder()
      let accumulatedText = ''
      let detectedOriginalMode = false

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim()
            if (dataStr === '[DONE]') {
              break
            }
            try {
              const data = JSON.parse(dataStr)
              if (data.meta?.model) {
                setActiveAiModel(data.meta.model)
              } else if (data.text) {
                accumulatedText += data.text
              }

              // Call our robust parser
              const parsed = parseStreamingReplacement(accumulatedText)
              if (parsed.isReplacementMode) {
                detectedOriginalMode = true
                if (parsed.originalText) {
                  setAiSelectedText(parsed.originalText)
                  const range = findTextRange(editor, parsed.originalText)
                  if (range) {
                    setAiSelectionRange(range)
                    editor.chain().setTextSelection(range).scrollIntoView().run()
                  } else if (popupContextRange) {
                    setAiSelectionRange(popupContextRange)
                  }
                }
                setSimulatedAiResult(parsed.replacementText)
              } else if (!detectedOriginalMode) {
                setSimulatedAiResult(accumulatedText)
              }
            } catch (e) {}
          }
        }
      }
    } catch (err: any) {
      setSimulatedAiResult(`<p class="text-red-500 font-semibold">Error: ${err.message}</p>`)
    } finally {
      setIsSimulatingAI(false)
    }
  }

  const acceptPopupSuggestion = () => {
    if (simulatedAiResult) {
      const formatted = formatAiResponseToHtml(simulatedAiResult)
      if (popupContextRange) {
        editor.chain().focus().setTextSelection(popupContextRange).insertContent(formatted).run()
      } else {
        editor.chain().focus().insertContent(formatted).run()
      }
      setSimulatedAiResult('')
      setAiSelectedText('')
      setAiSelectionRange(null)
      setShowFloatingPopup(false)
      setPopupPrompt('')
    }
  }

  const rejectPopupSuggestion = () => {
    setSimulatedAiResult('')
    setAiSelectedText('')
    setAiSelectionRange(null)
    setShowFloatingPopup(false)
    setPopupPrompt('')
  }

  // Setup Wizard & Source Context File Parsing Helpers
  const parseSourceFile = async (file: File): Promise<{ name: string; content: string; type: string }> => {
    const extension = file.name.split('.').pop()?.toLowerCase()
    
    if (extension === 'docx') {
      const mammoth = await import('mammoth')
      const arrayBuffer = await file.arrayBuffer()
      const result = await mammoth.convertToHtml({ arrayBuffer })
      return {
        name: file.name,
        content: result.value,
        type: 'docx'
      }
    } else if (extension === 'pdf') {
      const pdfjs = await import('pdfjs-dist')
      pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`
      
      const arrayBuffer = await file.arrayBuffer()
      const loadingTask = pdfjs.getDocument({ data: arrayBuffer })
      const pdf = await loadingTask.promise
      
      let accumulatedHtml = ''
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const textContent = await page.getTextContent()
        const pageStrings = textContent.items.map((item: any) => item.str).join(' ')
        accumulatedHtml += `<p>${pageStrings}</p>`
      }
      return {
        name: file.name,
        content: accumulatedHtml,
        type: 'pdf'
      }
    } else {
      throw new Error('Unsupported document format. Only .docx and .pdf files are supported.')
    }
  }

  const handleStyleReferenceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsProcessingSource(true)
    try {
      const parsed = await parseSourceFile(file)
      
      // Convert parsed HTML content to text for scanning headings
      const tempDiv = document.createElement('div')
      tempDiv.innerHTML = parsed.content
      const extractedText = tempDiv.textContent || tempDiv.innerText || ''

      // Parse headings to extract outline structure
      const lines = extractedText.split('\n')
      const headings = lines
        .map(l => l.trim())
        .filter(l => {
          return (
            /^(chapter|section|reference|introduction|appendix|methodology|related work|literature)/i.test(l) ||
            /^\d+(\.\d+)+\s+\w+/i.test(l) ||
            /^\d+\.\s+\w+/i.test(l)
          )
        })
        .slice(0, 20)

      if (headings.length > 0) {
        setCustomChapterOutline(headings.join('\n'))
        setWizardDocType('Custom')
        alert(`Successfully extracted outline styles from "${file.name}":\n\n` + headings.slice(0, 5).join('\n') + '\n...')
      } else {
        setCustomChapterOutline(extractedText.slice(0, 500))
        setWizardDocType('Custom')
        alert(`Extracted style guidelines from "${file.name}".`)
      }

      // Auto-detect formatting styles from text contents
      const lowerText = extractedText.toLowerCase()
      if (lowerText.includes('apa') || file.name.toLowerCase().includes('apa')) {
        setWizardFontFamily('playfair') // Times New Roman / Playfair
        setWizardLineSpacing('2.0') // Double spaced
      } else if (lowerText.includes('ieee') || file.name.toLowerCase().includes('ieee')) {
        setWizardFontFamily('arial')
        setWizardLineSpacing('1.0') // Single spaced
      } else if (lowerText.includes('harvard') || file.name.toLowerCase().includes('harvard')) {
        setWizardFontFamily('arial')
        setWizardLineSpacing('1.5') // 1.5 line height spacing
      }
    } catch (err: any) {
      console.error("Error extracting formatting style templates:", err)
      alert("Failed to parse formatting styles: " + err.message)
    } finally {
      setIsProcessingSource(false)
      e.target.value = ''
    }
  }

  const handleWizardFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setIsProcessingSource(true)
    const newSources = [...projectSources]

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      try {
        const parsed = await parseSourceFile(file)
        if (activeProjectIdRef.current) {
          try {
            const saved = await saveSource(activeProjectIdRef.current, parsed.name, parsed.content, parsed.type)
            newSources.push({
              id: saved.id,
              name: saved.name,
              content: saved.content,
              type: saved.type
            })
          } catch (dbErr) {
            console.error("Failed to save uploaded file to IndexedDB:", dbErr)
            newSources.push(parsed)
          }
        } else {
          newSources.push(parsed)
        }
      } catch (err: any) {
        alert(`Error parsing "${file.name}": ${err.message}`)
      }
    }

    setProjectSources(newSources)
    setIsProcessingSource(false)
    e.target.value = ''
  }

  const applyOnboardingStyles = (editorInstance: any) => {
    if (!editorInstance) return
    setTimeout(() => {
      let chain = editorInstance.chain().focus().selectAll()
      if (wizardFontFamily === 'default') {
        chain = chain.unsetFontFamily()
      } else {
        chain = chain.setFontFamily(wizardFontFamily)
      }
      chain.setLineHeight(wizardLineSpacing).run()
      
      // Trigger pagination synchronously
      runPagination(editorInstance)
    }, 150)
  }

  const handleWizardComplete = async (choice: 'import' | 'ai_blueprint' | 'blank') => {
    const finalTitle = wizardTopic.trim() || 'Untitled Project'
    
    // Generate new project ID
    const newProjId = 'proj_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
    
    // Set active states
    setActiveProjectId(newProjId)
    localStorage.setItem(STORAGE_KEY_ACTIVE_ID, newProjId)
    setDocumentTitle(finalTitle)
    setDocHeader('')
    setDocFooter('')
    window.history.pushState({}, '', `/?project=${newProjId}`)
    setShowDashboard(false)

    // Function to save the project snapshot
    const saveProjectSnapshot = async (htmlContent: string) => {
      const tempEditor = editor
      let contentJSON = tempEditor ? tempEditor.getJSON() : {}

      // Migrate temporary uploader sources (without IDs) to IndexedDB
      const finalSources: any[] = []
      for (const tempSrc of projectSources) {
        if (tempSrc.id === undefined) {
          try {
            const saved = await saveSource(newProjId, tempSrc.name, tempSrc.content, tempSrc.type)
            finalSources.push({
              id: saved.id,
              name: saved.name,
              content: saved.content,
              type: saved.type
            })
          } catch (e) {
            console.error("Failed to migrate temp source to IndexedDB:", e)
            finalSources.push(tempSrc)
          }
        } else {
          finalSources.push(tempSrc)
        }
      }
      setProjectSources(finalSources)
      
      const newProj: Project = {
        id: newProjId,
        title: finalTitle,
        content: JSON.stringify(contentJSON),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        wordCount: tempEditor ? (tempEditor.getText().trim() ? tempEditor.getText().trim().split(/\s+/).length : 0) : 0,
        charCount: tempEditor ? tempEditor.getText().length : 0,
        documentType: wizardDocType,
        academicLevel: wizardAcademicLevel,
        docHeader: '',
        docFooter: ''
      }

      setProjects(prev => {
        const filtered = prev.filter(p => p.id !== newProjId)
        const updated = [newProj, ...filtered]
        saveProject(newProj).catch(e => console.error("Failed to save project to IndexedDB", e))
        return updated
      })
      setIsSaved(true)
    }

    if (choice === 'import' && projectSources.length > 0) {
      const importedHtml = ensurePaginatedHtml(projectSources[0].content)
      editor.commands.setContent(importedHtml)
      setIsSaved(false)
      setShowWizard(false)
      applyOnboardingStyles(editor)
      
      // Save snapshot immediately
      setTimeout(() => {
        saveProjectSnapshot(importedHtml)
      }, 100)

    } else if (choice === 'ai_blueprint') {
      setShowWizard(false)
      setIsSimulatingAI(true)
      setSimulatedAiResult('')
      setActiveAiModel('')
      
      let contextText = ''
      if (projectSources.length > 0) {
        contextText = `Reference Ingested Sources:\n` + projectSources.map(s => s.name + ": " + s.content.slice(0, 1000)).join('\n\n')
      }

      // Generate structural guide based on doc type
      let outlineStructurePrompt = ''
      if (wizardDocType === 'Seminar') {
        outlineStructurePrompt = `The document MUST be structured EXACTLY as a Seminar report following these chapters and subheadings:
        Chapter 1.
        1.1. Introduction 
        1.2. Problem Definition and Motivation 
        1.4. Advantages and Limitations

        Chapter 2
        Literature Review/Related work 
        2.1. Summary of exit works
        2.2. Overview of previous research 
        Research Gaps.

        Chapter 3
        Methodology/Working Principle 
        3.1. Core Concepts: Theoretical Background 
        3.2. Working Principle/Process Flow 
        3.3. Techniques/Tool Used

        Chapter 4
        4.1. Summary of key takeaways and main findings 
        4.2. Future Scope.`
      } else if (wizardDocType === 'Proposal') {
        outlineStructurePrompt = `The document MUST be structured EXACTLY as a Proposal report following these chapters and subheadings:
        Chapter 1
        Introduction
        1.1. Background of Study
        1.2. Problem Statement
        1.3. Aim and Objectives
        1.4. Significance of Study
        1.5. Scope and Limitation

        Chapter 2
        Literature Review
        2.1. Conceptual Review
        2.2. Theoretical Review
        2.3. Empirical Review

        Chapter 3
        Research Methodology
        3.1. Research Design
        3.2. Population of the Study
        3.3. Method of Data Collection
        3.4. Method of Data Analysis`
      } else if (wizardDocType === 'Project') {
        outlineStructurePrompt = `The document MUST be structured EXACTLY as a Project report following these chapters and subheadings:
        Chapter 1
        Introduction
        1.1. Background of the Study
        1.2. Statement of the Problem
        1.3. Objectives of the Study
        1.4. Research Questions
        1.5. Significance of the Study

        Chapter 2
        Literature Review
        2.1. Conceptual Framework
        2.2. Theoretical Framework
        2.3. Empirical Framework

        Chapter 3
        System Analysis and Design / Methodology
        3.1. Description of the Existing System
        3.2. Method of Data Gathering
        3.3. Analysis of the Proposed System
        3.4. Design of the Proposed System

        Chapter 4
        Implementation and Results
        4.1. System Requirements
        4.2. Installation and Configurations
        4.3. Interface Mockups and Explanations
        4.4. Test Results and Evaluation

        Chapter 5
        Conclusion and Recommendations
        5.1. Summary of Findings
        5.2. Practical Recommendations
        5.3. Recommendations for Future Research`
      } else if (wizardDocType === 'Custom' && customChapterOutline.trim()) {
        outlineStructurePrompt = `The document MUST follow this custom chapter outline exactly:\n${customChapterOutline}`
      }
      
      try {
        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: `You are a scholarly research writing assistant. Generate a highly comprehensive, fully realized academic project document blueprint/guideline based on the topic: "${finalTitle}".
            
            ${outlineStructurePrompt}
            
            For each section, do NOT just put placeholders or comments. Generate actual introductory text, structured paragraphs, explanations, and realistic outlines. Write at least 800 words of rich content.
            Use standard HTML tags like <h1>, <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>, and <blockquote>. Use <div data-type="page">...</div> to separate the content into logical sections/pages.
            Keep the tone highly scholarly, fitting for an ${wizardAcademicLevel} level project.`,
            context: contextText,
            academicLevel: wizardAcademicLevel || 'Undergraduate',
            documentType: wizardDocType || 'Custom',
            modelTarget: aiEngine
          })
        })

        if (!response.ok) throw new Error('API request failed')

        const reader = response.body?.getReader()
        const decoder = new TextDecoder()
        let accumulatedText = ''

        if (reader) {
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            const chunk = decoder.decode(value, { stream: true })
            const lines = chunk.split('\n')
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const dataStr = line.slice(6).trim()
                if (dataStr === '[DONE]') break
                try {
                  const data = JSON.parse(dataStr)
                  if (data.text) {
                    accumulatedText += data.text
                    const formatted = formatAiResponseToHtml(accumulatedText)
                    editor.commands.setContent(ensurePaginatedHtml(formatted))
                  }
                } catch (e) {}
              }
            }
          }
        }
        setIsSaved(false)
        applyOnboardingStyles(editor)
        
        // Save final AI blueprint snapshot
        setTimeout(() => {
          saveProjectSnapshot(editor.getHTML())
        }, 150)
      } catch (err) {
        console.error(err)
      } finally {
        setIsSimulatingAI(false)
      }
    } else {
      // blank/template canvas slate
      let templateContent = ''
      if (wizardDocType === 'Seminar') {
        templateContent = SEMINAR_TEMPLATE
          .replace('[Insert Seminar Topic Here]', finalTitle)
          .replace('[STUDENT NAME]', studentName.trim() || 'STUDENT NAME')
          .replace('[MATRIC NUMBER]', matricNumber.trim() || 'MATRIC NUMBER')
          .replace('[SUPERVISOR NAME]', supervisorName.trim() || 'SUPERVISOR NAME')
      } else if (wizardDocType === 'Proposal') {
        templateContent = PROPOSAL_TEMPLATE.replace('[Insert Topic Here]', finalTitle)
      } else if (wizardDocType === 'Project') {
        templateContent = PROJECT_TEMPLATE.replace('[Insert Topic Here]', finalTitle)
      } else if (wizardDocType === 'Custom' && customChapterOutline.trim()) {
        const generatedOutlineHtml = customChapterOutline
          .split('\n')
          .map(h => `<h3>${h}</h3><p>Start writing under this heading...</p>`)
          .join('')
        templateContent = `<h1>${finalTitle}</h1><div data-type="page"><h2>Custom Outline</h2>${generatedOutlineHtml}</div>`
      } else {
        templateContent = `<h1>${finalTitle}</h1><div data-type="page"><p>Start writing your document here...</p></div>`
      }

      const formattedHtml = ensurePaginatedHtml(templateContent)
      editor.commands.setContent(formattedHtml)
      setIsSaved(false)
      setShowWizard(false)
      applyOnboardingStyles(editor)
      
      // Save snapshot immediately
      setTimeout(() => {
        saveProjectSnapshot(formattedHtml)
      }, 100)
    }

    setWizardStep(1)
    setWizardTopic('')
  }

  const handleAcademicLevelChange = (level: string) => {
    setWizardAcademicLevel(level)
    if (activeProjectId) {
      const project = projects.find(p => p.id === activeProjectId)
      if (project) {
        const updatedProj = {
          ...project,
          academicLevel: level,
          updatedAt: Date.now()
        }
        setProjects(prev => prev.map(p => p.id === activeProjectId ? updatedProj : p))
        saveProject(updatedProj).catch(e => console.error("Failed to save project to IndexedDB", e))
      }
    }
  }

  const handleAcademicToneChange = (tone: string) => {
    setWizardAcademicTone(tone)
    if (activeProjectId) {
      const project = projects.find(p => p.id === activeProjectId)
      if (project) {
        const updatedProj = {
          ...project,
          academicTone: tone,
          updatedAt: Date.now()
        }
        setProjects(prev => prev.map(p => p.id === activeProjectId ? updatedProj : p))
        saveProject(updatedProj).catch(e => console.error("Failed to save project to IndexedDB", e))
      }
    }
  }

  const handleDocumentTypeChangeInEditor = (type: 'Seminar' | 'Proposal' | 'Project' | 'Custom') => {
    setWizardDocType(type)
    
    // Apply styling presets automatically on the canvas when the document type is switched
    let nextFont: 'default' | 'arial' | 'georgia' | 'playfair' | 'inter' | 'courier' = 'default'
    let nextSpacing = '1.5'
    
    if (type === 'Seminar') {
      nextFont = 'playfair' // Times New Roman / Playfair (APA style)
      nextSpacing = '2.0' // Double spacing
    } else if (type === 'Proposal') {
      nextFont = 'arial'
      nextSpacing = '1.5'
    } else if (type === 'Project') {
      nextFont = 'arial'
      nextSpacing = '1.5'
    }

    setWizardFontFamily(nextFont)
    setWizardLineSpacing(nextSpacing)

    if (editor) {
      setTimeout(() => {
        let chain = editor.chain().focus().selectAll()
        if (nextFont === 'default') {
          chain = chain.unsetFontFamily()
        } else {
          chain = chain.setFontFamily(nextFont)
        }
        chain.setLineHeight(nextSpacing).run()
        runPagination(editor)
      }, 150)
    }

    if (activeProjectId) {
      const project = projects.find(p => p.id === activeProjectId)
      if (project) {
        const updatedProj = {
          ...project,
          documentType: type,
          updatedAt: Date.now()
        }
        setProjects(prev => prev.map(p => p.id === activeProjectId ? updatedProj : p))
        saveProject(updatedProj).catch(e => console.error("Failed to save project to IndexedDB", e))
      }
    }
  }

  const generateFullDocumentBlueprint = async () => {
    const finalTitle = documentTitle.trim() || 'Untitled Project'
    setIsSimulatingAI(true)
    setSimulatedAiResult('')
    setActiveAiModel('')
    
    let contextText = ''
    if (projectSources.length > 0) {
      contextText = `Reference Ingested Sources:\n` + projectSources.map(s => s.name + ": " + s.content.slice(0, 1000)).join('\n\n')
    }

    // Generate structural guide based on doc type
    let outlineStructurePrompt = ''
    if (wizardDocType === 'Seminar') {
      outlineStructurePrompt = `The document MUST be structured EXACTLY as a Seminar report following these chapters and subheadings:
      Chapter 1.
      1.1. Introduction 
      1.2. Problem Definition and Motivation 
      1.4. Advantages and Limitations

      Chapter 2
      Literature Review/Related work 
      2.1. Summary of exit works
      2.2. Overview of previous research 
      Research Gaps.

      Chapter 3
      Methodology/Working Principle 
      3.1. Core Concepts: Theoretical Background 
      3.2. Working Principle/Process Flow 
      3.3. Techniques/Tool Used

      Chapter 4
      4.1. Summary of key takeaways and main findings 
      4.2. Future Scope.`
    } else if (wizardDocType === 'Proposal') {
      outlineStructurePrompt = `The document MUST be structured EXACTLY as a Proposal report following these chapters and subheadings:
      Chapter 1
      Introduction
      1.1. Background of Study
      1.2. Problem Statement
      1.3. Aim and Objectives
      1.4. Significance of Study
      1.5. Scope and Limitation

      Chapter 2
      Literature Review
      2.1. Conceptual Review
      2.2. Theoretical Review
      2.3. Empirical Review

      Chapter 3
      Research Methodology
      3.1. Research Design
      3.2. Population of the Study
      3.3. Method of Data Collection
      3.4. Method of Data Analysis`
    } else if (wizardDocType === 'Project') {
      outlineStructurePrompt = `The document MUST be structured EXACTLY as a Project report following these chapters and subheadings:
      Chapter 1
      Introduction
      1.1. Background of the Study
      1.2. Statement of the Problem
      1.3. Objectives of the Study
      1.4. Research Questions
      1.5. Significance of the Study

      Chapter 2
      Literature Review
      2.1. Conceptual Framework
      2.2. Theoretical Framework
      2.3. Empirical Framework

      Chapter 3
      System Analysis and Design / Methodology
      3.1. Description of the Existing System
      3.2. Method of Data Gathering
      3.3. Analysis of the Proposed System
      3.4. Design of the Proposed System

      Chapter 4
      Implementation and Results
      4.1. System Requirements
      4.2. Installation and Configurations
      4.3. Interface Mockups and Explanations
      4.4. Test Results and Evaluation

      Chapter 5
      Conclusion and Recommendations
      5.1. Summary of Findings
      5.2. Practical Recommendations
      5.3. Recommendations for Future Research`
    } else if (wizardDocType === 'Custom' && customChapterOutline.trim()) {
      outlineStructurePrompt = `The document MUST follow this custom chapter outline exactly:\n${customChapterOutline}`
    }

    try {
      setLoadingMessage('Generating Full Document Blueprint...')
      setIsExporting(true)

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `You are a scholarly research writing assistant. Generate a highly comprehensive, fully realized academic project document blueprint/guideline based on the topic: "${finalTitle}".
          
          ${outlineStructurePrompt}
          
          For each section, do NOT just put placeholders or comments. Generate actual introductory text, structured paragraphs, explanations, and realistic outlines. Write at least 1500 words of rich content.
          Use standard HTML tags like <h1>, <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>, and <blockquote>. Use <div data-type="page">...</div> to separate the content into logical sections/pages.
          Keep the tone highly ${wizardAcademicTone || 'scholarly'}, fitting for an ${wizardAcademicLevel} level project.`,
          context: contextText,
          academicLevel: wizardAcademicLevel || 'Undergraduate',
          academicTone: wizardAcademicTone || 'Analytical',
          documentType: wizardDocType || 'Custom',
          modelTarget: aiEngine
        })
      })

      if (!response.ok) throw new Error('API request failed')

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let accumulatedText = ''

      if (reader) {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          const lines = chunk.split('\n')
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const content = line.slice(6).trim()
              if (content === '[DONE]') break
              try {
                const parsed = JSON.parse(content)
                if (parsed.text) {
                  accumulatedText += parsed.text
                }
              } catch (e) {
                // Ignore meta
              }
            }
          }
        }
      }

      if (editor && accumulatedText.trim()) {
        const formattedHtml = ensurePaginatedHtml(accumulatedText)
        editor.commands.setContent(formattedHtml)
        setIsSaved(false)
        applyOnboardingStyles(editor)
        
        // Save snapshot immediately
        if (activeProjectId) {
          const contentJSON = editor.getJSON()
          const project = projects.find(p => p.id === activeProjectId)
          if (project) {
            const updatedProj = {
              ...project,
              content: JSON.stringify(contentJSON),
              updatedAt: Date.now(),
              wordCount: editor.getText().trim() ? editor.getText().trim().split(/\s+/).length : 0,
              charCount: editor.getText().length
            }
            setProjects(prev => prev.map(p => p.id === activeProjectId ? updatedProj : p))
            saveProject(updatedProj).catch(e => console.error("Failed to save project to IndexedDB", e))
            setIsSaved(true)
          }
        }
      }
    } catch (err) {
      console.error(err)
      alert("Failed to generate document blueprint: " + (err as any).message)
    } finally {
      setIsSimulatingAI(false)
      setIsExporting(false)
    }
  }

  const activeProject = projects.find(p => p.id === activeProjectId)

  return (
    <div className="flex flex-col flex-1 h-screen overflow-hidden bg-zinc-100 text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
      {isExporting && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-xs z-50 flex items-center justify-center transition-all">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-850 rounded-xl p-6 shadow-2xl flex flex-col items-center gap-4 max-w-sm text-center">
            <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
            <div>
              <h3 className="font-bold text-zinc-900 dark:text-zinc-50 text-sm">{loadingMessage}</h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Please wait a few seconds...</p>
            </div>
          </div>
        </div>
      )}
      
      {showDashboard ? (
        <Dashboard
          theme={theme}
          toggleTheme={toggleTheme}
          projects={projects}
          onCreateProject={createNewProject}
          onCreateProjectWithTemplate={createNewProjectWithTemplate}
          onDeleteProject={deleteProject}
          onRenameProject={renameProjectPrompt}
          onLoadProject={loadProject}
        />
      ) : (
        <>
          {/* Top Application Bar */}
      <header className="flex items-center justify-between px-6 py-2 border-b bg-white border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 z-10">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <img src="/WordPI.png" alt="WordPiLot Logo" className="w-6.5 h-6.5 object-contain rounded-md" />
            <span className="font-bold text-lg tracking-tight select-none">
              <span className="text-[#1B1F23] dark:text-[#E5E7EB]">Word</span>
              <span className="text-[#185ABD] dark:text-[#3B82F6]">Pi</span>
              <span className="text-[#B68A35] text-[10px] align-super ml-0.5 font-bold uppercase">lot</span>
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={documentTitle}
              onChange={(e) => {
                setDocumentTitle(e.target.value)
                setIsSaved(false)
              }}
              className="text-sm font-semibold px-2 py-1 bg-transparent hover:bg-zinc-100 focus:bg-white focus:ring-2 focus:ring-indigo-500 rounded outline-none border-none dark:hover:bg-zinc-800 dark:focus:bg-zinc-850 w-48 sm:w-64 transition-colors"
            />
            
            <button
              onClick={() => {
                window.history.pushState({}, '', '/')
                setShowDashboard(true)
                setActiveProjectId('')
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-750 text-zinc-700 dark:text-zinc-300 rounded border border-zinc-200 dark:border-zinc-700 text-xs font-semibold transition-colors cursor-pointer"
              title="Return to Document Center Dashboard"
            >
              <Folder className="w-3.5 h-3.5 text-indigo-500" />
              <span>Projects</span>
            </button>
            
            <button
              onClick={() => {
                setWizardTopic('')
                setWizardStep(1)
                setShowWizard(true)
              }}
              className="flex items-center gap-1.5 px-3 py-1 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded border border-indigo-200/50 dark:border-indigo-900/40 text-xs font-semibold transition-colors cursor-pointer"
              title="Reset workspace and launch Onboarding Wizard"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Project</span>
            </button>
            
            <button
              onClick={() => setShowCoverPageModal(true)}
              className="flex items-center gap-1.5 px-3 py-1 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/20 dark:hover:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded border border-amber-200/50 dark:border-amber-900/40 text-xs font-semibold transition-colors cursor-pointer"
              title="Create a professional academic cover page"
            >
              <FileText className="w-3.5 h-3.5 text-amber-500" />
              <span>Create Cover Page</span>
            </button>

            <button
              onClick={clearDocument}
              className="flex items-center gap-1.5 px-3 py-1 bg-red-50 hover:bg-red-100 dark:bg-red-950/10 dark:hover:bg-red-950/20 text-red-600 dark:text-red-400 rounded border border-red-200/50 dark:border-red-900/40 text-xs font-semibold transition-colors cursor-pointer"
              title="Clear all pages and content to start blank"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Document</span>
            </button>

            <button
              onClick={() => setShowGeneratorPopup(true)}
              className="flex items-center gap-1.5 px-3 py-1 bg-indigo-650 hover:bg-indigo-700 text-white rounded border border-indigo-700 text-xs font-semibold transition-colors cursor-pointer shadow-xs"
              title="Open full document blueprint generator popup"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Generate Full Blueprint</span>
            </button>

            <button
              onClick={generateTableOfContents}
              className="flex items-center gap-1.5 px-3 py-1 bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/20 dark:hover:bg-teal-900/30 text-teal-700 dark:text-teal-300 rounded border border-teal-200/50 dark:border-teal-900/40 text-xs font-semibold transition-colors cursor-pointer"
              title="Generate a Table of Contents based on document headings"
            >
              <OrderedListIcon className="w-3.5 h-3.5 text-teal-500" />
              <span>Table of Contents</span>
            </button>
            
            <div className="flex items-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-500 select-none">
              <CheckCircle2 className={`w-3.5 h-3.5 transition-colors ${isSaved ? 'text-emerald-500' : 'text-zinc-300'}`} />
              <span>{isSaved ? 'Draft saved locally' : 'Saving...'}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Import Actions */}
          <input
            type="file"
            accept=".docx,.pdf"
            id="import-file"
            onChange={handleImportFile}
            className="hidden"
          />
          <label
            htmlFor="import-file"
            className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-zinc-50 hover:bg-zinc-200 text-zinc-700 rounded-md border border-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:border-zinc-700 dark:text-zinc-300 transition-colors"
            title="Import a Word (.docx) or PDF (.pdf) file to format or edit"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import</span>
          </label>

          {/* Export Actions */}
          <div className="relative" ref={exportMenuRef}>
            <button 
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-zinc-50 hover:bg-zinc-200 text-zinc-700 rounded-md border border-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:border-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export</span>
            </button>
            {showExportMenu && (
              <div className="absolute right-0 mt-1.5 w-40 bg-white border border-zinc-200 shadow-lg rounded-lg py-1 dark:bg-zinc-900 dark:border-zinc-800 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                <button 
                  onClick={() => {
                    exportDoc('html')
                    setShowExportMenu(false)
                  }}
                  className="w-full text-left px-4 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 cursor-pointer"
                >
                  Web Page (.html)
                </button>
                <button 
                  onClick={() => {
                    exportDoc('txt')
                    setShowExportMenu(false)
                  }}
                  className="w-full text-left px-4 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 cursor-pointer"
                >
                  Plain Text (.txt)
                </button>
                <div className="border-t border-zinc-100 dark:border-zinc-800 my-1"></div>
                <div className="px-4 py-1.5 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                  Phase 3 Exports
                </div>
                <button 
                  onClick={() => {
                    exportToDocx()
                    setShowExportMenu(false)
                  }}
                  className="w-full text-left px-4 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 cursor-pointer"
                >
                  Word (.docx)
                </button>
                <button 
                  onClick={() => {
                    exportToPdfPrint()
                    setShowExportMenu(false)
                  }}
                  className="w-full text-left px-4 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 cursor-pointer"
                >
                  PDF Document (Fast / Searchable)
                </button>
                <button 
                  onClick={() => {
                    exportToPptx()
                    setShowExportMenu(false)
                  }}
                  className="w-full text-left px-4 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 cursor-pointer"
                >
                  Powerpoint (.pptx)
                </button>
              </div>
            )}
          </div>

          <button
            onClick={toggleTheme}
            className="p-1.5 text-zinc-500 hover:text-indigo-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-indigo-400 dark:hover:bg-zinc-800 rounded-lg transition-all"
            title="Toggle color theme"
          >
            {theme === 'light' ? <Moon className="w-4.5 h-4.5" /> : <Sun className="w-4.5 h-4.5" />}
          </button>

          <button
            onClick={() => setLeftSidebarOpen(!leftSidebarOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-zinc-50 hover:bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-300 rounded-md transition-colors border border-zinc-200 dark:border-zinc-700 cursor-pointer"
            title={leftSidebarOpen ? "Hide Outline" : "Show Outline"}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Outline</span>
            {leftSidebarOpen ? <ChevronLeft className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/40 dark:text-indigo-300 rounded-md transition-colors cursor-pointer"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Assistant</span>
            {sidebarOpen ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
          </button>
        </div>
      </header>

      {/* Editor Main Canvas & Layout */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left Sidebar (Document Outline & Page Navigator) */}
        <aside 
          className={`flex-shrink-0 h-full bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 transition-all duration-300 z-20 flex flex-col ${
            leftSidebarOpen ? 'w-64 border-opacity-100' : 'w-0 border-opacity-0 overflow-hidden'
          }`}
        >
          {leftSidebarOpen && (
            <div className="flex flex-col h-full w-64 select-none animate-fade-in">
              <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300 font-semibold text-xs uppercase tracking-wider">
                  <FileText className="w-4 h-4 text-indigo-500" />
                  <span>Document Outline</span>
                </div>
                <button
                  onClick={() => setLeftSidebarOpen(false)}
                  className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded cursor-pointer"
                >
                  <Minimize2 className="w-4 h-4 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                </button>
              </div>

              {/* Page indicator header */}
              <div className="p-4 bg-zinc-50/50 dark:bg-zinc-900/50 border-b border-zinc-150 dark:border-zinc-850 flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-zinc-650 dark:text-zinc-350">
                  <span className="font-semibold text-zinc-800 dark:text-zinc-200">Page {currentPage}</span>
                  <span>of {totalPages}</span>
                </div>
                {/* Visual mini progress bar */}
                <div className="w-24 bg-zinc-200 dark:bg-zinc-750 h-1.5 rounded-full overflow-hidden">
                  <div 
                    className="bg-indigo-650 h-full transition-all duration-300" 
                    style={{ width: `${Math.min(100, (currentPage / totalPages) * 100)}%` }}
                  ></div>
                </div>
              </div>

              {/* Outline Navigation items */}
              <div className="flex-1 overflow-y-auto p-4 space-y-1">
                {outline.length === 0 ? (
                  <div className="text-center py-8 px-2 space-y-2">
                    <FileText className="w-8 h-8 text-zinc-300 dark:text-zinc-750 mx-auto" />
                    <p className="text-xs text-zinc-400 leading-normal">
                      Headings you add to the document will appear here to format your outline.
                    </p>
                  </div>
                ) : (
                  <nav className="space-y-0.5">
                    {outline.map((item, index) => {
                      const isActive = activeHeadingIndex === index
                      return (
                        <button
                          key={item.id}
                          onClick={() => scrollToHeading(index)}
                          className={`w-full text-left px-2.5 py-1.5 rounded text-xs transition-all flex items-center justify-between cursor-pointer group ${
                            isActive
                              ? 'bg-indigo-50 text-indigo-750 font-bold dark:bg-indigo-950/30 dark:text-indigo-400 border-l-2 border-indigo-600 dark:border-indigo-400 pl-2'
                              : 'text-zinc-600 hover:text-zinc-850 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-850 pl-2.5'
                          }`}
                          style={{
                            paddingLeft: `${Math.max(10, item.level * 12)}px`
                          }}
                        >
                          <span className="truncate pr-2">{item.text}</span>
                          <span className={`text-[9px] text-zinc-400 dark:text-zinc-500 font-mono opacity-0 group-hover:opacity-100 transition-opacity ${isActive ? 'opacity-100 font-semibold' : ''}`}>
                            p. {item.page}
                          </span>
                        </button>
                      )
                    })}
                  </nav>
                )}
              </div>
            </div>
          )}
        </aside>

        <div className="flex flex-col flex-1 min-h-0 h-full overflow-hidden bg-zinc-50 dark:bg-zinc-950">
          {/* Formatting Toolbar */}
          <div className="w-full border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-2 z-30 flex justify-center flex-shrink-0">
            <div className="w-full max-w-[816px] flex flex-wrap gap-1 items-center justify-start sm:justify-between">
            <div className="flex flex-wrap items-center gap-0.5 text-zinc-650 dark:text-zinc-400">
              {/* Heading Dropdown */}
              <select
                value={getActiveHeading()}
                onChange={(e) => {
                  const val = e.target.value
                  if (val === 'p') setHeading(0)
                  if (val === 'h1') setHeading(1)
                  if (val === 'h2') setHeading(2)
                  if (val === 'h3') setHeading(3)
                }}
                className="text-xs font-medium bg-zinc-50 border border-zinc-200 hover:bg-zinc-100 dark:bg-zinc-800 dark:border-zinc-700 px-2 py-1 rounded outline-none w-28 text-zinc-700 dark:text-zinc-300 mr-1"
              >
                <option value="p">Body Text</option>
                <option value="h1">Heading 1</option>
                <option value="h2">Heading 2</option>
                <option value="h3">Heading 3</option>
              </select>

              {/* Font Family Dropdown */}
              <select
                value={getActiveFont()}
                onChange={(e) => setFont(e.target.value)}
                className="text-xs font-medium bg-zinc-50 border border-zinc-200 hover:bg-zinc-100 dark:bg-zinc-800 dark:border-zinc-700 px-2 py-1 rounded outline-none w-28 text-zinc-700 dark:text-zinc-300 mr-1"
              >
                <option value="default">Default Sans</option>
                <option value="Arial">Arial (Sans)</option>
                <option value="Georgia">Georgia (Serif)</option>
                <option value="Courier New">Courier (Mono)</option>
                <option value="Inter">Inter (Clean)</option>
                <option value="Merriweather">Merriweather</option>
                <option value="Playfair Display">Playfair</option>
              </select>

              <div className="w-[1px] h-6 bg-zinc-200 dark:bg-zinc-700 mx-1.5 hidden sm:block"></div>

              {/* Inline Styles */}
              <button
                onClick={toggleBold}
                className={`p-1.5 rounded transition-colors ${editor.isActive('bold') ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300' : 'hover:bg-zinc-100 dark:hover:bg-zinc-850'}`}
                title="Bold (Ctrl+B)"
              >
                <BoldIcon className="w-4 h-4" />
              </button>
              <button
                onClick={toggleItalic}
                className={`p-1.5 rounded transition-colors ${editor.isActive('italic') ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300' : 'hover:bg-zinc-100 dark:hover:bg-zinc-850'}`}
                title="Italic (Ctrl+I)"
              >
                <ItalicIcon className="w-4 h-4" />
              </button>
              <button
                onClick={toggleUnderline}
                className={`p-1.5 rounded transition-colors ${editor.isActive('underline') ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300' : 'hover:bg-zinc-100 dark:hover:bg-zinc-850'}`}
                title="Underline (Ctrl+U)"
              >
                <UnderlineIcon className="w-4 h-4" />
              </button>
              <button
                onClick={toggleStrike}
                className={`p-1.5 rounded transition-colors ${editor.isActive('strike') ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300' : 'hover:bg-zinc-100 dark:hover:bg-zinc-850'}`}
                title="Strikethrough"
              >
                <StrikeIcon className="w-4 h-4" />
              </button>
              <button
                onClick={toggleCode}
                className={`p-1.5 rounded transition-colors ${editor.isActive('code') ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300' : 'hover:bg-zinc-100 dark:hover:bg-zinc-850'}`}
                title="Code inline"
              >
                <CodeIcon className="w-4 h-4" />
              </button>

              <div className="w-[1px] h-6 bg-zinc-200 dark:bg-zinc-700 mx-1.5"></div>

              {/* Alignments */}
              <button
                onClick={setAlignLeft}
                className={`p-1.5 rounded transition-colors ${getActiveAlign() === 'left' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300' : 'hover:bg-zinc-100 dark:hover:bg-zinc-850'}`}
                title="Align Left"
              >
                <AlignLeft className="w-4 h-4" />
              </button>
              <button
                onClick={setAlignCenter}
                className={`p-1.5 rounded transition-colors ${getActiveAlign() === 'center' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300' : 'hover:bg-zinc-100 dark:hover:bg-zinc-850'}`}
                title="Align Center"
              >
                <AlignCenter className="w-4 h-4" />
              </button>
              <button
                onClick={setAlignRight}
                className={`p-1.5 rounded transition-colors ${getActiveAlign() === 'right' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300' : 'hover:bg-zinc-100 dark:hover:bg-zinc-850'}`}
                title="Align Right"
              >
                <AlignRight className="w-4 h-4" />
              </button>
              <button
                onClick={setAlignJustify}
                className={`p-1.5 rounded transition-colors ${getActiveAlign() === 'justify' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300' : 'hover:bg-zinc-100 dark:hover:bg-zinc-850'}`}
                title="Justify text"
              >
                <AlignJustify className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-0.5 text-zinc-650 dark:text-zinc-400">
              {/* Line Spacing Selection */}
              <select
                onChange={(e) => setLineSpacing(e.target.value)}
                className="text-xs font-medium bg-zinc-50 border border-zinc-200 hover:bg-zinc-100 dark:bg-zinc-800 dark:border-zinc-700 px-1 py-1 rounded outline-none w-16 text-zinc-700 dark:text-zinc-300 mr-1"
                title="Line spacing"
                defaultValue="1.5"
              >
                <option value="1.0">1.0</option>
                <option value="1.15">1.15</option>
                <option value="1.5">1.5</option>
                <option value="1.8">1.8</option>
                <option value="2.0">2.0</option>
              </select>

              {/* Lists and Quote */}
              <button
                onClick={toggleBulletList}
                className={`p-1.5 rounded transition-colors ${editor.isActive('bulletList') ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300' : 'hover:bg-zinc-100 dark:hover:bg-zinc-850'}`}
                title="Bullet List"
              >
                <BulletListIcon className="w-4 h-4" />
              </button>
              <button
                onClick={toggleOrderedList}
                className={`p-1.5 rounded transition-colors ${editor.isActive('orderedList') ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300' : 'hover:bg-zinc-100 dark:hover:bg-zinc-850'}`}
                title="Numbered List"
              >
                <OrderedListIcon className="w-4 h-4" />
              </button>
              <button
                onClick={toggleBlockquote}
                className={`p-1.5 rounded transition-colors ${editor.isActive('blockquote') ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300' : 'hover:bg-zinc-100 dark:hover:bg-zinc-850'}`}
                title="Blockquote"
              >
                <QuoteIcon className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  editor.chain().focus().insertContent('<div class="page-break" style="page-break-after: always; border-top: 2px dashed #818cf8; margin: 2.5rem 0; padding-top: 0.5rem; text-align: center; font-size: 10px; color: #818cf8; text-transform: uppercase; letter-spacing: 0.1em; user-select: none;">Page Break</div>').run()
                }}
                className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-850 text-zinc-700 dark:text-zinc-300"
                title="Insert Page Break"
              >
                <Scissors className="w-4 h-4" />
              </button>

              <div className="w-[1px] h-6 bg-zinc-200 dark:bg-zinc-700 mx-1.5"></div>

              {/* History */}
              <button
                onClick={triggerUndo}
                className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-850 text-zinc-700 dark:text-zinc-300"
                title="Undo"
              >
                <UndoIcon className="w-4 h-4" />
              </button>
              <button
                onClick={triggerRedo}
                className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-850 text-zinc-700 dark:text-zinc-300"
                title="Redo"
              >
                <RedoIcon className="w-4 h-4" />
              </button>

              <div className="w-[1px] h-6 bg-zinc-200 dark:bg-zinc-700 mx-1.5"></div>

              {/* Document Headers & Footers Popover */}
              <div className="relative" ref={layoutSettingsRef}>
                <button
                  type="button"
                  onClick={() => setShowLayoutSettings(!showLayoutSettings)}
                  className={`p-1.5 rounded transition-colors ${
                    showLayoutSettings
                      ? 'bg-indigo-100 text-indigo-750 dark:bg-indigo-950 dark:text-indigo-300'
                      : 'hover:bg-zinc-100 dark:hover:bg-zinc-850 text-zinc-700 dark:text-zinc-300'
                  } flex items-center gap-1 cursor-pointer`}
                  title="Document Headers & Footers Settings"
                >
                  <FileText className="w-4 h-4" />
                  <span className="text-[11px] font-semibold hidden md:inline">Header/Footer</span>
                </button>

                {showLayoutSettings && (
                  <div className="absolute right-0 mt-1.5 w-64 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 shadow-xl z-50 space-y-2.5 animate-in fade-in slide-in-from-top-1 duration-150">
                    <div className="text-[10px] font-bold text-zinc-400 dark:text-zinc-550 uppercase tracking-wider">
                      Header & Footer Options
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-zinc-550 dark:text-zinc-450 block">
                        Page Header Text (Right)
                      </label>
                      <input
                        type="text"
                        value={docHeader}
                        onChange={(e) => setDocHeader(e.target.value)}
                        placeholder="e.g. Chapter 1: Literature"
                        className="w-full text-xs px-2.5 py-1.5 border border-zinc-200 dark:border-zinc-750 bg-zinc-50 dark:bg-zinc-850 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500 text-zinc-700 dark:text-zinc-300 font-medium transition-all"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-zinc-550 dark:text-zinc-455 block">
                        Page Footer Prefix
                      </label>
                      <input
                        type="text"
                        value={docFooter}
                        onChange={(e) => setDocFooter(e.target.value)}
                        placeholder="e.g. Confidential Draft"
                        className="w-full text-xs px-2.5 py-1.5 border border-zinc-200 dark:border-zinc-750 bg-zinc-50 dark:bg-zinc-850 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500 text-zinc-700 dark:text-zinc-300 font-medium transition-all"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable Canvas Body */}
        <div 
          ref={scrollContainerRef}
          tabIndex={0}
          className="scroll-container flex-1 min-h-0 w-full overflow-y-scroll py-8 px-4 sm:px-8 bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center focus:outline-none"
          style={{
            scrollbarGutter: 'stable',
            overscrollBehaviorY: 'contain'
          }}
        >

          {/* Document Sheet Container */}
          <div 
            onClick={() => editor.commands.focus()}
            style={{ 
              width: `${794 * zoomScale}px`, 
              height: `${totalPages * 1139 * zoomScale}px`,
              overflow: 'hidden'
            }}
            className="cursor-text transition-all duration-300 flex flex-col items-center justify-start relative print:w-full print:h-auto print:overflow-visible print:scale-100"
          >
            <div 
              style={{ 
                width: '794px', 
                transform: `scale(${zoomScale})`, 
                transformOrigin: 'top center' 
              }}
              className="transition-transform duration-300 print:transform-none print:w-full"
            >
              <EditorContent editor={editor} />
            </div>
          </div>
        </div>
      </div>

        {/* Floating/Collapsible AI Sidebar (Phase 2 Component Simulation) */}
        <aside 
          className={`flex-shrink-0 h-full bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 transition-all duration-300 z-20 flex flex-col ${
            sidebarOpen ? 'w-80 border-opacity-100' : 'w-0 border-opacity-0 overflow-hidden'
          }`}
        >
          {sidebarOpen && (
            <div className="flex flex-col h-full w-80">
              <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-semibold">
                  <Edit3 className="w-4 h-4" />
                  <span>WordPI Assistant</span>
                  <span className="text-[10px] bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 px-1.5 py-0.5 rounded font-mono font-normal">
                    PHASE 2
                  </span>
                </div>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded"
                >
                  <Minimize2 className="w-4 h-4 text-zinc-400 hover:text-zinc-700" />
                </button>
              </div>

              {/* Chat/Generation Input and Presets */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                
                 {/* AI Instructions Info Alert */}
                <div className="bg-indigo-50 border border-indigo-100 text-indigo-950 dark:bg-indigo-950/20 dark:border-indigo-900/30 dark:text-indigo-300 rounded-lg p-3 text-xs leading-5">
                  <span className="font-bold">WordPI AI Workspace:</span> Highlight any section of your document for context, choose a preset, or write a custom instruction to refine your writing.
                </div>

                {/* Context Window & Ingested Sources Panel */}
                <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-zinc-50/50 dark:bg-zinc-900/30">
                  <details className="group" open>
                    <summary className="flex items-center justify-between p-3 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-850 select-none">
                      <div className="flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-indigo-500" />
                        <span>Project Context ({projectSources.length})</span>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90 text-zinc-400" />
                    </summary>
                    <div className="p-3 border-t border-zinc-150 dark:border-zinc-850 space-y-3 bg-white dark:bg-zinc-900/50">
                      {/* Topic & Tone details */}
                      <div className="space-y-1">
                        <div className="text-[10px] text-zinc-400 uppercase font-semibold">Active Topic</div>
                        <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 truncate animate-fade-in" title={documentTitle}>
                          {documentTitle || 'Untitled Project'}
                        </div>
                      </div>
                      
                      {/* List of ingested sources */}
                      <div className="space-y-1.5">
                        <div className="text-[10px] text-zinc-400 uppercase font-semibold flex items-center justify-between">
                          <span>Ingested Reference Sources</span>
                          <span className="text-[9px] font-mono lowercase">{projectSources.length} files</span>
                        </div>
                        {projectSources.length === 0 ? (
                          <div className="text-[10px] italic text-zinc-400 py-1 bg-zinc-50/50 dark:bg-zinc-900/50 text-center rounded border border-dashed border-zinc-200 dark:border-zinc-800">
                            No research reference files uploaded.
                          </div>
                        ) : (
                          <div className="max-h-24 overflow-y-auto space-y-1 pr-1">
                            {projectSources.map((source, index) => (
                              <div key={index} className="flex items-center justify-between p-1.5 bg-zinc-50 dark:bg-zinc-850 rounded border border-zinc-100 dark:border-zinc-800 text-[10px] gap-2">
                                <div className="flex items-center gap-1 min-w-0 flex-1">
                                  <FileText className={`w-3 h-3 flex-shrink-0 ${source.type === 'pdf' ? 'text-red-500' : 'text-blue-500'}`} />
                                  <span className="truncate text-zinc-700 dark:text-zinc-300 font-medium" title={source.name}>
                                    {source.name}
                                  </span>
                                </div>
                                <button
                                  onClick={() => deleteIngestedSourceAtIndex(index)}
                                  className="text-red-500 hover:text-red-750 p-0.5 rounded hover:bg-red-50 dark:hover:bg-red-950/20 cursor-pointer"
                                  title="Remove source"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Add more sources inline */}
                      <div className="pt-1">
                        <label className="w-full flex items-center justify-center gap-1.5 bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-850 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded border border-zinc-250 dark:border-zinc-750 py-1.5 text-[10px] font-semibold transition-colors cursor-pointer">
                          <Upload className="w-3.5 h-3.5" />
                          <span>Ingest PDF or Word File</span>
                          <input
                            type="file"
                            accept=".docx,.pdf"
                            multiple
                            onChange={handleWizardFileUpload}
                            className="hidden"
                          />
                        </label>
                      </div>
                    </div>
                  </details>
                </div>

                {/* Academic Settings Section */}
                <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-zinc-50/50 dark:bg-zinc-900/30">
                  <details className="group" open>
                    <summary className="flex items-center justify-between p-3 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-850 select-none">
                      <div className="flex items-center gap-1.5">
                        <Folder className="w-3.5 h-3.5 text-indigo-500" />
                        <span>Academic Settings</span>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90 text-zinc-400" />
                    </summary>
                    <div className="p-3 border-t border-zinc-150 dark:border-zinc-850 space-y-3 bg-white dark:bg-zinc-900/50">
                      {/* Academic Level Dropdown */}
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase font-semibold block">
                          Academic Level
                        </label>
                        <select
                          value={wizardAcademicLevel}
                          onChange={(e) => handleAcademicLevelChange(e.target.value)}
                          className="w-full text-xs p-2 rounded border border-zinc-200 dark:border-zinc-800 focus:ring-1 focus:ring-indigo-500 bg-white dark:bg-zinc-900 outline-none text-zinc-700 dark:text-zinc-300 cursor-pointer"
                        >
                          <option value="High School">High School</option>
                          <option value="Undergraduate">Undergraduate</option>
                          <option value="Master's">Master's</option>
                          <option value="Ph.D.">Ph.D.</option>
                        </select>
                      </div>

                      {/* Document Type Dropdown */}
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase font-semibold block">
                          Document Type
                        </label>
                        <select
                          value={wizardDocType}
                          onChange={(e) => handleDocumentTypeChangeInEditor(e.target.value as any)}
                          className="w-full text-xs p-2 rounded border border-zinc-200 dark:border-zinc-800 focus:ring-1 focus:ring-indigo-500 bg-white dark:bg-zinc-900 outline-none text-zinc-700 dark:text-zinc-300 cursor-pointer"
                        >
                          <option value="Seminar">Seminar Report</option>
                          <option value="Proposal">Research Proposal</option>
                          <option value="Project">Graduation Thesis</option>
                          <option value="Custom">Custom Outline</option>
                        </select>
                      </div>

                      {/* Academic Tone Dropdown */}
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase font-semibold block">
                          Academic Tone
                        </label>
                        <select
                          value={wizardAcademicTone}
                          onChange={(e) => handleAcademicToneChange(e.target.value)}
                          className="w-full text-xs p-2 rounded border border-zinc-200 dark:border-zinc-800 focus:ring-1 focus:ring-indigo-500 bg-white dark:bg-zinc-900 outline-none text-zinc-700 dark:text-zinc-300 cursor-pointer"
                        >
                          <option value="Analytical">Analytical</option>
                          <option value="Scholarly">Scholarly / Formal</option>
                          <option value="Critical">Critical / Evaluative</option>
                          <option value="Objective">Objective / Neutral</option>
                          <option value="Persuasive">Persuasive / Argumentative</option>
                        </select>
                      </div>

                      {/* AI Generation Engine Dropdown */}
                      <div className="space-y-1">
                        <label className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase font-semibold block">
                          AI Generation Engine
                        </label>
                        <select
                          value={aiEngine}
                          onChange={(e) => setAiEngine(e.target.value as 'gemini' | 'grok' | 'groq')}
                          className="w-full text-xs p-2 rounded border border-zinc-200 dark:border-zinc-800 focus:ring-1 focus:ring-indigo-500 bg-white dark:bg-zinc-900 outline-none text-zinc-700 dark:text-zinc-300 cursor-pointer font-medium"
                        >
                          <option value="gemini">WordPI Core (Gemini 2.5 Flash - Free)</option>
                          <option value="groq">WordPI Searcher (Groq Llama 3 - Free & Fast)</option>
                          <option value="grok">WordPI Searcher (xAI Grok-2 - Requires Subscription)</option>
                        </select>
                      </div>

                      {wizardDocType === 'Seminar' && (
                        <div className="space-y-2 border-t border-zinc-150 dark:border-zinc-850 pt-3 mt-2.5 animate-in fade-in duration-200">
                          <div className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                            Cover Page Configuration
                          </div>
                          
                          <div className="space-y-1">
                            <label className="text-[10px] text-zinc-700 dark:text-zinc-300 font-semibold block">
                              Student Name
                            </label>
                            <input
                              type="text"
                              value={studentName}
                              onChange={(e) => setStudentName(e.target.value)}
                              className="w-full text-xs p-2 rounded border border-zinc-250 dark:border-zinc-750 bg-zinc-50 dark:bg-zinc-850 outline-none text-zinc-700 dark:text-zinc-300 focus:ring-1 focus:ring-indigo-500"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <label className="text-[10px] text-zinc-700 dark:text-zinc-300 font-semibold block">
                                Matric No
                              </label>
                              <input
                                type="text"
                                value={matricNumber}
                                onChange={(e) => setMatricNumber(e.target.value)}
                                className="w-full text-xs p-2 rounded border border-zinc-250 dark:border-zinc-750 bg-zinc-50 dark:bg-zinc-850 outline-none text-zinc-700 dark:text-zinc-300 focus:ring-1 focus:ring-indigo-500"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] text-zinc-700 dark:text-zinc-300 font-semibold block">
                                Supervisor
                              </label>
                              <input
                                type="text"
                                value={supervisorName}
                                onChange={(e) => setSupervisorName(e.target.value)}
                                className="w-full text-xs p-2 rounded border border-zinc-250 dark:border-zinc-750 bg-zinc-50 dark:bg-zinc-850 outline-none text-zinc-700 dark:text-zinc-300 focus:ring-1 focus:ring-indigo-500"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </details>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                      Prompt WordPI AI
                    </label>
                    {activeAiModel && (
                      <span className="text-[9px] font-mono bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 px-1.5 py-0.5 rounded">
                        {activeAiModel}
                      </span>
                    )}
                  </div>
                  <textarea
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="E.g., Go to page 2 and expand the limitations paragraph..."
                    className="w-full text-xs p-2.5 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-indigo-500 bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700 dark:focus:ring-indigo-600 outline-none text-zinc-700 dark:text-zinc-300 h-24 resize-none"
                  />
                  <div className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-normal bg-zinc-50/50 dark:bg-zinc-900/50 p-2 rounded border border-zinc-150 dark:border-zinc-800 border-dashed">
                    💡 <strong>Pro Tip:</strong> Type <strong>page 2</strong>, <strong>Chapter 2</strong>, or <strong>section 1.2</strong> in your prompt. WordPI will automatically find and target that exact part of your document!
                  </div>
                  <button
                    disabled={isSimulatingAI || !aiPrompt.trim()}
                    onClick={() => handleAiAction('custom')}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-xs font-semibold shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-1.5"
                  >
                    {isSimulatingAI ? (
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    ) : (
                      <Edit3 className="w-3.5 h-3.5" />
                    )}
                    <span>Generate Response</span>
                  </button>
                </div>

                <div className="w-full h-[1px] bg-zinc-200 dark:bg-zinc-800 my-2"></div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider block">
                    One-Click Prompt Presets
                  </label>
                  <div className="grid grid-cols-1 gap-2">
                    <button
                      onClick={() => setShowGeneratorPopup(true)}
                      className="w-full text-left p-2.5 rounded-lg border border-indigo-200 dark:border-indigo-900 bg-indigo-50/55 hover:bg-indigo-100/70 dark:bg-indigo-950/20 dark:hover:bg-indigo-950/40 text-xs font-semibold text-indigo-750 dark:text-indigo-300 transition-all group flex items-center justify-between cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5">
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Generate Full Document Blueprint</span>
                      </span>
                      <ChevronRight className="w-3 h-3 text-indigo-550 group-hover:translate-x-0.5 transition-transform" />
                    </button>

                    <button
                      onClick={() => handleAiAction('intro')}
                      className="w-full text-left p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-850 hover:bg-indigo-50 hover:border-indigo-200 dark:hover:bg-indigo-950/20 dark:hover:border-indigo-900/30 text-xs font-medium transition-all group flex items-center justify-between"
                    >
                      <span>Generate Chapter 1 Intro Blueprint</span>
                      <ChevronRight className="w-3 h-3 text-zinc-400 group-hover:text-indigo-500 transition-colors" />
                    </button>
                    
                    <button
                      onClick={() => handleAiAction('humanize')}
                      className="w-full text-left p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-950 bg-emerald-50/10 hover:bg-emerald-50/20 dark:bg-emerald-950/5 dark:hover:bg-emerald-950/15 text-xs font-semibold text-emerald-800 dark:text-emerald-350 transition-all group flex items-center justify-between cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Humanize Selection (Bypass AI Detectors)</span>
                      </span>
                      <ChevronRight className="w-3 h-3 text-emerald-550 group-hover:translate-x-0.5 transition-transform" />
                    </button>

                    <button
                      onClick={() => handleAiAction('rephrase')}
                      className="w-full text-left p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-850 hover:bg-indigo-50 hover:border-indigo-200 dark:hover:bg-indigo-950/20 dark:hover:border-indigo-900/30 text-xs font-medium transition-all group flex items-center justify-between"
                    >
                      <span>Academic Rephraser (Select text first)</span>
                      <ChevronRight className="w-3 h-3 text-zinc-400 group-hover:text-indigo-500 transition-colors" />
                    </button>

                    <button
                      onClick={() => handleAiAction('outline')}
                      className="w-full text-left p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-850 hover:bg-indigo-50 hover:border-indigo-200 dark:hover:bg-indigo-950/20 dark:hover:border-indigo-900/30 text-xs font-medium transition-all group flex items-center justify-between"
                    >
                      <span>Draft Thesis Outline</span>
                      <ChevronRight className="w-3 h-3 text-zinc-400 group-hover:text-indigo-500 transition-colors" />
                    </button>
                  </div>
                </div>

                {/* AI Outputs Block */}
                {isSimulatingAI && !simulatedAiResult && (
                  <div className="border border-indigo-100 rounded-lg p-4 bg-indigo-50/20 dark:border-indigo-950 dark:bg-indigo-950/10 space-y-2 animate-pulse">
                    <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-1/3"></div>
                    <div className="space-y-1">
                      <div className="h-3 bg-zinc-200 dark:bg-zinc-800 rounded w-full"></div>
                      <div className="h-3 bg-zinc-200 dark:bg-zinc-800 rounded w-5/6"></div>
                      <div className="h-3 bg-zinc-200 dark:bg-zinc-800 rounded w-2/3"></div>
                    </div>
                  </div>
                )}

                {simulatedAiResult && (
                  <div className="border border-indigo-200 dark:border-indigo-850 rounded-lg p-3 bg-indigo-50/10 dark:bg-indigo-950/20 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] font-bold text-indigo-500 uppercase tracking-wide">
                        {isSimulatingAI ? 'Streaming Output...' : 'Streamed Output'}
                      </div>
                      {isSimulatingAI && (
                        <div className="w-2 h-2 bg-indigo-500 rounded-full animate-ping"></div>
                      )}
                    </div>
                    
                    {aiSelectedText ? (
                      <div className="space-y-2.5">
                        <div className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wide">
                          Suggested Change Comparison
                        </div>
                        
                        {/* Strikethrough box (Original selection to be removed/replaced) */}
                        <div className="border border-red-200 dark:border-red-950/60 rounded-lg p-2.5 bg-red-50/5 dark:bg-red-950/5 relative overflow-hidden">
                          <div className="absolute top-1 right-2 text-[9px] font-bold text-red-500/70 uppercase">
                            Original (To Remove)
                          </div>
                          <div className="text-xs text-red-750 dark:text-red-400 line-through pr-12 break-words leading-relaxed">
                            {aiSelectedText}
                          </div>
                        </div>

                        {/* Insertion box (AI suggestion to be added) */}
                        <div className="border border-emerald-250 dark:border-emerald-950/60 rounded-lg p-2.5 bg-emerald-50/5 dark:bg-emerald-950/5 relative overflow-hidden">
                          <div className="absolute top-1 right-2 text-[9px] font-bold text-emerald-550/70 uppercase">
                            Replacement (To Apply)
                          </div>
                          <div 
                            className="text-xs text-emerald-800 dark:text-emerald-350 pr-12 break-words space-y-1.5 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5 [&_strong]:font-bold [&_em]:italic [&_h1]:text-base [&_h1]:font-bold [&_h2]:text-sm [&_h2]:font-bold [&_h3]:text-xs [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-emerald-500 [&_blockquote]:pl-2 [&_blockquote]:italic [&_code]:bg-emerald-100/50 [&_code]:dark:bg-emerald-950/50 [&_code]:px-1 [&_code]:rounded [&_code]:font-mono [&_p]:my-1 leading-relaxed"
                            dangerouslySetInnerHTML={{ __html: formatAiResponseToHtml(simulatedAiResult) }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div 
                        className="text-xs space-y-2 text-zinc-650 dark:text-zinc-300 max-h-48 overflow-y-auto border border-dashed border-zinc-200 dark:border-zinc-800 p-2 bg-white dark:bg-zinc-900 rounded font-normal leading-relaxed [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-1 [&_strong]:font-bold [&_em]:italic [&_h1]:text-base [&_h1]:font-bold [&_h1]:mt-2 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-2 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:mt-1.5 [&_blockquote]:border-l-2 [&_blockquote]:border-indigo-500 [&_blockquote]:pl-2 [&_blockquote]:italic [&_code]:bg-zinc-100 [&_code]:dark:bg-zinc-800 [&_code]:px-1 [&_code]:rounded [&_code]:font-mono [&_pre]:bg-zinc-100 [&_pre]:dark:bg-zinc-800 [&_pre]:p-2 [&_pre]:rounded [&_pre]:font-mono [&_pre]:overflow-x-auto [&_p]:my-1"
                        dangerouslySetInnerHTML={{ __html: formatAiResponseToHtml(simulatedAiResult) }}
                      />
                    )}
                    
                    <div className="flex flex-col gap-2 pt-1">
                      {aiSelectedText ? (
                        <>
                          <button
                            disabled={isSimulatingAI}
                            onClick={replaceSelectionContent}
                            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-md py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            Replace Selection
                          </button>
                          <button
                            disabled={isSimulatingAI}
                            onClick={insertAiContent}
                            className="w-full border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 dark:hover:text-zinc-50 text-zinc-700 dark:text-zinc-300 rounded-md py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                          >
                            Insert at Cursor
                          </button>
                        </>
                      ) : (
                        <button
                          disabled={isSimulatingAI}
                          onClick={insertAiContent}
                          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-md py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                          Insert at Cursor
                        </button>
                      )}
                      
                      <button
                        disabled={isSimulatingAI}
                        onClick={discardAiContent}
                        className="w-full border border-red-200 hover:bg-red-50 dark:border-red-950 dark:hover:bg-red-950/20 text-red-650 dark:text-red-400 rounded-md py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Discard Suggestion
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Sidebar Footer Information */}
              <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-[10px] text-zinc-400 dark:text-zinc-500 space-y-1">
                <p>WordPI AI parameters:</p>
                <ul className="list-disc pl-3.5 space-y-0.5">
                  <li>Model: WordPI Flash</li>
                  <li>Rate Limit: 15 Requests / min</li>
                  <li>Client API Secret obfuscated via Next.js routes</li>
                </ul>
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Editor Status Bar */}
      <footer className="flex items-center justify-between px-6 py-2 border-t bg-white border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-400 z-10 select-none">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-1">
            <span className="font-semibold">{wordCount}</span>
            <span>words</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="font-semibold">{charCount}</span>
            <span>characters</span>
          </div>
          <div className="flex items-center gap-1.5 text-zinc-400">
            <Clock className="w-3.5 h-3.5" />
            <span>{readTime} min read</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono border border-zinc-200 dark:border-zinc-700 px-1.5 py-0.5 rounded bg-zinc-50 dark:bg-zinc-800">
            A4 Canvas (794x1123px)
          </span>
          <span>100% Zoom</span>
        </div>
      </footer>

      {showFloatingPopup && popupCoords && (
        <div 
          ref={popupRef}
          style={{ 
            position: 'fixed', 
            top: `${Math.max(80, Math.min(window.innerHeight - 320, popupCoords.top - 120))}px`, 
            left: `${Math.max(20, Math.min(window.innerWidth - 325, popupCoords.left - 140))}px`, 
            zIndex: 100 
          }}
          className="w-80 bg-white dark:bg-zinc-900 border border-indigo-200 dark:border-indigo-850 rounded-xl shadow-2xl p-4 flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-1.5">
            <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-650 dark:text-indigo-400 uppercase tracking-wider">
              <Edit3 className="w-3.5 h-3.5" />
              <span>Contextual Editor</span>
            </div>
            <button 
              onClick={() => {
                setShowFloatingPopup(false)
                setSimulatedAiResult('')
                setAiSelectedText('')
              }}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-xs p-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              <Minimize2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {!simulatedAiResult ? (
            <div className="space-y-3">
              <div className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-normal">
                <span className="font-semibold text-zinc-700 dark:text-zinc-300 block mb-0.5">Target Paragraph Context:</span>
                <p className="line-clamp-2 italic bg-zinc-50 dark:bg-zinc-950 p-1.5 rounded border border-zinc-150 dark:border-zinc-850 text-zinc-600 dark:text-zinc-400">
                  "{popupContextText}"
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <textarea
                  value={popupPrompt}
                  onChange={(e) => setPopupPrompt(e.target.value)}
                  placeholder="Ask AI to rewrite, correct, or expand..."
                  className="w-full text-xs p-2 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-indigo-500 bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700 outline-none text-zinc-700 dark:text-zinc-300 h-16 resize-none"
                />
                <button
                  disabled={isSimulatingAI || !popupPrompt.trim()}
                  onClick={() => handlePopupAiAction()}
                  className="w-full bg-indigo-650 hover:bg-indigo-700 text-white rounded-lg py-1.5 text-xs font-semibold shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {isSimulatingAI ? (
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <span>Apply Instruction</span>
                  )}
                </button>
              </div>

              <div className="flex flex-col gap-1">
                <div className="text-[9px] font-bold text-zinc-400 uppercase tracking-wide">Quick Presets</div>
                <div className="flex flex-wrap gap-1">
                  {['Fix Grammar', 'Academic Tone', 'Summarize', 'Make Concise'].map((preset) => (
                    <button
                      key={preset}
                      disabled={isSimulatingAI}
                      onClick={() => handlePopupAiAction(preset)}
                      className="text-[10px] px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/50 dark:text-indigo-300 rounded border border-indigo-100/60 dark:border-indigo-900/40 cursor-pointer"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                  Review Suggestions
                </div>
                
                {/* Strikethrough box (Original selection to be replaced) */}
                <div className="border border-red-200 dark:border-red-950/60 rounded-lg p-2 bg-red-50/5 dark:bg-red-950/5 max-h-24 overflow-y-auto">
                  <div className="text-[9px] font-bold text-red-500/80 uppercase mb-0.5">Original</div>
                  <div className="text-[11px] text-red-750 dark:text-red-400 line-through leading-relaxed">
                    {popupContextText}
                  </div>
                </div>

                {/* Insertion box (AI suggestion to be added) */}
                <div className="border border-emerald-250 dark:border-emerald-950/60 rounded-lg p-2 bg-emerald-50/5 dark:bg-emerald-950/5 max-h-32 overflow-y-auto">
                  <div className="text-[9px] font-bold text-emerald-550/80 uppercase mb-0.5">AI Suggestion</div>
                  <div 
                    className="text-[11px] text-emerald-800 dark:text-emerald-300 leading-relaxed space-y-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5 [&_strong]:font-bold [&_em]:italic [&_p]:my-0.5"
                    dangerouslySetInnerHTML={{ __html: formatAiResponseToHtml(simulatedAiResult) }}
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  disabled={isSimulatingAI}
                  onClick={acceptPopupSuggestion}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg py-1.5 text-xs font-semibold flex items-center justify-center gap-1 shadow-sm cursor-pointer disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" />
                  Accept
                </button>
                <button
                  disabled={isSimulatingAI}
                  onClick={rejectPopupSuggestion}
                  className="flex-1 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300 rounded-lg py-1.5 text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Reject
                </button>
              </div>
            </div>
          )}
        </div>
      )}
        </>
      )}

      {showWizard && (
        <div className="fixed inset-0 bg-zinc-950/65 backdrop-blur-md z-50 flex items-center justify-center transition-all p-4 select-none">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
            {/* Header Banner */}
            <div className="bg-gradient-to-r from-indigo-600 to-indigo-800 px-6 py-5 text-white relative">
              <h3 className="font-bold text-base flex items-center gap-2">
                <img src="/WordPI.png" alt="WordPI Logo" className="w-5.5 h-5.5 object-contain bg-white/15 p-0.5 rounded" />
                <span>WordPI Onboarding Wizard</span>
              </h3>
              <p className="text-[11px] text-indigo-100 mt-1">
                Configure your writing assistant and ingest source context in less than a minute.
              </p>
              
              <div className="absolute top-5 right-6 flex items-center gap-1.5">
                {[1, 2, 3].map((step) => (
                  <div 
                    key={step}
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold border transition-colors ${
                      wizardStep === step 
                        ? 'bg-white text-indigo-700 border-white' 
                        : 'bg-indigo-700/50 text-indigo-200 border-indigo-500/50'
                    }`}
                  >
                    {step}
                  </div>
                ))}
              </div>
            </div>

            {/* Step Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              
              {/* Step 1: Project Details */}
              {wizardStep === 1 && (
                <div className="space-y-4">
                  {/* Topic Input */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block">
                      1. Topic / Title
                    </label>
                    <input
                      type="text"
                      value={wizardTopic}
                      onChange={(e) => setWizardTopic(e.target.value)}
                      placeholder="e.g., The Impact of Renewable Energy on Developing Economies"
                      className="w-full text-xs p-3 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-indigo-500 bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700 outline-none text-zinc-700 dark:text-zinc-300 font-medium"
                    />
                  </div>

                  {/* Document Type Selection */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block">
                      2. Document Type
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleDocTypeChange('Seminar')}
                        className={`p-3 rounded-xl border text-left transition-all relative ${
                          wizardDocType === 'Seminar'
                            ? 'border-indigo-600 bg-indigo-50/20 text-indigo-750 dark:border-indigo-500 dark:bg-indigo-950/20 dark:text-indigo-300 ring-2 ring-indigo-500/50'
                            : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-850'
                        }`}
                      >
                        <div className="text-xs font-bold flex items-center gap-1.5">
                          Seminar
                          {wizardDocType === 'Seminar' && <Check className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />}
                        </div>
                        <div className="text-[10px] text-zinc-400 dark:text-zinc-550 mt-1 leading-relaxed">
                          4-chapter seminar layout. Auto-applies Times New Roman & double spacing.
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDocTypeChange('Proposal')}
                        className={`p-3 rounded-xl border text-left transition-all relative ${
                          wizardDocType === 'Proposal'
                            ? 'border-indigo-600 bg-indigo-50/20 text-indigo-750 dark:border-indigo-500 dark:bg-indigo-950/20 dark:text-indigo-300 ring-2 ring-indigo-500/50'
                            : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-850'
                        }`}
                      >
                        <div className="text-xs font-bold flex items-center gap-1.5">
                          Proposal
                          {wizardDocType === 'Proposal' && <Check className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />}
                        </div>
                        <div className="text-[10px] text-zinc-400 dark:text-zinc-550 mt-1 leading-relaxed">
                          3-chapter research proposal draft with methodology.
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDocTypeChange('Project')}
                        className={`p-3 rounded-xl border text-left transition-all relative ${
                          wizardDocType === 'Project'
                            ? 'border-indigo-600 bg-indigo-50/20 text-indigo-750 dark:border-indigo-500 dark:bg-indigo-950/20 dark:text-indigo-300 ring-2 ring-indigo-500/50'
                            : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-850'
                        }`}
                      >
                        <div className="text-xs font-bold flex items-center gap-1.5">
                          Project
                          {wizardDocType === 'Project' && <Check className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />}
                        </div>
                        <div className="text-[10px] text-zinc-400 dark:text-zinc-550 mt-1 leading-relaxed">
                          5-chapter complete academic project thesis framework.
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDocTypeChange('Custom')}
                        className={`p-3 rounded-xl border text-left transition-all relative ${
                          wizardDocType === 'Custom'
                            ? 'border-indigo-600 bg-indigo-50/20 text-indigo-750 dark:border-indigo-500 dark:bg-indigo-950/20 dark:text-indigo-300 ring-2 ring-indigo-500/50'
                            : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-850'
                        }`}
                      >
                        <div className="text-xs font-bold flex items-center gap-1.5">
                          Custom
                          {wizardDocType === 'Custom' && <Check className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />}
                        </div>
                        <div className="text-[10px] text-zinc-400 dark:text-zinc-550 mt-1 leading-relaxed">
                          Provide your own chapter outlines or extract from file reference.
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Custom Chapter Outline Input (Conditional) */}
                  {wizardDocType === 'Custom' && (
                    <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
                      <label className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block">
                        Custom Outline headings (one per line)
                      </label>
                      <textarea
                        value={customChapterOutline}
                        onChange={(e) => setCustomChapterOutline(e.target.value)}
                        placeholder="e.g.&#10;Chapter 1: Background&#10;Chapter 2: Context Analysis"
                        className="w-full text-xs p-3 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-indigo-500 bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700 outline-none text-zinc-700 dark:text-zinc-300 h-24 resize-none font-mono leading-normal"
                      />
                    </div>
                  )}
                                {/* Seminar Report Personalized Details (Conditional) */}
                  {wizardDocType === 'Seminar' && (
                    <div className="space-y-3 p-3 bg-zinc-50 dark:bg-zinc-850 rounded-xl border border-zinc-150 dark:border-zinc-800 animate-in fade-in slide-in-from-top-1 duration-200">
                      <div className="text-[10px] font-bold text-zinc-400 dark:text-zinc-550 uppercase tracking-wider">
                        Personalized Seminar Info (for Cover Page)
                      </div>
                      
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-zinc-600 dark:text-zinc-450 font-bold uppercase tracking-wider block">
                          Student Full Name
                        </label>
                        <input
                          type="text"
                          value={studentName}
                          onChange={(e) => setStudentName(e.target.value)}
                          placeholder="e.g. Adedayo Adeyinka Daniel"
                          className="w-full text-xs p-2.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 outline-none text-zinc-700 dark:text-zinc-300 focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1.5">
                          <label className="text-[10px] text-zinc-600 dark:text-zinc-450 font-bold uppercase tracking-wider block">
                            Matric Number
                          </label>
                          <input
                            type="text"
                            value={matricNumber}
                            onChange={(e) => setMatricNumber(e.target.value)}
                            placeholder="e.g. F/HD/24/3410001"
                            className="w-full text-xs p-2.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 outline-none text-zinc-700 dark:text-zinc-300 focus:ring-1 focus:ring-indigo-500"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[10px] text-zinc-600 dark:text-zinc-450 font-bold uppercase tracking-wider block">
                            Supervisor Name
                          </label>
                          <input
                            type="text"
                            value={supervisorName}
                            onChange={(e) => setSupervisorName(e.target.value)}
                            placeholder="e.g. Dr. Olalekan Bello"
                            className="w-full text-xs p-2.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 outline-none text-zinc-700 dark:text-zinc-300 focus:ring-1 focus:ring-indigo-500"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Typography & Spacing Options */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block">
                        3. Font Family
                      </label>
                      <select
                        value={wizardFontFamily}
                        onChange={(e) => setWizardFontFamily(e.target.value as any)}
                        className="w-full text-xs p-3 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-indigo-500 bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700 outline-none text-zinc-700 dark:text-zinc-300"
                      >
                        <option value="default">Default theme font</option>
                        <option value="arial">Arial (Sans-serif)</option>
                        <option value="georgia">Georgia (Editorial Serif)</option>
                        <option value="playfair">Times New Roman / Playfair (APA)</option>
                        <option value="inter">Inter (Clean UI)</option>
                        <option value="courier">Courier (Draft Monospace)</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block">
                        4. Line Spacing
                      </label>
                      <select
                        value={wizardLineSpacing}
                        onChange={(e) => setWizardLineSpacing(e.target.value)}
                        className="w-full text-xs p-3 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-indigo-500 bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700 outline-none text-zinc-700 dark:text-zinc-300"
                      >
                        <option value="1.0">Single spaced (1.0)</option>
                        <option value="1.15">Compact (1.15)</option>
                        <option value="1.5">Standard Academic (1.5)</option>
                        <option value="1.8">Comfortable (1.8)</option>
                        <option value="2.0">Double spaced APA (2.0)</option>
                      </select>
                    </div>
                  </div>

                  {/* Target Academic Level */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block">
                      5. Target Academic Level
                    </label>
                    <select
                      value={wizardAcademicLevel}
                      onChange={(e) => setWizardAcademicLevel(e.target.value)}
                      className="w-full text-xs p-3 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-indigo-500 bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700 outline-none text-zinc-700 dark:text-zinc-300"
                    >
                      <option value="High School">High School (Simple & Direct)</option>
                      <option value="Undergraduate">Undergraduate (Academic & Structured)</option>
                      <option value="Master's">Master's (Authoritative & Rigorous)</option>
                      <option value="Ph.D.">Ph.D. / Researcher (Highly Technical & Analytical)</option>
                    </select>
                  </div>

                  {/* Upload Formatting Style Reference */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block">
                      6. Formatting Style Reference File (Optional)
                    </label>
                    <label className="flex border border-dashed border-zinc-300 dark:border-zinc-700 hover:border-indigo-400 dark:hover:border-indigo-650 rounded-lg p-3 items-center justify-center gap-2 cursor-pointer transition-all bg-zinc-50/50 dark:bg-zinc-900/30 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                      <Upload className="w-4 h-4 text-zinc-400" />
                      <span>{isProcessingSource ? 'Extracting style elements...' : 'Upload Style Reference (.docx, .pdf)'}</span>
                      <input
                        type="file"
                        accept=".docx,.pdf"
                        disabled={isProcessingSource}
                        onChange={handleStyleReferenceUpload}
                        className="hidden"
                      />
                    </label>
                  </div>

                  <div className="bg-zinc-50 dark:bg-zinc-850 p-3 rounded-lg border border-zinc-150 dark:border-zinc-800 text-[10px] text-zinc-500 dark:text-zinc-450 leading-relaxed">
                    <strong>Layout Guide:</strong> Selecting "Seminar", "Proposal" or "Project" configures the chapters automatically. Use Custom or Upload a Style Reference document to extract formatting rules.
                  </div>
                </div>
              )}

              {/* Step 2: Context Ingestion */}
              {wizardStep === 2 && (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                      Upload Source Context (PDF or DOCX)
                    </h4>
                    <p className="text-[11px] text-zinc-400">
                      Ingest reference books, drafts, or syllabus documents into your WordPI local context window.
                    </p>
                  </div>

                  {/* Drag and Drop Zone */}
                  <label className="border-2 border-dashed border-zinc-200 hover:border-indigo-400 dark:border-zinc-750 dark:hover:border-indigo-650 rounded-xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all bg-zinc-50/50 dark:bg-zinc-900/30">
                    <Upload className="w-8 h-8 text-zinc-400 group-hover:text-indigo-500" />
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      {isProcessingSource ? 'Parsing documents...' : 'Click to upload files'}
                    </span>
                    <span className="text-[10px] text-zinc-450 dark:text-zinc-500">
                      Supports Word (.docx) and PDF (.pdf) files
                    </span>
                    <input
                      type="file"
                      accept=".docx,.pdf"
                      multiple
                      disabled={isProcessingSource}
                      onChange={handleWizardFileUpload}
                      className="hidden"
                    />
                  </label>

                  {/* Processing spinner */}
                  {isProcessingSource && (
                    <div className="flex items-center justify-center gap-2 py-2">
                      <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                      <span className="text-xs font-medium text-zinc-500">Processing file buffers...</span>
                    </div>
                  )}

                  {/* Sources List */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wide block">
                      Ingested Sources ({projectSources.length})
                    </label>
                    {projectSources.length === 0 ? (
                      <div className="text-xs italic text-zinc-400 text-center py-4 bg-zinc-50 dark:bg-zinc-850 rounded border border-dashed border-zinc-200 dark:border-zinc-800">
                        No reference files uploaded yet.
                      </div>
                    ) : (
                      <div className="max-h-36 overflow-y-auto space-y-1.5">
                        {projectSources.map((source, index) => (
                          <div 
                            key={index}
                            className="flex items-center justify-between p-2 bg-zinc-50 dark:bg-zinc-850 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs"
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <FileText className={`w-4 h-4 flex-shrink-0 ${source.type === 'pdf' ? 'text-red-500' : 'text-blue-500'}`} />
                              <span className="truncate text-zinc-700 dark:text-zinc-300 font-medium" title={source.name}>
                                {source.name}
                              </span>
                              <span className="text-[9px] bg-zinc-250 dark:bg-zinc-700 px-1 rounded text-zinc-500 dark:text-zinc-400 uppercase font-mono">
                                {source.type}
                              </span>
                            </div>
                            <button
                              onClick={() => deleteIngestedSourceAtIndex(index)}
                              className="text-red-500 hover:text-red-750 p-1 rounded hover:bg-red-55/20 cursor-pointer"
                              title="Delete source"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 3: Setup Choice */}
              {wizardStep === 3 && (
                <div className="space-y-4">
                  <div className="space-y-1 text-center pb-2">
                    <h4 className="text-sm font-bold text-zinc-700 dark:text-zinc-200">
                      Configuration Complete!
                    </h4>
                    <p className="text-xs text-zinc-400">
                      How would you like to initialize the editor canvas?
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-2.5">
                    {/* Option A: Import First Source Document */}
                    <button
                      disabled={projectSources.length === 0}
                      onClick={() => handleWizardComplete('import')}
                      className={`w-full p-4 rounded-xl border text-left flex items-start gap-3 transition-all cursor-pointer ${
                        projectSources.length === 0
                          ? 'opacity-50 border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 cursor-not-allowed'
                          : 'border-zinc-200 dark:border-zinc-800 hover:bg-indigo-50/20 hover:border-indigo-300 dark:hover:bg-indigo-950/10 dark:hover:border-indigo-900/30'
                      }`}
                    >
                      <FileText className="w-5 h-5 text-indigo-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                          Import Primary Document Draft
                        </div>
                        <div className="text-[10px] text-zinc-450 dark:text-zinc-500 mt-0.5">
                          {projectSources.length > 0 
                            ? `Load "${projectSources[0].name}" into the editor canvas preserving its layout and formatting.`
                            : "Upload a Word or PDF file in Step 2 to enable this option."}
                        </div>
                      </div>
                    </button>

                    {/* Option B: AI Blueprint Generation */}
                    <button
                      onClick={() => handleWizardComplete('ai_blueprint')}
                      className="w-full p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 text-left flex items-start gap-3 hover:bg-indigo-50/20 hover:border-indigo-300 dark:hover:bg-indigo-950/10 dark:hover:border-indigo-900/30 transition-all cursor-pointer"
                    >
                      <Edit3 className="w-5 h-5 text-indigo-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                          Generate AI Thesis Blueprint & Outline
                        </div>
                        <div className="text-[10px] text-zinc-450 dark:text-zinc-500 mt-0.5">
                          Drafts a structured academic chapter outline and an introductory paragraph matching your topic and sources.
                        </div>
                      </div>
                    </button>

                    {/* Option C: Blank Slate */}
                    <button
                      onClick={() => handleWizardComplete('blank')}
                      className="w-full p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 text-left flex items-start gap-3 hover:bg-indigo-50/20 hover:border-indigo-300 dark:hover:bg-indigo-950/10 dark:hover:border-indigo-900/30 transition-all cursor-pointer"
                    >
                      <Check className="w-5 h-5 text-indigo-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                          Start Blank Canvas
                        </div>
                        <div className="text-[10px] text-zinc-450 dark:text-zinc-500 mt-0.5">
                          Opens a blank workspace with your topic, keeping the references in your sidebar's context window.
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Footer Buttons */}
            <div className="border-t border-zinc-150 dark:border-zinc-850 px-6 py-4 bg-zinc-50 dark:bg-zinc-900/40 flex justify-between items-center">
              <div>
                {wizardStep > 1 && (
                  <button
                    onClick={() => setWizardStep(wizardStep - 1)}
                    className="px-4 py-2 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg text-xs font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                  >
                    Back
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowWizard(false)
                    if (editor && !editor.getText().trim()) {
                      editor.commands.setContent(ensurePaginatedHtml(DEFAULT_CONTENT))
                    }
                  }}
                  className="px-4 py-2 text-zinc-500 hover:text-zinc-750 dark:text-zinc-400 dark:hover:text-zinc-200 text-xs font-semibold cursor-pointer"
                >
                  Skip Wizard (Load Default)
                </button>
                {wizardStep < 3 ? (
                  <button
                    disabled={wizardStep === 1 && !wizardTopic.trim()}
                    onClick={() => setWizardStep(wizardStep + 1)}
                    className="px-5 py-2 bg-indigo-650 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}

      {showImportModal && importFileData && (
        <div className="fixed inset-0 bg-zinc-950/65 backdrop-blur-md z-50 flex items-center justify-center transition-all p-4 select-none animate-fade-in">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
            {/* Header Banner */}
            <div className="bg-gradient-to-r from-indigo-600 to-indigo-800 px-6 py-4 text-white">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <FileText className="w-4 h-4" />
                <span>Import Document Formatter</span>
              </h3>
              <p className="text-[10px] text-indigo-100 mt-0.5">
                Customize how your document is imported and formatted on the canvas.
              </p>
            </div>

            {/* Content */}
            <div className="p-5 space-y-4">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                <span className="font-semibold text-zinc-700 dark:text-zinc-300">File Name: </span>
                <span className="italic">{importFileData.name}</span>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wide block">
                  Select Import Option
                </label>
                <div className="space-y-2.5">
                  {/* Maintain Original Formatting */}
                  <label className="flex items-start gap-3 p-3 rounded-lg border border-zinc-205 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-850 cursor-pointer transition-colors">
                    <input
                      type="radio"
                      name="import-option"
                      checked={importOption === 'maintain'}
                      onChange={() => setImportOption('maintain')}
                      className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <div className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                        Maintain Original Styling
                      </div>
                      <div className="text-[10px] text-zinc-450 dark:text-zinc-500 mt-0.5">
                        Keeps headings, lists, bold, and italic formatting parsed directly from the file.
                      </div>
                    </div>
                  </label>

                  {/* Format as Seminar Paper */}
                  <label className="flex items-start gap-3 p-3 rounded-lg border border-zinc-205 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-850 cursor-pointer transition-colors">
                    <input
                      type="radio"
                      name="import-option"
                      checked={importOption === 'seminar'}
                      onChange={() => setImportOption('seminar')}
                      className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <div className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                        Format as Seminar Paper Template
                      </div>
                      <div className="text-[10px] text-zinc-455 dark:text-zinc-500 mt-0.5">
                        Applies Arial font, 1.5 line height, and clean academic heading structures.
                      </div>
                    </div>
                  </label>

                  {/* Format as Academic Essay (APA) */}
                  <label className="flex items-start gap-3 p-3 rounded-lg border border-zinc-205 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-850 cursor-pointer transition-colors">
                    <input
                      type="radio"
                      name="import-option"
                      checked={importOption === 'apa'}
                      onChange={() => setImportOption('apa')}
                      className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <div className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                        Format as Academic Essay (APA)
                      </div>
                      <div className="text-[10px] text-zinc-455 dark:text-zinc-500 mt-0.5">
                        Applies Playfair font and double line-spacing (2.0) standard in APA papers.
                      </div>
                    </div>
                  </label>

                  {/* Format as Technical Report (IEEE) */}
                  <label className="flex items-start gap-3 p-3 rounded-lg border border-zinc-205 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-850 cursor-pointer transition-colors">
                    <input
                      type="radio"
                      name="import-option"
                      checked={importOption === 'ieee'}
                      onChange={() => setImportOption('ieee')}
                      className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <div className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                        Format as Technical Report (IEEE)
                      </div>
                      <div className="text-[10px] text-zinc-455 dark:text-zinc-500 mt-0.5">
                        Applies Arial font and tight single line-spacing (1.0) suitable for IEEE technical prints.
                      </div>
                    </div>
                  </label>

                  {/* Extract Text Only */}
                  <label className="flex items-start gap-3 p-3 rounded-lg border border-zinc-205 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-850 cursor-pointer transition-colors">
                    <input
                      type="radio"
                      name="import-option"
                      checked={importOption === 'text_only'}
                      onChange={() => setImportOption('text_only')}
                      className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <div className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                        Extract Plain Text Only
                      </div>
                      <div className="text-[10px] text-zinc-450 dark:text-zinc-500 mt-0.5">
                        Strips all heading sizes, tables, bold, and italic inline formatting. Imports text as raw paragraphs.
                      </div>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="bg-zinc-50 dark:bg-zinc-950 px-6 py-4 flex items-center justify-end gap-2 border-t border-zinc-150 dark:border-zinc-850">
              <button
                onClick={() => {
                  setShowImportModal(false)
                  setImportFileData(null)
                }}
                className="px-4 py-2 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg text-xs font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={confirmImportAction}
                className="px-5 py-2 bg-indigo-650 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow transition-colors cursor-pointer"
              >
                Confirm Import
              </button>
            </div>
          </div>
        </div>
      )}

      {showCoverPageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs select-none p-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl w-full max-w-lg p-6 animate-in fade-in zoom-in-95 duration-150 text-left">
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3 mb-4">
              <h3 className="font-bold text-sm text-zinc-800 dark:text-zinc-200 uppercase tracking-wider flex items-center gap-2">
                <FileText className="w-4 h-4 text-amber-500" />
                <span>Create Academic Cover Page</span>
              </h3>
              <button 
                onClick={() => setShowCoverPageModal(false)}
                className="p-1 text-zinc-400 hover:text-zinc-650 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded cursor-pointer"
              >
                <Minimize2 className="w-4 h-4" />
              </button>
            </div>
            
            <div className="space-y-3.5 max-h-[70vh] overflow-y-auto pr-1">
              <div>
                <label className="block text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1">Project Title</label>
                <input 
                  type="text" 
                  value={coverDetails.title}
                  onChange={(e) => setCoverDetails({ ...coverDetails, title: e.target.value })}
                  placeholder="e.g. DESIGN OF AN OFFLINE-FIRST DOCUMENT SYSTEM"
                  className="w-full px-3 py-1.5 text-xs bg-zinc-50 border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 text-zinc-800 dark:text-zinc-150 rounded outline-none focus:ring-1.5 focus:ring-amber-500"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1">Student Name</label>
                  <input 
                    type="text" 
                    value={coverDetails.studentName}
                    onChange={(e) => setCoverDetails({ ...coverDetails, studentName: e.target.value })}
                    placeholder="e.g. SAMSON BELOVED"
                    className="w-full px-3 py-1.5 text-xs bg-zinc-50 border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 text-zinc-800 dark:text-zinc-150 rounded outline-none focus:ring-1.5 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1">Matric Number</label>
                  <input 
                    type="text" 
                    value={coverDetails.matricNo}
                    onChange={(e) => setCoverDetails({ ...coverDetails, matricNo: e.target.value })}
                    placeholder="e.g. HND/23/COM/1012"
                    className="w-full px-3 py-1.5 text-xs bg-zinc-50 border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 text-zinc-800 dark:text-zinc-150 rounded outline-none focus:ring-1.5 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1">Department</label>
                  <input 
                    type="text" 
                    value={coverDetails.department}
                    onChange={(e) => setCoverDetails({ ...coverDetails, department: e.target.value })}
                    placeholder="e.g. COMPUTER ENGINEERING"
                    className="w-full px-3 py-1.5 text-xs bg-zinc-50 border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 text-zinc-800 dark:text-zinc-150 rounded outline-none focus:ring-1.5 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1">Faculty</label>
                  <input 
                    type="text" 
                    value={coverDetails.faculty}
                    onChange={(e) => setCoverDetails({ ...coverDetails, faculty: e.target.value })}
                    placeholder="e.g. SCHOOL OF ENGINEERING"
                    className="w-full px-3 py-1.5 text-xs bg-zinc-50 border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 text-zinc-800 dark:text-zinc-150 rounded outline-none focus:ring-1.5 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1">Institution</label>
                <input 
                  type="text" 
                  value={coverDetails.institution}
                  onChange={(e) => setCoverDetails({ ...coverDetails, institution: e.target.value })}
                  placeholder="e.g. YABA COLLEGE OF TECHNOLOGY, YABA"
                  className="w-full px-3 py-1.5 text-xs bg-zinc-50 border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 text-zinc-800 dark:text-zinc-150 rounded outline-none focus:ring-1.5 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1">Supervisor's Name</label>
                <input 
                  type="text" 
                  value={coverDetails.supervisorName}
                  onChange={(e) => setCoverDetails({ ...coverDetails, supervisorName: e.target.value })}
                  placeholder="e.g. DR. O. A. ADEBOLA"
                  className="w-full px-3 py-1.5 text-xs bg-zinc-50 border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 text-zinc-800 dark:text-zinc-150 rounded outline-none focus:ring-1.5 focus:ring-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1">Academic Session</label>
                  <input 
                    type="text" 
                    value={coverDetails.academicSession}
                    onChange={(e) => setCoverDetails({ ...coverDetails, academicSession: e.target.value })}
                    placeholder="e.g. 2025/2026"
                    className="w-full px-3 py-1.5 text-xs bg-zinc-50 border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 text-zinc-800 dark:text-zinc-150 rounded outline-none focus:ring-1.5 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1">Submission Date</label>
                  <input 
                    type="text" 
                    value={coverDetails.submissionDate}
                    onChange={(e) => setCoverDetails({ ...coverDetails, submissionDate: e.target.value })}
                    placeholder="e.g. JULY 2026"
                    className="w-full px-3 py-1.5 text-xs bg-zinc-50 border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 text-zinc-800 dark:text-zinc-150 rounded outline-none focus:ring-1.5 focus:ring-amber-500"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-zinc-200 dark:border-zinc-800 pt-3 mt-4">
              <button 
                onClick={() => setShowCoverPageModal(false)}
                className="px-3 py-1.5 text-xs font-semibold text-zinc-650 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button 
                onClick={() => applyCoverPage(coverDetails)}
                className="px-3 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded transition-colors cursor-pointer shadow-xs"
              >
                Insert Cover Page
              </button>
            </div>
          </div>
        </div>
      )}

      {showGeneratorPopup && (
        <div className="fixed inset-0 bg-zinc-950/65 backdrop-blur-md z-50 flex items-center justify-center transition-all p-4 select-none">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200 text-left">
            {/* Header Banner */}
            <div className="bg-gradient-to-r from-indigo-600 to-indigo-800 px-6 py-5 text-white relative">
              <h3 className="font-bold text-base flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-white animate-pulse" />
                <span>One-Click Academic Seminar & Paper Generator</span>
              </h3>
              <p className="text-[11px] text-indigo-100 mt-1">
                Configure your document settings to instantly generate a fully realized academic draft.
              </p>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Topic / Seminar Topic */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block">
                  Seminar / Document Topic
                </label>
                <input
                  type="text"
                  value={documentTitle}
                  onChange={(e) => {
                    setDocumentTitle(e.target.value)
                    setIsSaved(false)
                  }}
                  placeholder="e.g., The Impact of Renewable Energy on Developing Economies"
                  className="w-full text-xs p-3 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-indigo-500 bg-zinc-50 dark:bg-zinc-850 dark:border-zinc-700 outline-none text-zinc-700 dark:text-zinc-300 font-medium"
                />
              </div>

              {/* Document Type & Academic Level */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block">
                    Document Type
                  </label>
                  <select
                    value={wizardDocType}
                    onChange={(e) => handleDocumentTypeChangeInEditor(e.target.value as any)}
                    className="w-full text-xs p-3 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-indigo-500 bg-zinc-50 dark:bg-zinc-850 dark:border-zinc-700 outline-none text-zinc-700 dark:text-zinc-300 cursor-pointer animate-fade-in"
                  >
                    <option value="Seminar">Seminar Report</option>
                    <option value="Proposal">Research Proposal</option>
                    <option value="Project">Graduation Thesis</option>
                    <option value="Custom">Custom Outline</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block">
                    Academic Level
                  </label>
                  <select
                    value={wizardAcademicLevel}
                    onChange={(e) => handleAcademicLevelChange(e.target.value)}
                    className="w-full text-xs p-3 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-indigo-500 bg-zinc-50 dark:bg-zinc-850 dark:border-zinc-700 outline-none text-zinc-700 dark:text-zinc-300 cursor-pointer"
                  >
                    <option value="High School">High School</option>
                    <option value="Undergraduate">Undergraduate</option>
                    <option value="Master's">Master's</option>
                    <option value="Ph.D.">Ph.D.</option>
                  </select>
                </div>
              </div>

              {/* Academic Tone */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block">
                  Academic Writing Tone
                </label>
                <select
                  value={wizardAcademicTone}
                  onChange={(e) => handleAcademicToneChange(e.target.value)}
                  className="w-full text-xs p-3 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-indigo-500 bg-zinc-50 dark:bg-zinc-850 dark:border-zinc-700 outline-none text-zinc-700 dark:text-zinc-300 cursor-pointer"
                >
                  <option value="Analytical">Analytical</option>
                  <option value="Scholarly">Scholarly / Formal</option>
                  <option value="Critical">Critical / Evaluative</option>
                  <option value="Objective">Objective / Neutral</option>
                  <option value="Persuasive">Persuasive / Argumentative</option>
                </select>
              </div>

              {/* Ingested journals & reference materials */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block">
                  Reference Journals & Sources ({projectSources.length})
                </label>
                {projectSources.length === 0 ? (
                  <div className="text-xs italic text-zinc-400 text-center py-4 bg-zinc-50 dark:bg-zinc-850 rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800">
                    No reference files uploaded yet. Upload reference journals below to synthesize them.
                  </div>
                ) : (
                  <div className="max-h-28 overflow-y-auto space-y-1.5 pr-1">
                    {projectSources.map((source, index) => (
                      <div 
                        key={index}
                        className="flex items-center justify-between p-2 bg-zinc-50 dark:bg-zinc-850 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <FileText className={`w-4 h-4 flex-shrink-0 ${source.type === 'pdf' ? 'text-red-500' : 'text-blue-500'}`} />
                          <span className="truncate text-zinc-700 dark:text-zinc-300 font-medium" title={source.name}>
                            {source.name}
                          </span>
                        </div>
                        <button
                          onClick={() => deleteIngestedSourceAtIndex(index)}
                          className="text-red-500 hover:text-red-750 p-1 rounded hover:bg-red-55/20 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Upload Action */}
                <label className="w-full flex items-center justify-center gap-1.5 bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-850 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-lg border border-zinc-250 dark:border-zinc-750 py-2 text-xs font-semibold transition-colors cursor-pointer">
                  <Upload className="w-3.5 h-3.5 text-zinc-400 animate-bounce" />
                  <span>{isProcessingSource ? 'Uploading and parsing references...' : 'Ingest PDF or Word Reference File'}</span>
                  <input
                    type="file"
                    accept=".docx,.pdf"
                    multiple
                    disabled={isProcessingSource}
                    onChange={handleWizardFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="bg-zinc-50 dark:bg-zinc-950 px-6 py-4 flex items-center justify-end gap-2 border-t border-zinc-150 dark:border-zinc-850">
              <button
                onClick={() => setShowGeneratorPopup(false)}
                className="px-4 py-2 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg text-xs font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setShowGeneratorPopup(false)
                  generateFullDocumentBlueprint()
                }}
                className="px-5 py-2 bg-indigo-650 hover:bg-indigo-750 text-white rounded-lg text-xs font-semibold shadow transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Generate Full Document</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
