# Alert-page accept popover + Enter shortcut

**Date:** 2026-08-06
**Status:** Approved

## Problem

On `/localize/{sequenceId}`, the per-object **Accept boxes** button (Frames
bar, `LocalizeObjectActions`) fires `quickAcceptLane` immediately, with only a
text tooltip. On the object editor
(`/localize/{sequenceId}/object/{laneId}/{detectionId}`), the same action
opens `AcceptRemainingPopover` (PR #301): a looping preview of the post-accept
track, a frame counter synced to a status strip, a legend, coverage/gap
warnings, and an Enter-to-confirm Accept button. The two buttons are "the same
motion from two places" (the editor's own comment) but only one of them shows
the annotator what accepting will do.

## Decision

Bring the editor's exact popover to the alert page's Accept boxes button, and
add a page-level **Enter** shortcut that triggers it.

## Behavior

- Clicking **Accept boxes** toggles `AcceptRemainingPopover` — the same
  component, unmodified — anchored below the button. Confirm fires the
  existing `quickAcceptLane.mutate(laneId)` and closes the popover.
- Dismissal matches the editor: outside click, the X, Escape, or a second
  press of the trigger.
- The button's text `Tooltip` is removed: the popover now carries the
  explanation, the editor's button has no tooltip, and a hover tooltip would
  render on top of the open dialog.
- **Visibility (behavior change):** the button appears only when
  `acceptCount > 0` — the editor's rule — replacing the page's
  `!isObjectLocalized` check in `objectActionProps`. Hand-added objects and
  gap-only lanes lose a button that could not do anything for them.
  `isObjectLocalized` stays for the progress badge and submit gate.

## Enter shortcut

A page-level keydown handler: **Enter** opens the popover for the active
object; while open, Enter confirms. Guards:

- inert when the frame editor route is open (`detectionIdNum != null`);
- inert while any overlay is up (shortcuts sheet, add-object picker,
  missed-smoke confirm);
- inert when the event target is an interactive element — Enter on a focused
  rail row still opens that object, and Enter on a focused button inside the
  dialog clicks that button (the editor's carve-out).

Escape closes the popover before any other Escape layer. The shortcuts sheet
(`LocalizeShortcutsModal`) gains a row: "Accept the model's boxes — Enter".

## Data

No new fetches. For the active object the page builds:

- `entries = buildFilmstripEntries(frameModel.frames, laneId,
  detectionsByLaneId[laneId], annotationsByLaneId[laneId])`;
- `acceptCount` / `gapCount` with the editor's exact expressions over
  `entries`;
- `previewBoxes` via `collectLaneBoxes` (already imported by the page), built
  only while the popover is open, as the editor does.

## Code placement

`LocalizeObjectEditor` is untouched. Open state and keyboard wiring live in
`LocalizeAlertPage`. `LocalizeObjectActions` changes minimally: the Accept
button gains a relative anchor wrapper and an optional popover slot
(`ReactNode` prop) so the page injects the configured popover next to the
button it anchors to. The ~50 lines of dismissal/Enter wiring are deliberately
duplicated with the editor's rather than extracted — the editor merged days
ago (PR #301) and its layered Escape/Enter handling is not worth the
regression risk of a refactor.

## Testing

- Clicking Accept boxes opens the popover instead of mutating.
- Confirm fires `quickAcceptLane` with the right lane; the popover closes.
- Enter opens the popover, a second Enter confirms.
- Escape and outside click close without mutating.
- No Accept button when `acceptCount === 0` (e.g. a lane whose every present
  frame has a committed box but gaps remain).
- Enter on a focused rail row still activates the row, not the popover.

Reuses the popover's existing testids (`accept-remaining-popover`,
`accept-remaining-confirm`, `accept-remaining-close`).
