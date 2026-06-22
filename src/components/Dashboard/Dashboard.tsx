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
  Sun
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
}

export default function Dashboard({
  theme,
  toggleTheme,
  projects,
  onCreateProject,
  onCreateProjectWithTemplate,
  onDeleteProject,
  onRenameProject,
  onLoadProject
}: DashboardProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<'updated' | 'title' | 'words'>('updated')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')

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

  return (
    <div className="flex flex-col flex-1 h-screen overflow-y-auto bg-zinc-50 dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200 font-sans focus:outline-none" style={{ scrollbarGutter: 'stable' }}>
      {/* Dashboard Header */}
      <header className="flex items-center justify-between px-8 py-4 border-b bg-white border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 sticky top-0 z-10 shadow-sm flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <img src="/WordPI.png" alt="WordPI Logo" className="w-7 h-7 object-contain rounded-lg shadow-sm" />
            <span className="font-bold text-lg text-zinc-900 dark:text-zinc-50 tracking-tight">WordPI</span>
          </div>
          <span className="text-zinc-400 dark:text-zinc-600 font-bold font-mono text-[10px] tracking-wider uppercase">
            Document Center
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={toggleTheme}
            className="p-2 text-zinc-500 hover:text-indigo-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-indigo-400 dark:hover:bg-zinc-800 rounded-xl transition-all cursor-pointer"
            title="Toggle color theme"
          >
            {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
          <button
            onClick={onCreateProject}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-650 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-md active:scale-97 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New Writing</span>
          </button>
        </div>
      </header>

      {/* Dashboard Body */}
      <main className="max-w-[1200px] w-full mx-auto px-8 py-10 space-y-10 flex-1">
        
        {/* Welcome / Template Section */}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-indigo-600 via-indigo-700 to-indigo-850 p-8 text-white shadow-lg">
          <div className="absolute right-0 top-0 translate-x-12 -translate-y-12 w-80 h-80 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none"></div>
          <div className="absolute left-1/3 bottom-0 translate-y-12 w-64 h-64 bg-emerald-500/15 rounded-full blur-3xl pointer-events-none"></div>
          
          <div className="relative z-10 max-w-2xl space-y-5">
            <div className="space-y-2">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Your Academic Writing Companion</h1>
              <p className="text-indigo-100 text-xs sm:text-sm leading-relaxed max-w-xl">
                Create structured Seminar papers, Research Proposals, and graduation Projects. Ingest references for real-time AI assistance, and compile standard-compliant document structures instantly.
              </p>
            </div>
            <div className="pt-2 flex flex-wrap gap-2.5">
              <button
                onClick={() => onCreateProjectWithTemplate('Seminar')}
                className="px-3.5 py-2 bg-white/10 hover:bg-white/20 active:bg-white/15 border border-white/20 rounded-xl text-xs font-bold backdrop-blur-xs transition-colors cursor-pointer"
              >
                APA Seminar Outline
              </button>
              <button
                onClick={() => onCreateProjectWithTemplate('Proposal')}
                className="px-3.5 py-2 bg-white/10 hover:bg-white/20 active:bg-white/15 border border-white/20 rounded-xl text-xs font-bold backdrop-blur-xs transition-colors cursor-pointer"
              >
                Research Proposal Outline
              </button>
              <button
                onClick={() => onCreateProjectWithTemplate('Project')}
                className="px-3.5 py-2 bg-white/10 hover:bg-white/20 active:bg-white/15 border border-white/20 rounded-xl text-xs font-bold backdrop-blur-xs transition-colors cursor-pointer"
              >
                Graduation Thesis Template
              </button>
            </div>
          </div>
        </section>

        {/* Document List Header & Toolbar */}
        <section className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800/80 pb-4">
            <div>
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50">Recent Documents</h2>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-450 mt-0.5">Pick up where you left off or edit your writings.</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Search Bar */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" />
                <input
                  type="text"
                  placeholder="Search title or document type..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-8 py-1.5 w-56 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-xl text-xs outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-zinc-700 dark:text-zinc-300 transition-all font-medium"
                />
                {searchQuery && (
                  <button 
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-650 text-sm font-bold animate-in fade-in"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Sorting dropdown */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="text-xs border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-1.5 rounded-xl text-zinc-700 dark:text-zinc-300 outline-none cursor-pointer focus:ring-1 focus:ring-indigo-500 font-semibold"
              >
                <option value="updated">Sort by: Modified</option>
                <option value="title">Sort by: Title</option>
                <option value="words">Sort by: Words</option>
              </select>

              {/* Grid/List View Toggles */}
              <div className="flex items-center bg-zinc-100 dark:bg-zinc-900 p-0.5 rounded-xl border border-zinc-200 dark:border-zinc-800">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${viewMode === 'grid' ? 'bg-white dark:bg-zinc-800 text-indigo-650 dark:text-indigo-400 shadow-xs' : 'text-zinc-400 hover:text-zinc-655'}`}
                  title="Grid View"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${viewMode === 'list' ? 'bg-white dark:bg-zinc-800 text-indigo-650 dark:text-indigo-400 shadow-xs' : 'text-zinc-400 hover:text-zinc-655'}`}
                  title="List View"
                >
                  <ListIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Grid / List Layout Rendering */}
          {filteredProjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-850 rounded-2xl text-center space-y-4 shadow-sm animate-in fade-in duration-200">
              <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-950/40 rounded-full flex items-center justify-center text-indigo-650 dark:text-indigo-400">
                <Folder className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-zinc-900 dark:text-zinc-50 text-sm">No writings found</h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-450 max-w-xs leading-relaxed">
                  {searchQuery ? "No documents match your search filter." : "Get started by creating a new document or selecting one of our chapter outlines."}
                </p>
              </div>
              {!searchQuery && (
                <button
                  onClick={onCreateProject}
                  className="px-4 py-2 bg-indigo-650 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow transition-colors cursor-pointer active:scale-97"
                >
                  Start a New Writing
                </button>
              )}
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in duration-200">
              {filteredProjects.map((project) => (
                <div
                  key={project.id}
                  onClick={() => onLoadProject(project.id)}
                  className="group border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-2xl p-5 hover:shadow-lg hover:border-indigo-200 dark:hover:border-indigo-900/40 hover:-translate-y-0.5 transition-all duration-300 flex flex-col justify-between min-h-[170px] cursor-pointer"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                        project.documentType === 'Seminar' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border border-emerald-200/40 dark:border-emerald-900/20' :
                        project.documentType === 'Proposal' ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border border-amber-200/40 dark:border-amber-900/20' :
                        project.documentType === 'Project' ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400 border border-indigo-200/40 dark:border-indigo-900/20' :
                        'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                      }`}>
                        {project.documentType}
                      </span>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => onRenameProject(project.id)}
                          className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
                          title="Rename writing"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onDeleteProject(project.id)}
                          className="p-1 hover:bg-red-50 dark:hover:bg-red-950/30 rounded text-zinc-400 hover:text-red-650 dark:hover:text-red-400 cursor-pointer"
                          title="Delete writing"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    
                    <div className="space-y-1">
                      <h3 className="font-bold text-zinc-900 dark:text-zinc-550 text-sm group-hover:text-indigo-650 dark:group-hover:text-indigo-400 transition-colors line-clamp-1">
                        {project.title}
                      </h3>
                      <p className="text-xs text-zinc-400 dark:text-zinc-500 line-clamp-2 leading-relaxed">
                        {getContentSnippet(project.content)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-zinc-100 dark:border-zinc-850/80 pt-4 mt-4 text-[10px] text-zinc-450 dark:text-zinc-500 font-medium">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-zinc-400" />
                      <span>{formatDate(project.updatedAt)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>{project.wordCount} words</span>
                      <span>•</span>
                      <span>{project.charCount} chars</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-2xl overflow-hidden shadow-sm animate-in fade-in duration-200">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/60 text-zinc-400 font-bold uppercase tracking-wider text-[10px]">
                    <th className="p-4 pl-6">Title</th>
                    <th className="p-4">Type</th>
                    <th className="p-4">Modified</th>
                    <th className="p-4">Stats</th>
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
                      <td className="p-4 pl-6 font-bold text-zinc-800 dark:text-zinc-200 max-w-xs truncate group-hover:text-indigo-650 dark:group-hover:text-indigo-400">
                        {project.title}
                      </td>
                      <td className="p-4">
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                          project.documentType === 'Seminar' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border border-emerald-200/40' :
                          project.documentType === 'Proposal' ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border border-amber-200/40' :
                          project.documentType === 'Project' ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400 border border-indigo-200/40' :
                          'bg-zinc-100 text-zinc-700'
                        }`}>
                          {project.documentType}
                        </span>
                      </td>
                      <td className="p-4 text-zinc-500 dark:text-zinc-450 font-medium">
                        {formatDate(project.updatedAt)}
                      </td>
                      <td className="p-4 text-zinc-500 dark:text-zinc-450 font-medium">
                        {project.wordCount} words / {project.charCount} chars
                      </td>
                      <td className="p-4 pr-6 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => onLoadProject(project.id)}
                            className="px-2.5 py-1.5 hover:bg-indigo-50 dark:hover:bg-indigo-950 text-indigo-650 dark:text-indigo-450 rounded-lg font-bold cursor-pointer text-[10px] uppercase tracking-wide"
                          >
                            Open
                          </button>
                          <button
                            onClick={() => onRenameProject(project.id)}
                            className="p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-zinc-455 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
                            title="Rename writing"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => onDeleteProject(project.id)}
                            className="p-1.5 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg text-zinc-455 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
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
        </section>
      </main>
    </div>
  )
}
