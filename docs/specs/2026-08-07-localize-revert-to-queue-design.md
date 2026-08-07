# Send a localized alert back to the Localize queue

**Date**: 2026-08-07
**Status**: Approved
**Base**: `main` (the alert-skip escape hatch #297, the collocated localize
cockpit #274/#278, and the `/export/alerts` endpoint #310 all merged).

## Problem

Once an alert is submitted from `/localize`, it lands at `/localize/done` and
its lanes sit at `annotated` forever. There is no way back. Two things follow:

1. **A mistake is unfixable in place.** Spotting a bad box on a done alert
   leaves the annotator with nothing to click.
2. **Bad data cannot be withheld from the export.** `/export/alerts` ships an
   alert only when *every* lane of it is `annotated`
   (`export.py:225`, `.having(annotated_lanes == total_lanes)`). An alert with
   a known-wrong localization keeps flowing into the training set.

The second is the driving motivation: we want a way to pull an alert back out
of the export. Reverting it to the queue does exactly that, and re-opening it
for correction is the same action.

## Decision

Add a **Send back to queue** action to the done-mode localize cockpit
(`/localize/done/:sequenceId`). It flips every `annotated` lane of the alert
that needs localization back to `seq_annotation_done` — and does nothing else.

That single bit is the entire difference between the two queues
(`sequences.py:1113-1197` for `/localize`, `:1431-1521` for `/localize/done`),
and the same bit is the export's admission gate. So one stage write covers
both goals: the alert leaves Done, re-enters the queue, and drops out of the
export.

## Design

### 1. Scope of the flip

Reverted: lanes at `annotated` whose flags match the localization rule
(`localization_rule.py:29-54` — `(has_smoke OR has_missed_smoke) AND NOT
is_unsure`).

Not reverted, deliberately:

- **FP lanes and deferred-unsure lanes.** They exited the pipeline at classify
  and never had localization work; demoting them would park them in a stage
  they never occupied.
- **Lanes already at `seq_annotation_done`.** Nothing to do.
- **`DetectionAnnotation` rows.** Boxes and per-frame acceptance survive
  untouched, so the reopened alert looks exactly as it was left and Submit is
  immediately re-armed. The annotator fixes the one bad frame and resubmits
  rather than redoing the alert.
- **`auto_annotated_at` / `auto_annotate_enqueued_at`.** Both stay set, so the
  auto-annotate sweep does not re-fire (`_pending_ready_lane`'s two arms both
  fail, `auto_annotate_scheduling.py:68-84`) and the lane instantly
  re-qualifies as a `_ready_smoke_lane` (`sequences.py:580-591`).

`DONE_STAGES` covers both `seq_annotation_done` and `annotated`
(`auto_annotate_scheduling.py:28-31`), so every sibling "all lanes done" check
keeps passing across the revert — the alert is never in a half-visible state.

### 2. Backend — `POST /api/v1/annotations/sequences/localize-revert`

Mirrors `localize-submit`'s shape and validation spine
(`sequence_annotations.py:1316-1448`): request `{annotation_ids: [...]}`,
response a list of `{annotation_id, sequence_id, processing_stage}`.

**It must not route through `apply_annotation_update`.** A stage write of
`annotated → seq_annotation_done` on a lane needing localization is exactly
the FP→smoke promotion predicate (`sequence_annotations.py:739-750`), whose
effects block (`:780-815`) 422s on any committed detection annotation and
otherwise *deletes* every `DetectionAnnotation` of the sequence. That is the
opposite of this feature. The endpoint therefore writes through
`SequenceAnnotationCRUD.update()` directly.

Writing through the CRUD also keeps us clear of three other hooks that must
not fire on a revert:

- `auto_create_detection_annotations` — only runs on lanes newly reaching
  `annotated`.
- `_propagate_to_group_if_validated` — fans a label out to a validated group
  when a lane newly reaches `seq_annotation_done`. A revert is not a new
  label; it must not touch the group.
- The contribution insert (see §4).

Guards, all inside one transaction with a single commit — either every lane
flips or none does:

| Condition | Status |
| --- | --- |
| Unknown annotation id | 404 |
| Ids spanning more than one alert | 422 |
| Any target lane not at `annotated` | 409 — "refresh and retry" |
| Any target lane that does not need localization | 422 |

**Post-commit safety net.** If a reverted lane's sequence has
`auto_annotated_at IS NULL`, defer `auto_annotate_sequence` for it (the same
post-commit `defer_async` the FP-promote path uses,
`sequence_annotations.py:888-890`). Without it, such a lane fails
`_ready_smoke_lane` and sits in neither queue until the stale-reconciliation
arm rescues it up to an hour later.

### 3. Frontend

**Where.** The rail footer's secondary-action slot — the position the **Skip
alert** button occupies in queue mode (`LocalizeAlertPage.tsx:1826-1845`),
gated `mode !== 'done'`. Done mode gets **Send back to queue** in that same
slot, with the same outlined-ember treatment.

The footer has two branches (`:1763-1846`) and only the
`workableObjects.length > 0` one currently renders the action row. The slot
goes into both, so a partially-reverted alert opened from Done shows Submit
*and* the revert button.

**When.** Rendered only when at least one lane is `annotated` and passes
`laneNeedsLocalization` — the client-side mirror of the endpoint's guards, so
a deep link to a non-done alert never offers an action that would 409. Derived
from `alertDetail.lanes` alongside the existing `workableLanes` memo
(`:1000-1008`); call it `revertableLanes`.

**Interaction.** Confirmation dialog, no note field (see Out of scope), then:

- `apiClient.localizeRevert(annotationIds)` → `POST .../localize-revert`
- invalidate `localization-queue`, `localize-done-queue`, `annotation-counts`,
  `pipeline-stats`, `SEQUENCE_ANNOTATIONS`
- toast, then navigate to `/localize/done` — the alert is gone from the list it
  came from, and whoever picks it up does so from the queue.

### 4. Attribution

Contributions are append-only and nothing ever removes them, so a revert must
not credit the reverter as an annotator — it would pollute the Annotators
column on `/localize/done` and its `annotator_id` filter. Precedent: group
unvalidate deliberately clears attribution rather than carrying it stale
(`sequence_groups.py:441-445`).

No code is needed for this: `crud_sequence_annotation.py:144-157` reads
`annotation.processing_stage` *after* the `setattr` loop has already applied
the new stage, so its "old stage was annotated" arm is dead and only the new
stage counts. A demotion writes no contribution row today. Because that
behavior rests on a subtlety rather than an intention, it gets a test of its
own (see Testing) so a later fix to that condition cannot silently change it.

## Export behavior

This is the point of the feature, so it is specified rather than merely noted.

- `/export/alerts` groups by `(source_api, platform_alert_id)` and requires
  every lane annotated (`export.py:225`). Reverting any one lane drops the
  **whole alert** from the export.
- The round-trip re-admits the corrected version. `updated_at` bumps on the
  revert and again on the re-submit, and `last_annotated_at` is
  `max(sequence annotation write, detection annotation write)`
  (`export.py:173-204`) — so the fixed alert returns with a watermark later
  than its original export and an incremental consumer picks the correction
  up.
- **Removal carries no signal.** The export only ever emits present alerts;
  there is no tombstone. A consumer that pulled the alert and then synced
  incrementally would silently retain the bad copy. Withdrawal is therefore
  only real for consumers doing a full pull, or one that diffs against the
  full set of alert keys. No pull script exists in the repo yet
  (`annotation_api/scripts/data_transfer/` is ingestion-only); this is a
  constraint on whoever writes it.

## Out of scope

- **A reason note.** Skip captures an optional note; this does not. There is
  no field on `SequenceAnnotation` to hold one, and adding one means a column,
  a migration, and queue/serializer plumbing. Accepted cost: whoever picks the
  reverted alert up from `/localize` does not learn why it came back.
- **A revert entry point on the `/localize/done` list rows.** The action lives
  where you can see the work you are judging.
- **Any per-lane granularity.** Revert is alert-shaped, like the queues and
  like the export.
- **An audit trail of reverts.** Only `updated_at` records that anything
  happened.

## Testing

**Backend** — `annotation_api/src/tests/endpoints/test_localize_revert.py`:

- Round-trip through the real queue endpoints: an alert present in
  `/localize/done` and absent from `/localize`, reverted, is then absent from
  Done and present in the queue.
- The alert is absent from `/export/alerts` after the revert, and present
  again after a re-submit — the feature's actual purpose, pinned end to end.
- Detection annotations are unchanged after the revert (count and content).
- Zero new `SequenceAnnotationContribution` rows.
- An FP sibling lane of the same alert stays at `annotated`.
- Each guard's status code: 404, 422 (cross-alert), 409 (wrong stage), 422
  (lane does not need localization).
- A lane in a validated group leaves the group's members unchanged.

**Frontend** — `frontend/tests/pages/`:

- The button is absent in queue mode and present in done mode.
- It is absent when no lane is annotated-and-needs-localization.
- Confirm posts the expected `annotation_ids` and navigates to
  `/localize/done`.
