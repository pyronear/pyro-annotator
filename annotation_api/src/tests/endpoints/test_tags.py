import pytest
from httpx import AsyncClient
from sqlmodel import select

from app.models import AlertTag, SourceApi, Tag, User, UserTag


async def _create(client: AsyncClient, name: str = "hackathon-2026", **extra):
    return await client.post("/tags/", json={"name": name, **extra})


@pytest.mark.asyncio
async def test_create_tag(authenticated_client: AsyncClient, test_user: User):
    response = await _create(
        authenticated_client, "  hackathon-2026  ", description="Theodo hackathon"
    )

    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "hackathon-2026"  # trimmed
    assert data["description"] == "Theodo hackathon"
    assert data["created_by"] == test_user.id
    assert data["created_at"]


@pytest.mark.asyncio
async def test_create_tag_rejects_duplicate_name(authenticated_client: AsyncClient):
    await _create(authenticated_client, "dup")
    response = await _create(authenticated_client, "dup")
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_create_tag_rejects_blank_name(authenticated_client: AsyncClient):
    response = await _create(authenticated_client, "   ")
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_list_tags_ordered_by_name(authenticated_client: AsyncClient):
    for name in ("b", "a", "c"):
        await _create(authenticated_client, name)

    response = await authenticated_client.get("/tags/")

    assert response.status_code == 200
    assert [t["name"] for t in response.json()] == ["a", "b", "c"]


@pytest.mark.asyncio
async def test_get_tag(authenticated_client: AsyncClient):
    tag_id = (await _create(authenticated_client, "x")).json()["id"]

    assert (await authenticated_client.get(f"/tags/{tag_id}")).json()["name"] == "x"
    assert (await authenticated_client.get("/tags/999999")).status_code == 404


@pytest.mark.asyncio
async def test_rename_tag(authenticated_client: AsyncClient):
    tag_id = (await _create(authenticated_client, "old")).json()["id"]

    response = await authenticated_client.patch(f"/tags/{tag_id}", json={"name": "new"})

    assert response.status_code == 200
    assert response.json()["name"] == "new"


@pytest.mark.asyncio
async def test_rename_tag_to_taken_name(authenticated_client: AsyncClient):
    await _create(authenticated_client, "taken")
    tag_id = (await _create(authenticated_client, "mine")).json()["id"]

    response = await authenticated_client.patch(
        f"/tags/{tag_id}", json={"name": "taken"}
    )
    assert response.status_code == 409

    # Renaming to its own name is a no-op, not a conflict.
    response = await authenticated_client.patch(
        f"/tags/{tag_id}", json={"name": "mine"}
    )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_rename_tag_to_null(authenticated_client: AsyncClient):
    tag_id = (await _create(authenticated_client, "keep")).json()["id"]
    response = await authenticated_client.patch(f"/tags/{tag_id}", json={"name": None})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_delete_tag_cascades(
    authenticated_client: AsyncClient, async_session, regular_user: User
):
    tag_id = (await _create(authenticated_client, "gone")).json()["id"]
    async_session.add(
        AlertTag(
            source_api=SourceApi.PYRONEAR_FRENCH_API,
            platform_alert_id=42,
            tag_id=tag_id,
        )
    )
    async_session.add(UserTag(user_id=regular_user.id, tag_id=tag_id))
    await async_session.commit()

    response = await authenticated_client.delete(f"/tags/{tag_id}")

    assert response.status_code == 204
    async_session.expire_all()
    assert (await async_session.exec(select(Tag))).all() == []
    assert (await async_session.exec(select(AlertTag))).all() == []
    assert (await async_session.exec(select(UserTag))).all() == []


@pytest.mark.asyncio
async def test_tags_are_admin_only(
    authenticated_client: AsyncClient,
    async_client: AsyncClient,
    regular_user_token: str,
):
    tag_id = (await _create(authenticated_client, "admin-only")).json()["id"]
    headers = {"Authorization": f"Bearer {regular_user_token}"}

    calls = [
        async_client.get("/tags/", headers=headers),
        async_client.post("/tags/", json={"name": "nope"}, headers=headers),
        async_client.get(f"/tags/{tag_id}", headers=headers),
        async_client.patch(f"/tags/{tag_id}", json={"name": "n"}, headers=headers),
        async_client.delete(f"/tags/{tag_id}", headers=headers),
    ]
    for call in calls:
        assert (await call).status_code == 403


@pytest.mark.asyncio
async def test_new_users_have_no_full_access(test_user: User, regular_user: User):
    assert test_user.full_access is False
    assert regular_user.full_access is False
