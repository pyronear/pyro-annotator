# Reclassify an object from the Localize screen

**Date**: 2026-08-04
**Status**: Approved

## Problem

`/localize/:sequenceId` (`LocalizeAlertPage`) shows every workable object of an
alert as a row in its rail. While drawing boxes, an annotator regularly
discovers that classify got an object wrong — what was labeled smoke is
plainly a cloud, or a reflection. Today the only recourse is to leave the
page, find the alert in the Classify Done list, and correct it there. Nothing
on the localize screen links back to the decision that put the object in front
of them.

## Goal

From a smoke object's row in the localize rail, reach that object's
classification, correct it, and come straight back — without hand-navigating
between queues.

## Non-goal: false positive → smoke

The reverse direction (promoting an object classify rejected as a false
positive back into smoke, so it enters localization) is deliberately out of
scope. It is blocked by the never-demote rule in
`determineClassifySubmitStage` (`frontend/src/utils/annotation/localizeUtils.ts`):
a false-positive lane already sits at `annotated`, and that function returns
`annotated` unchanged for anything already annotated. A lane flipped back to
smoke would therefore keep its `annotated` stage and render on localize as a
read-only Context row, never re-entering the queue.

Relaxing that rule needs an auto-review pass over the promoted lane before it
can be localized. Tracked separately; the false-positive rows on the localize
rail stay read-only context here.

## Design

### 1. The button

`LocalizeObjectRow` gains an optional `onReclassify` action, rendered beside
`Accept boxes`: a small `Reclassify` button (pencil icon + label).

It appears on **smoke object rows only** — both workable rows (still to
localize) and already-localized Context rows, since both are objects on screen
that may have been judged wrong. False-positive rows never receive it.

The row currently renders its action strip only when `onAcceptBoxes` is
present; that condition widens to "either action exists", so Context rows —
which have no `Accept boxes` — can still carry `Reclassify`.

### 2. Destination

```
/classify/done/<laneSequenceId>?return=/localize/<entrySequenceId>
```

No new classify UI. `ClassifyAlertPage` in done mode already:

- makes every lane carrying an annotation editable regardless of processing
  stage (`isLaneLocked(lane, 'done')`), and
- auto-activates the card whose lane id is in the URL,

so the annotator lands on the object they clicked, with the alert's other
objects available in the same rail. Done mode PATCHes only the lanes that
actually changed, so correcting one object leaves its siblings untouched.

### 3. Round trip

In `ClassifyAlertPage`, `backUrl` becomes:

```
returnTo ?? (mode === 'done' ? ROUTES.CLASSIFY_DONE : ROUTES.CLASSIFY)
```

`returnTo` is read from the `return` query param and validated to an internal
path beginning with `/localize/` — anything else is ignored (no open redirect,
no cross-task surprises).

That single value covers both exits, because done mode's post-submit path
already falls through to `navigate(backUrl)`.

It must also **skip the workflow auto-advance when `return` is present**. A
stale `annotationWorkflow` left in the Zustand store by an earlier classify
session would otherwise satisfy `getNextSequenceInWorkflow()` and navigate to
an unrelated alert instead of back to localize.

Freshness needs no new work: classify's submit invalidates the shared
`['alert-detail', source_api, platform_alert_id]` query key, which is exactly
the key `LocalizeAlertPage` reads, so the localize page refetches on return.
A corrected object redraws with its new classification, or disappears from the
rail entirely once it is no longer a smoke lane.

### 4. Emptied alert

Demoting an alert's last smoke object to false positive leaves localize with
zero workable objects. Today that renders a disabled Submit with no
explanation: `allObjectsAccepted` requires `workableObjects.length > 0`, and
the "Accept every object's boxes to enable" hint is suppressed at zero.

The rail footer gains a one-line message for that case — "No objects left to
localize" — so the dead screen explains itself instead of reading as a bug.

## Testing

- `LocalizeObjectRow`: `Reclassify` renders on workable and context smoke rows,
  is absent on false-positive rows, and its click does not also activate the
  row (the row's own `onClick`).
- `LocalizeAlertPage`: the button's href carries the lane's own sequence id and
  the `return` param pointing at the current localize page.
- `ClassifyAlertPage`: a valid `return` param drives both the back button and
  the post-submit navigation; an off-site or non-`/localize/` value falls back
  to the default; a stale active workflow does not divert the return.
- `LocalizeAlertPage`: with zero workable objects, the rail shows the empty
  message and Submit stays disabled.

## Files

- `frontend/src/components/localize/LocalizeObjectRow.tsx`
- `frontend/src/pages/LocalizeAlertPage.tsx`
- `frontend/src/pages/ClassifyAlertPage.tsx`
- `frontend/src/utils/routes.ts` (return-param aware classify builder)
