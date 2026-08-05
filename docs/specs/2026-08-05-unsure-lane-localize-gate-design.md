# Unsure lanes gate the localize queue

Date: 2026-08-05
Status: approved, not implemented

## Problem

An alert enters the localization queue when **every** sibling lane sits at a
done stage and **at least one** lane matches the localization rule
(`(has_smoke OR has_missed_smoke) AND NOT is_unsure`) at `seq_annotation_done`
with its auto reference layer built
(`annotation_api/src/app/api/api_v1/endpoints/sequences.py:838`).

An unsure lane parks at `seq_annotation_done` at classify submit
(`frontend/src/utils/annotation/localizeUtils.ts:16`), and `seq_annotation_done`
counts as a done stage. So an unsure lane satisfies the completeness gate
without ever being work. An alert with one smoke lane and one unsure lane
enters the queue on the strength of the smoke lane, and the unsure lane is
carried along invisibly.

Verified against the local database: alert `55664` (`sampzon-ldd-01`) has three
lanes — a wildfire smoke lane (seq 57, `seq_annotation_done`, auto-annotated), a
false-positive lane (seq 58, `annotated`), and an unsure lane (seq 59,
`seq_annotation_done`). It is in the queue today.

Three consequences follow:

- The unsure object is invisible on the localize screen.
  `buildAlertFrameModel` (`frontend/src/utils/annotation/alertLocalizeUtils.ts:121`)
  drops unsure lanes unconditionally — not even behind the false-positive
  context toggle.
- Submitting the alert ships only workable lanes, so the alert leaves
  `/localize` with the unsure lane still parked. It is then reachable only
  through the "Only Unsure" filter on `/classify/done`.
- The queue row advertises the wrong thing: `rollupOutcomes` precedence
  (`fn > unsure > tp > fp`) makes 55664 display `? +2` for an object you cannot
  act on, rather than `tp` for the wildfire you are about to box.

The behaviour was deliberate — the smoke-localization spec
(`docs/specs/2026-07-28-smoke-localization-entry-point-design.md:92-97`) states
that unsure lanes "park at `seq_annotation_done` and are resolved through
sequence review, without blocking siblings". This spec revises that decision:
an unsure lane is an *undecided* object, and an alert should not be presented as
ready for localization while one of its objects is undecided.

## Scope

**In:** the queue gate, the action that settles an unsure lane, the server-side
submit guard, the export default, the localize queue row's outcome rollup, the
stage label, and tests for all of it.

**Out:** any dedicated unsure triage queue or dashboard counter — the unsure
backlog stays on `/classify/done` behind its existing filter. No change to how
unsure lanes render in the localize frame grid or object status strip — they
stay invisible there, including behind the false-positive context toggle. No
change to the auto-annotate sweep's gating. No schema migration.

## Settled vs. unsettled

A lane is **unsettled** when:

    is_unsure = true AND processing_stage = seq_annotation_done

Every other lane at a done stage (`seq_annotation_done`, `annotated`) is
**settled**. An unsure lane at `annotated` is settled-as-undecidable: someone
looked at it and recorded that it cannot be decided for now.

The rule lives in `annotation_api/src/app/services/localization_rule.py`
alongside `needs_localization`, in both SQL and Python form, for the same reason
that rule does: SQL clauses and Python booleans cannot share code, and every
caller must agree.

```python
def is_unsettled_unsure(is_unsure: bool, processing_stage) -> bool: ...
def unsettled_unsure_clause(ann): ...
```

## Queue gate

`localization_queue` gains one condition in its `HAVING` aggregate:

```
count(*) == sum(done_stage)          # unchanged: every sibling classified
AND sum(unsettled_unsure) == 0       # new: no sibling left undecided
AND sum(ready_smoke_lane) > 0        # unchanged: there is work to do
```

The existing candidate pre-filter (#215) is unchanged: it selects alerts having
at least one ready smoke lane, which still contains every alert the gate can
admit. The new condition only removes alerts, so the pre-filter stays a valid
cost bound.

`GET /sequences?needs_localization=true` filters per-sequence, not per-alert, and
already excludes unsure lanes through `needs_localization`. It needs no change.

Effect on current data: 55664 leaves `/localize` until seq 59 is settled. The
other four alerts carrying an unsure lane have no smoke lane at all and were
never in the queue.

## Auto-annotate sweep: unchanged

`schedule_pending_auto_annotate` keeps gating on the existing completeness rule.
A blocked alert's smoke lane still gets its GPU pass in the background, so when
the unsure lane is settled the alert appears in `/localize` immediately rather
than waiting for the next sweep plus a GPU run.

This spends GPU on alerts that may stay blocked. With five unsure lanes in the
whole database that cost is negligible, and it buys instant availability on
unblock. Revisit only if unsure usage grows by orders of magnitude.

## Settling a lane: "Undecidable for now"

On `/classify/done/<alert>`, an unsure object gets one new per-lane control:
**"Undecidable for now"**. It joins the existing pending-changes set and lands on
*Save changes* — the done-mode PATCH path
(`frontend/src/pages/ClassifyAlertPage.tsx:655`). No new endpoint, no new submit
path, no schema change.

It targets `processing_stage: annotated` while keeping `is_unsure: true`.
`determineClassifySubmitStage` gains a `deferred` input: an unsure lane returns
`annotated` when deferred and `seq_annotation_done` otherwise. The existing
`currentStage === 'annotated'` short-circuit is unaffected.

The backend needs no guard change for this transition. The localization exit
guard (`sequence_annotations.py:658`) only fires when `needs_localization` holds,
which is false for an unsure lane, so no detection annotations are demanded.
`auto_create_detection_annotations` likewise skips unsure lanes
(`sequence_annotations.py:749`).

The lane stays re-editable from done mode afterwards — done mode unlocks any lane
carrying an annotation regardless of stage
(`ClassifyAlertPage.tsx:65`) — and stays findable under the "Only Unsure" filter.
Re-deciding it as smoke returns it to `seq_annotation_done`, where the sweep
picks it up and the alert re-enters `/localize` through the normal path.

The first-pass classify queue is untouched: marking an object unsure there still
parks it at `seq_annotation_done`, which is now precisely the signal that
someone must come back to it.

## Submit guard

The queue is a listing, not access control — `/localize/57` keeps resolving when
its alert is blocked, so a bookmark or a back-button lands on a screen the
annotator can complete. Enforcement therefore belongs on the server:

`localize-submit` rejects with 422 when any sibling lane of the alert is
unsettled-unsure, in the style of the existing localization exit guard. The
check runs once per request against the alert's siblings, before the per-lane
loop, since every item already belongs to one alert.

`LocalizeAlertPage` shows a banner — *"1 object still undecided — settle it in
Classify"* — linking to `/classify/done/<alert>`, and disables Submit. Boxes stay
drawable, so work in progress is not thrown away; it just cannot be committed
until the alert is settled.

## Export default

`/export` defaults to `processing_stage = annotated` and applies no unsure
filter unless one is passed (`export.py:305-314`). Unsure lanes are excluded
today only incidentally, by their stage. Moving settled-undecidable lanes to
`annotated` would newly pull them into default exports.

Fix: when the caller passes no `is_unsure` value, exclude unsure lanes. Callers
that want them ask for them explicitly with `is_unsure=true`.

## Outcome rollup on the localize queue

Once seq 59 is settled, 55664 re-enters `/localize` and its row again shows `?`
dominant for an object that is invisible on the screen the row leads to.

`LocalizeQueueTable` rolls up only lanes matching the localization rule, so the
row shows `tp` — the wildfire about to be boxed. `alertOutcome`
(`LocalizeQueueTable.tsx:44`) switches from `item.lanes` to `smokeLanes(item)`,
which the file already computes for its Objects and Frames columns.

`ClassifyDoneTable` and `LocalizeDoneQueueTable` keep rolling up every lane, and
`rollupOutcomes` itself is unchanged. On those screens the unsure object
genuinely is part of what is being summarised.

## Stage label

`getProcessingStageLabel` renders `seq_annotation_done` as "Awaiting
localization" (`frontend/src/utils/processingStage.ts:172`). For an unsettled
unsure lane that is wrong: it awaits a *decision*, and that stage is now what
gates the queue.

Callers that know the lane's `is_unsure` flag render "Awaiting decision"
instead. The label function takes an optional second argument rather than a new
status value, so the `ProcessingStage` union and every exhaustive switch over it
stay untouched.

## Testing

Backend, extending `src/tests/endpoints/test_localization_queue.py` and
siblings:

- an unsettled unsure sibling blocks an otherwise-ready alert (the 55664 shape —
  currently untested in either direction)
- a settled unsure sibling (`annotated` + `is_unsure`) does not block
- an all-unsure alert still yields nothing (existing test, unchanged)
- `localize-submit` returns 422 when a sibling is unsettled-unsure, and the
  batch rolls back
- `schedule_pending_auto_annotate` still enqueues the smoke lane of a blocked
  alert
- `/export` excludes unsure lanes by default and returns them for
  `is_unsure=true`

Frontend, unit tests only — no new harness:

- `determineClassifySubmitStage` returns `annotated` for a deferred unsure lane
  and `seq_annotation_done` otherwise
- `LocalizeQueueTable`'s outcome rollup ignores non-localizable lanes
- the blocked-alert banner renders and Submit is disabled

## Consequences

Marking an object unsure is free today. After this it withholds a wildfire from
the localize queue until someone acts, which makes unsure a throughput lever.
"Undecidable for now" is what keeps that from being a deadlock, so the control
must be easy to find on `/classify/done`.

Alerts carrying an unsure lane and no smoke lane are unaffected — they were never
in the localize queue and remain reachable only through the "Only Unsure" filter.
Four such alerts exist today.
