# Distinct "cleared" state for confirmed-empty frames on the localize alert page

**Date:** 2026-08-06
**Status:** Approved
**Scope:** `frontend/src/utils/annotation/alertLocalizeUtils.ts`,
`frontend/src/components/localize/LocalizeObjectRow.tsx`,
`frontend/src/components/localize/LocalizeTimelineLegend.tsx`,
`frontend/src/components/detection-sequence/AlertFrameGrid.tsx`,
`frontend/src/pages/LocalizeAlertPage.tsx`

## Problem

Clearing a frame in the object editor (X/Delete on an evidence-bearing
frame) commits an annotation with an empty box list — "confirmed empty",
the object is not visible here (see
`2026-08-05-gap-frame-materialization-design.md`). On
`LocalizeAlertPage`, `buildAlertFrameModel` maps **any** committed
annotation to timeline status `confirmed`, boxes or not, and the grid
draws only actual boxes. A cleared frame therefore renders as a solid
"committed" segment on the row's timeline strip while its grid cell
shows a bare image with no marker at all — which reads as a box that
went missing, not as an answer someone recorded. (Observed on sequence
27 / lane 27: detections 547, 558, 561 committed empty; 574, 598
committed with a box.)

## Behavior

1. **New timeline status `cleared`.** A workable (non-false-positive)
   lane's frame whose committed annotation contains zero smoke boxes
   (items after the `false_positive_type == null` filter) maps to
   `cleared` instead of `confirmed`. `ObjectFrameStatus` becomes
   `'confirmed' | 'cleared' | 'pending' | 'empty' | 'absent'`.
2. **False-positive context lanes are exempt.** An FP lane's committed
   annotation is empty *by construction* (the backend writes
   `{"annotation": []}` for FP-only lanes), so "cleared" there is not
   information. FP lanes keep their existing mapping (engine boxes →
   `confirmed`, else `empty`).
3. **Strip encoding: diagonal hatch.** `LocalizeObjectRow` renders a
   `cleared` segment as a diagonal hatch in the object's color (CSS
   `repeating-linear-gradient`, no assets). Existing encodings are
   unchanged: solid = committed box, faded = pending, outline = empty,
   bare track = absent.
4. **Legend names it.** `LocalizeTimelineLegend` labels the status
   "cleared", display order committed → cleared → pending → empty, and
   (as today) only lists statuses actually present across the rows on
   screen.
5. **Grid cell corner chip.** A frame cell whose lane is committed with
   zero smoke boxes — and is not FP context — shows a small eye-off
   icon chip in the cell's bottom-right corner, tinted the lane's
   object color; one chip per cleared lane on that frame. The chip is
   informational only (no click behavior of its own).
6. **Counters unchanged.** The row's `confirmed/present` fraction and
   the "N left" chip keep counting cleared frames as settled work —
   clearing is finished work; only its appearance changes.

## Implementation

- **`alertLocalizeUtils.ts`**: in `buildAlertFrameModel`, split the
  `cellState === 'done'` branch on the filtered smoke-box count to emit
  `'confirmed'` or `'cleared'`. Extend `TimelineLegendStatus` /
  `LEGEND_STATUS_ORDER`. `AlertFrameCell` gains the lane's `color` so
  the grid chip does not depend on boxes existing (today color rides
  only on `AlertFrameBox`).
- **`LocalizeObjectRow.tsx`**: add the `cleared` case to
  `segmentAppearance` (hatch via `repeating-linear-gradient` of the
  object color over transparency).
- **`LocalizeAlertPage.tsx`**: the `objectProgress` derivation counts a
  frame as outstanding when its status is neither `'confirmed'` nor
  `'cleared'` (today: `status !== 'confirmed'`). This keeps
  `confirmedCount`, the "N left" chip, the Done pill, and the
  `confirmedCount === presentCount` completeness check treating cleared
  frames as settled — without it, the split would silently reopen
  already-settled lanes.
- **`LocalizeTimelineLegend.tsx`**: add the "cleared" swatch (same
  hatch) and label.
- **`AlertFrameGrid.tsx`**: render the eye-off chip (lucide `EyeOff`)
  for each cell with `cellState === 'done'`, no `isFalsePositive`, and
  zero boxes, colored by the cell's lane color.

## Out of scope

- The editor filmstrip (`ObjectFilmstrip` / `FilmstripThumbnail`) and
  the accept-popover strip (`ObjectStatusStrip`) keep their current
  vocabulary — separate surfaces, separate follow-up if wanted.
- No backend or data changes; committed-empty annotations are already
  the intended record of a clear.

## Testing

- `buildAlertFrameModel`: committed annotation with zero smoke items →
  `cleared`; with only FP-typed items → `cleared`; with ≥1 smoke item →
  `confirmed`; FP context lane's frames never `cleared`.
- Legend: `timelineLegendStatuses` includes `cleared` only when a row
  has one; ordering pinned.
- `LocalizeObjectRow`: cleared segment renders the hatch appearance
  (distinct from confirmed/pending/empty), aria-label reports
  `cleared`.
- `AlertFrameGrid`: chip renders exactly for done + boxless +
  non-FP cells, tinted the lane color; absent on boxed or pending
  cells.
- Progress counting: a lane whose present frames are all `confirmed` or
  `cleared` reads as Done (`confirmedCount === presentCount`); a
  `cleared` frame never counts as outstanding.
- Existing confirmed/pending/empty tests stay green.
