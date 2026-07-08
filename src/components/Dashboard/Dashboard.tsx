"use client"

import React, { useState } from 'react'
import {
  Plus,
  Search,
  LayoutGrid,
  List as ListIcon,
  Calendar,
  Edit3,
  Trash2,
  Folder,
  Moon,
  Sun,
  Menu,
  MoreVertical,
  ChevronDown,
  User,
  Settings,
  LogOut,
  HelpCircle,
  Sparkles,
  FileText,
  Grid
} from 'lucide-react'

export interface Project {
  id: string
  title: string
  content: string // stringified tiptap JSON content
  createdAt: number
  updatedAt: number
  wordCount: number
  charCount: number
  documentType: 'Seminar' | 'Proposal' | 'Project' | 'Custom'
  academicLevel: string
  academicTone?: string
  docHeader?: string
  docFooter?: string
}

interface DashboardProps {
  theme: 'light' | 'dark'
  toggleTheme: () => void
  projects: Project[]
  onCreateProject: () => void
  onCreateProjectWithTemplate: (type: 'Seminar' | 'Proposal' | 'Project' | 'Custom') => void
  onDeleteProject: (id: string) => void
  onRenameProject: (id: string) => void
  onLoadProject: (id: string) => void
  userEmail: string | null
  onSignOut: () => void
  onOpenAuth: () => void
}

// Subcomponent to render a miniature version of the document content
const MiniDocumentPreview = ({ contentStr, title }: { contentStr: string; title: string }) => {
  try {
    const json = JSON.parse(contentStr)
    const textNodes: string[] = []

    const extractText = (node: any) => {
      if (textNodes.length >= 8) return
      if (node.type === 'text' && node.text) {
        textNodes.push(node.text)
      }
      if (node.content) {
        node.content.forEach(extractText)
      }
    }

    extractText(json)

    if (textNodes.length === 0) {
      return <DefaultPreview />
    }

    return (
      <div className="flex flex-col gap-1 w-full h-full text-[4px] leading-[6px] text-zinc-400 select-none overflow-hidden p-3 font-serif">
        <h4 className="text-[6px] font-bold text-zinc-800 dark:text-zinc-200 mb-1.5 border-b border-zinc-100 dark:border-zinc-800 pb-1 truncate">
          {title}
        </h4>
        {textNodes.map((text, i) => (
          <p key={i} className="truncate tracking-wide text-zinc-500 dark:text-zinc-400">
            {text.slice(0, 60)}
          </p>
        ))}
      </div>
    )
  } catch (e) {
    return <DefaultPreview />
  }
}

const DefaultPreview = () => (
  <div className="w-full h-full p-4 flex flex-col gap-2 bg-white dark:bg-zinc-900 select-none">
    <div className="h-2.5 bg-zinc-200 dark:bg-zinc-800 rounded w-2/3 mb-2"></div>
    <div className="space-y-1.5">
      <div className="h-1 bg-zinc-100 dark:bg-zinc-850 rounded w-full"></div>
      <div className="h-1 bg-zinc-100 dark:bg-zinc-850 rounded w-full"></div>
      <div className="h-1 bg-zinc-100 dark:bg-zinc-850 rounded w-5/6"></div>
      <div className="h-1 bg-zinc-100 dark:bg-zinc-850 rounded w-11/12"></div>
      <div className="h-1 bg-zinc-100 dark:bg-zinc-850 rounded w-3/4"></div>
      <div className="h-1 bg-zinc-100 dark:bg-zinc-850 rounded w-5/6"></div>
    </div>
  </div>
)

export default function Dashboard({
  theme,
  toggleTheme,
  projects,
  onCreateProject,
  onCreateProjectWithTemplate,
  onDeleteProject,
  onRenameProject,
  onLoadProject,
  userEmail,
  onSignOut,
  onOpenAuth
}: DashboardProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<'updated' | 'title' | 'words'>('updated')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [ownerFilter, setOwnerFilter] = useState<'anyone' | 'me' | 'notme'>('anyone')

  // Menu toggles
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [showProfileDropdown, setShowProfileDropdown] = useState(false)
  const [showAppGridDropdown, setShowAppGridDropdown] = useState(false)
  const [showHamburgerDrawer, setShowHamburgerDrawer] = useState(false)
  const [activeMenuProjectId, setActiveMenuProjectId] = useState<string | null>(null)

  // Utility to format timestamp
  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp)
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }

  // Filter and sort projects
  const filteredProjects = projects
    .filter(p => {
      const matchesSearch = p.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            p.documentType.toLowerCase().includes(searchQuery.toLowerCase())
      if (ownerFilter === 'notme') {
        return false // Simulate not owned
      }
      return matchesSearch
    })
    .sort((a, b) => {
      if (sortBy === 'title') {
        return a.title.localeCompare(b.title)
      }
      if (sortBy === 'words') {
        return b.wordCount - a.wordCount
      }
      return b.updatedAt - a.updatedAt // Default: 'updated'
    })

  return (
    <div className="flex flex-col flex-1 h-screen bg-[#F8F9FA] dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200 font-sans select-none overflow-hidden relative">
      
      {/* Top Application Header */}
      <header className="flex items-center justify-between px-4 py-2 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0 z-20">
        <div className="flex items-center gap-2">
          {/* Hamburger Icon */}
          <button 
            onClick={() => setShowHamburgerDrawer(true)}
            className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors cursor-pointer text-zinc-550 dark:text-zinc-400"
          >
            <Menu className="w-5 h-5" />
          </button>
          
          {/* Brand Logo & Name */}
          <div className="flex items-center gap-2 ml-1 cursor-pointer" onClick={() => window.location.reload()}>
            <img src="/WordPI.png" alt="WordPiLot Logo" className="w-7 h-7 object-contain rounded-md" />
            <span className="font-bold text-lg tracking-tight select-none">
              <span className="text-[#1B1F23] dark:text-[#E5E7EB]">Word</span>
              <span className="text-[#185ABD] dark:text-[#3B82F6]">Pi</span>
              <span className="text-[#B68A35] text-[10px] align-super ml-0.5 font-bold uppercase">lot</span>
            </span>
          </div>
        </div>

        {/* Central Search Bar */}
        <div className="flex-1 max-w-2xl mx-6 relative flex items-center">
          <Search className="w-4 h-4 absolute left-4 text-zinc-400 dark:text-zinc-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#F1F3F4] dark:bg-zinc-800/80 hover:bg-zinc-200/50 dark:hover:bg-zinc-700/50 focus:bg-white dark:focus:bg-zinc-900 pl-11 pr-10 py-2 rounded-full text-sm outline-none transition-all border border-transparent focus:border-zinc-200 dark:focus:border-zinc-700 text-zinc-700 dark:text-zinc-200 shadow-none focus:shadow-xs"
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute right-4 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 text-lg font-bold"
            >
              ×
            </button>
          )}
        </div>

        {/* Right Side Tools */}
        <div className="flex items-center gap-2">
          {/* Theme Switcher */}
          <button
            onClick={toggleTheme}
            className="p-2 text-zinc-500 hover:text-indigo-650 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-indigo-400 dark:hover:bg-zinc-800 rounded-full transition-all cursor-pointer"
            title="Toggle theme"
          >
            {theme === 'light' ? <Moon className="w-4.5 h-4.5" /> : <Sun className="w-4.5 h-4.5" />}
          </button>

          {/* Upgrade Pill Button */}
          <button
            onClick={() => setShowUpgradeModal(true)}
            className="flex items-center gap-1.5 px-5 py-1.5 bg-[#E8F0FE] dark:bg-indigo-950 text-[#1A73E8] dark:text-indigo-350 rounded-full text-xs font-semibold hover:bg-[#D2E3FC] dark:hover:bg-indigo-900/60 transition-all cursor-pointer shadow-xs"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Upgrade</span>
          </button>

          {/* App Grid */}
          <div className="relative">
            <button
              onClick={() => {
                setShowAppGridDropdown(!showAppGridDropdown)
                setShowProfileDropdown(false)
              }}
              className="p-2 text-zinc-650 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full cursor-pointer transition-colors"
            >
              <Grid className="w-4.5 h-4.5" />
            </button>
            {showAppGridDropdown && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setShowAppGridDropdown(false)}></div>
                <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-850 rounded-2xl shadow-xl p-4 grid grid-cols-3 gap-4 z-30 animate-in fade-in duration-150">
                  <div className="flex flex-col items-center gap-1 p-2 hover:bg-zinc-50 dark:hover:bg-zinc-850 rounded-xl cursor-pointer">
                    <div className="w-9 h-9 bg-blue-500 rounded-lg flex items-center justify-center text-white font-bold shadow-sm">D</div>
                    <span className="text-[10px] text-zinc-600 dark:text-zinc-350">Docs</span>
                  </div>
                  <div className="flex flex-col items-center gap-1 p-2 hover:bg-zinc-50 dark:hover:bg-zinc-850 rounded-xl opacity-60 cursor-not-allowed">
                    <div className="w-9 h-9 bg-green-500 rounded-lg flex items-center justify-center text-white font-bold shadow-sm">S</div>
                    <span className="text-[10px] text-zinc-600 dark:text-zinc-350">Sheets</span>
                  </div>
                  <div className="flex flex-col items-center gap-1 p-2 hover:bg-zinc-50 dark:hover:bg-zinc-850 rounded-xl opacity-60 cursor-not-allowed">
                    <div className="w-9 h-9 bg-amber-500 rounded-lg flex items-center justify-center text-white font-bold shadow-sm">P</div>
                    <span className="text-[10px] text-zinc-600 dark:text-zinc-350">Slides</span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Profile Avatar & Authentication */}
          <div className="relative ml-1">
            <button
              onClick={() => {
                setShowProfileDropdown(!showProfileDropdown)
                setShowAppGridDropdown(false)
              }}
              className="w-8 h-8 rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center text-sm shadow-inner cursor-pointer hover:ring-2 hover:ring-indigo-300 dark:hover:ring-indigo-900 transition-all uppercase"
            >
              {userEmail ? userEmail.charAt(0) : 'G'}
            </button>
            {showProfileDropdown && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setShowProfileDropdown(false)}></div>
                <div className="absolute right-0 mt-2 w-72 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-850 rounded-2xl shadow-xl p-4 z-30 animate-in fade-in duration-150 flex flex-col items-center text-center">
                  <div className="w-14 h-14 rounded-full bg-indigo-650 text-white font-bold flex items-center justify-center text-xl shadow-md mb-2 uppercase">
                    {userEmail ? userEmail.charAt(0) : 'G'}
                  </div>
                  {userEmail ? (
                    <>
                      <h4 className="font-bold text-zinc-900 dark:text-zinc-50 text-sm">Active User</h4>
                      <p className="text-[11px] text-zinc-450 dark:text-zinc-500 truncate max-w-full px-2">{userEmail}</p>
                      
                      <div className="mt-2.5 px-3 py-1 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/40 rounded-full flex items-center gap-1.5 text-[10px] text-emerald-700 dark:text-emerald-400 font-bold">
                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></span>
                        <span>Cloud Backup Sync Active</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <h4 className="font-bold text-zinc-900 dark:text-zinc-50 text-sm">Guest Mode</h4>
                      <p className="text-[11px] text-zinc-450 dark:text-zinc-500">Offline changes only</p>
                      
                      <button 
                        onClick={() => { onOpenAuth(); setShowProfileDropdown(false) }}
                        className="mt-3 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-750 text-white rounded-full text-xs font-bold cursor-pointer w-full transition-all shadow-md shadow-indigo-500/10"
                      >
                        Sign In / Sign Up
                      </button>
                    </>
                  )}
                  
                  <div className="w-full border-t border-zinc-150 dark:border-zinc-800 my-3"></div>
                  
                  <div className="w-full flex flex-col gap-1 text-left text-xs text-zinc-600 dark:text-zinc-350">
                    <button className="flex items-center gap-2 p-2 hover:bg-zinc-50 dark:hover:bg-zinc-850 rounded-lg cursor-pointer">
                      <Settings className="w-3.5 h-3.5" />
                      <span>Settings</span>
                    </button>
                    <button className="flex items-center gap-2 p-2 hover:bg-zinc-50 dark:hover:bg-zinc-850 rounded-lg cursor-pointer">
                      <HelpCircle className="w-3.5 h-3.5" />
                      <span>Help & Feedback</span>
                    </button>
                    {userEmail && (
                      <button 
                        onClick={() => { onSignOut(); setShowProfileDropdown(false) }}
                        className="flex items-center gap-2 p-2 hover:bg-red-50 dark:hover:bg-red-950/20 text-red-650 dark:text-red-400 rounded-lg cursor-pointer"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Sign Out</span>
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hamburger Drawer Menu */}
      {showHamburgerDrawer && (
        <>
          <div className="fixed inset-0 bg-black/30 dark:bg-black/60 z-30 animate-in fade-in duration-200" onClick={() => setShowHamburgerDrawer(false)}></div>
          <aside className="fixed left-0 top-0 bottom-0 w-64 bg-white dark:bg-zinc-900 shadow-2xl border-r border-zinc-200 dark:border-zinc-850 z-40 p-4 flex flex-col gap-4 animate-in slide-in-from-left duration-250">
            <div className="flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <img src="/WordPI.png" alt="WordPiLot Logo" className="w-7 h-7 object-contain rounded-md" />
              <span className="font-bold text-base tracking-tight select-none">
                <span className="text-[#1B1F23] dark:text-[#E5E7EB]">Word</span>
                <span className="text-[#185ABD] dark:text-[#3B82F6]">Pi</span>
                <span className="text-[#B68A35] text-[10px] align-super ml-0.5 font-bold uppercase">lot</span>
              </span>
            </div>
            
            <div className="flex-1 flex flex-col gap-1.5 text-xs font-semibold text-zinc-650 dark:text-zinc-350">
              <button className="flex items-center gap-3 px-3 py-2.5 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 rounded-lg cursor-pointer text-left w-full">
                <FileText className="w-4.5 h-4.5" />
                <span>Docs</span>
              </button>
              <button className="flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-850 rounded-lg cursor-not-allowed opacity-60 text-left w-full">
                <LayoutGrid className="w-4.5 h-4.5 text-green-500" />
                <span>Sheets</span>
              </button>
              <button className="flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-850 rounded-lg cursor-not-allowed opacity-60 text-left w-full">
                <LayoutGrid className="w-4.5 h-4.5 text-amber-500" />
                <span>Slides</span>
              </button>
              
              <div className="border-t border-zinc-150 dark:border-zinc-800 my-2"></div>
              
              <button className="flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-850 rounded-lg cursor-pointer text-left w-full">
                <Settings className="w-4.5 h-4.5 text-zinc-400" />
                <span>General Settings</span>
              </button>
              <button className="flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-850 rounded-lg cursor-pointer text-left w-full">
                <HelpCircle className="w-4.5 h-4.5 text-zinc-400" />
                <span>Help & Help Docs</span>
              </button>
            </div>
            <div className="text-[10px] text-zinc-400 dark:text-zinc-550 border-t border-zinc-150 dark:border-zinc-800 pt-3">
              Version 1.0.0 (WordPI Docs)
            </div>
          </aside>
        </>
      )}

      {/* Main Dashboard Layout Content (Scrollable Container) */}
      <div className="flex-1 overflow-y-auto">
        
        {/* Template Gallery Band */}
        <section className="bg-[#F1F3F4] dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-850 pb-8 pt-5">
          <div className="max-w-[1000px] mx-auto px-6 space-y-4">
            {/* Template Gallery Header */}
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-zinc-800 dark:text-zinc-200 text-sm">Start a new document</span>
              <div className="flex items-center gap-3 font-semibold text-zinc-550 dark:text-zinc-400">
                <button className="flex items-center gap-1 hover:bg-zinc-200/50 dark:hover:bg-zinc-850 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer">
                  <span>Template gallery</span>
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                <div className="w-px h-4 bg-zinc-300 dark:bg-zinc-850"></div>
                <button className="p-1.5 hover:bg-zinc-200/50 dark:hover:bg-zinc-850 rounded-full transition-colors cursor-pointer">
                  <MoreVertical className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Template Gallery Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-4">
              
              {/* Blank document Card */}
              <div className="flex flex-col gap-1.5">
                <button 
                  onClick={onCreateProject}
                  className="aspect-[1/1.4] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-blue-500 dark:hover:border-blue-700 rounded-xs cursor-pointer transition-all p-1 flex items-center justify-center shadow-sm hover:shadow-md relative group"
                >
                  <svg viewBox="0 0 36 36" className="w-10 h-10 select-none">
                    <path fill="#34A853" d="M16 16v14h4V16z"/>
                    <path fill="#4285F4" d="M30 16H16v4h14z"/>
                    <path fill="#FBBC05" d="M6 16h10v4H6z"/>
                    <path fill="#EA4335" d="M16 6h4v10h-4z"/>
                  </svg>
                </button>
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-200 truncate">Blank document</span>
              </div>

              {/* Brochure geometric Card */}
              <div className="flex flex-col gap-1.5">
                <button 
                  onClick={() => onCreateProjectWithTemplate('Custom')}
                  className="aspect-[1/1.4] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-blue-500 dark:hover:border-blue-700 rounded-xs cursor-pointer transition-all p-1.5 flex flex-col shadow-sm hover:shadow-md group"
                >
                  <div className="w-full h-full bg-white dark:bg-zinc-900/50 p-2 flex flex-col gap-1 border border-zinc-100 dark:border-zinc-800/80 overflow-hidden">
                    <div className="h-4 bg-pink-500 rounded-xs w-full flex items-center justify-between p-1 flex-shrink-0">
                      <div className="w-2.5 h-1 bg-white/40 rounded-xs"></div>
                    </div>
                    <div className="flex gap-1.5 flex-1 mt-1 overflow-hidden">
                      <div className="w-1/3 bg-zinc-105 dark:bg-zinc-800 rounded-xs h-full p-1 flex flex-col gap-1 flex-shrink-0">
                        <div className="h-1 bg-pink-300 w-full rounded-xs"></div>
                        <div className="h-0.5 bg-zinc-200 dark:bg-zinc-700 w-3/4 rounded-xs"></div>
                      </div>
                      <div className="w-2/3 flex flex-col gap-1.5">
                        <div className="h-1.5 bg-zinc-300 dark:bg-zinc-700 w-full rounded-xs"></div>
                        <div className="h-1 bg-zinc-100 dark:bg-zinc-850 w-11/12 rounded-xs"></div>
                        <div className="h-1 bg-zinc-100 dark:bg-zinc-855 w-5/6 rounded-xs"></div>
                      </div>
                    </div>
                  </div>
                </button>
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-200 truncate">Brochure</span>
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-[-4px]">Geometric</span>
              </div>
              {/* Research Proposal Card */}
              <div className="flex flex-col gap-1.5">
                <button 
                  onClick={() => onCreateProjectWithTemplate('Proposal')}
                  className="aspect-[1/1.4] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-blue-500 dark:hover:border-blue-700 rounded-xs cursor-pointer transition-all p-1.5 flex flex-col shadow-sm hover:shadow-md group"
                >
                  <div className="w-full h-full bg-white dark:bg-zinc-900/50 p-2 flex flex-col gap-1.5 border border-zinc-100 dark:border-zinc-800/80 overflow-hidden">
                    <div className="h-3 bg-indigo-650 rounded-xs w-full flex items-center justify-between p-1 flex-shrink-0">
                      <div className="w-4 h-1 bg-white/40 rounded-xs"></div>
                    </div>
                    <div className="space-y-1.5 mt-2">
                      <div className="h-1.5 bg-zinc-700 dark:bg-zinc-300 w-2/3 rounded-xs"></div>
                      <div className="h-1 bg-zinc-350 dark:bg-zinc-650 w-full rounded-xs"></div>
                      <div className="h-1 bg-zinc-200 dark:bg-zinc-750 w-11/12 rounded-xs"></div>
                      <div className="h-1 bg-zinc-200 dark:bg-zinc-755 w-5/6 rounded-xs"></div>
                    </div>
                  </div>
                </button>
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-200 truncate">Research Proposal</span>
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-[-4px]">Proposal</span>
              </div>

              {/* Graduation Thesis Card */}
              <div className="flex flex-col gap-1.5">
                <button 
                  onClick={() => onCreateProjectWithTemplate('Project')}
                  className="aspect-[1/1.4] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-blue-500 dark:hover:border-blue-700 rounded-xs cursor-pointer transition-all p-1.5 flex flex-col shadow-sm hover:shadow-md group"
                >
                  <div className="w-full h-full bg-white dark:bg-zinc-900/50 p-2 flex flex-col gap-1.5 border border-zinc-100 dark:border-zinc-800/80 overflow-hidden">
                    <div className="flex flex-col items-center gap-1 border-b border-zinc-200 dark:border-zinc-700 pb-1 flex-shrink-0">
                      <div className="h-1.5 bg-zinc-850 dark:bg-zinc-100 w-2/3 rounded-xs"></div>
                      <div className="h-0.5 bg-zinc-400 dark:bg-zinc-500 w-1/2 rounded-xs"></div>
                    </div>
                    <div className="flex gap-2 flex-1 mt-1 overflow-hidden">
                      <div className="w-full flex flex-col gap-1">
                        <div className="h-1 bg-zinc-500 w-1/3 rounded-xs"></div>
                        <div className="h-1 bg-zinc-200 dark:bg-zinc-750 w-full rounded-xs"></div>
                        <div className="h-1 bg-zinc-100 dark:bg-zinc-850 w-full rounded-xs"></div>
                        <div className="h-1 bg-zinc-100 dark:bg-zinc-855 w-5/6 rounded-xs"></div>
                      </div>
                    </div>
                  </div>
                </button>
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-200 truncate">Graduation Thesis</span>
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-[-4px]">Project</span>
              </div>

              {/* Seminar Report Card */}
              <div className="flex flex-col gap-1.5">
                <button 
                  onClick={() => onCreateProjectWithTemplate('Seminar')}
                  className="aspect-[1/1.4] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-blue-500 dark:hover:border-blue-700 rounded-xs cursor-pointer transition-all p-1.5 flex flex-col shadow-sm hover:shadow-md group"
                >
                  <div className="w-full h-full bg-white dark:bg-zinc-900/50 p-2 flex flex-col gap-1.5 border border-zinc-100 dark:border-zinc-800/80 overflow-hidden">
                    <div className="flex flex-col items-center gap-1 mt-3 flex-shrink-0">
                      <div className="h-1.5 bg-zinc-800 dark:bg-zinc-100 w-1/2 rounded-xs"></div>
                      <div className="h-1 bg-zinc-400 dark:bg-zinc-500 w-1/3 rounded-xs"></div>
                    </div>
                    <div className="space-y-1.5 mt-4">
                      <div className="h-1 bg-zinc-200 dark:bg-zinc-750 w-full rounded-xs"></div>
                      <div className="h-1 bg-zinc-200 dark:bg-zinc-750 w-full rounded-xs"></div>
                      <div className="h-1 bg-zinc-200 dark:bg-zinc-755 w-4/5 rounded-xs"></div>
                    </div>
                  </div>
                </button>
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-200 truncate">Seminar Report</span>
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-[-4px]">Seminar</span>
              </div>

              {/* Project proposal tropic Card */}
              <div className="flex flex-col gap-1.5">
                <button 
                  onClick={() => onCreateProjectWithTemplate('Proposal')}
                  className="aspect-[1/1.4] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-blue-500 dark:hover:border-blue-700 rounded-xs cursor-pointer transition-all p-1.5 flex flex-col shadow-sm hover:shadow-md group"
                >
                  <div className="w-full h-full bg-white dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800/80 relative overflow-hidden flex flex-col justify-end p-2">
                    <div className="absolute top-0 right-0 left-0 h-10 bg-indigo-950 flex overflow-hidden flex-shrink-0">
                      <div className="w-1/2 bg-teal-500 transform -skew-x-20 origin-top"></div>
                      <div className="w-1/2 bg-orange-500 transform -skew-x-20 origin-top"></div>
                    </div>
                    <div className="space-y-1.5 z-10">
                      <div className="h-1.5 bg-zinc-800 dark:bg-zinc-200 w-2/3 rounded-xs"></div>
                      <div className="h-1 bg-zinc-400 dark:bg-zinc-500 w-1/2 rounded-xs"></div>
                    </div>
                  </div>
                </button>
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-200 truncate">Project proposal</span>
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-[-4px]">Tropic</span>
              </div>

              {/* Report luxe Card */}
              <div className="flex flex-col gap-1.5">
                <button 
                  onClick={() => onCreateProjectWithTemplate('Project')}
                  className="aspect-[1/1.4] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-blue-500 dark:hover:border-blue-700 rounded-xs cursor-pointer transition-all p-1.5 flex flex-col shadow-sm hover:shadow-md group"
                >
                  <div className="w-full h-full bg-white dark:bg-zinc-900/50 p-2 flex flex-col gap-1.5 border border-zinc-100 dark:border-zinc-800/80 overflow-hidden">
                    <div className="h-8 bg-zinc-200 dark:bg-zinc-700 rounded-xs w-full relative overflow-hidden flex items-center justify-center flex-shrink-0">
                      <div className="w-full h-full bg-zinc-300 dark:bg-zinc-655 opacity-40"></div>
                      <div className="absolute w-2.5 h-2.5 rounded-full bg-white"></div>
                    </div>
                    <div className="space-y-1.5 mt-1.5">
                      <div className="h-1.5 bg-yellow-600 dark:bg-yellow-500 w-1/3 rounded-xs"></div>
                      <div className="h-1 bg-zinc-100 dark:bg-zinc-850 w-full rounded-xs"></div>
                      <div className="h-1 bg-zinc-100 dark:bg-zinc-855 w-11/12 rounded-xs"></div>
                    </div>
                  </div>
                </button>
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-200 truncate">Report</span>
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-[-4px]">Luxe</span>
              </div>

            </div>

          </div>
        </section>

        {/* Recent Documents Section */}
        <main className="max-w-[1000px] mx-auto px-6 py-8 space-y-5 flex-1">
          
          {/* Recent Documents Header & Controls */}
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Recent documents</h2>
            
            <div className="flex items-center gap-4 text-xs font-semibold text-zinc-550 dark:text-zinc-400">
              
              {/* Owned by Dropdown */}
              <div className="relative">
                <button 
                  onClick={() => setActiveMenuProjectId(activeMenuProjectId === 'owner' ? null : 'owner')}
                  className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-zinc-200/50 dark:hover:bg-zinc-850 rounded-lg cursor-pointer"
                >
                  <span>
                    {ownerFilter === 'anyone' ? 'Owned by anyone' : ownerFilter === 'me' ? 'Owned by me' : 'Not owned by me'}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                {activeMenuProjectId === 'owner' && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setActiveMenuProjectId(null)}></div>
                    <div className="absolute right-0 mt-1 w-44 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-850 rounded-xl shadow-lg z-30 py-1.5 animate-in fade-in duration-100">
                      <button 
                        onClick={() => { setOwnerFilter('anyone'); setActiveMenuProjectId(null) }}
                        className="w-full text-left px-4 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-850 text-xs font-semibold text-zinc-700 dark:text-zinc-300"
                      >
                        Owned by anyone
                      </button>
                      <button 
                        onClick={() => { setOwnerFilter('me'); setActiveMenuProjectId(null) }}
                        className="w-full text-left px-4 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-850 text-xs font-semibold text-zinc-700 dark:text-zinc-300"
                      >
                        Owned by me
                      </button>
                      <button 
                        onClick={() => { setOwnerFilter('notme'); setActiveMenuProjectId(null) }}
                        className="w-full text-left px-4 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-850 text-xs font-semibold text-zinc-700 dark:text-zinc-300"
                      >
                        Not owned by me
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* View mode toggle */}
              <div className="flex items-center bg-zinc-200/60 dark:bg-zinc-900 p-0.5 rounded-lg border border-zinc-250/30 dark:border-zinc-850">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded-md transition-colors cursor-pointer ${viewMode === 'grid' ? 'bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-xs' : 'text-zinc-400 hover:text-zinc-550'}`}
                  title="Grid View"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-1.5 rounded-md transition-colors cursor-pointer ${viewMode === 'list' ? 'bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-xs' : 'text-zinc-400 hover:text-zinc-550'}`}
                  title="List View"
                >
                  <ListIcon className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Sorting Filter */}
              <div className="relative">
                <button
                  onClick={() => setActiveMenuProjectId(activeMenuProjectId === 'sort' ? null : 'sort')}
                  className="p-2 hover:bg-zinc-200/50 dark:hover:bg-zinc-850 rounded-full transition-colors cursor-pointer"
                  title="Sorting"
                >
                  <span className="font-mono text-xs select-none">A-Z</span>
                </button>
                {activeMenuProjectId === 'sort' && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setActiveMenuProjectId(null)}></div>
                    <div className="absolute right-0 mt-1 w-44 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-850 rounded-xl shadow-lg z-30 py-1.5 animate-in fade-in duration-100">
                      <button 
                        onClick={() => { setSortBy('updated'); setActiveMenuProjectId(null) }}
                        className="w-full text-left px-4 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-850 text-xs font-semibold text-zinc-700 dark:text-zinc-300"
                      >
                        Last Modified
                      </button>
                      <button 
                        onClick={() => { setSortBy('title'); setActiveMenuProjectId(null) }}
                        className="w-full text-left px-4 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-850 text-xs font-semibold text-zinc-700 dark:text-zinc-300"
                      >
                        Title A-Z
                      </button>
                      <button 
                        onClick={() => { setSortBy('words'); setActiveMenuProjectId(null) }}
                        className="w-full text-left px-4 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-850 text-xs font-semibold text-zinc-700 dark:text-zinc-300"
                      >
                        Word Count
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Folder Selector */}
              <button 
                onClick={onCreateProject}
                className="p-2 hover:bg-zinc-200/50 dark:hover:bg-zinc-850 rounded-full transition-colors cursor-pointer"
                title="Open file picker"
              >
                <Folder className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Document Content List */}
          {filteredProjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 px-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-850 rounded-2xl text-center space-y-4 shadow-xs animate-in fade-in duration-200">
              <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-950/40 rounded-full flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                <Folder className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-zinc-900 dark:text-zinc-50 text-sm">No documents found</h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-450 max-w-xs leading-relaxed">
                  {searchQuery ? "No writings match your current filters." : "Create your first document using the templates above."}
                </p>
              </div>
            </div>
          ) : viewMode === 'grid' ? (
            /* Document Grid View: 5 column layout matching Google Docs screenshot */
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-6 animate-in fade-in duration-250">
              {filteredProjects.map((project) => (
                <div
                  key={project.id}
                  onClick={() => onLoadProject(project.id)}
                  className="group flex flex-col bg-white dark:bg-zinc-900 border border-zinc-250 dark:border-zinc-800 rounded-md overflow-hidden hover:border-blue-500 dark:hover:border-blue-700 cursor-pointer shadow-xs hover:shadow-md transition-all relative"
                >
                  {/* Miniature scaled-down document page preview */}
                  <div className="aspect-[3/3.8] bg-[#F8F9FA] dark:bg-zinc-900/60 border-b border-zinc-150 dark:border-zinc-800/80 overflow-hidden relative flex flex-col justify-start">
                    <MiniDocumentPreview contentStr={project.content} title={project.title} />
                  </div>

                  {/* Document Card Footer */}
                  <div className="p-3 bg-white dark:bg-zinc-900 flex items-center justify-between relative z-10 flex-shrink-0 h-14">
                    <div className="flex items-start gap-2 overflow-hidden flex-1">
                      {/* Document Type icon (represent google docs blue file) */}
                      <div className="bg-blue-500 p-1.5 rounded-sm text-white flex-shrink-0 mt-0.5">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                          <line x1="10" y1="9" x2="8" y2="9" />
                        </svg>
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400">
                          {project.title}
                        </span>
                        <span className="text-[10px] text-zinc-450 dark:text-zinc-500 mt-0.5">
                          {formatDate(project.updatedAt)}
                        </span>
                      </div>
                    </div>

                    {/* Options three-dot */}
                    <div className="relative" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setActiveMenuProjectId(activeMenuProjectId === project.id ? null : project.id)}
                        className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full cursor-pointer transition-colors"
                      >
                        <MoreVertical className="w-4.5 h-4.5" />
                      </button>

                      {activeMenuProjectId === project.id && (
                        <>
                          <div className="fixed inset-0 z-25" onClick={() => setActiveMenuProjectId(null)}></div>
                          <div className="absolute right-0 mt-1 w-36 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-850 rounded-xl shadow-xl z-30 py-1.5 animate-in fade-in duration-100">
                            <button
                              onClick={() => { onRenameProject(project.id); setActiveMenuProjectId(null) }}
                              className="w-full text-left px-4 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-850 text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-2"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>Rename</span>
                            </button>
                            <button
                              onClick={() => { onDeleteProject(project.id); setActiveMenuProjectId(null) }}
                              className="w-full text-left px-4 py-2 hover:bg-red-50 dark:hover:bg-red-950/20 text-xs font-semibold text-red-650 dark:text-red-400 flex items-center gap-2"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Delete</span>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Document List View */
            <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-xl overflow-hidden shadow-xs animate-in fade-in duration-200">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/60 text-zinc-400 font-bold uppercase tracking-wider text-[10px]">
                    <th className="p-4 pl-6">Title</th>
                    <th className="p-4">Type</th>
                    <th className="p-4">Owner</th>
                    <th className="p-4">Modified</th>
                    <th className="p-4 pr-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-150 dark:divide-zinc-850">
                  {filteredProjects.map((project) => (
                    <tr 
                      key={project.id}
                      onClick={() => onLoadProject(project.id)}
                      className="hover:bg-zinc-50 dark:hover:bg-zinc-900/30 transition-colors group cursor-pointer"
                    >
                      <td className="p-4 pl-6 font-bold text-zinc-800 dark:text-zinc-200 max-w-xs truncate group-hover:text-blue-600 dark:group-hover:text-blue-400">
                        <div className="flex items-center gap-2.5">
                          <div className="bg-blue-500 p-1 rounded-sm text-white flex-shrink-0">
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                              <polyline points="14 2 14 8 20 8" />
                            </svg>
                          </div>
                          <span>{project.title}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                          project.documentType === 'Seminar' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border border-emerald-250/20' :
                          project.documentType === 'Proposal' ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border border-amber-250/20' :
                          project.documentType === 'Project' ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400 border border-indigo-250/20' :
                          'bg-zinc-100 text-zinc-700 dark:bg-zinc-850 dark:text-zinc-300'
                        }`}>
                          {project.documentType}
                        </span>
                      </td>
                      <td className="p-4 text-zinc-500 dark:text-zinc-400 font-medium">
                        me
                      </td>
                      <td className="p-4 text-zinc-500 dark:text-zinc-400 font-medium">
                        {formatDate(project.updatedAt)}
                      </td>
                      <td className="p-4 pr-6 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => onRenameProject(project.id)}
                            className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
                            title="Rename writing"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => onDeleteProject(project.id)}
                            className="p-1.5 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg text-zinc-400 hover:text-red-650 dark:hover:text-red-400 cursor-pointer"
                            title="Delete writing"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>

      {/* Upgrade Plan Modal */}
      {showUpgradeModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-250 dark:border-zinc-800 rounded-2xl p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl relative space-y-6 animate-in scale-in duration-200">
            {/* Close Button */}
            <button
              onClick={() => setShowUpgradeModal(false)}
              className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-755 text-xl font-bold cursor-pointer"
            >
              ×
            </button>
            
            <div className="text-center space-y-2">
              <span className="bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 text-[10px] uppercase font-bold tracking-widest px-2.5 py-1 rounded-full">
                WordPI Premium
              </span>
              <h3 className="text-xl sm:text-2xl font-extrabold text-zinc-900 dark:text-zinc-50">
                Supercharge Your Academic Document Intelligence
              </h3>
              <p className="text-xs text-zinc-500 max-w-lg mx-auto leading-relaxed">
                Unlock advanced formatting rules, bibliography automated citation engines, and faster AI processing limit cycles.
              </p>
            </div>

            {/* Pricing Tiers Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
              {/* Free Tier */}
              <div className="border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 flex flex-col justify-between space-y-5 bg-zinc-50/50 dark:bg-zinc-900/30">
                <div className="space-y-3">
                  <h4 className="font-bold text-zinc-900 dark:text-zinc-50 text-sm">WordPI Free</h4>
                  <div className="flex items-baseline text-zinc-900 dark:text-zinc-50">
                    <span className="text-2xl font-extrabold">$0</span>
                    <span className="text-xs text-zinc-500 ml-1">/ month</span>
                  </div>
                  <ul className="text-[11px] text-zinc-500 dark:text-zinc-400 space-y-2 pt-2">
                    <li className="flex items-center gap-1.5">✓ 15 API calls / min</li>
                    <li className="flex items-center gap-1.5">✓ Zero-server browser storage</li>
                    <li className="flex items-center gap-1.5">✓ Basic paper outlines</li>
                  </ul>
                </div>
                <button className="w-full py-2 bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold rounded-xl text-xs cursor-default">
                  Active Plan
                </button>
              </div>

              {/* Pro Tier (Popular) */}
              <div className="border-2 border-blue-500 dark:border-blue-600 rounded-2xl p-5 flex flex-col justify-between space-y-5 bg-blue-50/10 dark:bg-blue-950/10 relative shadow-sm">
                <span className="absolute top-0 right-1/2 translate-x-1/2 -translate-y-1/2 bg-blue-500 text-white text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full">
                  Popular
                </span>
                <div className="space-y-3">
                  <h4 className="font-bold text-zinc-900 dark:text-zinc-50 text-sm">Researcher Pro</h4>
                  <div className="flex items-baseline text-zinc-900 dark:text-zinc-50">
                    <span className="text-2xl font-extrabold">$8</span>
                    <span className="text-xs text-zinc-500 ml-1">/ month</span>
                  </div>
                  <ul className="text-[11px] text-zinc-500 dark:text-zinc-400 space-y-2 pt-2">
                    <li className="flex items-center gap-1.5">✓ Priority high-speed API keys</li>
                    <li className="flex items-center gap-1.5">✓ Bibliography automated citation</li>
                    <li className="flex items-center gap-1.5">✓ Styled PDF custom formats</li>
                    <li className="flex items-center gap-1.5">✓ Unlimited reference documents</li>
                  </ul>
                </div>
                <button 
                  onClick={() => alert("Subscription gateway coming soon! Thank you for your interest.")}
                  className="w-full py-2 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-xl text-xs cursor-pointer shadow-sm"
                >
                  Upgrade to Pro
                </button>
              </div>

              {/* Institution Tier */}
              <div className="border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 flex flex-col justify-between space-y-5 bg-zinc-50/50 dark:bg-zinc-900/30">
                <div className="space-y-3">
                  <h4 className="font-bold text-zinc-900 dark:text-zinc-50 text-sm">Academic Lab</h4>
                  <div className="flex items-baseline text-zinc-900 dark:text-zinc-50">
                    <span className="text-2xl font-extrabold">$19</span>
                    <span className="text-xs text-zinc-500 ml-1">/ user / mo</span>
                  </div>
                  <ul className="text-[11px] text-zinc-500 dark:text-zinc-400 space-y-2 pt-2">
                    <li className="flex items-center gap-1.5">✓ Shared workspace & projects</li>
                    <li className="flex items-center gap-1.5">✓ University stylesheet matching</li>
                    <li className="flex items-center gap-1.5">✓ SSO & audit history controls</li>
                  </ul>
                </div>
                <button 
                  onClick={() => alert("Please contact our sales team at sales@wordpi.edu")}
                  className="w-full py-2 bg-zinc-850 hover:bg-zinc-800 text-white font-bold rounded-xl text-xs cursor-pointer"
                >
                  Contact Us
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
