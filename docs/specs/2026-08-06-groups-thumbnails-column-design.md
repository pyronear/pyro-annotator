# Groups list thumbnails column

**Date:** 2026-08-06
**Status:** Approved

## Goal

On `/classify/groups` (the recurring-objects table), add a far-left column
showing 3 small image crops of the potentially-same object, so a reviewer can
judge at a glance — without opening the group — whether the grouped sequences
really show one recurring object.

## Decisions

- **Thumbnail content:** zoomed crop of the object, reusing the crop technique
  of the group annotate page's member cards (region = 3× the bbox, zoom capped
  at 8×). Not the full frame — at thumbnail size the object would be invisible.
- **Member picking:** first, middle, last member by `recorded_at` — spread
  across the group's timeline, the best evidence that the object recurs.
- **Data flow:** the list endpoint embeds everything (presigned image URL +
  crop bbox) directly in each `SequenceGroupListItem`. Presigning is a local
  boto3 computation, so this costs no extra latency and avoids ~150 extra
  frontend round trips per 50-row page.

## Backend (`annotation_api`)

### Schema

```python
class SequenceGroupThumbnail(BaseModel):
    detection_id: int
    url: str                                   # presigned image URL
    bbox_xyxyn: list[float] | None             # crop box; None → frontend falls
                                               # back to representative_bbox

class SequenceGroupListItem(...):
    ...existing fields...
    thumbnails: list[SequenceGroupThumbnail]   # 0–3 entries
```

### Implementation

In `list_sequence_groups` (`endpoints/sequence_groups.py`), after the existing
paginated query resolves the page's group IDs (≤ page size):

1. One query ranks each group's members by `recorded_at` with a window
   function, restricted to members that have a first detection (a
   detection-less member is skipped, so a group can yield fewer than 3
   thumbnails). Per group keep ranks first / middle / last (middle =
   `count // 2` 0-indexed); when the eligible member count is < 3 the picks
   deduplicate naturally.
2. Join each picked member's first detection — same "first detection of the
   sequence" logic the group detail endpoint already uses — for `id`,
   `bucket_key`, and `algo_predictions`.
3. `bbox_xyxyn` = union of the first detection's *valid* algo-prediction boxes
   (same math as the detail page's `cropBox`); `None` when the frame has no
   valid prediction boxes.
4. Presign each `bucket_key` via `bucket.get_public_url` and attach the
   thumbnail lists to the page items in member-`recorded_at` order.

### Tests

- 3 thumbnails picked in first/middle/last `recorded_at` order.
- Group with exactly 3 members → the 3 members, no duplicates.
- Detection-less member skipped (fewer thumbnails returned).
- Payload carries `url` and `bbox_xyxyn`; `bbox_xyxyn` is `None` when the
  detection has no valid prediction boxes.

## Frontend

- Extract the private `ZoomedCrop` component from
  `SequenceGroupAnnotatePage.tsx` (~25 lines: 3× bbox region, 8× zoom cap)
  into a shared component and reuse it in both places — pure move, no behavior
  change.
- `types/api.ts`: mirror `SequenceGroupThumbnail`; add `thumbnails` to
  `SequenceGroupListItem`.
- `SequenceGroupsListPage.tsx`: new far-left column, header "Preview" (not
  sortable). Cell = `flex gap-1` row of up to 3 fixed-size crops (~56×42px,
  `aspect-video`, `bg-ash` placeholder). Each `<img>` uses `loading="lazy"`
  so only visible rows download images. Crop box:
  `thumbnail.bbox_xyxyn ?? group.representative_bbox`.
- Thumbnails are not links; clicks bubble to the existing row navigation.
- **Error handling:** a failed image load shows the `bg-ash` placeholder
  (hide the broken img via `onError`); no retry logic.

### Tests

- Cell renders one img per thumbnail with the returned URL.
- Crop falls back to `representative_bbox` when `bbox_xyxyn` is null.
- Empty `thumbnails` renders placeholders, not a crash.

## Out of scope

- No new endpoint; no change to the group detail page.
- No re-picking controls, hover previews, or click-to-open on thumbnails.
- No caching/CDN work for presigned URLs.
