"use client"

import { classifyIntent, type ConversationMessage, type DocumentMetadata } from '@/utils/chatIntelligence'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  Send,
  Paperclip,
  FileText,
  Download,
  Moon,
  Sun,
  ChevronRight,
  Menu,
  X,
  Eye,
  Edit3,
  BookOpen,
  Upload,
  Trash2,
  Check,
  Folder,
  LogOut,
  Settings,
  HelpCircle,
  User,
  Crown,
  GraduationCap,
  BookOpenCheck,
  FileEdit,
  Layers,
  Loader2,
  Bot,
  Undo2,
  Redo2,
  Search,
  ExternalLink,
  BookmarkPlus
} from 'lucide-react'
import { Project } from '../Dashboard/Dashboard'
import type { JournalPaper } from '@/app/api/journals/search/route'

// ─── Chat Message Types ────────────────────────────────────────────
interface ChatMessage {
  id: string
  role: 'user' | 'ai' | 'system'
  content: string
  timestamp: number
  type?: 'text' | 'status' | 'export-card' | 'suggestion-chips' | 'choice-card' | 'form-card'
  isStreaming?: boolean
  choices?: { id: string; label: string; icon: string; description?: string }[]
  formType?: 'seminar-info' | 'chapter-sources' | 'proposal-info' | 'project-info'
  onChoice?: (choiceId: string) => void
}

// ─── Props Interface ───────────────────────────────────────────────
export interface MobileChatViewProps {
  // Theme
  theme: 'light' | 'dark'
  toggleTheme: () => void
  
  // Project state
  documentTitle: string
  setDocumentTitle: (title: string) => void
  activeProjectId: string | null
  wordCount: number
  charCount: number
  totalPages: number
  isSaved: boolean
  onForceSave: () => void
  docHeader: string
  docFooter: string
  
  // AI state
  isSimulatingAI: boolean
  simulatedAiResult: string
  activeAiModel: string
  aiEngine: 'gemini' | 'grok' | 'groq'
  setAiEngine: (engine: 'gemini' | 'grok' | 'groq') => void
  
  // AI actions
  handleAiAction: (action: string) => void
  setAiPrompt: (prompt: string) => void
  aiPrompt: string
  insertAiContent: () => void
  discardAiContent: () => void
  
  // Export actions
  exportToDocx: (scope?: 'full' | 'cover' | 'toc' | 'content') => void
  exportToPdfPrint: (scope?: 'full' | 'cover' | 'toc' | 'content') => void
  exportToPptx: () => void
  
  // Project actions
  onBackToDashboard: () => void
  
  // Source ingestion
  projectSources: { id?: number; name: string; content: string; type: string }[]
  handleWizardFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  
  // Auth
  userEmail: string | null
  onSignOut: () => void
  onOpenAuth: () => void
  
  // Document preview
  editorHtml: string

  // Academic settings
  wizardDocType: 'Seminar' | 'Proposal' | 'Project' | 'Custom'
  wizardAcademicLevel: string
  setWizardDocType?: (type: 'Seminar' | 'Proposal' | 'Project' | 'Custom') => void
  setWizardTopic?: (topic: string) => void
  setStudentName?: (name: string) => void
  setMatricNumber?: (matric: string) => void
  setSupervisorName?: (name: string) => void
  
  // Setup wizard
  onOpenWizard: () => void

  // Full blueprint generator
  onGenerateBlueprint: () => void

  // Subscription modal & state
  onOpenPricingModal?: () => void
  userSubscription?: any

  // Guided template onboarding
  initialTemplate?: 'Seminar' | 'Proposal' | 'Project' | 'Custom' | null
  onClearInitialTemplate?: () => void

  // Undo / Redo
  triggerUndo?: () => void
  triggerRedo?: () => void

  // Cover page generator callback
  onApplyCoverPage?: (details: {
    title?: string
    studentName?: string
    matricNo?: string
    department?: string
    faculty?: string
    institution?: string
    supervisorName?: string
    academicSession?: string
    submissionDate?: string
  }) => void

  // Journal Search callback
  onAddJournalSources?: (sources: { name: string; content: string; type: string }[]) => Promise<void> | void

  // Formatting Style Callbacks
  wizardFontFamily?: string
  setWizardFontFamily?: (font: 'default' | 'arial' | 'georgia' | 'playfair' | 'inter' | 'courier') => void
  wizardLineSpacing?: string
  setWizardLineSpacing?: (spacing: string) => void
  setWizardAcademicLevel?: (level: string) => void
}

// ─── Quick Action Chip Data ────────────────────────────────────────
const QUICK_ACTIONS = [
  { id: 'blueprint', label: 'Generate Full Blueprint', icon: '✨', color: 'indigo', action: 'blueprint' },
  { id: 'intro', label: 'Chapter 1 Introduction', icon: '📝', color: 'blue', action: 'intro' },
  { id: 'outline', label: 'Draft Thesis Outline', icon: '📋', color: 'teal', action: 'outline' },
  { id: 'humanize', label: 'Humanize My Text', icon: '🧠', color: 'emerald', action: 'humanize' },
  { id: 'rephrase', label: 'Academic Rephrase', icon: '🔄', color: 'purple', action: 'rephrase' },
  { id: 'export', label: 'Export Document', icon: '📤', color: 'amber', action: 'export' },
]

// ─── Helper to parse pages from stringified HTML ───────────────────
const parsePagesFromHtml = (htmlStr: string): string[] => {
  if (!htmlStr) return []
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(htmlStr, 'text/html')
    const pages = doc.querySelectorAll('div[data-type="page"]')
    if (pages.length > 0) {
      return Array.from(pages).map(p => p.innerHTML)
    }
  } catch (e) {
    console.warn("DOMParser failed to parse preview pages:", e)
  }

  // Regex fallback: split by data-type="page" div tags
  const pageRegex = /<div[^>]*data-type="page"[^>]*>([\s\S]*?)<\/div>/gi
  const pages: string[] = []
  let match
  while ((match = pageRegex.exec(htmlStr)) !== null) {
    pages.push(match[1])
  }

  if (pages.length === 0) {
    return [htmlStr]
  }
  return pages
}

// ─── Helper to generate unique IDs ────────────────────────────────
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

// ─── Helper to parse Markdown to HTML (Fix bold asterisks & italics) ───
const parseMarkdownToHtml = (content: string): string => {
  if (!content) return ''
  let parsed = content
  // Replace **bold** with <strong>bold</strong>
  parsed = parsed.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  // Replace *italic* or _italic_ with <em>italic</em>
  parsed = parsed.replace(/\*(.*?)\*/g, '<em>$1</em>')
  // Replace `code` with <code>code</code>
  parsed = parsed.replace(/`(.*?)`/g, '<code class="bg-zinc-100 dark:bg-zinc-800 px-1 rounded text-xs font-mono">$1</code>')
  // If not already HTML tags, convert newlines to <br/>
  if (!/<[a-z][\s\S]*>/i.test(parsed)) {
    parsed = parsed.replace(/\n/g, '<br/>')
  }
  return parsed
}

// ─── Onboarding Flow Stages ───────────────────────────────────────
type OnboardingStage = 
  | 'idle'
  | 'template-greeting'
  | 'cover-or-chapters'
  | 'collecting-info'
  | 'info-collected'
  | 'collecting-sources'
  | 'sources-collected'
  | 'ready-to-generate'
  | 'generating'

// ─── Main Component ───────────────────────────────────────────────
export default function MobileChatView({
  theme,
  toggleTheme,
  documentTitle,
  setDocumentTitle,
  activeProjectId,
  wordCount,
  charCount,
  totalPages,
  isSaved,
  onForceSave,
  docHeader,
  docFooter,
  isSimulatingAI,
  simulatedAiResult,
  activeAiModel,
  aiEngine,
  setAiEngine,
  handleAiAction,
  setAiPrompt,
  aiPrompt,
  insertAiContent,
  discardAiContent,
  exportToDocx,
  exportToPdfPrint,
  exportToPptx,
  onBackToDashboard,
  projectSources,
  handleWizardFileUpload,
  userEmail,
  onSignOut,
  onOpenAuth,
  editorHtml,
  wizardDocType,
  wizardAcademicLevel,
  setWizardDocType,
  setWizardTopic,
  setStudentName,
  setMatricNumber,
  setSupervisorName,
  onOpenWizard,
  onGenerateBlueprint,
  onOpenPricingModal,
  userSubscription,
  initialTemplate,
  onClearInitialTemplate,
  triggerUndo,
  triggerRedo,
  onApplyCoverPage,
  onAddJournalSources,
  wizardFontFamily,
  setWizardFontFamily,
  wizardLineSpacing,
  setWizardLineSpacing,
  setWizardAcademicLevel
}: MobileChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [showDrawer, setShowDrawer] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [showExportSheet, setShowExportSheet] = useState(false)
  const [previewZoom, setPreviewZoom] = useState(0.4)
  const previewContainerRef = useRef<HTMLDivElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const [onboardingStage, setOnboardingStage] = useState<OnboardingStage>('idle')
  const [showInfoForm, setShowInfoForm] = useState(false)
  const [showSourcesForm, setShowSourcesForm] = useState(false)
  const [formData, setFormData] = useState({
    topic: '',
    department: '',
    studentName: '',
    matricNumber: '',
    supervisorName: '',
    academicLevel: 'Undergraduate'
  })
  const onboardingTemplateRef = useRef<string | null>(null)
  const hasProcessedTemplateRef = useRef<string | null>(null)

  const templateLabels: Record<string, string> = {
    Seminar: 'Seminar Report',
    Proposal: 'Research Proposal',
    Project: 'Graduation Thesis Project',
    Custom: 'Custom Document'
  }

  const addBotMessage = useCallback((content: string, extras?: Partial<ChatMessage>) => {
    setMessages(prev => [
      ...prev,
      {
        id: uid(),
        role: 'ai' as const,
        content,
        timestamp: Date.now(),
        type: 'text' as const,
        ...extras
      }
    ])
  }, [])

  const addBotMessageDelayed = useCallback((content: string, delayMs: number, extras?: Partial<ChatMessage>) => {
    return new Promise<void>(resolve => {
      setTimeout(() => {
        addBotMessage(content, extras)
        resolve()
      }, delayMs)
    })
  }, [addBotMessage])

  // ─── Online Journal Search State ──────────────────────────────
  const [showJournalModal, setShowJournalModal] = useState(false)
  const [journalSearchQuery, setJournalSearchQuery] = useState('')
  const [isSearchingJournals, setIsSearchingJournals] = useState(false)
  const [journalPapers, setJournalPapers] = useState<JournalPaper[]>([])
  const [selectedPaperIds, setSelectedPaperIds] = useState<Set<string>>(new Set())

  // ─── Formatting Style Preview Modal State ─────────────────────
  const [showFormattingModal, setShowFormattingModal] = useState(false)
  const [selectedFont, setSelectedFont] = useState<'default' | 'arial' | 'georgia' | 'playfair' | 'inter' | 'courier'>(
    (wizardFontFamily as any) || 'playfair'
  )
  const [selectedSpacing, setSelectedSpacing] = useState(wizardLineSpacing || '1.5')
  const [selectedLevel, setSelectedLevel] = useState(wizardAcademicLevel || 'Undergraduate')

  // Confirm formatting style and start blueprint generation
  const handleConfirmFormattingAndGenerate = useCallback(() => {
    setWizardFontFamily?.(selectedFont)
    setWizardLineSpacing?.(selectedSpacing)
    setWizardAcademicLevel?.(selectedLevel)
    setShowFormattingModal(false)

    const fontNames: Record<string, string> = {
      playfair: 'Times New Roman',
      arial: 'Arial',
      georgia: 'Georgia',
      inter: 'Inter',
      courier: 'Courier',
      default: 'Standard'
    }

    setMessages(prev => [
      ...prev,
      {
        id: uid(),
        role: 'system',
        content: `✨ Formatting style set to **${fontNames[selectedFont] || selectedFont}** (${selectedSpacing} line spacing). Generating full document blueprint...`,
        timestamp: Date.now(),
        type: 'status'
      }
    ])

    setTimeout(() => {
      onGenerateBlueprint()
    }, 400)
  }, [selectedFont, selectedSpacing, selectedLevel, setWizardFontFamily, setWizardLineSpacing, setWizardAcademicLevel, onGenerateBlueprint])

  // Trigger journal search
  const executeJournalSearch = useCallback(async (queryText?: string) => {
    const term = (queryText || journalSearchQuery || documentTitle || 'Academic Research').trim()
    if (!term) return

    setJournalSearchQuery(term)
    setIsSearchingJournals(true)
    setShowJournalModal(true)

    try {
      const res = await fetch(`/api/journals/search?query=${encodeURIComponent(term)}`)
      if (res.ok) {
        const data = await res.json()
        const papers: JournalPaper[] = data.papers || []
        setJournalPapers(papers)
        // Select top 3 papers by default
        const defaultSelected = new Set(papers.slice(0, 3).map(p => p.id))
        setSelectedPaperIds(defaultSelected)
      } else {
        alert('Could not search online journals. Please try again.')
      }
    } catch (err) {
      console.error('Journal search error:', err)
    } finally {
      setIsSearchingJournals(false)
    }
  }, [journalSearchQuery, documentTitle])

  // Handle importing selected papers into project sources
  const handleImportSelectedJournals = useCallback(async () => {
    const selected = journalPapers.filter(p => selectedPaperIds.has(p.id))
    if (selected.length === 0) return

    const sourcesToAdd = selected.map(p => ({
      name: `${p.authors.split(',')[0].replace(/[^a-zA-Z0-9]/g, '')}_${p.year}.pdf`,
      content: `Title: ${p.title}\nAuthors: ${p.authors}\nJournal: ${p.journal} (${p.year})\nDOI: ${p.doi}\n\nAbstract:\n${p.abstract}\n\nAPA 7 Citation:\n${p.citationApa}`,
      type: 'journal'
    }))

    await onAddJournalSources?.(sourcesToAdd)
    setShowJournalModal(false)

    setMessages(prev => [
      ...prev,
      {
        id: uid(),
        role: 'system',
        content: `📎 Loaded **${selected.length} online journal paper(s)** into project reference sources.`,
        timestamp: Date.now(),
        type: 'status'
      }
    ])

    setTimeout(() => {
      addBotMessage(`Awesome! I've added **${selected.length} journal paper(s)** to your reference materials. I'll cite them accurately in your content. Ready to generate your document?`)
    }, 500)

    setTimeout(() => {
      setMessages(prev => [
        ...prev,
        {
          id: uid(),
          role: 'system',
          content: '',
          timestamp: Date.now(),
          type: 'choice-card',
          choices: [
            { id: 'generate-now', label: 'Generate Full Document Now', icon: '✨', description: 'AI-powered chapter-by-chapter generation with citations' },
            { id: 'search-journals', label: 'Search More Online Journals', icon: '🔍', description: 'Find additional peer-reviewed papers' }
          ]
        }
      ])
    }, 1500)
  }, [journalPapers, selectedPaperIds, onAddJournalSources, addBotMessage])

  useEffect(() => {
    if (showPreview && previewContainerRef.current) {
      const containerWidth = previewContainerRef.current.clientWidth
      const targetWidth = containerWidth - 32
      const scale = targetWidth / 794
      setPreviewZoom(Math.max(0.2, Math.min(1.2, scale)))
    }
  }, [showPreview])


  // ─── Auto-scroll chat to bottom ──────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, simulatedAiResult])

  // ─── Per-Project Chat History Persistence ────────────────────
  const prevProjectIdRef = useRef<string | null>(null)

  // 1. Load chat history when activeProjectId changes
  useEffect(() => {
    if (!activeProjectId) return

    // Avoid duplicate re-loads if project ID didn't change
    if (prevProjectIdRef.current === activeProjectId) return
    prevProjectIdRef.current = activeProjectId

    // If starting fresh template onboarding, skip loading saved history
    if (initialTemplate) return

    const storageKey = `wordpi-chat-history-${activeProjectId}`
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed)
          return
        }
      }
    } catch (e) {
      console.warn('Failed to load chat history for project:', activeProjectId, e)
    }

    // Default welcome if no history exists for this project
    setMessages([
      {
        id: uid(),
        role: 'system',
        content: `Welcome to **${documentTitle || 'WordPIlot'}**! 👋\n\nI'm your AI academic writing assistant. Describe what you'd like to write, or tap a quick action below to get started.`,
        timestamp: Date.now(),
        type: 'text'
      }
    ])
  }, [activeProjectId, documentTitle, initialTemplate])

  // 2. Auto-save chat history to localStorage whenever messages state changes
  useEffect(() => {
    if (!activeProjectId || messages.length === 0) return
    const storageKey = `wordpi-chat-history-${activeProjectId}`
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages))
    } catch (e) {
      console.warn('Failed to save chat history for project:', activeProjectId, e)
    }
  }, [messages, activeProjectId])

  // ─── Guided Template Onboarding Flow ─────────────────────────
  // Handle initial template selection from MobileDashboard
  useEffect(() => {
    if (!initialTemplate || hasProcessedTemplateRef.current === initialTemplate) return
    hasProcessedTemplateRef.current = initialTemplate
    onboardingTemplateRef.current = initialTemplate
    setOnboardingStage('template-greeting')

    const label = templateLabels[initialTemplate] || initialTemplate

    // Clear existing messages and start fresh guided flow
    setMessages([])

    // Typewriter-style greeting sequence
    setTimeout(() => {
      addBotMessage(`📝 Great choice! Let's build your **${label}** together.`)
    }, 300)

    setTimeout(() => {
      addBotMessage(`I'll guide you step by step. First, let me know — would you like to **set up your front cover** with your details, or **skip straight to generating chapters**?`)
    }, 1200)

    setTimeout(() => {
      const coverLabel = initialTemplate === 'Seminar' 
        ? 'Set Up Front Cover (Topic, Student Info, Supervisor)'
        : initialTemplate === 'Proposal'
        ? 'Set Up Cover Page (Topic, Department)'
        : 'Set Up Cover Page (Project Details)'

      setMessages(prev => [
        ...prev,
        {
          id: uid(),
          role: 'system',
          content: '',
          timestamp: Date.now(),
          type: 'choice-card',
          choices: [
            { id: 'setup-cover', label: coverLabel, icon: '📋', description: 'Fill in your details for the title page' },
            { id: 'skip-to-chapters', label: 'Skip to Generating Chapters', icon: '⚡', description: 'Jump straight to AI content generation' }
          ]
        }
      ])
      setOnboardingStage('cover-or-chapters')
    }, 2200)

    onClearInitialTemplate?.()
  }, [initialTemplate]) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle onboarding choice selections
  const handleOnboardingChoice = useCallback((choiceId: string) => {
    const template = onboardingTemplateRef.current || wizardDocType

    if (choiceId === 'setup-cover') {
      // User wants to fill in cover page info
      setMessages(prev => [
        ...prev,
        { id: uid(), role: 'user', content: '📋 Set Up Front Cover', timestamp: Date.now(), type: 'text' }
      ])
      setTimeout(() => {
        addBotMessage(`Perfect! Fill in your ${templateLabels[template] || 'document'} details below. You can leave fields blank if you're not sure yet.`)
      }, 400)
      setTimeout(() => {
        setMessages(prev => [
          ...prev,
          {
            id: uid(),
            role: 'system',
            content: '',
            timestamp: Date.now(),
            type: 'form-card',
            formType: template === 'Seminar' ? 'seminar-info' : template === 'Proposal' ? 'proposal-info' : 'project-info'
          }
        ])
        setShowInfoForm(true)
        setOnboardingStage('collecting-info')
      }, 1000)
    } else if (choiceId === 'skip-to-chapters') {
      // Skip cover, go to sources/generation
      setMessages(prev => [
        ...prev,
        { id: uid(), role: 'user', content: '⚡ Skip to Generating Chapters', timestamp: Date.now(), type: 'text' }
      ])
      promptForSources()
    } else if (choiceId === 'search-journals') {
      setMessages(prev => [
        ...prev,
        { id: uid(), role: 'user', content: '🔍 Search Online Journals & Citations', timestamp: Date.now(), type: 'text' }
      ])
      executeJournalSearch(documentTitle || 'Academic Research')
    } else if (choiceId === 'add-sources') {
      setMessages(prev => [
        ...prev,
        { id: uid(), role: 'user', content: '📎 Upload Local Files', timestamp: Date.now(), type: 'text' }
      ])
      setTimeout(() => {
        addBotMessage('Upload your reference journals, PDFs, or DOCX files below. These will help me generate more accurate and cited content.')
      }, 400)
      setTimeout(() => {
        setMessages(prev => [
          ...prev,
          {
            id: uid(),
            role: 'system',
            content: '',
            timestamp: Date.now(),
            type: 'form-card',
            formType: 'chapter-sources'
          }
        ])
        setShowSourcesForm(true)
        setOnboardingStage('collecting-sources')
      }, 1000)
    } else if (choiceId === 'generate-now') {
      setMessages(prev => [
        ...prev,
        { id: uid(), role: 'user', content: '✨ Preview Style & Generate Document', timestamp: Date.now(), type: 'text' }
      ])
      // Open formatting style preview modal before generating full document!
      setShowFormattingModal(true)
    }
  }, [wizardDocType, addBotMessage, onGenerateBlueprint, executeJournalSearch, documentTitle]) // eslint-disable-line react-hooks/exhaustive-deps

  const promptForSources = useCallback(() => {
    const template = onboardingTemplateRef.current || wizardDocType
    setTimeout(() => {
      addBotMessage(`Now, to generate high-quality chapters for your **${templateLabels[template] || 'document'}**, I can use reference materials. Would you like to search online journals, upload reference PDFs, or generate directly?`)
    }, 500)
    setTimeout(() => {
      setMessages(prev => [
        ...prev,
        {
          id: uid(),
          role: 'system',
          content: '',
          timestamp: Date.now(),
          type: 'choice-card',
          choices: [
            { id: 'search-journals', label: 'Search Online Journals & Citations', icon: '🔍', description: 'Find & select peer-reviewed papers online' },
            { id: 'add-sources', label: 'Upload Local PDF / DOCX Files', icon: '📎', description: 'Upload local research documents' },
            { id: 'generate-now', label: 'Generate Chapters Now', icon: '✨', description: 'Use AI to create content directly' }
          ]
        }
      ])
      setOnboardingStage('ready-to-generate')
    }, 1600)
  }, [wizardDocType, addBotMessage]) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle form submission (seminar info / project info)
  const handleInfoFormSubmit = useCallback(() => {
    const template = onboardingTemplateRef.current || wizardDocType
    setShowInfoForm(false)
    setOnboardingStage('info-collected')

    // Apply form data to parent state
    if (formData.topic) {
      setDocumentTitle(formData.topic)
      setWizardTopic?.(formData.topic)
    }
    if (formData.studentName) setStudentName?.(formData.studentName)
    if (formData.matricNumber) setMatricNumber?.(formData.matricNumber)
    if (formData.supervisorName) setSupervisorName?.(formData.supervisorName)
    setWizardDocType?.(template as any)

    // Generate & apply front cover page HTML directly to the editor document
    onApplyCoverPage?.({
      title: formData.topic || documentTitle || 'UNTITLED PROJECT',
      studentName: formData.studentName || 'STUDENT NAME',
      matricNo: formData.matricNumber || 'MATRIC NO',
      department: formData.department || 'COMPUTER SCIENCE',
      faculty: 'SCIENCE',
      institution: 'UNIVERSITY',
      supervisorName: formData.supervisorName || 'SUPERVISOR NAME'
    })

    // Show confirmation
    const infoSummary = [
      formData.topic && `📌 Topic: ${formData.topic}`,
      formData.department && `🏛️ Department: ${formData.department}`,
      formData.studentName && `👤 Student: ${formData.studentName}`,
      formData.matricNumber && `🎓 Matric: ${formData.matricNumber}`,
      formData.supervisorName && `👨‍🏫 Supervisor: ${formData.supervisorName}`
    ].filter(Boolean).join('\n')

    setMessages(prev => [
      ...prev,
      { id: uid(), role: 'user', content: `✅ Details submitted:\n${infoSummary}`, timestamp: Date.now(), type: 'text' }
    ])

    setTimeout(() => {
      addBotMessage(`Great! Your front cover page has been created and applied directly to your document. 📄✨ Now let me ask — ready to set up your reference sources or generate chapters? 📖`)
    }, 500)

    // Move to sources step
    promptForSources()
  }, [formData, wizardDocType, addBotMessage, promptForSources, setDocumentTitle, setWizardTopic, setStudentName, setMatricNumber, setSupervisorName, setWizardDocType, onApplyCoverPage, documentTitle]) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle sources form completion
  const handleSourcesComplete = useCallback(() => {
    setShowSourcesForm(false)
    setOnboardingStage('sources-collected')
    
    setMessages(prev => [
      ...prev,
      { id: uid(), role: 'system', content: `📎 ${projectSources.length} reference file(s) loaded successfully.`, timestamp: Date.now(), type: 'status' }
    ])

    setTimeout(() => {
      addBotMessage(`Excellent! I've loaded your reference materials. Ready to generate your document?`)
    }, 500)

    setTimeout(() => {
      setMessages(prev => [
        ...prev,
        {
          id: uid(),
          role: 'system',
          content: '',
          timestamp: Date.now(),
          type: 'choice-card',
          choices: [
            { id: 'generate-now', label: 'Generate Full Document Now', icon: '✨', description: 'AI-powered chapter-by-chapter generation' },
            { id: 'add-sources', label: 'Add More References', icon: '📎', description: 'Upload additional source materials' }
          ]
        }
      ])
    }, 1500)
  }, [projectSources, addBotMessage])

  // ─── Track AI response and push to chat ──────────────────────
  const lastAiResultRef = useRef('')
  useEffect(() => {
    if (simulatedAiResult && !isSimulatingAI && simulatedAiResult !== lastAiResultRef.current) {
      lastAiResultRef.current = simulatedAiResult
      setMessages(prev => [
        ...prev,
        {
          id: uid(),
          role: 'ai',
          content: simulatedAiResult,
          timestamp: Date.now(),
          type: 'text'
        },
        {
          id: uid(),
          role: 'system',
          content: '',
          timestamp: Date.now(),
          type: 'export-card'
        }
      ])
    }
  }, [simulatedAiResult, isSimulatingAI])

  // ─── Send user message (Intelligence-enhanced) ──────────────
  const handleSend = () => {
    const text = inputText.trim()
    if (!text || isSimulatingAI) return

    // Add user message to chat
    setMessages(prev => [
      ...prev,
      {
        id: uid(),
        role: 'user',
        content: text,
        timestamp: Date.now(),
        type: 'text'
      }
    ])
    setInputText('')

    // ── Build conversation history for intent classifier ──
    const conversationHistory: ConversationMessage[] = messages
      .filter(m => (m.role === 'user' || m.role === 'ai') && m.content?.trim())
      .map(m => ({ role: m.role as 'user' | 'ai', content: m.content }))
    // Add the current message to history
    conversationHistory.push({ role: 'user', content: text })

    // ── Build document metadata ──
    const docMetadata: DocumentMetadata = {
      title: documentTitle || 'Untitled',
      documentType: wizardDocType || 'Custom',
      academicLevel: wizardAcademicLevel || 'Undergraduate',
      wordCount: wordCount,
      totalPages: totalPages,
      editorHtml: editorHtml || ''
    }

    // ── Classify intent ──
    const classified = classifyIntent(text, conversationHistory, docMetadata)

    // ── Route by classified intent ──
    if (classified.action === 'export') {
      setShowExportSheet(true)
      setMessages(prev => [
        ...prev,
        { id: uid(), role: 'ai', content: 'Opening export options for you...', timestamp: Date.now(), type: 'text' }
      ])
      return
    }

    if (classified.action === 'blueprint') {
      setShowFormattingModal(true)
      return
    }

    if (classified.action === 'cover-page') {
      const hasCover = editorHtml.includes('data-cover="true"')
      setShowInfoForm(true)
      setMessages(prev => [
        ...prev,
        {
          id: uid(),
          role: 'ai',
          content: hasCover
            ? '📋 Here is the front cover page form to update your details:'
            : '📋 No front cover page set yet! Fill in your details below to generate your official cover page:',
          timestamp: Date.now(),
          type: 'text'
        },
        {
          id: uid(),
          role: 'system',
          content: '',
          timestamp: Date.now(),
          type: 'form-card',
          formType: wizardDocType === 'Seminar' ? 'seminar-info' : wizardDocType === 'Proposal' ? 'proposal-info' : 'project-info'
        }
      ])
      return
    }

    if (classified.action === 'journal-search') {
      executeJournalSearch(text)
      return
    }

    // For all other intents, use the enriched prompt
    setAiPrompt(classified.enrichedPrompt)

    // Add a contextual status message so user knows what action was detected
    const intentLabels: Record<string, string> = {
      'humanize': '🧠 Humanizing content...',
      'rephrase': '🔄 Rephrasing academically...',
      'intro': '📝 Generating introduction...',
      'outline': '📋 Drafting thesis outline...',
      'generate-section': '✍️ Generating section content...',
      'edit-section': '✏️ Editing section...',
      'question': '💬 Analyzing your question...',
      'custom': '🤖 Processing your request...'
    }
    const statusLabel = intentLabels[classified.action] || intentLabels['custom']
    setMessages(prev => [
      ...prev,
      { id: uid(), role: 'system', content: statusLabel, timestamp: Date.now(), type: 'status' }
    ])

    // Trigger AI action after a tick so aiPrompt is set
    setTimeout(() => {
      handleAiAction('custom')
    }, 50)
  }

  // ─── Handle quick action chip tap (Intelligence-enhanced) ────
  const handleQuickAction = (action: string) => {
    if (action === 'export') {
      setShowExportSheet(true)
      return
    }

    if (action === 'blueprint') {
      onGenerateBlueprint()
      setMessages(prev => [
        ...prev,
        {
          id: uid(),
          role: 'system',
          content: `Generating full document blueprint for **"${documentTitle}"**...`,
          timestamp: Date.now(),
          type: 'status'
        }
      ])
      return
    }

    // Add user intent message
    const chip = QUICK_ACTIONS.find(a => a.id === action)
    if (chip) {
      setMessages(prev => [
        ...prev,
        {
          id: uid(),
          role: 'user',
          content: `${chip.icon} ${chip.label}`,
          timestamp: Date.now(),
          type: 'text'
        }
      ])
    }

    // For humanize/rephrase chips, use the intelligence engine to build a
    // context-enriched prompt instead of requiring editor text selection
    if (action === 'humanize' || action === 'rephrase') {
      const conversationHistory: ConversationMessage[] = messages
        .filter(m => (m.role === 'user' || m.role === 'ai') && m.content?.trim())
        .map(m => ({ role: m.role as 'user' | 'ai', content: m.content }))
      const docMetadata: DocumentMetadata = {
        title: documentTitle || 'Untitled',
        documentType: wizardDocType || 'Custom',
        academicLevel: wizardAcademicLevel || 'Undergraduate',
        wordCount, totalPages,
        editorHtml: editorHtml || ''
      }
      const classified = classifyIntent(
        action === 'humanize' ? 'Humanize my document text' : 'Rephrase my text academically',
        conversationHistory,
        docMetadata
      )
      setAiPrompt(classified.enrichedPrompt)
      setTimeout(() => handleAiAction('custom'), 50)
      return
    }

    handleAiAction(action)
  }

  // ─── Handle key events ───────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // ─── Render a single chat message ────────────────────────────
  const renderMessage = (msg: ChatMessage) => {
    if (msg.type === 'export-card') {
      return (
        <div key={msg.id} className="flex justify-start px-4 mb-3 chat-bubble-enter">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-2.5 shadow-sm">
            <div className="flex items-center gap-1.5">
              {/* Apply */}
              <button
                onClick={() => {
                  insertAiContent()
                  setMessages(prev => [
                    ...prev,
                    { id: uid(), role: 'system', content: '✅ Content applied to document.', timestamp: Date.now(), type: 'status' }
                  ])
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 rounded-xl text-xs font-semibold active:scale-[0.97] transition-transform"
              >
                <Check className="w-3.5 h-3.5" />
                Apply
              </button>
              {/* Undo */}
              <button
                onClick={() => {
                  triggerUndo?.()
                  setMessages(prev => [
                    ...prev,
                    { id: uid(), role: 'system', content: '↩️ Undone.', timestamp: Date.now(), type: 'status' }
                  ])
                }}
                className="flex items-center gap-1 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 rounded-xl text-xs font-medium active:scale-[0.97] transition-transform"
                title="Undo"
              >
                <Undo2 className="w-3.5 h-3.5" />
                Undo
              </button>
              {/* Redo */}
              <button
                onClick={() => {
                  triggerRedo?.()
                  setMessages(prev => [
                    ...prev,
                    { id: uid(), role: 'system', content: '↪️ Redone.', timestamp: Date.now(), type: 'status' }
                  ])
                }}
                className="flex items-center gap-1 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 rounded-xl text-xs font-medium active:scale-[0.97] transition-transform"
                title="Redo"
              >
                <Redo2 className="w-3.5 h-3.5" />
                Redo
              </button>
            </div>
          </div>
        </div>
      )
    }

    // ─── Choice Card (Interactive Buttons) ─────────────────────
    if (msg.type === 'choice-card' && msg.choices) {
      return (
        <div key={msg.id} className="flex justify-start px-4 mb-3 chat-bubble-enter">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-3 max-w-[90%] space-y-2 shadow-sm">
            {msg.choices.map(choice => (
              <button
                key={choice.id}
                onClick={() => handleOnboardingChoice(choice.id)}
                className="w-full flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/60 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 border border-zinc-200/60 dark:border-zinc-700/40 hover:border-indigo-300 dark:hover:border-indigo-700 rounded-xl text-left transition-all active:scale-[0.97] cursor-pointer group"
              >
                <span className="text-lg flex-shrink-0">{choice.icon}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-bold text-zinc-800 dark:text-zinc-100 group-hover:text-indigo-700 dark:group-hover:text-indigo-300 block">{choice.label}</span>
                  {choice.description && (
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500 block mt-0.5">{choice.description}</span>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-300 dark:text-zinc-600 group-hover:text-indigo-400 flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )
    }

    // ─── Form Card (Inline Forms) ──────────────────────────────
    if (msg.type === 'form-card') {
      return (
        <div key={msg.id} className="flex justify-start px-4 mb-3 chat-bubble-enter">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 max-w-[92%] w-full shadow-sm space-y-3">
            {msg.formType === 'chapter-sources' ? (
              // Sources upload form
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-zinc-700 dark:text-zinc-200">
                  <Upload className="w-4 h-4 text-indigo-500" />
                  <span>Upload Reference Materials</span>
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Upload PDF or DOCX files. These will be used as context for AI generation.</p>
                <label className="flex items-center justify-center gap-2 py-3 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 border-2 border-dashed border-indigo-300 dark:border-indigo-700 rounded-xl text-xs font-bold cursor-pointer active:scale-[0.97] transition-transform">
                  <Upload className="w-4 h-4" />
                  <span>Tap to Select Files</span>
                  <input
                    type="file"
                    accept=".docx,.pdf"
                    multiple
                    onChange={(e) => {
                      handleWizardFileUpload(e)
                    }}
                    className="hidden"
                  />
                </label>
                {projectSources.length > 0 && (
                  <div className="space-y-1">
                    {projectSources.map((src, i) => (
                      <div key={i} className="flex items-center gap-2 text-[11px] text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/40 px-3 py-1.5 rounded-lg">
                        <FileText className="w-3 h-3 text-indigo-400" />
                        <span className="truncate flex-1">{src.name}</span>
                        <Check className="w-3 h-3 text-emerald-500" />
                      </div>
                    ))}
                  </div>
                )}
                <button
                  onClick={handleSourcesComplete}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all active:scale-[0.97] cursor-pointer shadow-sm"
                >
                  {projectSources.length > 0 ? `Continue with ${projectSources.length} file(s)` : 'Skip — No References'}
                </button>
              </div>
            ) : (
              // Info form (seminar/proposal/project)
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-zinc-700 dark:text-zinc-200">
                  <GraduationCap className="w-4 h-4 text-indigo-500" />
                  <span>{msg.formType === 'seminar-info' ? 'Seminar Report Details' : msg.formType === 'proposal-info' ? 'Research Proposal Details' : 'Project Details'}</span>
                </div>
                
                <div className="space-y-2.5">
                  <div>
                    <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block mb-1">Topic / Title *</label>
                    <input
                      type="text"
                      value={formData.topic}
                      onChange={(e) => setFormData(prev => ({ ...prev, topic: e.target.value }))}
                      placeholder="e.g. Impact of AI on Modern Education"
                      className="w-full text-xs p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 outline-none text-zinc-700 dark:text-zinc-300 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/30 transition-all placeholder:text-zinc-400"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block mb-1">Department</label>
                    <input
                      type="text"
                      value={formData.department}
                      onChange={(e) => setFormData(prev => ({ ...prev, department: e.target.value }))}
                      placeholder="e.g. Computer Science"
                      className="w-full text-xs p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 outline-none text-zinc-700 dark:text-zinc-300 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/30 transition-all placeholder:text-zinc-400"
                    />
                  </div>
                  {(msg.formType === 'seminar-info' || msg.formType === 'project-info') && (
                    <>
                      <div>
                        <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block mb-1">Student Full Name</label>
                        <input
                          type="text"
                          value={formData.studentName}
                          onChange={(e) => setFormData(prev => ({ ...prev, studentName: e.target.value }))}
                          placeholder="e.g. Olabanji Samuel"
                          className="w-full text-xs p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 outline-none text-zinc-700 dark:text-zinc-300 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/30 transition-all placeholder:text-zinc-400"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block mb-1">Matric Number</label>
                        <input
                          type="text"
                          value={formData.matricNumber}
                          onChange={(e) => setFormData(prev => ({ ...prev, matricNumber: e.target.value }))}
                          placeholder="e.g. 2020/ENG/001"
                          className="w-full text-xs p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 outline-none text-zinc-700 dark:text-zinc-300 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/30 transition-all placeholder:text-zinc-400"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block mb-1">Supervisor Name</label>
                        <input
                          type="text"
                          value={formData.supervisorName}
                          onChange={(e) => setFormData(prev => ({ ...prev, supervisorName: e.target.value }))}
                          placeholder="e.g. Dr. Adeyemi Johnson"
                          className="w-full text-xs p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 outline-none text-zinc-700 dark:text-zinc-300 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/30 transition-all placeholder:text-zinc-400"
                        />
                      </div>
                    </>
                  )}
                  <div>
                    <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block mb-1">Academic Level</label>
                    <select
                      value={formData.academicLevel}
                      onChange={(e) => setFormData(prev => ({ ...prev, academicLevel: e.target.value }))}
                      className="w-full text-xs p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 outline-none text-zinc-700 dark:text-zinc-300 cursor-pointer"
                    >
                      <option value="High School">High School</option>
                      <option value="Undergraduate">Undergraduate</option>
                      <option value="Master's">Master's</option>
                      <option value="Ph.D.">Ph.D.</option>
                    </select>
                  </div>
                </div>

                <button
                  onClick={handleInfoFormSubmit}
                  disabled={!formData.topic.trim()}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white disabled:text-zinc-500 rounded-xl text-xs font-bold transition-all active:scale-[0.97] cursor-pointer shadow-sm"
                >
                  Save Details & Continue
                </button>
              </div>
            )}
          </div>
        </div>
      )
    }

    if (msg.type === 'status') {
      return (
        <div key={msg.id} className="flex justify-center px-4 mb-3 chat-bubble-enter">
          <div 
            className="bg-zinc-100 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-300 text-[11px] font-medium px-4 py-1.5 rounded-full"
            dangerouslySetInnerHTML={{ __html: parseMarkdownToHtml(msg.content) }}
          />
        </div>
      )
    }

    if (msg.role === 'user') {
      return (
        <div key={msg.id} className="flex justify-end px-4 mb-3 chat-bubble-enter">
          <div className="bg-indigo-600 text-white rounded-2xl rounded-br-md px-4 py-2.5 max-w-[80%] text-sm leading-relaxed shadow-sm whitespace-pre-wrap">
            {msg.content}
          </div>
        </div>
      )
    }

    // AI or system message
    return (
      <div key={msg.id} className="flex justify-start px-4 mb-3 chat-bubble-enter">
        <div className="flex gap-2.5 max-w-[88%]">
          <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-950/50 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Bot className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-150 dark:border-zinc-800 rounded-2xl rounded-tl-md px-4 py-2.5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300 shadow-sm">
            <div
              className="prose-mobile [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5 [&_strong]:font-bold [&_em]:italic [&_h1]:text-base [&_h1]:font-bold [&_h1]:mt-2 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-2 [&_h3]:text-xs [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-indigo-400 [&_blockquote]:pl-2 [&_blockquote]:italic [&_code]:bg-zinc-100 [&_code]:dark:bg-zinc-800 [&_code]:px-1 [&_code]:rounded [&_code]:font-mono [&_code]:text-xs"
              dangerouslySetInnerHTML={{ __html: parseMarkdownToHtml(msg.content) }}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen h-[100dvh] bg-zinc-50 dark:bg-zinc-950 overflow-hidden relative touch-pan-y">
      
      {/* ━━━ Top Bar ━━━ */}
      <header className="flex items-center justify-between px-2.5 sm:px-4 py-2 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 z-30 flex-shrink-0 safe-area-top">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            onClick={() => setShowDrawer(true)}
            className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors active:scale-95 shrink-0"
          >
            <Menu className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
          </button>
          <div className="flex items-center gap-1 min-w-0">
            <img src="/WordPI.png" alt="WordPiLot" className="w-5.5 h-5.5 object-contain rounded-md shrink-0" />
            <span className="font-bold text-xs sm:text-sm tracking-tight truncate">
              <span className="text-zinc-900 dark:text-zinc-100">Word</span>
              <span className="text-[#185ABD] dark:text-[#3B82F6]">Pi</span>
              <span className="text-[#B68A35] text-[8px] align-super ml-0.5 font-bold uppercase">lot</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onOpenPricingModal?.()}
            className="flex items-center gap-1 px-2 py-1.5 bg-gradient-to-r from-amber-500 to-indigo-600 text-white rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer"
            title="Upgrade your plan for unlimited AI generations"
          >
            <Crown className="w-3.5 h-3.5 fill-amber-300 text-amber-200 shrink-0" />
            <span className="hidden sm:inline">Upgrade</span>
          </button>

          <button
            onClick={() => setShowPreview(true)}
            className="flex items-center gap-1 px-2 py-1.5 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded-lg text-xs font-bold transition-all active:scale-95 cursor-pointer"
            title="Preview your document pages"
          >
            <Eye className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">Preview</span>
          </button>
          
          <button
            onClick={toggleTheme}
            className="p-1.5 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer shrink-0"
          >
            {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
          <button
            onClick={() => userEmail ? setShowDrawer(true) : onOpenAuth()}
            className="w-6.5 h-6.5 rounded-full bg-indigo-600 text-white text-[11px] font-bold flex items-center justify-center uppercase shrink-0"
          >
            {userEmail ? userEmail.charAt(0) : 'G'}
          </button>
        </div>
      </header>

      {/* ━━━ Document Context Bar ━━━ */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-50/80 dark:bg-zinc-900/50 border-b border-zinc-150 dark:border-zinc-800 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <FileText className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
          <input
            type="text"
            value={documentTitle}
            onChange={(e) => setDocumentTitle(e.target.value)}
            className="text-xs font-semibold bg-transparent outline-none text-zinc-700 dark:text-zinc-300 w-full truncate"
            placeholder="Untitled Document"
          />
        </div>
        <div className="flex items-center gap-2 text-[10px] text-zinc-400 dark:text-zinc-500 flex-shrink-0">
          <span>{wordCount}w</span>
          <span className="w-0.5 h-0.5 bg-zinc-300 dark:bg-zinc-600 rounded-full" />
          <span>{totalPages}p</span>
        </div>
      </div>

      {/* ━━━ Chat Messages Area ━━━ */}
      <div className="flex-1 min-h-0 overflow-y-auto py-4 space-y-0 touch-pan-y overscroll-contain">
        {messages.map(renderMessage)}

        {/* Streaming indicator */}
        {isSimulatingAI && (
          <div className="flex justify-start px-4 mb-3">
            <div className="flex gap-2.5">
              <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-950/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Bot className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 animate-pulse" />
              </div>
              <div className="bg-white dark:bg-zinc-900 border border-zinc-150 dark:border-zinc-800 rounded-2xl rounded-tl-md px-4 py-3 shadow-sm">
                <div className="flex gap-1.5 items-center">
                  <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  {activeAiModel && (
                    <span className="text-[9px] font-mono text-zinc-400 dark:text-zinc-500 ml-2">
                      {activeAiModel}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Quick action chips (show when no messages or after welcome) */}
        {messages.length <= 1 && !isSimulatingAI && (
          <div className="px-4 mt-2">
            <p className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-2.5 px-1">
              Quick Actions
            </p>
            <div className="flex flex-wrap gap-2">
              {QUICK_ACTIONS.map(chip => (
                <button
                  key={chip.id}
                  onClick={() => handleQuickAction(chip.action)}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold transition-all active:scale-[0.96] shadow-xs border
                    ${chip.color === 'indigo' ? 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 border-indigo-200/60 dark:border-indigo-800/40' :
                      chip.color === 'blue' ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border-blue-200/60 dark:border-blue-800/40' :
                      chip.color === 'teal' ? 'bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300 border-teal-200/60 dark:border-teal-800/40' :
                      chip.color === 'emerald' ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-800/40' :
                      chip.color === 'purple' ? 'bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 border-purple-200/60 dark:border-purple-800/40' :
                      'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-200/60 dark:border-amber-800/40'
                    }`}
                >
                  <span>{chip.icon}</span>
                  <span>{chip.label}</span>
                </button>
              ))}
            </div>

            {/* Source upload chip */}
            <div className="mt-3">
              <label className="flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold bg-zinc-100 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-300 border border-zinc-200/60 dark:border-zinc-700/40 active:scale-[0.96] transition-transform cursor-pointer shadow-xs">
                <Upload className="w-3.5 h-3.5" />
                <span>Upload Reference (PDF/DOCX)</span>
                <input
                  type="file"
                  accept=".docx,.pdf"
                  multiple
                  onChange={handleWizardFileUpload}
                  className="hidden"
                />
              </label>
              {projectSources.length > 0 && (
                <p className="text-[10px] text-zinc-400 mt-1.5 px-1">
                  {projectSources.length} reference file{projectSources.length > 1 ? 's' : ''} loaded
                </p>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ━━━ Fixed Live File Action Bar (Positioned before Quick Actions & Input) ━━━ */}
      <div className="px-3 py-2 bg-white dark:bg-zinc-900 border-t border-b border-zinc-200/80 dark:border-zinc-800 flex items-center justify-between gap-2.5 flex-shrink-0 z-20 shadow-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0 font-bold">
            {isSimulatingAI ? (
              <Loader2 className="w-4 h-4 animate-spin text-indigo-600 dark:text-indigo-400" />
            ) : (
              <FileText className="w-4 h-4" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-zinc-800 dark:text-zinc-100 truncate max-w-[150px]">
                {documentTitle || 'Untitled Document'}
              </span>
              {isSimulatingAI ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  AI Updating...
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                  <Check className="w-2.5 h-2.5" />
                  Ready
                </span>
              )}
            </div>
            <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
              {wordCount} words • {totalPages} page{totalPages > 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {/* Eye (Preview) & Download (Export) Buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setShowPreview(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer"
            title="Preview document pages"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Preview</span>
          </button>
          <button
            onClick={() => setShowExportSheet(true)}
            className="p-1.5 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-white text-white dark:text-zinc-900 rounded-xl transition-all active:scale-95 cursor-pointer shadow-xs"
            title="Export / Download document"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ━━━ Bottom Input Bar ━━━ */}
      <div className="flex-shrink-0 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 px-3 py-2.5 mobile-input-bar z-30">
        <div className="flex items-end gap-2">
          <label className="p-2 text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors cursor-pointer flex-shrink-0">
            <Paperclip className="w-5 h-5" />
            <input
              type="file"
              accept=".docx,.pdf"
              multiple
              onChange={(e) => {
                handleWizardFileUpload(e)
                setMessages(prev => [
                  ...prev,
                  { id: uid(), role: 'system', content: '📎 Reference file uploaded.', timestamp: Date.now(), type: 'status' }
                ])
              }}
              className="hidden"
            />
          </label>
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe your document or ask WordPIlot..."
              rows={1}
              className="w-full bg-zinc-100 dark:bg-zinc-800 text-sm text-zinc-700 dark:text-zinc-300 rounded-2xl px-4 py-2.5 pr-12 outline-none border border-zinc-200/60 dark:border-zinc-700/40 focus:border-indigo-400 dark:focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20 transition-all resize-none max-h-32 placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
              style={{ minHeight: '42px' }}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!inputText.trim() || isSimulatingAI}
            className="p-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-200 dark:disabled:bg-zinc-800 text-white disabled:text-zinc-400 rounded-xl transition-all active:scale-95 flex-shrink-0 shadow-sm disabled:shadow-none"
          >
            <Send className="w-4.5 h-4.5" />
          </button>
        </div>
      </div>

      {/* ━━━ Side Drawer ━━━ */}
      {showDrawer && (
        <>
          <div
            className="fixed inset-0 bg-black/40 dark:bg-black/60 z-40 animate-in fade-in duration-200"
            onClick={() => setShowDrawer(false)}
          />
          <aside className="fixed left-0 top-0 bottom-0 w-72 bg-white dark:bg-zinc-900 shadow-2xl z-50 flex flex-col animate-in slide-in-from-left duration-250 safe-area-top safe-area-bottom">
            <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <img src="/WordPI.png" alt="Logo" className="w-6 h-6 rounded-md" />
                <span className="font-bold text-sm">
                  <span className="text-zinc-900 dark:text-zinc-100">Word</span>
                  <span className="text-[#185ABD] dark:text-[#3B82F6]">Pi</span>
                  <span className="text-[#B68A35] text-[8px] align-super ml-0.5 font-bold uppercase">lot</span>
                </span>
              </div>
              <button
                onClick={() => setShowDrawer(false)}
                className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg"
              >
                <X className="w-4.5 h-4.5 text-zinc-500" />
              </button>
            </div>

            {/* User info & Subscription */}
            <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 text-white font-bold flex items-center justify-center uppercase text-sm shadow-sm">
                  {userEmail ? userEmail.charAt(0) : 'G'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                    {userEmail || 'Guest Mode'}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`inline-block w-2 h-2 rounded-full ${
                      userSubscription?.status === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                    }`} />
                    <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 capitalize">
                      {userSubscription?.status === 'active' 
                        ? `${userSubscription.plan_tier || 'Pro'} Plan Active` 
                        : 'Free Tier (5 Daily Limit)'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Upgrade Button in Drawer */}
              <button
                onClick={() => { onOpenPricingModal?.(); setShowDrawer(false) }}
                className="w-full flex items-center justify-between p-2.5 bg-gradient-to-r from-amber-500 to-indigo-600 hover:from-amber-600 hover:to-indigo-700 text-white rounded-xl text-xs font-bold shadow-md active:scale-[0.98] transition-transform cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Crown className="w-4 h-4 text-amber-200 fill-amber-300" />
                  <span>{userSubscription?.status === 'active' ? 'Manage Plan & Benefits' : 'Upgrade Plan & Unlock All'}</span>
                </div>
                <ChevronRight className="w-4 h-4 text-white/80" />
              </button>
            </div>

            {/* Menu items */}
            <nav className="flex-1 p-3 space-y-1 text-xs font-semibold">
              <button
                onClick={() => { onBackToDashboard(); setShowDrawer(false) }}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-lg text-left transition-colors"
              >
                <Folder className="w-4 h-4 text-indigo-500" />
                <span>My Projects</span>
              </button>
              <button
                onClick={() => { onOpenWizard(); setShowDrawer(false) }}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-lg text-left transition-colors"
              >
                <Edit3 className="w-4 h-4 text-indigo-500" />
                <span>New Project Wizard</span>
              </button>
              <button
                onClick={() => { setShowPreview(true); setShowDrawer(false) }}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-lg text-left transition-colors"
              >
                <Eye className="w-4 h-4 text-teal-500" />
                <span>Preview Document</span>
              </button>
              <button
                onClick={() => { setShowExportSheet(true); setShowDrawer(false) }}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-lg text-left transition-colors"
              >
                <Download className="w-4 h-4 text-amber-500" />
                <span>Export Document</span>
              </button>

              <div className="border-t border-zinc-150 dark:border-zinc-800 my-2" />

              {/* WordPI Intelligence Engine Selector */}
              <div className="px-3 py-2">
                <label className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider block mb-1.5">WordPI Intelligence Engine</label>
                <select
                  value={aiEngine}
                  onChange={(e) => setAiEngine(e.target.value as any)}
                  className="w-full text-xs p-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 outline-none text-zinc-700 dark:text-zinc-300 cursor-pointer font-medium"
                >
                  <option value="gemini">WordPI Flash Engine (Standard)</option>
                  <option value="groq">WordPI Turbo Engine (Ultra Fast)</option>
                  <option value="grok">WordPI Pro Research Engine (Advanced)</option>
                </select>
              </div>

              <div className="border-t border-zinc-150 dark:border-zinc-800 my-2" />

              <button className="w-full flex items-center gap-3 px-3 py-2.5 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-lg text-left transition-colors">
                <Settings className="w-4 h-4 text-zinc-400" />
                <span>Settings</span>
              </button>
              <button className="w-full flex items-center gap-3 px-3 py-2.5 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-lg text-left transition-colors">
                <HelpCircle className="w-4 h-4 text-zinc-400" />
                <span>Help</span>
              </button>
              {userEmail ? (
                <button
                  onClick={() => { onSignOut(); setShowDrawer(false) }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg text-left transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out</span>
                </button>
              ) : (
                <button
                  onClick={() => { onOpenAuth(); setShowDrawer(false) }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 rounded-lg text-left transition-colors"
                >
                  <User className="w-4 h-4" />
                  <span>Sign In / Sign Up</span>
                </button>
              )}
            </nav>

            <div className="p-3 border-t border-zinc-150 dark:border-zinc-800 text-[10px] text-zinc-400">
              WordPIlot v1.0 • Mobile
            </div>
          </aside>
        </>
      )}

      {/* ━━━ Export Bottom Sheet ━━━ */}
      {showExportSheet && (
        <>
          <div
            className="fixed inset-0 bg-black/40 dark:bg-black/60 z-40 animate-in fade-in duration-200"
            onClick={() => setShowExportSheet(false)}
          />
          <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-zinc-900 rounded-t-3xl shadow-2xl z-50 animate-in slide-in-from-bottom duration-300 safe-area-bottom">
            <div className="w-10 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full mx-auto mt-3" />
            <div className="p-5 space-y-3">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Export Document</h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {documentTitle} • {wordCount} words • {totalPages} pages
              </p>
              <div className="space-y-2">
                <button
                  onClick={() => { exportToDocx('full'); setShowExportSheet(false) }}
                  className="w-full flex items-center gap-3 p-3.5 bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300 rounded-xl text-sm font-semibold active:scale-[0.98] transition-transform"
                >
                  <FileText className="w-5 h-5" />
                  <div className="text-left">
                    <span className="block">Word Document (.docx)</span>
                    <span className="text-[10px] font-normal text-blue-500/70">Full formatted document</span>
                  </div>
                </button>
                <button
                  onClick={() => { exportToPdfPrint('full'); setShowExportSheet(false) }}
                  className="w-full flex items-center gap-3 p-3.5 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300 rounded-xl text-sm font-semibold active:scale-[0.98] transition-transform"
                >
                  <FileText className="w-5 h-5" />
                  <div className="text-left">
                    <span className="block">PDF Document</span>
                    <span className="text-[10px] font-normal text-red-500/70">Print-ready vector PDF</span>
                  </div>
                </button>
                <button
                  onClick={() => { exportToPptx(); setShowExportSheet(false) }}
                  className="w-full flex items-center gap-3 p-3.5 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300 rounded-xl text-sm font-semibold active:scale-[0.98] transition-transform"
                >
                  <FileText className="w-5 h-5" />
                  <div className="text-left">
                    <span className="block">PowerPoint (.pptx)</span>
                    <span className="text-[10px] font-normal text-amber-500/70">Slide presentation</span>
                  </div>
                </button>
              </div>
              <button
                onClick={() => setShowExportSheet(false)}
                className="w-full py-2.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 active:text-zinc-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}

      {/* ━━━ Document Preview Modal ━━━ */}
      {showPreview && (
        <>
          <div
            className="fixed inset-0 bg-black/60 dark:bg-black/80 z-40 animate-in fade-in duration-200"
            onClick={() => setShowPreview(false)}
          />
          <div className="fixed inset-x-0 bottom-0 top-12 bg-zinc-100 dark:bg-zinc-950 rounded-t-3xl shadow-2xl z-50 flex flex-col animate-in slide-in-from-bottom duration-300 safe-area-bottom">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 rounded-t-3xl flex-shrink-0">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-indigo-500" />
                <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Print Preview</h3>
              </div>
              <button
                onClick={() => setShowPreview(false)}
                className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg cursor-pointer"
              >
                <X className="w-4.5 h-4.5 text-zinc-500" />
              </button>
            </div>

            {/* Interactive Zoom Control Slider */}
            <div className="flex items-center gap-3 bg-white dark:bg-zinc-900 px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 text-xs font-semibold select-none flex-shrink-0">
              <span className="text-zinc-500 dark:text-zinc-400 w-16">Zoom: {Math.round(previewZoom * 100)}%</span>
              <input
                type="range"
                min="0.3"
                max="1.0"
                step="0.05"
                value={previewZoom}
                onChange={(e) => setPreviewZoom(parseFloat(e.target.value))}
                className="flex-1 accent-indigo-650 h-1 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {/* Scrollable Pages Stack Canvas */}
            <div 
              ref={previewContainerRef}
              className="flex-1 overflow-y-auto p-4 flex flex-col items-center gap-4 bg-zinc-100 dark:bg-zinc-950"
            >
              {parsePagesFromHtml(editorHtml).length === 0 || !editorHtml ? (
                <div className="text-center py-20">
                  <FileText className="w-12 h-12 text-zinc-300 dark:text-zinc-700 mx-auto mb-2" />
                  <p className="text-xs text-zinc-550 dark:text-zinc-400 italic">No content yet. Use the chat to generate document pages.</p>
                </div>
              ) : (
                parsePagesFromHtml(editorHtml).map((pageHtml, index, allPages) => (
                  <div
                    key={index}
                    style={{
                      width: `${794 * previewZoom}px`,
                      height: `${1123 * previewZoom}px`,
                      overflow: 'hidden'
                    }}
                    className="mb-4 mx-auto relative flex-shrink-0 bg-white dark:bg-zinc-900 shadow-md border border-zinc-200 dark:border-zinc-800 rounded-sm"
                  >
                    <div
                      className="relative bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 overflow-hidden box-border"
                      style={{
                        width: '794px',
                        height: '1123px',
                        transform: `scale(${previewZoom})`,
                        transformOrigin: 'top left',
                      }}
                    >
                      {/* Page Header */}
                      <div className="absolute top-0 left-0 right-0 h-[96px] px-[72px] flex items-end justify-between border-b border-dashed border-zinc-150 dark:border-zinc-850 pb-2 text-xs text-zinc-400 dark:text-zinc-500 font-sans pointer-events-none select-none">
                        <span className="truncate max-w-[400px]">{docHeader}</span>
                      </div>

                      {/* Page Content Area (rendered to look like actual print sheets) */}
                      <div
                        className="absolute top-[96px] left-0 right-0 h-[931px] px-[72px] overflow-hidden text-left font-serif prose prose-sm max-w-none text-zinc-850 dark:text-zinc-200 [&_p]:my-1.5 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-3 [&_blockquote]:border-indigo-400 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-zinc-500 [&_blockquote]:my-2"
                        dangerouslySetInnerHTML={{ __html: pageHtml }}
                      />

                      {/* Page Footer */}
                      <div className="absolute bottom-0 left-0 right-0 h-[96px] px-[72px] flex items-start justify-between border-t border-dashed border-zinc-150 dark:border-zinc-850 pt-2 text-xs text-zinc-400 dark:text-zinc-500 font-sans pointer-events-none select-none">
                        <span className="truncate max-w-[450px]">{docFooter}</span>
                        <span>Page {index + 1} of {allPages.length}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Modal Bottom Footer Actions */}
            <div className="flex gap-2 p-4 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 flex-shrink-0">
              <button
                onClick={onForceSave}
                className={`flex-1 py-2.5 rounded-xl text-xs font-semibold active:scale-[0.97] transition-all flex items-center justify-center gap-1.5 cursor-pointer border ${
                  isSaved
                    ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/40'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white border-transparent'
                }`}
              >
                <Check className="w-3.5 h-3.5" />
                <span>{isSaved ? 'Draft Saved' : 'Save Changes'}</span>
              </button>
              <button
                onClick={() => { exportToDocx('full'); setShowPreview(false) }}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold active:scale-[0.97] transition-transform cursor-pointer"
              >
                Export .docx
              </button>
              <button
                onClick={() => { exportToPdfPrint('full'); setShowPreview(false) }}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-750 text-white rounded-xl text-xs font-semibold active:scale-[0.97] transition-transform cursor-pointer"
              >
                Export PDF
              </button>
            </div>
          </div>
        </>
      )}

      {/* ━━━ Online Journal Search & Citation Picker Modal ━━━ */}
      {showJournalModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex flex-col justify-end sm:justify-center p-0 sm:p-4 animate-fade-in">
          <div className="bg-white dark:bg-zinc-900 w-full sm:max-w-xl rounded-t-3xl sm:rounded-2xl max-h-[88vh] flex flex-col shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-indigo-100 dark:bg-indigo-950/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                  <Search className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-zinc-900 dark:text-white">Search Academic Journals</h3>
                  <p className="text-[10px] text-zinc-400">Select peer-reviewed papers to cite in your document</p>
                </div>
              </div>
              <button
                onClick={() => setShowJournalModal(false)}
                className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full text-zinc-400 hover:text-zinc-600 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search Bar Input */}
            <div className="p-4 border-b border-zinc-150 dark:border-zinc-800 bg-white dark:bg-zinc-900">
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  executeJournalSearch(journalSearchQuery)
                }}
                className="flex items-center gap-2"
              >
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={journalSearchQuery}
                    onChange={(e) => setJournalSearchQuery(e.target.value)}
                    placeholder="Search by topic, keyword, or journal..."
                    className="w-full pl-9 pr-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs text-zinc-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSearchingJournals}
                  className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {isSearchingJournals ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Search'}
                </button>
              </form>
            </div>

            {/* Journal Results List with Checkboxes */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {isSearchingJournals ? (
                <div className="py-12 text-center space-y-3">
                  <Loader2 className="w-7 h-7 animate-spin text-indigo-600 mx-auto" />
                  <p className="text-xs text-zinc-500 font-medium">Searching Crossref academic database...</p>
                </div>
              ) : journalPapers.length === 0 ? (
                <div className="py-12 text-center space-y-2">
                  <BookOpen className="w-8 h-8 text-zinc-300 dark:text-zinc-600 mx-auto" />
                  <p className="text-xs font-semibold text-zinc-500">No journals found</p>
                  <p className="text-[11px] text-zinc-400">Try searching for key topics like "{documentTitle || 'Artificial Intelligence'}"</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                      Found {journalPapers.length} peer-reviewed papers
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedPaperIds.size === journalPapers.length) {
                          setSelectedPaperIds(new Set())
                        } else {
                          setSelectedPaperIds(new Set(journalPapers.map(p => p.id)))
                        }
                      }}
                      className="text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold hover:underline cursor-pointer"
                    >
                      {selectedPaperIds.size === journalPapers.length ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>

                  {journalPapers.map((paper) => {
                    const isChecked = selectedPaperIds.has(paper.id)
                    return (
                      <div
                        key={paper.id}
                        onClick={() => {
                          const next = new Set(selectedPaperIds)
                          if (isChecked) next.delete(paper.id)
                          else next.add(paper.id)
                          setSelectedPaperIds(next)
                        }}
                        className={`p-3.5 border rounded-2xl cursor-pointer transition-all ${
                          isChecked
                            ? 'bg-indigo-50/60 dark:bg-indigo-950/30 border-indigo-300 dark:border-indigo-700 shadow-xs'
                            : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="mt-1 w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 flex-shrink-0 cursor-pointer"
                          />
                          <div className="flex-1 min-w-0 space-y-1">
                            <h4 className="text-xs font-bold text-zinc-900 dark:text-white leading-snug">
                              {paper.title}
                            </h4>
                            <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                              <span className="font-semibold text-indigo-700 dark:text-indigo-300">{paper.authors}</span>
                              <span>•</span>
                              <span>{paper.journal}</span>
                              <span>•</span>
                              <span className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 py-0.2 rounded text-zinc-600 dark:text-zinc-300">{paper.year}</span>
                            </div>
                            <p className="text-[11px] text-zinc-600 dark:text-zinc-400 line-clamp-2 leading-relaxed mt-1">
                              {paper.abstract}
                            </p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </>
              )}
            </div>

            {/* Footer Action */}
            <div className="p-3.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/60 flex items-center justify-between">
              <span className="text-xs text-zinc-500 font-medium">
                {selectedPaperIds.size} paper{selectedPaperIds.size !== 1 ? 's' : ''} selected
              </span>
              <button
                onClick={handleImportSelectedJournals}
                disabled={selectedPaperIds.size === 0}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-transform active:scale-95 shadow-xs"
              >
                <BookmarkPlus className="w-4 h-4" />
                Import Selected Citations
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ━━━ Document Formatting Style Preview Modal ━━━ */}
      {showFormattingModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex flex-col justify-end sm:justify-center p-0 sm:p-4 animate-fade-in">
          <div className="bg-white dark:bg-zinc-900 w-full sm:max-w-xl rounded-t-3xl sm:rounded-2xl max-h-[90vh] flex flex-col shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-indigo-100 dark:bg-indigo-950/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                  <Edit3 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-zinc-900 dark:text-white">Document Formatting Style</h3>
                  <p className="text-[10px] text-zinc-400">Preview & customize typography before generating</p>
                </div>
              </div>
              <button
                onClick={() => setShowFormattingModal(false)}
                className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-full text-zinc-400 hover:text-zinc-600 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Live Preview Box */}
              <div>
                <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">
                  Live Style Preview
                </span>
                <div
                  className="p-4 rounded-2xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/40 dark:bg-indigo-950/20 shadow-inner transition-all space-y-1.5"
                  style={{
                    fontFamily: selectedFont === 'playfair' ? "'Times New Roman', serif" : selectedFont === 'arial' ? 'Arial, sans-serif' : selectedFont === 'georgia' ? 'Georgia, serif' : selectedFont === 'inter' ? 'Inter, sans-serif' : 'inherit',
                    lineHeight: selectedSpacing
                  }}
                >
                  <h4 className="text-xs font-bold text-zinc-900 dark:text-white tracking-wide">
                    CHAPTER 1: INTRODUCTION
                  </h4>
                  <p className="text-[11px] text-zinc-700 dark:text-zinc-300">
                    This academic document investigates the foundational principles of <strong>{documentTitle || 'Research Project'}</strong>. Synthesized at the <strong>{selectedLevel}</strong> level using APA 7th edition citation style.
                  </p>
                </div>
              </div>

              {/* Font Family Selection */}
              <div>
                <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block mb-2">
                  Typography / Font Family
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'playfair', label: 'Times New Roman', desc: 'APA Standard Serif', fontCss: "'Times New Roman', serif" },
                    { id: 'arial', label: 'Arial', desc: 'Clean Sans-Serif', fontCss: 'Arial, sans-serif' },
                    { id: 'georgia', label: 'Georgia', desc: 'Classic Academic Serif', fontCss: 'Georgia, serif' },
                    { id: 'inter', label: 'Inter', desc: 'Modern Clean Sans', fontCss: 'Inter, sans-serif' }
                  ].map(font => (
                    <button
                      key={font.id}
                      type="button"
                      onClick={() => setSelectedFont(font.id as any)}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        selectedFont === font.id
                          ? 'bg-indigo-50 dark:bg-indigo-950/50 border-indigo-500 ring-2 ring-indigo-500/20'
                          : 'bg-zinc-50 dark:bg-zinc-800/40 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300'
                      }`}
                    >
                      <span className="text-xs font-bold text-zinc-900 dark:text-white block" style={{ fontFamily: font.fontCss }}>
                        {font.label}
                      </span>
                      <span className="text-[10px] text-zinc-400 block mt-0.5">{font.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Line Spacing Selection */}
              <div>
                <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block mb-2">
                  Line Spacing
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: '1.5', label: '1.5 Spacing', desc: 'Standard Academic' },
                    { id: '2.0', label: '2.0 Double', desc: 'APA Thesis Standard' },
                    { id: '1.15', label: '1.15 Compact', desc: 'Tight Reading' }
                  ].map(spacing => (
                    <button
                      key={spacing.id}
                      type="button"
                      onClick={() => setSelectedSpacing(spacing.id)}
                      className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                        selectedSpacing === spacing.id
                          ? 'bg-indigo-50 dark:bg-indigo-950/50 border-indigo-500 ring-2 ring-indigo-500/20'
                          : 'bg-zinc-50 dark:bg-zinc-800/40 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300'
                      }`}
                    >
                      <span className="text-xs font-bold text-zinc-900 dark:text-white block">
                        {spacing.label}
                      </span>
                      <span className="text-[9px] text-zinc-400 block mt-0.5">{spacing.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Academic Level Selection */}
              <div>
                <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider block mb-2">
                  Academic Level
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {['Undergraduate', "Master's", 'Ph.D. / Researcher'].map(level => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setSelectedLevel(level)}
                      className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                        selectedLevel === level
                          ? 'bg-indigo-50 dark:bg-indigo-950/50 border-indigo-500 ring-2 ring-indigo-500/20'
                          : 'bg-zinc-50 dark:bg-zinc-800/40 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300'
                      }`}
                    >
                      <span className="text-xs font-bold text-zinc-900 dark:text-white block truncate">
                        {level}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Footer Confirm Button */}
            <div className="p-3.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/60 flex items-center justify-between">
              <button
                onClick={() => setShowFormattingModal(false)}
                className="px-3.5 py-2 text-xs font-semibold text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmFormattingAndGenerate}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-transform active:scale-95 shadow-xs"
              >
                <Check className="w-4 h-4" />
                Confirm Style & Generate Full Document
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
