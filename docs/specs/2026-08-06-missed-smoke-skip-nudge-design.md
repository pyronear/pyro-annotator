# Missed smoke → Skip alert nudge on /localize/:id

**Date**: 2026-08-06
**Status**: Approved
**Base**: `main` (the alert-skip escape hatch, PR #297, merged 2026-08-06 —
the Skip alert button this design points at ships with it).

## Problem

The localize page's missed-smoke row offers "+ Add object", which spawns a new
sibling lane server-side and drops the annotator into the editor to draw the
missed object's boxes. That drawing flow is not developed enough to ship: we do
not want annotators adding new boxes for missed smokes yet. But the alert can't
just dead-end either — PR #297's skip escape hatch is exactly the right exit
(park the alert, leave a note, move on), and nothing currently points the
annotator at it.

## Decision

Remove the "+ Add object" control from the localize page and turn the
missed-smoke Yes answer into a nudge toward **Skip alert**: explanatory copy in
the row, a pulsing ember glow on the Skip alert button while the answer is Yes,
and a reworked submit-time soft-confirm whose primary action is skipping.

The backend `/alert/add-object` endpoint and `apiClient.addObject` stay
untouched — only the page-side entry point goes away, so the feature can return
by re-adding UI.

## Design

### 1. `LocalizeMissedSmokeRow`

- The `addObject` slot prop is deleted.
- New optional boolean prop `showSkipNudge` (the page passes `mode !== 'done'`).
- When `hasMissedSmoke` and `showSkipNudge`, the explainer copy becomes the
  nudge:

  > Adding the missed object isn't supported yet. Use **Skip alert** below to
  > park this alert so it can be annotated once it is.

- In done mode (no Skip button, alert already submitted) the Yes answer shows
  no extra copy — the Yes/No chips render exactly as today. The Yes/No question
  stays in both modes: it still records `has_missed_smoke` on the annotation.

### 2. Skip button glow (`LocalizeAlertPage`)

While the missed-smoke answer is Yes (queue mode only — the button doesn't
render in done mode), the footer's "Skip alert" button carries a pulsing ember
glow: a new `skip-glow` animation in `tailwind.config.js` — keyframes cycling a
soft ember `box-shadow` halo, ~2s ease-in-out infinite. Deliberately not
`animate-pulse`: opacity flashing makes the label unreadable; a halo draws the
eye without degrading the button.

### 3. Soft-confirm rework

`softConfirmNeeded` loses its `sessionAddedObjects` term (the state dies with
the feature) and becomes `anyLaneFlagged && !softConfirmResolved`.

Dialog copy: *"You flagged missed smoke, but adding the missed object isn't
supported yet."* Buttons, top to bottom:

1. **Skip alert** (primary) — closes this dialog, opens the existing skip
   confirm from #297 (note + confirm).
2. Submit & clear flag
3. Submit anyway
4. Go back

### 4. Dead code removal

Gone from `LocalizeAlertPage`: `addObjectPickerOpen`, `sessionAddedObjects`,
the `addObject` mutation, the smoke-type picker JSX, and the
`addObjectPickerOpen` terms in the two keyboard guards.

### 5. Copy consistency

`GuidePage` describes the "+ Add object" button in the localize section —
reword to describe skipping the alert instead.

## Testing

`frontend/tests/pages/LocalizeAlertPage.test.tsx` (TDD; never run prettier on
`tests/**`):

- Delete the add-object flow tests: lane spawn, failure toast, and the
  picker-inert keyboard guards.
- Add: Yes answer → nudge copy visible and the Skip alert button carries the
  glow class; No answer → no glow, no nudge; done mode with Yes → no nudge.
- Soft-confirm: shows the reworded copy, Skip alert is the primary action and
  opens the skip confirm dialog.

Component-level behavior of the row is covered through the page tests, as
today.
