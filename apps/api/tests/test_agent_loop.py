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


# ── chat_stream() 流式 ────────────────────────────────────────


class _FakeStream:
    """模拟 OpenAI stream（async iterator of chunks）。"""

    def __init__(self, chunks):
        self._chunks = list(chunks)
        self._idx = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._idx >= len(self._chunks):
            raise StopAsyncIteration
        chunk = self._chunks[self._idx]
        self._idx += 1
        return chunk


def _make_stream_chunk(content=None, tool_calls=None):
    delta = MagicMock()
    delta.content = content
    delta.tool_calls = tool_calls
    choice = MagicMock()
    choice.delta = delta
    chunk = MagicMock()
    chunk.choices = [choice]
    return chunk


def _make_tool_call_delta(index=0, call_id="call_1", name="fn", arguments="{}"):
    tc = MagicMock()
    tc.index = index
    tc.id = call_id
    tc.function = MagicMock()
    tc.function.name = name
    tc.function.arguments = arguments
    return tc


async def _collect(agen):
    out = []
    async for event in agen:
        out.append(event)
    return out


@pytest.mark.asyncio
async def test_chat_stream_skills_event_emitted_first(mock_agent):
    mock_agent.client.chat.completions.create = AsyncMock(
        return_value=_FakeStream([_make_stream_chunk(content="hi")])
    )
    events = await _collect(mock_agent.chat_stream([{"role": "user", "content": "hi"}]))
    assert events[0]["type"] == "skills"
    assert isinstance(events[0]["skills"], list)
    assert events[-1]["type"] == "done"


@pytest.mark.asyncio
async def test_chat_stream_delta_concatenates(mock_agent):
    chunks = [_make_stream_chunk(content="hello"), _make_stream_chunk(content=" world")]
    mock_agent.client.chat.completions.create = AsyncMock(return_value=_FakeStream(chunks))
    events = await _collect(mock_agent.chat_stream([{"role": "user", "content": "hi"}]))
    deltas = [e["content"] for e in events if e["type"] == "delta"]
    assert "".join(deltas) == "hello world"


@pytest.mark.asyncio
async def test_chat_stream_with_tool_calls(mock_agent, monkeypatch):
    tc_delta = _make_tool_call_delta(name="get_agent_runtime_status", arguments="{}")
    first = _FakeStream([_make_stream_chunk(tool_calls=[tc_delta])])
    second = _FakeStream([_make_stream_chunk(content="done")])
    mock_agent.client.chat.completions.create = AsyncMock(side_effect=[first, second])

    async def fake_execute(name, args, *, snapshot=None):
        return '{"status": "ok"}'

    monkeypatch.setattr(agent_module, "execute_tool", fake_execute)

    events = await _collect(mock_agent.chat_stream([{"role": "user", "content": "status?"}]))
    types = [e["type"] for e in events]
    assert "tool_start" in types
    assert "tool_result" in types
    assert types[-1] == "done"
    tool_start = next(e for e in events if e["type"] == "tool_start")
    assert tool_start["tools"][0]["name"] == "get_agent_runtime_status"


@pytest.mark.asyncio
async def test_chat_stream_airui_inline_event(mock_agent, monkeypatch):
    airui_content = {"type": "table", "props": {"headers": ["a"]}}
    tc_delta = _make_tool_call_delta(
        name="render_airui_panel",
        arguments=json.dumps({"content": airui_content}),
    )
    first = _FakeStream([_make_stream_chunk(tool_calls=[tc_delta])])
    second = _FakeStream([_make_stream_chunk(content="rendered")])
    mock_agent.client.chat.completions.create = AsyncMock(side_effect=[first, second])

    async def fake_execute(name, args, *, snapshot=None):
        return '{"ok": true, "ref": "row-artifacts"}'

    monkeypatch.setattr(agent_module, "execute_tool", fake_execute)

    events = await _collect(mock_agent.chat_stream([{"role": "user", "content": "render"}]))
    airui_events = [e for e in events if e["type"] == "airui"]
    assert len(airui_events) >= 1
    assert airui_events[0]["data"] == airui_content


@pytest.mark.asyncio
async def test_chat_stream_config_changed_event(mock_agent, monkeypatch):
    tc_delta = _make_tool_call_delta(
        name="activate_provider",
        arguments=json.dumps({"provider_id": "p1"}),
    )
    first = _FakeStream([_make_stream_chunk(tool_calls=[tc_delta])])
    second = _FakeStream([_make_stream_chunk(content="switched")])
    mock_agent.client.chat.completions.create = AsyncMock(side_effect=[first, second])

    async def fake_execute(name, args, *, snapshot=None):
        return '{"ok": true}'

    monkeypatch.setattr(agent_module, "execute_tool", fake_execute)
    monkeypatch.setattr("app.agent.config.load_agent_config", lambda: {"model": {}})
    monkeypatch.setattr("app.agent.config.get_merged_presets", lambda cfg: [])

    events = await _collect(mock_agent.chat_stream([{"role": "user", "content": "switch"}]))
    cfg_events = [e for e in events if e["type"] == "config_changed"]
    assert len(cfg_events) >= 1
    assert "config" in cfg_events[0]


@pytest.mark.asyncio
async def test_chat_stream_llm_error_yields_delta_and_done(mock_agent):
    mock_agent.client.chat.completions.create = AsyncMock(
        side_effect=_make_status_error(429, "rate limited")
    )
    events = await _collect(mock_agent.chat_stream([{"role": "user", "content": "hi"}]))
    types = [e["type"] for e in events]
    assert "delta" in types
    assert types[-1] == "done"
    delta_text = "".join(e.get("content", "") for e in events if e["type"] == "delta")
    assert "429" in delta_text


@pytest.mark.asyncio
async def test_chat_stream_max_iterations_reached(mock_agent, monkeypatch):
    def make_looping(**kw):
        tc_delta = _make_tool_call_delta(name="get_agent_runtime_status", arguments="{}")
        return _FakeStream([_make_stream_chunk(tool_calls=[tc_delta])])

    mock_agent.client.chat.completions.create = AsyncMock(side_effect=make_looping)

    async def fake_execute(name, args, *, snapshot=None):
        return '{"status": "ok"}'

    monkeypatch.setattr(agent_module, "execute_tool", fake_execute)

    events = await _collect(mock_agent.chat_stream([{"role": "user", "content": "loop"}]))
    types = [e["type"] for e in events]
    assert types[-1] == "done"
    assert any("最大迭代次数" in e.get("content", "") for e in events if e["type"] == "delta")
