# Localize cockpit: fixed panes, scrolling grid

**Date:** 2026-08-04
**Scope:** `/localize/:sequenceId` and `/localize/done/:sequenceId` (`LocalizeAlertPage`)

## Problem

Everything on the localize cockpit scrolls together. Scrolling down to reach a
later frame carries away the "Frames" control panel — the object's name, its
accept/reject actions, the view toolbar — and the whole page header. The
Objects rail is `lg:sticky`, so it survives, but it is the only thing that
does. An annotator working the bottom of a long grid loses the controls that
act on what they are looking at.

## Goal

Everything except the frame cells stays put. The grid is the only thing that
scrolls.

## Design

### 1. Header compacted to one row

`LocalizeAlertPage`'s fixed header currently stacks a back link over a row of
title / recorded-at / progress badge, costing ~80px. It becomes a single
48px row: `← Alerts`, `org · camera`, recorded-at, progress badge. No
information is dropped.

`h-12` fixed rather than derived from padding, so the reserve below it is an
exact number rather than a guess. The root's reserve drops from `pt-20` to
`pt-8`: `AppLayout`'s `p-6` already contributes 24px, so content starts 8px
under the bar.

This diverges from `ClassifyAlertPage`, which keeps the two-row header. The
two pages mirror each other, but only localize was asked for; classify can
follow later if the compaction reads well.

### 2. Cockpit becomes a viewport-height shell at `lg:`

Below `lg` nothing changes — the columns stack and the page scrolls normally,
which is the only sensible behavior on a narrow viewport. At `lg` and up:

```
root      flex gap-4 pt-8  lg:h-[calc(100vh-3rem)] lg:flex-row lg:overflow-hidden
                            └─ 3rem = AppLayout's p-6 top + bottom
├ left    lg:flex-[1.5] lg:min-w-0 lg:flex lg:min-h-0 lg:flex-col
│  ├ LocalizeActionPanel ("Frames")   lg:shrink-0   ← pinned
│  ├ CroppedImageSequence (when disclosed)  shrink-0  ← pinned
│  └ <div lg:flex-1 lg:min-h-0 lg:overflow-y-auto>  ← the only scroller
│       └ AlertFrameGrid
└ right   lg:flex-1 lg:min-w-0 lg:flex lg:min-h-0 lg:flex-col lg:overflow-y-auto
   ├ LocalizeRail (Objects)                         ← pinned column,
   └ ObjectStatusStrip (Timeline)                     scrolls internally if tall
```

Notes on the mechanics:

- `lg:items-start` comes off the root so both columns stretch to full height.
- Every flex-column ancestor of a scroller needs `min-h-0`; without it the
  default `min-height: auto` lets the content push the column past the
  viewport and the page scrolls instead of the grid.
- The right column loses `lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)]`.
  It is now a real fixed-height flex child, so the max-height is structural.
  Objects and Timeline scroll together inside it when they outgrow the column.
- `scrollIntoView({ block: 'center' })` on `frameRefs` — used by the `?frame=`
  deep link and by timeline segment clicks — keeps working. It resolves
  against the nearest scrollable ancestor, which becomes the grid wrapper.

### 3. The cropped loop stays, pinned above the grid

`CroppedImageSequence` renders in the media column between the Frames panel
and the cells, disclosed by the `PlayCircle` button in the panel's controls
(PR #283). It stays exactly there and keeps that trigger — this change only
places it in the pinned region rather than the scrolling one, so the loop and
the grid it is cropped from are on screen together, and adds `shrink-0` so
the loop keeps its full height while the grid takes what is left.

An earlier draft of this spec deleted the loop outright. PR #283 landed
first and re-homed it out of the way of the Frames panel, which is what the
deletion was for; deleting it as well would have reverted a shipped feature
for no remaining reason.

## Testing

The full frontend suite is green before the change and must be green after.

- No cropped-loop test changes: the loop's behavior is unchanged, so PR
  #283's cases carry over as they are.
- Add a case asserting the grid sits in its own `overflow-y-auto` container
  while the Frames panel and the rail do not, so a later refactor cannot
  silently return the page to a single page-level scroll.

Layout itself is verified visually in the browser at `lg` and below `lg`,
per the project's frontend visual-check recipe — jsdom does not lay out, so
the class assertions above are a regression guard, not proof.

Also pinned: a cell click activates a lane WITHOUT entering focus mode.
That distinction is deliberate — opening the editor should not flip the grid
behind the modal into crop-on and small cards — and no test covered it for
the click path.

The header compacts to one row, so nothing wraps; the recorded-at timestamp
hides below `sm` rather than squeezing the title to zero width and pushing
the progress badge off a bar that cannot scroll.

## Out of scope

- `ClassifyAlertPage`'s header and cockpit.
- Any change to `AppLayout`'s scroll container.
- `CroppedImageSequence` itself, its trigger, or its other consumers.
