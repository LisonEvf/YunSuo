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


def test_get_merged_presets_uses_overlay():
    """get_merged_presets 从给定 cfg 的覆盖层合并。"""
    cfg = {"provider_presets": [{"key": "deepseek", "defaultModel": "deepseek-v3"}]}
    merged = config.get_merged_presets(cfg)
    ds = next(p for p in merged if p["key"] == "deepseek")
    assert ds["defaultModel"] == "deepseek-v3"


def test_get_merged_presets_empty_overlay():
    cfg = {"provider_presets": []}
    merged = config.get_merged_presets(cfg)
    assert len(merged) == len(BUILTIN_PROVIDER_PRESETS)


def test_config_get_returns_merged_presets(monkeypatch, tmp_path):
    """/api/config 返回的 provider_presets 是合并后的完整列表。"""
    cfg_file = tmp_path / "agent.json"
    cfg_file.write_text(
        '{"model": {"provider": "openai", "name": "x", "base_url": "http://x/v1", '
        '"api_key": "k", "max_output_tokens": 4096, "display_name": ""}, '
        '"provider_presets": [{"key": "ollama", "hidden": true}]}',
        encoding="utf-8",
    )
    monkeypatch.setattr(config, "CONFIG_PATH", cfg_file)
    config.reload_config()

    # 直接调用路由函数（无参数，返回 dict），避免引入 TestClient/httpx 依赖
    from app.main import get_config
    out = get_config()
    presets = out["config"]["provider_presets"]
    # ollama 被 hidden，不应出现
    assert not any(p["key"] == "ollama" for p in presets)
    # 内置总数 = 11 - 1(ollama)
    assert len(presets) == len(BUILTIN_PROVIDER_PRESETS) - 1
