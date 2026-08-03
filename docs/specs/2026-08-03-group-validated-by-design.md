# Group Validation Attribution — Design

**Date:** 2026-08-03
**Status:** Approved

## Problem

The Reviewed column on `/classify/groups` shows whether a group has been
validated (`is_validated`), but not by whom. The backend stores no reviewer
identity: `SequenceGroup.is_validated` is a bare boolean, with no
`validated_by_user_id` or `validated_at`. Labeling already has attribution
(`labeled_by_user_id`); validation has none.

**Goals:** accountability (trace a validation decision to a person) and work
tracking (see who is doing the review work at a glance).

## Scope

Show the validating user's name inline in the Reviewed column of
`/classify/groups`, plus the validation time on hover.

Out of scope, deliberately:

- Labeler attribution in the UI (`labeled_by_user_id` exists but stays
  unsurfaced for now).
- Reviewer display on the group detail page (`/classify/groups/:id`).
- A check constraint tying `validated_at` to `is_validated` — groups
  validated before this change are permanently `is_validated = true` with
  NULL attribution, so a strict iff constraint is impossible.

## Data model

Alembic migration adding two nullable columns to `sequence_groups`,
mirroring the existing `labeled_by_user_id` / `labeled_at` pair:

- `validated_by_user_id: Optional[int]` — FK `users.id`,
  `ondelete="SET NULL"`.
- `validated_at: Optional[datetime]` — timezone-aware.

No backfill: pre-existing validated groups keep NULLs and render the
legacy badge.

## API

`PATCH /api/v1/sequence_groups/{id}` is the only writer of `is_validated`
and gains attribution logic:

- **false → true:** set `validated_by_user_id = current_user.id` and
  `validated_at = now(UTC)`.
- **true → false:** clear both fields — unvalidated rows never carry stale
  attribution, and a later re-validation attributes the new reviewer.
- **true → true (idempotent re-send):** no change — the first reviewer
  stands until someone unvalidates.

Schema changes:

- `SequenceGroupRead`: add `validated_by_user_id`, `validated_at`.
- `SequenceGroupPageItem` (list): add
  `validated_by_username: Optional[str]` and `validated_at`, resolved via a
  LEFT JOIN on `users` in the list query — same no-N+1 approach as
  `camera_name`.

## Frontend

`SequenceGroupsListPage.tsx` Reviewed cell (plus matching fields in
`types/api.ts`):

| State                              | Cell                  |
| ---------------------------------- | --------------------- |
| Validated, username present        | `✓ validated · alice` |
| Validated, no user (legacy or FK user deleted) | `✓ validated` |
| Not validated                      | `—`                   |

The cell's `title` shows the validation time via `toLocaleString()`, the
same pattern as the Created column.

## Testing

Backend endpoint tests:

- Validating sets `validated_by_user_id` to the caller and `validated_at`.
- Unvalidating clears both.
- Re-sending `is_validated = true` on a validated group leaves attribution
  untouched.
- List endpoint returns `validated_by_username` for a validated group and
  `null` for a legacy row (validated, no user id).
