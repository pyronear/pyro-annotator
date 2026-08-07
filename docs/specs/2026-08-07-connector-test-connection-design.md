# Connector "Test connection" button

2026-08-07 · extends the alert API connector feature (PR #337, `docs/specs/2026-08-06-alert-api-connector-design.md`)

## Problem

Credentials entered in the create-connector form are only testable *after* saving, via
the detail page's verify — which requires a stored connector id and the encrypted
password. Production probing (2026-08-07) showed the failure mode operators will
actually hit: an org-scoped alert-API credential authenticates fine, then fails at
`/organizations/` with `{"detail": "Incompatible token scope."}`. Nothing in the UI
states that the credential must be admin-scoped; a pre-save test is where that surfaces
naturally.

## Backend

`POST /api/v1/connectors/test` — superuser-only, stateless, no DB access.

- Request: `{base_url, login, password}` (plaintext password in the request body only;
  never logged, never persisted).
- Behavior: token exchange, then `list_organizations`, in a thread via
  `asyncio.to_thread` like verify's probe. Reuses the same non-list shape guard as
  `connector_verify.py`, so an org-scoped credential reports
  `alert API returned an unexpected organizations response: Incompatible token scope.`
- Response: `{ok: true, organizations_total: N}` or `{ok: false, error: "..."}`.
  Never raises for an unreachable/unauthorized alert API — a human is watching.
- Timeout: whole probe wrapped in `asyncio.wait_for` at **25 s**, deliberately under
  the frontend's global 30 s axios timeout so the backend always answers before the
  browser gives up (verify's ~100 s bound predates this and remains a known follow-up).
- Implementation lives in `connector_verify.py` next to `verify_connector`, sharing the
  shape-guard logic.

## Frontend

A "Test connection" button inside the create-connector form (`ConnectorsPage.tsx`):

- Enabled once base URL, login, and password are all non-empty.
- Click → pending state → inline result under the credentials fields:
  green "Connection OK — N organizations visible" or the backend's error text verbatim
  in red.
- Advisory only: does not gate Create. An operator can save untested (e.g. while the
  alert API is down).
- The result clears whenever base URL, login, or password change, so a stale green
  cannot vouch for edited credentials.

## Out of scope

- No test button on the edit path — there, an omitted password means "keep the stored
  credential", so there is nothing to test client-side.
- No auto-test on create, no result caching, no UI copy changes beyond the button and
  its result line.

## Testing

- Backend endpoint tests, client stubbed at the same seam as the existing verify tests:
  superuser gate, ok path (count reported), bad-password path, scope-error path with the
  detail passed through, timeout path.
- Frontend form tests: button disabled until all three fields filled, pending state,
  success and error rendering, result cleared on credential edit.
