import pytest
from httpx import AsyncClient
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.api_v1.endpoints import auto_annotate as ep


@pytest.mark.asyncio
async def test_auto_annotate_enqueues(
    authenticated_client: AsyncClient, sequence_session: AsyncSession, monkeypatch
):
    calls = {}

    async def fake_defer(**kwargs):
        calls.update(kwargs)

    monkeypatch.setattr(ep.auto_annotate_sequence, "defer_async", fake_defer)

    resp = await authenticated_client.post("/auto-annotate/sequences/1")
    assert resp.status_code == 202
    assert resp.json()["sequence_id"] == 1
    assert calls == {"sequence_id": 1}


@pytest.mark.asyncio
async def test_auto_annotate_unknown_sequence_404(
    authenticated_client: AsyncClient, monkeypatch
):
    deferred = False

    async def fake_defer(**kwargs):
        nonlocal deferred
        deferred = True

    monkeypatch.setattr(ep.auto_annotate_sequence, "defer_async", fake_defer)

    resp = await authenticated_client.post("/auto-annotate/sequences/999999")
    assert resp.status_code == 404
    assert not deferred  # no job enqueued for a missing sequence


@pytest.mark.asyncio
async def test_auto_annotate_requires_auth(async_client: AsyncClient):
    resp = await async_client.post("/auto-annotate/sequences/1")
    assert resp.status_code in (401, 403)
