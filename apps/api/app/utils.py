from __future__ import annotations

from datetime import date, datetime, time
from enum import Enum
from math import isfinite
from typing import Any

try:
    from pydantic import BaseModel
except Exception:  # pragma: no cover - pydantic is a runtime dependency
    BaseModel = None  # type: ignore


def to_jsonable(value: Any) -> Any:
    """Convert SDK objects into plain JSON-friendly structures."""

    if BaseModel is not None and isinstance(value, BaseModel):
        return to_jsonable(value.model_dump())
    if hasattr(value, "to_dict") and callable(value.to_dict):
        return to_jsonable(value.to_dict(orient="records"))
    if isinstance(value, dict):
        return {str(k): to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [to_jsonable(v) for v in value]
    if isinstance(value, Enum):
        return value.name
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, float):
        return value if isfinite(value) else None
    return value
