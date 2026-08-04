# Cropped View: Stable Square Viewport — Design

**Date:** 2026-08-04
**Status:** Approved
**Component:** `frontend/src/components/annotation/CroppedImageSequence.tsx`

## Problem

The cropped loop shown in each object section of the classify cockpit (and in
the localize page's lane view) has three UX defects:

1. **Too little context.** The crop is the track's average bbox plus 20%
   padding — a tight, arbitrary-aspect sliver. Smoke is judged against its
   surroundings (terrain, horizon, sky), which the crop mostly excludes.
2. **Layout jumps.** The canvas element is sized `crop × zoom`, so changing
   zoom resizes the element and pushes the controls below it around.
3. **Control clutter.** A slider plus −/+/reset strip below the canvas for
   what is essentially one gesture (zoom in/out).

## Decision

Rework `CroppedImageSequence` in place (all consumers inherit the change):

- **Classify cockpit** (`ClassifyMediaPanel`) — the target.
- **Localize page** (`DetectionSequenceAnnotatePage`) — has the same
  layout-jump problem; inherits the fix deliberately.
- Legacy `ObjectCard` / `AnnotationInterface` — unrouted, irrelevant.

No variant prop; one behavior everywhere.

## Design

### Framing model

- Keep the existing average-bbox computation over the track's `xyxyn` boxes.
- The visible region is always a **square** centered on the bbox center:
  - Default side: `max(bboxWidth, bboxHeight) × CONTEXT_FACTOR`, with
    `CONTEXT_FACTOR = 3` (object occupies roughly a third of the window, so
    surroundings dominate).
  - Clamped inside the image by **shifting** the square (never shrinking),
    and capped at the image's shorter dimension.
- **Zoom** divides the side: visible side = `defaultSide / zoom`.
  - `zoom = 1` is the default wide framing — the minimum, and the implicit
    "reset" state.
  - Max zoom is a flat 8× cap (amended 2026-08-04: the original
    keep-bbox-visible ceiling ≈2.5× was too shallow for pixel-peeping —
    zooming may crop into the bbox).
- Geometry lives in a pure function in `frontend/src/utils/annotation/`
  (e.g. `computeSquareCrop(avgBbox, imageDims, zoom)` returning the source
  rect in normalized coordinates), unit-tested independently of the canvas.

### Viewport & rendering

- Fixed square viewport: responsive width capped at ~420px, centered,
  `aspect-square`. The canvas is sized to the viewport once (DPR-aware) and
  **never changes size with zoom** — the source rect changes instead.
- Image fetching, preloading, frame looping, and loading/error states are
  unchanged.

### Controls

- The below-canvas strip (−, slider, +, value, reset) is removed.
- A corner pill overlays the viewport bottom-right: **− / current zoom / +**,
  styled like the whole-alert player's overlay chrome.
- **Scroll-wheel zoom** over the viewport (preventDefault while hovering so
  the page doesn't scroll).
- No reset control — min zoom is the default framing.
- Zoom resets to 1× when the object (bboxes/sequence) changes, as today.

## Testing

- Unit tests for the geometry function: centering, edge clamping (shift not
  shrink), default side, zoom bounds (min 1, flat 8× cap), degenerate
  bboxes.
- Component tests updated: square viewport renders, zoom buttons clamp at
  both ends, no reset control present.
- Existing consumer tests (`ClassifyMediaPanel`, page tests) keep passing —
  the component mock boundary is unchanged.

## Out of scope

- Fullscreen for the cropped view (Option B) — revisit if inline size proves
  insufficient in practice.
- Any layout change of the object section (Option C).
- Pan/drag inside the viewport.
