# Outcome Codes in Result Tables — Design

Replace the model-accuracy row tints in the done tables with a compact
outcome code (colored dot + mono code) in the Result column, per the
fire-lookout design guidelines (`frontend/DESIGN.md`).

## Problem

`/classify/done` and `/localize/done` show model accuracy (TP/FP/FN) as
full-row background tints — green/red/blue/amber from the deprecated legacy
palette — decoded by a `SequencesLegend` strip, plus yellow/orange emoji
pills for FP/smoke types. This fights the fire-lookout system on three
fronts: paper surfaces (rows should not be washed in color), one accent per
element, and accent color only where meaning lives. It also cannot express
the multi-object alert rows planned by
`2026-08-03-multi-object-alert-collocation-design.md`, where one row will
aggregate several per-object outcomes.

## Outcome semantics

One derivation, defined once and imported everywhere. Per sequence
(annotation present), first match wins — the same precedence the row tints
use today:

| Condition | Outcome | Code |
|---|---|---|
| `is_unsure` | unsure | `?` |
| `has_missed_smoke` | false negative | `⚑ FN` |
| `has_smoke` | true positive | `TP` |
| otherwise | false positive | `FP` |

No annotation → no outcome rendered (empty cell).

Semantic shift from today's colors, deliberate: **missed smoke is the
critical model error** in a wildfire system and takes `signal`; a false
positive is the model being wrong but harmless and goes **neutral**; a true
positive is calm/positive (`pine`); unsure needs human action (`ember`).

| Outcome | Dot / glyph | Text tone |
|---|---|---|
| TP | `pine` dot | `char` code |
| FP | `haze` dot | `char` code |
| FN | `signal` `⚑` glyph (no dot) | `char` code |
| unsure | `ember` dot | `char` code |

## `OutcomeCode` component

New `frontend/src/components/sequences/OutcomeCode.tsx`:

- Renders an 8px dot (or the `⚑` glyph for FN) + the code in
  `font-data text-detail font-semibold`.
- `title` tooltip with the full phrase (e.g. "True positive — model
  correctly detected smoke").
- Optional `extraCount?: number` renders a muted mono `+N` after the code —
  unused today, reserved for the multi-object rollup below.

It replaces three mechanisms at once: the row tints, the amber "⚠️ Unsure"
pill, and the legend. Codes are self-labeling for annotators; the Result
`ColumnHeader` tip explains the four codes for newcomers.

## Table changes

**`ClassifyDoneTable`** (`/classify/done`)

- Rows: plain paper, `hover:bg-ash`, no accuracy/unsure tinting.
- Result cell: `OutcomeCode` first, then quiet detail text
  (`text-detail text-haze`): formatted smoke types for TP, FP types for FP,
  "Missed smoke" (+ smoke types if any) for FN, "Unsure" for `?`. The
  yellow/orange emoji pills go away.

**`LocalizeDoneTable`** (`/localize/done`)

- Same tint removal; `OutcomeCode` leads the existing Result cell text
  (FP types; the Smoke types column is unchanged).

**`SequencesLegend`** — removed from both pages and deleted; this change
orphans it.

**Chrome migration.** Both table files are rewritten by the above, so their
chrome migrates to the fire-lookout table recipe while we're in them: ash
header with mono eyebrow `th`s, `line` dividers, `char`/`haze` cell text,
mono for dates/counts, and the legacy blue source pill becomes neutral.

**Untouched:** `LocalizeQueueTable` (every row is smoke by definition — no
outcome to show), the classify queue (unannotated rows), and the detail
pages.

## Future: multi-object rollup (documented, not built)

When queue rows become alerts (1..N objects) per the collocation design, a
row shows the **dominant outcome** by precedence
`⚑ FN > ? > TP > FP`, with `extraCount` = the number of other objects
(e.g. `TP +2`). Alert-level missed smoke is stored on the primary lane and
therefore dominates naturally. Single-object alerts render identically to
today's per-sequence code. Chosen over per-object dot strips, coded counts
(`2 TP · 1 FP`), and segmented micro-bars for its clean single-object
degradation; the exact mix stays one click away on the detail screen.

## Cleanup

- `modelAccuracy.ts`: the outcome derivation slots in beside
  `getModelAccuracyType`; `getRowBackgroundClasses` and anything else this
  change orphans is removed. Exports still used by the filter components
  stay.
- Out of scope but flagged: `DetectionAnnotateTableRow.tsx` is pre-existing
  dead code (zero usages) — cleanup ticket, not this change.

## Testing

- Unit: outcome precedence (unsure beats FN beats TP/FP; null annotation →
  none).
- Component: `OutcomeCode` renders the four states + `extraCount`; unknown
  renders nothing.
- Tables: existing done-table tests updated — no tint classes, code + detail
  text present, legend gone.

## Non-goals

- No backend or API changes.
- No change to filters (`ModelAccuracyFilter` keeps its current labels).
- No implementation of the multi-object rollup (alert rows don't exist yet).
