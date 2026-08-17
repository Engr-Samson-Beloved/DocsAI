/**
 * The Integrity Report PDF — generated server-side (§14).
 *
 * The app's existing PDF renderer (`utils/reactPdf.tsx`) is browser-only: it
 * registers fonts by fetching `window.location.origin/fonts/*.ttf`, which has
 * no meaning in a route handler. Rather than fork that module, this one reuses
 * the same engine (@react-pdf/renderer) and the same embedded Tinos family,
 * but loads the font files from disk. Same typeface, same house geometry, no
 * browser.
 *
 * Fonts are embedded rather than aliased to the PDF standard-14 faces for the
 * reason recorded in reactPdf.tsx: the standard-14 aliases are unembeddable by
 * definition, so the file renders differently on any machine lacking the font.
 * A report a student may hand to an examiner has to look the same everywhere.
 *
 * Design intent, per §18: this is an analysis document, not a marketing page.
 * One accent colour, used only to distinguish severity; everything else is
 * black on white with rules and whitespace doing the structural work.
 */

import React from 'react'
import fs from 'fs'
import path from 'path'
import {
  Document,
  Page,
  Text,
  View,
  Image,
  Font,
  StyleSheet,
  renderToBuffer,
} from '@react-pdf/renderer'
import { REPORT_STYLE } from '../houseStyle'
import type { IntegrityCheck } from './types'
import { assessmentLabel } from './engine'
// Pure shaping lives in a JSX-free module so the test suite can reach it —
// Node's type stripping cannot parse this file. See reportData.ts.
import {
  DISCLAIMER,
  categoryTotals,
  formatReportDate as formatDate,
  percent,
  providerLabel,
  statusLabel,
  summariseFlagged,
} from './reportData'

const BODY_FONT = 'Tinos'
const PT_PER_INCH = 72

const FONT_FILES = [
  { file: 'Tinos-Regular.ttf', fontWeight: 'normal' as const, fontStyle: 'normal' as const },
  { file: 'Tinos-Bold.ttf', fontWeight: 'bold' as const, fontStyle: 'normal' as const },
  { file: 'Tinos-Italic.ttf', fontWeight: 'normal' as const, fontStyle: 'italic' as const },
  { file: 'Tinos-BoldItalic.ttf', fontWeight: 'bold' as const, fontStyle: 'italic' as const },
]

let fontsRegistered = false

/**
 * Registers the embedded family from `public/fonts`.
 *
 * Fails loudly if the files are missing, matching reactPdf.tsx's stance: a
 * silent fallback to Helvetica is how a Times-set document ends up mixing two
 * typefaces, and it is better to have no report than a wrong-looking one.
 */
function ensureFonts(): void {
  if (fontsRegistered) return

  const fontDir = path.join(process.cwd(), 'public', 'fonts')
  const missing = FONT_FILES.filter(f => !fs.existsSync(path.join(fontDir, f.file)))
  if (missing.length) {
    throw new Error(
      `Cannot build the integrity report: ${missing.map(f => f.file).join(', ')} missing from public/fonts.`
    )
  }

  Font.register({
    family: BODY_FONT,
    fonts: FONT_FILES.map(f => ({
      src: path.join(fontDir, f.file),
      fontWeight: f.fontWeight,
      fontStyle: f.fontStyle,
    })),
  })
  fontsRegistered = true
}

/** The logo, inlined. Absent logo is not a reason to fail a report. */
function logoDataUri(): string | null {
  try {
    const file = path.join(process.cwd(), 'public', 'WordPI.png')
    if (!fs.existsSync(file)) return null
    return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`
  } catch {
    return null
  }
}

const INK = '#111111'
const MUTED = '#555555'
const RULE = '#BBBBBB'
const ACCENT = '#1F4E79'

/** Severity is the only place colour carries meaning. */
const TONE: Record<string, string> = {
  low_concern: '#1E7A3C',
  moderate_concern: '#9A6700',
  high_concern: '#A32020',
  provider_disagreement: '#9A6700',
  inconclusive: MUTED,
}

const styles = StyleSheet.create({
  page: {
    fontFamily: BODY_FONT,
    fontSize: 10.5,
    color: INK,
    paddingTop: REPORT_STYLE.page.marginIn.top * PT_PER_INCH,
    paddingBottom: REPORT_STYLE.page.marginIn.bottom * PT_PER_INCH,
    paddingLeft: REPORT_STYLE.page.marginIn.left * PT_PER_INCH,
    paddingRight: REPORT_STYLE.page.marginIn.right * PT_PER_INCH,
    lineHeight: 1.45,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  logo: { width: 22, height: 22, marginRight: 8 },
  brand: { fontSize: 15, fontWeight: 'bold', letterSpacing: 1.5 },
  reportTitle: { fontSize: 19, fontWeight: 'bold', marginTop: 10, letterSpacing: 0.5 },
  rule: { borderBottomWidth: 1.2, borderBottomColor: INK, marginTop: 8, marginBottom: 16 },
  hairline: { borderBottomWidth: 0.6, borderBottomColor: RULE, marginVertical: 10 },

  sectionHeading: {
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginTop: 18,
    marginBottom: 8,
  },
  subHeading: { fontSize: 10.5, fontWeight: 'bold', marginTop: 12, marginBottom: 4 },

  metaRow: { flexDirection: 'row', marginBottom: 3 },
  metaLabel: { width: 110, color: MUTED },
  metaValue: { flex: 1 },

  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  scoreName: { width: 120 },
  scoreValue: { width: 48, textAlign: 'right', fontWeight: 'bold' },
  barTrack: { flex: 1, height: 7, backgroundColor: '#E8E8E8', marginHorizontal: 10 },
  barFill: { height: 7 },

  verdictBox: {
    borderLeftWidth: 3,
    paddingLeft: 10,
    paddingVertical: 6,
    marginTop: 10,
    marginBottom: 4,
  },
  verdictHeadline: { fontSize: 11.5, fontWeight: 'bold' },
  verdictDetail: { fontSize: 10, color: MUTED, marginTop: 4 },

  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: INK,
    paddingBottom: 3,
    marginBottom: 4,
    fontWeight: 'bold',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#DDDDDD',
    paddingVertical: 4,
  },

  listItem: { flexDirection: 'row', marginBottom: 5 },
  listMarker: { width: 16 },
  listBody: { flex: 1 },

  disclaimerBox: {
    marginTop: 18,
    borderWidth: 0.8,
    borderColor: RULE,
    padding: 10,
  },
  disclaimerTitle: { fontSize: 9.5, fontWeight: 'bold', letterSpacing: 0.8, marginBottom: 4 },
  disclaimer: { fontSize: 9, color: MUTED, lineHeight: 1.5 },

  footer: {
    position: 'absolute',
    bottom: 26,
    left: REPORT_STYLE.page.marginIn.left * PT_PER_INCH,
    right: REPORT_STYLE.page.marginIn.right * PT_PER_INCH,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 8,
    color: MUTED,
  },
})

const Footer = ({ reportId }: { reportId: string }) => (
  <View style={styles.footer} fixed>
    <Text>WordPI Integrity Report · {reportId}</Text>
    <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
  </View>
)

const MetaRow = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.metaRow}>
    <Text style={styles.metaLabel}>{label}</Text>
    <Text style={styles.metaValue}>{value}</Text>
  </View>
)

/** A labelled bar. The visual summary §15 asks for, kept deliberately plain. */
const ScoreBar = ({
  name,
  value,
  colour,
}: {
  name: string
  value: number | null
  colour: string
}) => (
  <View style={styles.scoreRow}>
    <Text style={styles.scoreName}>{name}</Text>
    <View style={styles.barTrack}>
      <View
        style={[
          styles.barFill,
          { width: `${value === null ? 0 : Math.round(value * 100)}%`, backgroundColor: colour },
        ]}
      />
    </View>
    <Text style={styles.scoreValue}>{percent(value)}</Text>
  </View>
)

function ReportDocument({ check, logo }: { check: IntegrityCheck; logo: string | null }) {
  const { document: doc, verdict, plagiarism } = check
  const tone = TONE[verdict?.assessment ?? 'inconclusive'] ?? MUTED
  const flaggedSections = check.ai.flatMap(result => result.sections ?? [])

  // Extra pages only when they would carry real content (§17).
  const showSimilarityPage =
    plagiarism !== null && (plagiarism.status === 'completed' || plagiarism.sources.length > 0)
  const showAiDetailPage = check.ai.length > 0

  return (
    <Document
      title={`WordPI Integrity Report — ${doc.title}`}
      author="WordPI"
      subject="Document integrity analysis"
    >
      {/* ── Page 1 — executive summary ───────────────────────────── */}
      <Page size="A4" style={styles.page}>
        <View style={styles.brandRow}>
          {/*
            This is @react-pdf's Image primitive, not an <img>: it draws into a
            PDF and has no alt prop to give it. The wordmark beside it carries
            the same information for anyone reading the text layer.
          */}
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          {logo ? <Image style={styles.logo} src={logo} /> : null}
          <Text style={styles.brand}>WORDPI</Text>
        </View>
        <Text style={styles.reportTitle}>DOCUMENT INTEGRITY REPORT</Text>
        <View style={styles.rule} />

        <MetaRow label="Document" value={doc.title || 'Untitled document'} />
        {doc.studentName ? <MetaRow label="Student" value={doc.studentName} /> : null}
        {doc.department ? <MetaRow label="Department" value={doc.department} /> : null}
        {doc.institution ? <MetaRow label="Institution" value={doc.institution} /> : null}
        {doc.documentType ? <MetaRow label="Document type" value={doc.documentType} /> : null}
        {doc.academicLevel ? <MetaRow label="Level" value={doc.academicLevel} /> : null}
        <MetaRow label="Checked" value={formatDate(check.completedAt ?? check.createdAt)} />
        <MetaRow label="Report ID" value={check.id} />
        <MetaRow label="Analysed" value={`${check.wordCount.toLocaleString()} words`} />

        <Text style={styles.sectionHeading}>INTEGRITY SUMMARY</Text>

        <Text style={styles.subHeading}>AI-writing indicators</Text>
        {check.ai.length ? (
          check.ai.map(result => (
            <ScoreBar
              key={result.provider}
              name={providerLabel(result.provider)}
              value={result.aiProbability}
              colour={tone}
            />
          ))
        ) : (
          <Text style={{ color: MUTED }}>No AI detection was performed.</Text>
        )}

        <Text style={styles.subHeading}>Similarity</Text>
        {plagiarism && plagiarism.status === 'completed' ? (
          <ScoreBar
            name="Matching text"
            value={plagiarism.similarityPercentage / 100}
            colour={ACCENT}
          />
        ) : (
          <Text style={{ color: MUTED }}>
            {plagiarism?.error || 'Similarity analysis was not performed for this document.'}
          </Text>
        )}

        {verdict ? (
          <View style={[styles.verdictBox, { borderLeftColor: tone }]}>
            <Text style={styles.verdictHeadline}>
              WordPI assessment: {assessmentLabel(verdict.assessment)}
            </Text>
            <Text style={[styles.verdictDetail, { color: INK }]}>{verdict.headline}</Text>
            {verdict.detail.map((line, i) => (
              <Text key={i} style={styles.verdictDetail}>
                {line}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={styles.disclaimerBox}>
          <Text style={styles.disclaimerTitle}>IMPORTANT</Text>
          <Text style={styles.disclaimer}>{DISCLAIMER}</Text>
        </View>

        <Footer reportId={check.id} />
      </Page>

      {/* ── Page 2 — AI detection analysis ───────────────────────── */}
      {showAiDetailPage ? (
        <Page size="A4" style={styles.page}>
          <Text style={styles.sectionHeading}>AI DETECTION ANALYSIS</Text>
          <View style={styles.hairline} />

          <View style={styles.tableHeader}>
            <Text style={{ flex: 2 }}>Provider</Text>
            <Text style={{ flex: 1, textAlign: 'right' }}>AI indicators</Text>
            <Text style={{ flex: 1, textAlign: 'right' }}>Words analysed</Text>
            <Text style={{ flex: 1, textAlign: 'right' }}>Status</Text>
          </View>

          {check.ai.map(result => (
            <View style={styles.tableRow} key={result.provider}>
              <Text style={{ flex: 2 }}>{providerLabel(result.provider)}</Text>
              <Text style={{ flex: 1, textAlign: 'right' }}>{percent(result.aiProbability)}</Text>
              <Text style={{ flex: 1, textAlign: 'right' }}>
                {result.analyzedWords.toLocaleString()}
              </Text>
              <Text style={{ flex: 1, textAlign: 'right' }}>{statusLabel(result.status)}</Text>
            </View>
          ))}

          {verdict?.spreadPoints !== null && verdict?.spreadPoints !== undefined ? (
            <>
              <Text style={styles.subHeading}>Provider agreement</Text>
              <Text>
                The two detectors differ by {verdict.spreadPoints} percentage points.
                {verdict.assessment === 'provider_disagreement'
                  ? ' This is wide enough that the results do not describe the same document, so no combined score is given and manual review is recommended.'
                  : ' They are close enough to support the same reading of the document.'}
              </Text>
            </>
          ) : null}

          {check.ai.some(r => r.error) ? (
            <>
              <Text style={styles.subHeading}>Provider notes</Text>
              {check.ai
                .filter(r => r.error)
                .map(r => (
                  <Text key={r.provider} style={{ color: MUTED }}>
                    {providerLabel(r.provider)}: {r.error}
                  </Text>
                ))}
            </>
          ) : null}

          <Text style={styles.subHeading}>
            Flagged passages ({flaggedSections.length})
          </Text>
          {flaggedSections.length ? (
            <>
              <Text style={{ color: MUTED, marginBottom: 6 }}>
                Passages the detectors associated with AI-generated writing, listed by the
                section they appear in. Review each one and confirm it reflects your own
                understanding.
              </Text>
              {summariseFlagged(flaggedSections).map((entry, i) => (
                <View style={styles.tableRow} key={i}>
                  <Text style={{ flex: 3 }}>{entry.section}</Text>
                  <Text style={{ flex: 1, textAlign: 'right' }}>{entry.count} passage(s)</Text>
                  <Text style={{ flex: 1, textAlign: 'right' }}>{entry.peak}</Text>
                </View>
              ))}
            </>
          ) : (
            <Text style={{ color: MUTED }}>
              No individual passages were returned at sentence level for this document.
            </Text>
          )}

          <Footer reportId={check.id} />
        </Page>
      ) : null}

      {/* ── Page 3 — similarity analysis ─────────────────────────── */}
      {showSimilarityPage && plagiarism ? (
        <Page size="A4" style={styles.page}>
          <Text style={styles.sectionHeading}>SIMILARITY ANALYSIS</Text>
          <View style={styles.hairline} />

          <Text>
            Overall matching text: {plagiarism.similarityPercentage}% (
            {plagiarism.matchedWords.toLocaleString()} words)
          </Text>
          <Text style={{ color: MUTED, marginTop: 4 }}>
            Matching text is not by itself evidence of plagiarism. A match may be a correctly
            cited quotation, a reference entry, standard academic phrasing or common
            terminology.
          </Text>

          {categoryTotals(plagiarism.sources).length ? (
            <>
              <Text style={styles.subHeading}>By source category</Text>
              {categoryTotals(plagiarism.sources).map(entry => (
                <View style={styles.tableRow} key={entry.label}>
                  <Text style={{ flex: 3 }}>{entry.label}</Text>
                  <Text style={{ flex: 1, textAlign: 'right' }}>
                    {entry.value.toFixed(1)}%
                  </Text>
                </View>
              ))}
            </>
          ) : null}

          {plagiarism.sources.length ? (
            <>
              <Text style={styles.subHeading}>Top matching sources</Text>
              <View style={styles.tableHeader}>
                <Text style={{ flex: 4 }}>Source</Text>
                <Text style={{ flex: 1, textAlign: 'right' }}>Match</Text>
              </View>
              {plagiarism.sources.slice(0, 15).map((source, i) => (
                <View style={styles.tableRow} key={i} wrap={false}>
                  <View style={{ flex: 4 }}>
                    <Text>{source.title || source.url || 'Untitled source'}</Text>
                    {source.url ? (
                      <Text style={{ fontSize: 8, color: MUTED }}>{source.url}</Text>
                    ) : null}
                  </View>
                  <Text style={{ flex: 1, textAlign: 'right' }}>
                    {source.similarityPercentage !== undefined
                      ? `${source.similarityPercentage.toFixed(1)}%`
                      : `${source.matchedWords ?? 0} words`}
                  </Text>
                </View>
              ))}
            </>
          ) : (
            <Text style={{ color: MUTED, marginTop: 8 }}>
              No matching sources were returned for this document.
            </Text>
          )}

          <Footer reportId={check.id} />
        </Page>
      ) : null}

      {/* ── Page 4 — recommendations ─────────────────────────────── */}
      {verdict?.recommendations.length ? (
        <Page size="A4" style={styles.page}>
          <Text style={styles.sectionHeading}>RECOMMENDATIONS</Text>
          <View style={styles.hairline} />

          {verdict.recommendations.map((recommendation, i) => (
            <View style={styles.listItem} key={i}>
              <Text style={styles.listMarker}>{i + 1}.</Text>
              <Text style={styles.listBody}>{recommendation}</Text>
            </View>
          ))}

          <View style={styles.disclaimerBox}>
            <Text style={styles.disclaimerTitle}>IMPORTANT</Text>
            <Text style={styles.disclaimer}>{DISCLAIMER}</Text>
          </View>

          <Text style={[styles.disclaimer, { marginTop: 14 }]}>
            {/*
              Stamped from the check's own completion time, not from the clock
              at render. The report describes when the analysis ran; re-reading
              the clock here would also make the render impure.
            */}
            Generated by WordPI on {formatDate(check.completedAt ?? check.createdAt)}. This report
            describes an automated analysis of the text submitted at that time; editing the
            document afterwards invalidates these results.
          </Text>

          <Footer reportId={check.id} />
        </Page>
      ) : null}
    </Document>
  )
}

/**
 * Renders the report to PDF bytes.
 *
 * Returns a Uint8Array rather than a stream because the caller stores it before
 * anyone downloads it — §25 requires the file be generated once, not rebuilt on
 * every download.
 */
export async function generateReportPdf(check: IntegrityCheck): Promise<Uint8Array> {
  ensureFonts()
  const buffer = await renderToBuffer(<ReportDocument check={check} logo={logoDataUri()} />)
  return new Uint8Array(buffer)
}
