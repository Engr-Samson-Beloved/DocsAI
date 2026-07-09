"use client"

import React, { useState } from 'react'
import { Search, BookOpen, Copy, Plus, ExternalLink, Check, Loader2 } from 'lucide-react'

interface ReferenceFinderProps {
  onAddSource: (name: string, content: string, type: string) => Promise<any>
  existingSourcesCount: number
}

interface CrossRefAuthor {
  given?: string
  family?: string
}

interface CrossRefWork {
  title?: string[]
  author?: CrossRefAuthor[]
  'container-title'?: string[]
  volume?: string
  issue?: string
  page?: string
  DOI?: string
  URL?: string
  published?: {
    'date-parts'?: number[][]
  }
  publisher?: string
}

export default function ReferenceFinder({ onAddSource, existingSourcesCount }: ReferenceFinderProps) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<CrossRefWork[]>([])
  const [copiedIndex, setCopiedIndex] = useState<{ [key: number]: string } | null>(null)
  const [ingestedIndex, setIngestedIndex] = useState<{ [key: number]: boolean }>({})
  const [error, setError] = useState<string | null>(null)

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return

    setLoading(true)
    setError(null)
    setResults([])

    try {
      const res = await fetch(`https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=8`)
      if (!res.ok) {
        throw new Error(`CrossRef API returned status ${res.status}`)
      }
      const data = await res.json()
      const items = data.message?.items || []
      setResults(items)
      
      if (items.length === 0) {
        setError('No academic references found for your query.')
      }
    } catch (err: any) {
      console.error('CrossRef fetch error:', err)
      setError('Failed to fetch references. Please check your internet connection or try again shortly.')
    } finally {
      setLoading(false)
    }
  }

  // Format authors to "Family, G. I." format
  const formatAuthors = (authors?: CrossRefAuthor[]): string => {
    if (!authors || authors.length === 0) return 'Unknown Author'
    
    const formatted = authors.map(a => {
      const family = a.family || ''
      const given = a.given ? `${a.given.charAt(0)}.` : ''
      return family ? `${family}, ${given}`.trim() : a.given || 'Unknown'
    })

    if (formatted.length > 5) {
      return `${formatted.slice(0, 3).join(', ')} et al.`
    }
    
    if (formatted.length > 1) {
      const last = formatted.pop()
      return `${formatted.join(', ')} & ${last}`
    }

    return formatted[0]
  }

  // Build formatted citations
  const buildCitation = (work: CrossRefWork, style: 'APA' | 'IEEE'): string => {
    const title = work.title?.[0] || 'Untitled Work'
    const journal = work['container-title']?.[0] || work.publisher || ''
    const year = work.published?.['date-parts']?.[0]?.[0] || new Date().getFullYear()
    const vol = work.volume || ''
    const iss = work.issue || ''
    const pages = work.page || ''
    const doiUrl = work.URL || (work.DOI ? `https://doi.org/${work.DOI}` : '')

    if (style === 'APA') {
      const authors = formatAuthors(work.author)
      const details = [
        vol ? `${vol}` : '',
        iss ? `(${iss})` : '',
        pages ? `, ${pages}` : ''
      ].join('')
      
      return `${authors} (${year}). ${title}. ${journal}${details ? `, ${details}` : ''}. ${doiUrl}`.replace(/\.+/g, '.')
    } else {
      // IEEE Style
      const authors = (work.author || []).map(a => {
        const given = a.given ? `${a.given.charAt(0)}.` : ''
        return given ? `${given} ${a.family}` : a.family || 'Unknown'
      }).join(', ')
      
      const journalDetails = [
        journal ? `*${journal}*` : '',
        vol ? `vol. ${vol}` : '',
        iss ? `no. ${iss}` : '',
        pages ? `pp. ${pages}` : '',
        year ? `${year}` : ''
      ].filter(Boolean).join(', ')

      return `${authors || 'Anon.'}, "${title}," ${journalDetails}. doi: ${work.DOI || 'N/A'}`
    }
  }

  const copyToClipboard = (text: string, index: number, style: string) => {
    navigator.clipboard.writeText(text)
    setCopiedIndex(prev => ({ ...prev, [index]: style }))
    setTimeout(() => {
      setCopiedIndex(prev => {
        if (!prev) return null
        const updated = { ...prev }
        delete updated[index]
        return updated
      })
    }, 2000)
  }

  const handleIngest = async (work: CrossRefWork, index: number) => {
    try {
      const title = work.title?.[0] || 'Untitled Academic Reference'
      const authors = formatAuthors(work.author)
      const journal = work['container-title']?.[0] || 'Academic Journal'
      const year = work.published?.['date-parts']?.[0]?.[0] || new Date().getFullYear()
      const doiUrl = work.URL || `https://doi.org/${work.DOI}`

      // Package paper details as plain text citation content for RAG
      const referenceContent = `
[Academic Source Reference Details]
Title: ${title}
Author(s): ${authors}
Journal: ${journal}
Year: ${year}
DOI Link: ${doiUrl}

Summary Context:
This is an external academic work published in ${journal} (${year}) written by ${authors}. 
It covers key topics related to: ${title}. Use this reference citation for backing up factual statements, citing as "${authors} (${year})" in APA style or using standard numbering.
      `.trim()

      await onAddSource(title, referenceContent, 'pdf')
      setIngestedIndex(prev => ({ ...prev, [index]: true }))
    } catch (err) {
      alert('Failed to ingest academic reference. Check console for details.')
      console.error(err)
    }
  }

  return (
    <div className="flex flex-col h-full bg-zinc-550/5 dark:bg-zinc-950/20 text-sm overflow-hidden flex-1">
      {/* Search Bar */}
      <form onSubmit={handleSearch} className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 space-y-3 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-zinc-900 dark:text-zinc-50 font-bold">
            <BookOpen className="w-4 h-4 text-indigo-500" />
            <span>Search Academic Journals</span>
          </div>
          <span className="text-[10px] text-zinc-450 dark:text-zinc-500 font-semibold uppercase">
            Powered by CrossRef
          </span>
        </div>
        
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search topics, authors, or DOIs..."
            className="w-full text-xs pl-3 pr-10 py-2.5 bg-zinc-50 dark:bg-zinc-850 border border-zinc-200 dark:border-zinc-750 rounded-xl outline-none focus:ring-1 focus:ring-indigo-500 text-zinc-800 dark:text-zinc-200 font-medium"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="absolute right-1.5 top-1.5 p-1.5 bg-indigo-600 hover:bg-indigo-750 disabled:bg-zinc-250 dark:disabled:bg-zinc-800 text-white rounded-lg transition-colors cursor-pointer"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Search className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </form>

      {/* Results Container */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && (
          <div className="p-4 bg-zinc-50 dark:bg-zinc-900/40 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl text-center text-zinc-500 text-xs">
            {error}
          </div>
        )}

        {!loading && results.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center text-center py-12 px-4 space-y-3">
            <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-850 flex items-center justify-center text-zinc-450">
              <BookOpen className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h4 className="font-semibold text-zinc-800 dark:text-zinc-200 text-xs">No references searched yet</h4>
              <p className="text-[11px] text-zinc-450 dark:text-zinc-500 max-w-xs">
                Type in keywords related to your research topic to search millions of verified publications and cite them instantly.
              </p>
            </div>
          </div>
        )}

        {loading && (
          <div className="space-y-4">
            {[1, 2, 3].map((n) => (
              <div key={n} className="p-4 bg-white dark:bg-zinc-900 border border-zinc-150 dark:border-zinc-850 rounded-xl space-y-3 animate-pulse">
                <div className="h-4 bg-zinc-100 dark:bg-zinc-800 rounded w-5/6"></div>
                <div className="h-3 bg-zinc-100 dark:bg-zinc-800 rounded w-1/3"></div>
                <div className="h-3 bg-zinc-100 dark:bg-zinc-800 rounded w-2/3"></div>
              </div>
            ))}
          </div>
        )}

        {results.map((work, index) => {
          const title = work.title?.[0] || 'Untitled Work'
          const authors = formatAuthors(work.author)
          const journal = work['container-title']?.[0] || work.publisher || ''
          const year = work.published?.['date-parts']?.[0]?.[0] || 'N/A'
          const doiUrl = work.URL || (work.DOI ? `https://doi.org/${work.DOI}` : '')

          const apaCitation = buildCitation(work, 'APA')
          const ieeeCitation = buildCitation(work, 'IEEE')

          return (
            <div 
              key={index} 
              className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl space-y-3.5 hover:border-zinc-300 dark:hover:border-zinc-700 shadow-sm transition-all"
            >
              <div className="space-y-1">
                <h4 className="font-bold text-zinc-900 dark:text-zinc-150 text-xs leading-normal">
                  {title}
                </h4>
                <div className="text-[11px] text-zinc-450 dark:text-zinc-500 font-medium">
                  {authors} ({year})
                </div>
                {journal && (
                  <div className="text-[10px] bg-zinc-50 dark:bg-zinc-850 border border-zinc-200 dark:border-zinc-800 inline-block px-2 py-0.5 rounded text-zinc-500 dark:text-zinc-400 font-semibold truncate max-w-full">
                    {journal}
                  </div>
                )}
              </div>

              {/* Actions panel */}
              <div className="flex items-center justify-between border-t border-zinc-100 dark:border-zinc-800/80 pt-3 flex-wrap gap-2 text-[10px]">
                {/* Citation copiers */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => copyToClipboard(apaCitation, index, 'APA')}
                    className="px-2.5 py-1 bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-850 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-750 text-zinc-650 dark:text-zinc-350 rounded font-semibold cursor-pointer transition-colors flex items-center gap-1"
                  >
                    {copiedIndex?.[index] === 'APA' ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-500" />
                        <span className="text-emerald-500">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>APA</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => copyToClipboard(ieeeCitation, index, 'IEEE')}
                    className="px-2.5 py-1 bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-850 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-750 text-zinc-650 dark:text-zinc-350 rounded font-semibold cursor-pointer transition-colors flex items-center gap-1"
                  >
                    {copiedIndex?.[index] === 'IEEE' ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-500" />
                        <span className="text-emerald-500">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>IEEE</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Ingest and links */}
                <div className="flex items-center gap-2">
                  {doiUrl && (
                    <a
                      href={doiUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1 text-zinc-450 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
                      title="Visit Original Paper"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}

                  <button
                    onClick={() => handleIngest(work, index)}
                    disabled={ingestedIndex[index]}
                    className={`px-2.5 py-1 rounded font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                      ingestedIndex[index]
                        ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border border-emerald-150 dark:border-emerald-900/30'
                        : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-650 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/60 dark:text-indigo-350 border border-indigo-150 dark:border-indigo-900/30'
                    }`}
                  >
                    {ingestedIndex[index] ? (
                      <>
                        <Check className="w-3 h-3" />
                        <span>Ingested</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-3 h-3" />
                        <span>Ingest Source</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
