# Idempotent Alert API Import

**Date:** 2026-08-03
**Status:** Approved
**Scope:** `annotation_api` — DB schema, import script, run reporting

## Goal

Re-running the alert API import script over the same date range must not create
duplicate detection rows in the database or duplicate images in S3, and a pure
re-run must report success instead of a wall of "failed/duplicates".

## Current behavior

- Sequences are already idempotent: `UNIQUE (alert_api_id, source_api)` makes a
  re-imported sequence return 409, and the script skips it before posting any
  detections (so completed sequences never re-upload images).
- Object-split sibling sequences use deterministic synthetic ids
  (`base + alert_sid * 1000 + object_index`), so they collide correctly with
  their previous selves across runs.
- Detections are **not** protected: `uq_detection_alert_id` is
  `UNIQUE (alert_api_id, id)`, and `id` is the primary key, so the constraint
  is vacuous. The real duplicate source is the retry path in
  `_process_single_detection`: a 502/503/504 received after the server actually
  committed leads the retry to insert a second row and upload a second image.
- A re-run over an existing range reports every skipped sequence's detections
  as "failed", so an idempotent re-run looks like a failure.

## Decisions

- Keep the existing skip-on-409 semantics for sequences (no verify/repair, no
  full sync). Half-imported sequences left by a crashed run stay as they are.
- No S3 cleanup work: existing orphaned images are tolerated, and
  `delete_sequence` keeps its current behavior (no S3 deletion).
- 409 Conflict stays the server contract for duplicate creates (consistent
  with sequences and the global `IntegrityError → 409` handler); the endpoint
  does not switch to 200-with-existing.

## Design

### 1. Migration: real uniqueness for detections

New Alembic revision in `src/migrations/versions/`:

1. **Dedupe existing rows.** For each `(sequence_id, alert_api_id)` group,
   keep the earliest row (lowest `id`). Before deleting later duplicates,
   re-point any `detections_annotations` rows referencing a doomed row to the
   survivor; if the survivor already has an annotation (`detection_id` is
   unique in that table), delete the duplicate's annotation instead.
2. **Constraint swap.** Drop `uq_detection_alert_id`; add
   `UNIQUE (sequence_id, alert_api_id)` (name:
   `uq_detection_sequence_alert_api_id`). Update the model in
   `src/app/models.py` to match.

Downgrade reverses the constraint swap only; deleted duplicate rows are not
restorable.

No endpoint changes are needed: the app-level `IntegrityError` handler already
maps the violation to 409, and `_persist_detection` flushes the row before the
S3 upload, so a duplicate insert fails before any image is written.

### 2. Import script: treat detection 409 as "already exists"

In `_process_single_detection` (`scripts/data_transfer/ingestion/alert_api/shared.py`),
catch `AnnotationAPIError` with `status_code == 409`:

- fetch the existing detection via
  `list_detections(sequence_id=…, alert_api_id=…)`,
- fill `annotation_detection_id` and `xyxyns` from the payload as usual,
- return success.

This converges the retry-after-commit case onto the existing row instead of
duplicating it.

### 3. Honest re-run reporting

- `post_records_to_annotation_api`: count a skipped sequence's detections in a
  new `skipped_detections` counter instead of `failed_detections`.
- `import.py` summary: add "Sequences skipped (already imported)", stop folding
  skips into "Failed/duplicates", and remove the "likely duplicates" hedging
  notes. A pure re-run of an already-imported range exits 0 with 0 failures.

## Testing

- Endpoint test: POST the same detection twice into one sequence → second
  returns 409, exactly one row persists, no second S3 object.
- Script test (mocked client): `_process_single_detection` recovers from a 409
  by fetching the existing detection and reporting success.
- Stats test: skipped sequences produce `skipped_detections` and zero
  `failed_detections`.

## Success criteria

Run the import twice over the same date range against a local stack: the
second run exits 0, and detection row count and S3 object count are unchanged.
