from __future__ import annotations

from datetime import date, datetime, time, timedelta
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


def pick_number(*values: Any, default: float = 0) -> float:
    for value in values:
        try:
            if value is None:
                continue
            number = float(value)
            if isfinite(number):
                return number
        except (TypeError, ValueError):
            continue
    return default


def percent_change(current: float, previous: float) -> float:
    if not previous:
        return 0
    return round((current - previous) / abs(previous) * 100, 2)


def parse_day(day: str | None) -> date | None:
    if not day:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(day, fmt).date()
        except ValueError:
            pass
    return None


def recent_weekdays(end_day: str | None, count: int = 5) -> list[str]:
    end = parse_day(end_day) or date.today()
    days: list[str] = []
    cursor = end
    while len(days) < count:
        if cursor.weekday() < 5:
            days.append(cursor.isoformat())
        cursor -= timedelta(days=1)
    return list(reversed(days))


def format_ts(ts: int | float | None) -> str:
    if not ts:
        return ""
    try:
        return datetime.fromtimestamp(float(ts)).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return ""
