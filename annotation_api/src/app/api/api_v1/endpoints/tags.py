"""The tag entity (#402): list, create (tagging a filter's alerts), rename,
delete, and what a delete takes away. Admin only."""

from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel.ext.asyncio.session import AsyncSession

from app.auth.dependencies import get_current_admin
from app.crud import TagCRUD
from app.crud.crud_alert_tag import AlertTagCRUD
from app.db import get_session
from app.models import User
from app.schemas.tag import TagCreate, TagImpact, TagRead, TagUpdate

router = APIRouter()


def _name_taken() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT, detail="Tag name already exists"
    )


@router.get("/", response_model=List[TagRead])
async def list_tags(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> List[TagRead]:
    """All tags, ordered by name, with their alert and user counts."""
    return await TagCRUD(session).list_tags()


@router.post("/", response_model=TagRead, status_code=status.HTTP_201_CREATED)
async def create_tag(
    payload: TagCreate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> TagRead:
    """Create a tag. With a `filter`, every alert it matches right now is
    tagged in the same transaction (a snapshot: alerts imported later are not).
    A filter matching no alert is refused (422). Names are unique whatever
    their case (409)."""
    crud = TagCRUD(session)
    if await crud.get_by_name(payload.name):
        raise _name_taken()
    if payload.filter is not None:
        if await AlertTagCRUD(session).count_matching(payload.filter) == 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="The filter matches no alert",
            )
    tag = await crud.create_tag(payload, created_by=current_user.id)
    return await crud.read_tag(tag.id)


@router.get("/{tag_id}", response_model=TagRead)
async def get_tag(
    tag_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> TagRead:
    return await TagCRUD(session).read_tag(tag_id)


@router.get("/{tag_id}/impact", response_model=TagImpact)
async def get_tag_impact(
    tag_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> TagImpact:
    """What deleting the tag takes away: its alerts, its users, and the users
    it would leave with no tag at all (warning only, the delete is allowed)."""
    return await TagCRUD(session).impact(tag_id)


@router.patch("/{tag_id}", response_model=TagRead)
async def update_tag(
    tag_id: int,
    payload: TagUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> TagRead:
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
    await crud.update(tag_id, payload)
    return await crud.read_tag(tag_id)


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tag(
    tag_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_admin),
) -> None:
    """Hard delete. Its alert_tags and user_tags rows go with it (cascade);
    alerts and annotations are kept."""
    await TagCRUD(session).delete(tag_id)
