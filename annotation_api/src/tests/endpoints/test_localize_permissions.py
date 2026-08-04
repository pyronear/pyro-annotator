"""Localize-write endpoints require can_localize (or superuser).

The classify-only representative is `regular_user` (can_localize defaults
to False); `localizer_user` has can_localize=True.
"""

import json
from datetime import datetime, timedelta, UTC

import pytest
from httpx import AsyncClient
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.api_v1.endpoints import auto_annotate as auto_annotate_ep

VALID_ANNOTATION = json.dumps(
    {
        "annotation": [
            {
                "xyxyn": [0.1, 0.1, 0.2, 0.2],
                "class_name": "smoke",
                "smoke_type": "wildfire",
            }
        ]
    }
)


class TestClassifyOnlyUserForbidden:
    @pytest.mark.asyncio
    async def test_create_detection_annotation_forbidden(
        self, async_client: AsyncClient, regular_user_token: str
    ):
        headers = {"Authorization": f"Bearer {regular_user_token}"}
        response = await async_client.post(
            "/annotations/detections/",
            data={
                "detection_id": "1",
                "annotation": VALID_ANNOTATION,
                "processing_stage": "visual_check",
            },
            headers=headers,
        )
        assert response.status_code == 403
        assert "Not enough permissions" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_patch_detection_annotation_forbidden(
        self, async_client: AsyncClient, regular_user_token: str
    ):
        headers = {"Authorization": f"Bearer {regular_user_token}"}
        response = await async_client.patch(
            "/annotations/detections/1",
            json={"processing_stage": "annotated"},
            headers=headers,
        )
        assert response.status_code == 403
        assert "Not enough permissions" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_delete_detection_annotation_forbidden(
        self, async_client: AsyncClient, regular_user_token: str
    ):
        headers = {"Authorization": f"Bearer {regular_user_token}"}
        response = await async_client.delete(
            "/annotations/detections/1", headers=headers
        )
        assert response.status_code == 403
        assert "Not enough permissions" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_auto_annotate_forbidden(
        self, async_client: AsyncClient, regular_user_token: str
    ):
        headers = {"Authorization": f"Bearer {regular_user_token}"}
        response = await async_client.post(
            "/auto-annotate/sequences/1", headers=headers
        )
        assert response.status_code == 403
        assert "Not enough permissions" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_reads_stay_open(
        self, async_client: AsyncClient, regular_user_token: str
    ):
        headers = {"Authorization": f"Bearer {regular_user_token}"}
        response = await async_client.get("/annotations/detections/", headers=headers)
        assert response.status_code == 200


class TestLocalizerAllowed:
    @pytest.mark.asyncio
    async def test_localizer_can_create_detection_annotation(
        self,
        async_client: AsyncClient,
        localizer_user_token: str,
        sequence_session: AsyncSession,
        mock_img: bytes,
    ):
        headers = {"Authorization": f"Bearer {localizer_user_token}"}
        now = datetime.now(UTC)

        detection_payload = {
            "sequence_id": "1",
            "alert_api_id": "1",
            "recorded_at": (now - timedelta(days=2)).isoformat(),
            "algo_predictions": json.dumps(
                {
                    "predictions": [
                        {
                            "xyxyn": [0.15, 0.15, 0.3, 0.3],
                            "confidence": 0.88,
                            "class_name": "smoke",
                        }
                    ]
                }
            ),
        }
        detection_response = await async_client.post(
            "/detections",
            data=detection_payload,
            files={"file": ("image.jpg", mock_img, "image/jpeg")},
            headers=headers,
        )
        assert detection_response.status_code == 201
        detection_id = detection_response.json()["id"]

        response = await async_client.post(
            "/annotations/detections/",
            data={
                "detection_id": str(detection_id),
                "annotation": VALID_ANNOTATION,
                "processing_stage": "visual_check",
            },
            headers=headers,
        )
        assert response.status_code == 201
        assert response.json()["processing_stage"] == "visual_check"
        annotation_id = response.json()["id"]

        # PATCH and DELETE succeed for the localizer too.
        response = await async_client.patch(
            f"/annotations/detections/{annotation_id}",
            json={"processing_stage": "annotated"},
            headers=headers,
        )
        assert response.status_code == 200
        assert response.json()["processing_stage"] == "annotated"

        response = await async_client.delete(
            f"/annotations/detections/{annotation_id}", headers=headers
        )
        assert response.status_code == 204

    @pytest.mark.asyncio
    async def test_localizer_can_enqueue_auto_annotate(
        self,
        async_client: AsyncClient,
        localizer_user_token: str,
        sequence_session: AsyncSession,
        monkeypatch,
    ):
        calls = {}

        async def fake_defer(**kwargs):
            calls.update(kwargs)

        monkeypatch.setattr(
            auto_annotate_ep.auto_annotate_sequence, "defer_async", fake_defer
        )

        headers = {"Authorization": f"Bearer {localizer_user_token}"}
        response = await async_client.post(
            "/auto-annotate/sequences/1", headers=headers
        )
        assert response.status_code == 202
        assert calls == {"sequence_id": 1}
