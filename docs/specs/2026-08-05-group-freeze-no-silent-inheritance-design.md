# Freeze Validated Groups, Remove Silent Label Inheritance

**Date**: 2026-08-05
**Status**: Approved
**Scope**: `annotation_api` — group assignment sweep (`app/services/group_assignment.py`), worker task (`app/worker.py`)

## Problem

The group-assignment sweep currently does two things when a newly imported
sequence matches an existing group (same `camera_id` + `azimuth`, IoU > 0.3
against the group's frozen representative bbox):

1. It attaches the sequence to the group — including groups a human already
   validated, silently diluting the validated member set.
2. If the group carries a label, it stamps that label onto the sequence's
   annotation and advances it to `SEQ_ANNOTATION_DONE`. The sequence never
   enters any human queue.

With imports moving to a daily cadence and labeling happening sporadically,
(2) means a geometric heuristic silently produces finished labels: a real
smoke plume overlapping a known false-positive source inherits
`false_positive` and is never seen by a human.

## Decision

The sweep only organizes; it never decides.

1. **Membership freezes at validation.** Validated groups stop accepting new
   members. A matching newcomer spawns (or joins) a fresh unvalidated group
   for the same camera/azimuth. Each validated group becomes an immutable
   human-confirmed record.
2. **The sweep never writes annotations.** Label inheritance is removed
   entirely. Imported sequences stay at `READY_TO_ANNOTATE` until a human
   session labels them.

Bulk labeling remains available through the existing human-triggered
mechanisms: validating a group and classifying one member fans the label out
to the other unlocked members (propagation), and the bulk group-apply
endpoint is unchanged. The per-session cost for a recurring FP source is one
validate + one classify per labeling cycle, not one per sequence.

## Changes

### 1. Candidate query excludes validated groups

In `_run_assignment` (`group_assignment.py`), add to `candidates_query`:

```python
SequenceGroup.is_validated.is_(False)
```

Effect with daily imports: after a session validates a source's group, the
next import creates one fresh unvalidated group for that source; subsequent
daily sequences accumulate there until the next session validates it. Group
count grows by one per active source per labeling cycle; there is no
persistent link between successive groups of the same physical source
(accepted trade-off).

### 2. Delete the inheritance block

Remove the label-inheritance section of `_run_assignment` (everything after
the `joined_existing` increment: the group-label check, annotation
create/update, `record_contribution`). Consequential cleanup:

- `AssignGroupsResult.inherited_annotations` field removed.
- `assign_ungrouped_sequences` / `_run_assignment` drop the now-unused
  `user_id` parameter.
- `worker.py` no longer looks up the worker user for the sweep call. The
  `WORKER_USERNAME` seeding stays — existing annotations are attributed to
  that user.
- Unused imports and helpers in `group_assignment.py` removed: annotation
  CRUD/schemas, `apply_label_to_sequences_bbox`, and the
  `AnnotationGenerationService` instance (only the inheritance path used it).

## Unchanged

- Human-triggered propagation (`_propagate_to_group_if_validated`): still
  fires on classify-to-`SEQ_ANNOTATION_DONE` in a validated group, still
  refuses conflicting labels, still skips members locked at
  `SEQ_ANNOTATION_DONE`/`ANNOTATED`.
- Bulk group-apply endpoint, including `force=true` semantics.
- `is_group_excluded` manual removal.
- The import script and its skip-on-409 re-import behavior.
- Frontend: no changes required.

## Edge cases

- **Validation race**: a group validated while a sweep is mid-run may receive
  one final member (candidates fetched before the flip). Accepted — the
  window is seconds and the member arrives unlabeled. Can be closed later by
  re-checking `is_validated` at join time if it proves bothersome.
- **Existing data**: validated groups already containing unlabeled members
  keep them; no migration.
- **Labeled-but-unvalidated groups**: newcomers may still join them (they are
  not frozen), but inherit nothing since the sweep no longer labels.

## Testing

Backend (`annotation_api` test suite):

1. Sequence matching only a validated group → new group created; validated
   group's membership unchanged.
2. Sequence matching an unvalidated group → joins it (existing behavior).
3. Sequence joining a *labeled* unvalidated group → its annotation stays at
   `READY_TO_ANNOTATE`, tracks untouched, no contribution recorded.
4. Existing sweep-inheritance tests deleted or repurposed for (3).

## Related, out of scope

- #253 (group PATCH validate doesn't re-derive label from done members) and
  #258 (FP-only classify never propagates): with all labeling now
  human-paced these gaps get more exposure. Until fixed, the session
  workflow should be validate-then-classify.
- #186 (inheritance-regeneration issue) is largely mooted by removing
  inheritance; review the ticket after implementation.
