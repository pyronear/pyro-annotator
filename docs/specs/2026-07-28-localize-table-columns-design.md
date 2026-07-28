# /localize Queue Table — Column Redesign

**Date:** 2026-07-28
**Status:** Approved
**Scope:** `frontend/src/pages/DetectionAnnotatePage.tsx`, `frontend/src/types/api.ts`, `annotation_api` localization-queue endpoint

## Goal

Make the Smoke Localization queue (`/localize`) rows more informative for picking
work: show a visual preview, provenance, camera direction, and workload size —
and drop the two progress-oriented columns that were not useful there.

## Current state

Columns today: Camera, Organisation, Recorded (relative time, e.g. "3 hours
ago"), Objects ("2 of 3 objects to localize"), Progress ("5/12 boxes").

## Target columns

| Column       | Content                                                                    | Source                                              |
| ------------ | -------------------------------------------------------------------------- | --------------------------------------------------- |
| Preview      | Thumbnail of the alert's first detection image (`DetectionImageThumbnail`, `h-16`) | Primary lane's `sequence_id` (`lanes[0]`)           |
| Camera       | Camera name, with muted `Azimuth: 143°` text when azimuth is non-null       | `camera_name`, new `azimuth` field                  |
| Organisation | Unchanged                                                                   | `organisation_name`                                 |
| Source       | `source_api` as the blue pill used in the classify queue rows               | `source_api` (already in the payload, not shown)    |
| Recorded     | Absolute date-time via `new Date(...).toLocaleString()` (app convention)    | `recorded_at`                                       |
| Frames       | Total images to box across the alert's smoke lanes, e.g. "20 frames" — 2 objects × 10 frames = 20 | Sum of `total_detections` over `has_smoke` lanes    |

Dropped: Objects and Progress columns, and the helpers that only served them
(`unfinishedSmokeLanes`, `annotatedBoxes`). The existing `totalBoxes` helper is
the Frames computation (rename to match its new meaning).

## Backend change

`GET /api/v1/sequences/localization-queue` gains one field:

- `LocalizationQueueItem.azimuth: Optional[int]` (`schemas/sequence.py`),
  populated in `_build_queue_item` from the primary lane's sequence
  (`first_seq.azimuth`, same source as `camera_name`). Object-split siblings can
  carry per-object cone azimuths; the primary's value represents the camera's
  viewing direction, which is what the queue row needs.

No query changes; no performance impact.

## Frontend change

- `LocalizationQueueItem` type gains `azimuth: number | null`.
- Table restructured to the target columns above. Thumbnail requests reuse
  `DetectionImageThumbnail` (two cached queries per row — same pattern and page
  size as the classify queue, an accepted cost).

## Testing

- Backend: extend the localization-queue endpoint tests to assert `azimuth` is
  returned, and `None` when the sequence has no azimuth.
- Frontend: cover the Frames computation (smoke lanes only) and the rendered
  columns, following whatever test coverage the page has today.

## Out of scope

- Sorting/filtering of the queue.
- Per-lane azimuth display or any per-object breakdown.
- Backend-provided thumbnail URLs (client-side fetch is the established pattern).
