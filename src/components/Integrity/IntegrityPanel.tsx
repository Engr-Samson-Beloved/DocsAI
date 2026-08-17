"use client"

/**
 * The Integrity Check dialog, launched from the editor toolbar.
 *
 * Implements §26's four states — idle, processing, completed, failed — and
 * §21's cost control: nothing is submitted until the user presses the button,
 * the estimate is shown before they do, and an unchanged document offers its
 * previous result rather than paying for a second scan.
 *
 * Self-contained on purpose. Editor.tsx is already ~8,000 lines and adding
 * another async workflow to it would make the file harder to work in; this
 * component owns its own state machine and the editor only decides when to
 * mount it.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Download,
  ExternalLink,
  Loader2,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react'
import type { CheckStage, IntegrityCheck } from '../../utils/integrity/types'
import {
  downloadReport,
  fetchHistory,
  submitIntegrityCheck,
  watchIntegrityCheck,
  IntegrityUnavailableError,
  type CheckSummary,
  type UsageEstimate,
} from '../../utils/integrityClient'
import { assessmentLabel } from '../../utils/integrity/engine'
import { extractDocumentText } from '../../utils/integrity/extract'

export interface IntegrityPanelProps {
  projectId: string
  title: string
  /** Stringified Tiptap JSON, read at submit time so it is never stale. */
  getContent: () => string
  documentType?: string
  academicLevel?: string
  onClose: () => void
}

type Phase = 'idle' | 'processing' | 'completed' | 'failed'

export default function IntegrityPanel({
  projectId,
  title,
  getContent,
  documentType,
  academicLevel,
  onClose,
}: IntegrityPanelProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [stages, setStages] = useState<CheckStage[]>([])
  const [check, setCheck] = useState<IntegrityCheck | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [estimate, setEstimate] = useState<UsageEstimate | null>(null)
  const [history, setHistory] = useState<CheckSummary[]>([])
  const [downloading, setDownloading] = useState(false)

  const abort = useRef<AbortController | null>(null)

  /**
   * Word count for the estimate, derived with the same extractor the server
   * uses, so the number the user sees before pressing the button is the number
   * they will actually be billed against.
   *
   * Derived rather than stored: putting this in state and filling it from an
   * effect makes the dialog render once with a misleading zero.
   */
  const wordCount = useMemo(() => {
    try {
      return extractDocumentText(getContent()).wordCount
    } catch {
      return 0
    }
  }, [getContent])

  useEffect(() => {
    fetchHistory(projectId).then(setHistory).catch(() => setHistory([]))
  }, [projectId])

  useEffect(() => {
    return () => abort.current?.abort()
  }, [])

  const run = useCallback(
    async (force: boolean) => {
      setError(null)
      setNotice(null)
      setPhase('processing')
      setStages([])

      abort.current?.abort()
      const controller = new AbortController()
      abort.current = controller

      try {
        const submitted = await submitIntegrityCheck(
          {
            projectId,
            title,
            content: getContent(),
            documentType,
            academicLevel,
          },
          { force }
        )

        setEstimate(submitted.estimate ?? null)

        if (submitted.cached) {
          setNotice(submitted.message ?? null)
        }
        if (submitted.similarityAvailable === false) {
          setNotice(prev =>
            [
              prev,
              'Similarity checking is unavailable on this deployment, so the report covers AI-writing indicators only.',
            ]
              .filter(Boolean)
              .join(' ')
          )
        }

        const finished = await watchIntegrityCheck(submitted.checkId, {
          onStages: setStages,
          signal: controller.signal,
        })

        setCheck(finished)
        setPhase('completed')
        fetchHistory(projectId).then(setHistory).catch(() => {})
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError(
          err instanceof IntegrityUnavailableError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'The integrity check could not be completed.'
        )
        setPhase('failed')
      }
    },
    [projectId, title, getContent, documentType, academicLevel]
  )

  const handleDownload = async () => {
    if (!check) return
    setDownloading(true)
    try {
      await downloadReport(check.id, `WordPI-Integrity-Report-${title}.pdf`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The report could not be downloaded.')
    } finally {
      setDownloading(false)
    }
  }

  const tooShort = wordCount > 0 && wordCount < 60

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-zinc-900">
        {/* header */}
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 p-5 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <div>
              <h2 className="font-bold text-zinc-900 dark:text-zinc-50">Document Integrity</h2>
              <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{title}</p>
            </div>
          </div>
          <button
            onClick={() => {
              abort.current?.abort()
              onClose()
            }}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5">
          {/* ── idle ─────────────────────────────────────────── */}
          {phase === 'idle' ? (
            <>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Check this document for AI-writing indicators, similarity and citation issues.
              </p>

              <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-800/50">
                <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                  <span>Document size</span>
                  <span className="font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
                    {wordCount.toLocaleString()} words
                  </span>
                </div>
                <p className="mt-2 text-zinc-500 dark:text-zinc-500">
                  Your document is sent to the configured detection providers for analysis. It
                  is not stored by WordPI after the check completes.
                </p>
              </div>

              {tooShort ? (
                <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 w-3.5 h-3.5 shrink-0" />
                  This document may be too short to analyse reliably. Detectors need a few
                  hundred characters of prose.
                </p>
              ) : null}

              <button
                onClick={() => run(false)}
                className="mt-5 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
              >
                Run Integrity Check
              </button>

              {history.length ? (
                <div className="mt-5">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    Previous checks
                  </h3>
                  <div className="mt-2 space-y-1.5">
                    {history.slice(0, 5).map(entry => (
                      <Link
                        key={entry.id}
                        href={`/integrity/${entry.id}`}
                        className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 text-xs transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
                      >
                        <span className="text-zinc-600 dark:text-zinc-400">
                          {new Date(entry.createdAt).toLocaleDateString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                        <span className="flex items-center gap-2 font-medium text-zinc-800 dark:text-zinc-200">
                          {entry.assessment ? assessmentLabel(entry.assessment as never) : entry.status}
                          <ExternalLink className="w-3 h-3 text-zinc-400" />
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {/* ── processing ───────────────────────────────────── */}
          {phase === 'processing' ? (
            <>
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                Analysing your document…
              </p>
              <ul className="mt-4 space-y-2.5">
                {(stages.length ? stages : PLACEHOLDER_STAGES).map(stage => (
                  <li key={stage.id} className="flex items-start gap-2.5 text-sm">
                    <StageIcon state={stage.state} />
                    <div>
                      <span
                        className={
                          stage.state === 'done'
                            ? 'text-zinc-700 dark:text-zinc-300'
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
              <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
                This can take a few minutes. You can keep editing in another tab — closing this
                dialog will not cancel the scan.
              </p>
            </>
          ) : null}

          {/* ── completed ────────────────────────────────────── */}
          {phase === 'completed' && check ? (
            <>
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
                Integrity check complete
              </div>

              {notice ? (
                <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">
                  {notice}
                </p>
              ) : null}

              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-zinc-500 dark:text-zinc-400">AI indicators</dt>
                  <dd className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {check.verdict ? assessmentLabel(check.verdict.assessment) : '—'}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-zinc-500 dark:text-zinc-400">Similarity</dt>
                  <dd className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {check.plagiarism?.status === 'completed'
                      ? `${check.plagiarism.similarityPercentage}%`
                      : 'Not available'}
                  </dd>
                </div>
              </dl>

              {check.verdict ? (
                <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                  {check.verdict.headline}
                </p>
              ) : null}

              <div className="mt-5 flex gap-2">
                <Link
                  href={`/integrity/${check.id}`}
                  className="flex-1 rounded-lg bg-indigo-600 px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
                >
                  View Results
                </Link>
                <button
                  onClick={handleDownload}
                  disabled={!check.reportGenerated || downloading}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                >
                  {downloading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  PDF
                </button>
              </div>

              <button
                onClick={() => run(true)}
                className="mt-2 w-full rounded-lg px-4 py-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              >
                Run a fresh check anyway
              </button>
            </>
          ) : null}

          {/* ── failed ───────────────────────────────────────── */}
          {phase === 'failed' ? (
            <>
              <div className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-400">
                <XCircle className="w-4 h-4" />
                We couldn&apos;t complete the integrity check.
              </div>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{error}</p>
              <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                Your document has not been changed.
              </p>
              <button
                onClick={() => run(true)}
                className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
              >
                Try Again
              </button>
            </>
          ) : null}

          {estimate && phase !== 'idle' ? (
            <p className="mt-4 text-[11px] text-zinc-400 dark:text-zinc-500">
              Providers used: {estimate.providers.map(p => p.label).join(', ') || 'none'}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** Shown for the first second, before the server reports real stages. */
const PLACEHOLDER_STAGES: CheckStage[] = [
  { id: 'prepare', label: 'Preparing document', state: 'active' },
  { id: 'ai-detection', label: 'Checking AI patterns', state: 'pending' },
  { id: 'plagiarism', label: 'Checking similarity', state: 'pending' },
  { id: 'compare', label: 'Comparing results', state: 'pending' },
  { id: 'report', label: 'Generating report', state: 'pending' },
]

function StageIcon({ state }: { state: CheckStage['state'] }) {
  const cls = 'w-4 h-4 mt-0.5 shrink-0'
  if (state === 'done') return <CheckCircle2 className={`${cls} text-emerald-500`} />
  if (state === 'active') return <Loader2 className={`${cls} animate-spin text-indigo-500`} />
  if (state === 'failed') return <XCircle className={`${cls} text-red-500`} />
  if (state === 'skipped') return <AlertTriangle className={`${cls} text-zinc-400`} />
  return <Circle className={`${cls} text-zinc-300 dark:text-zinc-700`} />
}
