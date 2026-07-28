# Classify > Done: "All classified" default view

**Date:** 2026-07-28
**Status:** Approved

## Problem

Classify > Done (`/sequences/review`) is a stage-filtered list whose Stage
dropdown defaults to `seq_annotation_done`. Since the two-lane exit design
(`docs/specs/2026-07-28-smoke-localization-entry-point-design.md`), FP-only
sequences never pass through `seq_annotation_done` — `determineClassifySubmitStage`
sends them straight to `annotated` at classify submit. The default Done view
therefore shows only smoke lanes parked for localization; false positives are
invisible unless the user manually switches the dropdown to "Annotated", where
they are mixed with fully complete smoke sequences.

"Done" should mean "the classification pass is complete", regardless of which
lane the sequence exited through.

## Design

### Backend

`GET /api/v1/sequences` currently accepts a single `processing_stage` query
value (`sequences.py`). Change it to a repeatable list parameter
(`processing_stage=seq_annotation_done&processing_stage=annotated`), following
the existing `false_positive_types` list-param pattern.

- A single value arrives as a 1-element list, so all existing callers keep
  working unchanged. No new parameter name, no back-compat shim.
- Filter logic becomes an OR across the given values.
- The `no_annotation` special case generalizes: when present in the list, OR in
  `SequenceAnnotation.sequence_id IS NULL`.
- Invalid values remain silently ignored, as today.

### Frontend

- `SequencesPageWrapper`: prepend an **"All classified"** option to the Stage
  dropdown and make it the default. It maps to
  `['seq_annotation_done', 'annotated']` — the two classify exits. (The design
  originally included `in_review` and excluded-but-kept `needs_manual`; both
  stages were retired by #207/#220 before this landed, so the union and the
  dropdown shrank accordingly.) The single-stage options remain for narrowing,
  and a persisted stage that no longer exists falls back to "All classified".
- Bump the persisted-tab storage key (`sequences-review-stage` →
  `sequences-review-stage-v2`) so existing users land on the new default
  instead of their old sticky single-stage selection.
- API client / `types/api.ts`: the filter type accepts
  `ProcessingStage | ProcessingStage[]`; Axios serializes arrays as repeated
  query params.
- In the union view each row must show which stage the sequence is at, so
  FP-exit (`annotated`) is distinguishable from smoke awaiting localization
  (`seq_annotation_done`). Verify the review table already renders a stage
  indicator; add a small stage chip if it does not.

## Testing

- Backend: multi-value filter tests — union returns sequences from multiple
  stages; single-value back-compat; `no_annotation` combined with a real stage.
- Frontend: unit test for the wrapper's "All classified" stage mapping and
  repeated-param serialization; `npm run quality` passes.

## Out of scope

- Localize > Done (`/detections/review`) keeps its current behavior.
