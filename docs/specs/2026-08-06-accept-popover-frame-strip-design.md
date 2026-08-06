# Accept-boxes popover: frame counter + object timeline

**Date:** 2026-08-06
**Status:** Approved
**Scope:** Frontend only — the localize object editor's "Accept boxes" popover.

## Problem

On `/localize/:sequenceId/object/:laneId/:detectionId`, clicking **Accept
boxes** opens `AcceptRemainingPopover`: a count sentence, an animated
`CroppedImageSequence` loop of the post-accept track, an optional gap
warning, and the confirm button. The loop gives no sense of position — you
cannot tell which frame you are looking at, how many frames the track
covers, or where the accepted frames sit relative to committed ones and
gaps. The rest of the page answers those questions with the rail's
`ObjectStatusStrip` timeline; the popover should speak the same language.

## Design

Three additions, all reusing existing components and data:

1. A **frame counter** ("Frame 5 of 12") that tracks the animated loop.
2. A **single-object `ObjectStatusStrip`** embedded in the popover, showing
   the object's per-frame status *as it is now* (pre-accept): committed
   frames solid, to-be-accepted frames faded, gaps outlined, off-object
   frames neutral. The faded segments visually answer "which frames does
   this button fill?"; the outlined ones anchor the gap warning.
3. A **playhead**: as the loop animates, the strip segment for the frame
   currently shown is highlighted, in sync with the counter.

### 1. `ObjectStatusStrip` (shared component — two optional props)

`frontend/src/components/sequence-annotation/ObjectStatusStrip.tsx`

- `variant?: 'card' | 'bare'` (default `'card'`). `bare` drops the outer
  card chrome (`rounded-lg border border-line bg-paper p-4`) and the title
  eyebrow so the strip embeds cleanly inside the popover. The rail's usage
  (`LocalizeAlertPage`) passes nothing and is untouched.
- `playhead?: { objectIndex: number; timestamp: string }`. The segment of
  that object at that timestamp renders highlighted: full opacity plus an
  inset white marker merged into the segment's `boxShadow` (the track is
  `overflow-hidden`, so an outer ring would be clipped at this height), and
  `data-playhead="true"`. Undefined reproduces today's rendering exactly.
- Interactivity needs no change: `onSegmentClick` / `onObjectClick` are
  already optional; the popover omits them for a static strip.

### 2. `CroppedImageSequence` (shared component — one optional prop)

`frontend/src/components/annotation/CroppedImageSequence.tsx`

- `onFrameChange?: (index: number, detectionId?: number) => void`, invoked
  from the existing animation interval tick and when the index resets to 0
  (boxes changed). `detectionId` is `bboxes[index]?.detection_id`. No other
  behavior changes; existing callers are unaffected.

### 3. `AcceptRemainingPopover`

`frontend/src/components/localize/editor/AcceptRemainingPopover.tsx`

- New prop: `entries: FilmstripEntry[]` — already computed by
  `LocalizeObjectEditor` and in scope at the popover's render site.
- Status mapping (entry → `ObjectStatusStripStatus`), keyed by
  `entry.recordedAt`:
  - `committedSource` set → `confirmed`
  - `inObject && availableSource` (no committed) → `pending`
  - `inObject` with neither → `empty`
  - `!inObject` → `absent`
- Renders `ObjectStatusStrip` with
  `objects={[{ label: objectLabel, color: objectColor, statusByTimestamp }]}`
  and `variant="bare"`, below the crop loop.
- Tracks the loop's current `detection_id` in local state via
  `onFrameChange`; maps it to an entry to derive both the playhead
  timestamp and the counter index.
- Counter text "Frame {entryIndex + 1} of {entries.length}" right-aligned
  directly above the strip (beside the eyebrow label it forced the label to
  wrap) — position among *all* alert frames, the same language as the
  filmstrip summary. Because the loop only plays frames that have boxes,
  the counter visibly skips gap frames (…4, 6…) and the outlined gap
  segment never receives the playhead.

## Edge cases

- Loop still loading or errored: `onFrameChange` reports the starting
  frame on mount, so the counter and playhead show the first boxed frame
  immediately (accurately) while the crop still shows its spinner.
- Reported `detection_id` not found in `entries` (should not happen —
  `previewBoxes` and `entries` derive from the same lane): counter hidden,
  strip static.

## Testing

Vitest, under `frontend/tests/` (mirroring existing test locations):

- **ObjectStatusStrip**: `bare` drops card chrome and title; `playhead`
  highlights exactly the matching segment; no `playhead` → status-quo
  rendering (existing tests keep passing).
- **CroppedImageSequence**: with fake timers, `onFrameChange` fires with
  advancing indices and the matching `detection_id`.
- **AcceptRemainingPopover**: entries map to the four statuses correctly;
  the counter renders "Frame N of M" from the reported frame; gap frames
  render outlined and never highlighted.
