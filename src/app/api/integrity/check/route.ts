/**
 * Integrity checks: submit one, or list the caller's history.
 *
 *   POST /api/integrity/check   start a check   -> 202 { checkId }
 *   GET  /api/integrity/check   history         -> [ summaries ]
 *
 * The provider keys never leave the server: the browser posts a document here
 * and polls for a result, and only this process talks to Copyleaks or GPTZero
 * (§3, §24).
 *
 * Answering 202 and finishing the work in `after()` is the same shape the
 * Humanizer already uses. A scan can take minutes; holding the request open
 * would hit the platform's function timeout and lose a check the user has
 * already paid credits for.
 */

import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { nanoid } from 'nanoid'
import { resolveOwner } from '../../../../utils/owner'
import {
  createCheck,
  estimateUsage,
  prepareDocument,
  runCheck,
  MIN_CHARACTERS,
} from '../../../../utils/integrity/runner'
import { findCachedCheck, listChecks, saveCheck } from '../../../../utils/integrity/store'
import { configuredProviders, providerAvailability } from '../../../../utils/integrity/providers/registry'
import { callbackUrlFor } from '../webhookToken'
import type { CheckedDocument, IntegrityCheck } from '../../../../utils/integrity/types'

export const runtime = 'nodejs'
export const maxDuration = 60

/** Guards against a caller posting a book and running up someone's bill. */
const MAX_CHARACTERS = 400_000

/**
 * The history list must not ship provider payloads or flagged offsets — it is
 * rendered as a list of cards and the full record is a separate request.
 */
function toSummary(check: IntegrityCheck) {
  return {
    id: check.id,
    projectId: check.document.projectId,
    title: check.document.title,
    status: check.status,
    assessment: check.verdict?.assessment ?? null,
    headline: check.verdict?.headline ?? null,
    wordCount: check.wordCount,
    similarityPercentage: check.plagiarism?.similarityPercentage ?? null,
    ai: check.ai.map(result => ({
      provider: result.provider,
      aiProbability: result.aiProbability,
      status: result.status,
    })),
    reportGenerated: check.reportGenerated,
    createdAt: check.createdAt,
    completedAt: check.completedAt,
  }
}

export async function GET(req: NextRequest) {
  const owner = await resolveOwner(req)
  if (owner.unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId') || undefined

  try {
    const checks = await listChecks(owner.ownerKey, owner.supabase, { projectId })
    return NextResponse.json({
      checks: checks.map(toSummary),
      providers: providerAvailability(),
    })
  } catch (error) {
    console.error('Failed to list integrity checks:', error)
    return NextResponse.json({ error: 'Could not load your previous checks.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const owner = await resolveOwner(req)
  if (owner.unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    projectId?: string
    title?: string
    content?: string
    documentType?: string
    academicLevel?: string
    studentName?: string
    department?: string
    institution?: string
    /** Re-scan even if an identical document was already checked. */
    force?: boolean
    /** Use the providers' free test mode instead of spending credits. */
    sandbox?: boolean
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 })
  }

  if (!body.projectId || typeof body.content !== 'string') {
    return NextResponse.json(
      { error: 'A projectId and the document content are required.' },
      { status: 400 }
    )
  }

  const available = configuredProviders()
  if (!available.length) {
    return NextResponse.json(
      {
        error:
          'No integrity provider is configured on this deployment. Set COPYLEAKS_EMAIL and COPYLEAKS_API_KEY, or GPTZERO_API_KEY.',
      },
      { status: 501 }
    )
  }

  // Extracted here rather than trusting a word count from the browser: the
  // client's number decides what we tell the user, but this one decides what
  // we spend.
  const prepared = prepareDocument(body.content)

  if (prepared.characterCount < MIN_CHARACTERS) {
    return NextResponse.json(
      {
        error: `This document is too short to check. At least ${MIN_CHARACTERS} characters of text are needed; this one has ${prepared.characterCount}.`,
      },
      { status: 422 }
    )
  }

  if (prepared.characterCount > MAX_CHARACTERS) {
    return NextResponse.json(
      {
        error: `This document is too large to check in one pass (${prepared.characterCount.toLocaleString()} characters; the limit is ${MAX_CHARACTERS.toLocaleString()}). Check it a chapter at a time.`,
      },
      { status: 413 }
    )
  }

  // §21: an unchanged document does not get scanned twice.
  if (!body.force) {
    try {
      const cached = await findCachedCheck(
        owner.ownerKey,
        prepared.contentHash,
        available.map(p => p.id),
        owner.supabase
      )
      if (cached) {
        return NextResponse.json(
          {
            checkId: cached.id,
            cached: true,
            message:
              'This document has not changed since its last check, so the previous result is shown instead of running a new scan.',
            check: toSummary(cached),
          },
          { status: 200 }
        )
      }
    } catch (error) {
      // A cache miss is not a reason to refuse the scan the user asked for.
      console.warn('Integrity cache lookup failed; continuing with a fresh scan:', error)
    }
  }

  const document: CheckedDocument = {
    projectId: body.projectId,
    title: body.title?.trim() || 'Untitled document',
    documentType: body.documentType,
    academicLevel: body.academicLevel,
    studentName: body.studentName,
    department: body.department,
    institution: body.institution,
  }

  const check = createCheck(nanoid(16), owner.ownerKey, document, prepared)

  try {
    await saveCheck(check, owner.supabase)
  } catch (error) {
    console.error('Could not create the integrity check:', error)
    return NextResponse.json(
      { error: 'Could not start the integrity check. Storage is unavailable.' },
      { status: 503 }
    )
  }

  const supabase = owner.supabase
  const sandbox = body.sandbox === true
  const webhookUrl = callbackUrlFor(check.id) ?? undefined

  // Runs after the response is flushed, so the browser is not held open for
  // the length of a provider scan.
  after(async () => {
    try {
      await runCheck(check, prepared, supabase, { sandbox, webhookUrl })
    } catch (error) {
      console.error('Integrity run failed:', error)
      check.status = 'failed'
      check.error = 'Integrity check could not be completed. Please try again.'
      check.completedAt = Date.now()
      await saveCheck(check, supabase).catch(() => {})
    }
  })

  return NextResponse.json(
    {
      checkId: check.id,
      status: check.status,
      estimate: estimateUsage(prepared.wordCount),
      similarityAvailable: Boolean(webhookUrl),
    },
    { status: 202 }
  )
}
