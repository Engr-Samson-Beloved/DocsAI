# Deck generator: purposeful titles, smart extraction, real context

Source: `sample/PRINCEWILL SEMINAR(SDN).pdf`
Deck: `out/final/princewill_seminar_sdn_.pptx` — 14 slides
Images: `out/final/slides/slide-01.jpg` … `slide-14.jpg`
Reference studied: `sample/Smart_Energy_Management_RFID_Seminar.pptx`

`qa_deck` passes with **zero errors**. **145 tests pass.** Every slide was
rendered and looked at; what I saw is in §6, including three defects that only
looking found.

---

## 1. Titles, side by side with the reference

| # | Reference deck | This deck (before) | This deck (now) |
|---|---|---|---|
| 1 | *(title slide)* | PRINCEWILL SEMINAR(SDN) | SOFTWARE DEFINED NETWORKING (SDN) FOR TRAFFIC MANAGEMENT IN CONGESTED ENTERPRISE NETWORKS |
| 2 | BACKGROUND AND MOTIVATION | CHAPTER ONE | ENTERPRISE NETWORK DEPENDENCE |
| 3 | PROBLEM, AIM AND SCOPE | FRONT MATTER | CONGESTION DEGRADES PERFORMANCE |
| 4 | SMART ENERGY MANAGEMENT SYSTEM | AT A GLANCE | TRADITIONAL VS. SDN NETWORKS |
| 5 | SYSTEM COMPONENTS | SUMMARY OF EXISTING WORKS | SDN RESEARCH LANDSCAPE |
| 6 | SYSTEM ARCHITECTURE | CHAPTER TWO | SDN RESEARCH EVOLUTION |
| 7 | COMPARISON OF TECHNOLOGIES | CORE CONCEPTS: THEORETICAL BACKGROUND | SDN ARCHITECTURAL PLANES |
| 8 | RFID TECHNOLOGY FUNDAMENTALS | 3.1.3 TRAFFIC ENGINEERING | SDN TRAFFIC ENGINEERING |
| 9 | CLASSIFICATION OF RFID SYSTEMS | WORKING PRINCIPLE / PROCESS FLOW | SDN TRAFFIC MANAGEMENT CYCLE |
| 10 | RFID-BASED ENERGY CONTROL | AT A GLANCE | SDN SIMULATION TOOLS |
| 11 | APPLICATIONS | CHAPTER FOUR | SDN BENEFITS AND CHALLENGES |
| 12 | ADVANTAGES | FINDINGS, CONCLUSIONS, AND FUTURE SCOPE | FUTURE SDN DIRECTIONS |
| 13 | LIMITATIONS AND CHALLENGES | REFERENCES | SEMINAR REFERENCES |
| 14 | CONCLUSION AND FUTURE OUTLOOK | THANK YOU | THANK YOU |

Read the middle column and you learn where text sat in a document. Read the
right column and you can follow the argument: enterprise networks depend on the
network → congestion degrades performance → here is how SDN differs → what the
research says → how it evolved → how it is structured → how it engineers traffic
→ its cycle → its tools → its benefits and limits → where it is going.

Every title is 2–6 words, unique, colon-free, and contains no structural
vocabulary. All fourteen are checked by the gate, not by eye.

---

## 2. Banning structural vocabulary

`BANNED_TITLE_PATTERNS` (`deck/titles.ts`) is checked against **all rendered
text and all speaker notes**, not just titles — "Chapter Two" is equally wrong
in a bullet. Any match is a build error.

`stripSectionNumbering` (`deck/documentParts.ts`) runs in the extractor, before
anything can select a sentence, and handles the glued form the converter
produces: `"3.3.1 SDN Controllers The choice of SDN controller is fundamental"`
→ `"The choice of SDN controller is fundamental"`.

**Eyebrows are deleted** from the model, the renderer and the layout module. The
vertical space they held now belongs to the title. **Chapter dividers are
deleted**; the `section` layout is gone from the layout union entirely, so one
cannot be reintroduced by accident.

The slide counter ("8 / 14") is exempt from the banned-number check. It is
chrome, not content — the rule is about what the deck *says*.

---

## 3. Extraction: dropping what is not argument

`deck/documentParts.ts` classifies every block before planning: `cover`,
`declaration`, `dedication`, `acknowledgements`, `toc`, `listing`, `abstract`,
`body`, `references`, `appendix`. Front matter is dropped **in the tree builder**
rather than filtered later, so no downstream stage is ever offered it.

A table of contents is detected by **shape as well as heading** — a run of lines
ending in page numbers — because conversion routinely loses the heading. That is
precisely how `12 3.1.1 The SDN Architecture` became a bullet.

Within body prose, `cleanSourceSentence` rejects:

- **scaffolding** — "This chapter begins by defining the problem". The bullet
  `Begins by defining the problem` existed because that filter was missing; the
  claim test now rejects the decapitated form too (`document-subject`).
- **cross-references** — stripped when the sentence survives without them,
  rejected when it does not.
- **captions used as prose**, and stray contents lines.

Measured on the SDN report: the abstract went from 7 "sentences" to 5 and §1.1
from 11 to 10, the difference being exactly the sentences about the document.

---

## 4. Claims, not truncations

`deck/claims.ts` replaces the old surface lint. `isCompleteClaim` rejects: no
finite verb, opening conjunction, gerund-without-subject, lowercase start, bare
noun list, dangling `,`/`-`/`;`, a section number, a repeated head noun phrase,
and the document-as-subject forms.

`rewriteUntilClaim` is the verify loop: compress at a budget, **check the result
is a claim**, retry at another budget, drop it if it never becomes one. Nothing
is truncated to fit.

> **One deviation, stated.** The brief says retry at a *lower* budget. That
> assumes the summariser can rewrite more densely on demand — true of a model,
> false of a rule-based compressor, which answers a smaller budget by refusing.
> The second attempt therefore gives it *more* room up to the 14-word cap, which
> is what actually rescues a sentence; the third tries tighter. The invariant the
> brief cares about is unchanged: every candidate is verified, and a failing one
> is dropped rather than shipped.

`Firewalls, load balancers, intrusion detection systems` now fails
(`no-finite-verb`, `bare-noun-list`). `Begins by defining the problem` fails
(`document-subject`).

---

## 5. Context: roles and captions

**Roles, not headings.** `detectRole` classifies each section as problem,
objectives, scope, background, comparison, evidence, findings, limitations or
conclusion — by heading first, then by opening prose. `selectGroups` gives every
role present its strongest section *before* spending budget on volume, and the
gate fails a deck that drops a role the source contains.

**Captions.** Tables and diagrams carry a one-line italic finding beneath them.
When the prose states the outcome it is used; when it does not, one is derived
from the table's own headers, so it cannot assert anything the table does not
show. This is also what stopped the table slide leaving its bottom half empty.

---

## 6. Visual QA — every slide rendered and inspected

LibreOffice 26.2.5.2 + poppler 25.07.0. All 14 slides rendered and examined.
**Three defects were found only by looking**, all of which passed every static
check at the time:

| What the image showed | Cause | Fix |
|---|---|---|
| **Slide 9: text on top of text.** "Network discovery and topology mapping" wrapped to four lines in a box measured for three, so the body rendered over the fourth. | `estimateLines` treated bold at the same width as regular, and counted characters without allowing for word-wrap slack. | A bold width factor (1.09) and a longest-word allowance. The recorded boxes had not overlapped — only the *rendered text* had — so no geometry check could have caught it. |
| **Slide 2: every card said the same thing twice.** "Twenty-first century enterprises depend" as a heading, above "Twenty-first century enterprises depend on network infrastructure". | The label was a prefix of the body rather than its subject. | Label = subject (cut at the first finite verb), body = predicate. A label under two words is dropped, and that decision is made per slide so a grid is never half-labelled. |
| **Slide 4: table correct, bottom 43% blank.** | The recorded box was padded to 75% of the body, so the empty-space check believed the slide was full. | The table records its *natural* height. The check then fired at 43% — correctly — and a caption plus taller rows fixed it. |

After the fixes, on the final deck: no clipping, no overlap, no collisions, no
half-empty tables. Slide 6's timeline (2008-2012 → 2012-2016 → Current Phase),
slide 7's three-plane diagram with arrows, and slide 9's five-step flow all read
cleanly.

---

## 7. Layout by content shape

| Content shape | Layout | On this deck |
|---|---|---|
| Entities compared on shared attributes | table + caption | 4 |
| An ordered procedure / chronology | numbered flow with arrows | 6, 9 |
| A system with components and flow | shape diagram, boxes + arrows | 7 |
| 4–6 parallel items | card grid | 2, 3, 5, 11, 12 |
| Everything else | bullets | 8, 10 |

**9 of 12 content slides (82%) are non-bullet**, against a 40% floor. One real
table, one shape diagram, two numbered flows.

There is **no promotion pass**. The earlier version relabelled bullets as
"Step 1 … Step 5" to hit the quota; that asserted a sequence the document never
claimed. A shortfall is now reported, not faked.

---

## 8. Cover metadata

`deck/coverMetadata.ts` parses ten labelled fields, records the source line for
each, and **fails the build on two different values for one field** rather than
picking one — which is how a stale matric number reached a title slide.

On the SDN cover: title, author `EKPAWHA PRINCEWILL DAVID`, matric
`F/HD/24/3410037` (split out of the name line, rendered once), department
`COMPUTER ENGINEERING` (bounded before the degree statement), institution,
supervisor, degree `HIGHER NATIONAL DIPLOMA`, date. `school` and `session` are
genuinely absent and reported as missing for the UI to ask. No conflicts. The
metadata object is built fresh from its argument on every call.

---

## 9. Header and notes

**The header is measured.** `titleBlock` wraps the title with the shared
`estimateLines` and returns its real height; `bodyBelow(height)` gives the body
box. No constant anywhere. A gate check re-derives the wrapped height and fails
if the block is shorter.

**Notes come from the slide's own final text**, after summarisation — never from
the source paragraph. The phrase templates are gone. A gate check requires every
number and proper noun in the notes to appear on the slide, and `groundNotes`
regenerates any that fail before the gate sees them. It fired twice on this
document (the model mentioned "QoS" and "ECMP" on slides where neither appeared).

Notes on the final deck: 37–58 words.

---

## 10. Gate additions

All errors: banned vocabulary anywhere in rendered text or notes; section
numbers in titles or bullets; duplicate titles; titles outside 2–6 words; a colon
in a title; `isCompleteClaim` failure on any bullet; bounding-box overlap between
non-background shapes; header shorter than its measured wrapped title; role
coverage; non-bullet layouts below 40%; notes referencing anything absent from
the slide; a contiguous empty region above 35% of the slide; and, from before,
off-canvas, overflow, bullet hygiene, contrast, placeholders, notes length,
under-filled slides.

The empty-region check uses a largest-empty-rectangle scan over a 24×14 grid of
the recorded shapes.

---

## 10a. Defects found in production, after the above

Three, all on paths my fixtures did not exercise.

**`deck-identity` at 105% of its box.** The title slide sized the identity block
from the space the title happened to leave over
(`h: Math.max(1.2, SLIDE_H - cursor - MARGIN)`) and never measured it against its
own content. Every other painter measures; this was the one place the old
pattern survived. It escaped because the SDN cover supplies neither `school` nor
`session`, giving four identity lines — a fuller cover gives six, and six did
not fit under a three-line title plus a subtitle. Replaced with a measured fit
ladder.

**`deck-identity` at 16pt, rejected by the gate.** Two faults meeting. The fit
ladder's loop nesting reached the 16pt floor while it still had a free
line-merge and the subtitle in hand — shrinking type is the most damaging
concession available and it was being tried third. Re-ordered by what each
concession costs the reader: tighten gaps → merge trailing identity fields →
drop the subtitle → 16pt floor.

Underneath it, the gate rejected 16pt outright: `rangeFor` returned
`spec.type.body` (18–22) for body text, so the standard's documented "16pt
absolute minimum" was unreachable and the floor check beneath it was dead code.
The body range now runs from `bodyAbsoluteMinPt`, with a **warning** when a shape
sits on the floor rather than in the preferred range. A floor that cannot be
stood on is not a floor.

**`step-body-*` at 96% and 108% on slide 9.** `paintProcess` stepped the body
size down until the cards fitted, stored it in `bodyPt`, and then drew the text
at `spec.type.caption.maxPt` — the box was sized at one size and filled at
another. Only the deterministic path hit it, because its bullets are longer than
the LLM path's, and my zero-error SDN run had been the `--llm` one. Beneath that,
the never-fits branch clamped the card height to the available area, moving the
overflow inside the card as text on text — the exact failure the comment above
the loop warns against. It now falls back to a bullet list built from the steps,
which loses the sequence but no words.

The shared shape of all three: **a box sized from leftover space, or filled at a
size it was not measured at.** That is the first thing to suspect in any future
overflow report.

---

## 11. Where this still falls short

Honestly, and in order:

1. **Bullets slides are sparse.** Slides 8 and 10 carry three bullets and leave
   roughly 60% of the slide white. Nothing is wrong on them; they simply do not
   earn a full slide. The reference deck has one bullets slide out of thirteen
   and it is full. The fix is to merge them into a neighbouring card grid, which
   the current merge pass will not do because it only merges *before*
   summarisation and only within a role.

2. **The diagram is thin.** Slide 7 shows three boxes and a caption in a band
   across the middle; the reference's architecture slide has seven boxes in two
   rows with a labelled inter-row connector. Ours is correct and sparse. The
   source describes only three planes, so the content is honest — but the layout
   does not use the space the way the reference does.

3. **Deterministic titles are much weaker than LLM titles.** With Gemini
   unavailable the same document produced `TWENTY-FIRST CENTURY ENTERPRISE`,
   `FOUNDATIONAL WORK ESTABLISHING` and `NETWORK ADMINISTRATORS EXPRESS`. They
   pass every rule — 2–6 words, unique, no banned vocabulary — and they are not
   good titles. Naming a subject is a comprehension task; the rule-based
   generator picks the most distinctive recurring noun phrase, which is a proxy.
   **The deck meets the bar on the LLM path and only clears the rules on the
   deterministic one.**

4. **Card labels can still stop on a verb** — "Modern enterprises depend" on
   slide 2. Better than the severed "SDN is", not as clean as a pure noun phrase.

5. **A caption can repeat a card.** Slide 7's caption restates card 2 almost
   verbatim. The caption is derived from the same sentences the cards are, and
   nothing checks for overlap between them.

6. **Gemini 503s are frequent.** Three of six runs in this session fell back to
   the deterministic summariser. The fallback works — that is why the deck still
   built — but it means the quality of a given run is not reproducible, and
   `gemini-2.5-flash-lite` in the failover list is now 404 for new users.

7. **The stat layout never fires** on this document. `extractStat` needs a
   percentage and the SDN report states none, so the "single striking quantity"
   layout is implemented and unexercised here.

8. **Two source sections are dropped** to stay inside 15 slides, and the
   controller-comparison table is still discarded because its header cells wrap
   onto a second line and cannot be reassembled.

---

## 12. Acceptance criteria

- [x] No `Chapter`, `Front Matter`, `At a Glance`, `Overview`, or section number anywhere
- [x] Every title 2–6 words, unique, naming its subject; the titles alone follow the argument
- [x] No chapter dividers — the layout is removed from the model
- [x] Every bullet passes `isCompleteClaim`
- [x] Slides for problem, comparison, evidence, findings, limitations and conclusion
- [~] **Objectives**: the SDN report has no aims-and-objectives section, so no slide claims one. Role coverage passes because the role is absent from the source, not skipped.
- [x] ≥40% non-bullet (82%); one table with a caption; one shape diagram
- [x] One consistent matric number; fields correctly bounded
- [x] No overlapping shapes; header measured
- [x] Notes reference nothing absent from their slide
- [x] `qa_deck` passes with zero errors, **and every slide was rendered and inspected** — see §6

---

## 13. Files

**New:** `deck/documentParts.ts`, `deck/coverMetadata.ts`, `deck/claims.ts`,
`deck/titles.ts`, `deck/speakerNotes.ts`, `deck/slideRecorder.ts`,
`deck/deckPainters.ts`.

**Rewritten:** `deck/deckPlan.ts` (roles, content-shape layouts, titles from
content), `deck/deckRenderer.ts` (now orchestration only), `deck/docTree.ts`
(classification, screened sentences), `deck/qaChecks.ts` (twelve new checks),
`deck/slidePlan.ts` (claim validation, no eyebrow, colon repair),
`deck/layout.ts` (`bodyBelow`, measured header), `deck/fitBudget.ts` (bold and
word-wrap in `estimateLines`), `deck/llmSummarize.ts` (title rewriting, grounded
notes, fixed slides protected).
