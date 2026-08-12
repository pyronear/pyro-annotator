# Pointer-anchored zoom on the localize stage

Date: 2026-08-12

## Problem

On the object editor's canvas (`/localize/:sequenceId/object/:laneId/:detectionId`)
the wheel zooms about the image's center, wherever the pointer is. Magnifying a
plume in a corner therefore means zoom, pan, zoom, pan — and the pan is the part
that fights back, because the same handler also resets the framing.

`useBoxDrawingStage`'s wheel handler is the whole of the current behavior:

```ts
setTransformOrigin({ x: 50, y: 50 });
setZoomLevel(z => Math.max(1, Math.min(4, z + (e.deltaY < 0 ? 0.2 : -0.2))));
```

Three things are wrong with it:

1. **It ignores the pointer.** The point under the cursor moves away as you zoom.
2. **It discards the `Z` framing.** `applyView` frames the object by moving
   `transformOrigin` to the box center; the wheel hard-resets that origin to
   50/50, so one notch after pressing `Z` snaps the view back to the middle of
   the scene.
3. **Its steps are additive.** `+0.2` is a 20% jump at 1x and a 5% nudge at 4x,
   so deep zoom crawls.

There is also a latent bug on the path: `constrainPan`'s bound
`base·(z−1)/(2z)` is exactly right for a *centered* transform origin and wrong
for an off-center one, so panning inside `Z` crop view can currently drag blank
space into view.

## The transform, stated once

The `<img>` and every overlay layer share one transform. Writing `p` for a point
in image-layout pixels, `O` for the transform origin, `z` for the scale and `t`
for the pan:

```
transform: scale(z) translate(t)         (translate applies inside the scale)

s(p) = O + z·((p − O) + t)
```

`screenToImageCoordinates` inverts exactly this, which is why box drawing stays
correct at any zoom.

The root difficulty is that this has **two** positional knobs, `O` and `t`, and
pointer anchoring needs a single one to solve for.

## Design

### 1. Pan is the only positional knob

`transformOrigin` leaves the stage's state and the components' props. The origin
is always the image center (`50% 50%`, the CSS default, so nothing sets it), and
all framing lives in the pan. With `O = W/2` the model collapses to:

```
s(p) = O + z·((p − O) + t·W)
```

The stage keeps one state object rather than three pieces, so a zoom step cannot
read a stale pan:

```ts
type StageView = { scale: number; pan: Point };   // pan in FRACTIONS of the image's rendered size
```

Pan is dimensionless — a fraction of the image's rendered size, not layout
pixels. Every layer renders `translate(tx*100%, ty*100%)`. This keeps the
framing math free of layout, exactly as the percentage origin was: the clamp,
the `Z` conversion and their tests are pure numbers, and only the pointer anchor
needs live geometry.

CSS percentages in `translate()` resolve against each element's own pre-transform
border box. For the `<img>` that is the picture; for the `absolute inset-0`
overlay layers it is the canvas container — which is a shrink-to-fit flex item
wrapping only the image, so the two boxes coincide. That coincidence is
load-bearing and gets a test, not a comment.

### 2. A pure math module

`src/utils/annotation/stageViewUtils.ts` — no React, no DOM:

| Function | Contract |
| --- | --- |
| `wheelZoomFactor(e)` | `exp(−Δ·k)` with Δ normalized across `deltaMode` (line ×33, page ×400) and `k = ln(1.15)/100`, so a mouse notch (Δ≈100px) is a ~1.15 factor |
| `zoomAtPoint(view, cursorNorm, nextScale)` | `t' = (z·t + (z − z')·(c − 0.5)) / z'`, then clamped |
| `clampPan(pan, scale)` | `\|t\| ≤ (z−1)/(2z)` |
| `cropToPan(crop)` | `t = (1 − z)·(c − 0.5)/z` |

`clampPan`'s bound is dimensionless and exact for a centered origin — which is
now the only origin there is. It also subsumes the old "snap pan to 0 when the
zoom returns to 1" special case, since the bound is 0 at `z = 1`.

`cropToPan` is the algebraic equivalent of the origin-based framing: equating
`O' + z(p − O')` with `O + z(p − O) + z·t·W` gives `t = (1 − z)(O' − O)/(z·W)`.
`Z`'s framing is therefore preserved pixel for pixel, and the equivalence is
what its test asserts.

### 3. The wheel handler

```ts
const onWheel = (e: WheelEvent) => {
  e.preventDefault();
  const c = imageToNormalized(...screenToImageCoords(e.clientX, e.clientY));
  setView(v => zoomAtPoint(v, c, clamp(v.scale * wheelZoomFactor(e), 1, MAX_ZOOM)));
};
```

`imageToNormalizedCoordinates` already clamps to 0..1, so a cursor outside the
image anchors at the nearest edge rather than flinging the view.

- **Multiplicative steps**, so a notch feels the same at 1x and at 6x.
- **Scaled by delta magnitude**, so a trackpad's stream of small deltas zooms
  smoothly instead of slamming into the ceiling; a `ctrl+wheel` pinch arrives at
  this same handler and needs nothing extra.
- **Ceiling 8** (from 4), matching the grid's `MAX_SCALE`, so a small distant
  plume can fill the frame. `Z`'s own ceiling stays 3 (`OBJECT_FRAMING`); the
  wheel now pushes past it from there instead of resetting.

Wheeling inside crop view leaves the `Z` toggle **pressed**. It is a mode, not a
snapshot: the wheel refines the framing, and stepping to the next frame re-frames
the object as it does today.

### 4. Coordinate inversion

`screenToImageCoordinates` loses its `transformOrigin` parameter and reads pan as
a fraction:

```
p = (X − bounds.x − W/2)/z + W/2 − t·W
```

`TransformConfig` narrows to match. The stage hook is its only caller.

## Footprint

- `src/hooks/annotation/useBoxDrawingStage.ts` — merged view state, new wheel
  handler, `applyView` / `resetZoom` / `constrainPan` rewritten. The public API
  keeps `zoomLevel` and `panOffset` and drops `transformOrigin`.
- `src/utils/annotation/stageViewUtils.ts` — new.
- `src/utils/annotation/coordinateUtils.ts` — signature and inversion.
- `src/components/detection-annotation/DetectionAnnotationCanvas.tsx`,
  `src/components/annotation/ImageOverlays.tsx` (`DrawingOverlay`),
  `src/components/localize/add-object/AddObjectOverlay.tsx` — drop the prop,
  render `translate` in percent.
- `src/components/localize/editor/EditorShortcutsModal.tsx` — the wheel row names
  the pointer.

The add-object overlay inherits pointer zoom for free: same hook, same gesture.

**Untouched:** the grid (`AlertFrameGrid`) and `DetectionImageCard` keep their own
origin-based crop CSS. Different surface, no pan, working fine.

## Tests

`tests/utils/annotation/stageViewUtils.test.ts` carries the load:

- **Anchor invariance** — push a point through the forward transform before and
  after a zoom step and assert its screen position is unchanged. Covers zooming
  in and out, from an already-panned view, and at the pan clamp (where the anchor
  is allowed to slip, because the alternative is blank edges).
- **Clamp** — 0 at `z = 1`, `(z−1)/(2z)` above it.
- **`cropToPan` equivalence** — the new transform puts the box center at the same
  screen position the origin-based one did. This is the `Z` regression proof.
- **Delta normalization** — a line-mode notch and a pixel-mode notch produce
  comparable factors; a small trackpad delta produces a small one.

`tests/utils/annotation/coordinateUtils.test.ts` updates to the new signature and
gains a screen → image → screen round trip at `z > 1` with a nonzero pan.

In the editor tests the `Z` / `R` assertions become `scale(3) translate(20%, 20%)`
shaped and stay stub-free, plus:

- one wheel test using the existing `stubGeometry` helper, proving the anchor
  end to end through the real component;
- one test pinning container box == image box, since the percent basis depends
  on it.

`DrawingOverlay.strokes` and `DetectionAnnotationCanvas` tests drop the
`transformOrigin` prop.

## Verification

`npm run quality` and `npm test`, then a dev server from this worktree against
the shared API for a hands-on pass over
`/localize/971/object/971/16860`: wheel over a corner plume, wheel back out,
`Z` then wheel, `R`, and a pan at high zoom to confirm no blank edges.

## Out of scope

Keyboard `+` / `-` zoom, double-click zoom, gesture events beyond `ctrl+wheel`,
and any change to the grid's crop mode.
