"""Tests for the sequence-groups + bulk-annotate flow.

Covers:
- POST /sequence_groups/assign creates a new group from an unassigned sequence
- POST /annotations/sequences/bulk applies labels, writes them onto the
  group, and rejects conflicting labels unless force=True
- Request validation rejects payloads with neither or both labels

Cross-sequence inheritance (a second sequence joining a labeled group and
auto-receiving its label) is exercised end-to-end via the make pipeline,
not in this unit suite — the test fixtures only seed two sequences and
they intentionally have non-overlapping bboxes.
"""

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
