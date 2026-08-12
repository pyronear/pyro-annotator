# Bulk detection-annotation accept

**Date:** 2026-08-12
**Status:** Approved

## Problem

On `/localize/{alertId}/object/{laneId}`, pressing **Accept boxes** writes the
object's boxes one frame at a time. `runLaneQuickAccept`
(`frontend/src/pages/LocalizeAlertPage.tsx:878-903`) builds a plan with
`buildQuickSubmitPlan` and then loops:

```ts
for (const payload of plan.payloads) {
  if (payload.existingAnnotationId !== null) {
    await apiClient.updateDetectionAnnotation(payload.existingAnnotationId, payload.body);
  } else {
    await apiClient.createDetectionAnnotation({ detection_id: payload.detection.id, ...payload.body });
  }
}
```

One `POST /api/v1/annotations/detections/` (multipart) or
`PATCH /api/v1/annotations/detections/{id}` per pending frame, strictly
sequential, no retry, fail-fast. A 20–40 frame object is 20–40 serialised
round-trips, each its own transaction (`crud_detection_annotation.py:53`,
`:86`).

The observed failure is a **partial accept**: the loop throws partway, the
generic toast appears, and the object is left half-annotated — some frames
`annotated`, some not. `onError` does not invalidate the lane cache
(`LocalizeAlertPage.tsx:919-921`), so the UI keeps showing the pre-accept
state until something else refetches. Pressing Accept again before a refetch
re-POSTs frames whose annotation already landed, hitting
`uq_detection_annotation_detection_id` (`models.py:427`) — an IntegrityError
rather than a clean recovery.

The root defect is that "accept this object" is not atomic. Latency is a
secondary symptom of the same shape.

## Solution

One bulk endpoint, one transaction, one request.

Three UI affordances funnel into `quickAcceptLane` and therefore into this
loop — the rail/CTA-bar **Accept boxes**
(`LocalizeObjectActions.tsx:89` → `LocalizeAlertPage.tsx:1872`), the editor
modal's **Accept boxes** (`LocalizeObjectEditor.tsx:740` →
`LocalizeAlertPage.tsx:2189`), and Enter to confirm the popover
(`LocalizeAlertPage.tsx:1709`). All three are fixed by fixing the loop.

`runLaneQuickAccept` has exactly one caller, the `quickAcceptLane` mutation
those three affordances share. (Its comment claimed a second caller, "Accept
all & submit alert", running it per workable lane — that control no longer
exists outside Guide copy, so there is no N×M path to fix.)

Out of scope: the editor's per-frame saves (`saveDetection` /
`acceptAndNext`, `LocalizeObjectEditor.tsx:412`). Those are already one
request per user action, with nothing to batch. The existing single-item
POST/PATCH endpoints stay exactly as they are to serve them.

## Backend

### Endpoint

`POST /api/v1/annotations/detections/bulk`, auth `get_current_localizer`,
JSON body (not multipart — the existing form-encoded POST does not extend to
a list).

```json
{
  "sequence_id": 1449,
  "items": [
    {
      "detection_id": 8801,
      "annotation": {
        "annotation": [
          {"xyxyn": [0.1, 0.2, 0.3, 0.4], "class_name": "smoke", "smoke_type": "wildfire", "origin": "auto"}
        ]
      },
      "processing_stage": "annotated"
    }
  ]
}
```

New schemas in `app/schemas/detection_annotations.py`:

- `DetectionAnnotationBulkItem`: `detection_id: int`,
  `annotation: DetectionAnnotationData`,
  `processing_stage: DetectionAnnotationProcessingStage`.
- `DetectionAnnotationBulkRequest`: `sequence_id: int`,
  `items: List[DetectionAnnotationBulkItem] = Field(min_length=1, max_length=500)`.
- `DetectionAnnotationBulkResult`: `annotation_id: int`, `detection_id: int`,
  `processing_stage: DetectionAnnotationProcessingStage`.
- `DetectionAnnotationBulkResponse`: `results: List[DetectionAnnotationBulkResult]`.

Per-item box validation is unchanged — `DetectionAnnotationData`
(`schemas/annotation_validation.py:180-250`) is reused as the field type, so
Pydantic rejects a malformed box with 422 before the handler body runs.

### Semantics

**Upsert by `detection_id`.** Each item is written with
`INSERT ... ON CONFLICT (detection_id) DO UPDATE`, so the client no longer
routes between POST and PATCH, and a retry after a failure updates rather
than colliding with the unique constraint. A read-then-write would leave that
collision reachable whenever two accepts of the same lane overlap — a
double-fired mutation, or two annotators on one alert — with the loser
raising an uncaught `IntegrityError` (500). `updated_at` is stamped in the
`DO UPDATE` branch, since the column's `onupdate` only fires for ORM-emitted
UPDATEs; it stays NULL on insert, matching the single-item path (#216).

**Validate everything before writing anything:**

- duplicate `detection_id` within `items` → 422 listing the duplicates;
- any `detection_id` not belonging to `sequence_id` (including ids that do not
  exist) → 422 listing the offending ids.

**One transaction.** All annotation rows plus one contribution row each are
staged, then a single `await session.commit()`; any raised `HTTPException`
rolls back. This mirrors `localize-submit`
(`endpoints/sequence_annotations.py:1363-1494`), which already commits a
multi-lane write atomically.

Contributions follow the same rule as `CRUD.update`
(`crud_detection_annotation.py:70-80`): record a contribution when the write
**lands** at `ANNOTATED`. (`CRUD.update` reads as "lands at ANNOTATED, or was
already" only on the surface — it applies the payload before the check, so
both operands describe the post-update stage and the second is redundant.
Testing the pre-update stage here instead would attribute a demotion to the
caller, listing them as a contributor to work they removed.) Contributions
are staged with the existing `record_contribution(..., commit=False)`
(`crud_detection_annotation.py:88`), whose docstring was written for exactly
this case — a partial commit would leave `ANNOTATED` rows unattributed, and
nothing backfills them.

`created_at` is set explicitly on inserts, matching the single-item CRUD.

### Response

`200 {"results": [{"annotation_id", "detection_id", "processing_stage"}]}` —
the same shape as the `localize-submit` bulk response. Deliberately not
`DetectionAnnotationRead`: contributors would cost a query per row and the
client does not read them (it invalidates and refetches).

## Frontend

- `services/api.ts`: add `bulkUpsertDetectionAnnotations(sequenceId, items)`,
  a plain JSON POST to `/annotations/detections/bulk`.
- `buildQuickSubmitPlan` (`utils/annotation/quickSubmitUtils.ts:169`) is
  unchanged, including the rule that frames already at `annotated` are skipped
  and that false-positive items on the existing annotation are preserved
  (`:193-201`).
- `runLaneQuickAccept` maps `plan.payloads` to
  `{detection_id, annotation, processing_stage}` and issues one call, returning
  early when the plan is empty. `existingAnnotationId` is no longer read by
  this path; it stays on the shared plan type, and is removed only if no other
  caller reads it.
- Unchanged: the popover, the Enter binding, `isAccepting`, both cache
  invalidations, and the error toast. The difference is that on error there is
  now nothing half-written to reconcile.

## Testing

Backend (pytest, isolated compose stack with a unique project name):

- create-only, update-only, and mixed create+update batches land correctly;
- **atomicity** — a batch whose last item is invalid writes nothing (the
  regression test for the reported bug);
- a `detection_id` belonging to another sequence → 422, before any write;
- duplicate `detection_id` in one batch → 422, before any write;
- one contribution row per annotated row, attributed to the caller;
- re-sending an identical batch is a clean update, not an IntegrityError;
- a non-localizer caller → 403.

Frontend (vitest):

- accepting an object issues exactly one request whose items cover every
  pending frame and omit frames already `annotated`;
- false-positive items survive in the sent payload;
- a rejected call shows the error toast and does not invalidate the cache.
