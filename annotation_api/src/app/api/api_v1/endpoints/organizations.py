# Copyright (C) 2025, Pyronear.

from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db import get_session
from app.models import Sequence
from app.schemas.organization import OrganizationRead

router = APIRouter()


@router.get("/", response_model=List[OrganizationRead])
async def list_organizations(
    search: Optional[str] = Query(None, description="Search organizations by name (partial match)"),
    session: AsyncSession = Depends(get_session),
) -> List[OrganizationRead]:
    """
    List all unique organizations.

    Returns distinct organizations from sequences with:
    - Organization ID and name

    Optionally filter by organization name using the search parameter.
    """
    # Build query for distinct organizations
    query = (
        select(
            Sequence.organisation_id.label("id"),
            Sequence.organisation_name.label("name"),
        )
        .distinct()
        .order_by(Sequence.organisation_name)
    )

    # Apply search filter if provided
    if search:
        query = query.where(Sequence.organisation_name.ilike(f"%{search}%"))

    # Execute query
    result = await session.execute(query)
    organizations = result.all()

    # Convert to response model
    return [
        OrganizationRead(
            id=org.id,
            name=org.name,
        )
        for org in organizations
    ]