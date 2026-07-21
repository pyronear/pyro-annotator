import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_auto_annotate_enqueues(authenticated_client: AsyncClient, monkeypatch):
    calls = {}

    async def fake_defer(**kwargs):
        calls.update(kwargs)

    from app.api.api_v1.endpoints import auto_annotate as ep

    monkeypatch.setattr(ep.auto_annotate_sequence, "defer_async", fake_defer)

    resp = await authenticated_client.post("/auto-annotate/sequences/1")
    assert resp.status_code == 202
    assert resp.json()["sequence_id"] == 1
    assert calls == {"sequence_id": 1}


@pytest.mark.asyncio
async def test_auto_annotate_requires_auth(async_client: AsyncClient):
    resp = await async_client.post("/auto-annotate/sequences/1")
    assert resp.status_code in (401, 403)
