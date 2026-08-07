# Export Alerts Pull Script — Design

**Date**: 2026-08-07
**Status**: Approved

## Goal

A `make export-alerts` command that pulls finished annotation work from the
annotation API's `GET /api/v1/export/alerts` endpoint (added in PR #310) and
materializes it on disk as a self-contained ML dataset: a JSONL manifest plus
every frame image.

## Artifact layout

```
outputs/alerts_export/                 # OUTPUT_DIR
├── manifest.jsonl                     # one line per alert
└── images/
    └── pyronear_french/               # source_api
        └── 1234/                      # platform_alert_id
            ├── 18709.jpg              # detection_id.jpg (one per frame)
            └── 18710.jpg
```

- Each manifest line is the API's `AlertExportItem` payload verbatim, except
  each frame's expiring `image_url` is replaced by `image_path`: the
  dataset-relative path `images/{source_api}/{platform_alert_id}/{detection_id}.jpg`
  (or `null` if the download ultimately failed).
- `source_api/platform_alert_id` mirrors the endpoint's alert identity (its
  cursor key); `detection_id.jpg` is unique and joins back to
  `frames[].detection_id`.
- Images live at the alert level because objects (lanes) of one alert share
  the same frames; each image is downloaded once.

Measured scale (local stack, 2026-08-07): ~8 KB of manifest per alert without
`image_url` (~25 frame entries/alert), so even 100k alerts is a ~800 MB
manifest — under 1% of the dataset once images are counted.

## Script

New package `annotation_api/scripts/data_transfer/export/` containing
`export_alerts.py`. It talks only to the annotation API (unlike the
`ingestion/alert_api/` scripts, which involve the alert API), hence the new
`export/` sibling. Auth reuses `get_annotation_credentials` +
`get_auth_token` from `ingestion/alert_api/shared.py` — same `.env`
convention as the other scripts (`MAIN_ANNOTATION_LOGIN`/`PASSWORD` for
remote targets, `ANNOTATOR_*` fallback for localhost).

CLI:

- `--annotation-api-url` (required from make; `REMOTE_API`)
- `--output-dir`
- `--page-size` (default 100, endpoint max 500)
- `--max-workers` (concurrent image downloads)
- `--loglevel`

## Data flow

1. Login, then walk the cursor to exhaustion, page by page.
2. Per page: collect every frame with a `bucket_key`; dedupe by
   `detection_id` (the same detection appears under multiple objects of one
   alert); skip files already present on disk; download the rest concurrently
   (ThreadPoolExecutor, `--max-workers`) via the presigned `image_url` to a
   temp name, renaming into place on success.
3. Append one manifest line per alert to `manifest.jsonl.tmp`
   (`image_url` → `image_path` as above).
4. After the last page, atomically rename `manifest.jsonl.tmp` →
   `manifest.jsonl`.

### Idempotent full pull

Every run re-walks the full export and rewrites the manifest; only missing
images are downloaded. Since a detection's image never changes, existing
files are always valid. No state file; the endpoint's
`annotation_updated_gte` watermark stays unused until full walks ever become
too slow (YAGNI).

### Presigned URL expiry

`S3_URL_EXPIRATION` defaults to 24 h (JWT: 24 h), but the design does not
depend on that: URLs are consumed within one page's download time of being
minted, so even a short server-side expiry is safe. The 100-item default
page size keeps that window tight. An expired-URL 403 falls into the normal
download-failure path below.

## Error handling

- Image download: 3 attempts with short backoff; a frame that still fails is
  written with `image_path: null`, the run continues, and the script exits
  non-zero at the end, logging the failure count. A re-run heals it.
- API-level errors (auth failure, 4xx/5xx on a page fetch): abort
  immediately; the `.tmp` manifest is never renamed, so a previous good
  `manifest.jsonl` survives.

## Make target

```make
# Usage: make export-alerts [OUTPUT_DIR=outputs/alerts_export]
export-alerts: OUTPUT_DIR ?= outputs/alerts_export
export-alerts:
	uv run python -m scripts.data_transfer.export.export_alerts \
		--annotation-api-url $(REMOTE_API) \
		--output-dir $(OUTPUT_DIR) \
		--max-workers $(MAX_WORKERS) \
		--loglevel $(LOGLEVEL)
```

Defaults to production (`REMOTE_API`), like `import-alert-api`; plus a
`help` entry. The older `export_annotations.py` (raw sequences+annotations
dump, includes unfinished work) is a different artifact and stays untouched.

## Testing

- Unit tests for the pure pieces, structured so transform logic is separable
  from I/O:
  - manifest-line transformation (`image_url` → `image_path`, including the
    failed-download `null` case);
  - per-page download plan (dedupe across objects of one alert,
    skip-existing, frames without `bucket_key`).
- End-to-end verification against the local stack: run the target twice —
  the second run must download zero images and produce an identical
  `manifest.jsonl`.
