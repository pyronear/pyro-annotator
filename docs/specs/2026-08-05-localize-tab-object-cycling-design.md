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
- **DOM focus follows the cycle** (as in classify): the landed row receives
  real focus, giving it the focus ring and screen-reader announcement — and
  keeping Enter/Space acting on the row the cycle is on, never on an element
  a previous click left focused.
- **No active object** (FP-only alert sitting on the bare URL): Tab activates
  the first visible row.
- **Single object:** stepping re-activates the same lane — a harmless
  self-navigation.

## Suspension

The handler is inert whenever a surface with its own focusables is up, so
those stay keyboard-reachable (mirrors classify's modal guards):

- the per-frame editor (`detectionIdNum != null`),
- the "+ Add object" smoke-type picker (`addObjectPickerOpen`, inline in the
  rail),
- the missed-smoke submit dialog (`missedSmokeConfirm`).

## Accepted tradeoff

Intercepting Tab makes everything outside the cycle unreachable by native
Tab — the active row's inline Accept-boxes / Reclassify buttons, the
"+ Add object" button, the missed-smoke Yes/No radios, and Submit; they
become mouse-only. (Classify's cycle includes its missed-smoke row and
Submit as stops; localize deliberately does not — Submit was excluded by
design choice, and the rest is deferred to a future dedicated-shortcuts
pass rather than complicating the cycle with non-object stops.)

## Testing

Page-level tests alongside the existing `LocalizeAlertPage.test.tsx` patterns:

- Tab advances to the next object: URL changes to its selection route and
  focus mode follows.
- Shift+Tab steps back.
- Both directions wrap at the ends.
- FP rows join the cycle only while "show false positives" is on.
- Inert while the per-frame editor is open.
