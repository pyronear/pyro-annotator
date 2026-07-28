# Classify Table Columns — Design

**Date:** 2026-07-28
**Status:** Approved

## Goal

Replace the card list on `/classify` (and its Done view) with a real, scannable
`<table>` in the style of the Localize > Smoke queue (`DetectionAnnotatePage`),
surfacing only the columns that matter for each view.

## Current State

- `/classify` renders a card list via `SequenceTableRow.tsx`: thumbnail (h-16),
  camera heading, source-api pill, wildfire-classification pill, stage pill,
  and a metadata line (full timestamp · organisation · azimuth). The Done view
  layers on unsure badges, model-accuracy row coloring, FP/smoke-type pills,
  and contributors.
- Localize > Smoke is a plain inline `<table>` with five text columns and no
  pills or thumbnails.
- The two pages share no table code, and the queue and Done views of /classify
  should stay separate components (explicit decision — no shared table
  component for now).

## Design

### Queue table (`/classify`, ready_to_annotate)

Real `<table>`, one row per sequence, ~48px rows. Columns:

| Column | Content |
|---|---|
| Thumbnail | `DetectionImageThumbnail`, compact (~40px tall) |
| Camera | `camera_name`, bold |
| Organisation | `organisation_name` |
| Recorded | Absolute date+time (`toLocaleString()`) |
| Platform annotation | Alert-platform annotation pill from `is_wildfire_alertapi` (🔥 Wildfire / 💨 Other Smoke / ○ Other) |
| Source API | Blue source pill |
| Azimuth | `{azimuth}°`, empty when null |

No stage pill (queue is single-stage). Plain `hover:bg-gray-50` rows.
Row click keeps navigating to `/classify/:id`.

### Done table (`/classify/done`)

Same columns as the queue table, **plus**:

| Column | Content |
|---|---|
| Result | Human annotation outcome: FP-type pills + smoke-type pills, and the ⚠️ Unsure badge when `annotation.is_unsure` |

- Recorded shows the same absolute date+time as the queue.
- Keeps model-accuracy **row background coloring** (via
  `analyzeSequenceAccuracy` / `getRowBackgroundClasses`), amber for unsure,
  with `SequencesLegend` above the table.
- **Dropped:** per-row stage pill (the Stage select in the header already
  covers this) and the contributors list.
- Row click keeps navigating to `/classify/done/:id`.

## Implementation Shape

Two self-contained components in `src/components/sequences/`:

- `ClassifyQueueTable.tsx`
- `ClassifyDoneTable.tsx`

Each renders the full `<table>` (headers + rows) and receives the sequence
list plus the existing click handler. `SequencesPage.tsx` picks one based on
`isAnnotatedView`. `SequenceTableRow.tsx` is retired (deleted along with its
barrel export) since this change makes it unused.

Untouched: `TabbedFilters`, pagination, page-size select / summary bar
(`SequencesTableHeader`), Done-view Stage select, empty states, data fetching,
and the `/localize` pages (including their near-duplicate
`DetectionReview*`/`DetectionAnnotate*` components — the unused
`DetectionAnnotateTableHeader/Row` pair is pre-existing dead code and stays).

## Testing

- Component tests for both tables: correct columns per view, Result pills and
  unsure badge on Done, relative vs absolute Recorded formatting, row-click
  navigation callback.
- Update any existing tests that assert on the card-list markup.
- Baseline: 742 tests passing before the change; full suite must pass after.
