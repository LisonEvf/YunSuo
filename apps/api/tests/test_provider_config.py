"""对话式 provider 预设管理 — 后端测试。"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# 让 tests/ 能 import app.*
API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.agent import config
from app.agent.provider_presets import BUILTIN_PROVIDER_PRESETS, merge_presets


@pytest.fixture(autouse=True)
def _restore_config():
    """每个测试后用真实 CONFIG_PATH reload，恢复全局 AGENT_CONFIG/LLM_* 常量。"""
    yield
    config.reload_config()


def test_merge_modify_builtin():
    """覆盖层浅合并：改内置 DeepSeek 默认模型。"""
    overlay = [{"key": "deepseek", "defaultModel": "deepseek-v3"}]
    merged = merge_presets(BUILTIN_PROVIDER_PRESETS, overlay)
    ds = next(p for p in merged if p["key"] == "deepseek")
    assert ds["defaultModel"] == "deepseek-v3"
    # 其他字段保留内置值
    assert ds["base_url"] == "https://api.deepseek.com/v1"
    assert ds["name"] == "DeepSeek"


def test_merge_hide_builtin():
    """覆盖层 hidden=true：移除内置 Ollama。"""
    overlay = [{"key": "ollama", "hidden": True}]
    merged = merge_presets(BUILTIN_PROVIDER_PRESETS, overlay)
    assert not any(p["key"] == "ollama" for p in merged)


def test_merge_add_new():
    """覆盖层新增内置没有的 key。"""
    overlay = [{"key": "groq", "name": "Groq", "provider": "openai",
                "base_url": "https://api.groq.com/openai/v1",
                "defaultModel": "llama-3.3-70b", "maxOutputTokens": 4096}]
    merged = merge_presets(BUILTIN_PROVIDER_PRESETS, overlay)
    groq = next(p for p in merged if p["key"] == "groq")
    assert groq["name"] == "Groq"
    assert "hidden" not in groq  # hidden 不应出现在最终结果


def test_merge_restore_default():
    """空覆盖层 = 完全恢复内置。"""
    merged = merge_presets(BUILTIN_PROVIDER_PRESETS, [])
    assert len(merged) == len(BUILTIN_PROVIDER_PRESETS)
    assert [p["key"] for p in merged] == [p["key"] for p in BUILTIN_PROVIDER_PRESETS]
