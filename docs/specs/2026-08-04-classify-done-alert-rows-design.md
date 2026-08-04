# Classify Done: Alert Rows

**Date**: 2026-08-04
**Status**: Approved

## Problem

`/classify/done` lists one row per object-sequence while the classify queue
and the detail pages are alert-level. Two consequences:

- A multi-object alert appears as several rows that all open the same
  detail page.
- The Result cell derives from a single annotation, and its FN branch only
  renders "Missed smoke" (+ smoke types). An annotation that combines a
  false-positive object with alert-level missed smoke (e.g. FP antenna +
  `has_missed_smoke`) shows as bare "⚑ FN" — the object's own
  classification is invisible in the table.

The outcome-codes spec (2026-08-03) designed the multi-object rollup for
alert rows and anticipated classify tables adopting them; this spec is that
adoption for the done list.

## Decisions

- **Membership**: an alert appears in the done list only when *fully*
  classified — every lane has an annotation and none is
  `READY_TO_ANNOTATE`. Partially classified alerts stay in the queue only.
- **Filters**: annotation filters are kept with **any-lane** semantics,
  implemented server-side so pagination stays correct.
- **Stage selector**: dropped. No per-alert stage exists (smoke lanes park
  at `SEQ_ANNOTATION_DONE`, FP-only lanes jump to `ANNOTATED`), and the
  localize pages already separate the two exits.
- **Result cell**: dominant-outcome rollup code with `+N`, followed by
  detail text listing *every* lane's classification. The motivating alert
  renders `⚑ FN · Missed smoke · Antenna`.

## Backend

New endpoint `GET /api/v1/sequences/classify-done`, declared before
`/{sequence_id}` (path-converter shadowing, same as `/classify-queue`).

- **Membership predicate**: group sequences by
  `(source_api, platform_alert_id)`; include groups where every sequence
  has a `SequenceAnnotation` whose `processing_stage` is in `DONE_STAGES`
  (`seq_annotation_done`, `annotated`). A lane without an annotation row
  excludes its alert.
- **Filters** (any-lane where annotation-derived):
  - `camera_name`, `organisation_name`, `source_api`,
    `recorded_at_gte`, `recorded_at_lte` — as on `/classify-queue`.
  - `false_positive_type` (JSONB containment on
    `false_positive_types`), `smoke_type`, `is_unsure`.
  - `model_accuracy` ∈ `tp | fp | fn`, derived in SQL with the frontend's
    precedence: `has_missed_smoke → fn`, else `has_smoke → tp`, else
    `fp`. Matches if any lane's derived accuracy equals the value. This
    replaces the current client-side accuracy filter, which only filtered
    the fetched page. (No `unknown` value: membership guarantees every
    lane is annotated, so the frontend's "unknown" filter option is
    dropped alongside.)
- **Response**: `Page[ClassifyDoneItem]`, ordered `recorded_at` desc
  (min across lanes, as on the queue):

  ```
  ClassifyDoneItem:
    source_api, platform_alert_id, camera_name, organisation_name,
    azimuth, recorded_at, is_wildfire_alertapi, primary_sequence_id
    lanes: [ClassifyDoneLane]

  ClassifyDoneLane:
    sequence_id, has_smoke, has_missed_smoke, is_unsure,
    smoke_types, false_positive_types
  ```

  Primary lane = lowest `alert_api_id`, as elsewhere. The frontend derives
  outcomes and the rollup from `lanes`; the server computes accuracy only
  inside the `model_accuracy` filter.

## Frontend

- `SequencesPage` review mode fetches the new endpoint (new
  `apiClient.getClassifyDone`) instead of `getSequencesWithAnnotations`.
  The `filteredSequences` client-side accuracy filter and its adjusted
  pagination totals are removed; filter controls stay, now mapping to the
  server params. Pagination label becomes "alerts".
- `ClassifyDoneTable` takes `ClassifyDoneItem[]`:
  - Result cell: derive each lane's outcome with `deriveSequenceOutcome`,
    roll up with `rollupOutcomes`, render `OutcomeCode` with `extraCount`.
    Detail text concatenates, ` · `-separated: "Missed smoke" if any lane
    has it, each smoke lane's formatted smoke types, each FP lane's
    formatted FP types. Deduplicated, order: missed smoke, smoke types,
    FP types.
  - Thumbnail via `primary_sequence_id`; other columns read alert header
    fields.
  - Row click navigates to `/classify/done/{primary_sequence_id}`
    (`ClassifyAlertPage` already loads the whole alert from any lane id).
    Workflow navigation receives primary-id stubs, as `handleAlertClick`
    does for the queue.
- `SequencesPageWrapper`: the review-stage selector and its persisted
  `classify-done-stage` state are removed; review mode always passes the
  classified-stages filter concept implicitly via the new endpoint.

## Testing

- Backend: membership (fully classified in; partial, unannotated-lane,
  and unclassified alerts out), each any-lane filter incl.
  `model_accuracy` precedence, pagination/ordering, primary-lane
  selection.
- Frontend: table renders alert rows with rollup `+N` and full detail
  text; unit test for the detail builder covering the FN + FP-types
  combination (missed smoke + antenna) that motivated this change;
  updated `SequencesPage` review-mode tests (endpoint swap, selector
  removal).

## Out of scope

- The classify queue and detail pages (already alert-level).
- The localize tables (already rolled up per the outcome-codes spec).
- Any change to stored annotations — this is read-path only.
