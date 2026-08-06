# Classify Inline Object Timelines

**Date:** 2026-08-06
**Status:** Approved

## Goal

Give `/classify/:id` the same object-timeline integration `/localize/:sequenceId`
has: a per-frame timeline strip inline in each object row of the rail, with a
legend, instead of the separate non-interactive `ObjectPresenceStrip` card that
sits below the rail today.

## Background

The codebase currently has three timeline implementations:

- **Localize inline strip** — hand-rolled inside
  `frontend/src/components/localize/LocalizeObjectRow.tsx`: one clickable
  segment button per alert frame (`frame-segment-${slug}-${i}` inside
  `object-timeline-${slug}`), styled by a 4-state `ObjectFrameStatus`
  (`confirmed | pending | empty | absent`), plus
  `LocalizeTimelineLegend` showing only the statuses on screen.
- **`ObjectPresenceStrip`** (`components/sequence-annotation/`) — classify's
  current card: binary present/absent, segments are plain `<div>`s, whole row
  is the only button, self-hides under 2 objects. Its only consumer is
  `ClassifyAlertPage`.
- **`ObjectStatusStrip`** (`components/sequence-annotation/`) — the older rich
  strip, now only used by the localize editor's `AcceptRemainingPopover`.
  Untouched by this work.

The classify media panel's detections view shows two self-contained looping
players (`FullImageSequence` full-frame + `CroppedImageSequence` crop), both on
an internal 200 ms interval with no external seek or pause API. The full-frame
player plays the **alert's frame union** (`xyxyn: null` frames render box-less),
so every union frame index is a real, showable frame.

## Design

### 1. Shared strip component: `ObjectRowTimeline`

Extract the inline timeline markup out of `LocalizeObjectRow` into
`frontend/src/components/annotation/ObjectRowTimeline.tsx` (alongside the other
cross-page annotation components). Props:

- `slug: string` — preserved testids: root `object-timeline-${slug}`, segments
  `frame-segment-${slug}-${i}`.
- `segments: ObjectFrameStatus[]` — one entry per frame, in alert frame order.
- `color: string` — the object's accent color.
- `onSegmentClick?: (index: number) => void`.
- `highlightIndex?: number | null` — segment that briefly shows a fading ring
  (classify's click feedback; localize does not use it).

The status vocabulary stays `ObjectFrameStatus`
(`confirmed | pending | empty | absent` from
`utils/annotation/alertLocalizeUtils.ts`); segment styling moves with the
markup. `LocalizeObjectRow` becomes a thin consumer. The extraction is
behavior-preserving: localize's existing row and page tests must pass
unchanged.

### 2. Shared legend: `TimelineLegend`

Generalize `LocalizeTimelineLegend` into a shared `TimelineLegend`
(`frontend/src/components/annotation/TimelineLegend.tsx`) taking
`entries: { status: ObjectFrameStatus; label: string }[]`. Localize passes its
current labels (derived, as today, from `timelineLegendStatuses` — only
statuses actually on screen). Classify renders it below the object rows inside
`DecisionRail`, with its own copy — "Detected" for `confirmed`, "Not on this
frame" for `absent` — again showing only statuses present in the rail.

### 3. Classify wiring

- Each card row (`components/classify/ObjectRow.tsx`) in the `DecisionRail`
  renders its lane's strip. Statuses are derived from data the page already
  fetches: union frame timestamps × lane detections — present maps to
  `confirmed` (solid fill), absent to `absent`. Presence is deliberately
  lane-level (same rationale as today's `presenceStripObjects` derivation), so
  cards sharing a lane show identical strips.
- Strips are always visible — including single-object alerts and locked
  (read-only) rows. Placeholder ("not imported yet") rows and the missed-smoke
  row get no strip.
- `ObjectPresenceStrip` is deleted along with its render site and the
  "hide under 2 objects" rule; its `handlePresenceObjectClick` behavior is
  subsumed by segment clicks (below).

### 4. Segment click → select + seek

Clicking a segment on any row:

1. Activates that card (`activeCardKey`) and sets `activeSection` to
   `'detections'` — same as today's presence-strip row click, including
   scrolling the card into view. Clicking a segment on an already-active row
   skips re-activation.
2. Seeks the full-frame player. `FullImageSequence` gains an optional
   `seekRequest?: { index: number; nonce: number }` prop: on nonce change it
   jumps `currentIndex` to `index`, holds that frame for ~2 s (loop interval
   suspended), then resumes the 200 ms loop. Out-of-range indexes (frame list
   changed mid-flight) are ignored.
3. Shows a brief fading ring on the clicked segment (short-lived state in
   `ClassifyAlertPage`, passed as `highlightIndex` to that row's strip,
   cleared after 2 s to match the player hold).

Absent segments are clickable too — the player shows the union frame the
object is missing from, which is useful context. The cropped loop is untouched:
its frame list (own boxes only) does not align with union indexes.

### 5. Testing

- Component tests for `ObjectRowTimeline` (segment statuses, click callback,
  highlight ring) and `TimelineLegend` (renders given entries only).
- Localize row/page tests pass unchanged — the testids and rendering are
  preserved by the extraction.
- Classify page tests: rows render strips with correct presence mapping;
  segment click activates the card and emits a seek request; locked rows show
  strips; legend renders classify labels; `ObjectPresenceStrip` render site is
  gone.
- `FullImageSequence`: seek-jump, ~2 s hold, resume — with fake timers.
- Tests live under `frontend/tests/` (never run prettier on `tests/**`).

## Out of scope

- Live playhead (highlighting the currently-playing frame across strips).
- Seeking the cropped loop.
- Any new API fetches — classify keeps its current data (no detection
  annotations); box-status semantics (`pending`/`empty`) never appear on
  classify.
- `ObjectStatusStrip` and the localize editor's popover.
