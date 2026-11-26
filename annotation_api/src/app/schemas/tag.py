from datetime import datetime
from typing import Annotated, Optional

from pydantic import BaseModel, ConfigDict, StringConstraints

__all__ = ["TagCreate", "TagRead", "TagUpdate"]

TagName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)
]


class TagCreate(BaseModel):
    name: TagName
    description: Optional[str] = None


class TagUpdate(BaseModel):
    name: Optional[TagName] = None
    description: Optional[str] = None


class TagRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: Optional[str] = None
    created_by: Optional[int] = None
    created_at: datetime
