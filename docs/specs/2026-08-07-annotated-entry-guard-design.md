# Guard every path into `annotated` for a lane needing localization

**Date**: 2026-08-07
**Status**: Approved
**Issue**: [#346](https://github.com/pyronear/pyro-annotator/issues/346)
**Base**: `main` at `c3f8ec4` (the localize-revert feature, PR #345, merged).

## Problem

A smoke lane can reach `processing_stage = annotated` without any localization
work having been done. Such a lane appears on `/localize/done` and, because
`/export/alerts` admits an alert once every lane is `annotated`
(`export.py:225`), it can ship an alert into the training set with nothing to
learn from.

Two holes let it happen:

1. **The exit guard is transition-specific.** `apply_annotation_update`
   (`sequence_annotations.py:681-728`) enforces "every detection carries an
   annotated-stage `DetectionAnnotation`" only when the lane moves
   *specifically* `seq_annotation_done → annotated`. A `PATCH` from
   `ready_to_annotate` (or `imported`) skips it entirely.
2. **Create is unguarded.** `create_sequence_annotation` (`:380`) calls
   `annotations.create(...)` directly; the guard never runs on that path, so a
   lane can be *created* at `annotated` with `has_smoke: true` and no
   localization at all.

### How it is reached

| Entry point | Produces the bad state? |
| --- | --- |
| `update_annotation_stage.py` | **Yes** — bulk-rewrites `--from-stage` → `--to-stage` with no restriction; goes through the API `PATCH` (`:122`), so a guard catches it. |
| Ad-hoc `PATCH` by any client | **Yes** — this is how the state was first reproduced. |
| `POST` create at `annotated` | **Possible** — no guard. Its only caller, `import_yolo_sequence.py`, is safe (see below). |
| Classify submit (UI) | No — `determineClassifySubmitStage` never returns `annotated` for a smoke lane. |
| `import.py` (alert-API import) | No — writes `ready_to_annotate`. |

Not reachable through the UI. This is an API-level hole, so operator scripts
and any other client can produce it.

### Observed

Reproduced while seeding demo data by PATCHing a real lane
`ready_to_annotate → annotated`: the lane landed at `annotated` with 10
auto-created detection annotations, all at `visual_check`, none carrying a
box — and the alert duly appeared on `/localize/done`.

Audited the local imported dataset for naturally-occurring instances: of 28
lanes at `annotated`, 3 need localization, and **0** are box-less. The defect
is latent, not an active data problem — so there is nothing to backfill.

## Decision

**One rule, wider trigger.** Keep the predicate the exit guard already uses —
*every detection of the lane carries an `annotated`-stage
`DetectionAnnotation`* — and apply it on **every** path into `annotated` for a
lane matching the localization rule (`localization_rule.py:29-54`), rather than
only on the `seq_annotation_done → annotated` transition.

Applying the existing predicate is sufficient: the reproduced case fails it
already (its detection annotations sat at `visual_check`, not `annotated`). The
rule does not need changing — only its trigger.

## Design

### 1. Widen the update guard

In `apply_annotation_update`, drop the `existing.processing_stage ==
SEQ_ANNOTATION_DONE` term from the guard's condition, keeping the target-stage
and `needs_localization` terms. The guard then fires whenever a lane that needs
localization *arrives* at `annotated` from anywhere.

A lane already at `annotated` being updated for some other reason must not
re-trigger it, so the condition also requires the stage to actually be
changing: `existing.processing_stage != ANNOTATED and target == ANNOTATED`.
Without that, any later edit to a legitimately-annotated lane would re-run the
check and could fail on data it did not create.

Response stays 422 with the current message shape, which names how many
detections lack an annotated-stage detection annotation.

### 2. Guard the create path

`create_sequence_annotation` gets the same check before
`annotations.create(...)`: if the incoming `processing_stage` is `annotated`
and the derived flags match the localization rule, every detection of the
sequence must already carry an annotated-stage `DetectionAnnotation`.

The flags come from the payload (`derive_has_smoke(payload.annotation)`,
`payload.has_missed_smoke`, `payload.is_unsure`) — the same derivation the
update path uses — because the row does not exist yet.

Extracting the check into one helper used by both paths keeps a single
definition of "localization complete"; two copies would drift.

**Importer compatibility.** `import_yolo_sequence.py` creates a detection
annotation at stage `annotated` for every frame (`:582-589`) *before* posting
the sequence annotation (`:620`), so it satisfies the predicate as written. Its
`--sequence-stage` defaults to `ready_to_annotate`, so the guarded path is
opt-in. `batch_import_local_yolo.py` passes the flag through unchanged.

### 3. Retire the placeholder-seeding model

*Added 2026-08-07 during implementation, after the create guard turned 32 tests
red rather than the handful expected.*

`auto_create_detection_annotations` (`sequence_annotations.py:199-296`) seeds
**placeholder** detection annotations when a lane reaches `annotated`:

| lane | seeded stage |
| --- | --- |
| FP-only | `annotated` (final content) |
| smoke-only | `visual_check` |
| mixed / missed-smoke | `bbox_annotation` |

Its own comment describes the placeholders as rows that "carry no judgment
yet; their annotator is credited when they submit". That is an older model in
which marking a lane `annotated` *seeds work still to be done* — directly
contradicting the smoke-localization model, where a smoke lane may only reach
`annotated` once localization is already **complete**.

The existing exit guard already enforced the new model on the
`seq_annotation_done → annotated` transition. Extending it to every path
finishes that migration and leaves the two smoke branches unreachable: a lane
needing localization now always arrives with every detection already carrying
an annotated-stage annotation, so there is nothing left to seed.

**Decision: retire the old model rather than preserve dead branches.**

- `auto_create_detection_annotations` returns early for any lane matching
  `has_smoke or has_missed_smoke` — nothing to seed, by construction.
- The FP-only → `annotated` branch stays: it is the classify FP exit, still
  live and still the only path that writes final content plus contributions.
- The empty-lane default (`visual_check`) stays unchanged.
- The ~10 tests that describe placeholder seeding for smoke lanes are removed;
  the behaviour they covered no longer exists, and the guard tests cover the
  rejection that replaces it.

This is a deliberate behaviour deletion, not a fixture repair. It is recorded
here because a reader of the diff would otherwise see tests disappearing with
no stated reason.

### 4. Explicitly out of scope

- **"At least one non-empty box."** A lane where the annotator cleared every
  frame is a legitimate, supported state (`cleared`); requiring a box would
  refuse a valid human decision. If we ever want that measured, it should be a
  read-only audit, not a rule.
- **An export-side check.** With the guard in place `annotated` regains its
  meaning. A duplicate invariant in the export could only fail confusingly, far
  from the write that caused it.
- **Backfill or migration.** Zero existing bad rows.
- **Deleting `update_annotation_stage.py`.** Considered and declined; the tool
  stays, the guard makes it safe.

## Consequence: test fixtures

Widening the trigger forbids exactly the shortcut many backend test fixtures
take — creating or PATCHing a smoke lane straight to `annotated` to set up a
"finished" state. Those fixtures will start getting 422s.

The fix is to make each affected fixture legitimate — either route it through
`seq_annotation_done` after writing detection annotations, or give it the
detection annotations it was implicitly claiming to have — **never** to weaken
the guard to accommodate a fixture. A fixture that cannot satisfy the guard is
describing a state the application cannot produce, which is the point.

The count is unknown until the guard is in place; expect churn across the
backend suite and treat it as part of the work, not as a surprise.

## Testing

`annotation_api/src/tests/endpoints/test_annotated_entry_guard.py`:

- `PATCH` `ready_to_annotate → annotated` on a smoke lane with no detection
  annotations → 422. This is the reported defect.
- Same, but with detection annotations at `visual_check` → 422. This is the
  exact reproduced state.
- Same, but with an annotated-stage detection annotation per frame → 200.
- `POST` create at `annotated` with smoke and no detection annotations → 422.
- `POST` create at `annotated` with a full set of annotated-stage detection
  annotations → 201, mirroring what `import_yolo_sequence.py` does.
- An FP-only lane created and PATCHed to `annotated` → unaffected, since it
  does not need localization.
- A deferred-unsure lane (`is_unsure`, `annotated`) → unaffected.
- Updating a lane already at `annotated` (e.g. flipping `has_missed_smoke`)
  → not re-guarded.
- The existing `seq_annotation_done → annotated` guard still behaves as it does
  today (regression: `test_localization_submit_guard.py` must stay green).
