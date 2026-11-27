"""User side of tags (#402): give / remove tags, full access, and the user list."""

from typing import Sequence

import pytest
from httpx import AsyncClient, Response
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models import Tag, User, UserTag


async def _tag(client: AsyncClient, name: str) -> int:
    response = await client.post("/tags/", json={"name": name})
    assert response.status_code == 201
    return response.json()["id"]


async def _change(
    client: AsyncClient,
    tag_id: int,
    add: Sequence[int] = (),
    remove: Sequence[int] = (),
) -> Response:
    return await client.patch(
        f"/tags/{tag_id}/users", json={"add": list(add), "remove": list(remove)}
    )


async def _tag_names(client: AsyncClient, user_id: int) -> list[str]:
    response = await client.get(f"/users/{user_id}")
    assert response.status_code == 200
    return [tag["name"] for tag in response.json()["tags"]]


@pytest.mark.asyncio
async def test_give_and_remove_a_tag(
    authenticated_client: AsyncClient, regular_user: User, localizer_user: User
):
    tag_id = await _tag(authenticated_client, "campaign")

    response = await _change(
        authenticated_client, tag_id, add=[regular_user.id, localizer_user.id]
    )
    assert response.status_code == 200
    assert response.json() == {"tag_id": tag_id, "added": 2, "removed": 0}
    assert await _tag_names(authenticated_client, regular_user.id) == ["campaign"]

    response = await _change(authenticated_client, tag_id, remove=[regular_user.id])
    assert response.json() == {"tag_id": tag_id, "added": 0, "removed": 1}
    assert await _tag_names(authenticated_client, regular_user.id) == []
    assert await _tag_names(authenticated_client, localizer_user.id) == ["campaign"]


@pytest.mark.asyncio
async def test_change_is_idempotent(
    authenticated_client: AsyncClient, regular_user: User
):
    tag_id = await _tag(authenticated_client, "campaign")
    await _change(authenticated_client, tag_id, add=[regular_user.id])

    again = await _change(authenticated_client, tag_id, add=[regular_user.id])
    assert again.json()["added"] == 0

    await _change(authenticated_client, tag_id, remove=[regular_user.id])
    again = await _change(authenticated_client, tag_id, remove=[regular_user.id])
    assert again.status_code == 200
    assert again.json()["removed"] == 0


@pytest.mark.asyncio
async def test_add_and_remove_in_one_request(
    authenticated_client: AsyncClient, regular_user: User, localizer_user: User
):
    tag_id = await _tag(authenticated_client, "campaign")
    await _change(authenticated_client, tag_id, add=[regular_user.id])

    response = await _change(
        authenticated_client,
        tag_id,
        add=[localizer_user.id],
        remove=[regular_user.id],
    )

    assert response.json() == {"tag_id": tag_id, "added": 1, "removed": 1}
    assert await _tag_names(authenticated_client, regular_user.id) == []
    assert await _tag_names(authenticated_client, localizer_user.id) == ["campaign"]


@pytest.mark.asyncio
async def test_change_validates_the_payload(
    authenticated_client: AsyncClient, regular_user: User
):
    tag_id = await _tag(authenticated_client, "campaign")

    assert (await _change(authenticated_client, tag_id)).status_code == 422
    overlapping = await _change(
        authenticated_client, tag_id, add=[regular_user.id], remove=[regular_user.id]
    )
    assert overlapping.status_code == 422


@pytest.mark.asyncio
async def test_change_rejects_unknown_tag_or_user(
    authenticated_client: AsyncClient, regular_user: User, async_session: AsyncSession
):
    missing_tag = await _change(authenticated_client, 999999, add=[regular_user.id])
    assert missing_tag.status_code == 404

    tag_id = await _tag(authenticated_client, "campaign")
    missing_user = await _change(
        authenticated_client, tag_id, add=[regular_user.id, 999999]
    )
    assert missing_user.status_code == 404
    assert "999999" in missing_user.json()["detail"]
    # All or nothing: the known user did not get the tag either.
    rows = await async_session.exec(select(UserTag).where(UserTag.tag_id == tag_id))
    assert rows.all() == []


@pytest.mark.asyncio
async def test_change_rejects_the_worker(
    authenticated_client: AsyncClient, worker_user: User
):
    tag_id = await _tag(authenticated_client, "campaign")

    response = await _change(authenticated_client, tag_id, add=[worker_user.id])

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_change_is_admin_only(
    authenticated_client: AsyncClient,
    async_client: AsyncClient,
    regular_user: User,
    manager_user_token: str,
    regular_user_token: str,
):
    tag_id = await _tag(authenticated_client, "campaign")

    for token in (manager_user_token, regular_user_token):
        response = await async_client.patch(
            f"/tags/{tag_id}/users",
            json={"add": [regular_user.id]},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 403


@pytest.mark.asyncio
async def test_deleting_a_tag_or_a_user_drops_the_assignment(
    authenticated_client: AsyncClient,
    regular_user: User,
    localizer_user: User,
    async_session: AsyncSession,
):
    kept = await _tag(authenticated_client, "kept")
    dropped = await _tag(authenticated_client, "dropped")
    for tag_id in (kept, dropped):
        await _change(
            authenticated_client, tag_id, add=[regular_user.id, localizer_user.id]
        )

    await authenticated_client.delete(f"/tags/{dropped}")
    assert await _tag_names(authenticated_client, regular_user.id) == ["kept"]

    await authenticated_client.delete(f"/users/{localizer_user.id}")
    rows = await async_session.exec(
        select(UserTag.user_id).where(UserTag.tag_id == kept)
    )
    assert rows.all() == [regular_user.id]


@pytest.mark.asyncio
async def test_user_read_carries_tags_sorted_and_full_access(
    authenticated_client: AsyncClient, regular_user: User
):
    for name in ("zeta", "alpha"):
        await _change(
            authenticated_client,
            await _tag(authenticated_client, name),
            add=[regular_user.id],
        )

    response = await authenticated_client.get("/users/")

    assert response.status_code == 200
    row = next(u for u in response.json()["items"] if u["id"] == regular_user.id)
    assert row["full_access"] is False
    assert [tag["name"] for tag in row["tags"]] == ["alpha", "zeta"]
    assert set(row["tags"][0]) >= {"id", "name", "description"}


@pytest.mark.asyncio
async def test_list_users_filters_by_tag(
    authenticated_client: AsyncClient, regular_user: User, localizer_user: User
):
    tag_id = await _tag(authenticated_client, "campaign")
    await _change(authenticated_client, tag_id, add=[regular_user.id])

    response = await authenticated_client.get("/users/", params={"tag_id": tag_id})

    assert [u["id"] for u in response.json()["items"]] == [regular_user.id]


@pytest.mark.asyncio
async def test_list_users_filters_by_access(
    authenticated_client: AsyncClient,
    test_user: User,
    regular_user: User,
    localizer_user: User,
    inactive_user: User,
    worker_user: User,
):
    tag_id = await _tag(authenticated_client, "campaign")
    await _change(authenticated_client, tag_id, add=[regular_user.id])
    await authenticated_client.patch(
        f"/users/{localizer_user.id}", json={"full_access": True}
    )

    async def ids(access: str) -> set[int]:
        response = await authenticated_client.get("/users/", params={"access": access})
        assert response.status_code == 200
        return {u["id"] for u in response.json()["items"]}

    # Admins see every alert by role.
    assert await ids("full") == {test_user.id, localizer_user.id}
    assert await ids("tagged") == {regular_user.id}
    # The worker is not a person: it is never reported as seeing nothing.
    assert await ids("none") == {inactive_user.id}


@pytest.mark.asyncio
async def test_admin_sets_full_access(
    authenticated_client: AsyncClient, regular_user: User
):
    response = await authenticated_client.patch(
        f"/users/{regular_user.id}", json={"full_access": True}
    )

    assert response.status_code == 200
    assert response.json()["full_access"] is True


@pytest.mark.asyncio
async def test_create_user_with_full_access(authenticated_client: AsyncClient):
    response = await authenticated_client.post(
        "/users/",
        json={
            "username": "trusted",
            "password": "testpassword123",
            "full_access": True,
        },
    )

    assert response.status_code == 201
    assert response.json()["full_access"] is True
    assert response.json()["tags"] == []


@pytest.mark.asyncio
async def test_new_users_have_no_full_access_by_default(
    authenticated_client: AsyncClient,
):
    response = await authenticated_client.post(
        "/users/", json={"username": "newbie", "password": "testpassword123"}
    )

    assert response.json()["full_access"] is False


@pytest.mark.asyncio
async def test_manager_cannot_set_full_access(
    async_client: AsyncClient, regular_user: User, manager_user_token: str
):
    response = await async_client.patch(
        f"/users/{regular_user.id}",
        json={"full_access": True},
        headers={"Authorization": f"Bearer {manager_user_token}"},
    )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_full_access_cannot_be_null(
    authenticated_client: AsyncClient, regular_user: User
):
    response = await authenticated_client.patch(
        f"/users/{regular_user.id}", json={"full_access": None}
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_admins_cannot_be_given_tags_but_can_lose_them(
    authenticated_client: AsyncClient,
    test_user: User,
    regular_user: User,
    async_session: AsyncSession,
):
    tag_id = await _tag(authenticated_client, "campaign")

    refused = await _change(
        authenticated_client, tag_id, add=[regular_user.id, test_user.id]
    )
    assert refused.status_code == 403
    rows = await async_session.exec(select(UserTag).where(UserTag.tag_id == tag_id))
    assert rows.all() == []

    # A user promoted to admin keeps their tags: removing them still works.
    async_session.add(UserTag(user_id=test_user.id, tag_id=tag_id))
    await async_session.commit()
    removed = await _change(authenticated_client, tag_id, remove=[test_user.id])
    assert removed.json()["removed"] == 1


@pytest.mark.asyncio
async def test_worker_full_access_cannot_change(
    authenticated_client: AsyncClient, worker_user: User
):
    response = await authenticated_client.patch(
        f"/users/{worker_user.id}", json={"full_access": True}
    )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_tags_survive_a_user_update(
    authenticated_client: AsyncClient, regular_user: User, async_session: AsyncSession
):
    tag_id = await _tag(authenticated_client, "campaign")
    await _change(authenticated_client, tag_id, add=[regular_user.id])

    response = await authenticated_client.patch(
        f"/users/{regular_user.id}", json={"is_active": False}
    )

    assert [tag["name"] for tag in response.json()["tags"]] == ["campaign"]
    assert (await async_session.get(Tag, tag_id)) is not None
