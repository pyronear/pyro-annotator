"""Bulk detection-annotation upsert: accept a whole object in one atomic
write. See docs/specs/2026-08-12-bulk-detection-annotation-accept-design.md."""

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models import (
    Detection,
    DetectionAnnotation,
    DetectionAnnotationContribution,
    DetectionAnnotationProcessingStage,
    Sequence,
    SourceApi,
)

NOW = datetime(2026, 8, 12, 12, 0, tzinfo=UTC)

BOX = {
    "xyxyn": [0.1, 0.1, 0.2, 0.2],
    "class_name": "smoke",
    "smoke_type": "wildfire",
    "origin": "auto",
}


def annotation(*boxes):
    return {"annotation": list(boxes)}


async def _lane(session, *, alert_api_id, frames=3):
    """A lane sequence with `frames` detections, no annotations yet."""
    seq = Sequence(
        source_api=SourceApi.PYRONEAR_FRENCH_API,
        alert_api_id=alert_api_id,
        platform_alert_id=900,
        created_at=NOW,
        recorded_at=NOW,
        last_seen_at=NOW,
        camera_name="cam",
        camera_id=1,
        lat=1.0,
        lon=2.0,
        organisation_name="org",
        organisation_id=1,
    )
    session.add(seq)
    await session.flush()
    dets = []
    for i in range(frames):
        det = Detection(
            alert_api_id=alert_api_id * 1000 + i,
            sequence_id=seq.id,
            recorded_at=NOW + timedelta(minutes=i),
            bucket_key=f"{alert_api_id}-{i}.jpg",
            created_at=NOW,
            algo_predictions={"predictions": []},
        )
        session.add(det)
        dets.append(det)
    await session.commit()
    await session.refresh(seq)
    for det in dets:
        await session.refresh(det)
    return seq, dets


@pytest.mark.asyncio
async def test_bulk_creates_an_annotation_for_every_frame(
    authenticated_client: AsyncClient, async_session
):
    seq, dets = await _lane(async_session, alert_api_id=910)

    response = await authenticated_client.post(
        "/annotations/detections/bulk",
        json={
            "sequence_id": seq.id,
            "items": [
                {
                    "detection_id": det.id,
                    "annotation": annotation(BOX),
                    "processing_stage": "annotated",
                }
                for det in dets
            ],
        },
    )

    assert response.status_code == 200
    results = response.json()["results"]
    assert [r["detection_id"] for r in results] == [d.id for d in dets]
    assert all(r["processing_stage"] == "annotated" for r in results)
    assert all(isinstance(r["annotation_id"], int) for r in results)

    rows = (
        (
            await async_session.execute(
                select(DetectionAnnotation).where(
                    DetectionAnnotation.detection_id.in_([d.id for d in dets])
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == len(dets)
    assert all(
        row.processing_stage == DetectionAnnotationProcessingStage.ANNOTATED
        for row in rows
    )
    assert all(row.annotation["annotation"][0]["xyxyn"] == BOX["xyxyn"] for row in rows)


@pytest.mark.asyncio
async def test_bulk_updates_existing_rows_and_mixes_with_creates(
    authenticated_client: AsyncClient, async_session
):
    seq, dets = await _lane(async_session, alert_api_id=911)
    stale = DetectionAnnotation(
        detection_id=dets[0].id,
        annotation=annotation({**BOX, "xyxyn": [0.5, 0.5, 0.6, 0.6]}),
        processing_stage=DetectionAnnotationProcessingStage.BBOX_ANNOTATION,
        created_at=NOW,
    )
    async_session.add(stale)
    await async_session.commit()
    await async_session.refresh(stale)

    response = await authenticated_client.post(
        "/annotations/detections/bulk",
        json={
            "sequence_id": seq.id,
            "items": [
                {
                    "detection_id": det.id,
                    "annotation": annotation(BOX),
                    "processing_stage": "annotated",
                }
                for det in dets
            ],
        },
    )

    assert response.status_code == 200
    # The pre-existing row is UPDATED in place, not duplicated.
    by_detection = {r["detection_id"]: r for r in response.json()["results"]}
    assert by_detection[dets[0].id]["annotation_id"] == stale.id
    await async_session.refresh(stale)
    assert stale.processing_stage == DetectionAnnotationProcessingStage.ANNOTATED
    assert stale.annotation["annotation"][0]["xyxyn"] == BOX["xyxyn"]

    count = len(
        (
            await async_session.execute(
                select(DetectionAnnotation).where(
                    DetectionAnnotation.detection_id.in_([d.id for d in dets])
                )
            )
        )
        .scalars()
        .all()
    )
    assert count == len(dets)


@pytest.mark.asyncio
async def test_bulk_records_one_contribution_per_annotated_row(
    authenticated_client: AsyncClient, async_session, test_user
):
    seq, dets = await _lane(async_session, alert_api_id=912, frames=2)

    response = await authenticated_client.post(
        "/annotations/detections/bulk",
        json={
            "sequence_id": seq.id,
            "items": [
                {
                    "detection_id": det.id,
                    "annotation": annotation(BOX),
                    "processing_stage": "annotated",
                }
                for det in dets
            ],
        },
    )
    assert response.status_code == 200

    ids = [r["annotation_id"] for r in response.json()["results"]]
    contributions = (
        (
            await async_session.execute(
                select(DetectionAnnotationContribution).where(
                    DetectionAnnotationContribution.detection_annotation_id.in_(ids)
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(contributions) == len(dets)
    assert {c.user_id for c in contributions} == {test_user.id}


@pytest.mark.asyncio
async def test_resending_the_same_batch_is_a_clean_update(
    authenticated_client: AsyncClient, async_session
):
    """The old loop's retry hit uq_detection_annotation_detection_id; the
    upsert must not."""
    seq, dets = await _lane(async_session, alert_api_id=913, frames=2)
    body = {
        "sequence_id": seq.id,
        "items": [
            {
                "detection_id": det.id,
                "annotation": annotation(BOX),
                "processing_stage": "annotated",
            }
            for det in dets
        ],
    }

    first = await authenticated_client.post("/annotations/detections/bulk", json=body)
    second = await authenticated_client.post("/annotations/detections/bulk", json=body)

    assert first.status_code == 200
    assert second.status_code == 200
    assert [r["annotation_id"] for r in first.json()["results"]] == [
        r["annotation_id"] for r in second.json()["results"]
    ]
