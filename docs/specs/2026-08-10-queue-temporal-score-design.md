# Temporal Score in the Queues — Design

**Date**: 2026-08-10
**Status**: Approved
**Follows**: `2026-08-10-import-temporal-model-score-design.md` (#364, merged),
`2026-08-10-temporal-score-refresh-design.md` (#365, merged)

## Goal

Show each alert's platform temporal-model score in the classify and localize
lists, and let annotators sort by it, so the most likely fires can be worked
first.

## Scope

Four endpoints and their tables:

| endpoint | table component | page |
|---|---|---|
| `GET /sequences/classify-queue` | `ClassifyAlertQueueTable.tsx` | `SequencesPage.tsx` |
| `GET /sequences/localization-queue` | `LocalizeQueueTable.tsx` | `DetectionAnnotatePage.tsx` |
| `GET /sequences/classify-done` | `ClassifyDoneTable.tsx` | `SequencesPage.tsx` |
| `GET /sequences/localize-done-queue` | `LocalizeDoneQueueTable.tsx` | `DetectionReviewPage.tsx` |

All four live under `frontend/src/components/sequences/`. The sort state lives
on the page, not the table, matching `SequenceGroupsListPage.tsx`.

The two work queues are where triage order matters; the two done lists carry
the column so the score can be compared retrospectively against what
annotators actually found.

## Backend: the aggregate is exact, not approximate

Each of the four endpoints already builds an `alerts` subquery grouped by
`(source_api, platform_alert_id)` with aggregates like
`func.min(Sequence.recorded_at)`, `func.count()` and `func.sum(...)`. One more
aggregate joins them:

```python
func.max(Sequence.temporal_model_score).label("temporal_model_score"),
```

`MAX` is exactly the alert's score rather than a heuristic, because **only the
primary lane ever carries one** — object-split siblings are NULL by
construction (#364) — and `MAX` ignores NULLs. This matters practically: it
needs no join to identify the primary, and it works unchanged on
`LocalizationQueueItem` / `LocalizeDoneQueueItem`, which (unlike
`ClassifyQueueItem`) carry no `primary_sequence_id`.

If a future change ever let a sibling hold a score, `MAX` would silently start
returning the larger of the two. The invariant is enforced in
`object_split.split_sequence_records` and covered by tests there; this design
depends on it.

## Schema

`temporal_model_score: Optional[float] = None` is added to `ClassifyQueueItem`,
`LocalizationQueueItem`, `LocalizeDoneQueueItem` and `ClassifyDoneItem`, and
mirrored in `frontend/src/types/api.ts`.

## Sorting

Each endpoint gains two query parameters:

- `order_by`: `recorded_at` (default) or `temporal_model_score`
- `order_direction`: `desc` (default) or `asc`

replacing the hardcoded `order_by(desc(alerts.c.recorded_at))`. The
`platform_alert_id` tie-break already present on `classify-done` is preserved,
since it is what keeps page boundaries stable when alerts share a
`recorded_at`.

### NULLs sort last in both directions

Explicitly, via `.nullslast()` on both branches — not by relying on the
database default. Postgres puts NULLs **first** on `DESC`, so a plain
`ORDER BY temporal_model_score DESC` would fill the top of a "most likely fires
first" sort with entirely unscored alerts: the exact opposite of the intent.

The semantic argument agrees: an unscored alert is unmeasured, not
low-confidence. Sorting it to the bottom either way keeps the informative rows
visible regardless of direction.

This matters more than it looks while the column is sparsely populated —
before a full historical backfill, most rows are NULL.

## Frontend

A right-aligned `Score` column showing `Math.round(score * 100)` with a `%`
suffix, and `—` when null. Percentages read as confidence at a glance and put
the platform's 0.45 threshold at a memorable 45%.

Sorting reuses the existing `ColumnHeader` `sort` prop
(`{active, direction, onSort}`, which already renders the arrow and sets
`aria-sort`) together with the `orderBy` / `orderDirection` / `handleSort`
state pattern established in `SequenceGroupsListPage.tsx:276-299`. No new UI
pattern is introduced.

## Testing

**Backend**

- The aggregate returns the primary lane's score for a multi-lane alert — the
  case where a naive join could pick a sibling.
- An alert whose lanes are all unscored returns `null`.
- `order_by=temporal_model_score` orders correctly, with nulls last in **both**
  directions (the descending case is the one the database default gets wrong).
- The existing `recorded_at` default ordering is unchanged when no `order_by`
  is passed.

**Frontend**

- A score renders as a rounded percentage; `null` renders as `—`.
- Clicking the Score header issues the expected `order_by` / `order_direction`
  query parameters.

## Non-goals

- No threshold filter. The queue pages already carry filters; adding a
  "score above N" control is a separate decision, and while the column is
  mostly NULL such a filter would empty a queue rather than narrow it.
- No per-object score badge. The score belongs to one object of the alert, and
  showing it per lane would imply otherwise (decided in #364).
- No colour-coding or threshold emphasis. That would couple the UI to
  `TEMPORAL_MODEL_THRESHOLD`, which lives in pyro-api config and can change
  without the annotator knowing.

## Deployment note

The column is populated only for sequences imported after #364, so on
production it reads `—` for nearly every row until a historical backfill is run
with #365's refresh path. The feature is not broken in that state; it has no
data yet.
