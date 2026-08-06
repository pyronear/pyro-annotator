# Inferred crop-mode zoom for boxless cells in the localize frame grid

**Date:** 2026-08-06
**Status:** Approved
**Scope:** `frontend/src/components/detection-sequence/AlertFrameGrid.tsx`, `frontend/src/utils/annotation/gridCropUtils.ts`

## Problem

On `LocalizeAlertPage` (`/localize/:sequenceId/object/:laneId`), crop mode
zooms each grid cell around the active object's boxes on that frame
(`computeCellCrop`). Cells where the object has no boxes stay full-frame:

- **Gap frames** — the active lane has a detection on the frame but no
  boxes to draw (`cellState: 'empty'`, including the materialized gap
  frames from PR #293). `computeCellCrop([])` returns identity.
- **Before/after context frames** — the active lane has no detection on
  the frame at all (`isActiveLaneCell` false). The crop is explicitly
  skipped ("no object to focus on"), and the cell is faded to
  `opacity-40 saturate-50` and unclickable.

Reviewing a sequence with gaps means the eye jumps between tight crops
and full frames, and checking "did smoke actually appear here?" on a
boxless frame requires re-locating the region by hand. All frames in an
alert share one camera pose, so a crop window borrowed from neighboring
frames is geometrically valid on boxless frames.

## Behavior

In crop mode with an active object:

1. **Boxed cells are unchanged** — each still computes its own crop from
   its own boxes (`targetFill 0.8`, `maxScale 8`).
2. **Boxless cells zoom to the neighbor union**: the union of the boxes
   on the nearest boxed frame *before* and the nearest boxed frame
   *after* it (chronologically, within the active lane). Before the
   object's first boxed frame or after its last, only one neighbor
   exists, so the crop degenerates to that single frame's boxes. Same
   tuning as boxed cells — the two-frame union is naturally a touch
   wider.
3. **No boxed frames anywhere** in the active lane → boxless cells stay
   full-frame, as today.
4. **No ghost indicator** of the borrowed region — the visible region is
   the area of interest; a drawn rectangle would collide with the
   dashed "uncommitted box" vocabulary.
5. **Context-cell fade lightens in crop mode**: before/after context
   cells drop `opacity-40 saturate-50` for a subtle `opacity-75` (no
   desaturation) so faint smoke in the zoomed region is judgeable.
   Outside crop mode the current fade is unchanged. Context cells stay
   read-only and unclickable in both modes.

The rule applies uniformly to gap cells (which remain clickable — the
active lane is present) and context cells (which remain inert).

## Implementation

- **`gridCropUtils.ts`**: new pure function, e.g.
  `computeFallbackCrops(frames, activeLaneId)`, returning a
  `recordedAt → CellCrop` map covering only the frames where the active
  lane has no boxes. Internally: collect the active lane's boxed frames
  in chronological order; for each boxless frame, find nearest boxed
  neighbors on each side and feed the union of their boxes to
  `computeCellCrop`.
- **`AlertFrameGrid.tsx`**: memoize the map (`frames`, `activeLaneId`,
  `cropMode`) at grid level and pass each `AlertFrameCellView` its
  fallback crop. Cell logic becomes: active-lane cell with boxes → own
  crop (as today); otherwise in crop mode → fallback crop when one
  exists. The context-cell class string gains the crop-mode fade
  variant.

## Testing

- **Unit (`gridCropUtils`)**: mid-gap frame uses the union of both
  neighbors; frames before the first / after the last boxed frame use
  the single nearest; a lane with no boxed frames produces no entries;
  boxed frames never appear in the map.
- **Component (`AlertFrameGrid`)**: in crop mode, a gap cell and a
  context cell each get a scale transform derived from neighbors; the
  context cell uses the lightened fade in crop mode and the original
  `opacity-40 saturate-50` outside it; without an active object nothing
  changes.

## Out of scope

- Changing the crop of boxed cells or the crop-mode tuning constants.
- The object editor / cropped-loop strip (`CroppedImageSequence`),
  which have their own framing logic.
- Behavior outside crop mode — full-frame rendering and the existing
  fade stay as-is.
