"""Lightweight post-turn review scaffolding.

This is a deterministic entry point for the Hermes-style background review
loop. It records candidates for later memory/skill curation without mutating
memory, skills, or prompts in the foreground chat path.
"""
from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[4]
REVIEW_DIR = PROJECT_ROOT / "data" / "reviews"
BACKGROUND_REVIEW_FILE = "background_reviews.jsonl"

_MEMORY_SIGNALS = (
    "记住", "以后", "下次", "别", "不要", "我喜欢", "我偏好", "我习惯", "按我的", "纠正",
)
_SKILL_SIGNALS = (
    "流程", "步骤", "模板", "清单", "复盘", "以后都", "每次都", "固定", "规范",
)


class BackgroundReviewRecorder:
    """Append actionable post-turn review notes as JSONL."""

    def __init__(self, base_dir: Path = REVIEW_DIR):
        self.base_dir = base_dir
        self._lock = threading.Lock()

    def record(
        self,
        *,
        messages: list[dict[str, Any]],
        tool_events: list[dict[str, Any]],
        final_content: str,
        selected_skills: list[dict[str, Any]] | None = None,
        completed: bool = True,
    ) -> Path | None:
        review = build_background_review(
            messages=messages,
            tool_events=tool_events,
            final_content=final_content,
            selected_skills=selected_skills,
            completed=completed,
        )
        if not review["actionable"]:
            return None

        self.base_dir.mkdir(parents=True, exist_ok=True)
        path = self.base_dir / BACKGROUND_REVIEW_FILE
        line = json.dumps(review, ensure_ascii=False, default=str)
        with self._lock:
            with path.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        return path


def build_background_review(
    *,
    messages: list[dict[str, Any]],
    tool_events: list[dict[str, Any]],
    final_content: str,
    selected_skills: list[dict[str, Any]] | None = None,
    completed: bool = True,
) -> dict[str, Any]:
    """Build deterministic review candidates for future async reviewers."""
    user_message = _last_user_message(messages)
    tool_failures = [event for event in tool_events if event.get("error")]
    memory_candidates = []
    skill_candidates = []
    quality_flags = []

    if _contains_any(user_message, _MEMORY_SIGNALS):
        memory_candidates.append({
            "type": "user_preference_or_correction",
            "reason": "User message contains a preference, future instruction, or correction signal.",
            "evidence": user_message[:240],
        })

    if _contains_any(user_message, _SKILL_SIGNALS) or len(tool_events) >= 5:
        skill_candidates.append({
            "type": "reusable_workflow",
            "reason": "Turn may contain a repeatable workflow worth extracting or refining.",
            "tool_count": len(tool_events),
        })

    if tool_failures:
        quality_flags.append({
            "type": "tool_failure",
            "count": len(tool_failures),
            "tools": sorted({str(event.get("name") or "unknown") for event in tool_failures}),
        })

    if completed and not final_content.strip():
        quality_flags.append({"type": "empty_final_response"})
    if not completed:
        quality_flags.append({"type": "incomplete_turn"})

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "completed": completed,
        "actionable": bool(memory_candidates or skill_candidates or quality_flags),
        "selected_skills": [
            {
                "slug": item.get("slug"),
                "source": item.get("source"),
                "score": item.get("score"),
            }
            for item in selected_skills or []
        ],
        "memory_candidates": memory_candidates,
        "skill_candidates": skill_candidates,
        "quality_flags": quality_flags,
    }


def _last_user_message(messages: list[dict[str, Any]]) -> str:
    for msg in reversed(messages):
        if msg.get("role") == "user":
            return str(msg.get("content") or "")
    return ""


def _contains_any(text: str, needles: tuple[str, ...]) -> bool:
    return any(needle in text for needle in needles)


background_review_recorder = BackgroundReviewRecorder()
