# Classify/Localize User Permissions

**Date:** 2026-08-04
**Status:** Approved

## Problem

All authenticated users can use every part of the annotation UI. We want a
skill-progression model: new annotators start with classification only (the
simpler task), and an admin grants localization access once they are trained.
Today the only privilege flag is `is_superuser`; there is no way to express
"can classify but not localize".

## Decision

Add a boolean `can_localize` column to `users`, mirroring the existing
`is_superuser` pattern end to end (model, schemas, CRUD, admin UI checkbox,
auth-store selector). Superusers implicitly have localization access.

Rejected alternatives:

- **Role enum** (`annotator`/`localizer`/`admin`): forces a migration of the
  superuser concept across backend, frontend, tests, and seeding for the same
  user-visible outcome; models independent toggles as a ladder.
- **Permission scopes** (JWT claims or permissions table): overkill for two
  capabilities; `get_current_user` re-reads the user row from the DB on every
  request, so token claims buy nothing.

## Semantics

- **Classify (baseline):** every active user can classify. Covers the
  sequence-annotation endpoints (`/annotations/sequences/*`) and sequence
  groups. Unchanged.
- **Localize (granted):** writing detection annotations and triggering
  auto-annotation. Granted per user by a superuser from the User Management
  page, or implied by `is_superuser`.
- **Reads stay open** to all authenticated users. This is skill progression,
  not a trust boundary, and shared consumers (e.g. the sidebar badge-count
  hook) need localize-queue counts even for classify-only users.
- **Hidden entirely** in the UI for classify-only users: no Localize nav
  group, and `/localize*` URLs redirect to the classify queue.

## Backend

### Model & migration

- `can_localize: bool`, default `False`, on the `users` table
  (`app/models.py`, next to `is_superuser`).
- One Alembic revision: add the column with `server_default=false`, then
  backfill `UPDATE users SET can_localize = true WHERE is_active = true`.
  This grandfathers all current human users; the login-disabled worker user
  stays `False`.

### Schemas & CRUD

- `UserBase` gains `can_localize: bool = False` (flows into `UserCreate` and
  `UserRead`); `UserUpdate` gains it as optional.
- `UserCRUD.create_user` explicit field copy gains `can_localize`;
  `update_user`'s `exclude_unset` loop needs no change.
- No new list filter on `GET /users/`.

### Enforcement

- New dependency `get_current_localizer` in `app/auth/dependencies.py`,
  mirroring `get_current_superuser`: 403 "Not enough permissions" unless
  `current_user.can_localize or current_user.is_superuser`.
- Applied to:
  - `POST /annotations/detections/`
  - `PATCH /annotations/detections/{id}`
  - `DELETE /annotations/detections/{id}`
  - `POST /auto-annotate/sequences/{sequence_id}` (produces localize
    artifacts; no frontend or script callers today, ops-only)
- All other routes keep their current guards.

### Worker user & seeding

- Worker user seeded with `can_localize=False`. No behavior change: the
  background worker never calls the API over HTTP — it invokes services
  directly on a DB session and uses the worker row only for attribution, so
  the HTTP-level permission check never applies to it.
- `can_localize` joins the protected field set in the `PATCH /users/{id}`
  worker-user guard (`users.py`), keeping the worker row immutable.
- Admin user seeded with `can_localize=True` (redundant with
  `is_superuser=True`, but keeps the DB row honest).

## Frontend

### Types & store

- `can_localize` added to `User`, `UserCreate`, `UserUpdate` in
  `src/types/api.ts`.
- New computed selector `canLocalize()` in `useAuthStore`, next to
  `isSuperuser()`: `user.is_superuser || user.can_localize`.
- Propagation: the store re-fetches `/users/me` on every page load, so a
  newly granted user gets access on their next reload or login. No live push.

### Nav & routes

- `AppLayout` omits the "Localize" nav group when `!canLocalize()`.
- The four `/localize*` routes in `App.tsx` are wrapped in a small
  `RequireLocalize` element: renders the page, or
  `<Navigate to="/classify" replace />` for classify-only users (covers deep
  links and stale bookmarks).
- The badge-count hook (`useAnnotationCounts`) is left unchanged.

### User Management page (`/users`, superuser-only)

- Create and edit dialogs gain a "Can localize" checkbox next to the
  existing "Superuser" checkbox.
- The user table shows a "Localize" badge alongside the existing
  "Superuser"/"User" badge.
- No special disabling logic for superusers (the checkbox stays
  informational-but-editable; `is_superuser` wins regardless).

## Testing

### Backend (pytest)

- Classify-only user: 403 on `POST/PATCH/DELETE /annotations/detections`
  and on auto-annotate enqueue.
- `can_localize=True` user and superuser: writes succeed.
- Detection-annotation reads return 200 for classify-only users.
- `PATCH /users/{worker}` rejects `can_localize` changes.
- `POST /users/` creates users with `can_localize=False` by default.
- Extend `tests/conftest.py` fixtures with a localizer user.

### Frontend (Vitest)

- `canLocalize()` truth table: flag only, superuser only, neither.
- Sidebar hides the Localize group for classify-only users.
- `/localize` redirects to `/classify` for classify-only users.
- User management create/edit forms include `can_localize` in payloads.

## Out of scope

- Live permission propagation (websocket/refetch-on-focus).
- Restricting reads of detection annotations.
- A generalized role/permission system.
- Filtering the user list by `can_localize`.
