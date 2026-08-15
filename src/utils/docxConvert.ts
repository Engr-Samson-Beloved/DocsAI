"use client"

/**
 * Client side of the true-fidelity conversion path.
 *
 * The rule this encodes: NEVER re-render a document someone else already
 * formatted. If the user uploaded a .docx and has not edited it, the faithful
 * export is LibreOffice's conversion of the original bytes — page geometry,
 * tables, figures, list numbering, headers/footers and hyperlinks all intact.
 * Our own renderer only ever sees the editor model, which is three lossy
 * transforms downstream of the file.
 *
 * When no converter is configured this reports unavailable and the caller falls
 * back to rendering the editor model, which is what the app did before.
 */

import { getOriginalUpload, type OriginalUpload } from './db'

let availabilityProbe: Promise<boolean> | null = null

/** Cached per session — the answer cannot change without a redeploy. */
export function isConversionAvailable(): Promise<boolean> {
  if (!availabilityProbe) {
    availabilityProbe = fetch('/api/export/pdf', { method: 'GET' })
      .then(r => (r.ok ? r.json() : { available: false }))
      .then(j => Boolean(j?.available))
      .catch(() => false)
  }
  return availabilityProbe
}

export class ConversionUnavailableError extends Error {}

/** Converts a document file to PDF via the LibreOffice service. */
export async function convertToPdf(file: Blob, filename: string): Promise<Blob> {
  const form = new FormData()
  form.append('file', file, filename)

  const res = await fetch('/api/export/pdf', { method: 'POST', body: form })

  if (res.status === 501) {
    throw new ConversionUnavailableError('Document conversion is not configured on this deployment.')
  }
  if (!res.ok) {
    let detail = `Conversion failed (${res.status}).`
    try {
      const body = await res.json()
      if (body?.error) detail = body.error
    } catch {
      /* keep the status-based message */
    }
    throw new Error(detail)
  }

  return res.blob()
}

export interface FidelityDecision {
  /** True when converting the stored original is the faithful choice. */
  useOriginal: boolean
  original: OriginalUpload | null
  reason: 'no-original' | 'edited' | 'unavailable' | 'ready'
}

/**
 * Decides whether this export should convert the original upload or render the
 * editor model.
 *
 * `pristine` comes from the editor: it is true only while the imported document
 * has received no user edit (pagination passes don't count). Once the user has
 * changed anything the original no longer represents the document they are
 * exporting, so re-rendering is the only correct answer even though it is the
 * lower-fidelity one.
 */
export async function decideExportPath(
  projectId: string | null,
  pristine: boolean
): Promise<FidelityDecision> {
  if (!projectId) return { useOriginal: false, original: null, reason: 'no-original' }

  const original = await getOriginalUpload(projectId)
  if (!original) return { useOriginal: false, original: null, reason: 'no-original' }

  if (!pristine) return { useOriginal: false, original, reason: 'edited' }

  if (!(await isConversionAvailable())) {
    return { useOriginal: false, original, reason: 'unavailable' }
  }

  return { useOriginal: true, original, reason: 'ready' }
}
