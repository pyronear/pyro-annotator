# Remove `POST /sequence_groups/assign`

**Date**: 2026-07-27
**Issue**: [#181](https://github.com/pyronear/pyro-annotator/issues/181)
**Status**: Approved

## Context

Since #173, group assignment runs automatically every 5 minutes via the
`assign_sequence_groups` procrastinate task, which calls
`app/services/group_assignment.py` directly. The `POST /sequence_groups/assign`
endpoint delegates to the same service and remains only as a manual escape
hatch. Issue #181 proposed deprecating it first and removing it after worker
observability (#180) confirmed the sweep runs reliably; the decision here is to
skip the bake period and remove it now, accepting that until #180 lands, a
misbehaving worker means waiting for a fix rather than triggering manually.

The frontend never calls the endpoint and the API client library
(`app/clients/annotation_api.py`) has no wrapper for it, so this is
backend-only.

## Changes

All in `annotation_api/`:

1. **`src/app/api/api_v1/endpoints/sequence_groups.py`** — delete the
   `assign_groups` route and the now-unused import of
   `AssignGroupsResult, assign_ungrouped_sequences`.
2. **`src/app/services/group_assignment.py`** — update the module docstring
   (sole caller is now the worker task, not "shared by the manual endpoint and
   the worker") and the advisory-lock comment (it now serializes overlapping
   worker runs). Logic untouched.
3. **`src/tests/endpoints/test_sequence_groups.py`** — replace the four
   `POST /sequence_groups/assign` calls with direct
   `assign_ungrouped_sequences(session, user_id=test_user.id)` calls, using the
   existing `test_user` fixture (same pattern as
   `tests/services/test_group_assignment.py`). Two of the four test assign
   behavior itself (group creation, mid-import gate); two use it as setup for
   bulk-annotate tests. All stay in place — the flow tests keep asserting
   through the API's GET endpoints. Assertions adapt from
   `resp.json()["new_groups"]` to `result.new_groups`, etc. Update the module
   docstring's mention of the endpoint.

## Not touched

- The service logic and its return type `AssignGroupsResult`.
- The worker task in `src/app/worker.py`.
- Historical spec docs in `docs/specs/` (dated design records).
- The SQL-seeding helpers in the test file.

## Attribution note

The endpoint attributed assignment runs to the calling user. After removal,
all assignment attribution comes from the worker user (#178, already merged).

## Verification

- `make test` — endpoint, service, and worker tests pass with the migrated
  tests providing the same behavioral coverage.
- `make lint` — clean.
