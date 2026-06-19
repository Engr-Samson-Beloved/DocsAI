"use client"

import React, { useState, useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import FontFamily from '@tiptap/extension-font-family'
import { LineHeight } from './LineHeightExtension'
import { Underline } from './UnderlineExtension'
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
  Sparkles,
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
  Trash2
} from 'lucide-react'

// Default template content for the editor
const DEFAULT_CONTENT = `
<h1>An Analysis of AI-Assisted Document Editing for Academic Workflows</h1>
<p>This document is created using <strong>DocuAI</strong>, a client-side word processor optimized for educational and research tasks. It is running entirely in your browser without requiring a backend server.</p>
<h2>1. Project Vision</h2>
<p>Students face significant hurdles when compiling academic projects, including formatting compliance, citation structuring, and outline design. Traditional word processors offer formatting tools but lack context-aware assistance. DocuAI attempts to solve this by providing a highly responsive editor coupled with an offline-first data model.</p>
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

// Helper function to format raw markdown or code-blocked AI outputs to clean HTML tags.
// This ensures content inserts cleanly into the Tiptap document tree with proper styles.
const formatAiResponseToHtml = (text: string): string => {
  // Strip any raw replacement tags that might leak
  let cleaned = text
    .replace(/<<<ORIGINAL>>>/g, '')
    .replace(/<<<REPLACEMENT>>>/g, '')
    .replace(/<<<END>>>/g, '')
    .replace(/<<</g, '')
    .replace(/>>>/g, '')
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

export default function Editor() {
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
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Toggle dark/light theme
  useEffect(() => {
    // Load preference
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null
    const docTitle = localStorage.getItem('docTitle')
    
    if (savedTheme) {
      setTheme(savedTheme)
      document.documentElement.classList.toggle('dark', savedTheme === 'dark')
    } else {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      setTheme(systemTheme)
      document.documentElement.classList.toggle('dark', systemTheme === 'dark')
    }

    if (docTitle) {
      setDocumentTitle(docTitle)
    }
  }, [])

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light'
    setTheme(nextTheme)
    localStorage.setItem('theme', nextTheme)
    document.documentElement.classList.toggle('dark', nextTheme === 'dark')
  }

  // Tiptap Editor configuration
  const editor = useEditor({
    extensions: [
      StarterKit.configure(),
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
        class: 'tiptap focus:outline-none min-h-[900px] w-full',
      },
    },
    onUpdate: ({ editor }) => {
      setIsSaved(false)
      
      // Hide floating popup on edit
      setShowFloatingPopup(false)
      
      // Calculate Stats
      const text = editor.getText()
      const chars = text.length
      const words = text.trim() ? text.trim().split(/\s+/).length : 0
      
      setCharCount(chars)
      setWordCount(words)
      setReadTime(Math.ceil(words / 200)) // ~200 WPM

      // Local storage draft save trigger on edit
      const contentJSON = editor.getJSON()
      localStorage.setItem('tiptap-content', JSON.stringify(contentJSON))
    },
    onSelectionUpdate: ({ editor }) => {
      // Clear existing idle timer
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
      }

      // Close the floating popup if user changes selection/cursor in the editor
      if (editor.isFocused) {
        setShowFloatingPopup(false)
        setSimulatedAiResult('')
      }

      // If AI is generating, or if editor is not focused, or if there is a selection highlight active, do not trigger
      const { selection } = editor.state
      if (!editor.isFocused || !selection.empty) {
        return
      }

      // Start 2-second timer for contextual AI popup
      idleTimerRef.current = setTimeout(() => {
        const { $from } = editor.state.selection
        const from = $from.start()
        const to = $from.end()
        const text = editor.state.doc.textBetween(from, to, ' ').trim()

        // Only popup if there is substantial text in the current block node
        if (text.length > 3) {
          try {
            const coords = editor.view.coordsAtPos($from.pos)
            setPopupCoords({ top: coords.top, left: coords.left })
            setPopupContextText(text)
            setPopupContextRange({ from, to })
            setShowFloatingPopup(true)
          } catch (e) {
            console.error(e)
          }
        }
      }, 2000)
    },
  })

  // Load editor content on mount from localstorage
  useEffect(() => {
    if (!editor) return

    const savedContent = localStorage.getItem('tiptap-content')
    if (savedContent) {
      try {
        editor.commands.setContent(JSON.parse(savedContent))
      } catch (e) {
        editor.commands.setContent(DEFAULT_CONTENT)
      }
    } else {
      editor.commands.setContent(DEFAULT_CONTENT)
    }

    // Initial stat calculations
    setTimeout(() => {
      const text = editor.getText()
      setCharCount(text.length)
      setWordCount(text.trim() ? text.trim().split(/\s+/).length : 0)
      setReadTime(Math.ceil((text.trim() ? text.trim().split(/\s+/).length : 0) / 200))
    }, 100)
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

  // Export to PDF Document (.pdf) using html2pdf.js (dynamic load)
  const exportToPdf = async () => {
    setLoadingMessage('Compiling PDF Document...')
    setIsExporting(true)
    try {
      const html2pdf = (await import('html2pdf.js')).default
      const element = document.querySelector('.tiptap')
      if (!element) {
        alert('Editor canvas element not found.')
        return
      }

      const opt = {
        margin: [1.0, 0.75, 1.0, 0.75], // Increased top/bottom margins to make space for headers and footers
        filename: `${documentTitle.replace(/\s+/g, '_').toLowerCase()}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { 
          scale: 2, 
          useCORS: true, 
          logging: false 
        },
        jsPDF: { 
          unit: 'in', 
          format: 'letter', 
          orientation: 'portrait' 
        },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
      }

      // Stream PDF and hook into the underlying jsPDF instance to draw layout headers and footers
      await html2pdf().set(opt).from(element).toPdf().get('pdf').then((pdf: any) => {
        const totalPages = pdf.internal.getNumberOfPages()
        for (let i = 1; i <= totalPages; i++) {
          pdf.setPage(i)
          pdf.setFont('helvetica', 'normal')
          pdf.setFontSize(8)
          pdf.setTextColor(113, 113, 122) // Zinc 500

          // Render Page Header (Right Aligned on top margin)
          if (docHeader) {
            pdf.text(docHeader, 7.75, 0.5, { align: 'right' })
          }

          // Render Page Footer (Center Aligned on bottom margin)
          const footerText = docFooter ? `${docFooter} | Page ${i} of ${totalPages}` : `Page ${i} of ${totalPages}`
          pdf.text(footerText, 4.25, 10.5, { align: 'center' })
        }
      }).save()
    } catch (err: any) {
      console.error('PDF export error:', err)
      alert(`Failed to export PDF: ${err.message || err}`)
    } finally {
      setIsExporting(false)
    }
  }

  // Export to Word Document (.docx) using docx.js (dynamic load)
  const exportToDocx = async () => {
    setLoadingMessage('Compiling Word Document...')
    setIsExporting(true)
    try {
      const docx = await import('docx')
      const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = docx

      const json = editor.getJSON()
      const nodes = json.content || []
      const children: any[] = []

      // Helper to map alignments
      const getAlignment = (align?: string) => {
        if (align === 'center') return AlignmentType.CENTER
        if (align === 'right') return AlignmentType.RIGHT
        if (align === 'justify') return AlignmentType.JUSTIFY
        return AlignmentType.LEFT
      }

      // Helper to map headings
      const getHeadingLevel = (level: number) => {
        if (level === 1) return HeadingLevel.HEADING_1
        if (level === 2) return HeadingLevel.HEADING_2
        if (level === 3) return HeadingLevel.HEADING_3
        return undefined
      }

      nodes.forEach((node: any) => {
        const align = getAlignment(node.attrs?.textAlign)

        if (node.type === 'heading') {
          const level = node.attrs?.level || 1
          const runs = (node.content || []).map((childNode: any) => {
            const marks = childNode.marks || []
            return new TextRun({
              text: childNode.text || '',
              bold: marks.some((m: any) => m.type === 'bold'),
              italics: marks.some((m: any) => m.type === 'italic'),
              underline: marks.some((m: any) => m.type === 'underline') ? {} : undefined,
              strike: marks.some((m: any) => m.type === 'strike'),
              font: 'Arial'
            })
          })

          children.push(
            new Paragraph({
              children: runs,
              heading: getHeadingLevel(level),
              alignment: align,
              spacing: { before: 240, after: 120 }
            })
          )
        } else if (node.type === 'paragraph') {
          const runs = (node.content || []).map((childNode: any) => {
            const marks = childNode.marks || []
            return new TextRun({
              text: childNode.text || '',
              bold: marks.some((m: any) => m.type === 'bold'),
              italics: marks.some((m: any) => m.type === 'italic'),
              underline: marks.some((m: any) => m.type === 'underline') ? {} : undefined,
              strike: marks.some((m: any) => m.type === 'strike'),
              font: 'Arial'
            })
          })

          children.push(
            new Paragraph({
              children: runs,
              alignment: align,
              spacing: { after: 120 },
              lineSpacing: { val: 360 } // 1.5 line height spacing
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
                  font: 'Arial'
                })
              })

              children.push(
                new Paragraph({
                  children: runs,
                  bullet: isOrdered ? undefined : { level: 0 },
                  indent: isOrdered ? { left: 720 } : undefined,
                  spacing: { after: 80 }
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
                  font: 'Arial'
                })
              )
            })
          })

          children.push(
            new Paragraph({
              children: runs,
              indent: { left: 720 },
              spacing: { before: 120, after: 120 }
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
                        text: docHeader || "DocuAI Document Draft",
                        size: 18, // 9pt (half-points in docx)
                        color: "71717a", // Zinc 500
                        font: "Arial"
                      })
                    ],
                    alignment: AlignmentType.RIGHT,
                    spacing: { after: 120 }
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
                        font: "Arial"
                      }),
                      new TextRun({
                        children: [docx.PageNumber.CURRENT],
                        size: 18,
                        color: "71717a",
                        font: "Arial"
                      })
                    ],
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 120 }
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
    setLoadingMessage('Compiling PowerPoint Slides...')
    setIsExporting(true)
    try {
      const pptxgen = (await import('pptxgenjs')).default
      const pptx = new pptxgen()
      pptx.layout = 'LAYOUT_16x9'

      const json = editor.getJSON()
      const nodes = json.content || []

      let slideTitle = ''
      let slideContent: string[] = []

      const createSlide = () => {
        if (slideTitle || slideContent.length > 0) {
          const slide = pptx.addSlide()

          // Slide title header background banner
          slide.addShape(pptx.shapes.RECTANGLE, {
            x: 0,
            y: 0,
            w: '100%',
            h: 1.2,
            fill: { color: '4f46e5' } // Indigo 600
          })

          // Slide Title
          slide.addText(slideTitle || 'Document Presentation', {
            x: 0.5,
            y: 0.3,
            w: 9,
            h: 0.6,
            fontSize: 24,
            bold: true,
            color: 'FFFFFF',
            fontFace: 'Arial'
          })

          // Bullet contents
          if (slideContent.length > 0) {
            const bodyText = slideContent.join('\n')
            slide.addText(bodyText, {
              x: 0.5,
              y: 1.6,
              w: 9,
              h: 5.0,
              fontSize: 16,
              color: '3f3f46', // Zinc 700
              fontFace: 'Arial',
              bullet: { type: 'number' },
              valign: 'top',
              lineSpacing: 24
            })
          }
        }
      }

      nodes.forEach((node: any) => {
        if (node.type === 'heading' && (node.attrs?.level === 1 || node.attrs?.level === 2)) {
          // Commit previous slide
          createSlide()

          // Start a new slide
          slideTitle = node.content?.map((c: any) => c.text).join('') || 'Section Title'
          slideContent = []
        } else if (node.type === 'paragraph' || node.type === 'bulletList' || node.type === 'orderedList') {
          const text = node.content?.map((c: any) => c.text).join('') || ''
          
          if (node.type === 'bulletList' || node.type === 'orderedList') {
            node.content?.forEach((item: any) => {
              const itemText = item.content?.map((p: any) => {
                return p.content?.map((t: any) => t.text).join('') || ''
              }).join('') || ''
              if (itemText) slideContent.push(itemText)
            })
          } else if (text) {
            // Keep bullets brief
            if (text.length > 180) {
              slideContent.push(text.slice(0, 180) + '...')
            } else {
              slideContent.push(text)
            }
          }
        }
      })

      // Commit the final slide
      createSlide()

      // Create fallback title slide if empty
      if (pptx.slides.length === 0) {
        const slide = pptx.addSlide()
        slide.addText(documentTitle, { 
          x: 1, 
          y: 2, 
          w: 8, 
          h: 2, 
          fontSize: 32, 
          bold: true, 
          color: '4f46e5', 
          align: 'center' 
        })
      }

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
        
        // Renders word document inline HTML directly into Tiptap
        editor.commands.setContent(result.value)
        setIsSaved(false)
        
        // Extract title from file name
        const cleanName = file.name.replace(/\.[^/.]+$/, "")
        setDocumentTitle(cleanName)
      } else if (extension === 'pdf') {
        // Renders PDF text content extracted from pdfjs-dist
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`
        
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
        
        editor.commands.setContent(accumulatedHtml)
        setIsSaved(false)
        
        // Extract title from file name
        const cleanName = file.name.replace(/\.[^/.]+$/, "")
        setDocumentTitle(cleanName)
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

  // Phase 2 AI Prompt execution (Streams response from Gemini API route proxy)
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
    } else if (action === 'outline') {
      promptText = 'Generate a comprehensive academic thesis outline (Chapters 1 to 5) with subheadings formatted in structured HTML lists (<ul>/<li>).'
    } else {
      promptText = aiPrompt
    }

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptText,
          context: selectedText || editor.getText()
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        setSimulatedAiResult(`<p class="text-red-500 font-semibold">API Error: ${errorData.error || 'Failed to generate content.'}</p>`)
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

              // Check if model returned replacement format
              if (accumulatedText.includes('<<<ORIGINAL>>>')) {
                detectedOriginalMode = true
                const origIndex = accumulatedText.indexOf('<<<ORIGINAL>>>')
                const replIndex = accumulatedText.indexOf('<<<REPLACEMENT>>>')

                if (replIndex !== -1) {
                  const origText = accumulatedText.substring(origIndex + 14, replIndex).trim()
                  setAiSelectedText(origText)

                  // Try to find and select it in the editor
                  const range = findTextRange(editor, origText)
                  if (range) {
                    setAiSelectionRange(range)
                    // Highlight visually in Tiptap
                    editor.chain().setTextSelection(range).scrollIntoView().run()
                  }

                  const endIndex = accumulatedText.indexOf('<<<END>>>')
                  let replText = ''
                  if (endIndex !== -1) {
                    replText = accumulatedText.substring(replIndex + 17, endIndex).trim()
                  } else {
                    replText = accumulatedText.substring(replIndex + 17).trim()
                  }
                  setSimulatedAiResult(replText)
                } else {
                  const origText = accumulatedText.substring(origIndex + 14).trim()
                  setAiSelectedText(origText)
                  setSimulatedAiResult('') // Wait for replacement text
                }
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
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptText,
          context: popupContextText
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        setSimulatedAiResult(`<p class="text-red-500 font-semibold">API Error: ${errorData.error || 'Failed.'}</p>`)
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

              // Check if model returned replacement format
              if (accumulatedText.includes('<<<ORIGINAL>>>')) {
                detectedOriginalMode = true
                const origIndex = accumulatedText.indexOf('<<<ORIGINAL>>>')
                const replIndex = accumulatedText.indexOf('<<<REPLACEMENT>>>')

                if (replIndex !== -1) {
                  const origText = accumulatedText.substring(origIndex + 14, replIndex).trim()
                  setAiSelectedText(origText)

                  // Try to find and select it in the editor
                  const range = findTextRange(editor, origText)
                  if (range) {
                    setAiSelectionRange(range)
                    editor.chain().setTextSelection(range).scrollIntoView().run()
                  } else if (popupContextRange) {
                    setAiSelectionRange(popupContextRange)
                  }

                  const endIndex = accumulatedText.indexOf('<<<END>>>')
                  let replText = ''
                  if (endIndex !== -1) {
                    replText = accumulatedText.substring(replIndex + 17, endIndex).trim()
                  } else {
                    replText = accumulatedText.substring(replIndex + 17).trim()
                  }
                  setSimulatedAiResult(replText)
                } else {
                  const origText = accumulatedText.substring(origIndex + 14).trim()
                  setAiSelectedText(origText)
                  setSimulatedAiResult('') // Wait for replacement text
                }
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
      
      {/* Top Application Bar */}
      <header className="flex items-center justify-between px-6 py-2 border-b bg-white border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 z-10">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1 bg-indigo-600 rounded-lg text-white font-bold text-lg shadow-sm">
            <FileText className="w-5 h-5" />
            <span>DocuAI</span>
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
          <div className="relative group">
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-zinc-50 hover:bg-zinc-200 text-zinc-700 rounded-md border border-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:border-zinc-700 dark:text-zinc-300 transition-colors">
              <Download className="w-3.5 h-3.5" />
              <span>Export</span>
            </button>
            <div className="absolute right-0 mt-1.5 w-40 hidden group-hover:block bg-white border border-zinc-200 shadow-lg rounded-lg py-1 dark:bg-zinc-900 dark:border-zinc-800 z-50">
              <button 
                onClick={() => exportDoc('html')}
                className="w-full text-left px-4 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
              >
                Web Page (.html)
              </button>
              <button 
                onClick={() => exportDoc('txt')}
                className="w-full text-left px-4 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
              >
                Plain Text (.txt)
              </button>
              <div className="border-t border-zinc-100 dark:border-zinc-800 my-1"></div>
              <div className="px-4 py-1.5 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                Phase 3 Exports
              </div>
              <button 
                onClick={exportToDocx}
                className="w-full text-left px-4 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
              >
                Word (.docx)
              </button>
              <button 
                onClick={exportToPdf}
                className="w-full text-left px-4 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
              >
                PDF Document (.pdf)
              </button>
              <button 
                onClick={exportToPptx}
                className="w-full text-left px-4 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
              >
                Powerpoint (.pptx)
              </button>
            </div>
          </div>

          <button
            onClick={toggleTheme}
            className="p-1.5 text-zinc-500 hover:text-indigo-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-indigo-400 dark:hover:bg-zinc-800 rounded-lg transition-all"
            title="Toggle color theme"
          >
            {theme === 'light' ? <Moon className="w-4.5 h-4.5" /> : <Sun className="w-4.5 h-4.5" />}
          </button>

          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/40 dark:text-indigo-300 rounded-md transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 animate-pulse" />
            <span>AI Sidebar</span>
            {sidebarOpen ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
          </button>
        </div>
      </header>

      {/* Editor Main Canvas & Layout */}
      <div className="flex flex-1 overflow-hidden relative">
        <div className="flex flex-col flex-1 overflow-y-auto items-center py-8 px-4 sm:px-8 bg-zinc-50 dark:bg-zinc-950">
          
          {/* Formatting Toolbar */}
          <div className="w-full max-w-[816px] sticky top-0 flex flex-wrap gap-1 items-center p-2 mb-6 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-md z-30 justify-start sm:justify-between">
            <div className="flex flex-wrap items-center gap-0.5">
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

            <div className="flex items-center gap-0.5">
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
            </div>
          </div>

          {/* Document Settings & Layout Panel */}
          <div className="w-full max-w-[816px] mb-6 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 shadow-md space-y-3">
            <h3 className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
              Document Headers & Layout Options (Word & PDF)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-450 block mb-1">
                  Page Header Text (Right Aligned)
                </label>
                <input
                  type="text"
                  value={docHeader}
                  onChange={(e) => setDocHeader(e.target.value)}
                  placeholder="e.g. Chapter 1: Literature Review"
                  className="w-full text-xs px-3 py-1.5 border border-zinc-200 dark:border-zinc-750 bg-zinc-50 dark:bg-zinc-850 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 text-zinc-700 dark:text-zinc-300 transition-all"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-450 block mb-1">
                  Page Footer Prefix
                </label>
                <input
                  type="text"
                  value={docFooter}
                  onChange={(e) => setDocFooter(e.target.value)}
                  placeholder="e.g. Confidential Research Draft"
                  className="w-full text-xs px-3 py-1.5 border border-zinc-200 dark:border-zinc-750 bg-zinc-50 dark:bg-zinc-850 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 text-zinc-700 dark:text-zinc-300 transition-all"
                />
              </div>
            </div>
          </div>

          {/* Document Sheet Container */}
          <div 
            onClick={() => editor.commands.focus()}
            className="w-full max-w-[816px] bg-[var(--paper-bg)] border border-[var(--paper-border)] shadow-[var(--paper-shadow)] rounded-lg p-16 md:p-20 min-h-[1056px] text-zinc-850 dark:text-zinc-100 cursor-text transition-all duration-300"
          >
            <EditorContent editor={editor} />
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
                  <Sparkles className="w-4 h-4 animate-bounce" />
                  <span>Gemini Copilot</span>
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
                  <span className="font-bold">Gemini AI Workspace:</span> Highlight any section of your document for context, choose a preset, or write a custom instruction to refine your writing.
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                      Prompt Gemini
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
                    placeholder="E.g., Rewrite this paragraph to be more academic..."
                    className="w-full text-xs p-2.5 rounded-lg border border-zinc-200 focus:ring-2 focus:ring-indigo-500 bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700 dark:focus:ring-indigo-600 outline-none text-zinc-700 dark:text-zinc-300 h-24 resize-none"
                  />
                  <button
                    disabled={isSimulatingAI || !aiPrompt.trim()}
                    onClick={() => handleAiAction('custom')}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-xs font-semibold shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-1.5"
                  >
                    {isSimulatingAI ? (
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
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
                      onClick={() => handleAiAction('intro')}
                      className="w-full text-left p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-850 hover:bg-indigo-50 hover:border-indigo-200 dark:hover:bg-indigo-950/20 dark:hover:border-indigo-900/30 text-xs font-medium transition-all group flex items-center justify-between"
                    >
                      <span>Generate Chapter 1 Intro Blueprint</span>
                      <ChevronRight className="w-3 h-3 text-zinc-400 group-hover:text-indigo-500 transition-colors" />
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
                <p>Gemini Free Tier API parameters:</p>
                <ul className="list-disc pl-3.5 space-y-0.5">
                  <li>Model: Gemini 1.5 Flash</li>
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
              <Sparkles className="w-3.5 h-3.5" />
              <span>Contextual AI Editor</span>
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

    </div>
  )
}
