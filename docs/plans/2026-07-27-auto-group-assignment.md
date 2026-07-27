# Automatic Sequence-Group Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sequence-group assignment runs automatically every 5 minutes in the existing procrastinate worker, gated so only fully-imported sequences are processed; all operator-triggered assignment paths are removed.

**Architecture:** Extract the assign logic from `POST /sequence_groups/assign` into a shared service (`app/services/group_assignment.py`) used by both the endpoint and a new periodic procrastinate task. The service gains two behaviors: it only processes sequences that have a `sequence_annotations` row (the "import finished" invariant — every import path creates that row strictly after all detections are posted), and it serializes runs via a Postgres advisory lock.

**Tech Stack:** FastAPI, SQLModel/SQLAlchemy (async), PostgreSQL, procrastinate 3.9 (Postgres-backed task queue), pytest (in Docker via `make test`).

**Spec:** `docs/specs/2026-07-27-auto-group-assignment-design.md`

## Global Constraints

- Run all backend commands from `annotation_api/` (the worktree copy you are in).
- Backend tests run in Docker: `make test` (full) / `make test-specific TEST=...` (single).
- Backend lint: `make lint` must pass (ruff format + ruff + mypy, 120-char lines).
- Frontend checks (Task 5 only): `npm run type-check && npm run lint` from `frontend/`.
- Commit after every task. NEVER add Claude attribution/co-author trailers to commits.
- Work stays on the current worktree branch (`worktree-explain-sequence-groups`); never commit to `main`.
- All imports at the top of modules — never inline inside functions.
- Procrastinate pinned `>=2.0.0,<4.0.0` (3.9.0 in `uv.lock`); do not change dependency versions.

---

### Task 1: Extract the assign logic into a shared service (pure refactor)

**Files:**
- Create: `annotation_api/src/app/services/group_assignment.py`
- Modify: `annotation_api/src/app/api/api_v1/endpoints/sequence_groups.py` (lines 294–511: `AssignGroupsResponse`, `_compute_representative_bbox`, `assign_groups` body; `_GROUP_IOU_THRESHOLD` at line 54)
- Test (existing, must stay green): `annotation_api/src/tests/endpoints/test_sequence_groups.py`

**Interfaces:**
- Consumes: `AnnotationGenerationService`, `apply_label_to_sequences_bbox`, `box_iou` from `app.services.annotation_generation`; `SequenceAnnotationCRUD` from `app.crud`.
- Produces (used by Tasks 2–4):
  - `app.services.group_assignment.AssignGroupsResult` — pydantic model, fields `processed: int = 0`, `new_groups: int = 0`, `joined_existing: int = 0`, `inherited_annotations: int = 0`, `skipped_no_bbox: int = 0`, `already_running: bool = False`
  - `async def assign_ungrouped_sequences(session: AsyncSession, user_id: int) -> AssignGroupsResult`
  - Constants `GROUP_IOU_THRESHOLD = 0.3`, `ASSIGN_ADVISORY_LOCK_KEY = 743210517`

- [ ] **Step 1: Run the existing group tests to confirm a green baseline**

Run: `cd annotation_api && make test-specific TEST=tests/endpoints/test_sequence_groups.py`
Expected: PASS (all tests).

- [ ] **Step 2: Create the service module**

Create `annotation_api/src/app/services/group_assignment.py`. This is a move of the code currently at `sequence_groups.py:294-511` with three mechanical changes: public names (`GROUP_IOU_THRESHOLD`, `compute_representative_bbox`), `AssignGroupsResponse` renamed to `AssignGroupsResult` with defaults plus an `already_running` flag, and `current_user.id` replaced by a `user_id` parameter. The lock key constant is added now but only used in Task 3.

```python
# Copyright (C) 2026, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

"""Sequence-group assignment sweep.

Shared by the manual endpoint (POST /sequence_groups/assign) and the periodic
worker task (``assign_sequence_groups`` in ``app.worker``): both call
``assign_ungrouped_sequences``.
"""

import logging
from statistics import median
from typing import List, Optional

from pydantic import BaseModel
from sqlalchemy import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.crud import SequenceAnnotationCRUD
from app.models import (
    Detection,
    FalsePositiveType,
    Sequence,
    SequenceAnnotation,
    SequenceAnnotationProcessingStage,
    SequenceGroup,
    SmokeType,
)
from app.schemas.sequence_annotations import (
    SequenceAnnotationCreate,
    SequenceAnnotationUpdate,
)
from app.services.annotation_generation import (
    AnnotationGenerationService,
    apply_label_to_sequences_bbox,
    box_iou,
)

logger = logging.getLogger(__name__)

# Cross-sequence grouping threshold. Stricter than within-sequence clustering
# (IoU=0) because the precision cost of mis-grouping is much higher: a wrong
# match auto-applies inherited labels to an unrelated event. R&D on 857
# real sequences shows 0.3 captures natural smoke drift while filtering
# accidental tiny overlaps; 0.5 was too strict in practice.
GROUP_IOU_THRESHOLD = 0.3

# Fixed key for the Postgres advisory lock that serializes assignment runs
# (manual endpoint vs periodic worker sweep). Arbitrary but must never change.
ASSIGN_ADVISORY_LOCK_KEY = 743210517


class AssignGroupsResult(BaseModel):
    """Outcome of one assignment run."""

    processed: int = 0
    new_groups: int = 0
    joined_existing: int = 0
    inherited_annotations: int = 0
    skipped_no_bbox: int = 0
    already_running: bool = False


def compute_representative_bbox(detections: List[Detection]) -> Optional[dict]:
    """Median bbox across the sequence's detections (only `bbox`, ignoring
    `others_bboxes` to match the auto-annotation flow). Returns
    `{"xyxyn": [...], "confidence": float}` or None if no usable boxes."""
    boxes: List[List[float]] = []
    confs: List[float] = []
    for det in detections:
        preds = (det.algo_predictions or {}).get("predictions") or []
        for pred in preds:
            xy = pred.get("xyxyn")
            if not xy or len(xy) != 4:
                continue
            x1, y1, x2, y2 = (float(v) for v in xy)
            if x1 > x2 or y1 > y2 or [x1, y1, x2, y2] == [0.0, 0.0, 0.0, 0.0]:
                continue
            boxes.append([x1, y1, x2, y2])
            confs.append(float(pred.get("confidence", 0.0)))
    if not boxes:
        return None
    # Clamp confidence to [0, 1]: upstream xyxyn validation guarantees
    # 0 ≤ coords ≤ 1, but `confidence` is unconstrained on detections, and
    # downstream RepresentativeBbox validates `0.0 <= confidence <= 1.0`.
    # A stray >1 (or <0) would make this group fail validation on read.
    median_conf = median(confs) if confs else 0.0
    median_conf = max(0.0, min(1.0, median_conf))
    return {
        "xyxyn": [
            median(b[0] for b in boxes),
            median(b[1] for b in boxes),
            median(b[2] for b in boxes),
            median(b[3] for b in boxes),
        ],
        "confidence": median_conf,
    }


async def assign_ungrouped_sequences(
    session: AsyncSession, user_id: int
) -> AssignGroupsResult:
    """Assign every unassigned sequence to a sequence group (idempotent).

    Single-runner by design. Greedy best-IoU match on the
    (camera_id, azimuth) key, threshold > 0.3. Label inheritance is
    conditional — when the matched group already has a label, the joining
    sequence gets a SequenceAnnotation in SEQ_ANNOTATION_DONE with that
    label, attributed to ``user_id``. If a placeholder annotation is already
    there in stage READY_TO_ANNOTATE (the import script's default), it is
    upgraded in place; any later stage is left untouched.
    """
    sa_crud = SequenceAnnotationCRUD(session=session)

    unassigned_query = (
        select(Sequence)
        .where(
            Sequence.sequence_group_id.is_(None),
            # Don't re-attach sequences an annotator removed by hand.
            Sequence.is_group_excluded.is_(False),
        )
        .order_by(Sequence.recorded_at)
    )
    unassigned = (await session.execute(unassigned_query)).scalars().all()

    if not unassigned:
        return AssignGroupsResult()

    gen_service = AnnotationGenerationService(
        session=session,
        confidence_threshold=0.0,
        iou_threshold=0.0,
        min_cluster_size=1,
    )

    new_groups = 0
    joined_existing = 0
    inherited = 0
    skipped_no_bbox = 0

    for seq in unassigned:
        if seq.azimuth is None or seq.camera_id is None:
            skipped_no_bbox += 1
            continue

        det_query = (
            select(Detection)
            .where(Detection.sequence_id == seq.id)
            .order_by(Detection.recorded_at)
            .limit(10)
        )
        detections = (await session.execute(det_query)).scalars().all()
        repr_bbox = compute_representative_bbox(detections)
        if repr_bbox is None:
            skipped_no_bbox += 1
            continue

        candidates_query = select(SequenceGroup).where(
            SequenceGroup.camera_id == seq.camera_id,
            SequenceGroup.azimuth == seq.azimuth,
        )
        candidates = (await session.execute(candidates_query)).scalars().all()

        best_group: Optional[SequenceGroup] = None
        best_iou = GROUP_IOU_THRESHOLD
        for g in candidates:
            g_xy = g.representative_bbox.get("xyxyn") if g.representative_bbox else None
            if not g_xy:
                continue
            score = box_iou(repr_bbox["xyxyn"], g_xy)
            if score > best_iou:
                best_iou = score
                best_group = g

        if best_group is None:
            new_group = SequenceGroup(
                camera_id=seq.camera_id,
                azimuth=seq.azimuth,
                representative_bbox=repr_bbox,
            )
            session.add(new_group)
            await session.flush()
            seq.sequence_group_id = new_group.id
            new_groups += 1
            continue

        seq.sequence_group_id = best_group.id
        joined_existing += 1

        if best_group.smoke_type is None and best_group.false_positive_type is None:
            continue

        # Inherit the group's label. import.py creates an empty
        # READY_TO_ANNOTATE annotation for every imported sequence, so we
        # need to UPDATE that placeholder rather than skip on existence.
        # Skip only if the existing annotation is past the placeholder
        # stage (the human / review pipeline has touched it).
        existing_anno = (
            await session.execute(
                select(SequenceAnnotation).where(
                    SequenceAnnotation.sequence_id == seq.id
                )
            )
        ).scalar_one_or_none()
        if existing_anno is not None and existing_anno.processing_stage != (
            SequenceAnnotationProcessingStage.READY_TO_ANNOTATE
        ):
            continue

        generated = await gen_service.generate_annotation_for_sequence(seq.id)
        if generated is None:
            continue

        smoke_enum = SmokeType(best_group.smoke_type) if best_group.smoke_type else None
        fp_enum = (
            FalsePositiveType(best_group.false_positive_type)
            if best_group.false_positive_type
            else None
        )
        apply_label_to_sequences_bbox(
            generated, smoke_type=smoke_enum, false_positive_type=fp_enum
        )

        if existing_anno is None:
            await sa_crud.create(
                SequenceAnnotationCreate(
                    sequence_id=seq.id,
                    has_missed_smoke=False,
                    is_unsure=best_group.is_unsure,
                    annotation=generated,
                    processing_stage=SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE,
                ),
                user_id,
            )
        else:
            await sa_crud.update(
                existing_anno.id,
                SequenceAnnotationUpdate(
                    is_unsure=best_group.is_unsure,
                    annotation=generated,
                    processing_stage=SequenceAnnotationProcessingStage.SEQ_ANNOTATION_DONE,
                ),
                user_id,
            )
        inherited += 1

    await session.commit()

    return AssignGroupsResult(
        processed=len(unassigned),
        new_groups=new_groups,
        joined_existing=joined_existing,
        inherited_annotations=inherited,
        skipped_no_bbox=skipped_no_bbox,
    )
```

- [ ] **Step 3: Rewire the endpoint to delegate**

In `annotation_api/src/app/api/api_v1/endpoints/sequence_groups.py`:

1. Delete everything from the `# -------------------- assign-groups --------------------` comment (line 294) to the end of the file, and delete the `_GROUP_IOU_THRESHOLD` constant with its 5-line comment block (lines 49–54).
2. Append the new endpoint at the end of the file:

```python
# -------------------- assign-groups --------------------


@router.post(
    "/assign",
    response_model=AssignGroupsResult,
    summary="Compute group membership for unassigned sequences (idempotent).",
)
async def assign_groups(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> AssignGroupsResult:
    """Manual trigger for the assignment sweep (see
    ``app.services.group_assignment``). The same logic runs automatically
    every few minutes in the worker; this endpoint exists for on-demand runs.
    """
    return await assign_ungrouped_sequences(session, user_id=current_user.id)
```

3. Add to the imports: `from app.services.group_assignment import AssignGroupsResult, assign_ungrouped_sequences`.
4. Remove imports that are now unused (ruff will flag the exact set — expect at least: `median`/`statistics`, `BaseModel`, `SequenceAnnotationCRUD`, `SequenceAnnotationCreate`, `SequenceAnnotationUpdate`, `AnnotationGenerationService`, `apply_label_to_sequences_bbox`, `box_iou`, `SmokeType`, `FalsePositiveType`, `SequenceAnnotationProcessingStage`; keep `Detection` and `SequenceAnnotation` — the members endpoint uses them).

- [ ] **Step 4: Verify — lint and existing tests**

Run: `cd annotation_api && make lint && make test-specific TEST=tests/endpoints/test_sequence_groups.py`
Expected: lint PASS; all tests PASS (`/assign` responses gain `already_running: false`, an additive field no test asserts against).

- [ ] **Step 5: Commit**

```bash
git add annotation_api/src/app/services/group_assignment.py annotation_api/src/app/api/api_v1/endpoints/sequence_groups.py
git commit -m "refactor(api): extract group assignment into a shared service"
```

---

### Task 2: Gate assignment on the annotation-row "import finished" invariant

**Files:**
- Modify: `annotation_api/src/app/services/group_assignment.py` (the `unassigned_query` in `assign_ungrouped_sequences`)
- Test: `annotation_api/src/tests/endpoints/test_sequence_groups.py`

**Interfaces:**
- Consumes: `assign_ungrouped_sequences` from Task 1 (via the `/sequence_groups/assign` endpoint).
- Produces: the gate — sequences with no `sequence_annotations` row are invisible to assignment. Task 5's cleanup and the worker task rely on this behavior.

Background for the test rationale: every import path creates the sequence's
`SequenceAnnotation` row only after all detections are posted (`import.py`
does it in a separate step after the whole import step; `import_predictor_split.py`
posts it last and deletes the sequence on any shortfall). So "annotation row
exists" ⇔ "import finished".

- [ ] **Step 1: Add the placeholder helper and the failing gate test**

In `annotation_api/src/tests/endpoints/test_sequence_groups.py`, add after `_seed_group_with_members` (line 133):

```python
async def _create_placeholder_annotation(client: AsyncClient, sequence_id: int) -> None:
    """Mimic the import pipeline's final step: an empty READY_TO_ANNOTATE
    annotation, created only once all the sequence's detections are posted.
    The gate in assign_ungrouped_sequences keys on this row's existence."""
    resp = await client.post(
        "/annotations/sequences/",
        json={
            "sequence_id": sequence_id,
            "has_missed_smoke": False,
            "is_unsure": False,
            "annotation": {"sequences_bbox": []},
            "processing_stage": "ready_to_annotate",
        },
    )
    assert resp.status_code == 201, resp.text
```

And add this test after `test_assign_groups_creates_group_for_unmatched_sequence`:

```python
@pytest.mark.asyncio
async def test_assign_skips_sequences_still_importing(
    authenticated_client: AsyncClient,
    sequence_session: AsyncSession,
    detection_session: AsyncSession,
):
    """A sequence with no SequenceAnnotation row is mid-import (imports
    create the annotation only after all detections are posted) — assign
    must leave it alone until the annotation appears."""
    await _set_seq_metadata(sequence_session, 1, camera_id=42, azimuth=90)

    resp = await authenticated_client.post("/sequence_groups/assign")
    assert resp.status_code == 200
    assert resp.json()["processed"] == 0
    seq_payload = (await authenticated_client.get("/sequences/1")).json()
    assert seq_payload["sequence_group_id"] is None

    await _create_placeholder_annotation(authenticated_client, 1)
    resp = await authenticated_client.post("/sequence_groups/assign")
    assert resp.status_code == 200
    assert resp.json()["new_groups"] >= 1
    seq_payload = (await authenticated_client.get("/sequences/1")).json()
    assert seq_payload["sequence_group_id"] is not None
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `cd annotation_api && make test-specific TEST=tests/endpoints/test_sequence_groups.py::test_assign_skips_sequences_still_importing`
Expected: FAIL on `assert resp.json()["processed"] == 0` (currently processes annotation-less sequences).

- [ ] **Step 3: Implement the gate**

In `assign_ungrouped_sequences` (`app/services/group_assignment.py`), replace the `unassigned_query` with:

```python
    unassigned_query = (
        select(Sequence)
        .where(
            Sequence.sequence_group_id.is_(None),
            # Don't re-attach sequences an annotator removed by hand.
            Sequence.is_group_excluded.is_(False),
            # Only fully-imported sequences: every import path creates the
            # SequenceAnnotation row strictly after all detections are
            # posted, so its absence means "still importing" (or a failed
            # import) — grouping such a sequence would freeze a bbox from
            # partial data and could inherit a label onto it.
            select(SequenceAnnotation.id)
            .where(SequenceAnnotation.sequence_id == Sequence.id)
            .exists(),
        )
        .order_by(Sequence.recorded_at)
    )
```

- [ ] **Step 4: Update the three existing assign-based tests**

The gate breaks the tests that call `POST /sequence_groups/assign` on annotation-less sequence 1. In each of these three tests, insert `await _create_placeholder_annotation(authenticated_client, 1)` immediately before the `POST /sequence_groups/assign` call:

- `test_assign_groups_creates_group_for_unmatched_sequence` (assign call at line 214)
- `test_bulk_annotate_writes_label_on_group_and_seqs` (assign call at line 236)
- `test_bulk_annotate_rejects_conflicting_label_without_force` (assign call at line 275)

- [ ] **Step 5: Run the whole test file to verify green**

Run: `cd annotation_api && make test-specific TEST=tests/endpoints/test_sequence_groups.py`
Expected: PASS (all tests, including the three updated ones and the new gate test).

- [ ] **Step 6: Commit**

```bash
git add annotation_api/src/app/services/group_assignment.py annotation_api/src/tests/endpoints/test_sequence_groups.py
git commit -m "feat(api): only assign groups to fully-imported sequences"
```

---

### Task 3: Serialize runs with a Postgres advisory lock

**Files:**
- Modify: `annotation_api/src/app/services/group_assignment.py`
- Test: `annotation_api/src/tests/services/test_group_assignment.py` (new file)

**Interfaces:**
- Consumes: `assign_ungrouped_sequences`, `AssignGroupsResult`, `ASSIGN_ADVISORY_LOCK_KEY` from Task 1; `engine` from `app.db`; `test_user` / `async_session` fixtures from `src/tests/conftest.py`.
- Produces: `assign_ungrouped_sequences` returns `AssignGroupsResult(already_running=True)` (all counters zero) when another run holds the lock. The worker task (Task 4) logs this case.

Design note (why a session-level lock on a dedicated connection, not
`pg_try_advisory_xact_lock`): `SequenceAnnotationCRUD.create/update` commit
mid-run (`crud_sequence_annotation.py:87,152`), so the sweep spans multiple
transactions — a transaction-scoped lock would release at the first commit.
And taking a session-level lock on the work session is unsafe because after
each commit the pooled connection can be swapped, so the unlock could run on
a different connection and leak the lock. A dedicated connection held for the
duration avoids both problems, and a process crash drops the connection,
which releases the lock automatically.

- [ ] **Step 1: Write the failing lock test**

Create `annotation_api/src/tests/services/test_group_assignment.py`:

```python
"""Tests for the group-assignment service's concurrency guard."""

import pytest
from sqlalchemy import text
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db import engine
from app.models import User
from app.services.group_assignment import (
    ASSIGN_ADVISORY_LOCK_KEY,
    assign_ungrouped_sequences,
)


@pytest.mark.asyncio
async def test_assign_returns_already_running_when_lock_held(
    async_session: AsyncSession,
    test_user: User,
):
    """While another connection holds the advisory lock, a run returns
    already_running=True with zero counters instead of interleaving."""
    lock_conn = await engine.connect()
    try:
        locked = (
            await lock_conn.execute(
                text("SELECT pg_try_advisory_lock(:key)"),
                {"key": ASSIGN_ADVISORY_LOCK_KEY},
            )
        ).scalar_one()
        assert locked is True

        result = await assign_ungrouped_sequences(async_session, user_id=test_user.id)
        assert result.already_running is True
        assert result.processed == 0
    finally:
        await lock_conn.execute(
            text("SELECT pg_advisory_unlock(:key)"),
            {"key": ASSIGN_ADVISORY_LOCK_KEY},
        )
        await lock_conn.close()


@pytest.mark.asyncio
async def test_assign_runs_when_lock_free(
    async_session: AsyncSession,
    test_user: User,
):
    """With no lock contention the sweep runs (and re-acquires cleanly on a
    second call — the lock is released between runs)."""
    first = await assign_ungrouped_sequences(async_session, user_id=test_user.id)
    assert first.already_running is False
    second = await assign_ungrouped_sequences(async_session, user_id=test_user.id)
    assert second.already_running is False
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd annotation_api && make test-specific TEST=tests/services/test_group_assignment.py`
Expected: FAIL — `already_running` is `False` in the first test (no lock implemented yet); the second test may already pass.

- [ ] **Step 3: Implement the lock**

In `annotation_api/src/app/services/group_assignment.py`:

1. Add `text` to the sqlalchemy import: `from sqlalchemy import select, text`.
2. Add `from app.db import engine` to the imports.
3. Rename the existing `assign_ungrouped_sequences` to `_run_assignment` (same signature and body, docstring's first line changed to `"""Single assignment pass — callers must hold the advisory lock."""`).
4. Add the new public wrapper:

```python
async def assign_ungrouped_sequences(
    session: AsyncSession, user_id: int
) -> AssignGroupsResult:
    """Assign every ungrouped, fully-imported sequence to a group (idempotent).

    Serialized via a Postgres session-level advisory lock held on a dedicated
    connection for the whole run (the CRUD helpers commit mid-run, so a
    transaction-scoped lock would release too early). A run that finds the
    lock taken returns immediately with ``already_running=True``.
    """
    lock_conn = await engine.connect()
    try:
        locked = (
            await lock_conn.execute(
                text("SELECT pg_try_advisory_lock(:key)"),
                {"key": ASSIGN_ADVISORY_LOCK_KEY},
            )
        ).scalar_one()
        if not locked:
            logger.info("group assignment already running; skipping this run")
            return AssignGroupsResult(already_running=True)
        try:
            return await _run_assignment(session, user_id)
        finally:
            await lock_conn.execute(
                text("SELECT pg_advisory_unlock(:key)"),
                {"key": ASSIGN_ADVISORY_LOCK_KEY},
            )
    finally:
        await lock_conn.close()
```

- [ ] **Step 4: Run service tests and the endpoint test file**

Run: `cd annotation_api && make test-specific TEST=tests/services/test_group_assignment.py && make test-specific TEST=tests/endpoints/test_sequence_groups.py`
Expected: PASS (both files).

- [ ] **Step 5: Commit**

```bash
git add annotation_api/src/app/services/group_assignment.py annotation_api/src/tests/services/test_group_assignment.py
git commit -m "feat(api): serialize group assignment runs with an advisory lock"
```

---

### Task 4: Periodic worker task

**Files:**
- Modify: `annotation_api/src/app/worker.py`
- Test: `annotation_api/src/tests/test_worker_periodic.py` (new file)

**Interfaces:**
- Consumes: `assign_ungrouped_sequences` (Task 3 version, lock included); `UserCRUD` from `app.crud`; `settings.AUTH_USERNAME` (the admin user seeded by the API at startup, `main.py:45-56`); `engine` and `AsyncSession` (already imported in `worker.py`).
- Produces: procrastinate task `assign_sequence_groups`, cron `*/5 * * * *`, running in the existing `worker` container. No compose changes — `procrastinate worker` schedules periodic tasks built-in.

- [ ] **Step 1: Write the failing registration tests**

Create `annotation_api/src/tests/test_worker_periodic.py`:

```python
"""Smoke tests: the periodic group-assignment task is registered on the
procrastinate app with the expected cron schedule."""

from app.worker import app as procrastinate_app


def test_assign_sequence_groups_task_registered():
    assert "assign_sequence_groups" in procrastinate_app.tasks


def test_assign_sequence_groups_periodic_cron():
    entries = [
        pt
        for pt in procrastinate_app.periodic_registry.periodic_tasks.values()
        if pt.task.name == "assign_sequence_groups"
    ]
    assert len(entries) == 1
    assert entries[0].cron == "*/5 * * * *"
```

(API verified against procrastinate 3.9.0: `app.periodic_registry.periodic_tasks` is a dict keyed by `(task_name, periodic_id)`; entries have `.task.name` and `.cron`.)

- [ ] **Step 2: Run tests to verify failure**

Run: `cd annotation_api && make test-specific TEST=tests/test_worker_periodic.py`
Expected: FAIL with `assert "assign_sequence_groups" in ...` (task not defined yet).

- [ ] **Step 3: Implement the periodic task**

In `annotation_api/src/app/worker.py`:

1. Add imports: `from app.crud import UserCRUD` and `from app.services.group_assignment import assign_ungrouped_sequences`.
2. Append at the end of the file:

```python
@app.periodic(cron="*/5 * * * *")
@app.task(name="assign_sequence_groups", queueing_lock="assign_sequence_groups")
async def assign_sequence_groups(timestamp: int) -> None:
    """Periodic sweep: assign every ungrouped, fully-imported sequence to a
    sequence group (see ``app.services.group_assignment``). Inherited
    annotations are attributed to the admin user, which the API seeds at
    startup from AUTH_USERNAME."""
    async with AsyncSession(engine) as session:
        admin = await UserCRUD(session).get_by_username(settings.AUTH_USERNAME)
        if admin is None:
            logger.warning(
                "assign_sequence_groups: admin user %r not found; skipping run",
                settings.AUTH_USERNAME,
            )
            return
        result = await assign_ungrouped_sequences(session, user_id=admin.id)
    if result.already_running:
        logger.info("assign_sequence_groups: another run in progress; skipped")
        return
    logger.info(
        "assign_sequence_groups: processed=%d new_groups=%d joined=%d "
        "inherited=%d skipped_no_bbox=%d",
        result.processed,
        result.new_groups,
        result.joined_existing,
        result.inherited_annotations,
        result.skipped_no_bbox,
    )
```

Notes: `queueing_lock` stops ticks from piling up if the worker is down (the
periodic deferrer treats the resulting `AlreadyEnqueued` as a no-op); the
service's advisory lock (Task 3) covers overlap with manual endpoint runs.
`AsyncSession`, `engine`, `settings`, and `logger` are already present in
`worker.py`.

- [ ] **Step 4: Run tests to verify pass, plus lint**

Run: `cd annotation_api && make test-specific TEST=tests/test_worker_periodic.py && make lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add annotation_api/src/app/worker.py annotation_api/src/tests/test_worker_periodic.py
git commit -m "feat(worker): periodic sequence-group assignment sweep"
```

---

### Task 5: Remove operator-triggered assignment paths

**Files:**
- Modify: `annotation_api/scripts/data_transfer/ingestion/platform/import_filtered.py`
- Modify: `annotation_api/scripts/data_transfer/ingestion/platform/import_predictor_split.py`
- Delete: `annotation_api/scripts/data_transfer/ingestion/platform/assign_groups.py`
- Modify: `annotation_api/Makefile`
- Modify: `frontend/src/pages/SequenceGroupsListPage.tsx` (empty-state copy references the deleted make target — copy-only change, agreed addendum to the spec's "no frontend changes")

**Interfaces:**
- Consumes: nothing from other tasks (the sweep from Task 4 is what makes these paths redundant).
- Produces: no `assign-groups`/`assign_groups` references outside the API service/worker and docs.

- [ ] **Step 1: Strip the assign step from `import_filtered.py`**

Remove three blocks (all references are unique in the file):
- the `--skip-group-assignment` argparse option (lines 174–180),
- the whole `step_assign_groups` function (lines 323–347),
- the `step_assign_groups(args)` call in `main()` (line 454).

If the module docstring or surrounding step comments enumerate a "step 5 / assign groups" stage, update the enumeration to match.

- [ ] **Step 2: Strip the assign step from `import_predictor_split.py`**

Same three removals (references unique in file): `--skip-group-assignment` option (line 229), `step_assign_groups` function (lines 377–394), call site (line 1038). Update any step enumeration in docstrings/comments.

- [ ] **Step 3: Delete the thin client and Makefile plumbing**

```bash
git rm annotation_api/scripts/data_transfer/ingestion/platform/assign_groups.py
```

In `annotation_api/Makefile`:
- In the `pull-sequences` target (lines 129–140): delete the trailing `\t$(MAKE) assign-groups` line and rewrite the comment above the target to drop the "then run assign-groups…" sentence (the worker now does this automatically).
- Delete the whole `assign-groups` target and its comment block (lines 142–148).
- Remove `assign-groups` from the `.PHONY` list (line 374).

- [ ] **Step 4: Update the frontend empty-state copy**

In `frontend/src/pages/SequenceGroupsListPage.tsx` (lines 92–96), replace:

```tsx
                  {filter === 'unlabeled'
                    ? 'No unlabeled multi-sequence groups yet. Run ' +
                      'make assign-groups after an import; groups with ' +
                      'fewer than 3 sequences are intentionally hidden here.'
                    : 'No groups match this filter.'}
```

with:

```tsx
                  {filter === 'unlabeled'
                    ? 'No unlabeled multi-sequence groups yet. Groups are ' +
                      'assigned automatically a few minutes after an import; ' +
                      'groups with fewer than 3 sequences are intentionally ' +
                      'hidden here.'
                    : 'No groups match this filter.'}
```

- [ ] **Step 5: Sweep for stale references**

Run: `grep -rn "assign-groups\|assign_groups" annotation_api/Makefile annotation_api/scripts frontend/src`
Expected: no matches. If any remain (comments, docstrings), remove or reword them.
(References inside `annotation_api/src/` — service, endpoint, worker, tests — and `docs/` are expected and stay.)

- [ ] **Step 6: Verify**

Run: `cd annotation_api && make lint`
Run: `cd frontend && npm run type-check && npm run lint`
Expected: PASS for all.

- [ ] **Step 7: Commit**

```bash
git add -A annotation_api/scripts annotation_api/Makefile frontend/src/pages/SequenceGroupsListPage.tsx
git commit -m "chore: remove operator-triggered group assignment paths"
```

---

### Task 6: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Backend full suite**

Run: `cd annotation_api && make test`
Expected: PASS (entire suite, in Docker). Pay attention to `tests/endpoints/test_sequence_groups.py`, `tests/services/`, and any scripts tests that may have imported the removed module.

- [ ] **Step 2: Backend lint**

Run: `cd annotation_api && make lint`
Expected: PASS.

- [ ] **Step 3: Frontend quality**

Run: `cd frontend && npm run quality`
Expected: PASS (type-check + lint + format:check). If `format:check` flags the copy change, run `npm run format` and re-check.

- [ ] **Step 4: Commit any resulting fixes**

Only if Steps 1–3 required changes:

```bash
git add -A
git commit -m "test: fixes from full-suite verification"
```
