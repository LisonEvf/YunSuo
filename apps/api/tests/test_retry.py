"""retry.py 错误分类 + 退避策略测试。"""
from __future__ import annotations

import pytest

from app.agent.retry import (
    ErrorReason,
    classify_error,
    jittered_backoff,
)


def _make_status_error(status_code: int, message: str = ""):
    from openai import APIStatusError
    from httpx import Request, Response

    request = Request(method="POST", url="https://api.test/v1")
    response = Response(status_code=status_code, request=request)
    return APIStatusError(message=message, response=response, body=None)


def test_timeout_classified_as_retryable():
    from openai import APITimeoutError
    from httpx import Request

    request = Request(method="POST", url="https://api.test/v1")
    err = APITimeoutError(request=request)
    result = classify_error(err)
    assert result.reason is ErrorReason.timeout
    assert result.retryable is True


@pytest.mark.parametrize(
    "status_code,expected",
    [
        (429, ErrorReason.rate_limit),
        (503, ErrorReason.overloaded),
        (529, ErrorReason.overloaded),
        (500, ErrorReason.server_error),
        (502, ErrorReason.server_error),
    ],
)
def test_retryable_status_codes(status_code, expected):
    err = _make_status_error(status_code)
    result = classify_error(err)
    assert result.reason is expected
    assert result.retryable is True


def test_auth_not_retryable():
    err = _make_status_error(401)
    result = classify_error(err)
    assert result.reason is ErrorReason.auth
    assert result.retryable is False


def test_context_overflow_detected():
    err = _make_status_error(400, message="this model's maximum context length is exceeded")
    result = classify_error(err)
    assert result.reason is ErrorReason.context_overflow


def test_unknown_error_falls_back():
    err = RuntimeError("something weird happened")
    result = classify_error(err)
    assert result.reason is ErrorReason.unknown


def test_jittered_backoff_bounds():
    for attempt in range(1, 6):
        delay = jittered_backoff(attempt, base=2.0, max_delay=30.0)
        expected_base = min(2.0 * (2 ** (attempt - 1)), 30.0)
        assert expected_base <= delay <= expected_base * 1.5


def test_jittered_backoff_caps_at_max():
    for attempt in (10, 20, 100):
        delay = jittered_backoff(attempt)
        assert delay <= 30.0 * 1.5
