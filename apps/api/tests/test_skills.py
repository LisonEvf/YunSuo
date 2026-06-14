"""skills.py 关键纯函数测试。"""
from __future__ import annotations

from app.agent import skills


def test_normalize_slug_basic():
    assert skills._normalize_slug("Task Planning") == "task-planning"
    assert skills._normalize_slug("code_review") == "code-review"
    assert skills._normalize_slug("/Debugging/") == "debugging"


def test_parse_frontmatter():
    content = "---\nname: demo\ndescription: a skill\n---\nbody line 1\nbody line 2"
    meta, body = skills._parse_frontmatter(content)
    assert meta == {"name": "demo", "description": "a skill"}
    assert "body line 1" in body


def test_parse_frontmatter_no_frontmatter():
    content = "just plain markdown\n# heading"
    meta, body = skills._parse_frontmatter(content)
    assert meta == {}
    assert body == content


def test_score_skill_slug_hit_outweighs_keyword():
    info = {
        "slug": "debugging",
        "name": "Debugging",
        "search_text": "debug bug fix reproduce",
    }
    slug_hit = skills._score_skill("请用 debugging 技能", info)
    keyword_hit = skills._score_skill("帮我排查 bug", info)
    assert slug_hit > keyword_hit
    assert slug_hit >= 10.0
    assert keyword_hit > 0


def test_score_skill_empty_query():
    info = {"slug": "x", "name": "X", "search_text": ""}
    assert skills._score_skill("", info) == 0.0


def test_score_skill_keyword_hint_weighted():
    info = {
        "slug": "task-planning",
        "name": "Task Planning",
        "search_text": "plan roadmap milestones",
    }
    score_cn = skills._score_skill("帮我做个规划方案", info)
    score_word = skills._score_skill("plan the roadmap", info)
    assert score_cn >= 4.0
    assert score_word > 0


def test_select_relevant_skills_explicit_always_kept(monkeypatch):
    fake = {
        "/debugging": {"slug": "debugging", "name": "Debugging", "description": "", "search_text": ""},
        "/writing": {"slug": "writing", "name": "Writing", "description": "", "search_text": ""},
    }
    monkeypatch.setattr(skills, "scan_skills", lambda: fake)
    selected = skills.select_relevant_skills("hello", explicit_skills=["debugging"], limit=1)
    assert len(selected) == 1
    assert selected[0]["slug"] == "debugging"
    assert selected[0]["source"] == "explicit"


def test_select_relevant_skills_auto_fill_uses_scoring(monkeypatch):
    fake = {
        "/debugging": {"slug": "debugging", "name": "Debugging", "description": "", "search_text": ""},
        "/writing": {"slug": "writing", "name": "Writing", "description": "", "search_text": ""},
    }
    monkeypatch.setattr(skills, "scan_skills", lambda: fake)
    selected = skills.select_relevant_skills("帮我修复 bug", explicit_skills=None, limit=2)
    assert any(s["slug"] == "debugging" for s in selected)
    assert all(s["source"] == "auto" for s in selected)
