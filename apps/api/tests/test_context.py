"""context.py 上下文管理测试。"""
from __future__ import annotations

import pytest

from app.agent.context import (
    CHARS_PER_TOKEN,
    COMPRESS_THRESHOLD,
    ContextManager,
    PROTECT_RECENT_TURNS,
)


@pytest.fixture
def ctx(monkeypatch):
    monkeypatch.setattr("app.agent.config.CONTEXT_WINDOW_TOKENS", 1000)
    monkeypatch.setattr("app.agent.config.reload_config", lambda: None)
    return ContextManager()


def test_estimate_tokens_monotonic(ctx):
    short = ctx.estimate_tokens([{"role": "user", "content": "hi"}])
    long = ctx.estimate_tokens([{"role": "user", "content": "x" * 1000}])
    assert short < long


def test_estimate_tokens_handles_list_content(ctx):
    msgs = [{"role": "user", "content": [{"type": "text", "text": "hello world"}]}]
    tokens = ctx.estimate_tokens(msgs)
    assert tokens > 0


def test_should_compress_below_threshold(ctx):
    msgs = [{"role": "user", "content": "short"}]
    assert ctx.should_compress(msgs) is False


def test_should_compress_above_threshold(ctx):
    big_content = "x" * int(1000 * COMPRESS_THRESHOLD * CHARS_PER_TOKEN + 100)
    msgs = [{"role": "user", "content": big_content}]
    assert ctx.should_compress(msgs) is True


def test_should_compress_with_usage_override(ctx):
    assert ctx.should_compress([], usage_tokens=800) is True
    assert ctx.should_compress([], usage_tokens=100) is False


def test_manual_summary_picks_assistant_content(ctx):
    msgs = [
        {"role": "user", "content": "q1"},
        {"role": "assistant", "content": "first answer"},
        {"role": "user", "content": "q2"},
        {"role": "assistant", "content": "second answer"},
    ]
    summary = ctx._manual_summary(msgs)
    assert "first answer" in summary
    assert "second answer" in summary


def test_manual_summary_empty_when_no_assistant(ctx):
    msgs = [{"role": "user", "content": "q"}]
    summary = ctx._manual_summary(msgs)
    assert "已压缩" in summary or "历史" in summary


@pytest.mark.asyncio
async def test_compress_keeps_system_and_recent(ctx, monkeypatch):
    from unittest.mock import AsyncMock
    monkeypatch.setattr(ContextManager, "_summarize", AsyncMock(return_value="SUMMARY"))
    messages = [{"role": "system", "content": "sys"}]
    for i in range(10):
        messages.append({"role": "user", "content": f"q{i}"})
        messages.append({"role": "assistant", "content": f"a{i}"})

    compressed = await ctx.compress(messages)

    assert compressed[0]["role"] == "system"
    assert compressed[0]["content"] == "sys"
    summary_msg = next(m for m in compressed if "上下文摘要" in m.get("content", ""))
    assert "SUMMARY" in summary_msg["content"]
    protect_count = PROTECT_RECENT_TURNS * 2
    recent = [m for m in compressed if m["role"] != "system" and "上下文摘要" not in m.get("content", "")]
    assert len(recent) == protect_count
    assert ctx.compression_count == 1


@pytest.mark.asyncio
async def test_compress_noop_when_too_few(ctx):
    messages = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "q"},
        {"role": "assistant", "content": "a"},
    ]
    compressed = await ctx.compress(messages)
    assert compressed == messages


def test_update_and_get_usage(ctx):
    ctx.update_usage(100, 50)
    ctx.update_usage(200, 80)
    usage = ctx.get_usage()
    assert usage["prompt_tokens"] == 300
    assert usage["completion_tokens"] == 130
    assert usage["total_tokens"] == 430
    assert usage["compression_count"] == 0
    assert usage["context_limit"] == 1000
