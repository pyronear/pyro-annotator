# Classify cockpit: stop the object player from resizing the page

Date: 2026-08-11
Status: approved

## Problem

On `/classify/:id`, the object section of the media column moves continuously
while the frame loop plays. The column changes height, which changes the page
height, which toggles the window scrollbar and reflows the whole cockpit. The
missed-smoke section of the same page does not do this at all.

## Root cause

Both symptoms come from `frontend/src/components/annotation/FullImageSequence.tsx`.

1. **Nothing reserves the height.** The image container is
   `width: 1280px; height: auto` and the image inside it is `w-full h-auto`.
   The container's height is therefore whatever the `<img>` decodes to. An
   `<img>` whose `src` has no decoded content has zero intrinsic height, so on
   such a frame the container collapses to roughly nothing.

2. **The loop lands on frames that have not decoded yet.** The playback
   interval starts as soon as *two* images report `loaded`, then advances
   `(prev + 1) % images.length` across the whole list. For the first several
   seconds it therefore steps onto entries whose image is still in flight.

Together: every uncached frame collapses the container for ~200ms, then the
next cached frame restores it. The "Loading image…" overlay is
`absolute inset-0`, so inside a collapsed box it is invisible — the user sees
the jump, not a spinner.

A third, smaller contributor: the interval effect lists `images` in its
dependencies, so the 200ms timer is torn down and recreated on *every*
individual image load. During the initial load burst the timer keeps resetting
and playback paces erratically.

`SequencePlayer` (the missed-smoke player) is immune for exactly the reasons
`FullImageSequence` is not: a fixed `aspect-video` container, an
`object-contain` image that cannot resize that container, and preloading via
`useImagePreloader` with ahead/behind windows. `CroppedImageSequence` is
likewise immune — a fixed `aspect-square` canvas viewport.

## Non-goals

- **The loading placeholder is out of scope.** When `isLoading` is true the
  component still returns a bare `py-8` text row instead of the player, so
  first load and alert-advance still snap once. That is a transition, not the
  continuous motion this change targets, and the user explicitly scoped it out.
- **No port onto `useImagePreloader`.** Converging the two players is a real
  refactor of a component with three test files, a seek-hold protocol and
  sibling-overlay geometry, and the hook is typed around `Detection[]` rather
  than `FullImageFrame[]`. Not warranted by this symptom.
- No changes to `CroppedImageSequence`, `ClassifyMediaPanel`, `DecisionRail`,
  or the decision rail's row-expansion behaviour.

## Design

All changes are in `FullImageSequence.tsx`. Both of its consumers —
`ClassifyMediaPanel` (the classify cockpit) and
`sequence-annotation/ObjectCard` (the legacy `AnnotationInterface` flow) —
render the same alert frames and get the fix without changes of their own.

### 1. Reserve the box

The image container declares its own aspect ratio and stops deriving height
from the image:

- container: `style={{ width: 1280, maxWidth: '100%', aspectRatio: aspect ?? 16 / 9 }}`,
  plus `flex items-center justify-center bg-gray-900` alongside the existing
  `relative … overflow-hidden` chrome.
- image: `max-w-full max-h-full object-contain`, replacing `w-full h-auto`. The
  image can no longer influence the container's size.

`aspect` is a `number | null` piece of state, set once from
`naturalWidth / naturalHeight` on the first frame that decodes, and reset to
`null` alongside the other per-frame-list resets when `frameKey` changes, so a
new alert re-measures. The `16 / 9` default covers the window before the first
decode.

Locking to the measured ratio rather than hard-coding `aspect-video` means a
non-16:9 camera is never letterboxed; the cost is a single settling change on
load, from the default to the measured value.

The overlay geometry needs no change. `handleImageLoad` already derives
`offsetX` / `offsetY` from `imgRect.left - containerRect.left`, which is
correct for an image centred inside a larger box. One accepted consequence: at
the instant the aspect locks, the image's rect changes after `imageInfo` was
measured, so the boxes are one frame stale. `onLoad` fires on every frame swap,
so this self-heals within ~200ms.

### 2. Advance only to decoded frames

The interval's `setCurrentIndex` scans forward with wraparound for the next
entry with `loaded === true`, and returns the current index unchanged if none
is ready.

Errored frames stay in the rotation deliberately. "Not loaded yet" is
transient, so excluding such a frame is temporary and it rejoins the loop when
it arrives; an error is permanent, and excluding it would silently shorten the
loop and hide a broken frame. With the container now fixed, an errored frame
shows its overlay without moving anything.

The `images` array moves behind a ref that the interval callback reads, so the
interval is created once per play/pause transition instead of once per image
load. The effect's dependencies become `[canPlay, isLoading, isHolding]` and no
longer include `images`.

`canPlay` is the existing start condition collapsed into a single boolean —
`images.length > 1 && loadedCount > 1`. It is still derived from `images` on
each render, but because it is a boolean it flips false→true once, early in the
load, and stays true; the effect therefore re-runs on that one transition
rather than on every individual image load. The remaining conditions (not
loading, not holding) are unchanged.

### Interaction with `seekRequest`

Unchanged. The seek effect sets `currentIndex` directly and sets `isHolding`,
which stops the interval for `SEEK_HOLD_MS`. A seek may therefore land on a
not-yet-decoded frame, which is correct: the user asked for that specific
frame, and it now shows the loading overlay inside a stable box rather than
collapsing it.

## Testing

New file `tests/components/annotation/FullImageSequence.stability.test.tsx`,
following the `vi.mock('@/services/api')` pattern of the three existing
`FullImageSequence` test files:

1. **Reserved box** — the image container carries an `aspect-ratio` style
   before any image has decoded.
2. **Skip undecoded frames** — with frame 1 decoded and frame 2 not, advancing
   the 200ms interval lands on the next decoded frame rather than frame 2.

Test (2) requires stubbing `global.Image` with a controllable `onload`. jsdom
never fires load events for `new Image()`, which is why the existing three test
files never exercise the playback interval at all; the same gap means those
files are not expected to be affected by either change.

Regression surface to keep green: `FullImageSequence.seek.test.tsx`,
`FullImageSequence.frameSwitch.test.tsx`,
`FullImageSequence.overlays.test.tsx`, `ClassifyMediaPanel.test.tsx`,
`ObjectCard.test.tsx`, plus `npm run type-check` and `npm run lint`.

Manual verification: on `/classify/:id` with a fresh alert, the media column's
height must not change once the player is showing, from the first loop pass
onward, including while frames are still arriving.

## Risks

- `ObjectCard` (legacy `AnnotationInterface`) shares the component. It renders
  the same alert frames in a narrower column, so the reserved box is the same
  shape it already resolves to; visual change there should be nil.
- If an alert ever mixes resolutions across frames, the box keeps the *first*
  decoded frame's ratio and later frames letterbox inside it. That is the
  desired trade — a stable box beats a per-frame-accurate one.
