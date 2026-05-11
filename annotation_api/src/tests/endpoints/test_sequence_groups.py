"""Tests for the sequence-groups + bulk-annotate + propagation flow.

Covers:
- POST /sequence_groups/assign creates a new group from an unassigned sequence
- POST /annotations/sequences/bulk applies labels, writes them onto the
  group, and rejects conflicting labels unless force=True
- Request validation rejects payloads with neither or both labels
- Propagation on per-sequence annotation save:
    * unvalidated group → no fan-out
    * validated, no group label yet → group label set + other unlocked
      members get annotations
    * validated, conflicting label → warning returned, group untouched
    * validated, member locked at SEQ_ANNOTATION_DONE+ → skipped

Cross-sequence inheritance via assign-groups inheritance is exercised
end-to-end through the make pipeline — the test fixtures only seed two
sequences with non-overlapping bboxes, so they can't share a group.
"""

from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlmodel.ext.asyncio.session import AsyncSession


async def _set_seq_metadata(
    session: AsyncSession,
    sequence_id: int,
    *,
    camera_id: int,
    azimuth: int,
) -> None:
    await session.exec(
        text(
            "UPDATE sequences SET camera_id = :cam, azimuth = :az " "WHERE id = :sid"
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


@pytest.mark.asyncio
async def test_assign_groups_creates_group_for_unmatched_sequence(
    authenticated_client: AsyncClient,
    sequence_session: AsyncSession,
    detection_session: AsyncSession,
):
    """Sequence 1 has detections with bbox in the [0.12-0.5, 0.13-0.55] region;
    no group exists yet → assign should create one and link it."""
    await _set_seq_metadata(sequence_session, 1, camera_id=42, azimuth=90)

    response = await authenticated_client.post("/sequence_groups/assign")
    assert response.status_code == 200
    summary = response.json()
    assert summary["new_groups"] >= 1

    # The created group should now own sequence 1.
    seq_response = await authenticated_client.get("/sequences/1")
    assert seq_response.status_code == 200
    seq_payload = seq_response.json()
    assert seq_payload.get("sequence_group_id") is not None


@pytest.mark.asyncio
async def test_bulk_annotate_writes_label_on_group_and_seqs(
    authenticated_client: AsyncClient,
    sequence_session: AsyncSession,
    detection_session: AsyncSession,
):
    """After assigning a group from seq 1, bulk-annotating that seq should
    apply the label, mark the SequenceAnnotation as SEQ_ANNOTATION_DONE, and
    write the label onto the group itself."""
    await _set_seq_metadata(sequence_session, 1, camera_id=42, azimuth=90)
    assign_resp = await authenticated_client.post("/sequence_groups/assign")
    assert assign_resp.status_code == 200

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


@pytest.mark.asyncio
async def test_bulk_annotate_rejects_conflicting_label_without_force(
    authenticated_client: AsyncClient,
    sequence_session: AsyncSession,
    detection_session: AsyncSession,
):
    """A group already labeled `wildfire` must reject a request to relabel
    it as `antenna` unless the caller passes force=True."""
    await _set_seq_metadata(sequence_session, 1, camera_id=42, azimuth=90)
    await authenticated_client.post("/sequence_groups/assign")

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
    other_anno = await authenticated_client.get(
        "/annotations/sequences/?sequence_id=2"
    )
    assert other_anno.json()["total"] == 0


@pytest.mark.asyncio
async def test_propagation_writes_label_and_fans_out(
    authenticated_client: AsyncClient,
    sequence_session: AsyncSession,
    detection_session: AsyncSession,
):
    """Validated group, no existing label, no conflict → group gets the
    derived label and the other unlocked member gets an inherited
    annotation in SEQ_ANNOTATION_DONE."""
    group_id = await _seed_two_member_group(
        sequence_session, [1, 2], is_validated=True
    )

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
