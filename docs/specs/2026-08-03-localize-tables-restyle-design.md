# Localize Tables Restyle

**Date:** 2026-08-03
**Status:** Approved

## Goal

Bring the tables on `/localize` and `/localize/done` in line with the classify
tables (`/classify`, `/classify/done`): compact rows, small thumbnails, one
datum per column. Frontend-only — no API changes.

## Current state

- `/localize` (`DetectionAnnotatePage`) renders an inline `<table>` with its
  own styling: large thumbnails (`h-16 w-24`), `py-4` cells, azimuth inlined
  in the Camera cell, pill-styled Source and Smoke type columns.
- `/localize/done` (`DetectionReviewPage`) renders card-style flex rows via
  `DetectionReviewTableRow`: camera/source/platform pills on one line, an
  always-full progress bar, metadata dot-separated below, false-positive and
  smoke pills plus contributors on the right.

## Design

### `LocalizeQueueTable` (new, `src/components/sequences/LocalizeQueueTable.tsx`)

Props: `items: LocalizationQueueItem[]`, `onItemClick: (item) => void`.

Reuses classify's table conventions: same `HEADER_CLASSES` / `CELL_CLASSES`
constants, `h-10 w-16` thumbnail, `hover:bg-gray-50` clickable rows.

| Column | Content |
| --- | --- |
| Thumbnail | `DetectionImageThumbnail` for the first lane's sequence, `sr-only` header |
| Camera | `camera_name`, `font-medium text-gray-900` |
| Organisation | plain text |
| Recorded | `new Date(recorded_at).toLocaleString()` |
| Source | `source_api`, plain text (no pill) |
| Azimuth | `{azimuth}°`, empty when null/undefined |
| Smoke types | plain text, comma-separated; deduped across lanes needing localization (`formatSmokeType`, no pills, no emoji) |
| Objects | count of lanes where `laneNeedsLocalization(lane)` |
| Frames | sum of `total_detections` over those lanes |

The `smokeFrames` / `smokeTypes` helpers move from `DetectionAnnotatePage`
into this component; an analogous `smokeObjects` count is added.

### `LocalizeDoneTable` (new, `src/components/sequences/LocalizeDoneTable.tsx`)

Props: `sequences: SequenceWithDetectionProgress[]`,
`annotations: Record<number, SequenceAnnotation | undefined>` (the page
already builds this map), `onSequenceClick: (sequence) => void`.

Strict classify-done column parity, minus pills:

| Column | Content |
| --- | --- |
| Thumbnail | `DetectionImageThumbnail`, `sr-only` header |
| Camera | `camera_name` |
| Organisation | plain text |
| Recorded | locale string |
| Alert API annotation | `PlatformAnnotationPill` (kept — shared component, matches classify) |
| Source | plain text (no pill) |
| Azimuth | `{azimuth}°`, empty when null |
| Result | plain text: `⚠️ Unsure` when `is_unsure`, false-positive types (`formatFalsePositiveType`), smoke types (`formatSmokeType`), comma-separated; no pills |

Row coloring matches `ClassifyDoneTable`: amber background for unsure,
otherwise `getRowBackgroundClasses(analyzeSequenceAccuracy(...))`, so the
existing `SequencesLegend` stays accurate.

Dropped from the old card layout (per design decision): progress bar (always
100% on this page — the queue filters on complete detection annotation) and
contributors.

### Page changes

- `DetectionAnnotatePage`: replace the inline table with
  `<LocalizeQueueTable>`. Header, pagination, empty/loading/error states
  unchanged.
- `DetectionReviewPage`: replace the `divide-y` card list with
  `<LocalizeDoneTable>`. `DetectionReviewTableHeader`, `SequencesLegend`,
  `DetectionReviewPagination`, filters unchanged.
- `src/components/sequences/index.ts`: export the two new components; remove
  the `DetectionReviewTableRow` export and delete its file (orphaned by this
  change).

Out of scope: `DetectionAnnotateTableHeader` / `DetectionAnnotateTableRow`
are pre-existing dead code and are left untouched, as is the per-row
annotation fetching in `DetectionReviewPage`.

## Testing

New component tests mirroring `ClassifyQueueTable.test.tsx` /
`ClassifyDoneTable.test.tsx`:

- `tests/components/sequences/LocalizeQueueTable.test.tsx` — headers render;
  smoke types deduped across lanes and formatted as plain text; Objects and
  Frames computed from a multi-lane item (FP lanes excluded); azimuth empty
  when null; row click fires with the item.
- `tests/components/sequences/LocalizeDoneTable.test.tsx` — headers render;
  Result text for unsure / false-positive / smoke annotations; amber row for
  unsure; accuracy-based row background; row click fires.

Existing `DetectionReviewPage.defaults.test.ts` (filter contract) must keep
passing. Verification: `npm run quality` + `npm test`.
