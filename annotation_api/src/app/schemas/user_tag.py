from typing import List

from pydantic import BaseModel, Field, model_validator

__all__ = ["UserTagsChange", "UserTagsChangeResult"]


class UserTagsChange(BaseModel):
    """Give one tag to the `add` users and take it from the `remove` users.

    Idempotent: adding a user who has the tag, or removing one who does not,
    changes nothing.
    """

    add: List[int] = Field(default_factory=list)
    remove: List[int] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check(self) -> "UserTagsChange":
        if not self.add and not self.remove:
            raise ValueError("Give at least one user to add or remove")
        both = sorted(set(self.add) & set(self.remove))
        if both:
            raise ValueError(f"Users both added and removed: {both}")
        return self


class UserTagsChangeResult(BaseModel):
    tag_id: int
    # Users who got the tag / lost it; those already in that state are not counted.
    added: int
    removed: int
