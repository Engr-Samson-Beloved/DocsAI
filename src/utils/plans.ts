/**
 * The plan catalogue and its quotas — the single source of truth for what a
 * subscriber is entitled to.
 *
 * Deliberately dependency-free so both halves of the app can import it: the
 * server reads it to decide whether to spend an upstream API call, and the
 * pricing screens read it to describe what is being sold. Two copies of these
 * numbers would drift, and the drift would show up as a page advertising four
 * decks while the server allowed three.
 *
 * WHAT IS AND IS NOT METERED
 *
 * Formatting is free and unmetered for everyone — importing, styling, paginating
 * and exporting a document costs us nothing and never touches a model, so none
 * of it is gated. What is metered is exactly the work that spends money at an
 * upstream provider: Gemini/Groq/Grok generations, GhostWriter rewrites, and
 * Copyleaks/GPTZero scans. A free account can format all day and cannot prompt
 * a model at all, with one exception noted below.
 *
 * THE FREE INTEGRITY CHECK
 *
 * `free.integrity` is 1 rather than 0 on purpose: an AI-detection score is the
 * thing that convinces someone the product is worth paying for, so every account
 * gets one per month to see it work.
 */

export type PlanTier = 'free' | 'basic' | 'pro' | 'enterprise'

/**
 * A unit of paid work.
 *
 *   report      one full report / AI blueprint generation (the wizard's
 *               "Generate with AI" path — a whole multi-chapter document)
 *   humanize    one document rewrite through the Humanizer
 *   powerpoint  one AI-assisted deck build
 *   integrity   one plagiarism / AI-detection scan
 *   assist      one small in-editor AI action: rephrase, chat turn, section
 *               rewrite, reference lookup. Cheap individually, so it is capped
 *               per DAY rather than per cycle — see PERIODS below.
 */
export type MeteredFeature = 'report' | 'humanize' | 'powerpoint' | 'integrity' | 'assist'

export const METERED_FEATURES: MeteredFeature[] = [
  'report',
  'humanize',
  'powerpoint',
  'integrity',
  'assist',
]

/**
 * The window a quota is counted over.
 *
 * `cycle` resets when a subscription is paid for, so a renewal hands back a full
 * set of credits; for a free account it falls back to the calendar month.
 * `day` resets at midnight UTC.
 */
export type QuotaPeriod = 'cycle' | 'day'

export const FEATURE_PERIOD: Record<MeteredFeature, QuotaPeriod> = {
  report: 'cycle',
  humanize: 'cycle',
  powerpoint: 'cycle',
  integrity: 'cycle',
  assist: 'day',
}

export const FEATURE_LABELS: Record<MeteredFeature, string> = {
  report: 'Full report generation',
  humanize: 'Document humanizing',
  powerpoint: 'PowerPoint generation',
  integrity: 'Integrity / AI-detection check',
  assist: 'In-editor AI edits',
}

export type PlanQuotas = Record<MeteredFeature, number>

export interface PlanDefinition {
  tier: PlanTier
  name: string
  /** Naira, charged per 30-day cycle. */
  amount: number
  tagline: string
  quotas: PlanQuotas
  /** Bullet points for the pricing cards, derived from `quotas` where sensible. */
  features: string[]
}

/**
 * Quotas per cycle (per day for `assist`).
 *
 * The ladder the pricing is built on: ₦15,000 is one unit, ₦30,000 is two of
 * everything, ₦50,000 is three. Changing a number here changes the paywall, the
 * pricing page and the admin dashboard together.
 */
export const PLANS: Record<PlanTier, PlanDefinition> = {
  free: {
    tier: 'free',
    name: 'Free',
    amount: 0,
    tagline: 'Unlimited formatting. AI generation needs a plan.',
    quotas: { report: 0, humanize: 0, powerpoint: 0, integrity: 1, assist: 0 },
    features: [
      'Unlimited document formatting & styling',
      'Import DOCX / PDF, paginate, restyle',
      'Unlimited DOCX & PDF export',
      '1 integrity check per month',
      'No AI writing, humanizing or deck generation',
    ],
  },
  basic: {
    tier: 'basic',
    name: 'Base Plan',
    amount: 15000,
    tagline: 'Everything you need for one full project.',
    quotas: { report: 2, humanize: 2, powerpoint: 4, integrity: 3, assist: 100 },
    features: [
      'Write 2 full reports with AI',
      'Humanize 2 documents',
      '4 PowerPoint generations',
      '3 integrity / AI-detection checks',
      '100 in-editor AI edits per day',
      'Unlimited formatting & exports',
    ],
  },
  pro: {
    tier: 'pro',
    name: 'Pro Plan',
    amount: 30000,
    tagline: 'Double the base plan, across the board.',
    quotas: { report: 4, humanize: 4, powerpoint: 8, integrity: 6, assist: 200 },
    features: [
      'Write 4 full reports with AI',
      'Humanize 4 documents',
      '8 PowerPoint generations',
      '6 integrity / AI-detection checks',
      '200 in-editor AI edits per day',
      'Unlimited formatting & exports',
    ],
  },
  enterprise: {
    tier: 'enterprise',
    name: 'Elite Plan',
    amount: 50000,
    tagline: 'Triple the base plan, for full research workloads.',
    quotas: { report: 6, humanize: 6, powerpoint: 12, integrity: 10, assist: 300 },
    features: [
      'Write 6 full reports with AI',
      'Humanize 6 documents',
      '12 PowerPoint generations',
      '10 integrity / AI-detection checks',
      '300 in-editor AI edits per day',
      'Unlimited formatting & exports',
      'Priority model failover (Gemini, Groq, Grok)',
    ],
  },
}

/** The tiers that can actually be bought, in display order. */
export const PAID_TIERS: Exclude<PlanTier, 'free'>[] = ['basic', 'pro', 'enterprise']

export function isPaidTier(tier: string): tier is Exclude<PlanTier, 'free'> {
  return (PAID_TIERS as string[]).includes(tier)
}

export function planFor(tier: string | null | undefined): PlanDefinition {
  if (tier && tier in PLANS) return PLANS[tier as PlanTier]
  return PLANS.free
}

/** Naira for a tier, or 0 for anything unrecognised. */
export function amountForTier(tier: string): number {
  return isPaidTier(tier) ? PLANS[tier].amount : 0
}

/**
 * The tier a payment of `amount` bought.
 *
 * Used when Korapay hands back a charge whose metadata lost the plan name.
 * Matches downward — someone who paid ₦30,000 gets Pro, not Base — and refuses
 * to guess above what was actually paid.
 */
export function tierForAmount(amount: number): PlanTier {
  if (amount >= PLANS.enterprise.amount) return 'enterprise'
  if (amount >= PLANS.pro.amount) return 'pro'
  if (amount >= PLANS.basic.amount) return 'basic'
  return 'free'
}

/** How long a paid cycle lasts. */
export const CYCLE_DAYS = 30

/** Naira, formatted the way the pricing page and admin dashboard both show it. */
export function formatNaira(amount: number): string {
  return `₦${amount.toLocaleString('en-NG')}`
}

/* ── owner accounts ───────────────────────────────────────────────── */

/**
 * The accounts that own this deployment, and are metered by nothing.
 *
 * Configured with OWNER_EMAILS (comma-separated), defaulting to ADMIN_EMAIL so
 * the person who runs the dashboard does not also have to buy a plan to use
 * their own product.
 *
 * Server-side only by construction: neither variable is NEXT_PUBLIC_, so this
 * returns an empty list in the browser and no client can decide it is an owner.
 * That is deliberate — see `isOwnerEmail`.
 */
export function ownerEmails(): string[] {
  const raw = process.env.OWNER_EMAILS || process.env.ADMIN_EMAIL || ''
  return raw
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Whether this address owns the deployment.
 *
 * CALLERS MUST HAVE VERIFIED THE ADDRESS FIRST. This compares strings; it does
 * not authenticate. The only safe input is the email on a confirmed Supabase
 * session (`user:` in utils/owner.ts). An offline `local:` token carries its own
 * email in its body, so passing one of those here would let anybody mint
 * `local-token-<base64 of the owner address>` and take unlimited access.
 * `service.ts:resolveOwnerAccess` is the one caller and enforces that.
 */
export function isOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return ownerEmails().includes(email.trim().toLowerCase())
}
