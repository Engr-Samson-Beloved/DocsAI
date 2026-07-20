"use client"

import React, { useState, useRef, useEffect } from 'react'
import {
  Send,
  Paperclip,
  FileText,
  Sparkles,
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
  User
} from 'lucide-react'
import { Project } from '../Dashboard/Dashboard'

// ─── Chat Message Types ────────────────────────────────────────────
interface ChatMessage {
  id: string
  role: 'user' | 'ai' | 'system'
  content: string
  timestamp: number
  type?: 'text' | 'status' | 'export-card' | 'suggestion-chips'
  isStreaming?: boolean
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
  
  // Setup wizard
  onOpenWizard: () => void

  // Full blueprint generator
  onGenerateBlueprint: () => void
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
  onOpenWizard,
  onGenerateBlueprint,
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

  // ─── Initialize with welcome message ─────────────────────────
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          id: uid(),
          role: 'system',
          content: `Welcome to **WordPIlot**! 👋\n\nI'm your AI academic writing assistant. Describe what you'd like to write, or tap a quick action below to get started.`,
          timestamp: Date.now(),
          type: 'text'
        }
      ])
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  // ─── Send user message ───────────────────────────────────────
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

    // Set the AI prompt and trigger custom action
    setAiPrompt(text)
    setInputText('')

    // Trigger AI action after a tick so aiPrompt is set
    setTimeout(() => {
      handleAiAction('custom')
    }, 50)
  }

  // ─── Handle quick action chip tap ────────────────────────────
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
          content: `✨ Generating full document blueprint for **"${documentTitle}"**...`,
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
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-3.5 max-w-[85%] space-y-2.5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-bold text-zinc-700 dark:text-zinc-200">
              <FileText className="w-4 h-4 text-indigo-500" />
              <span>Document Ready</span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span>{wordCount} words</span>
              <span className="w-1 h-1 bg-zinc-300 dark:bg-zinc-600 rounded-full" />
              <span>{totalPages} pages</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowPreview(true)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 rounded-xl text-xs font-semibold active:scale-[0.97] transition-transform"
              >
                <Eye className="w-3.5 h-3.5" />
                Preview
              </button>
              <button
                onClick={() => {
                  insertAiContent()
                  setMessages(prev => [
                    ...prev,
                    { id: uid(), role: 'system', content: '✅ Content inserted into document.', timestamp: Date.now(), type: 'status' }
                  ])
                }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 rounded-xl text-xs font-semibold active:scale-[0.97] transition-transform"
              >
                <Check className="w-3.5 h-3.5" />
                Apply
              </button>
              <button
                onClick={() => setShowExportSheet(true)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300 rounded-xl text-xs font-semibold active:scale-[0.97] transition-transform"
              >
                <Download className="w-3.5 h-3.5" />
                Export
              </button>
            </div>
          </div>
        </div>
      )
    }

    if (msg.type === 'status') {
      return (
        <div key={msg.id} className="flex justify-center px-4 mb-3 chat-bubble-enter">
          <div className="bg-zinc-100 dark:bg-zinc-800/60 text-zinc-500 dark:text-zinc-400 text-[11px] font-medium px-4 py-1.5 rounded-full">
            {msg.content}
          </div>
        </div>
      )
    }

    if (msg.role === 'user') {
      return (
        <div key={msg.id} className="flex justify-end px-4 mb-3 chat-bubble-enter">
          <div className="bg-indigo-600 text-white rounded-2xl rounded-br-md px-4 py-2.5 max-w-[80%] text-sm leading-relaxed shadow-sm">
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
            <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-150 dark:border-zinc-800 rounded-2xl rounded-tl-md px-4 py-2.5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300 shadow-sm">
            {msg.role === 'ai' ? (
              <div
                className="prose-mobile [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5 [&_strong]:font-bold [&_em]:italic [&_h1]:text-base [&_h1]:font-bold [&_h1]:mt-2 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-2 [&_h3]:text-xs [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-indigo-400 [&_blockquote]:pl-2 [&_blockquote]:italic [&_code]:bg-zinc-100 [&_code]:dark:bg-zinc-800 [&_code]:px-1 [&_code]:rounded [&_code]:font-mono [&_code]:text-xs"
                dangerouslySetInnerHTML={{ __html: msg.content }}
              />
            ) : (
              <span className="whitespace-pre-wrap">{msg.content}</span>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-zinc-50 dark:bg-zinc-950 overflow-hidden relative">
      
      {/* ━━━ Top Bar ━━━ */}
      <header className="flex items-center justify-between px-4 py-2.5 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 z-30 flex-shrink-0 safe-area-top">
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowDrawer(true)}
            className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors active:scale-95"
          >
            <Menu className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
          </button>
          <div className="flex items-center gap-1.5">
            <img src="/WordPI.png" alt="WordPiLot" className="w-6 h-6 object-contain rounded-md" />
            <span className="font-bold text-sm tracking-tight">
              <span className="text-zinc-900 dark:text-zinc-100">Word</span>
              <span className="text-[#185ABD] dark:text-[#3B82F6]">Pi</span>
              <span className="text-[#B68A35] text-[8px] align-super ml-0.5 font-bold uppercase">lot</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowPreview(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded-lg text-xs font-bold transition-all mr-1.5 active:scale-95 cursor-pointer"
            title="Preview your document pages"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Preview</span>
          </button>
          
          <button
            onClick={toggleTheme}
            className="p-2 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
          >
            {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
          <button
            onClick={() => userEmail ? setShowDrawer(true) : onOpenAuth()}
            className="w-7 h-7 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center uppercase"
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
      <div className="flex-1 overflow-y-auto py-4 space-y-0">
        {messages.map(renderMessage)}

        {/* Streaming indicator */}
        {isSimulatingAI && (
          <div className="flex justify-start px-4 mb-3">
            <div className="flex gap-2.5">
              <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-950/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 animate-pulse" />
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

            {/* User info */}
            <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center uppercase text-sm">
                  {userEmail ? userEmail.charAt(0) : 'G'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                    {userEmail || 'Guest Mode'}
                  </p>
                  <p className="text-[10px] text-zinc-400">
                    {userEmail ? 'Cloud Sync Active' : 'Offline Only'}
                  </p>
                </div>
              </div>
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

              {/* AI Engine Selector */}
              <div className="px-3 py-2">
                <label className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider block mb-1.5">AI Engine</label>
                <select
                  value={aiEngine}
                  onChange={(e) => setAiEngine(e.target.value as any)}
                  className="w-full text-xs p-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 outline-none text-zinc-700 dark:text-zinc-300 cursor-pointer"
                >
                  <option value="gemini">Gemini 2.5 Flash (Free)</option>
                  <option value="groq">Groq Llama 3 (Free & Fast)</option>
                  <option value="grok">xAI Grok-2 (Subscription)</option>
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
    </div>
  )
}
