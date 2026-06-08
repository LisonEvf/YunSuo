import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.agent.review import build_background_review
from app.agent.skills import (
    curate_skills,
    load_skill_usage,
    record_skill_usage,
    select_relevant_skills,
)


def test_auto_selects_planning_and_debugging_skills():
    selected = select_relevant_skills("请把这个迁移方案拆解成执行计划和里程碑", limit=2)
    assert selected[0]["slug"] == "task-planning"

    debug = select_relevant_skills("接口报错了，帮我 debug 并定位失败原因", limit=1)
    assert debug[0]["slug"] == "debugging"
    assert debug[0]["source"] == "auto"


def test_explicit_skill_can_disable_autofill():
    selected = select_relevant_skills(
        "帮我写一份说明文档",
        explicit_skills=["code-review"],
        limit=2,
        auto_fill=False,
    )
    assert [item["slug"] for item in selected] == ["code-review"]
    assert selected[0]["source"] == "explicit"


def test_skill_usage_tracker_records_sources(tmp_path):
    usage_path = tmp_path / "skill_usage.json"
    record_skill_usage(
        [{"slug": "task-planning", "name": "task-planning", "source": "auto", "score": 8.0}],
        usage_path=usage_path,
    )

    data = load_skill_usage(usage_path=usage_path)
    stats = data["skills"]["task-planning"]
    assert stats["selected_count"] == 1
    assert stats["viewed_count"] == 1
    assert stats["applied_count"] == 1
    assert stats["auto_count"] == 1
    assert stats["last_score"] == 8.0


def test_curator_reports_unused_skills_without_mutation(tmp_path):
    report = curate_skills(usage_path=tmp_path / "missing.json", dry_run=True)
    assert report["dry_run"] is True
    assert report["checked_skills"] >= 1
    assert any(item["type"] == "unused" for item in report["suggestions"])
    assert not (tmp_path / "missing.json").exists()


def test_background_review_flags_memory_and_skill_candidates():
    review = build_background_review(
        messages=[{"role": "user", "content": "以后都按这个流程做，记住我喜欢先看风险"}],
        tool_events=[
            {"name": f"tool_{idx}", "arguments": {}, "result": "{}"}
            for idx in range(5)
        ],
        final_content="ok",
        selected_skills=[{"slug": "task-planning", "source": "auto", "score": 4.0}],
    )

    assert review["actionable"] is True
    assert review["memory_candidates"][0]["type"] == "user_preference_or_correction"
    assert review["skill_candidates"][0]["type"] == "reusable_workflow"
    assert review["selected_skills"][0]["slug"] == "task-planning"
