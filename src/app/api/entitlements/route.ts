/**
 * The caller's plan and remaining credits.
 *
 *   GET  /api/entitlements                     -> the full snapshot
 *   POST /api/entitlements { action: 'check'   } -> may I? (writes nothing)
 *   POST /api/entitlements { action: 'consume' } -> charge one unit
 *
 * GET exists so the editor can grey out what the account cannot do instead of
 * letting someone start a full report and meet the paywall three seconds in.
 *
 * POST exists for the one metered feature that has no server route of its own:
 * PowerPoint decks are built entirely in the browser by `utils/pptxExporter`,
 * so there is no upstream call to hang a meter on. The client checks first,
 * builds, and charges on success — the same order the server-side routes use,
 * for the same reason: work that failed must not cost a credit.
 *
 * This makes the deck count an entitlement rather than a cost control. Someone
 * determined can build a deck without telling us. That is accepted: the deck
 * builder spends no provider credit, so the loss is a product-tier boundary and
 * not money. Every feature that DOES spend money is metered server-side, where
 * the browser cannot reach it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveOwner } from '../../../utils/owner'
import { METERED_FEATURES, PLANS, type MeteredFeature } from '../../../utils/plans'
import { checkFeature, commitUsage, getEntitlements } from '../../../utils/entitlements/service'

export const runtime = 'nodejs'

function isMeteredFeature(value: unknown): value is MeteredFeature {
  return typeof value === 'string' && (METERED_FEATURES as string[]).includes(value)
}

export async function GET(req: NextRequest) {
  const owner = await resolveOwner(req)

  if (owner.unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const snapshot = await getEntitlements(owner)
    // The catalogue rides along so the paywall dialog can name the plan that
    // unlocks what the user just tried, without a second request.
    return NextResponse.json({ entitlements: snapshot, plans: PLANS })
  } catch (error) {
    console.error('Could not resolve entitlements:', error)
    return NextResponse.json({ error: 'Could not load your plan details.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const owner = await resolveOwner(req)

  if (owner.unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { action?: string; feature?: string; projectId?: string; metadata?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 })
  }

  if (!isMeteredFeature(body.feature)) {
    return NextResponse.json({ error: 'Unknown feature.' }, { status: 400 })
  }

  if (owner.ownerKey === 'guest') {
    return NextResponse.json(
      {
        error: 'Sign in to use the AI features. Formatting and exporting stay free without an account.',
        code: 'signin_required',
      },
      { status: 401 }
    )
  }

  const action = body.action === 'consume' ? 'consume' : 'check'

  try {
    const decision = await checkFeature(owner, body.feature)

    if (!decision.allowed) {
      return NextResponse.json(
        {
          error: decision.message,
          code: decision.statusCode === 402 ? 'plan_required' : 'quota_exhausted',
          feature: body.feature,
          quota: decision.state,
          planTier: decision.snapshot.planTier,
        },
        { status: decision.statusCode }
      )
    }

    if (action === 'check') {
      return NextResponse.json({ allowed: true, quota: decision.state })
    }

    await commitUsage(decision.reservation!, owner, {
      projectId: body.projectId ?? null,
      metadata: body.metadata,
    })

    // Re-read rather than decrementing the snapshot we already have: the
    // client renders this number, and a locally-adjusted copy is exactly the
    // kind of thing that drifts from what the next check will decide.
    const snapshot = await getEntitlements(owner)
    return NextResponse.json({ allowed: true, entitlements: snapshot })
  } catch (error) {
    console.error('Entitlement action failed:', error)
    return NextResponse.json({ error: 'Could not verify your plan credits.' }, { status: 500 })
  }
}
