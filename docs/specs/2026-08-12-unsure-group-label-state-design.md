# An unsure recurring object is a third label state, not a to-do

**Date**: 2026-08-12
**Status**: Approved
**Base**: `main` at `5af0c53d`.

## Problem

Four validated recurring objects (groups `368`, `599`, `2928`, `3489`, 63 member
sequences between them) sit in the "To label" tab of `/classify/groups`
permanently, even though every one of their sightings is annotated. They read
exactly like objects nobody has touched.

All four share one shape:

```
 id  | is_unsure | is_validated | smoke_type | false_positive_type | labeled_at
3489 |     t     |      t       |    NULL    |        NULL         |   NULL
 368 |     t     |      t       |    NULL    |        NULL         |   NULL
 599 |     t     |      t       |    NULL    |        NULL         |   NULL
2928 |     t     |      t       |    NULL    |        NULL         |   NULL
```

Every member is at `SEQ_ANNOTATION_DONE` with `is_unsure = true`,
`has_smoke = false` and no false-positive types — all written within ~300 ms of
each other, i.e. one fan-out.

### How they got there

An annotator validated the group, opened one member, and classified it *unsure
with no label*. `_propagate_to_group_if_validated`
(`annotation_api/src/app/api/api_v1/endpoints/sequence_annotations.py:1055-1077`)
takes its unsure branch: it sets `group.is_unsure = True`, leaves both label
columns `NULL` — they *must* stay `NULL`, the
`ck_sequence_group_labeled_at_consistency` check constraint forbids a
`labeled_at` without a label — and fans that unsure state onto every sibling.

That branch is deliberate ("spread the uncertainty across the group instead of
dropping it", commit `864110bb`, 2026-06-18). The commit is backend-only; the UI
was never taught that a group can be unsure.

### Why it looks like a to-do

Four places decide what a group's label state is, and all four key on
`smoke_type OR false_positive_type` alone:

| Site | Effect |
| --- | --- |
| `SequenceGroupsListPage.tsx:371-389` | falls through to the ember "to label" chip |
| `SequenceGroupAnnotatePage.tsx:296-308` | same chip in the detail header |
| `sequence_groups.py:249-257` (`labeled` filter) | group is returned by the "To label" tab |
| `sequence_groups.py:318-323` (stats) | counted in `unlabeled` |

`is_unsure` is already selected by the list query, already present on
`SequenceGroupListItem` and on the frontend's `SequenceGroupListItem` type. It is
simply never rendered and never counted.

`unlabeled` also drives the sidebar badge (`useAnnotationCounts.ts:39`) and the
dashboard's "objects to label" figure (`usePipelineStats.ts:20`), so the four
groups inflate those too.

### Not #253

The known gap #253 (group `PATCH` validate never re-derives a label from members
already at a done stage) is a different failure. No validated group in the
2026-08-12 dump has a labelled member and no group label. 314 such groups exist,
but all are unvalidated, so they are simply awaiting validation.

## Scope

**In:** making the unsure state legible — a fourth branch in the two label
displays, a third value in the list filter, a third count in the stats, and a
new tab/route. Tests for all of it.

**Out:** the 63 fanned-out member annotations. They stay as they are, including
their hold on those alerts' entry into the localize queue (they are "unsettled
unsure", so `unsettled_unsure_clause` withholds their alerts). Also out: any
change to whether unsure *should* fan out across a validated group at all, any
direct group-label action, and any link from the new tab into the resolution
flow.

## Design

### The partition

Three mutually exclusive states covering every group:

| State | Predicate |
| --- | --- |
| `labeled` | `smoke_type IS NOT NULL OR false_positive_type IS NOT NULL` |
| `unsure` | no label **and** `is_unsure` |
| `unlabeled` | no label **and not** `is_unsure` |

A group carrying both a label and `is_unsure` counts as `labeled` — the label is
the stronger statement, and propagation cannot produce that combination anyway
(it refuses to overwrite a labelled group with an unsure write, and a labelled
propagation resets `is_unsure` from the source annotation).

### Backend

`GET /api/v1/sequence_groups/` — replace the boolean `labeled` query parameter
with an enum, because the states are no longer a yes/no:

```
label_state: Optional[GroupLabelState]   # "labeled" | "unlabeled" | "unsure"
                                         # omitted = all
```

The only caller is this repo's frontend, so the parameter is replaced outright
rather than kept alongside a new one.

`GET /api/v1/sequence_groups/stats` — `SequenceGroupStats` gains `unsure: int`,
and `unlabeled` becomes `total - labeled - unsure`. The three now partition
`total` over the same 3+-member population the list endpoint uses. The sidebar
badge and dashboard figure shed the four groups as a consequence, which is
correct: they are not actionable labelling work.

### Frontend

- `SequenceGroupsFilter` (`utils/routes.ts:46`) gains `'unsure'`;
  `classifyGroups('unsure')` yields `/classify/groups/unsure`. The bare path
  remains "To label". New route in `App.tsx` beside the `labeled` and `all` ones.
- Tabs become **To label · Unsure · Labeled · All**, each with its count from
  stats.
- `apiClient.getSequenceGroups` takes `label_state?: GroupLabelState` in place of
  `labeled?: boolean`.
- The label cell and the detail header gain a fourth branch: no label and
  `is_unsure` renders an **"unsure"** chip in neutral tokens (`bg-ash` /
  `text-haze`), deliberately not the ember "to label" chip — an unsure object is
  a recorded decision, not an outstanding task. Its hover tip states that the
  object was marked undecidable and that unsure sightings are settled from
  `/classify/done` under the "Only Unsure" filter. Text only; no link.
- An empty state for the Unsure tab in the same idiom as the existing two.

## Testing

**Backend** (`src/tests/endpoints/test_sequence_groups.py`)

- Each `label_state` value returns exactly its partition; an unsure group is
  absent from `unlabeled` and from `labeled`.
- Omitting `label_state` returns all three kinds.
- `stats`: `labeled + unsure + unlabeled == total`, with an unsure group counted
  under `unsure` only.

**Frontend** (`tests/pages/SequenceGroupsListPage.test.tsx`)

- A group with `is_unsure` and no label renders the "unsure" chip, not "to
  label".
- The Unsure tab requests `label_state=unsure`. Assert on the serialized request
  URL — the axios serializer in `services/api.ts` silently drops any filter whose
  value is `null`.
- The four tabs render their counts from `SequenceGroupStats`.
