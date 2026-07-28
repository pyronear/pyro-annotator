# Localize Header Redesign — Design

**Date:** 2026-07-28
**Status:** Approved
**Issue:** #227
**Scope:** Frontend only (`frontend/`).

## Problem

The sticky header on `/localize/:sequenceId` (`DetectionHeader.tsx`)
accumulated controls with the quick-submit work (#223) and is now cramped:
two rows holding back button, org/camera/time, azimuth, lat/lon, sequence
x-of-y, nav chevrons, S/M/L, three labeled checkbox toggles, Accept &
submit, review status, frames progress, accuracy badge, pills, and a
progress bar. It is also `position: fixed` with a hard-coded content
offset (`pt-28`), which already caused one overlap bug when the header
grew. The Cropped-view flipbook carries its own, differently-styled zoom
controls (large −/+ buttons, wide slider, text Reset button).

## Goals

1. One uncramped header row with only what the user glances at while
   localizing.
2. One compact, consistent control language across the header toggles and
   the flipbook zoom controls.
3. Retire the fragile fixed-position + hard-coded offset scheme.

## Removals (agreed)

Gone entirely, not hidden: the progress row (Review status, "X of Y
frames", percent, progress bar), azimuth, lat/lon, and "Sequence x of y".
Frame progress is already visible in the grid (green borders); the nav
chevrons stay (with their existing disabled/tooltip states).

## Design

### 1. Single sticky row

`DetectionHeader` renders one flex row, left to right:

- back button
- **org • camera • time** (truncating on narrow viewports)
- annotation pills + model-accuracy badge, as compact chips
- flex spacer
- prev/next sequence chevrons (loading/error/disabled states unchanged)
- **ViewToolbar** (below)
- **Accept & submit** (localize) / legacy **Submit All** (done-mode
  `allInVisualCheck` gate) — logic unchanged from #223

Positioning: `sticky top-0 z-30` with the current translucent
background/blur, replacing `fixed top-0 left-0 md:left-64 right-0`. The
header lives in the page's normal flow, so:

- the sidebar offset (`md:left-64`) is no longer needed;
- the page's `pt-28` content wrapper is deleted;
- a wrapped (taller) header on narrow viewports can never cover content —
  the offset bug class from #227 is retired.

The all-annotated state keeps a subtle green tint plus a small check chip
(replacing the removed "Completed"/progress affordances).

### 2. `ViewToolbar` component

New `frontend/src/components/detection-sequence/ViewToolbar.tsx`:

- S/M/L segmented pill (moved from `DetectionHeader`, same
  `CardSize` type and persisted state wiring via props).
- Three icon toggles sharing one compact button style: eye = Show
  predictions ("Show predictions (P)"), crop-frame = Crop
  ("Crop cells (C)"), film = Cropped view ("Cropped view"). Each is
  `aria-pressed` with a filled pressed state; lucide icons.
- Crop and Cropped view render only when `isLocalize` (same gating as
  today). All handlers and keyboard shortcuts pass through unchanged.

Props mirror today's header props: `cardSize`/`onCardSizeChange`,
`showPredictions`/`onTogglePredictions`, and optional
`cropMode`/`onToggleCropMode`, `showCroppedView`/`onToggleCroppedView`,
`isLocalize`.

### 3. Flipbook zoom strip

`CroppedImageSequence`'s zoom controls become one slim row under the
canvas built from the same compact primitives: small icon buttons for
−/+, a slim inline slider, the live `Nx` label, and a `RotateCcw` icon
button for reset (replacing the text "Reset" pill). Behavior (range 1–8,
default 4, reset-on-prop-change) is unchanged. This component is shared
with the classify page's cropped view — both pages get the consistent
styling deliberately.

## Non-goals

- No changes to quick-submit, crop math, cell states, or any grid
  behavior.
- No settings popover (rejected in favor of the icon bar).
- No relocation of the flipbook (stays centered above the grid).

## Testing

- `ViewToolbar` component tests: toggles fire their callbacks, pressed
  state reflects props, localize gating hides Crop/Cropped view, S/M/L
  fires `onCardSizeChange`.
- `DetectionHeader` tests updated: progress/azimuth/lat-lon/sequence-x-of-y
  assertions removed; submit-button, confirm-state, and navigation tests
  kept; new assertion that the header is sticky (class-based).
- Page: remove the `pt-28` expectation context; existing behavior tests
  unchanged.
- Live screenshot check (real token against the dev server) to confirm
  nothing sits under the header and the row fits at common widths.

## Affected files (expected)

- `frontend/src/components/detection-sequence/DetectionHeader.tsx`
- `frontend/src/components/detection-sequence/ViewToolbar.tsx` (new)
- `frontend/src/components/annotation/CroppedImageSequence.tsx`
- `frontend/src/pages/DetectionSequenceAnnotatePage.tsx` (drop `pt-28`)
- Tests under `frontend/tests/components/detection-sequence/`
