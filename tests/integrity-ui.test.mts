/**
 * Editor and dashboard wiring (source checks).
 *
 * React components are not rendered here — this repo has no DOM test harness —
 * so these assert against source text, the same way the deck and dashboard
 * suites already do. They are guardrails against silent regressions in wiring
 * and, more importantly, in the wording §13 makes a requirement rather than a
 * preference.
 *
 * Run: npm test
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8')

const editor = () => read('src/components/Editor/Editor.tsx')
const panel = () => read('src/components/Integrity/IntegrityPanel.tsx')
const dashboard = () => read('src/components/Integrity/IntegrityDashboard.tsx')

/* ── §13: how the rewriter is positioned ─────────────────────────── */

describe('the rewriter is not sold as a way to defeat detection', () => {
  /** Everything a user or a model could read. */
  const USER_FACING = [
    'src/components/Editor/Editor.tsx',
    'src/components/Mobile/MobileChatView.tsx',
    'src/components/Mobile/MobileDashboard.tsx',
    'src/components/Dashboard/Dashboard.tsx',
    'src/components/Integrity/IntegrityPanel.tsx',
    'src/components/Integrity/IntegrityDashboard.tsx',
    'src/utils/chatIntelligence.ts',
  ]

  it('no user-facing string promises bypassing or beating a detector', () => {
    const offenders: string[] = []

    for (const file of USER_FACING) {
      const source = read(file)
      for (const [index, line] of source.split('\n').entries()) {
        // The intent-detection regex in chatIntelligence matches what USERS
        // type; it is not the app making a promise, so it is exempt.
        if (/\\b\(humanize\|human/.test(line)) continue

        if (
          /bypass(ing)?\s+(ai|turnitin|detect)/i.test(line) ||
          /beat\s+ai/i.test(line) ||
          /pass(es)?\s+(turnitin|gptzero|ai\s+detect)/i.test(line) ||
          /anti[-\s]?ai[-\s]?detection/i.test(line) ||
          /undetectable/i.test(line)
        ) {
          // The comment explaining why we do not say this is not a violation.
          if (/Framing it as|forbid|must NOT|not positioned/i.test(line)) continue
          offenders.push(`${file}:${index + 1}  ${line.trim()}`)
        }
      }
    }

    assert.deepEqual(offenders, [], 'these strings position the tool as detector evasion')
  })

  it('the selection action is labelled for the writing, not the detector', () => {
    const source = editor()

    assert.ok(!source.includes('Humanize Selection (Bypass AI Detectors)'))
    assert.match(source, /Improve Originality of Selection/)
  })

  it('the rewrite prompt briefs a copyeditor rather than an evasion tool', () => {
    for (const file of ['src/components/Editor/Editor.tsx', 'src/utils/chatIntelligence.ts']) {
      const source = read(file)
      assert.ok(
        !/copyeditor specializing in bypassing AI detection/.test(source),
        `${file} still briefs the model to evade detection`
      )
    }
  })

  it('the dashboard keeps the user responsible for the final content', () => {
    assert.match(
      dashboard(),
      /responsible for reviewing and approving the final content/i
    )
  })
})

/* ── entry points ────────────────────────────────────────────────── */

describe('the editor offers an integrity check', () => {
  it('has a toolbar button that opens the dialog', () => {
    const source = editor()

    assert.match(source, /setShowIntegrityPanel\(true\)/)
    assert.match(source, /<span>Integrity<\/span>/)
  })

  it('offers the same action on mobile', () => {
    assert.match(editor(), /<span>Check Integrity<\/span>/)
  })

  it('mounts the dialog with a content getter rather than a snapshot', () => {
    const source = editor()

    // A snapshot would scan the document as it was when the toolbar rendered,
    // not as it is when the user presses the button.
    assert.match(source, /getContent=\{\(\) =>/)
    assert.match(source, /<IntegrityPanel/)
  })

  it('never starts a check automatically (§21)', () => {
    const source = editor()

    // The dialog is only ever opened by an explicit user action or an explicit
    // deep link — never from a content-change handler.
    const opens = [...source.matchAll(/setShowIntegrityPanel\(true\)/g)]
    assert.ok(opens.length > 0)

    // No submit call anywhere in the editor: only the dialog submits.
    assert.ok(!/submitIntegrityCheck/.test(source), 'the editor must not submit a scan itself')
  })

  it('runs a deep-linked action once and strips it from the URL', () => {
    const source = editor()

    assert.match(source, /action === 'improve-originality'/)
    assert.match(source, /params\.delete\('action'\)/)
    assert.match(source, /replaceState/)
  })
})

/* ── UX states (§26) ─────────────────────────────────────────────── */

describe('the dialog implements all four UX states', () => {
  it('covers idle, processing, completed and failed', () => {
    const source = panel()

    for (const phase of ['idle', 'processing', 'completed', 'failed']) {
      assert.match(source, new RegExp(`phase === '${phase}'`), `missing the ${phase} state`)
    }
  })

  it('shows the document size before anything is submitted', () => {
    const source = panel()

    assert.match(source, /Document size/)
    assert.match(source, /wordCount\.toLocaleString\(\)/)
    assert.match(source, /Run Integrity Check/)
  })

  it('renders a progress checklist rather than a bare spinner', () => {
    const source = panel()

    assert.match(source, /Preparing document/)
    assert.match(source, /Checking AI patterns/)
    assert.match(source, /Checking similarity/)
    assert.match(source, /Comparing results/)
    assert.match(source, /Generating report/)
  })

  it('offers both View Results and a PDF download when complete', () => {
    const source = panel()

    assert.match(source, /View Results/)
    assert.match(source, /downloadReport\(/)
    assert.match(source, /\/integrity\/\$\{check\.id\}/)
  })

  it('offers Try Again on failure and reassures the user their work is intact', () => {
    const source = panel()

    assert.match(source, /Try Again/)
    assert.match(source, /document has not been changed/i)
  })

  it('tells the user their document is not retained', () => {
    assert.match(panel(), /not stored by WordPI after the check completes/i)
  })
})

/* ── results dashboard (§11, §12) ────────────────────────────────── */

describe('the results dashboard', () => {
  it('shows both providers side by side in a comparison table', () => {
    const source = dashboard()

    assert.match(source, /Provider Comparison/)
    assert.match(source, /AI Result/)
    assert.match(source, /check\.ai\.map/)
  })

  it('separates AI indicators from similarity', () => {
    const source = dashboard()

    assert.match(source, /AI-Writing Indicators/)
    assert.match(source, />\s*Similarity\s*</)
  })

  it('never describes similarity as plagiarism', () => {
    const source = dashboard()

    assert.match(source, /Similarity means matching text, not plagiarism/i)
    assert.ok(!/Plagiarism confirmed/i.test(source))
  })

  it('states that AI scores are probabilistic, not proof', () => {
    assert.match(dashboard(), /not proof of how the text was written/i)
  })

  it('carries the required disclaimer', () => {
    const source = dashboard()

    assert.match(source, /probabilistic indicators/)
    assert.match(source, /do not independently establish plagiarism/)
    assert.match(source, /verify citations before submission/i)
  })

  it('lets a flagged passage be selected and explained', () => {
    const source = dashboard()

    assert.match(source, /Why this section was flagged/)
    assert.match(source, /AI probability/)
    assert.match(source, /reflects your own\s*\n?\s*understanding/i)
  })

  it('resolves flagged offsets locally rather than storing prose server-side', () => {
    const source = dashboard()

    // The privacy design: text comes from IndexedDB on this device, offsets
    // come from the server. Neither alone reconstructs the document.
    assert.match(source, /getAllProjects\(\)/)
    assert.match(source, /extractDocumentText\(/)
    assert.match(source, /documentText\.slice\(/)
  })

  it('degrades to a section summary when the document is not on this device', () => {
    assert.match(dashboard(), /device that holds it/i)
  })
})
