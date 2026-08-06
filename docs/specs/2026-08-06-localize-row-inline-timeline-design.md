# Localize rail: inline per-object timeline

**Date:** 2026-08-06
**Status:** Approved
**Scope:** Frontend only — `/localize/:sequenceId` (and its `/localize/done` twin), which share `LocalizeAlertPage`.

## Problem

The localize cockpit lists every object twice. The rail shows one
`LocalizeObjectRow` per object (color dot, label, smoke type, progress
fraction, status chip); a separate "Timeline" card below the rail
(`ObjectStatusStrip`) re-lists the same objects in the same order with the
same colors, adding only the per-frame status bar. The two lists must be kept
index-aligned by hand (`orderedObjectRows` feeds both), and the reader's eye
has to jump between a row and its twin to connect an object's numbers to its
frames.

## Design

Fold each object's timeline strip into its own rail row and delete the
standalone Timeline card. One list, one row per object: header line on top
(what the object is and where it stands), segment bar below (which frames,
in what state).

```
┌────────────────────────────────────────────┐
│ ● Object 1 · wildfire        4/7  [3 left] │   ← header (activate button)
│ ▮▮▮▯▯░▮                                    │   ← per-frame segments (buttons)
└────────────────────────────────────────────┘
```

### `LocalizeObjectRow` restructure

The card stops being one big `role="button"` div — a container can't stay a
button once it holds buttons (the same invalid-nesting rule that moved the
row's actions out in PR #298). New structure:

- **Card**: plain `div`, keeps the current frame styling (selection accent,
  `dimmed`, hover) and testids (`data-testid="localize-object-row-…"`,
  `data-active`, `data-dimmed`).
- **Header**: a real `<button>` carrying today's entire row line unchanged —
  dot, label, smoke type (or false-positive types), `confirmed/present`
  fraction, status chip. Clicking it activates the object (`onActivate`),
  exactly as clicking the row does today. The `forwardRef` moves here: the
  page's Tab cycle focuses the header button, and the hand-rolled
  Enter/Space handler goes away (a native button gives that for free).
- **Strip**: below the header, the segment bar from `ObjectStatusStrip` —
  one segment `<button>` per **alert frame** (see alignment), styled by
  status: `confirmed` solid fill in the object's color, `pending` 40%
  opacity fill, `empty` inset outline, `absent` neutral track. Clicking a
  segment calls a new `onFrameClick(timestamp)` prop; the page activates the
  object and scrolls/highlights that frame — the same
  `handleSegmentClick(laneSequenceId, ts)` behavior the Timeline card has
  today.

New props: `frameTimestamps: string[]` (the alert-wide ordered frame list),
`statusByTimestamp`, `onFrameClick`. The redundant "Go to Object N" label
button from the old strip dies — the header is that button now.

### Cross-row alignment

Every row receives the same `frameTimestamps`, derived once in
`LocalizeAlertPage` from `frameModel.frames` (already chronologically
ordered — no re-sort needed). Since all cards share the rail's width and the
strip spans the card, frame N sits at the same x in every row, preserving
the cross-object comparison the old card gave (Object 1 present where
Object 2 is absent). The old strip's internal union-of-timestamps
computation is dropped along with the component.

### Type ownership

`ObjectStatusStripStatus` and `ObjectStatusStripObject` currently live in
the component and are imported by `alertLocalizeUtils.ts`, which produces
the data. With the component deleted, the types move into
`alertLocalizeUtils.ts` (renamed `ObjectFrameStatus` / `ObjectFrameRow` to
shed the component name); `LocalizeObjectRow` and the page import from
there. Producer owns the shape; consumers import it.

### What stays as-is

- **False-positive rows** get the strip too, when the toggle shows them —
  parity with today's Timeline card, which includes them. Their header keeps
  omitting the fraction (no localization work to count).
- **Row grouping and order**: smoke objects first, false-positive divider,
  FP rows — unchanged.
- **Missed-smoke row, submit footer, undecided banner, editor**: untouched.
- Classify's `ObjectPresenceStrip` is a different component and untouched.

### Deletions

- `ObjectStatusStrip.tsx`, its export lines in
  `sequence-annotation/index.ts`, and the `<ObjectStatusStrip …/>` block +
  `mt-4` wrapper in `LocalizeAlertPage` (the rail alone fills and scrolls
  the right column).
- `tests/components/sequence-annotation/ObjectStatusStrip.test.tsx` — its
  behavioral coverage (status appearance, segment clicks, selected accent)
  moves to `LocalizeObjectRow`'s tests.

## Error handling

No new failure modes: the strip renders from props already computed for the
rail; a timestamp missing from `statusByTimestamp` renders `absent`, as
today. No data fetching moves.

## Testing

- **`LocalizeObjectRow` tests** (extend existing): header button activates;
  segments render one per `frameTimestamps` entry with the right
  status/appearance and accessible names; segment click reports its
  timestamp; FP row shows strip but no fraction; Enter/Space on the header
  activates (native button semantics).
- **`LocalizeAlertPage` tests** (update existing): timeline-card assertions
  move to the rows (segment click still scrolls/highlights the right frame,
  Tab cycle still lands on rows via the header button); assert the
  standalone Timeline card is gone.
- Full suite green; baseline before this work: 88 files / 1131 tests
  passing.
