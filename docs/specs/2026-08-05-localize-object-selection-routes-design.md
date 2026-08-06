# Localize cockpit: URL-addressed object selection

**Date:** 2026-08-05
**Status:** Approved

## Motivation

Arriving on `/localize/:sequenceId` today lands with no object selected:
`activeLaneId` starts null, and the annotator's first act is always the same
click on the first rail row. Selection is also purely local state — there is
no URL for "this object is selected in the cockpit," even though the per-frame
editor already has real routes (`/localize/:sequenceId/object/:laneId/:detectionId`).

This design makes the selected object part of the URL and auto-selects the
first workable object on arrival.

## Behavior on arrival

Navigating to a bare `/localize/:sequenceId` (or `/localize/done/:sequenceId`)
replace-redirects, once the alert's frame model has loaded, to
`/localize/:sequenceId/object/:laneId` for the **first workable smoke object**.

Fallbacks, in order:

1. First workable smoke object (rail order).
2. If none are workable (all done — the normal done-mode case): first smoke
   object.
3. If there are no smoke lanes at all (FP-only view): stay on the bare URL
   with no selection.

Auto-selection enters **object-focus mode**, exactly as if the annotator had
clicked the first workable row: the row shows selected, the cells crop-zoom
around the object's boxes, and the cards drop to small. (Revised 2026-08-05
after live review — the original design chose "active only", but seeing it,
arriving already looking at the object is what the workflow wants.)
Directly-loaded selection URLs and editor-close navigation stay
non-focusing: a reload reproducing "where you were" shouldn't silently force
crop-on.

## Routes

New child route, declared beside the editor's:

```
/localize/:sequenceId/object/:laneId          (queue provenance)
/localize/done/:sequenceId/object/:laneId     (done provenance)
```

- Added via a new `localizeObjectSelectRoute(done)` builder in
  `src/utils/routes.ts`, mirroring `localizeObjectRoute(done)`; a
  `localizeObjectSelect(sequenceId, laneId, done)` builder constructs concrete
  paths. Route pattern and `useMatch` read the same string so they cannot
  drift.
- Mounted as absolute-path **child routes** of the alert page's route (the
  same trick the editor route uses), so selection changes never remount
  `LocalizeAlertPage`.
- The editor URL becomes literally the selection URL plus `/:detectionId`.
- `parseLocalizeReturn` widens to accept the optional `/object/<laneId>`
  segment (`/localize/(done/)?<id>(/object/<laneId>)?` plus optional query),
  so the reclassify round-trip returns to the object you left.

## State: URL is the source of truth for `activeLaneId`

`LocalizeAlertPage` stops holding `activeLaneId` in `useState`. Instead it
derives it from route matches: the selection match, or the editor match while
the editor is open. Consequences:

- "Set active" becomes a `replace` navigation to the object URL.
- Rail clicks keep their focus-mode behavior (still local state) layered on
  top of the navigation.
- The alert-change reset no longer needs to clear the lane (the URL changes
  with the alert), and the existing editor→state sync effect
  (`if (modalLaneId != null) setActiveLaneId(modalLaneId)`) is deleted.
- **Deliberate behavior change:** a second click on the focused rail row exits
  focus mode but keeps the object active (URL unchanged). Clearing it would
  bounce through the bare URL and re-auto-select the first object — a jump
  that would feel broken.

## History semantics

- Auto-select redirect and every selection change: `replace` — Back returns
  to the queue/Done list, not through each selection made.
- Opening the editor keeps its current `push` behavior.

## Edge cases

- **Unknown `laneId`** (stale link, lane removed after reclassify):
  replace-redirect to the bare URL, which re-runs auto-select.
- **FP lanes are not URL-selectable.** A URL naming an FP lane falls back the
  same way as an unknown lane.
- Lane validation happens only after the frame model loads; until then the
  URL is left alone (no flicker redirects while loading).

## Testing

- `routes.ts` unit tests for the new builders and the widened
  `parseLocalizeReturn` (accepts `/object/<id>` forms, still rejects external
  URLs and non-localize paths).
- Page-level tests (existing `LocalizeAlertPage` test patterns):
  - bare URL auto-selects the first workable object (replace, not push);
  - falls back to the first smoke object when all are done;
  - stays unselected when there are no smoke lanes;
  - unknown/FP lane in URL redirects to bare and re-selects;
  - second click on a focused row exits focus but keeps the lane active;
  - done-mode parity under `/localize/done`.

## Risks

- The `localize-object-editor-revamp` branch (#286/#287) has unmerged commits
  touching `LocalizeAlertPage.tsx`. Whichever branch lands second takes a
  merge conflict there — expected and manageable, but coordinate merge order.
