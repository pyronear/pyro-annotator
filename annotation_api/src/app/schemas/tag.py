from datetime import date, datetime
from typing import Annotated, List, Optional
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator

__all__ = [
    "TAG_TIMEZONE",
    "TagCreate",
    "TagDryRun",
    "TagFilter",
    "TagImpact",
    "TagRead",
    "TagUpdate",
]

# A tag period is read in the admins' days, not UTC ones: an alert recorded at
# 23:30 UTC on 31/07 belongs to 01/08.
TAG_TIMEZONE = ZoneInfo("Europe/Paris")

TagName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)
]


class TagFilter(BaseModel):
    """Which alerts a new tag goes on.

    organisation_names: empty = every organisation. recorded_from /
    recorded_to: inclusive Europe/Paris days on the alert's recorded_at; a
    missing bound is open. Neither bound may be in the future, since a tag
    is a snapshot of alerts that already exist.
    """

    organisation_names: List[str] = []
    recorded_from: Optional[date] = None
    recorded_to: Optional[date] = None

    @model_validator(mode="after")
    def _check_period(self) -> "TagFilter":
        today = datetime.now(TAG_TIMEZONE).date()
        for bound in (self.recorded_from, self.recorded_to):
            if bound is not None and bound > today:
                raise ValueError("Tag period dates cannot be in the future")
        if (
            self.recorded_from is not None
            and self.recorded_to is not None
            and self.recorded_from > self.recorded_to
        ):
            raise ValueError("recorded_from is after recorded_to")
        return self


class TagCreate(BaseModel):
    name: TagName
    description: Optional[str] = None
    # Tags the matching alerts in the same transaction. Without a filter the
    # tag starts empty (alerts can be tagged later by the alert side).
    filter: Optional[TagFilter] = None


class TagUpdate(BaseModel):
    name: Optional[TagName] = None
    description: Optional[str] = None


class TagRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: Optional[str] = None
    created_by: Optional[int] = None
    created_by_username: Optional[str] = None
    created_at: datetime
    # Recomputed from alert_tags / user_tags on every read.
    alert_count: int = 0
    user_count: int = 0


class TagDryRun(BaseModel):
    """How many alerts a filter matches right now."""

    alert_count: int


class TagImpact(BaseModel):
    """What deleting a tag takes away."""

    alert_count: int
    user_count: int
    # Users left with no tag at all (and no full_access): they would see no
    # alert once the tag is gone.
    users_losing_all_access: List[str]
