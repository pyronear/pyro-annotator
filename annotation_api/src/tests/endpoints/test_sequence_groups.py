"""Tests for the sequence-groups + bulk-annotate + propagation flow.

Covers:
- assign_ungrouped_sequences creates a new group from an unassigned sequence
- POST /annotations/sequences/bulk applies labels, writes them onto the
  group, and rejects conflicting labels unless force=True
- Request validation rejects payloads with neither or both labels
- Propagation on per-sequence annotation save:
    * unvalidated group → no fan-out
    * validated, no group label yet → group label set + other unlocked
      members get annotations
    * validated, conflicting label → warning returned, group untouched
    * validated, member locked at SEQ_ANNOTATION_DONE+ → skipped

Assign-time inheritance is exercised in-suite by detaching a grouped
sequence and re-running the sweep against its own (labeled) group; the
two seeded sequences have non-overlapping bboxes, so they never share a
group organically.
"""

from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models import Sequence, User
from app.services.group_assignment import assign_ungrouped_sequences


async def _set_seq_metadata(
    session: AsyncSession,
    sequence_id: int,
    *,
    camera_id: int,
    azimuth: int,
) -> None:
    await session.exec(
        text(
            "UPDATE sequences SET camera_id = :cam, azimuth = :az WHERE id = :sid"
        ).bindparams(cam=camera_id, az=azimuth, sid=sequence_id)
    )
    await session.commit()


async def _seed_two_member_group(
    session: AsyncSession,
    sequence_ids: list[int],
    *,
    is_validated: bool,
    smoke_type: str | None = None,
    false_positive_type: str | None = None,
) -> int:
    """Force two existing sequences into the same SequenceGroup so the
    propagation hook has a real two-member target to fan out across."""
    insert_sql = text(
        """
        INSERT INTO sequence_groups
            (camera_id, azimuth, representative_bbox, is_validated,
             smoke_type, false_positive_type, labeled_at)
        VALUES
            (1, 0, CAST(:bbox AS jsonb), :is_validated,
             :smoke_type, :false_positive_type, :labeled_at)
        RETURNING id
        """
    ).bindparams(
        bbox='{"xyxyn":[0.1,0.1,0.4,0.4],"confidence":0.9}',
        is_validated=is_validated,
        smoke_type=smoke_type,
        false_positive_type=false_positive_type,
        labeled_at=(
            datetime(2026, 1, 1, tzinfo=timezone.utc)
            if (smoke_type or false_positive_type)
            else None
        ),
    )
    result = await session.exec(insert_sql)
    group_id = result.scalar_one()
    for sid in sequence_ids:
        await session.exec(
            text(
                "UPDATE sequences SET sequence_group_id = :gid WHERE id = :sid"
            ).bindparams(gid=group_id, sid=sid)
        )
    await session.commit()
    return group_id


async def _seed_group_with_members(
    session: AsyncSession,
    *,
    n_members: int,
    created_at: datetime,
    alert_api_id_start: int,
) -> int:
    """Insert a SequenceGroup with `n_members` member sequences (each with a
    distinct alert_api_id) and return its id."""
    group_id = (
        await session.exec(
            text(
                """
                INSERT INTO sequence_groups
                    (camera_id, azimuth, representative_bbox, is_validated,
                     created_at)
                VALUES
                    (1, 0, CAST(:bbox AS jsonb), false, :created_at)
                RETURNING id
                """
            ).bindparams(
                bbox='{"xyxyn":[0.1,0.1,0.4,0.4],"confidence":0.9}',
                created_at=created_at,
            )
        )
    ).scalar_one()
    for i in range(n_members):
        session.add(
            Sequence(
                source_api="pyronear_french",
                alert_api_id=alert_api_id_start + i,
                created_at=created_at,
                recorded_at=created_at,
                last_seen_at=created_at,
                camera_name="cam",
                camera_id=1,
                is_wildfire_alertapi="wildfire_smoke",
                organisation_name="org",
                lat=0.0,
                lon=0.0,
                organisation_id=1,
                sequence_group_id=group_id,
            )
        )
    await session.commit()
    return group_id


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


async def _annotation_contributor_ids(
    session: AsyncSession, sequence_id: int
) -> list[int]:
    result = await session.exec(
        text(
            "SELECT c.user_id FROM sequence_annotation_contributions c "
            "JOIN sequences_annotations sa ON sa.id = c.sequence_annotation_id "
            "WHERE sa.sequence_id = :sid ORDER BY c.id"
        ).bindparams(sid=sequence_id)
    )
    return [row[0] for row in result.all()]


@pytest.mark.asyncio
async def test_list_groups_hides_small_groups_and_sorts_by_size(
    authenticated_client: AsyncClient,
    async_session: AsyncSession,
):
    """The list endpoint returns only groups with 3+ members, ordered by
    member count descending."""
    big = await _seed_group_with_members(
        async_session,
        n_members=4,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        alert_api_id_start=100,
    )
    medium = await _seed_group_with_members(
        async_session,
        n_members=3,
        created_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
        alert_api_id_start=200,
    )
    small = await _seed_group_with_members(
        async_session,
        n_members=2,
        created_at=datetime(2026, 1, 3, tzinfo=timezone.utc),
        alert_api_id_start=300,
    )

    resp = await authenticated_client.get("/sequence_groups/")
    assert resp.status_code == 200
    items = resp.json()["items"]

    ids = [item["id"] for item in items]
    assert small not in ids  # 2-member group is hidden
    assert ids == [big, medium]  # 4 members sort before 3 members
    counts = {item["id"]: item["member_count"] for item in items}
    assert counts[big] == 4
    assert counts[medium] == 3


def _annotation_payload(*, stage: str, smoke_type: str) -> dict:
    return {
        "sequence_id": 1,  # overwritten per call
        "has_missed_smoke": False,
        "is_unsure": False,
        "annotation": {
            "sequences_bbox": [
                {
                    "is_smoke": True,
                    "smoke_type": smoke_type,
                    "false_positive_types": [],
                    "bboxes": [{"detection_id": 1, "xyxyn": [0.1, 0.1, 0.4, 0.4]}],
                }
            ]
        },
        "processing_stage": stage,
    }


def _unsure_payload(*, stage: str) -> dict:
    """An unsure submission carries no label (empty sequences_bbox)."""
    return {
        "sequence_id": 1,  # overwritten per call
        "has_missed_smoke": False,
        "is_unsure": True,
        "annotation": {"sequences_bbox": []},
        "processing_stage": stage,
    }


@pytest.mark.asyncio
async def test_assign_groups_creates_group_for_unmatched_sequence(
    authenticated_client: AsyncClient,
    sequence_session: AsyncSession,
    detection_session: AsyncSession,
    test_user: User,
):
    """Sequence 1 has detections with bbox in the [0.12-0.5, 0.13-0.55] region;
    no group exists yet → assign should create one and link it."""
    await _set_seq_metadata(sequence_session, 1, camera_id=42, azimuth=90)
    await _create_placeholder_annotation(authenticated_client, 1)

    result = await assign_ungrouped_sequences(sequence_session, user_id=test_user.id)
    assert result.new_groups >= 1

    # The created group should now own sequence 1.
    seq_response = await authenticated_client.get("/sequences/1")
    assert seq_response.status_code == 200
    seq_payload = seq_response.json()
    assert seq_payload.get("sequence_group_id") is not None


@pytest.mark.asyncio
async def test_assign_skips_sequences_still_importing(
    authenticated_client: AsyncClient,
    sequence_session: AsyncSession,
    detection_session: AsyncSession,
    test_user: User,
):
    """A sequence with no SequenceAnnotation row is mid-import (imports
    create the annotation only after all detections are posted) — assign
    must leave it alone until the annotation appears."""
    await _set_seq_metadata(sequence_session, 1, camera_id=42, azimuth=90)

    result = await assign_ungrouped_sequences(sequence_session, user_id=test_user.id)
    assert result.processed == 0
    seq_payload = (await authenticated_client.get("/sequences/1")).json()
    assert seq_payload["sequence_group_id"] is None

    await _create_placeholder_annotation(authenticated_client, 1)
    result = await assign_ungrouped_sequences(sequence_session, user_id=test_user.id)
    assert result.new_groups >= 1
    seq_payload = (await authenticated_client.get("/sequences/1")).json()
    assert seq_payload["sequence_group_id"] is not None


@pytest.mark.asyncio
async def test_assign_inheritance_records_contribution(
    authenticated_client: AsyncClient,
    sequence_session: AsyncSession,
    detection_session: AsyncSession,
    test_user: User,
):
    """A sequence that joins an already-labeled group inherits the label AND
    gets a contribution row attributing the machine-written annotation to
    the user the assignment ran as (the worker user in the periodic sweep;
    here, the test user)."""
    await _set_seq_metadata(sequence_session, 1, camera_id=42, azimuth=90)
    await _create_placeholder_annotation(authenticated_client, 1)
    await assign_ungrouped_sequences(sequence_session, user_id=test_user.id)

    seq_payload = (await authenticated_client.get("/sequences/1")).json()
    group_id = seq_payload["sequence_group_id"]
    bulk = await authenticated_client.post(
        "/annotations/sequences/bulk",
        json={
            "sequence_ids": [1],
            "group_id": group_id,
            "smoke_type": "wildfire",
            "is_unsure": False,
        },
    )
    assert bulk.status_code == 200  # records contribution #1 (bulk path)

    # Detach the sequence and reset its annotation to the placeholder stage
    # so re-assignment triggers inheritance from the now-labeled group.
    await sequence_session.exec(
        text("UPDATE sequences SET sequence_group_id = NULL WHERE id = 1")
    )
    await sequence_session.exec(
        text(
            "UPDATE sequences_annotations SET processing_stage = 'READY_TO_ANNOTATE' "
            "WHERE sequence_id = 1"
        )
    )
    await sequence_session.commit()

    result = await assign_ungrouped_sequences(sequence_session, user_id=test_user.id)
    assert result.inherited_annotations == 1

    # contribution #2 comes from the inheritance write.
    contributors = await _annotation_contributor_ids(sequence_session, 1)
    assert contributors == [test_user.id, test_user.id]


@pytest.mark.asyncio
async def test_bulk_annotate_writes_label_on_group_and_seqs(
    authenticated_client: AsyncClient,
    sequence_session: AsyncSession,
    detection_session: AsyncSession,
    test_user: User,
):
    """After assigning a group from seq 1, bulk-annotating that seq should
    apply the label, mark the SequenceAnnotation as SEQ_ANNOTATION_DONE, and
    write the label onto the group itself."""
    await _set_seq_metadata(sequence_session, 1, camera_id=42, azimuth=90)
    await _create_placeholder_annotation(authenticated_client, 1)
    await assign_ungrouped_sequences(sequence_session, user_id=test_user.id)

    # Discover the group_id from the sequence.
    seq_payload = (await authenticated_client.get("/sequences/1")).json()
    group_id = seq_payload["sequence_group_id"]
    assert group_id is not None

    bulk_resp = await authenticated_client.post(
        "/annotations/sequences/bulk",
        json={
            "sequence_ids": [1],
            "group_id": group_id,
            "smoke_type": "wildfire",
            "is_unsure": False,
        },
    )
    assert bulk_resp.status_code == 200
    body = bulk_resp.json()
    assert len(body["applied"]) == 1
    assert body["group_label_updated"] is True

    group_resp = await authenticated_client.get(f"/sequence_groups/{group_id}")
    assert group_resp.status_code == 200
    group_payload = group_resp.json()
    assert group_payload["smoke_type"] == "wildfire"
    assert group_payload["false_positive_type"] is None
    assert group_payload["labeled_at"] is not None

    # Bulk-applied annotations are attributed to the calling user.
    assert await _annotation_contributor_ids(sequence_session, 1) == [test_user.id]


@pytest.mark.asyncio
async def test_bulk_annotate_rejects_conflicting_label_without_force(
    authenticated_client: AsyncClient,
    sequence_session: AsyncSession,
    detection_session: AsyncSession,
    test_user: User,
):
    """A group already labeled `wildfire` must reject a request to relabel
    it as `antenna` unless the caller passes force=True."""
    await _set_seq_metadata(sequence_session, 1, camera_id=42, azimuth=90)
    await _create_placeholder_annotation(authenticated_client, 1)
    await assign_ungrouped_sequences(sequence_session, user_id=test_user.id)

    seq_payload = (await authenticated_client.get("/sequences/1")).json()
    group_id = seq_payload["sequence_group_id"]

    # First bulk-annotate sets the label.
    first = await authenticated_client.post(
        "/annotations/sequences/bulk",
        json={
            "sequence_ids": [1],
            "group_id": group_id,
            "smoke_type": "wildfire",
            "is_unsure": False,
        },
    )
    assert first.status_code == 200

    # Conflicting attempt without force → 409.
    conflict = await authenticated_client.post(
        "/annotations/sequences/bulk",
        json={
            "sequence_ids": [1],
            "group_id": group_id,
            "false_positive_type": "antenna",
            "is_unsure": False,
        },
    )
    assert conflict.status_code == 409

    # Same payload with force=True → accepted.
    forced = await authenticated_client.post(
        "/annotations/sequences/bulk",
        json={
            "sequence_ids": [1],
            "group_id": group_id,
            "false_positive_type": "antenna",
            "is_unsure": False,
            "force": True,
        },
    )
    assert forced.status_code == 200


@pytest.mark.asyncio
async def test_propagation_skipped_when_group_not_validated(
    authenticated_client: AsyncClient,
    sequence_session: AsyncSession,
    detection_session: AsyncSession,
):
    """Group exists, both seqs joined, but is_validated=False → posting an
    annotation on seq 1 must not write a label onto the group or create
    an annotation for seq 2."""
    group_id = await _seed_two_member_group(
        sequence_session, [1, 2], is_validated=False
    )

    payload = _annotation_payload(stage="seq_annotation_done", smoke_type="wildfire")
    payload["sequence_id"] = 1
    resp = await authenticated_client.post("/annotations/sequences/", json=payload)
    assert resp.status_code == 201
    assert resp.json().get("group_propagation_warning") is None

    group_resp = await authenticated_client.get(f"/sequence_groups/{group_id}")
    assert group_resp.json()["smoke_type"] is None

    # No fan-out: seq 2 should still have no annotation row.
    other_anno = await authenticated_client.get("/annotations/sequences/?sequence_id=2")
    assert other_anno.json()["total"] == 0


@pytest.mark.asyncio
async def test_propagation_writes_label_and_fans_out(
    authenticated_client: AsyncClient,
    sequence_session: AsyncSession,
    detection_session: AsyncSession,
    test_user: User,
):
    """Validated group, no existing label, no conflict → group gets the
    derived label and the other unlocked member gets an inherited
    annotation in SEQ_ANNOTATION_DONE."""
    group_id = await _seed_two_member_group(sequence_session, [1, 2], is_validated=True)

    payload = _annotation_payload(stage="seq_annotation_done", smoke_type="wildfire")
    payload["sequence_id"] = 1
    resp = await authenticated_client.post("/annotations/sequences/", json=payload)
    assert resp.status_code == 201
    assert resp.json().get("group_propagation_warning") is None

    group_resp = await authenticated_client.get(f"/sequence_groups/{group_id}")
    group_payload = group_resp.json()
    assert group_payload["smoke_type"] == "wildfire"
    assert group_payload["false_positive_type"] is None

    other = await authenticated_client.get("/annotations/sequences/?sequence_id=2")
    items = other.json()["items"]
    assert len(items) == 1
    assert items[0]["processing_stage"] == "seq_annotation_done"
    assert items[0]["smoke_types"] == ["wildfire"]

    # The fanned-out sibling annotation is attributed to the saving user —
    # and so is the source annotation (one gesture writes the whole group).
    assert await _annotation_contributor_ids(sequence_session, 2) == [test_user.id]
    assert await _annotation_contributor_ids(sequence_session, 1) == [test_user.id]


@pytest.mark.asyncio
async def test_propagation_warns_and_skips_on_conflict(
    authenticated_client: AsyncClient,
    sequence_session: AsyncSession,
    detection_session: AsyncSession,
):
    """Validated group already labeled `industrial` smoke → annotating
    seq 1 with `wildfire` returns a warning, leaves the group label
    untouched, and does NOT propagate to seq 2."""
    group_id = await _seed_two_member_group(
        sequence_session,
        [1, 2],
        is_validated=True,
        smoke_type="industrial",
    )

    payload = _annotation_payload(stage="seq_annotation_done", smoke_type="wildfire")
    payload["sequence_id"] = 1
    resp = await authenticated_client.post("/annotations/sequences/", json=payload)
    assert resp.status_code == 201
    body = resp.json()
    assert body["group_propagation_warning"] is not None
    assert "industrial" in body["group_propagation_warning"]
    # The seq's own annotation still saved as wildfire.
    assert body["smoke_types"] == ["wildfire"]

    # Group label is unchanged.
    group_resp = await authenticated_client.get(f"/sequence_groups/{group_id}")
    assert group_resp.json()["smoke_type"] == "industrial"

    # Seq 2 must not have an annotation propagated.
    other = await authenticated_client.get("/annotations/sequences/?sequence_id=2")
    assert other.json()["total"] == 0


@pytest.mark.asyncio
async def test_propagation_skips_locked_members(
    authenticated_client: AsyncClient,
    sequence_session: AsyncSession,
    detection_session: AsyncSession,
):
    """Seq 2 already has an annotation in ANNOTATED (locked stage); when
    seq 1 is saved in a validated group, propagation must not overwrite
    seq 2's reviewed work."""
    await _seed_two_member_group(sequence_session, [1, 2], is_validated=True)

    locked = _annotation_payload(stage="annotated", smoke_type="industrial")
    locked["sequence_id"] = 2
    resp = await authenticated_client.post("/annotations/sequences/", json=locked)
    assert resp.status_code == 201

    trigger = _annotation_payload(stage="seq_annotation_done", smoke_type="wildfire")
    trigger["sequence_id"] = 1
    resp = await authenticated_client.post("/annotations/sequences/", json=trigger)
    assert resp.status_code == 201

    # Seq 2 keeps its reviewed `industrial` label.
    other = await authenticated_client.get("/annotations/sequences/?sequence_id=2")
    items = other.json()["items"]
    assert len(items) == 1
    assert items[0]["processing_stage"] == "annotated"
    assert items[0]["smoke_types"] == ["industrial"]


@pytest.mark.asyncio
async def test_propagation_fans_out_unsure_flag(
    authenticated_client: AsyncClient,
    sequence_session: AsyncSession,
    detection_session: AsyncSession,
):
    """Validated group, no existing label → saving seq 1 as unsure marks the
    group unsure and fans the unsure flag out to the other unlocked member in
    SEQ_ANNOTATION_DONE."""
    group_id = await _seed_two_member_group(sequence_session, [1, 2], is_validated=True)

    payload = _unsure_payload(stage="seq_annotation_done")
    payload["sequence_id"] = 1
    resp = await authenticated_client.post("/annotations/sequences/", json=payload)
    assert resp.status_code == 201
    assert resp.json().get("group_propagation_warning") is None

    group_payload = (
        await authenticated_client.get(f"/sequence_groups/{group_id}")
    ).json()
    assert group_payload["is_unsure"] is True
    assert group_payload["smoke_type"] is None
    assert group_payload["false_positive_type"] is None

    other = await authenticated_client.get("/annotations/sequences/?sequence_id=2")
    items = other.json()["items"]
    assert len(items) == 1
    assert items[0]["is_unsure"] is True
    assert items[0]["processing_stage"] == "seq_annotation_done"


@pytest.mark.asyncio
async def test_propagation_warns_when_unsure_hits_labeled_group(
    authenticated_client: AsyncClient,
    sequence_session: AsyncSession,
    detection_session: AsyncSession,
):
    """A group already labeled `industrial` → marking seq 1 unsure returns a
    warning, leaves the group label untouched, and does not propagate."""
    group_id = await _seed_two_member_group(
        sequence_session,
        [1, 2],
        is_validated=True,
        smoke_type="industrial",
    )

    payload = _unsure_payload(stage="seq_annotation_done")
    payload["sequence_id"] = 1
    resp = await authenticated_client.post("/annotations/sequences/", json=payload)
    assert resp.status_code == 201
    body = resp.json()
    assert body["group_propagation_warning"] is not None
    assert "industrial" in body["group_propagation_warning"]

    group_payload = (
        await authenticated_client.get(f"/sequence_groups/{group_id}")
    ).json()
    assert group_payload["smoke_type"] == "industrial"
    assert group_payload["is_unsure"] is False

    # No fan-out to seq 2.
    other = await authenticated_client.get("/annotations/sequences/?sequence_id=2")
    assert other.json()["total"] == 0


@pytest.mark.asyncio
async def test_bulk_annotate_requires_exactly_one_label(
    authenticated_client: AsyncClient,
):
    """Bulk request rejects payload that sets neither or both labels."""
    neither = await authenticated_client.post(
        "/annotations/sequences/bulk",
        json={"sequence_ids": [1], "is_unsure": False},
    )
    assert neither.status_code == 422

    both = await authenticated_client.post(
        "/annotations/sequences/bulk",
        json={
            "sequence_ids": [1],
            "smoke_type": "wildfire",
            "false_positive_type": "antenna",
            "is_unsure": False,
        },
    )
    assert both.status_code == 422


@pytest.mark.asyncio
async def test_stats_empty(authenticated_client: AsyncClient):
    resp = await authenticated_client.get("/sequence_groups/stats")
    assert resp.status_code == 200
    assert resp.json() == {"total": 0, "validated": 0, "unvalidated": 0}


@pytest.mark.asyncio
async def test_stats_counts_only_groups_with_three_plus_members(
    authenticated_client: AsyncClient,
    async_session: AsyncSession,
):
    """total/validated/unvalidated cover the same 3+ member population as
    the list endpoint; the 2-member group is invisible to all counts."""
    to_validate = await _seed_group_with_members(
        async_session,
        n_members=3,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        alert_api_id_start=100,
    )
    await _seed_group_with_members(
        async_session,
        n_members=4,
        created_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
        alert_api_id_start=200,
    )
    await _seed_group_with_members(
        async_session,
        n_members=2,
        created_at=datetime(2026, 1, 3, tzinfo=timezone.utc),
        alert_api_id_start=300,
    )

    resp = await authenticated_client.patch(
        f"/sequence_groups/{to_validate}", json={"is_validated": True}
    )
    assert resp.status_code == 200, resp.text

    resp = await authenticated_client.get("/sequence_groups/stats")
    assert resp.status_code == 200
    assert resp.json() == {"total": 2, "validated": 1, "unvalidated": 1}
