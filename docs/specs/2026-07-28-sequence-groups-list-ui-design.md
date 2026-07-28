# Sequence Groups List — UI/UX Redesign

**Date:** 2026-07-28
**Status:** Approved
**Scope:** `frontend` (SequenceGroupsListPage) + `annotation_api` (sequence-groups list & stats endpoints)

## Problem

The sequence-groups list page (`/sequence-groups`) is functional but rough:

- The Camera column shows the numeric `camera_id` instead of the camera name.
- Nothing on the page explains what a sequence group *is* or why an annotator
  should care.
- Only the "Group #" cell is clickable; the natural gesture — click the row to
  review the group — does nothing.
- Columns cannot be sorted.
- The all/unlabeled/labeled filter buttons are plain and give no sense of how
  much work is left.

## Design

Approved via mockup review (visual companion). A polished, text-only table —
no thumbnails in the list; the per-group review page already shows imagery.

### Backend changes (`annotation_api`)

1. **`camera_name` in list items.** The list endpoint's member-count subquery
   additionally selects `min(Sequence.camera_name)` per group (all members of a
   group share one camera, so `min` is just "pick the one value").
   `SequenceGroupListItem` gains a required `camera_name: str` field. No
   migration — camera names are already denormalized on `Sequence`.

2. **Server-side sorting.** New query params on `GET /api/v1/sequence-groups/`,
   following the existing pattern in `sequences.py`:
   - `order_by`: `member_count` (default) | `camera_name` | `azimuth` |
     `created_at`
   - `order_direction`: `desc` (default) | `asc`

   Whatever the primary sort, `created_at DESC, id DESC` remain as trailing
   tie-breakers so paginated offsets stay deterministic.

3. **Filter counts.** `GET /api/v1/sequence-groups/stats` gains `labeled` and
   `unlabeled` fields computed over the same 3-plus-member population as the
   existing `total` / `validated` / `unvalidated` fields (a group is "labeled"
   when `smoke_type` or `false_positive_type` is set — same predicate as the
   list endpoint's `labeled` filter).

4. **Tests.** Extend the sequence-groups endpoint tests: `camera_name` present
   and correct; each `order_by`/`order_direction` combination orders rows;
   stats include correct `labeled`/`unlabeled` counts.

### Frontend changes (`frontend`)

`SequenceGroupsListPage.tsx` is rebuilt to match the approved mockup:

1. **Header + explainer.** Title "Sequence groups", subtitle "Label many
   related sequences at once.", then an info box (blue, info icon):

   > **What is a sequence group?** After each import, sequences from the same
   > camera looking in the same direction at the same spot are grouped
   > automatically — usually one recurring smoke plume or false-positive source
   > (an antenna, a cloud bank…). Open a group, label one of its sequences, and
   > once the group is validated the label propagates to every member. Only
   > groups with 3+ sequences are shown.

   Always visible (short enough not to need dismissal).

2. **Segmented filter with counts.** A segmented control replacing the three
   buttons, in workflow order with live counts from the stats endpoint:
   **To label [n] · Labeled [n] · All [n]**. Default stays "To label" (maps to
   `labeled=false`). Counts come from the extended stats endpoint via a
   React Query hook; while stats load, badges are simply omitted.

3. **Sortable columns.** Clickable headers for Camera, Azimuth, Sequences,
   Created with an arrow indicator on the active sort. Clicking toggles
   asc/desc (first click uses each column's natural direction: text asc,
   numbers/dates desc) and resets to page 1. Sort state drives the new
   `order_by`/`order_direction` params. Default: Sequences (member_count)
   descending.

4. **Table presentation.**
   - Camera: bold camera name, muted `#id` suffix.
   - Azimuth: `245°`.
   - Sequences: member count in a blue pill.
   - Label: orange pill `smoke · <type>`, gray pill `false positive · <type>`,
     yellow pill `to label` when unlabeled.
   - Reviewed: green `✓ validated` or muted `—`.
   - Created: relative time ("2 h ago", "yesterday", falling back to a short
     date), exact timestamp in `title` tooltip. Implemented as a small local
     helper — `date-fns` is not a dependency and one function does not justify
     adding it.
   - Trailing chevron `›` column signalling clickability.

5. **Row interaction.** The whole row navigates to
   `/sequence-groups/{id}/annotate` (hover highlight + `cursor-pointer`). The
   camera-name cell keeps a real `<Link>` to the same URL so middle-click,
   copy-link, and keyboard navigation still work; its click handler stops
   propagation to avoid double navigation.

6. **Supporting changes.** `SequenceGroupListItem` type gains `camera_name`;
   `SequenceGroupStats` gains `labeled`/`unlabeled`; `apiClient.getSequenceGroups`
   passes `order_by`/`order_direction`. Loading, error, empty-state, and
   pagination behaviour is unchanged in substance, restyled to match the
   mockup; empty-state copy updated to the "to label" wording.

## Out of scope

- Thumbnails/imagery in the list rows (option B/C from the mockup review).
- Sorting by label or reviewed state.
- Any change to the group review (annotate) page.

## Verification

- Backend: `make lint`; endpoint tests for camera_name, ordering, stats (run
  via the isolated-compose test setup).
- Frontend: `npm run quality` (ESLint, type-check, tests).
- Visual check of the page against the approved mockup in the local dev stack.
