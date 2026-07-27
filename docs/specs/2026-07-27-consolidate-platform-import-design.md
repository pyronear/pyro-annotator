# Consolidate the platform importers into one (#166 + #167)

**Date:** 2026-07-27
**Issues:** [#166](https://github.com/pyronear/pyro-annotator/issues/166) (object-split from platform boxes), [#167](https://github.com/pyronear/pyro-annotator/issues/167) (consolidate the 3 import scripts)

## Problem

Three overlapping importers live under `annotation_api/scripts/data_transfer/ingestion/platform/`:

| Script | Make target | Object-split? | Extra deps |
|---|---|---|---|
| `import.py` | `import-platform` | no | none |
| `import_filtered.py` | `import-platform-filtered` | no | pyro-dataset + pyro-engine (registry dedup + predictor filter) |
| `import_predictor_split.py` | `import-platform-predictor-split` | yes | pyro-dataset + pyro-engine (re-fetch + re-predict + cluster) |

Three entry points confuse operators, and two of them shell out to sister-repo venvs
(onnx/torch) just to import data. Both heavy importers are **already broken**: they
invoke `scripts/platform_train_loop/fetch_all_platform_sequences.py` and
`predict_and_filter_sequences.py` in pyro-dataset, neither of which exists in the
current pyro-dataset checkout — their `_validate_paths` exits immediately.

Meanwhile the plain import maps one platform sequence to one annotation sequence:
sibling smoke objects appear only as read-only `others_bboxes` hints and can never be
annotated (#166). The platform's own detection payloads (`bbox` + `others_bboxes`)
carry every object's boxes, so object-splitting needs no re-prediction — only the
clustering rule that already exists in `object_clustering.py`.

Box *quality* is no longer the importer's concern: the auto-annotate worker (#162)
re-runs the detector locally and stores `auto_predictions` on each detection.

## Decisions made

| Topic | Decision |
|---|---|
| Scope | #166 and #167 together, one branch, two stacked PRs |
| Precision filter (`import_filtered.py`) | **Dropped entirely.** The pyro-dataset scripts it depends on no longer exist; dedup remains via the annotation API's 409-on-duplicate-`alert_api_id` skip; quality judgment belongs to the worker + human annotators |
| Object-split | **Always on**, no flag. Clustering knobs (`min_dets=3`, `min_interval=300s`, `relaxation=7200s`) stay internal constants in `object_clustering.py` |
| Clone mode (annotation→annotation sync) | **Removed from `import.py`**; a follow-up ticket covers rebuilding it as a standalone `sync.py` (deleted code referenced via git history). Sync is unavailable in the interim — accepted |
| `--risk-score` | Dropped; hard-coded to `extreme` (fetch everything; the flag existed only to re-enable the platform's FWI volume filter) |
| `--force-url` | Renamed to `--image-transfer {bucket-copy,url}`, default `bucket-copy` |
| `--detections-limit` | Renamed to `--frames-limit` (caps *images per sequence*; CLI-surface rename only — code and APIs keep "detection") |
| `--max-sequences` | Default changes 10 → **0 (no cap)** |
| Group assignment | Stays a separate explicit step (`make assign-groups`); the importer never calls it |
| "platform" naming | The upstream API is the **alert API**; "platform" properly means the firefighter frontend. Rename only surfaces this work touches (flags, Make target, help text, rewritten docs). Directory `ingestion/platform/`, `PLATFORM_*` env vars, and other scripts keep the old name; a follow-up ticket covers the deep rename |

## End-state interface

One importer: `scripts/data_transfer/ingestion/platform/import.py` (name kept; the
`import` keyword only prevents in-code imports, and the sole consumer that needed
that — `import_filtered.py` — is deleted). Make target: **`import-alert-api`**
(replaces `import-platform`).

```
--date-from / --date-end      inclusive range; end defaults to today
--alert-api-url               alert API URL (choices: alertapi | apicenia), default alertapi
--annotation-api-url          default http://localhost:5050
--max-sequences               default 0 = no cap
--frames-limit                max images per sequence, default 30
--sequence-list               comma-separated platform ids, or path to a text file
--image-transfer              bucket-copy | url, default bucket-copy
--dry-run
--max-workers                 default 4
--loglevel                    debug|info|warning|error, default info
```

Hard-coded behavior (no flags): `risk_score=extreme` on the alert API fetch,
chronological (`asc`) detection order, clustering constants.

Removed flags: `--source-annotation-url`, `--clone-processing-stage`,
`--clone-count-only` (clone mode removed), `--confidence-threshold`,
`--iou-threshold`, `--min-cluster-size` (server auto-generation no longer used by
this path), `--risk-score`, `--detections-order-by`.

## Import data flow

Fetch is unchanged: `sequence_fetching.fetch_all_sequences_within` loads cameras +
organizations, pages sequences per date, fetches detections per sequence, dedupes by
`bucket_key` to one record per image; each record carries the tracked object's `bbox`
and the sibling objects' `others_bboxes`.

Then, per platform sequence:

1. **Build frames.** For each image: `boxes = own bbox ∪ others_bboxes` — every box
   visible on that frame. Each box keeps a source tag (`bbox` vs `others_bboxes`);
   clustering ignores it, primary-object selection (below) uses it.
2. **Cluster** with `object_clustering.cluster_objects` (module unchanged) → N
   tracked objects. The module replays pyro-api's detection→sequence association
   offline and is source-agnostic.
3. **Post one annotation sequence per object.**
   - **Primary selection:** the primary object is the cluster containing the most
     boxes sourced from the platform's own `bbox` field (the platform's tracked
     object); ties broken by earliest first detection. If no cluster contains any
     `bbox`-sourced box, the earliest cluster is primary.
   - **IDs:** the primary object keeps the raw platform `alert_api_id`, so past
     plain imports dedup naturally via the existing 409-skip. Siblings get
     `1_000_000_000 + platform_id * 1000 + object_index` — the scheme already proven
     by `import_predictor_split.py`, equally 409-deduped on re-runs.
   - Per-object `camera_azimuth` via `object_cone_azimuth`; per-object
     `recorded_at` / `last_seen_at` from the object's member frames.
   - Detections are posted only for the object's member frames:
     `algo_predictions` = the object's box(es) on that frame, `others_bboxes` = the
     *other* objects' boxes on that frame. Images transfer per `--image-transfer`:
     server-side bucket-key copy (default, production) or `/from-url` (local dev
     where the annotation API cannot reach the platform S3 bucket). Existing
     502/503/504 retry-with-backoff logic in `shared.py` is reused.
   - **Annotation is written client-side**: one `sequences_bbox` track per object,
     stage `READY_TO_ANNOTATE`. Server-side IoU auto-generation is bypassed.
4. **Fallback.** If clustering yields zero qualifying objects (sequence too short
   for `min_dets`, or boxless), import as a single annotation sequence with all its
   boxes in one track — nothing silently dropped, shape matches today's plain
   import. Logged as a fallback. When at least one object qualifies, frames whose
   boxes belong to no qualifying object are not posted (predictor-split behavior).
5. **Failure isolation.** Per-sequence: a failed sequence is reported and the run
   continues. A partially posted object (some detections failed) is rolled back by
   deleting the created sequence. Exit code 1 if any sequence failed critically.

## Deletions

- `import_filtered.py`, `import_predictor_split.py`, `predictor_runner.py`
- Clone-mode code inside `import.py` (`fetch_records_from_annotation_api`,
  `create_placeholder_sequence_annotation` call path, `update_source_annotations_stage`,
  clone CLI flags)
- Make targets `import-platform-filtered`, `import-platform-predictor-split`;
  `import-platform` is replaced by `import-alert-api`
- All pyro-dataset / pyro-engine coupling in the ingestion path

`object_clustering.py` stays — it becomes the importer's dependency.

## Documentation updates

- `README.md`: rewrite the admin-workflow import section; delete the predictor-split
  section (and its mention at the pull-time merge note)
- `annotation_api/CLAUDE.md`: new interface; also fixes the stale
  `--skip-platform-fetch` flag it still documents
- Root `CLAUDE.md`: platform-import section
- `annotation_api/docs/data-ingestion-guide.md` and
  `annotation_api/docs/sequence-annotation-guide.md`: updated invocations and
  parameter reference (both currently document removed/stale flags)

## Delivery

- **PR1 (#166):** object-split in `import.py` + unit tests. Minimal CLI churn; the
  server-auto-gen flags go dead here but are removed in PR2.
- **PR2 (#167, stacked on PR1):** clone-mode removal, CLI trim + renames, Make
  target changes, deletion of the two heavy importers + `predictor_runner.py`, docs.
- **Follow-up tickets to file:**
  1. Rebuild annotation→annotation sync as a standalone `sync.py` + Make target
     (reference implementation: the clone code deleted in PR2, via git history).
  2. Deep "platform → alert-api" rename (directory, `PLATFORM_*` env vars with
     fallback, remaining scripts and docs).

## Testing

There is currently **zero** test coverage for any importer or for
`object_clustering.py`.

- **PR1 unit tests** (plain `pytest`, no Docker): frame-building from platform
  records, cluster→object mapping, the `alert_api_id` scheme, per-object
  `others_bboxes` assembly, the zero-cluster fallback, and first-ever tests for
  `object_clustering.cluster_objects`.
- **End-to-end (manual):** import a date containing a known multi-object sequence
  (e.g. platform seq 47105 from #166) into the local stack with
  `--image-transfer url`; verify sibling sequences appear, are annotatable, and
  carry correct `others_bboxes`.
- **PR2:** mostly deletion/extraction — verified by `make lint`, CI, and a local
  smoke import.

## Out of scope

- Implementing `sync.py` (ticket)
- The deep alert-api rename (ticket)
- Any change to the auto-annotate worker, server-side annotation generation
  service, or the frontend
- Improvements to clone/sync behavior beyond what existed
