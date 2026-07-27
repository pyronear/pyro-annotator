# Sequence Group Count Badge — Design

**Date:** 2026-07-27
**Status:** Approved

## Goal

Show a count pill next to the "Sequence groups" entry in the sidebar navigation. The
count is the number of **unvalidated** sequence groups (groups with 3 or more members
where `is_validated = false`) and stays in sync as annotators validate or unvalidate
groups.

## Backend

### New endpoint: `GET /api/v1/sequence_groups/stats`

- Returns aggregate counts over sequence groups that have **3 or more members** — the
  same `HAVING count(members) >= 3` rule the list endpoint uses, so the badge always
  matches what the list page shows.
- Response schema `SequenceGroupStats`:

  ```json
  {
    "total": 12,
    "validated": 5,
    "unvalidated": 7
  }
  ```

- Same JWT auth dependency as the other sequence-group endpoints.
- The route must be declared **before** `GET /{group_id}` in
  `annotation_api/src/app/api/api_v1/endpoints/sequence_groups.py`, otherwise FastAPI
  tries to parse `"stats"` as an integer group id and returns 422.

### Schema

- New `SequenceGroupStats` Pydantic model in
  `annotation_api/src/app/schemas/sequence_group.py` with `total`, `validated`,
  `unvalidated` (all `int`).

## Frontend

### API client and types

- `SequenceGroupStats` interface in `frontend/src/types/api.ts`.
- `apiClient.getSequenceGroupStats()` in `frontend/src/services/api.ts` calling
  `GET /sequence_groups/stats`.

### Count hook

- Extend `frontend/src/hooks/useAnnotationCounts.ts` with a third query:
  - Query key: `['annotation-counts', 'sequence-groups']`. Nesting under the
    `['annotation-counts']` prefix means every existing broad invalidation (e.g. after
    label propagation in `AnnotationInterface`) refreshes it for free.
  - Fetches `getSequenceGroupStats()` and exposes `groupCount = stats.unvalidated`.
  - Same options as the existing queries: `staleTime` 5 min, `gcTime` 10 min,
    `refetchOnWindowFocus: true`.

### Sidebar badge

- `frontend/src/components/layout/AppLayout.tsx`:
  - Add `badgeCount?: number` to the `NavigationItem` interface (top-level items
    currently have no badge slot — only `NavigationSubItem` does).
  - Render `<NotificationBadge>` in the top-level `item.href` branch, mirroring the
    existing sub-item badge layout (`justify-between` flex row).
  - Set `badgeCount` on the "Sequence groups" entry from the hook's `groupCount`.
- `frontend/src/components/ui/NotificationBadge.tsx`: add an optional `title` prop
  (default: current hardcoded `"{count} items need annotation"`) so the groups pill can
  show an accurate tooltip like `"{count} groups need validation"`.

### Keeping the count in sync

- `frontend/src/pages/SequenceGroupAnnotatePage.tsx`:
  - The validate/unvalidate mutation currently invalidates only
    `['sequenceGroup', groupId]`. Additionally invalidate `['annotation-counts']`
    (refreshes the badge) and `['sequenceGroupsList']` (fixes the pre-existing stale
    list-page gap after validating).
  - The remove-member mutation gets the same additional invalidations, since dropping a
    group below 3 members changes the counts.

## Testing

- **Backend** (`annotation_api/src/tests/endpoints/test_sequence_groups.py`):
  - Stats with no groups → all zeros.
  - Mixed validated/unvalidated groups → correct split.
  - Groups with fewer than 3 members are excluded from all counts.
- **Frontend**: `npm run quality` (ESLint + type-check) and existing Vitest suite stay
  green. New unit coverage only if a matching test pattern already exists for
  `useAnnotationCounts` (it currently has none — do not invent a new harness).

## Out of scope

- No `validated` filter on the list endpoint (not needed for the badge).
- No extra stats fields (labeled/unlabeled breakdowns) until something consumes them.
- No badge on the list page itself.
