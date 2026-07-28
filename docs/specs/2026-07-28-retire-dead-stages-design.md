# Retire Dead Sequence-Annotation Stages — Design

**Date:** 2026-07-28
**Issue:** [#207](https://github.com/pyronear/pyro-annotator/issues/207)
**Status:** Approved

## Problem

Since the FiftyOne pipelines were retired (#179), three values of
`SequenceAnnotationProcessingStage` have no live writers:

- `in_review` — set by the retired push-annotations sync. Sequences now exit
  `seq_annotation_done → annotated` directly (two-lane exit from #168/#212).
- `needs_manual` — the FiftyOne rework stage, set exclusively by the retired
  `apply_fiftyone_review.py` (reviewer tags an "issue" frame → sequence back to
  `needs_manual`, detection annotations back to `bbox_annotation`).
- `under_annotation` — a vestigial claim marker from the retired pull/push sync
  (confirmed by the dashboard taxonomy audit,
  `docs/specs/2026-07-28-dashboard-taxonomy-redesign-design.md`).

Everything left touching them is read-side: filter tabs, dashboard stats,
label/color maps, gate-set membership, CLI choices, and the defensive
`needs_manual` attention surface added by #208 (dashboard banner +
`/sequences/attention` route). An audit confirmed no production code path can
write any of the three — only operator-supplied CLI flags and test fixtures.

The rework loop they served is replaced by stage-driven re-entry (per the #168
spec): flagging an issue sets the lane back to `seq_annotation_done` and it
automatically re-enters the Smoke Localization queue. No dedicated stage needed.

## Decision

Remove all three values, leaving the 4-value stage enum:

`imported` → `ready_to_annotate` → `seq_annotation_done` → `annotated`

(`no_annotation` is a frontend-only pseudo-status on `ProcessingStageStatus`,
not a DB enum member — unaffected.)

Migration care level: **dev/staging only** — existing DBs are re-importable from
the alert API; the migration must be correct but not battle-tested, and the
downgrade may be lossy.

One PR carries migration + backend + frontend + docs (mirrored gate sets on both
sides change in lockstep).

## Migration

One new alembic revision — the first enum-change migration in the repo. Postgres
stores the enum by **name** (uppercase labels, e.g. `IN_REVIEW`), so the remaps
use those labels.

**Upgrade:**

1. Remap rows to their honest state:
   - `IN_REVIEW`, `NEEDS_MANUAL` → `SEQ_ANNOTATION_DONE` (classification done,
     detection-level work pending — smoke lanes flow into the Localize queue).
   - `UNDER_ANNOTATION` → `READY_TO_ANNOTATE` (stale claim released — back to
     the classify queue).
2. Type swap: rename `sequenceannotationprocessingstage` to a `_old` name,
   create the new 4-label type, `ALTER COLUMN processing_stage TYPE … USING
   processing_stage::text::<new type>`, drop the old type.

**Downgrade:** symmetric type swap back to the 7-label type; remapped rows stay
where they are (lossy, accepted).

## Backend

- `models.py`: drop `UNDER_ANNOTATION`, `IN_REVIEW`, `NEEDS_MANUAL` from
  `SequenceAnnotationProcessingStage`.
- `endpoints/sequence_annotations.py`: `_BULK_LOCKED_STAGES` shrinks to
  `{SEQ_ANNOTATION_DONE, ANNOTATED}`; rewrite the comment block explaining
  `UNDER_ANNOTATION` membership and the "legacy path (`in_review → annotated`)"
  comment in the localization submit guard.
- `services/auto_annotate_scheduling.py`: `DONE_STAGES` collapses to
  `(SEQ_ANNOTATION_DONE, ANNOTATED)`; drop the legacy-compatibility comment.
  This is the #212 gate simplification the issue called for.
- Intentional side effect: `?processing_stage=in_review` (etc.) becomes an
  invalid filter value on the sequences/export endpoints — enum coercion
  rejects it. Nothing extra to build.
- Scripts: prune the three values from `import_yolo_sequence.py`
  `SEQ_STAGE_CHOICES`; fix `update_annotation_stage.py` docstring/help examples
  that reference `in_review`.

**Backend tests** — repurpose where the guard is still real, delete where the
behavior is gone:

- `test_annotated_and_in_review_siblings_count_as_done` → annotated siblings
  only.
- `test_needs_manual_sibling_blocks` and `test_hidden_when_sibling_regresses` →
  re-fixture with `ready_to_annotate` as the blocking/regressed stage (same
  guard, live stage).
- `test_legacy_in_review_to_annotated_unaffected` → delete; the legacy path no
  longer exists.

## Frontend

- `types/api.ts`: drop the three members from the `ProcessingStage` union. The
  exhaustive `Record<ProcessingStageStatus, …>` maps in `processingStage.ts` then
  force every remaining edit at compile time.
- `utils/processingStage.ts`: remove label + badge-color entries;
  `isSequenceAnnotationSubmitted` drops `in_review` (indirect consumers need no
  changes).
- Attention surface removal: delete `components/dashboard/AttentionBanner.tsx`
  (+ its test), its usage in `DashboardPage.tsx`, and the
  `/sequences/attention` route in `App.tsx`. The banner was the route's only
  entry point (no nav item), so the removal is self-contained.
- `utils/pipeline.ts` / `hooks/usePipelineStats.ts`: drop `inReview` /
  `needsManual` fields and their two count queries; `classifyDone` becomes
  `seqAnnotationDone + annotated`; the `attention` stat disappears from
  `PipelineStats`.
- Stage lists: `SequencesPageWrapper.REVIEW_STAGES` →
  `['seq_annotation_done', 'annotated']`; `SequenceGroupAnnotatePage.ANNOTATED_STAGES`
  → same two, keeping its mirror-contract comment with `_BULK_LOCKED_STAGES`
  accurate.
- Tests: update `usePipelineStats.test.tsx`, `pipeline.test.ts`,
  `DashboardPage.test.tsx`; delete `AttentionBanner.test.tsx`.

## Docs

Update living docs only: stage chain in root `CLAUDE.md` (preserve the two-lane
exit wording), `README.md`, and the `frontend/CLAUDE.md` route table
(`/sequences/attention` row). Dated specs under `docs/specs/` stay untouched as
historical records.

## Verification

- Backend suite in an isolated compose stack (unique project name, host ports
  dropped).
- Manual migration check in that stack: seed rows in the three dead stages at
  the prior revision, upgrade, confirm remaps land on
  `SEQ_ANNOTATION_DONE` / `READY_TO_ANNOTATE`; downgrade runs clean.
- Frontend: `npm run quality` + `npm run test`.
