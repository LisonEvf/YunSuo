"""API 错误分类与重试策略。

借鉴 hermes-agent error_classifier 的分类思路，针对通用 agent 场景精简为 6 种。
"""
from __future__ import annotations

import enum
import logging
import random
from dataclasses import dataclass

logger = logging.getLogger(__name__)


class ErrorReason(enum.Enum):
    rate_limit = "rate_limit"
    overloaded = "overloaded"
    server_error = "server_error"
    timeout = "timeout"
    auth = "auth"
    context_overflow = "context_overflow"
    unknown = "unknown"


@dataclass
class ClassifiedError:
    reason: ErrorReason
    status_code: int | None = None
    message: str = ""
    retryable: bool = True


def classify_error(exc: Exception) -> ClassifiedError:
    """分类 API 错误，决定重试策略。"""
    from openai import APIStatusError, APITimeoutError

    if isinstance(exc, APITimeoutError):
        return ClassifiedError(reason=ErrorReason.timeout, message=str(exc))

    if isinstance(exc, APIStatusError):
        code = exc.status_code
        msg = exc.message or ""
        if code == 429:
            return ClassifiedError(reason=ErrorReason.rate_limit, status_code=code, message=msg)
        if code in (503, 529):
            return ClassifiedError(reason=ErrorReason.overloaded, status_code=code, message=msg)
        if code in (500, 502):
            return ClassifiedError(reason=ErrorReason.server_error, status_code=code, message=msg)
        if code in (401, 403):
            return ClassifiedError(reason=ErrorReason.auth, status_code=code, message=msg, retryable=False)
        if code == 400 and ("context" in msg.lower() or "token" in msg.lower()):
            return ClassifiedError(reason=ErrorReason.context_overflow, status_code=code, message=msg)
        return ClassifiedError(reason=ErrorReason.unknown, status_code=code, message=msg)

    return ClassifiedError(reason=ErrorReason.unknown, message=str(exc)[:200])


def jittered_backoff(attempt: int, *, base: float = 2.0, max_delay: float = 30.0) -> float:
    """带抖动的指数退避，防止并发重试雷群效应。"""
    delay = min(base * (2 ** (attempt - 1)), max_delay)
    jitter = random.uniform(0, delay * 0.5)
    return delay + jitter
