# Localize cockpit: Tab / Shift+Tab object cycling

**Date:** 2026-08-05
**Status:** Approved

## Motivation

The classify cockpit's rail is fully keyboard-drivable: Tab / Shift+Tab cycle
its stops and a row activates the moment it is reached. The localize cockpit
(`/localize/:sequenceId`, `/localize/done/:sequenceId`) has no equivalent —
native Tab moves a focus ring across the rows, but nothing activates until
Enter/Space, and the ring escapes into the header and media chrome. Stepping
through objects — the page's core review motion — takes a click per object.

This design gives Tab / Shift+Tab classify-style one-step cycling: each press
lands on the next object and it is live immediately.

## Behavior

A capture-phase `keydown` listener on `LocalizeAlertPage` (the same pattern as
`ClassifyAlertPage`'s focus cycle) intercepts Tab / Shift+Tab and always calls
`preventDefault` — the key strictly cycles objects and never escapes to the
header or media chrome.

- **Cycle membership:** exactly the rows the rail displays, in rail order —
  `orderedObjectRows` (smoke objects first, false-positive rows appended when
  "show false positives" is on). Submit is not a stop.
- **Step:** Tab advances to the next row, Shift+Tab to the previous, wrapping
  at both ends.
- **Activation:** each step calls `activateFocus(laneId)` — the same path as
  a rail-row click. The URL replace-navigates to the object's selection route,
  the row shows selected, and the media column crops around the new object.
- **No active object** (FP-only alert sitting on the bare URL): Tab activates
  the first visible row.
- **Single object:** stepping re-activates the same lane — a harmless
  self-navigation.

## Suspension

The handler is inert whenever an overlay with its own focusables is up, so
those stay keyboard-reachable (mirrors classify's modal guards):

- the per-frame editor (`detectionIdNum != null`),
- the "+ Add object" smoke-type picker (`addObjectPickerOpen`),
- the missed-smoke submit dialog (`missedSmokeConfirm`).

## Accepted tradeoff

Intercepting Tab makes the active row's inline Accept-boxes / Reclassify
buttons and the "+ Add object" button unreachable by native Tab; they become
mouse-only. Deferred to a future dedicated-shortcuts pass rather than
complicating the cycle with per-row inner stops.

## Testing

Page-level tests alongside the existing `LocalizeAlertPage.test.tsx` patterns:

- Tab advances to the next object: URL changes to its selection route and
  focus mode follows.
- Shift+Tab steps back.
- Both directions wrap at the ends.
- FP rows join the cycle only while "show false positives" is on.
- Inert while the per-frame editor is open.
