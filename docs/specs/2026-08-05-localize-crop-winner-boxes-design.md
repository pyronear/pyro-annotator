# Winner boxes on the localize cropped loop

**Date:** 2026-08-05
**Status:** Approved

## Problem

On `/localize/:sequenceId`, the cropped loop (the play-circle toggle above the
frame grid) animates the active object's crops across its frames, but never
shows *where* the current boxes are inside the crop. The annotator sees the
plume loop but not the boxes that will be (or were) submitted for it, so
judging whether the boxes actually track the smoke means leaving the loop for
the per-frame editor.

## Feature

Draw the current winner boxes for the active object on top of the animated
cropped view, in the object's color.

"Winner" is exactly what `collectLaneBoxes` already computes per frame — no
new data or semantics:

- committed annotation boxes for done frames,
- `getWinningBoxes` (auto layer if it has ≥1 box, else engine) for
  un-annotated frames,
- engine context boxes for false-positive lanes.

Those boxes are already the `bboxes` prop of `CroppedImageSequence`; today
they only steer the averaged crop window.

## Design

### Component API

`CroppedImageSequence` gains one optional prop:

```ts
/** Draw each frame's boxes on the crop, in the accent color. */
showBoxes?: boolean; // default false
```

`LocalizeAlertPage` passes `showBoxes` at its single call site. The other
consumers (`ClassifyMediaPanel`, `ObjectCard`) are untouched and keep today's
box-free rendering.

The overlay is always on when the loop is open — no per-viewport toggle. The
loop itself already sits behind the play-circle toggle.

### Drawing

In `drawToCanvas`, after the existing `drawImage`, when `showBoxes` is set:

1. Collect **all** boxes sharing the current frame's detection:
   `bboxes.filter(b => b.detection_id === bboxes[currentIndex].detection_id)`.
   The loop makes one image entry per box, so a 2-box detection appears as two
   consecutive identical frames; drawing only `bboxes[currentIndex]` would
   flicker between the two boxes. Drawing the detection's full set renders
   both frames identically.
2. Map each normalized `xyxyn` into canvas space through the already-computed
   crop rect — the exact inverse of the image transform:
   `cx = (x * naturalWidth - crop.x) / crop.size * CANVAS_RES` (same for y
   with `naturalHeight`).
3. `strokeRect` with `strokeStyle = accentColor ?? '#f97316'` and
   `lineWidth = 4` (≈2 CSS px at the 420 px display ceiling, matching the
   `border-2` weight used by box overlays elsewhere).

Boxes partially outside the crop window (possible at high zoom) clip
naturally at the canvas edge. No new state; fetching, animation, and zoom are
unchanged. Canvas stroking (not the DOM-div overlay convention of
`ImageOverlays.tsx`) because this component is already fully canvas-based:
reusing the same crop rect in the same draw call makes box/image drift
impossible, and zoom comes for free.

### Testing

Extend the `CroppedImageSequence` tests with a mocked canvas 2D context:

- with `showBoxes` and a known bbox + zoom, `strokeRect` receives the exact
  transformed rect;
- without `showBoxes`, no `strokeRect` call;
- two boxes on one detection: both stroked on that frame.

## Out of scope

- Box overlays in the classify cockpit or `ObjectCard`.
- A show/hide control inside the crop viewport.
- Labels, confidence scores, or per-layer line styles on the overlay.
