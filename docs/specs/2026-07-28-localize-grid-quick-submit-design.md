# Localize Grid Quick Submit & Dense Grid — Design

**Date:** 2026-07-28
**Status:** Approved
**Scope:** Frontend only (`frontend/`). No backend changes.

## Problem

On `/detections/:sequenceId/annotate?from=localize` (the Smoke Localization
lane view), the happy path — every predicted box is already correct — still
costs ~N+2 interactions for an N-frame lane: open each frame's fullscreen
modal, submit it, then submit the lane. Worse, the grid cannot support a
glance-check today:

- Cells overlay the **engine** predictions (`algo_predictions`), but the modal
  reviews and commits the **auto** layer (`auto_predictions`, engine
  fallback). The grid does not show what a submit would record.
- In the localize context, `getIsAnnotated`
  (`DetectionSequenceAnnotatePage.tsx:30-45`) is hard-coded to `false`, so
  cells never show a persistent "done" state.
- The header's "Submit All" button is gated on a `visual_check` stage that
  localize lanes never have, so lane submit is keyboard-only (Enter).
- Cell chrome (footer with detection id, timestamp, confidence, counts;
  padding; rounded borders; large gaps) shrinks the actual images, which are
  the only thing the glance-check needs.
- Header copy counts "X of Y detections" where each item is a **frame** of
  the sequence — confusing terminology.

## Goals

1. A user can tell at a glance whether the lane's predicted boxes are correct.
2. If correct, submitting the whole lane is **one click** (plus one confirm
   click only when some frames have no box at all).
3. If a frame is wrong, one click on its cell opens the existing fullscreen
   editor modal to reject/adjust/redraw (unchanged).
4. Frames dominate the grid: no cell chrome, minimal gaps.
5. User-facing copy on this page says "frames", not "detections".

## Non-goals

- No inline drawing in grid cells (editing stays in the modal).
- No per-cell accept/confirm toggles.
- No backend/API changes (the batch uses existing endpoints; the server's
  422 guard on lane submit remains the backstop).
- No changes to other pages or to the modal's review flow.

## Design

### 1. Winner rule (what a cell shows = what submit records)

Priority per frame, reusing existing utilities so the grid preview and the
quick-submit payload cannot diverge:

1. **Committed annotation** — the detection annotation has
   `processing_stage: 'annotated'` (user already submitted this frame via
   the modal, or a previous quick submit). Stage-based on purpose: a
   reject-all modal submit legitimately commits zero boxes and still counts
   as done, matching `calculateAnnotationCompleteness`. Rendered via
   `UserAnnotationOverlay`. Quick submit leaves these frames untouched.
2. **Winning model layer** — `getWinningModelLayer`
   (`utils/annotation/referenceLayerUtils.ts`): auto if it has ≥1 box, else
   engine. This is exactly the layer the modal seeds its review from; a
   no-edit modal submit commits it via `materializeReviewAnnotation`
   (origin-tagged `auto` / `engine`).
3. **Nothing** — neither layer has boxes: the frame is in the "no box"
   state and feeds the submit warning.

### 2. Multiple objects

Already handled upstream: the import object-splits each alert into one
sequence (lane) per smoke object, and this page operates on a single lane.
Sibling objects render as dimmed context overlays
(`SiblingBoundingBoxOverlay`), and post-submit navigation already advances
to the next unfinished sibling lane. Within a lane, a frame's winning layer
may hold several boxes; accept-all commits all of them, identical to a
no-edit modal submit. No per-cell multi-object UI.

### 3. Dense grid (all contexts of this page)

`DetectionGrid` + `DetectionImageCard` (used only by
`DetectionSequenceAnnotatePage`) are restyled in every context:

- Remove the footer block (detection id, date/time, confidence, prediction
  and annotation counts) and the status badge overlay.
- No inner padding, no rounded corners, 1 px grid gap (`gap-px`), keep
  `aspect-video` + `object-contain` and current responsive column counts.
- The existing header "Show predictions" toggle keeps hiding/showing bbox
  overlays.

### 4. Cell states — borders only (localize context)

Gated on `from=localize` (other contexts keep their current border logic,
minus the removed chrome):

| State | Meaning | Rendering |
|---|---|---|
| Done | committed annotation exists | thin (1–2 px) **green** border; committed boxes drawn |
| Auto | no committed annotation, winning layer has boxes | neutral/no border; winning-layer boxes drawn |
| No box | winning layer empty | thin **amber** border; no boxes drawn |

Requires fixing `getIsAnnotated` for the localize context to reflect the
committed annotation state (it currently returns `false` unconditionally
there).

Clicking a cell opens the existing fullscreen modal, unchanged.

### 5. Accept & submit (localize context)

A prominent **"Accept & submit"** button in `DetectionHeader` replaces the
(never-shown) "Submit All" for localize lanes; the existing Enter shortcut
triggers the same handler.

Flow:

1. If any frames are in the "no box" state, the button flips to an inline
   confirm state — "N frames have no box — submit anyway?" — requiring one
   more click; clicking elsewhere cancels. Otherwise it runs immediately.
2. For each frame **without** a committed annotation, build the payload with
   `materializeReviewAnnotation` (winning layer, every box accepted) and
   POST/PATCH the detection annotation at `processing_stage: 'annotated'` —
   the same payload a no-edit modal submit produces today. Frames already
   done are untouched.
3. Then the existing `submitLocalizedLane` path runs: sequence annotation
   PATCH to `annotated`, query invalidations, auto-advance to the next
   unfinished sibling lane or back to `/detections/annotate`.

A new pure util (working name `buildQuickSubmitPayloads`) computes, from the
detections + their annotations, the per-frame winner, the payload list, and
the no-box frame count — unit-testable in isolation.

### 6. Error handling

- Mid-batch failure: toast via the existing notification system; frames that
  landed show as done; the button re-enables so a retry completes the rest
  (per-frame PATCHes are idempotent in effect).
- Sequence PATCH 422 (server guard): existing "Submit rejected — some
  detections are not yet annotated" message stays.

### 7. Crop mode & hover metadata

- **Crop toggle** (localize context; header checkbox + `C` shortcut): each
  cell zooms around the union of its displayed boxes (committed smoke boxes
  for done cells, winning-layer boxes otherwise; no-box cells stay full
  frame), first narrowed to the lane's main object via `focusOnMainObject`
  (boxes intersecting the frame's engine anchor; all boxes when there is no
  anchor or no overlap) so sibling strays don't drag the window — the same
  focus feeds the flipbook's crop. Zoom is a CSS `scale()` about the
  union's center
  (`computeCellCrop` in `utils/annotation/gridCropUtils.ts`; target fill
  0.8, max scale 8). Scaling about the union center keeps the container
  covered for any scale ≥ 1, so no translation is needed. The cell
  re-measures its rendered rect on toggle so box overlays track the zoom.
- **Hover timestamp** (all contexts of this page): the cell shows
  `recorded_at` in a small bottom-left label on hover, replacing the
  removed footer metadata.
- **Cropped view flipbook** (localize; header toggle, default off): the
  animated `CroppedImageSequence` from the sequence-annotation page,
  rendered centered above the grid and fed by `collectLaneBoxes`
  (committed smoke boxes for done frames, winning-layer boxes for pending
  frames).
- **Card size S/M/L** (all contexts; segmented control in the header,
  persisted as `detectionAnnotateCardSize`): drives the grid's
  `repeat(auto-fill, minmax(min(Npx, 100%), 1fr))` template — mirrors the
  group-annotate page's pattern; widths sm 240 / md 340 / lg 500.

### 8. Draw auto-save in the modal

Completing a drawn box (and finishing a move/resize of one) commits the
frame immediately: on a first review the drawn boxes **replace** the model
layer (every winning box is rejected, mirrored in the review UI); on a
re-opened committed annotation the drawn boxes are already the ground
truth. The auto-save stays on the frame (no auto-advance) with a quiet
"Box saved" toast, so repeated redraws just re-commit. The explicit
Space/submit flow is unchanged for accept/reject-style reviews.

### 9. Copy rename

User-facing "detection(s)" on this page that counts frames (header progress
"X of Y detections", related labels) becomes "frame(s)". Code identifiers
keep the `Detection` entity name.

## Testing

TDD throughout:

- **Unit:** `buildQuickSubmitPayloads` — manual-wins priority, auto→engine
  fallback, multiple boxes per frame, no-box counting, already-done frames
  skipped.
- **Component:** `DetectionImageCard` three border states and removed
  chrome; `DetectionHeader` button gating + confirm-on-empty-frames flow;
  `getIsAnnotated` fix in the page context.
- **Extend existing:** `DetectionGrid.test.tsx`, page-level tests covering
  the localize submit flow (batch → lane submit → navigation).

## Affected files (expected)

- `frontend/src/components/detection-annotation/DetectionImageCard.tsx`
- `frontend/src/components/detection-sequence/DetectionGrid.tsx`
- `frontend/src/components/detection-sequence/DetectionHeader.tsx`
- `frontend/src/pages/DetectionSequenceAnnotatePage.tsx`
- `frontend/src/utils/annotation/` (new quick-submit util + index export)
- Corresponding tests under `frontend/tests/`
