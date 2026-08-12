# Temporal model score on the recurring-objects list

**Date:** 2026-08-12
**Status:** Approved
**Page:** `/classify/groups` (`SequenceGroupsListPage`)

## Problem

The recurring-objects list shows camera, organisation, azimuth, sighting count,
label and annotators, but nothing about how likely the object is to be real
smoke. The alert platform's temporal-model score already rides on every
imported sequence and is surfaced in all four alert queues; the groups list is
the one work list that ignores it. Annotators triaging which recurring object
to label next have no way to float the likely fires to the top.

## Decision

Add a single sortable **Score** column showing the **maximum**
`temporal_model_score` across the group's member sequences.

### Why max, and why one number

The column's job is triage order — a ranking key, like the classify queue's
score column. That argues for one number per row, not a range or a
distribution.

Max is also the only aggregate that is exact given how the score is stored.
Only the primary lane of an alert carries a score; sibling object-lanes are
NULL by construction (see `docs/specs/2026-08-10-import-temporal-model-score-design.md`).
`MAX` ignores NULLs, so an unscored sibling never drags a group down, and no
join is needed to find the scored lane. A mean or median over the same column
would silently average over a denominator that depends on how many of the
object's sightings happened to be the alert's primary object — not a
meaningful quantity.

### What the number means, honestly

The group max is the highest score among the sightings **where this object was
the alert's scored object**. We deliberately do not borrow an alert's score for
a sibling lane: the temporal model builds its ROI from one object's box only,
so a sibling would inherit a score computed while deliberately excluding it.
That misattribution is exactly what the import design prevents.

Within-group spread is large in real data — every group in the local dataset
has a min of 0.00 while maxes reach 0.48–0.58 — so a row reading 58% may come
from one sighting out of three. The header tip says so; the cell does not try
to.

## Backend

`GET /api/v1/sequence_groups/` (`list_sequence_groups`).

- Add `func.max(Sequence.temporal_model_score).label("temporal_model_score")`
  to the existing `member_count_subq`. It groups by `sequence_group_id`
  already, so this is a new aggregate on an existing scan — no extra join, no
  extra query, and it stays inside the `HAVING count(*) >= 3` population.
- Select `member_count_subq.c.temporal_model_score` in the outer query. It
  flows into `SequenceGroupListItem` through the existing
  `**dict(r._mapping)` splat in `_hydrate`.
- Add `temporal_model_score: Optional[float]` to `SequenceGroupListItem`.
- Add `temporal_model_score` to `SequenceGroupOrderByField` and to the
  `order_columns` map, pointing at `member_count_subq.c.temporal_model_score`.

### NULL ordering

The chosen sort column must be wrapped in `.nullslast()` in **both**
directions. Postgres orders NULLs first on DESC, which would fill the top of a
"most likely fires first" sort with objects nothing ever scored. The existing
`created_at desc, id desc` tie-breakers stay so paginated offsets remain
stable.

Groups whose every member is unscored yield NULL and sort last.

## Frontend

`SequenceGroupsListPage` and `types/api.ts`.

- `SequenceGroupListItem` gains `temporal_model_score: number | null`.
- `OrderBy` gains `'temporal_model_score'`; `DEFAULT_DIRECTION` maps it to
  `'desc'` (first click shows the highest scores, like `member_count`).
- New `ColumnHeader label="Score"` between **Azimuth** and **Sightings**,
  mirroring the classify queue's azimuth → score → count order. Tip: "Highest
  Alert API temporal-model score across this object's sightings. The platform
  scores one object per alert, so — means this object was never the one it
  scored." The tip must not say "none of its sightings were scored": an object
  that is never its alert's primary lane shows — even though every one of
  those alerts *was* scored, just for a different object. Wording it the
  loose way would push annotators to deprioritize exactly those objects.
- Cell renders the existing `<TemporalScoreCell score={g.temporal_model_score} />`
  unchanged, in a `${CELL_CLASSES} ${DATA_CELL_TEXT}` cell. Left-aligned like
  this table's other numeric cells — the queues right-align theirs, but
  internal consistency within this table wins.

`TemporalScoreCell` already handles the three cases: a percentage, `0%` for a
real zero (it tests `score == null`, never truthiness), and `—` for null.

### Default sort unchanged

The page keeps defaulting to `member_count desc` — "label the object that
unlocks the most sightings first" is this page's stated pitch, and the score
column is one click away. No auto-advance or continuous-flow code reads this
page's ordering, so nothing else has to change.

## Testing

Backend (`src/tests/endpoints/test_sequence_groups.py`):

- A group whose members mix real scores and NULLs reports the max of the
  non-NULL ones.
- A group whose members are all unscored reports `null`.
- Sorting by `temporal_model_score` places all-NULL groups last in **both**
  directions. Assert row order, not the compiled clause: with distinct scores
  the ordering is fully determined by the column, and Postgres's NULL default
  is specified (FIRST on DESC), so dropping `nullslast` fails the DESC case
  deterministically rather than by luck. **Only the DESC half has teeth** —
  Postgres already defaults ASC to NULLS LAST, so that assertion passes with
  or without `.nullslast()`. It is kept as a regression pin on the default,
  not as a guard against a `nullslast` applied to only one branch; a
  DESC-only implementation would still pass it.

Frontend (`tests/pages/SequenceGroupsListPage.test.tsx`):

- The row renders the percentage for a scored group.
- The row renders `—` for a null score.
- A score of `0` renders `0%`, not `—`.
- Clicking the Score header issues `order_by=temporal_model_score` with
  `order_direction=desc` on first click.

## Out of scope

- The group detail page `/classify/groups/:id` renders member *cards*, not a
  table, and the "no per-object score badge" decision from 2026-08-10 stands.
- Backfilling scores onto sequences imported before the score capture landed.
  Until that happens, groups whose members all predate it show `—`.
- Any filter or threshold on the score. Sorting only.
