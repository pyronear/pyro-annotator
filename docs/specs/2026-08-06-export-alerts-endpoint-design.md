# Export Alerts Endpoint

**Date:** 2026-08-06
**Status:** Approved

## Motivation

Training pipelines need the annotated alerts out of the annotation API: false-positive
alerts (negative tracks for the temporal model, hard negatives for the detector) and
localized smoke alerts (positive boxes). Today the only bulk read is
`GET /api/v1/export/detections`, a flat detection-centric dump that exposes raw
annotation JSONB, loses the alert/object structure, and paginates by offset.

This spec replaces it with a single alert-centric export endpoint with a cleaned,
stable contract. A collocated script (out of scope here, later session) will call the
endpoint, download the images as it pages, and package annotations with images.
Conversion to trainer formats (YOLO/COCO/…) happens downstream of that script.

## Endpoint

```
GET /api/v1/export/alerts
```

- **Auth:** standard JWT bearer (`get_current_user`), same login flow the import
  scripts use (`POST /api/v1/auth/login` with script credentials). No new auth
  mechanism, no scopes, no API keys.
- **Replaces:** `GET /api/v1/export/detections` is deleted (endpoint, row schema, and
  its tests). The `/export` router keeps its prefix and tag.
- **Consumer removal:** the old endpoint's only consumer,
  `scripts/data_transfer/ingestion/alert_api/export_dataset.py` (and its
  `export-dataset` Makefile target), is deleted in the same change. The future
  collocated pull script against `/export/alerts` supersedes it.

## Export unit and completeness rule

The export unit is the **alert**: identity `(source_api, platform_alert_id)`. One
alert contains N objects (lanes) — one `Sequence` row each — and each object contains
frames — one `Detection` row each.

An alert is exported **only when finished**:

- Every lane of the alert has a sequence annotation at processing stage `annotated`.
- Lanes with `is_unsure = true` are **silently omitted** from `objects`. An alert
  whose lanes are all unsure is not exported at all. (Same rationale as the previous
  exporter: unsure lanes are not training data.)
- No parameter loosens this rule.

Skipped alerts (a row in the `alert_skips` overlay,
`docs/specs/2026-08-05-alert-skip-escape-hatch-design.md`) are excluded by an
explicit anti-join on alert identity — not by relying on the submit guards
that normally keep a skipped alert from finishing. Unskipping (deleting the
overlay row) restores the alert to the export untouched.

## Response shape

```json
{
  "items": [
    {
      "source_api": "pyronear_french",
      "platform_alert_id": 4521,
      "camera_id": 57,
      "camera_name": "serre-de-barre-200",
      "organisation_id": 3,
      "organisation_name": "sdis-07",
      "lat": 44.3512,
      "lon": 4.1289,
      "azimuth": 200,
      "recorded_at": "2026-07-14T15:42:10",
      "last_annotated_at": "2026-07-16T10:03:17",
      "objects": [
        {
          "sequence_id": 3121,
          "record_kind": "smoke",
          "smoke_types": ["wildfire"],
          "false_positive_types": [],
          "frames": [
            {
              "detection_id": 84215,
              "recorded_at": "2026-07-14T15:42:10",
              "bucket_key": "detections/sequence_3121/20260714_154210_det84215_a3f9c2.jpg",
              "image_url": "https://…?X-Amz-Signature=…",
              "boxes": [
                {
                  "xyxyn": [0.4192, 0.3081, 0.4677, 0.3562],
                  "smoke_type": "wildfire",
                  "false_positive_types": null,
                  "origin": "human"
                }
              ]
            },
            {
              "detection_id": 84216,
              "recorded_at": "2026-07-14T15:43:41",
              "bucket_key": "detections/sequence_3121/20260714_154341_det84216_c81f77.jpg",
              "image_url": "https://…",
              "boxes": []
            }
          ]
        },
        {
          "sequence_id": 3122,
          "record_kind": "false_positive",
          "smoke_types": [],
          "false_positive_types": ["antenna"],
          "frames": [
            {
              "detection_id": 84302,
              "recorded_at": "2026-07-14T15:42:10",
              "bucket_key": "detections/sequence_3121/20260714_154210_det84215_a3f9c2.jpg",
              "image_url": "https://…",
              "boxes": [
                {
                  "xyxyn": [0.6210, 0.5470, 0.6355, 0.5810],
                  "smoke_type": null,
                  "false_positive_types": ["antenna"],
                  "origin": "engine"
                }
              ]
            }
          ]
        }
      ]
    }
  ],
  "next_cursor": "pyronear_french:4521"
}
```

### Field semantics

**Alert level** — metadata shared by all lanes: camera, organisation, lat/lon,
azimuth, `recorded_at` (alert start, min over lanes' `recorded_at`), and
`last_annotated_at` = max annotation `updated_at` (sequence and detection
annotations) across all exported lanes. `last_annotated_at` is the value the
`annotation_updated_gte` filter compares against.

**Object level:**

- `sequence_id` is the lane/track identity. The importer's synthetic `alert_api_id`
  scheme is deliberately **not** exposed.
- `record_kind`: `"smoke"` if the lane's sequence annotation has smoke, else
  `"false_positive"`.
- `smoke_types` / `false_positive_types`: the lane-level label summary (from
  `SequenceAnnotation.smoke_types` / `.false_positive_types`).

**Frame level** — exactly five fields: `detection_id`, `recorded_at`, `bucket_key`,
`image_url`, `boxes`.

- Every detection of the lane exports as a frame, including frames with no box
  (`"boxes": []`) — the temporal model wants the full frame sequence and the gap is
  signal. Consumers may filter client-side.
- Sibling lanes share images: frames of different objects in the same alert can carry
  the same `bucket_key` (distinct `detection_id`s). Consumers dedupe downloads by
  `bucket_key`.
- `bucket_key` is the stable image identity. `image_url` is a presigned URL minted at
  response time (`generate_presigned_url`, no per-object HEAD), valid for
  `S3_URL_EXPIRATION` (default 24 h). Consumers must download images as they page,
  not after the full pull; a page can always be re-requested with the same cursor to
  get fresh URLs.

**Box level** — `{xyxyn, smoke_type, false_positive_types, origin}` with the
invariant that exactly one of `smoke_type` / `false_positive_types` is set:

- **Smoke lanes:** boxes come from the lane's detection annotation
  (`DetectionAnnotation.annotation.annotation[]`): `xyxyn`, `smoke_type` or
  `false_positive_type` (a smoke lane can contain FP-flagged distractor boxes — a
  single-type box maps to a one-element `false_positive_types` list), `origin`
  (`engine` | `auto` | `human`) passed through.
- **False-positive lanes:** detection annotations are empty by construction, so boxes
  come from the lane's tracked object in the sequence annotation
  (`SequenceAnnotation.annotation.sequences_bbox[].bboxes`, matched by
  `detection_id`). Each box carries the whole lane's `false_positive_types` list
  (per-box FP typing does not exist) and `origin: "engine"` (these are the alert
  API's own boxes written at import).

### Dropped from the old export row

Raw `sequence_annotation` / `detection_annotation` JSONB dumps, processing-stage
fields (always `annotated` by construction), `has_*` flags (derivable),
`algo_predictions`, `is_wildfire_alertapi`, synthetic `alert_api_id`s. Adding a field
back later is non-breaking; none has a consumer today.

## Request parameters

| Parameter | Type | Default | Semantics |
|---|---|---|---|
| `cursor` | `str` | — | Opaque resume token from `next_cursor` (`"{source_api}:{platform_alert_id}"`). Returns alerts strictly after this key. Malformed cursor → 422. |
| `limit` | `int` | 100 | Max **alerts** per page, `1 ≤ limit ≤ 500`. |
| `source_api` | `SourceApi` | — | Filter alerts by source API. |
| `organisation_id` | `int` | — | Filter by organisation id. |
| `organisation_name` | `str` | — | Filter by organisation name, exact match. |
| `camera_id` | `int` | — | Filter by camera id. |
| `camera_name` | `str` | — | Filter by camera name, exact match. |
| `recorded_at_gte` | `datetime` | — | Alert `recorded_at` ≥ value. |
| `recorded_at_lte` | `datetime` | — | Alert `recorded_at` ≤ value. |
| `annotation_updated_gte` | `datetime` | — | Alert `last_annotated_at` ≥ value — the incremental-sync watermark. |
| `smoke_types` | `List[SmokeType]` | — | Keep alerts with at least one exported lane containing any of these smoke types. |
| `false_positive_types` | `List[FalsePositiveType]` | — | Keep alerts with at least one exported lane containing any of these FP types. |

Notes:

- Enum-valued parameters are typed as their enums so FastAPI rejects invalid values
  with 422. (The old exporter silently ignored invalid strings and returned an
  unfiltered dump — that bug class is designed out.)
- There is no `record_kind` filter: the export unit is the alert, which can mix smoke
  and FP lanes; consumers split by `objects[].record_kind`.
- Filters select **alerts**; they never trim the `objects` of a selected alert (the
  alert always exports whole, minus unsure lanes).

## Pagination

Keyset pagination ordered by `(source_api, platform_alert_id)` ascending — unique,
immutable, roughly chronological.

- First request: no `cursor`. Response ends with `next_cursor` = key of the last
  alert in the page, or `null` when the page is the last one (fewer than `limit`
  alerts matched).
- Next request: pass `cursor` back verbatim.
- Re-sending a cursor is idempotent (same page, fresh image URLs) — crash recovery is
  "re-request the page".

**Pull modes:**

- *Full pull:* no watermark, walk the cursor to `null`.
- *Incremental:* `annotation_updated_gte=<previous run's start time>` + walk the
  cursor. Any alert whose lanes were touched since then re-exports whole; the
  consumer overwrites that alert's directory in the packaged dataset. Alerts
  annotated mid-crawl with keys before the cursor are caught by the next incremental
  run — the watermark, not the crawl, guarantees completeness.

## Implementation sketch

1. **Alert page query:** aggregate `Sequence` joined to `SequenceAnnotation`, grouped
   by `(source_api, platform_alert_id)`, `HAVING` every lane at stage `annotated`
   (e.g. `count(*) = count(*) FILTER (WHERE stage = 'annotated')`), plus the alert
   filters, the keyset predicate on the row-value
   `(source_api, platform_alert_id) > (:cursor_source, :cursor_id)`, ordering, and
   `LIMIT`. The `annotation_updated_gte`, `smoke_types` and `false_positive_types`
   filters apply on aggregates over non-unsure lanes.
2. **Hydration:** for the page's alert keys, load lanes with their sequence
   annotations, detections, and detection annotations, then assemble the nested
   response in Python (mirrors the existing alert-grouped queue endpoints in
   `sequences.py`).
3. **Presigning:** one `generate_presigned_url` call per frame, no HEAD.
4. Response models are new Pydantic classes in `export.py`
   (`AlertExportPage`, `AlertExportItem`, `ObjectExport`, `FrameExport`, `BoxExport`).

`ix_sequence_platform_alert_id` on `(source_api, platform_alert_id)` already supports
the grouping and keyset predicate; no new index is expected. Verify with the seeded
dev stack if page latency is suspect.

## Error handling

- Missing/invalid token → 401/403 (standard dependency behavior).
- Malformed `cursor` (not `source:int`, unknown source) → 422.
- Invalid enum filter values → 422 (FastAPI-typed params).

## Testing

Rewrite `src/tests/endpoints/test_export.py` against the new endpoint:

- **Completeness gating:** alert with one lane at `annotated` and one at
  `seq_annotation_done` is not exported; exported once both are `annotated`.
- **Unsure omission:** unsure lane omitted from `objects`; all-unsure alert absent.
- **Box sources:** smoke lane boxes from detection annotation (including an
  FP-flagged distractor box with `origin` passed through); FP lane boxes from the
  sequence-annotation track carrying the lane's full FP-type list and
  `origin: "engine"`.
- **Gap frames:** lane detection without a box exports as a frame with `boxes: []`.
- **Shared images:** sibling-lane frames report the same `bucket_key`.
- **Pagination:** stable ordering, `next_cursor` round-trip, `null` on last page,
  cursor idempotency, malformed cursor → 422.
- **Filters:** each parameter, plus `annotation_updated_gte` matching on the max of
  sequence- and detection-annotation `updated_at`.
- **Auth:** 401/403 without a valid token.
- **Removal:** `GET /export/detections` returns 404.

## Out of scope

- The collocated pull script (image download + packaging) — later session; it
  replaces the deleted `export_dataset.py`.
- Trainer-format conversion (YOLO/COCO) — downstream of the script.
- API keys / scoped service accounts.
