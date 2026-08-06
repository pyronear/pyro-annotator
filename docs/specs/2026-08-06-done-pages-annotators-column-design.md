# Done Pages Annotators Column — Design

**Date:** 2026-08-06
**Status:** Approved

## Problem

The `/classify/done` and `/localize/done` tables show *what* was annotated
but not *who* did it. Attribution already exists in the database —
`SequenceAnnotationContribution` records `user_id` + `contributed_at` for
every classify and localize submit — but neither done endpoint joins it,
and neither page displays or filters by it.

**Goal:** see at a glance who did what on the done pages, and filter the
tables by annotator.

## Scope

- An **Annotators** column, last column of both done tables.
- An **annotator filter** (single-select dropdown) in the existing filter
  popover on both pages.

Out of scope, deliberately:

- Distinguishing classify vs localize contributions. Both submit paths
  write `SequenceAnnotationContribution` rows on the sequence annotation
  and are not distinguishable there today; both pages show the full
  contributor set.
- Showing contribution timestamps.
- Backfilling attribution for annotations completed before the
  contribution table existed (those rows render an empty marker).
- Surfacing `DetectionAnnotationContribution` (per-detection localize
  attribution) — the sequence-level table already captures the localizer.

## Backend

### Response fields

`ClassifyDoneItem` and `LocalizeDoneQueueItem`
(`annotation_api/src/app/schemas/sequence.py`) gain:

- `annotators: list[str]` — distinct usernames of **human** contributors
  across all of the row's lanes/annotations, ordered by first contribution
  (`contributed_at`). The seeded system user (`WORKER_USERNAME`) is
  excluded: machine writes (auto-annotation, group fan-out, bulk
  annotate) are attributed to it and are not "annotators".

Built with one batched query per page: collect the page's sequence
annotation ids, join `SequenceAnnotationContribution` → `User`, group in
Python — the same pattern as the existing batch contributor lookup in
`sequences.py` (`get_annotation_contributors` usage).

### Filter param

`GET /sequences/classify-done` and `GET /sequences/localize-done-queue`
gain `annotator_id: int | None`. A row matches when **any** of its lanes'
sequence annotations has a contribution by that user — the same
row-group ("any lane") semantics as existing classify-done filters.
Filtering by id, not username, so renames don't break saved filters.
The param does not exclude rows that *also* have worker contributions;
it only requires the selected human to have contributed.

### Dropdown source

New `GET /api/v1/users/annotators`, accessible to any authenticated user
(the existing `GET /users/` list is superuser-only and stays that way):

- Returns `list[ContributorRead]` (`{id, username}`), unpaginated.
- Active users only, worker excluded, ordered by username.
- Usernames are already visible to annotators elsewhere (groups Reviewed
  column), so this exposes nothing new.

## Frontend

### Column

Both `ClassifyDoneTable.tsx` and `LocalizeDoneQueueTable.tsx` add an
**Annotators** `ColumnHeader` as the literal last column (after Result),
with a matching `<td>`:

| State                       | Cell                          |
| --------------------------- | ----------------------------- |
| One or more human annotators | `alice, bob` (comma-separated) |
| Empty (machine-only or legacy) | muted `—`                  |

### Filter

- `annotator_id?: number` added to `ExtendedSequenceFilters`
  (`types/api.ts`) and to the param objects of `getClassifyDone` /
  `getLocalizeDoneQueue` (`services/api.ts`).
- New `useAnnotators` hook mirroring `useCameras` (TanStack Query,
  5 min `staleTime`, new `QUERY_KEYS` entry) feeding a plain `<select>`
  in `FilterPopover.tsx`, modeled on the Camera dropdown.
- Full filter wiring: pill in `filterPills.ts`, clear-switch case and
  "more filters" count in `FilterPopover.tsx`, active-filter detection in
  `filterHelpers.ts`, and the empty-value cleanup in
  `usePersistedFilters.ts`.
- `DetectionReviewPage.tsx` builds its query params field-by-field — the
  new param is added there explicitly, and to the `SequencesPage.tsx`
  classify-done query.
- Filter state persists in the existing localStorage filter state
  (`filters-classify-done`, `filters-localize-done-v3`); no key-version
  bump needed since the new field defaults to absent.

## Testing

Backend (endpoint tests, both done endpoints):

- `annotators` lists distinct human contributors ordered by first
  contribution; duplicate contributions collapse to one name.
- Worker contributions are excluded from `annotators`; a machine-only row
  returns `[]`.
- `annotator_id` filters to rows where that user contributed to any lane;
  other rows drop out; no param returns everything.
- `GET /users/annotators`: requires auth, excludes worker and inactive
  users, returns `{id, username}` sorted by username.

Frontend (Vitest):

- Both table tests: Annotators column renders names, and `—` when empty.
- FilterPopover: annotator select renders options, sets the filter,
  produces a pill, clears correctly.
