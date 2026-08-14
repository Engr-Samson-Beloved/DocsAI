/**
 * claims.ts
 * ------------------------------------------------------------------
 * The single test a bullet must pass: read aloud on its own, is it a statement
 * someone could agree or disagree with?
 *
 * Why this module exists
 * ----------------------
 * The 14-word cap was being satisfied by cutting sentences short - the defect
 * wearing a passing grade. "Begins by defining the problem" and "Firewalls,
 * load balancers, intrusion detection systems" are both inside every limit and
 * neither is a claim. One is the document talking about itself with its subject
 * removed; the other is a shopping list.
 *
 * `isCompleteClaim` is deliberately stricter than the old bullet lint, and it
 * is enforced at BOTH ends: the summariser will not emit a bullet that fails
 * it, and the QA gate fails the build if one somehow reaches a slide.
 */

import { hasFiniteVerb, wordCount } from './textNormalize'
import { hasSectionNumber } from './documentParts'

export type ClaimProblem =
  | 'empty'
  | 'no-finite-verb'
  | 'starts-conjunction'
  | 'starts-gerund'
  | 'starts-lowercase'
  | 'bare-noun-list'
  | 'dangling-end'
  | 'section-number'
  | 'duplicate-subject'
  | 'too-long'
  | 'contains-newline'
  | 'document-subject'

export interface ClaimOptions {
  maxWords?: number
  /** Head noun phrases already used on this deck, for the repetition check. */
  usedSubjects?: Set<string>
}

const OPENING_CONJUNCTION =
  /^(and|but|or|nor|yet|so|because|although|though|whereas|while|since|unless|until|whether|thus|hence|therefore|however|moreover|furthermore)\b/i

/**
 * A sentence whose subject is the DOCUMENT rather than the topic, including the
 * decapitated form left when the subject is stripped: "Begins by defining the
 * problem", "Covers the theoretical foundations", "Examines three approaches".
 */
const DOCUMENT_SUBJECT =
  /^(begins|opens|starts|presents|discusses|describes|examines|explores|covers|outlines|introduces|reviews|concludes|summari[sz]es|considers|investigates)\b/i

/** Verb-initial is fine; a bare -ing opener without a subject is not. */
const GERUND_OPENER = /^(\w+ing)\b/i

/** -ing words that are ordinary nouns or adjectives, not gerund openers. */
const NOUN_ING =
  /^(networking|engineering|computing|training|building|monitoring|switching|routing|scheduling|manufacturing|marketing|accounting|processing|learning|meaning|morning|evening|string|thing|being|during|nothing|something)$/i

/**
 * The head noun phrase: the words before the first finite verb.
 * Used to stop two bullets on a slide making the same subject twice.
 */
export function headSubject(text: string): string {
  const words = text.replace(/[^\w\s-]/g, ' ').split(/\s+/).filter(Boolean)
  const head: string[] = []

  for (const w of words) {
    if (hasFiniteVerb(w)) break
    head.push(w.toLowerCase())
    if (head.length >= 4) break
  }

  return head
    .filter(w => !/^(the|a|an|this|that|these|those|its|their|of|and|or|in|for|on|with|by|to)$/.test(w))
    .join(' ')
}

/**
 * Returns every reason a bullet is not a presentable claim.
 * An empty array means it may go on a slide.
 */
export function isCompleteClaim(text: string, options: ClaimOptions = {}): ClaimProblem[] {
  const { maxWords = 14, usedSubjects } = options
  const problems: ClaimProblem[] = []
  const s = (text ?? '').trim()

  if (!s) return ['empty']

  if (/[\r\n]/.test(text)) problems.push('contains-newline')
  if (hasSectionNumber(s)) problems.push('section-number')
  if (wordCount(s) > maxWords) problems.push('too-long')
  if (/[,;\-–—:]$/.test(s)) problems.push('dangling-end')
  if (/^[a-z]/.test(s)) problems.push('starts-lowercase')
  if (OPENING_CONJUNCTION.test(s)) problems.push('starts-conjunction')
  if (DOCUMENT_SUBJECT.test(s)) problems.push('document-subject')

  const gerund = s.match(GERUND_OPENER)
  if (gerund && !NOUN_ING.test(gerund[1])) problems.push('starts-gerund')

  if (!hasFiniteVerb(s)) {
    problems.push('no-finite-verb')
    // A verbless run of comma-separated phrases is specifically a noun list.
    if ((s.match(/,/g) ?? []).length >= 1) problems.push('bare-noun-list')
  }

  if (usedSubjects) {
    const subject = headSubject(s)
    if (subject && subject.length > 3 && usedSubjects.has(subject)) {
      problems.push('duplicate-subject')
    }
  }

  return problems
}

export function isClaim(text: string, options: ClaimOptions = {}): boolean {
  return isCompleteClaim(text, options).length === 0
}

/**
 * The rewrite-and-verify loop.
 *
 * `compress` is asked for a claim at successive word budgets and the result is
 * VERIFIED each time; nothing is ever truncated to fit. The budgets are tried
 * ideal-first, then the full cap, then tighter.
 *
 * A note on the order, because it is not what the brief literally prescribes.
 * Retrying only at LOWER budgets assumes the summariser can rewrite more
 * densely on demand - true of a model, false of a rule-based compressor, which
 * responds to a smaller budget by refusing outright. So the second attempt
 * gives it MORE room, up to the hard cap, which is what actually rescues a
 * sentence; the third tries tighter. The invariant the brief cares about holds
 * either way: every candidate is verified, and a failing one is dropped rather
 * than shipped.
 */
export function rewriteUntilClaim(
  compress: (wordBudget: number) => string,
  options: {
    idealWords: number
    maxWords: number
    usedSubjects?: Set<string>
  }
): string {
  const { idealWords, maxWords, usedSubjects } = options
  const budgets = [idealWords, maxWords, Math.max(6, idealWords - 2)]

  for (const budget of budgets) {
    const candidate = compress(budget)
    if (!candidate) continue
    if (isClaim(candidate, { maxWords, usedSubjects })) return candidate
  }

  return ''
}
