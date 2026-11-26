"""The tag entity (#402): list, create, rename, delete. Admin only."""

from typing import List, cast

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth.dependencies import get_current_superuser
from app.crud import TagCRUD
from app.db import get_session
from app.models import Tag, User
from app.schemas.tag import TagCreate, TagRead, TagUpdate

router = APIRouter()


def _name_taken() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT, detail="Tag name already exists"
    )


@router.get("/", response_model=List[TagRead])
async def list_tags(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_superuser),
) -> List[Tag]:
    """All tags, ordered by name."""
    return await TagCRUD(session).list_tags()


@router.post("/", response_model=TagRead, status_code=status.HTTP_201_CREATED)
async def create_tag(
    payload: TagCreate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_superuser),
) -> Tag:
    crud = TagCRUD(session)
    if await crud.get_by_name(payload.name):
        raise _name_taken()
    return await crud.create_tag(payload, created_by=current_user.id)


@router.get("/{tag_id}", response_model=TagRead)
async def get_tag(
    tag_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_superuser),
) -> Tag:
    return cast(Tag, await TagCRUD(session).get(tag_id, strict=True))


@router.patch("/{tag_id}", response_model=TagRead)
async def update_tag(
    tag_id: int,
    payload: TagUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_superuser),
) -> Tag:
    """Rename a tag or change its description."""
    if "name" in payload.model_fields_set and payload.name is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A tag name cannot be null",
        )
    crud = TagCRUD(session)
    if payload.name is not None:
        existing = await crud.get_by_name(payload.name)
        if existing and existing.id != tag_id:
            raise _name_taken()
    return await crud.update(tag_id, payload)


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tag(
    tag_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_superuser),
) -> None:
    """Delete a tag. Its alerts and users lose it (cascade)."""
    await TagCRUD(session).delete(tag_id)
