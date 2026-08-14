# PPTX generator: defect analysis and fixes

Source: `sample/PRINCEWILL SEMINAR(SDN).pdf`
Regenerated deck: `out/llm-sdn/princewill_seminar_sdn_.pptx` (15 slides)
Rendered images: `out/llm-sdn/slides/slide-01.jpg` … `slide-15.jpg`

---

## 0. Which deck each number was measured on

The earlier draft of this report mixed figures from two different artifacts. Corrected:

- **The brief's reference bad output, `princewill_seminar_sdn_.pptx`, is not in this
  repository and never was.** I never measured it. Every "before" figure below
  comes from `sample/Word_PI_Gen/samson123456.pptx`, a different deck from the
  same generator.
- **My regenerated deck has the same filename by coincidence** — the stem is
  derived from the source PDF's name, which is what the old generator did too.
  `out/llm-sdn/princewill_seminar_sdn_.pptx` is my output; it is not the brief's
  artifact.
- **"13 of 13 identical slides" and the hard-coded "n / 13" counter are quoted
  from the brief**, describing that unavailable file. On the artifact I do have,
  the equivalent measured figures are 15 slides in 4 distinct layouts, with 8
  slides sharing one identical geometry.
- A **second generator artifact** turned up during this work:
  `Seminar_Patterns/ai-based_performance_optimization_in_modern_laptops.pptx`.
  It shows the same defects independently, which rules out the first being a
  one-off.

All figures below are produced by `scripts/inspect_pptx.mts`, which reads the
OOXML directly and knows nothing about the code that wrote it.

| Measure | `samson123456.pptx` (generator) | `ai-based_…pptx` (generator) | **My output** | `Smart_Energy…pptx` (accredited human deck) |
|---|---|---|---|---|
| Slide size | 10.000 × 5.625 in | 10.000 × 5.625 in | **13.333 × 7.500** | 13.333 × 7.500 |
| Slides | 15 | 11 | 15 | 15 |
| Shapes off-canvas | 66 | 42 | **0** | 0 |
| Newlines inside runs | 66 | 99 | **0** | 0 |
| Slides with ≥25 words of notes | 0 / 15 | 0 / 11 | **15 / 15** (838 words) | 12 / 15 |
| Slides containing a real `<a:tbl>` | 0 | 0 | **1** | 2 |
| Distinct layouts | 4 / 15 | 3 / 11 | **9 / 15** | 15 / 15 |
| Largest group sharing one geometry | 8 | 9 | **7** | 1 |
| Non-bullet content layouts | — | — | **5 / 13** | — |

Two things that table makes plain and I should not gloss:

- **The notes figure needed care.** Both generator decks have a full set of
  `notesSlide` parts containing **zero words**. pptxgenjs writes the part whether
  or not `addNotes` is called, so a part-count check passes a deck with no notes
  at all. My own check 10 had that hole until I measured the old deck. It now
  counts words.
- **My deck is still visibly more repetitive than the accredited one.** 9
  distinct layouts against 15, and 7 slides sharing one body geometry against 1.
  Better than the 4/15 it replaces, not equal to the reference.

---

## 1. Root causes

### A1 — Canvas mismatch (fatal)

Every coordinate was measured against 13.333 × 7.5 in, but pptxgenjs was left on
its default `LAYOUT_16x9` preset, which is 10 × 5.625 in. **Root cause:** geometry
had no owner — coordinates were literals spread through the renderer, so nothing
could compare them to the canvas.

**Fix:** `deck/layout.ts` owns the canvas and every derived box; `assertOnCanvas`
runs on every shape before it is added. A test asserts the renderer contains no
literal geometry, colours or font sizes.

### A2 — Phantom empty bullets

Each bullet was emitted as `text: b.text + '\n'`. With `bullet: true` on the
paragraph, the trailing newline created a second, **empty bulleted paragraph**
between every real one.

**Fix:** list items are separate entries with `breakLine`; every string is
newline-stripped at the recorder boundary. The package check greps the emitted
XML for `<a:t>…\n…</a:t>` — verified to fail both old decks.

### A3 — Overflow never modelled

`<a:normAutofit/>` was emitted with no `fontScale`, so nothing shrank.

**Fix:** `fitBudget.ts` estimates height before rendering and escalates
compress → font step → split → autofit, logging the lever pulled.

> **Deviation, deliberate.** The brief's formula
> `ceil(len / floor(boxWidthIn * 96 / (fontPt * 0.5)))` mixes units — inches × 96
> divided by a width in points — making it ~33% optimistic. An optimistic
> overflow guard is worse than none. The conversion is corrected to `/72`.
> Planner and gate call the same function, so they cannot disagree.

### A4 — Style-guide violations

Accent bar, vertical stripe, subtitle rule, one repeated layout, and
`"WordPIlot Seminar Presentation | …"` in every footer.

**Fix:** all decoration removed; grouping carried by tint and whitespace. Footer
is caller-supplied and defaults to empty; `wordpi` is a banned string.

### A5 — Typography hard-coded

**Fix:** `presentationSpec.ts` holds the standard as swappable data, validated at
load — a body size under the floor is rejected, and every text/background pair
has its WCAG contrast **computed** against 4.5:1.

### B1 — The extractor sliced PDF *lines*, not sentences

`extractPdfAsHtml` started a new paragraph on any Y move greater than 5 units.
That is a **new line, not a new paragraph**, so every wrapped line became its own
`<p>` and then its own bullet.

**Fix:** `pdfStructure.ts` rebuilds runs → lines → blocks from font size,
indentation and vertical rhythm; `textNormalize.ts` de-hyphenates, rejoins and
segments with `Intl.Segmenter`.

| Before (shipped) | After |
|---|---|
| "…occurs when the volume of data attempting" | "…occurs when the volume of data attempting **to traverse a network link or node exceeds its capacity.**" |
| "Globe have explored SDN from multiple angles —" | "**Since then, researchers across the globe have** explored SDN from multiple angles — …" |

### B2 — Extraction, not summarisation

**Fix:** `summarize.ts` compresses each sentence to ≤14 words and **refuses to cut
mid-thought** — if there is no honest shortening it returns nothing and another
sentence is chosen. `slidePlan.ts` validates and repairs; `llmSummarize.ts`
layers Gemini on top (§3).

### B3 — Structure and labelling

**Fix:** the planner was inverted — sections that exist produce slides; sections
that do not produce nothing. Every slide carries `sourceRefs`, its eyebrow is
*derived* from them, and `eyebrowMismatch` fails the build on disagreement.
Cover metadata is parsed and returns `null` for what it cannot find; **there is
no filename fallback anywhere.**

### B4 — Tables, figures, references

**Fix:** tables detected from column gaps and rendered with `addTable`; contrast
pairs the document itself draws merge into a `comparison`, with their tables
harvested onto their own slides; sequences become shape-based `process`
diagrams; citations shortened to "Author (year) — title", dropped rather than
truncated.

### B5 — Speaker notes empty

**Fix:** notes generated per slide and attached via `addNotes` only.

---

## 2. Visual QA — done

LibreOffice 26.2.5.2 and poppler 25.07.0 installed via winget; all 15 slides
converted and **inspected individually**. This found nine defects that every
static check had passed.

| # | What the image showed | Fix |
|---|---|---|
| 1 | **References slide was wrong in four ways**: one citation rendered as three fragments ("…44(2), 87–" / "98. https://doi.org/…"), a stray "(Listed in APA 7th Edition format)" as if it were a source, and an author shown as "B." | Reference text is now joined into one blob *before* splitting, so hanging indents can be reassembled; the entry boundary uses a lookbehind so it cannot fire inside an author list; `shortenCitation` rejects anything without an author-year instead of passing it through |
| 2 | **Process cards stretched to fill the body box** — three cards 1.7 in tall holding two lines each, a third of every card empty | Card height derived from content and the stack centred |
| 3 | **Step bodies were severed fragments** — "Called the infrastructure layer, consists of…", "Known as the control layer, is embodied by…" | `predicateOf` strips the appositive and the linking verb so the body starts on the verb that carries meaning |
| 4 | **One step had no body at all** — "Application plane" floating alone | A step with no body is now dropped rather than rendered |
| 5 | **Comparison cards stretched** the same way | Sized to the fuller column, both kept matched |
| 6 | **Closing slide**: centred "THANK YOU" over left-aligned detail | Detail centred |
| 7 | **A truncated clause passing every lint**: "Migrating to an SDN architecture, even partially" — correct capitalisation, no trailing punctuation, under the cap, and still half a sentence | A comma is not a sentence boundary: a cut whose final segment is a qualifier ("even", "especially", "including"…) is now rejected |
| 8 | **Throat-clearing bullets**: "Several important research gaps remain", "SDN is not without significant limitations" | `ANNOUNCEMENT` filter |
| 9 | "**Sixth,** security considerations must be…" — ordinal lead-in not stripped | Lead-in list extended past "fifth" |

Re-rendered and re-inspected after the fixes. **Clipping: none. Overlap: none.
Collisions: none** (also now checked analytically — pairwise text-box overlap is
a QA check). **Gaps: even**, apart from the underfill noted in §5.

---

## 3. LLM path — run end to end on three fixtures

`GEMINI_API_KEY` is present in `.env.local`; the harness loads it the way Next
would. All three ran on `gemini-2.5-flash`.

| Fixture | Result | Notes |
|---|---|---|
| `sample/PRINCEWILL SEMINAR(SDN).pdf` | 15 slides, gate clean | 5/13 non-bullet |
| `sample/USMAN ABUBAKAR_SEMINAR.docx` (real heading styles) | 13 slides, gate clean | 0/13 non-bullet (warns) |
| `out/fixtures/two_column_paper.pdf` (synthesized) | 5 slides, gate clean | see §5 |
| `out/fixtures/scanned_no_text.pdf` (synthesized) | **correctly refused** | 0 chars extracted; refuses to fall back to the filename |

I had no two-column or scanned PDF in the repo, so I **synthesized both**
(`scripts/make_fixtures.mts`). These are constructed documents; a real
two-column paper has ligatures, font subsets and running heads that a hand-built
file does not, so passing here is weaker evidence than passing on a genuine
paper.

### Reading the bullets as a reader

**The LLM output is better, and the reason is not concision — it is that it
repairs meaning the rules cannot.**

| Deterministic | LLM | Verdict |
|---|---|---|
| "QoS requires configuration at every hop" *(listed under **Advantages**)* | "QoS configuration is simplified, not per-hop" | **LLM.** The deterministic bullet is not merely clumsy, it is *false in context* — that is a limitation of traditional networks, sitting under Advantages. No rule I can write catches this; it needs comprehension. |
| "Scalability is another concern" | "Scalability presents a significant concern for large networks" | **LLM.** "Another" refers to a sentence that is not on the slide. Self-contained vs. dependent. |
| "Inability to respond in real time to shifting traffic demands" | "Traditional networks cannot respond to real-time traffic shifts" | **LLM.** The first is a noun phrase with no subject; the second is a claim. |
| "One of the foundational works in the field is Kreutz et al" | "Kreutz et al. provided foundational work in SDN" | **LLM.** The first stops where the title was cut — a truncated source clause that happens to be under 14 words, exactly the failure mode to watch for. |
| "Begins by defining the problem" | "This seminar defines the core network congestion problem" | **LLM**, though it opens with "This", which the contract discourages. |
| "Increased latency, dropped packets, retransmission overhead, degraded application performance" | "Congestion causes latency, packet drops, retransmission, and poor performance" | **LLM**, narrowly. Both read acceptably; the LLM supplies the subject. |

Honest summary: of ~30 bullets compared, the deterministic summariser produced
**four that are truncated source clauses rather than claims**, and one that is
semantically wrong. The LLM produced none of the former and fixed the latter. It
is the better summariser, and the deterministic path is a floor, not a peer.

One regression the LLM introduced: bullets came back with terminal full stops
while the deterministic path strips them, so a mixed deck looked inconsistent.
`validateSlidePlan` now strips them from both.

### Repair-retry and fallback, forced

A `clientFactory` seam injects a stub client, because a real model cannot be
relied on to misbehave on demand. `tests/deck-llm.test.mts` covers:

- valid response → used;
- **invalid first response → repair retry**, asserting the retry prompt names the
  failing field;
- every attempt rejected → **falls back to the deterministic plan untouched**;
- non-JSON text → falls back;
- transport throws → falls back, error never propagates;
- model adds a slide → refused;
- model rewrites `sourceRefs`/title/eyebrow → **refused**, provenance preserved;
- model omits fields → merge keeps the draft (not a failure).

The fallback also fired **for real**: a burst of four runs hit transient
failures, and the deck still shipped via the deterministic summariser. That
exposed a live bug — `gemini-2.0-flash` and `gemini-1.5-flash` in the failover
list are **retired and return 404**, so a run that needed to fail over had no
working fallback. Verified against the models API and replaced with
`gemini-2.5-flash` → `gemini-flash-latest` → `gemini-2.5-flash-lite`. The same
stale list is still in `src/app/api/generate/route.ts`, which I have not touched.

---

## 4. The five non-bullet slides, justified

The quota-filling promotion is **gone**. It used to relabel a slide's bullets as
"Step 1 … Step 5" whenever the deck was short of variety — decoration asserting
a sequence the document never claimed. Each layout below is now detected from
structure the source actually states, and the shortfall is reported rather than
faked when none exists.

| Slide | Layout | What it conveys that bullets would not |
|---|---|---|
| 5 — Advantages vs Limitations | `comparison` | The document devotes two sibling sections to the two sides; side by side, the reader weighs a trade-off in one glance instead of holding four bullets in memory to reach the fifth. |
| 6 — Traditional vs SDN | `table` | A 3 × 3 grid where the **cell relationships are the content** — "Control Plane: distributed *versus* centralised". As bullets the reader has to rebuild the grid mentally. |
| 8 — Overview of Previous Research | `process` | A chronology: 2008–2012, 2012–2016, third/current. The **order and the periods are the point**; the labels are the year ranges lifted from the source, not "Step 1". |
| 10 — The SDN Architecture | `process` | A layered stack the source names explicitly ("organised into three distinct planes"): data → control → application. Order encodes the architecture. |
| 11 — Working Principle | `process` | Five stages of one pipeline, each feeding the next. A bullet list flattens the causality that makes it a *flow*. |

Slide 8 was the one that deserved the challenge: it *was* quota-filled, labelled
"Step 1/2/3". The content is a genuine timeline, so the fix was to detect it
properly and label it with the periods — not to keep the promotion.

---

## 4a. Second round: the thin-slide and variety fixes

| Change | Why |
|---|---|
| **Merge thin sections before summarising** (`mergeThinGroups`) | Adjacent same-chapter sections are combined so the summariser picks the best six bullets from a larger pool. On SDN this merged §2.2+§2.3, §3.1.1+§3.1.2 and §3.3.1–§3.3.4. |
| **Fold or drop under-filled slides** (`mergeUnderfilledSlides`) | The pre-merge works on sentence counts, a proxy. This runs on the **actual bullet yield**, catching the case the proxy misses — a section with plenty of sentences the compressor rightly refuses to shorten. |
| **Gate fails a content slide with <2 bullets** | Backstop. It fired on the DOCX and forced the two fixes above. |
| **Chapter dividers when the deck is under the minimum** | A short deck is now padded with real structure — a chapter the document actually has — instead of by loosening the bullet rules. Fills honestly *and* adds a distinct layout. |
| **LLM gets source sentences for thin slides** | The rule-based compressor can only shorten; a model can *rewrite*. Under-filled slides now carry their source so the model has something to work from. |
| **Notes: hard floor 25 errors, standard's 40 warns** | The two numbers disagreed. Rather than silently pick one, the floor fails and the standard's minimum warns, so the gap is visible. |
| **Two-column depth measured against the columned region** | Not the whole page, which full-width headings stretch. |

Three extraction bugs surfaced while doing this, all found by the gate or by
reading the output:

- **"List of Tables" captions were being promoted to section headings.** Each
  caption became a section carrying a real table, numbered from the running
  chapter counter — so the DOCX deck filled with duplicate table slides labelled
  "Chapter One" for chapter-2 tables. A caption is now a caption.
- **Table slides were titled with the section heading, not the table's subject** —
  "User Interface / Mobile Application" over a table of RFID frequency ranges.
- **Table harvesting duplicated grids and mis-placed them**, carrying a running
  index offset across splices instead of recomputing it.

Result on the two real documents:

| | SDN PDF | DOCX |
|---|---|---|
| Slides | 15 | 12 |
| QA errors | **0** | **0** |
| Under-filled slides | **0** | **0** |
| Non-bullet content layouts | 5 / 13 | 5 / 10 |
| Distinct layouts | 9 / 15 (was 8) | **7 / 12 (was 2)** |
| Largest identical group | 7 (was 8) | **4 (was 10)** |
| Slides with notes | 15 / 15 | 12 / 12 |

The DOCX moved the furthest: from an all-bullets deck with a one-bullet slide to
seven distinct layouts including two real tables and three chapter dividers.

---

## 5. What is still wrong

Stated plainly, none of these are fixed:

1. **My deck is more repetitive than the accredited reference.** 9 distinct
   layouts across 15 slides against 15/15; 7 slides share one body geometry
   against 1.
2. **Two-column support is partial.** Page 2 of the fixture extracts 9 clean
   sentences where it previously extracted 1 and produced three phantom tables.
   **Page 3 still falls back** and is misread as a table: its "REFERENCES"
   heading sits in the left column and stretches that column's vertical extent
   past the depth guard, so the page fails the two-column test. Lowering the
   threshold would fix this page and weaken the guard that stops real tables
   being read as columns, so I left it. A real paper's pages are denser and
   better balanced, but I have not verified that on a real paper.
3. **The two-column deck is 5 slides**, well under the 12–15 range — the gate
   warns. The fixture is small; that is the fixture's fault, not the planner's.
4. **Thin slides — fixed, at a cost in coverage.** No slide in either deck now
   carries fewer than two bullets (§4a). But the fix is partly *subtractive*:
   one DOCX section was dropped outright ("Overview of Smart Energy Management
   Systems" — one bullet, no neighbour in the same chapter to merge with), and
   several sections are now folded together rather than presented separately.
   The deck is fuller; it covers slightly less. That is the right trade for a
   seminar deck, but it is a trade, not a free win.
5. **One semantic misattribution survives the deterministic path** — "QoS
   requires configuration at every hop" under Advantages. The LLM fixes it; the
   rules cannot.
6. **The SDN controller-comparison table is still dropped**, its header cells
   wrapping onto a second line. That section falls back to bullets.
7. **Fixtures 3 and 4 are synthesized**, not real-world documents.
8. **`src/app/api/generate/route.ts` still lists the two retired Gemini models.**
   Out of scope for this task; flagged rather than changed.
9. **LLM speaker notes run shorter than the spec asks.** The standard says 40–70
   words; on the LLM path the shortest slide came back at **29**. It passes the
   gate because the brief specifies check 9 as "≥25 words", so the gate and the
   spec disagree by design. I left the gate at 25 rather than silently
   tightening it to 40 — but the LLM prompt is not reliably hitting the spec's
   own floor, and one of the two numbers should be changed deliberately. The
   deterministic path stays at 45+.

---

## 6. Files changed

**New — `src/utils/deck/`:** `layout.ts`, `presentationSpec.ts`,
`textNormalize.ts`, `fitBudget.ts`, `pdfStructure.ts`, `docTree.ts`,
`summarize.ts`, `slidePlan.ts`, `deckPlan.ts`, `deckRenderer.ts`, `qaChecks.ts`,
`llmSummarize.ts`.

**Modified:** `pdfLoader.ts` (rewritten onto `pdfStructure`, page wrappers mark
cover/TOC); `pptxExporter.ts` (~1,600 lines → a 162-line adapter that runs the
gate and refuses to download on error); `houseStyle.ts` (`DECK_STYLE` removed —
a second set of deck coordinates would recreate the original defect);
`Editor.tsx` (stops passing `'STUDENT NAME'`-style placeholders).

**Scripts:** `qa_deck.mts`, `generate_deck.mts`, `inspect_pptx.mts`,
`make_fixtures.mts`.

**Tests:** `deck-content.test.mts` (new), `deck-llm.test.mts` (new),
`deck-layout.test.mts` (rewritten). **147 pass.**

---

## 7. QA checks and what each prevents

| # | Check | Prevents |
|---|---|---|
| 1 | Off-canvas + 0.5 in edge clearance | The entire clipping class |
| 2 | Estimated height ≤ 92% of box | Text running off the bottom |
| 3 | No empty paragraphs, newlines in runs, literal `•` | Phantom bullets |
| 4 | ≤14 words/bullet, ≤6 bullets/slide | The report reprinted at 18 pt |
| 5 | No bullet starting lowercase or ending `[,\-;]` | Mid-sentence fragments |
| 6 | Font allow-list, size bands, computed 4.5:1 contrast | Unreadable or off-brand type |
| 7 | Banned strings (product name, `lorem`, `TODO`, `XXX`) | Placeholder text shipping |
| 8 | Non-empty `sourceRefs`; eyebrow matches provenance | "Chapter Four" on Chapter Two content |
| 9 | ≥25 words of speaker notes per slide | Empty notes |
| 10 | OOXML: required parts, well-formed XML, newline runs, **notes word count** | Corrupt files; regression of A2/B5 |
| + | Pairwise text collision | Overlapping text |

**The gate fails both shipped decks and passes the regenerated one.** That is the
result that matters: it catches the defect that actually shipped, not only the
code I wrote.

Check 8 earned its place during this work. On the DOCX it failed the build with
eight errors — every slide labelled "Chapter One" — because that report writes
"CHAPTER ONE" once and then numbers later sections "2.1", "3.2" without further
chapter headings, so the running counter never advanced. Chapters are now read
from the heading's own number.

---

## 8. Defects found that were not on the brief's list

1. Cover text could become body content (PDF path emitted no page wrappers).
2. `notesSlide` parts exist even when `addNotes` is never called — a part-count
   check passes a deck with zero notes. My own gate had this hole.
3. References parsed as pseudo-chapters (APA entries opening with a numeral).
4. Page furniture ("Page 15 of 20") leaking into prose.
5. `joinSpans` inserted false spaces — "SDN" + "-Based" → "SDN - Based Network",
   precisely the mangled table header in the shipped deck.
6. De-hyphenation over-joined real compounds ("bandwidthintensive").
7. Paragraph space-after charged after the last paragraph, reporting 103% fill
   on single-line chrome that plainly fits.
8. Ragged table rows discarded otherwise-sound tables.
9. **Two-column PDFs merged across the gutter and were misread as tables** —
   zero sentences extracted from a two-column body.
10. **DOCX had no cover detection at all**, so title, author, matric number and
    supervisor were parsed as body prose.
11. **DOCX chapter labels were all "Chapter One"** (found by check 8).
12. **Two of three Gemini failover models are retired and return 404.**
13. LLM bullets carried terminal full stops the deterministic path strips.
