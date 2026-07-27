# Retire the FiftyOne review pipelines (TP + FP) and sequence-annotation sync scripts

**Date:** 2026-07-27
**Issue:** #179 (scope expanded during design: the FP pipeline and `push-annotations`, listed there as separate decisions, are retired here too)

## Decision

The in-app detection review flow (#162 auto-annotate worker, #171 reference canvas, #172 seed-at-submit) replaces the file-based FiftyOne TP pipeline. Rather than keeping the FP pipeline alive on the shared tooling, both FiftyOne pipelines and the remote-sync scripts are removed in one pass, which lets the `fiftyone` dependency leave the project entirely.

**On the #168 blocker:** #179 nominally blocks on #168 (in-app entry point, still open). This is moot in practice: the pipeline's `decode_platform_id` does not understand the object-split importer's id scheme (#166/#176), so running it against currently-imported data is already unsafe, and the FP pipeline was never gated on #168. This removal merges when green.

## Removal surface

### Scripts (`annotation_api/scripts/data_transfer/ingestion/alert_api/`)

| File | Why removable |
|---|---|
| `pull_sequence_annotations.py` | TP/FP pull (shared) |
| `auto_annotate.py` | TP-only YOLO bbox enrichment; the in-app worker's `smoke_detector.py` is a copy, not an import |
| `visual_check_fiftyone.py` | TP/FP FiftyOne review UI (shared) |
| `apply_fiftyone_review.py` | TP/FP push-back (shared, `--fp-mode`) |
| `push_sequence_annotations.py` | Workflow A step 3 (local → remote sync); user opted to retire it with the rest |
| `visual_check_exported_dataset.py` | Standalone FiftyOne viewer for `export-dataset` output; imports `build_sample` from `visual_check_fiftyone.py`, breaks anyway; last remaining `fiftyone` importer |
| `label_classes.py` | YOLO class registry; after the above, its only consumers are its own guard test and docstrings (`export_dataset.py` has its own local `CLASS_ID`) |

### Tests (`annotation_api/src/tests/scripts/`)

`test_pull_sequence_annotations.py`, `test_auto_annotate.py`, `test_apply_fiftyone_review.py`, `test_pipeline_e2e.py`, `test_label_classes.py`.

No follow-up e2e issue needed: the scripts the e2e covered are themselves removed.

### Makefile (`annotation_api/Makefile`)

- Targets: `push-annotations`, `pull-seq-annotations`, `auto-annotate`, `visual-check`, `apply-review`, `pull-fp`, `visual-check-fp`, `apply-review-fp` — with their comment headers and `.PHONY` entries.
- Variables now unused: `DATA_ROOT`, `SMOKE_TYPE`, `DATASET_NAME`, `CONF_TH`, `FP_DATA_ROOT`, `FP_DATASET`. (`MAX_SEQUENCES`, `REMOTE_API`, `LOCAL_API`, `LOGLEVEL` remain used by import/update-stage/export targets — verify residual usage before deleting anything else.)
- Help text: workflow (A) `push-annotations` line, the whole "Detection annotation workflow (B)" and "False-positive workflow" blocks, and the `make pull-seq-annotations MAX_SEQUENCES=50` override example (replace with a surviving target).

### Dependencies (`annotation_api/pyproject.toml`)

- Remove `fiftyone` from the dev group (no importers left).
- Keep: `onnxruntime`, `opencv-python`, `pillow` (used by `app/services/smoke_detector.py`), `tqdm` (used by `export_dataset.py`).

### Docs

- Root `README.md`: remove section "B. Detection Annotation" and "C. False-Positive (FP) Review"; remove Workflow A's `push-annotations` step; fix the common-variables line (drop `DATA_ROOT`, `SMOKE_TYPE`, `DATASET_NAME` and the TP example). "Other commands" (`update-stage-*`, `export-dataset`, `import-yolo-sequence`) stays.
- Root `CLAUDE.md`: remove "TP Pipeline" and "FP Pipeline" sections; keep the Data Transfer Scripts intro and Alert API Import.
- `annotation_api/.env.example`: reword the auth comment that cites `push-annotations`.
- Reword docstrings orphaned by the deletion: `app/services/smoke_detector.py` ("extracted from `auto_annotate.py`" ×2).
- Untouched: historical specs in `docs/specs/`, `annotation_api/docs/` (`visual_check` hits there are the processing-stage enum), `sam_based_bbox_propagation/` (independent tool), frontend.

## Explicitly kept

`shared.py` (many other consumers), `export_dataset.py`, the entire in-app auto-annotate worker path (`app/worker.py`, `app/services/smoke_detector.py`, endpoint, Dockerfile model bake), `test_shared_env.py`, `test_shared_posting.py`, import-pipeline scripts and tests.

## Verification

1. Baseline before changes: `uv run pytest src/tests/scripts/` and `make lint` pass.
2. After: same commands pass (deleted tests gone, nothing else broken); full `make test` in Docker.
3. Repo-wide grep for the eight retired target names and seven module names returns only historical specs / this spec / unrelated enum hits.
4. `make help` renders coherently; `make -n import-alert-api` / `make -n export-dataset` still resolve.
