"""agent.py 主循环 + 纯函数测试。

mock LLM client + execute_tool，覆盖 chat() 关键路径：
简单回复 / 工具调用循环 / guardrail 阻断 / max_iterations / LLM 异常。
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from openai import APIStatusError
from httpx import Request, Response

from app.agent import agent as agent_module


def _make_msg(content="hi", tool_calls=None, finish_reason="stop"):
    msg = MagicMock()
    msg.content = content
    msg.tool_calls = tool_calls
    msg.model_dump.return_value = {
        "role": "assistant",
        "content": content,
        "tool_calls": tool_calls,
    }
    choice = MagicMock()
    choice.message = msg
    choice.finish_reason = finish_reason
    response = MagicMock()
    response.choices = [choice]
    response.usage = MagicMock(prompt_tokens=10, completion_tokens=5)
    return response


def _make_tool_call(call_id="call_1", name="get_agent_runtime_status", args=None):
    tc = MagicMock()
    tc.id = call_id
    tc.function.name = name
    tc.function.arguments = json.dumps(args or {})
    return tc


def _make_status_error(status_code: int, message: str = "boom") -> APIStatusError:
    request = Request(method="POST", url="https://api.test/v1")
    response = Response(status_code=status_code, request=request)
    return APIStatusError(message=message, response=response, body=None)


@pytest.fixture
def mock_agent(monkeypatch, tmp_path):
    from app.agent import memory as mem_module

    if hasattr(mem_module._local, "conn"):
        mem_module._local.conn = None
    monkeypatch.setattr(mem_module, "DB_PATH", tmp_path / "agent_test.db")
    new_manager = mem_module.MemoryManager()
    monkeypatch.setattr(agent_module, "memory_manager", new_manager)

    monkeypatch.setattr(agent_module.trajectory_recorder, "record", lambda **kw: None)
    monkeypatch.setattr(agent_module.background_review_recorder, "record", lambda **kw: None)
    monkeypatch.setattr(agent_module, "_load_tools", lambda: [])

    monkeypatch.setattr("app.agent.config.LLM_API_KEY", "test-key")
    monkeypatch.setattr("app.agent.config.LLM_BASE_URL", "http://test")
    monkeypatch.setattr("app.agent.config.LLM_MODEL", "test-model")
    monkeypatch.setattr("app.agent.config.LLM_MAX_TOKENS", 1024)
    monkeypatch.setattr("app.agent.config.AGENT_MAX_ITERATIONS", 3)
    monkeypatch.setattr("app.agent.config.RETRY_MAX_ATTEMPTS", 1)
    monkeypatch.setattr("app.agent.config.CONTEXT_WINDOW_TOKENS", 8000)
    monkeypatch.setattr("app.agent.config.reload_config", lambda: None)

    return agent_module.GeneralAgent()


# ── 纯函数 ────────────────────────────────────────────────────


def test_truncate_short_result_unchanged():
    assert agent_module._truncate_tool_result("short") == "short"


def test_truncate_long_string_result_has_marker():
    long = "x" * 10_000
    out = agent_module._truncate_tool_result(long, max_chars=100)
    assert len(out) < len(long)
    assert "truncated" in out


def test_truncate_long_list_keeps_structure():
    data = [{"i": i, "payload": "y" * 200} for i in range(50)]
    out = agent_module._truncate_tool_result(json.dumps(data), max_chars=1000)
    assert "已截断保留前" in out
    parsed = json.loads(out.split("\n[共")[0])
    assert isinstance(parsed, list)


def test_looks_like_tool_error_detects_error_key():
    assert agent_module._looks_like_tool_error('{"error": "fail"}') is True
    assert agent_module._looks_like_tool_error('{"ok": true}') is False
    assert agent_module._looks_like_tool_error("not json") is False


def test_extract_tool_error_returns_message():
    assert agent_module._extract_tool_error('{"error": "nope"}') == "nope"
    assert agent_module._extract_tool_error('{"ok": true}') == ""
    assert agent_module._extract_tool_error("not json") == ""


def test_trajectory_metadata_shape():
    selected = [
        {"slug": "debugging", "source": "explicit", "score": None},
        {"slug": "writing", "source": "auto", "score": 4.5},
    ]
    meta = agent_module._trajectory_metadata(selected)
    assert meta["selected_skills"][0]["slug"] == "debugging"
    assert meta["selected_skills"][1]["score"] == 4.5


# ── chat() 主循环 ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_chat_simple_response(mock_agent):
    mock_agent.client.chat.completions.create = AsyncMock(
        return_value=_make_msg(content="hello world", finish_reason="stop")
    )
    result = await mock_agent.chat([{"role": "user", "content": "hi"}])
    assert result["content"] == "hello world"
    assert result["tool_calls"] == []
    assert result["usage"]["prompt_tokens"] == 10


@pytest.mark.asyncio
async def test_chat_with_tool_calls(mock_agent, monkeypatch):
    tool_call = _make_tool_call(name="get_agent_runtime_status", args={})
    first = _make_msg(content="", tool_calls=[tool_call], finish_reason="tool_calls")
    second = _make_msg(content="done", finish_reason="stop")
    mock_agent.client.chat.completions.create = AsyncMock(side_effect=[first, second])

    async def fake_execute(name, args, *, snapshot=None):
        return json.dumps({"status": "ok"})

    monkeypatch.setattr(agent_module, "execute_tool", fake_execute)

    result = await mock_agent.chat([{"role": "user", "content": "status?"}])
    assert result["content"] == "done"
    assert len(result["tool_calls"]) == 1
    assert result["tool_calls"][0]["name"] == "get_agent_runtime_status"


@pytest.mark.asyncio
async def test_chat_max_iterations(mock_agent, monkeypatch):
    tool_call = _make_tool_call(name="get_agent_runtime_status", args={})
    looping = _make_msg(content="", tool_calls=[tool_call], finish_reason="tool_calls")
    mock_agent.client.chat.completions.create = AsyncMock(return_value=looping)

    async def fake_execute(name, args, *, snapshot=None):
        return '{"status": "ok"}'

    monkeypatch.setattr(agent_module, "execute_tool", fake_execute)

    result = await mock_agent.chat([{"role": "user", "content": "loop"}])
    assert "最大迭代次数" in result["content"]


@pytest.mark.asyncio
async def test_chat_llm_api_error_returns_message(mock_agent):
    mock_agent.client.chat.completions.create = AsyncMock(
        side_effect=_make_status_error(500, "internal error")
    )
    result = await mock_agent.chat([{"role": "user", "content": "hi"}])
    assert "500" in result["content"]
    assert "internal error" in result["content"]


@pytest.mark.asyncio
async def test_chat_guardrail_blocks_repeated_non_idempotent_tool(mock_agent, monkeypatch):
    tool_call = _make_tool_call(name="search_web", args={"q": "x"})
    looping = _make_msg(content="", tool_calls=[tool_call], finish_reason="tool_calls")
    mock_agent.client.chat.completions.create = AsyncMock(return_value=looping)

    call_count = {"n": 0}

    async def fake_execute(name, args, *, snapshot=None):
        call_count["n"] += 1
        return '{"results": []}'

    monkeypatch.setattr(agent_module, "execute_tool", fake_execute)

    await mock_agent.chat([{"role": "user", "content": "search"}])
    # max_iterations=3：每轮 LLM 都返回同一个 search_web tool_call
    # 迭代1: history 空, dup=0 < 2 → 执行 → record
    # 迭代2: dup=1 < 2 → 执行 → record
    # 迭代3: dup=2 >= 2 → guardrail 阻断, 不执行
    assert call_count["n"] == 2
