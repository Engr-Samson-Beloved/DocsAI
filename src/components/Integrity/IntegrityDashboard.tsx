"use client"

/**
 * The integrity results dashboard (§11, §12, §13, §26).
 *
 * One design decision drives most of this file: the server never stores the
 * document text. Flagged passages come back as character offsets into the
 * normalised text, not as quoted prose (see `utils/integrity/store.ts`). So to
 * show a student *which* sentences were flagged, this component re-derives the
 * text locally from the project in IndexedDB and resolves the offsets against
 * it — the extraction is deterministic, so the offsets line up.
 *
 * The upshot is that highlighting works on the device that owns the document
 * and degrades to a section-level summary anywhere else, without the server
 * ever having held a copy of the prose. That is a better privacy position than
 * storing the text would have given us, and it costs one IndexedDB read.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  Download,
  FileText,
  Info,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import type {
  CheckStage,
  IntegrityCheck,
  PlagiarismSource,
  SectionDetectionResult,
} from '../../utils/integrity/types'
import {
  downloadReport,
  fetchCheck,
  fetchStatus,
  IntegrityCheckError,
} from '../../utils/integrityClient'
import { assessmentLabel } from '../../utils/integrity/engine'
import { extractDocumentText } from '../../utils/integrity/extract'
import { getAllProjects } from '../../utils/db'

interface Props {
  checkId: string
}

/** Tone -> Tailwind, in one place so a colour cannot drift between cards. */
const TONE_CLASSES: Record<string, { text: string; bg: string; ring: string; bar: string }> = {
  positive: {
    text: 'text-emerald-700 dark:text-emerald-400',
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    ring: 'border-emerald-200 dark:border-emerald-900',
    bar: 'bg-emerald-500',
  },
  caution: {
    text: 'text-amber-700 dark:text-amber-400',
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    ring: 'border-amber-200 dark:border-amber-900',
    bar: 'bg-amber-500',
  },
  warning: {
    text: 'text-red-700 dark:text-red-400',
    bg: 'bg-red-50 dark:bg-red-950/40',
    ring: 'border-red-200 dark:border-red-900',
    bar: 'bg-red-500',
  },
  neutral: {
    text: 'text-zinc-600 dark:text-zinc-400',
    bg: 'bg-zinc-50 dark:bg-zinc-900',
    ring: 'border-zinc-200 dark:border-zinc-800',
    bar: 'bg-zinc-400',
  },
}

function toneFor(assessment: string | undefined): keyof typeof TONE_CLASSES {
  switch (assessment) {
    case 'low_concern': return 'positive'
    case 'moderate_concern': return 'caution'
    case 'provider_disagreement': return 'caution'
    case 'high_concern': return 'warning'
    default: return 'neutral'
  }
}

function providerLabel(id: string): string {
  if (id === 'copyleaks') return 'Copyleaks'
  if (id === 'gptzero') return 'GPTZero'
  return id
}

function pct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

function statusWord(status: string): string {
  switch (status) {
    case 'completed': return 'Completed'
    case 'partial': return 'Partial'
    case 'failed': return 'Unavailable'
    case 'skipped': return 'Not run'
    default: return status
  }
}

const CATEGORY_LABELS: Record<PlagiarismSource['category'], string> = {
  internet: 'Web',
  academic: 'Academic',
  repository: 'Repositories',
  other: 'Other',
}

export default function IntegrityDashboard({ checkId }: Props) {
  const [check, setCheck] = useState<IntegrityCheck | null>(null)
  const [stages, setStages] = useState<CheckStage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [documentText, setDocumentText] = useState<string | null>(null)
  const [selected, setSelected] = useState<SectionDetectionResult | null>(null)

  /* ── load, then poll while the check is still running ───────────── */

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    // Declared inside the effect and re-scheduled by tail call rather than as
    // a useCallback that references itself — a self-referencing callback reads
    // its own binding before initialisation.
    const tick = async () => {
      try {
        const snapshot = await fetchStatus(checkId)
        if (cancelled) return

        setStages(snapshot.stages)

        if (snapshot.status === 'completed') {
          const full = await fetchCheck(checkId)
          if (cancelled) return
          setCheck(full)
          setLoading(false)
          return
        }

        if (snapshot.status === 'failed') {
          setError(snapshot.error || 'Integrity check could not be completed.')
          setLoading(false)
          return
        }

        setLoading(false)
        timer = setTimeout(tick, 2000)
      } catch (err) {
        if (cancelled) return
        setError(
          err instanceof IntegrityCheckError
            ? err.message
            : 'Could not load this integrity check.'
        )
        setLoading(false)
      }
    }

    tick()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [checkId])

  /* ── re-derive the text locally so offsets can be resolved ──────── */

  useEffect(() => {
    if (!check) return
    let cancelled = false

    getAllProjects()
      .then(projects => {
        if (cancelled) return
        const project = projects.find(p => p.id === check.document.projectId)
        if (!project) return
        // Same function the server used, so the offsets agree.
        setDocumentText(extractDocumentText(project.content).text)
      })
      .catch(() => {
        // The document simply is not on this device. The section-level summary
        // below still works; only the quoted passages are unavailable.
      })

    return () => {
      cancelled = true
    }
  }, [check])

  const flagged = useMemo(
    () => (check ? check.ai.flatMap(result => result.sections ?? []) : []),
    [check]
  )

  const quote = useCallback(
    (section: SectionDetectionResult): string | null => {
      if (!documentText) return null
      const text = documentText.slice(section.span.start, section.span.start + section.span.length)
      return text.trim() || null
    },
    [documentText]
  )

  const handleDownload = async () => {
    if (!check) return
    setDownloading(true)
    try {
      await downloadReport(check.id, `WordPI-Integrity-Report-${check.document.title}.pdf`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The report could not be downloaded.')
    } finally {
      setDownloading(false)
    }
  }

  /* ── states ─────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center gap-3 text-zinc-500 dark:text-zinc-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Loading integrity check…</span>
        </div>
      </Shell>
    )
  }

  if (error && !check) {
    return (
      <Shell>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950/40">
          <div className="flex items-center gap-2 font-semibold text-red-700 dark:text-red-400">
            <XCircle className="w-5 h-5" />
            <span>We couldn&apos;t complete the integrity check.</span>
          </div>
          <p className="mt-2 text-sm text-red-700/80 dark:text-red-300/80">{error}</p>
          <Link
            href="/"
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Try Again
          </Link>
        </div>
      </Shell>
    )
  }

  if (!check) {
    return (
      <Shell>
        <ProcessingPanel stages={stages} />
      </Shell>
    )
  }

  const verdict = check.verdict
  const tone = TONE_CLASSES[toneFor(verdict?.assessment)]
  const plagiarism = check.plagiarism

  return (
    <Shell>
      {/* ── header ─────────────────────────────────────────────── */}
      <header className="mb-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to WordPI
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
              WordPI Integrity Check
            </p>
            <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {check.document.title}
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Checked{' '}
              {new Date(check.completedAt ?? check.createdAt).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}{' '}
              · {check.wordCount.toLocaleString()} words analysed · Report {check.id}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              disabled={!check.reportGenerated || downloading}
              className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/40"
              title={
                check.reportGenerated
                  ? 'Download the PDF integrity report'
                  : 'The PDF report is not available for this check'
              }
            >
              {downloading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              Download PDF
            </button>
            <Link
              href={`/?project=${encodeURIComponent(check.document.projectId)}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              <FileText className="w-3.5 h-3.5" />
              Open in Editor
            </Link>
          </div>
        </div>
      </header>

      {error ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {error}
        </div>
      ) : null}

      {/* ── verdict ────────────────────────────────────────────── */}
      {verdict ? (
        <section className={`mb-6 rounded-xl border p-5 ${tone.ring} ${tone.bg}`}>
          <div className={`flex items-center gap-2 text-sm font-bold ${tone.text}`}>
            <ShieldCheck className="w-4 h-4" />
            WordPI assessment: {assessmentLabel(verdict.assessment)}
          </div>
          <p className="mt-2 font-medium text-zinc-800 dark:text-zinc-100">{verdict.headline}</p>
          <ul className="mt-3 space-y-1.5">
            {verdict.detail.map((line, i) => (
              <li key={i} className="text-sm text-zinc-600 dark:text-zinc-400">
                {line}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── AI detection card ────────────────────────────────── */}
        <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            AI-Writing Indicators
          </h2>

          <div className="mt-4 space-y-3">
            {check.ai.length ? (
              check.ai.map(result => (
                <div key={result.provider}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">
                      {providerLabel(result.provider)}
                    </span>
                    <span className="font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                      {pct(result.aiProbability)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div
                      className={`h-full rounded-full ${tone.bar}`}
                      style={{
                        width: `${result.aiProbability === null ? 0 : Math.round(result.aiProbability * 100)}%`,
                      }}
                    />
                  </div>
                  {result.error ? (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{result.error}</p>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No AI detection was performed for this document.
              </p>
            )}
          </div>

          <p className="mt-4 flex items-start gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <Info className="mt-0.5 w-3.5 h-3.5 shrink-0" />
            These are probabilistic indicators. They describe characteristics associated with
            AI-generated writing and are not proof of how the text was written.
          </p>
        </section>

        {/* ── similarity card ──────────────────────────────────── */}
        <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Similarity
          </h2>

          {plagiarism && plagiarism.status === 'completed' ? (
            <>
              <p className="mt-3 text-4xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
                {plagiarism.similarityPercentage}%
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {plagiarism.matchedWords.toLocaleString()} matching words
              </p>

              <div className="mt-4 space-y-1.5">
                {categoryBreakdown(plagiarism.sources).map(entry => (
                  <div key={entry.label} className="flex items-center justify-between text-sm">
                    <span className="text-zinc-600 dark:text-zinc-400">{entry.label}</span>
                    <span className="tabular-nums text-zinc-800 dark:text-zinc-200">
                      {entry.value.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
              {plagiarism?.error || 'Similarity analysis was not performed for this document.'}
            </p>
          )}

          <p className="mt-4 flex items-start gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <Info className="mt-0.5 w-3.5 h-3.5 shrink-0" />
            Similarity means matching text, not plagiarism. A match may be a correctly cited
            quotation, a reference, or standard academic wording.
          </p>
        </section>
      </div>

      {/* ── provider comparison ──────────────────────────────────── */}
      <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Provider Comparison
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="pb-2 font-semibold">Provider</th>
                <th className="pb-2 text-right font-semibold">AI Result</th>
                <th className="pb-2 text-right font-semibold">Words</th>
                <th className="pb-2 text-right font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {check.ai.map(result => (
                <tr key={result.provider} className="border-b border-zinc-100 dark:border-zinc-800/60">
                  <td className="py-2 text-zinc-800 dark:text-zinc-200">
                    {providerLabel(result.provider)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                    {pct(result.aiProbability)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                    {result.analyzedWords.toLocaleString()}
                  </td>
                  <td className="py-2 text-right text-zinc-600 dark:text-zinc-400">
                    {statusWord(result.status)}
                  </td>
                </tr>
              ))}
              {plagiarism ? (
                <tr>
                  <td className="py-2 text-zinc-800 dark:text-zinc-200">
                    {providerLabel(plagiarism.provider)} (similarity)
                  </td>
                  <td className="py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                    {plagiarism.status === 'completed' ? `${plagiarism.similarityPercentage}%` : '—'}
                  </td>
                  <td className="py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                    {plagiarism.matchedWords.toLocaleString()}
                  </td>
                  <td className="py-2 text-right text-zinc-600 dark:text-zinc-400">
                    {statusWord(plagiarism.status)}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── flagged passages ─────────────────────────────────────── */}
      {flagged.length ? (
        <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Flagged Passages ({flagged.length})
          </h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Select a passage to see why it was flagged.
          </p>

          <div className="mt-3 max-h-80 space-y-1.5 overflow-y-auto pr-1">
            {flagged.slice(0, 100).map((section, i) => {
              const text = quote(section)
              const isSelected = selected === section
              return (
                <button
                  key={i}
                  onClick={() => setSelected(isSelected ? null : section)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                    isSelected
                      ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40'
                      : 'border-zinc-200 bg-zinc-50 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-800/50 dark:hover:bg-zinc-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                      {section.section || 'Unattributed passage'}
                    </span>
                    <span className="shrink-0 text-xs font-bold tabular-nums text-amber-700 dark:text-amber-400">
                      {pct(section.aiProbability)}
                    </span>
                  </div>
                  {text ? (
                    <p className="mt-1 line-clamp-2 text-sm text-zinc-700 dark:text-zinc-300">
                      {text}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs italic text-zinc-400 dark:text-zinc-500">
                      Open this document on the device that holds it to see the passage text.
                    </p>
                  )}
                </button>
              )
            })}
          </div>

          {selected ? (
            <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-800/50">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Why this section was flagged
              </h3>
              <dl className="mt-2 space-y-1 text-sm">
                <div className="flex gap-2">
                  <dt className="w-28 text-zinc-500 dark:text-zinc-400">Section</dt>
                  <dd className="text-zinc-800 dark:text-zinc-200">
                    {selected.section || 'Not attributed to a heading'}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 text-zinc-500 dark:text-zinc-400">AI probability</dt>
                  <dd className="text-zinc-800 dark:text-zinc-200">{pct(selected.aiProbability)}</dd>
                </div>
              </dl>
              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                Review this section and make sure the explanation reflects your own
                understanding. Where it does not, rewrite it in your own words and check that
                any factual claim is supported by a source you have read.
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ── matched sources ──────────────────────────────────────── */}
      {plagiarism?.sources.length ? (
        <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Matched Sources
          </h2>
          <div className="mt-3 space-y-2">
            {plagiarism.sources.slice(0, 25).map((source, i) => (
              <div
                key={i}
                className="flex items-start justify-between gap-4 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    {source.title || source.url || 'Untitled source'}
                  </p>
                  {source.url ? (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="block truncate text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      {source.url}
                    </a>
                  ) : null}
                  <p className="mt-0.5 text-[11px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                    {CATEGORY_LABELS[source.category]}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-bold tabular-nums text-zinc-700 dark:text-zinc-300">
                  {source.similarityPercentage !== undefined
                    ? `${source.similarityPercentage.toFixed(1)}%`
                    : `${source.matchedWords ?? 0} words`}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ── recommendations ──────────────────────────────────────── */}
      {verdict?.recommendations.length ? (
        <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Recommendations
          </h2>
          <ol className="mt-3 space-y-2">
            {verdict.recommendations.map((item, i) => (
              <li key={i} className="flex gap-3 text-sm text-zinc-700 dark:text-zinc-300">
                <span className="font-bold tabular-nums text-zinc-400 dark:text-zinc-500">
                  {i + 1}.
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ol>

          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              href={`/?project=${encodeURIComponent(check.document.projectId)}`}
              className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              Review Writing
            </Link>
            {/*
              Opens the project and starts the rewriter. Labelled for what it
              does to the writing, not for what it might do to a detector —
              §13. There is deliberately no "Add Citation" button here: the
              editor has no citation flow to open, and a button that only
              re-opens the document while promising something else is worse
              than the recommendation text above it.
            */}
            <Link
              href={`/?project=${encodeURIComponent(check.document.projectId)}&action=improve-originality`}
              className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-100 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300 dark:hover:bg-violet-900/40"
              title="Improve originality and natural academic expression"
            >
              Improve Originality
            </Link>
            <Link
              href={`/?project=${encodeURIComponent(check.document.projectId)}&action=integrity`}
              className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/40"
              title="Check the document again after editing it"
            >
              Re-check After Editing
            </Link>
          </div>

          <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
            You remain responsible for reviewing and approving the final content of your
            document.
          </p>
        </section>
      ) : null}

      {/* ── disclaimer ───────────────────────────────────────────── */}
      <section className="mt-5 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
        <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          <strong className="text-zinc-600 dark:text-zinc-300">Important.</strong> AI-detection
          results are probabilistic indicators and should not be interpreted as definitive proof
          that text was generated by artificial intelligence. Similarity results indicate
          matching text and do not independently establish plagiarism. Review flagged content and
          verify citations before submission.
        </p>
      </section>
    </Shell>
  )
}

/* ── pieces ─────────────────────────────────────────────────────── */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex-1 overflow-y-auto bg-zinc-100 dark:bg-zinc-950">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">{children}</div>
    </main>
  )
}

/** §26's processing checklist. */
function ProcessingPanel({ stages }: { stages: CheckStage[] }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
        Analysing your document…
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        This can take a few minutes. You can leave this page open.
      </p>

      <ul className="mt-5 space-y-2.5">
        {stages.map(stage => (
          <li key={stage.id} className="flex items-start gap-2.5 text-sm">
            <StageIcon state={stage.state} />
            <div>
              <span
                className={
                  stage.state === 'done'
                    ? 'text-zinc-800 dark:text-zinc-200'
                    : stage.state === 'active'
                      ? 'font-medium text-zinc-900 dark:text-zinc-100'
                      : 'text-zinc-400 dark:text-zinc-500'
                }
              >
                {stage.label}
              </span>
              {stage.note ? (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{stage.note}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StageIcon({ state }: { state: CheckStage['state'] }) {
  const cls = 'w-4 h-4 mt-0.5 shrink-0'
  if (state === 'done') return <CheckCircle2 className={`${cls} text-emerald-500`} />
  if (state === 'active') return <Loader2 className={`${cls} animate-spin text-indigo-500`} />
  if (state === 'failed') return <XCircle className={`${cls} text-red-500`} />
  if (state === 'skipped') return <AlertTriangle className={`${cls} text-zinc-400`} />
  return <Circle className={`${cls} text-zinc-300 dark:text-zinc-700`} />
}

function categoryBreakdown(sources: PlagiarismSource[]): { label: string; value: number }[] {
  const totals: Record<PlagiarismSource['category'], number> = {
    internet: 0,
    academic: 0,
    repository: 0,
    other: 0,
  }
  for (const source of sources) {
    totals[source.category] += source.similarityPercentage ?? 0
  }
  return (Object.keys(totals) as PlagiarismSource['category'][])
    .filter(key => totals[key] > 0)
    .map(key => ({ label: CATEGORY_LABELS[key], value: totals[key] }))
}
