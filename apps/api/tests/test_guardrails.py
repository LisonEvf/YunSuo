"""ToolGuardrails 防护逻辑测试。"""
from __future__ import annotations

from app.agent.guardrails import (
    IDEMPOTENT_TOOLS,
    MAX_CALLS_PER_TOOL,
    MAX_DUPLICATE_CALLS,
    ToolGuardrails,
)


def test_idempotent_tool_passes_repeated_calls():
    g = ToolGuardrails()
    name = "render_airui_panel"
    assert name in IDEMPOTENT_TOOLS
    args = {"ref": "row-artifacts"}
    for _ in range(MAX_DUPLICATE_CALLS + 1):
        assert g.check(name, args).allows_execution
        g.record(name, args)


def test_non_idempotent_tool_blocks_after_duplicate_limit():
    g = ToolGuardrails()
    name = "search_web"
    args = {"q": "fastapi"}
    assert name not in IDEMPOTENT_TOOLS
    for _ in range(MAX_DUPLICATE_CALLS):
        assert g.check(name, args).allows_execution
        g.record(name, args)
    decision = g.check(name, args)
    assert not decision.allows_execution
    assert "相同参数" in decision.reason


def test_non_idempotent_tool_allows_different_args():
    g = ToolGuardrails()
    name = "search_web"
    g.record(name, {"q": "a"})
    g.record(name, {"q": "a"})
    assert g.check(name, {"q": "b"}).allows_execution


def test_tool_count_limit():
    g = ToolGuardrails()
    name = "render_airui_panel"
    for _ in range(MAX_CALLS_PER_TOOL):
        g.record(name, {"i": _})
    decision = g.check(name, {"i": 99})
    assert not decision.allows_execution
    assert "上限" in decision.reason


def test_reset_turn_clears_history():
    g = ToolGuardrails()
    g.record("search_web", {"q": "a"})
    g.record("search_web", {"q": "a"})
    g.reset_turn()
    assert g.check("search_web", {"q": "a"}).allows_execution
