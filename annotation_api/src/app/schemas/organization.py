# Copyright (C) 2025, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

from datetime import datetime
from typing import Optional

from pydantic import BaseModel

__all__ = ["OrganizationRead"]


class OrganizationRead(BaseModel):
    """Organization information with aggregated statistics."""

    id: int
    name: str
    sequence_count: int
    latest_sequence_date: Optional[datetime] = None

    class Config:
        json_encoders = {datetime: lambda v: v.isoformat() if v else None}