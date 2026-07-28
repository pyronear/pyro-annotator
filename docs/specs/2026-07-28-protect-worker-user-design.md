# Protect the seeded worker user

**Date:** 2026-07-28
**Status:** Approved

## Problem

The API seeds a login-disabled `worker` user at startup (`annotation_api/src/app/main.py`,
username from `settings.WORKER_USERNAME`). The group-assignment sweep attributes inherited
annotations to it. Nothing protects it from admins:

- `DELETE /api/v1/users/{id}` only guards self-deletion. Deleting the worker sets
  `labeled_by_user_id` to NULL on its annotations (attribution silently lost) and
  CASCADE-deletes its contribution rows — permanent history loss. The next boot re-seeds
  a worker with a new id, so nothing re-links.
- `PATCH /api/v1/users/{id}` can rename or activate the worker. A rename breaks the
  sweep's lookup-by-username exactly like deletion (and the next boot seeds a duplicate);
  activation makes it look like a human account.
- The frontend user-management page shows the worker as an ordinary user with working
  edit/delete buttons and no explanation of what it is.

## Design

### Backend enforcement (the real guard)

In `annotation_api/src/app/api/api_v1/endpoints/users.py`, identify the worker by
`username == settings.WORKER_USERNAME`:

- `DELETE /users/{id}`: return 403 (`"Cannot delete the system worker user"`) when the
  target is the worker.
- `PATCH /users/{id}`: return 403 when the target is the worker and the request payload
  contains any of `username`, `is_active`, `is_superuser` — even with unchanged values
  (simpler rule, no surprises).
- `PATCH /users/{id}/password`: unchanged. The worker is inactive, so login is rejected
  regardless of password.
- The worker username is reserved: `POST /users/` with it, or a PATCH renaming another
  user to it, returns 403 (`"Username reserved for the system worker user"`). Without
  this, a deployment whose worker row is absent (deleted or renamed before this change)
  could gain an ordinary — even superuser — account holding the name, which the guards
  above would then make unmanageable. Startup seeding uses the CRUD layer directly and
  is unaffected.

The guard lives in the endpoint layer, next to the existing self-deletion policy.
No DB triggers or constraints.

### Expose the flag to the frontend

Add a computed `is_system: bool` field to `UserRead` — true iff the username matches
`settings.WORKER_USERNAME`. Derived in the response schema; no DB column, no migration.

### Frontend (`frontend/src/pages/UserManagementPage.tsx`)

- The worker row stays visible in the list, marked with a small "System" badge next to
  the username.
- The badge carries a tooltip: "Automated account used to attribute annotations
  inherited during group reassignment. It cannot log in, and cannot be edited or
  deleted."
- Edit, password, and delete controls are hidden (not merely disabled) for rows with
  `is_system: true`.
- `is_system` added to the frontend `User` type.

## Testing

Backend (pytest):
- Deleting the worker returns 403; the user still exists.
- Patching the worker's `username`, `is_active`, or `is_superuser` returns 403.
- Patching a normal (including inactive non-worker) user still works; a PATCH on the
  worker touching none of the guarded fields is not rejected.
- Creating a user with the worker username, or renaming a user to it, returns 403.
- `UserRead.is_system` is true for the worker, false for other users.

Frontend:
- `User` type includes `is_system`.
- Badge shown and edit/password/delete controls absent for a system user, following the
  page's existing test style.

## Out of scope

- Blocking password updates for the worker.
- DB-level protection (triggers, constraints).
- Protecting the admin user.
- Retroactive repair for a worker deleted before this change.
