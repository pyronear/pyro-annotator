# Copyright (C) 2025, Pyronear.

from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.db import get_session
from app.models import Sequence
from app.schemas.source_api import SourceApiRead

router = APIRouter()


@router.get("/", response_model=List[SourceApiRead])
async def list_source_apis(
    session: AsyncSession = Depends(get_session),
) -> List[SourceApiRead]:
    """
    List all unique source APIs.

    Returns distinct source APIs from sequences with:
    - Source API ID and display name
    """
    # Build query for distinct source APIs
    query = select(Sequence.source_api).distinct()

    # Execute query
    result = await session.execute(query)
    source_apis = result.scalars().all()

    # Sort alphabetically by source API string value for consistent ordering
    source_apis = sorted(source_apis)

    # Create a mapping of source API values to display names
    source_api_names = {
        "pyronear_french": "Pyronear French",
        "alert_wildfire": "Alert Wildfire",
        "api_cenia": "API Cenia",
    }

    # Convert to response model
    return [
        SourceApiRead(
            id=source_api,
            name=source_api_names.get(source_api, source_api),
        )
        for source_api in source_apis
    ]
