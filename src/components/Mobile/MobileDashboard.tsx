"use client"

import React, { useState } from 'react'
import {
  Plus,
  Search,
  Folder,
  Moon,
  Sun,
  MoreVertical,
  LogOut,
  Settings,
  HelpCircle,
  Trash2,
  Edit3,
  User,
  Sparkles,
  FileText,
  Clock
} from 'lucide-react'
import { Project } from '../Dashboard/Dashboard'

interface MobileDashboardProps {
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

export default function MobileDashboard({
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
}: MobileDashboardProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeMenuProjectId, setActiveMenuProjectId] = useState<string | null>(null)
  const [showProfileDropdown, setShowProfileDropdown] = useState(false)

  // Format date helper
  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp)
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }

  // Filter projects based on search query
  const filteredProjects = projects.filter(p =>
    p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.documentType.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="flex flex-col flex-1 h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200 overflow-hidden relative font-sans select-none safe-area-top safe-area-bottom">
      
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0 z-20">
        <div className="flex items-center gap-2">
          <img src="/WordPI.png" alt="WordPiLot Logo" className="w-6.5 h-6.5 object-contain rounded-md" />
          <span className="font-bold text-base tracking-tight">
            <span className="text-zinc-900 dark:text-zinc-100">Word</span>
            <span className="text-[#185ABD] dark:text-[#3B82F6]">Pi</span>
            <span className="text-[#B68A35] text-[8px] align-super ml-0.5 font-bold uppercase">lot</span>
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Theme switcher */}
          <button
            onClick={toggleTheme}
            className="p-2 text-zinc-500 hover:text-indigo-650 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-indigo-400 dark:hover:bg-zinc-800 rounded-lg transition-all"
          >
            {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4.5 h-4.5" />}
          </button>

          {/* User profile / Auth button */}
          <div className="relative">
            <button
              onClick={() => setShowProfileDropdown(!showProfileDropdown)}
              className="w-7 h-7 rounded-full bg-indigo-650 text-white font-bold flex items-center justify-center text-xs shadow-inner uppercase"
            >
              {userEmail ? userEmail.charAt(0) : 'G'}
            </button>

            {showProfileDropdown && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setShowProfileDropdown(false)}></div>
                <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xl p-4 z-30 flex flex-col items-center text-center animate-in fade-in duration-100">
                  <div className="w-11 h-11 rounded-full bg-indigo-650 text-white font-bold flex items-center justify-center text-lg shadow-md mb-2 uppercase">
                    {userEmail ? userEmail.charAt(0) : 'G'}
                  </div>
                  {userEmail ? (
                    <>
                      <h4 className="font-bold text-zinc-900 dark:text-zinc-50 text-xs truncate max-w-full">Active User</h4>
                      <p className="text-[10px] text-zinc-450 dark:text-zinc-500 truncate max-w-full px-2">{userEmail}</p>
                    </>
                  ) : (
                    <>
                      <h4 className="font-bold text-zinc-900 dark:text-zinc-50 text-xs">Guest Mode</h4>
                      <p className="text-[10px] text-zinc-450 dark:text-zinc-500">Offline changes only</p>
                      
                      <button 
                        onClick={() => { onOpenAuth(); setShowProfileDropdown(false) }}
                        className="mt-2.5 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-750 text-white rounded-full text-[10px] font-bold cursor-pointer w-full transition-all shadow-md shadow-indigo-500/10"
                      >
                        Sign In / Sign Up
                      </button>
                    </>
                  )}
                  
                  <div className="w-full border-t border-zinc-150 dark:border-zinc-800 my-2.5"></div>
                  
                  <div className="w-full flex flex-col gap-0.5 text-left text-xs text-zinc-600 dark:text-zinc-350">
                    <button className="flex items-center gap-2 p-2 hover:bg-zinc-50 dark:hover:bg-zinc-850 rounded-lg">
                      <Settings className="w-3.5 h-3.5" />
                      <span>Settings</span>
                    </button>
                    <button className="flex items-center gap-2 p-2 hover:bg-zinc-50 dark:hover:bg-zinc-850 rounded-lg">
                      <HelpCircle className="w-3.5 h-3.5" />
                      <span>Help & Feedback</span>
                    </button>
                    {userEmail && (
                      <button 
                        onClick={() => { onSignOut(); setShowProfileDropdown(false) }}
                        className="flex items-center gap-2 p-2 hover:bg-red-50 dark:hover:bg-red-950/20 text-red-650 dark:text-red-400 rounded-lg text-left"
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

      {/* Main container */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 pb-20">
        
        {/* Search */}
        <div className="relative flex items-center">
          <Search className="w-4 h-4 absolute left-3 text-zinc-400 dark:text-zinc-550" />
          <input
            type="text"
            placeholder="Search documents"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 pl-9 pr-8 py-2 rounded-xl text-xs outline-none text-zinc-700 dark:text-zinc-300 focus:border-indigo-500 dark:focus:border-indigo-500 transition-colors shadow-xs"
          />
        </div>

        {/* Quick Suggestion templates */}
        <div>
          <h3 className="text-[10px] font-bold text-zinc-450 dark:text-zinc-500 uppercase tracking-wider mb-2">
            Start a new document
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onCreateProjectWithTemplate('Seminar')}
              className="flex items-center gap-2 p-2.5 bg-white dark:bg-zinc-900 border border-zinc-250/60 dark:border-zinc-800/80 rounded-xl hover:border-indigo-500 text-left active:scale-[0.98] transition-all shadow-xs"
            >
              <span className="w-6 h-6 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center text-emerald-600">📝</span>
              <div className="min-w-0">
                <p className="text-xs font-bold truncate">Seminar Report</p>
                <p className="text-[8px] text-zinc-450">Template</p>
              </div>
            </button>
            <button
              onClick={() => onCreateProjectWithTemplate('Proposal')}
              className="flex items-center gap-2 p-2.5 bg-white dark:bg-zinc-900 border border-zinc-250/60 dark:border-zinc-800/80 rounded-xl hover:border-indigo-500 text-left active:scale-[0.98] transition-all shadow-xs"
            >
              <span className="w-6 h-6 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 flex items-center justify-center text-indigo-650">📋</span>
              <div className="min-w-0">
                <p className="text-xs font-bold truncate">Proposal Blueprint</p>
                <p className="text-[8px] text-zinc-450">Template</p>
              </div>
            </button>
          </div>
        </div>

        {/* Document list */}
        <div>
          <h3 className="text-[10px] font-bold text-zinc-450 dark:text-zinc-500 uppercase tracking-wider mb-2.5">
            Recent documents
          </h3>

          {filteredProjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl text-center space-y-2 shadow-xs">
              <Folder className="w-8 h-8 text-zinc-300 dark:text-zinc-700" />
              <div>
                <p className="text-xs font-bold">No documents found</p>
                <p className="text-[10px] text-zinc-400 mt-0.5">
                  {searchQuery ? "No matches for your search." : "Tap the + button to create a document."}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredProjects.map((project) => (
                <div
                  key={project.id}
                  onClick={() => onLoadProject(project.id)}
                  className="flex items-center justify-between p-3 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-xl active:bg-zinc-50 dark:active:bg-zinc-850 transition-all shadow-xs"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-xs font-bold truncate text-zinc-900 dark:text-zinc-100">
                        {project.title}
                      </h4>
                      <div className="flex items-center gap-1.5 text-[9px] text-zinc-450 dark:text-zinc-500 mt-0.5">
                        <span className="bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-650 dark:text-zinc-450 font-semibold uppercase">
                          {project.documentType}
                        </span>
                        <span className="w-0.5 h-0.5 bg-zinc-300 dark:bg-zinc-600 rounded-full" />
                        <span>{formatDate(project.updatedAt)}</span>
                        <span className="w-0.5 h-0.5 bg-zinc-300 dark:bg-zinc-600 rounded-full" />
                        <span>{project.wordCount || 0} words</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions dropdown trigger */}
                  <div className="relative" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setActiveMenuProjectId(activeMenuProjectId === project.id ? null : project.id)}
                      className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg active:bg-zinc-100 dark:active:bg-zinc-800 transition-colors"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>

                    {activeMenuProjectId === project.id && (
                      <>
                        <div className="fixed inset-0 z-20" onClick={() => setActiveMenuProjectId(null)}></div>
                        <div className="absolute right-0 mt-1 w-32 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl z-30 py-1 animate-in fade-in duration-100">
                          <button
                            onClick={() => { onRenameProject(project.id); setActiveMenuProjectId(null) }}
                            className="w-full text-left px-3.5 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-850 text-[11px] font-semibold flex items-center gap-1.5"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Rename</span>
                          </button>
                          <button
                            onClick={() => { onDeleteProject(project.id); setActiveMenuProjectId(null) }}
                            className="w-full text-left px-3.5 py-2 hover:bg-red-55 dark:hover:bg-red-950/20 text-[11px] font-semibold text-red-600 flex items-center gap-1.5"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Floating Action Button (FAB) */}
      <button
        onClick={onCreateProject}
        className="fixed bottom-5 right-5 w-12 h-12 bg-indigo-650 hover:bg-indigo-700 text-white rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-all z-30 cursor-pointer"
        title="Create new document"
      >
        <Plus className="w-6 h-6" />
      </button>

    </div>
  )
}
