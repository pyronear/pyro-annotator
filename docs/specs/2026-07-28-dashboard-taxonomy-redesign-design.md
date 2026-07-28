# Dashboard Taxonomy & Redesign

**Date**: 2026-07-28
**Scope**: Frontend presentation layer only. No backend enum, schema, or API changes.
**Status**: Approved (brainstormed via visual companion, mockup v7)

## Problem

The dashboard presents two annotation flows without explaining how they relate,
leads with raw stage mechanics (`seq_annotation_done`, `under_annotation`), and
counts several stages that are dead or vestigial. Stage names describe database
states, not what a human should do next.

Findings that shaped this design:

- `under_annotation` is vestigial: it was a claim marker set by the retired
  pull/push sync workflow (removed in #179 and the clone-mode removal). Nothing
  sets it today. Stale rows may exist in production; they are ignored.
- `in_review` is only referenced defensively (`_BULK_LOCKED_STAGES`); nothing
  sets it.
- `needs_manual` also has no live writers (its writers were the retired
  auto-annotate/FiftyOne pipelines), but it is still the default server-side
  filter of the detection annotate queue (`DetectionAnnotatePage`). Historical
  rows may exist.
- The live stage progression is: `ready_to_annotate` → classify submit sets
  `seq_annotation_done` (`sequenceUtils.ts`, `AnnotationInterface.tsx`) →
  completing localization sets `annotated`
  (`DetectionSequenceAnnotatePage.tsx`).
- The frontend pseudo-stage `no_annotation` and backend `imported` are
  pipeline plumbing, not human work.
- The dashboard makes 11 count queries to render.

## Taxonomy (presentation layer)

One pipeline. The unit is the **sequence**, which travels left to right through
two human passes:

```
Classify  →  Localize  →  Complete
```

- **Pass 01 — Classify** (existing `/sequences/annotate` flow): watch the
  sequence, decide what each track is (wildfire smoke, other smoke, false
  positive), flag missed smoke.
- **Pass 02 — Localize** (existing `/detections/annotate` flow): draw a tight
  bounding box around the smoke in each image. Unlocked per-sequence by Pass 01.

### State mapping (raw stages → presented states)

| Presented state    | Raw data                                                       |
| ------------------ | -------------------------------------------------------------- |
| Classify · to do   | sequence annotation `processing_stage = ready_to_annotate`     |
| Classify · done    | `seq_annotation_done`, `in_review`, `annotated` (the existing "submitted" predicate) |
| Localize · to do   | Classify done **and** `detection_annotation_completion = incomplete` |
| Localize · done / Complete | `detection_annotation_completion = complete`           |
| Attention          | `needs_manual` — hidden when zero                              |
| (hidden)           | `no_annotation`, `imported` (import plumbing), `under_annotation` (vestigial) |

Rules:

- Raw stages remain visible on list pages; the dashboard never shows them.
- Neither pass has an "in progress" state — the data model has no live
  per-sequence marker for it, so the UI does not invent one.
- "Complete" = both passes done. Its percentage is computed against total
  sequences.

## Dashboard design (mockup v7)

Page composition, top to bottom — exactly four elements:

1. **Header**: headline "Annotation pipeline" (static, no data), subtitle
   "Two passes: classify what the cameras saw, then localize the smoke."
2. **Attention banner** (conditional, only when `needs_manual > 0`): red-tinted
   strip — "⚠ N sequences need manual attention — Resolve →" linking to the
   needs-manual queue.
3. **Chevron pipeline strip**: three solid plates cut into chevrons
   (`clip-path`), each segment's right edge is an arrow point with the page
   background showing through the notches; the final point doubles as the arrow
   of time. Per segment: mono count, uppercase label, one-line detail.
   - Classify (ember) — count of to-do, "waiting for a first pass"
   - Localize (pine) — count of to-do, "boxes still to draw"
   - Complete (charcoal) — count, "NN% of all sequences"
4. **Two phase cards** (side by side, stack on mobile):
   - Eyebrow "Pass 01 — Classify" / "Pass 02 — Localize" (mono, with color dot)
   - Title "Classify sequences" / "Localize smoke"
   - Description: "Watch each sequence and decide: wildfire smoke, other smoke,
     or false positive." / "Draw a tight box around the smoke in every image.
     Unlocked by Pass 01."
   - Large mono to-do count, thin progress bar (done/total for that pass),
     "N classified|localized so far"
   - Primary CTA: "Start classifying" → `/sequences/annotate`;
     "Start localizing" → `/detections/annotate`
   - Secondary link: "Review classified · N →" → `/sequences/review`;
     "Review localized · N →" → `/detections/review`
   - Classify card only: "Classify by group · N →" → `/sequence-groups`,
     shown when unlabeled groups exist. Group labeling fans out to member
     sequences (`_propagate_to_group_if_validated`), so it is presented as a
     bulk accelerator for Pass 01, not a pipeline stage.
5. **"How annotation works" panel**: lede + three color-keyed steps
   (border-left in phase color) + why-line + field guide link:
   - Lede: "Wildfire cameras send detection sequences to the platform. Every
     sequence travels the same path, and your work happens in two passes:"
   - Step copy as in mockup v7 (Classify / Localize / Complete).
   - Why-line: "Why two passes? Classifying is quick and filters out false
     positives early, so the slower localization work is only spent on
     confirmed smoke."
   - Link: "Open the field guide →" → `/guide`.

Removed from the current dashboard (replaced wholesale): hero gradient banner,
key-metrics cards, quick-action link grid, "Processing Pipeline" section with
7-segment stacked bar, project overview panel, "Ready to Start Annotating?"
banner.

### Field guide page (`/guide`, minimal)

New route with static content: the pipeline explainer (same copy as the
dashboard panel) plus the flow description at slightly more depth (what each
false-positive type looks like can come later). Minimal first version; exists
so the dashboard link has a target. Content grows in follow-ups.

## Visual system

Fire-lookout instrument panel. Calm surfaces, color only where it means
something.

**Palette** (CSS custom properties / Tailwind config):

| Token    | Hex       | Use                                             |
| -------- | --------- | ----------------------------------------------- |
| `ash`    | `#F7F6F3` | page background                                 |
| `paper`  | `#FFFFFF` | card surfaces                                   |
| `line`   | `#E4E2DC` | hairline borders                                |
| `char`   | `#20261F` | ink, Complete accent                            |
| `haze`   | `#767B72` | secondary text                                  |
| `ember`  | `#D9581E` | Classify accent, primary CTAs (Pyronear orange) |
| `pine`   | `#166A5D` | Localize accent                                 |
| `signal` | `#B3261E` | Attention only                                  |

**Type**: Archivo (headings), IBM Plex Sans (UI text), IBM Plex Mono (all
counts, stage codes, eyebrows). Self-host via `@fontsource/*` packages — no
external font CDN at runtime.

**Rules**: ember appears only where action lives; signal red only for
attention; hairline borders instead of shadows; counts always mono. Pass
numbering (01/02) is justified because the passes are genuinely sequential.

**Responsive**: phase cards stack below `md`; the chevron strip becomes three
stacked straight-edged cards (no notches) below `md`. Buttons and links keep
visible keyboard focus styles.

## Data requirements

Counts needed (all `total`-only queries, `size=1`):

| Metric              | Query                                                        |
| ------------------- | ------------------------------------------------------------ |
| Classify to do      | sequence annotations, `processing_stage=ready_to_annotate`   |
| Classify done       | sum of `seq_annotation_done` + `in_review` + `annotated` counts |
| Localize to do      | Classify done **and** detections incomplete. In practice `seq_annotation_done` count is a good proxy (classify submit parks a sequence there; finishing localization moves it to `annotated`); exact composition decided at implementation — either that proxy or `detection_annotation_completion=incomplete` scoped by stage if the API supports the combination |
| Complete / Localize done | sequences, `detection_annotation_completion=complete`   |
| Attention           | sequence annotations, `processing_stage=needs_manual`        |
| Total sequences     | sequences, no filter                                         |
| Groups to label     | `getSequenceGroupStats()` → `unlabeled`                      |

This trims `useAnnotationStats` from 11 queries to ~8; `imported` and
`under_annotation` queries are dropped. Loading states: skeleton blocks per
component, as today. Error state: single inline error line in place of the
strip (reuse existing pattern).

**Queue-filter mismatch to resolve at implementation**: "Start localizing"
links to `/detections/annotate`, whose default persisted filter is
`processing_stage=needs_manual` — a leftover of the retired pipelines. The
queue's default filter must change to match the Localize · to do definition
above, or the dashboard count and the queue contents will disagree. This is a
small frontend default-filter change, still presentation-layer.

## Out of scope / follow-ups

- **Backend enum pruning** (separate ticket): `under_annotation` and
  `in_review` are candidates for removal from
  `SequenceAnnotationProcessingStage` after migrating stray rows. Presentation
  works whether or not this happens.
- Per-user contribution stats, throughput charts.
- Field guide content beyond the minimal explainer (per-type examples,
  keyboard shortcuts).
- Any change to list pages, queues, or annotation interfaces.

## Testing

- Unit-test the new stage→presented-state mapping helpers (pure functions).
- Component tests: attention banner hidden at zero; counts render from mocked
  queries; CTAs link to the right routes.
- `npm run quality` clean; no new ESLint warnings.
