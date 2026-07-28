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

1. **Committed annotation** — the detection annotation has smoke bboxes
   (user already submitted this frame via the modal, or a previous quick
   submit). Rendered via `UserAnnotationOverlay`. Quick submit leaves these
   frames untouched.
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
- No inner padding, no rounded corners, grid gap of 1–2 px
  (`gap-px`/`gap-0.5`), keep `aspect-video` + `object-contain` and current
  responsive column counts.
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

### 7. Copy rename

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
