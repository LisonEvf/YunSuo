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


def test_auto_selects_position_and_plate_skills():
    selected = select_relevant_skills("今天应该几成仓位，怎么做风险控制？", limit=2)
    assert selected[0]["slug"] == "position-advice"
    assert any(item["slug"] == "risk-control" for item in selected)

    plate = select_relevant_skills("帮我看板块轮动和主线方向", limit=1)
    assert plate[0]["slug"] == "plate-rotation"
    assert plate[0]["source"] == "auto"


def test_explicit_skill_can_disable_autofill():
    selected = select_relevant_skills(
        "分析今天市场情绪",
        explicit_skills=["risk-control"],
        limit=2,
        auto_fill=False,
    )
    assert [item["slug"] for item in selected] == ["risk-control"]
    assert selected[0]["source"] == "explicit"


def test_skill_usage_tracker_records_sources(tmp_path):
    usage_path = tmp_path / "skill_usage.json"
    record_skill_usage(
        [{"slug": "position-advice", "name": "position-advice", "source": "auto", "score": 8.0}],
        usage_path=usage_path,
    )

    data = load_skill_usage(usage_path=usage_path)
    stats = data["skills"]["position-advice"]
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
        messages=[{"role": "user", "content": "以后都按这个流程做，记住我喜欢低吸"}],
        tool_events=[
            {"name": f"tool_{idx}", "arguments": {}, "result": "{}"}
            for idx in range(5)
        ],
        final_content="ok",
        selected_skills=[{"slug": "trade-plan", "source": "auto", "score": 4.0}],
    )

    assert review["actionable"] is True
    assert review["memory_candidates"][0]["type"] == "user_preference_or_correction"
    assert review["skill_candidates"][0]["type"] == "reusable_workflow"
    assert review["selected_skills"][0]["slug"] == "trade-plan"
