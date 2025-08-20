# Copyright (C) 2025, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

from datetime import datetime

from pydantic import BaseModel

__all__ = ["SourceApiRead"]


class SourceApiRead(BaseModel):
    """Source API information."""

    id: str
    name: str

    class Config:
        json_encoders = {datetime: lambda v: v.isoformat() if v else None}