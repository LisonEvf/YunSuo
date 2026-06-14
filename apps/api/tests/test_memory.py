"""memory.py 偏好提取 + 否定过滤回归测试。"""
from __future__ import annotations

import pytest

from app.agent import memory as mem_module


@pytest.fixture
def fresh_memory(tmp_path, monkeypatch):
    if hasattr(mem_module._local, "conn"):
        mem_module._local.conn = None
    monkeypatch.setattr(mem_module, "DB_PATH", tmp_path / "test_memory.db")
    return mem_module.MemoryManager()


def _extracted_texts(mgr, user_msg):
    return [r["content"] for r in mgr.search(user_msg) if r["category"] == "user_preference"]


def test_positive_preference_saved(fresh_memory):
    fresh_memory.extract_and_save("我喜欢简洁的输出格式", "")
    texts = _extracted_texts(fresh_memory, "简洁")
    assert any("喜欢简洁" in t for t in texts)


def test_negated_preference_not_saved(fresh_memory):
    fresh_memory.extract_and_save("我不喜欢冗长的解释", "")
    texts = _extracted_texts(fresh_memory, "冗长")
    assert not any("不喜欢冗长" in t for t in texts)


def test_negation_prefix_blocks_save(fresh_memory):
    fresh_memory.extract_and_save("别用表格，我不爱看", "")
    texts = _extracted_texts(fresh_memory, "表格")
    assert not any(t.startswith("别") or t.startswith("不") for t in texts)


def test_is_negated_function():
    assert mem_module._is_negated("我不喜欢冗长") is True
    assert mem_module._is_negated("别啰嗦") is True
    assert mem_module._is_negated("讨厌表格") is True
    assert mem_module._is_negated("我喜欢简洁") is False
    assert mem_module._is_negated("项目用 Python") is False


def test_recent_public_interface(fresh_memory):
    fresh_memory.save("note", "alpha", ["alpha"])
    fresh_memory.save("note", "beta", ["beta"])
    rows = fresh_memory.recent(2)
    assert len(rows) == 2
    assert rows[0]["content"] == "beta"


def test_upsert_updates_same_category(fresh_memory):
    mid = fresh_memory.upsert("style", "v1", ["v1"])
    mid2 = fresh_memory.upsert("style", "v2", ["v2"])
    assert mid == mid2
    rows = fresh_memory.recent(10)
    style_rows = [r for r in rows if r["category"] == "style"]
    assert len(style_rows) == 1
    assert style_rows[0]["content"] == "v2"
