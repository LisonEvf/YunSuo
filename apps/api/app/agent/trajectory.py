"""Agent trajectory recording.

Each completed or failed conversation is appended as JSONL so later review,
replay, or training-data preparation has a concrete execution trace.
"""
from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

TRAJECTORY_DIR = Path(__file__).resolve().parents[4] / "data" / "trajectories"
SUCCESS_FILE = "trajectory_samples.jsonl"
FAILED_FILE = "failed_trajectories.jsonl"


class TrajectoryRecorder:
    """Persist ShareGPT-like agent trajectories to disk."""

    def __init__(self, base_dir: Path = TRAJECTORY_DIR):
        self.base_dir = base_dir
        self._lock = threading.Lock()

    def record(
        self,
        *,
        system_prompt: str,
        input_messages: list[dict[str, Any]],
        tool_events: list[dict[str, Any]],
        final_content: str,
        model: str,
        completed: bool,
        stream: bool = False,
        error: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Path:
        """Append one trajectory record and return the written JSONL path."""
        record = {
            "conversations": self._build_conversations(
                system_prompt=system_prompt,
                input_messages=input_messages,
                tool_events=tool_events,
                final_content=final_content,
            ),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "model": model,
            "completed": completed,
            "stream": stream,
            "tool_stats": self._tool_stats(tool_events),
            "metadata": metadata or {},
        }
        if error:
            record["error"] = error

        self.base_dir.mkdir(parents=True, exist_ok=True)
        path = self.base_dir / (SUCCESS_FILE if completed else FAILED_FILE)
        line = json.dumps(record, ensure_ascii=False, default=str)
        with self._lock:
            with path.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        return path

    @staticmethod
    def _build_conversations(
        *,
        system_prompt: str,
        input_messages: list[dict[str, Any]],
        tool_events: list[dict[str, Any]],
        final_content: str,
    ) -> list[dict[str, Any]]:
        conversations: list[dict[str, Any]] = []
        if system_prompt:
            conversations.append({"from": "system", "value": system_prompt})

        for msg in input_messages:
            role = msg.get("role", "")
            content = msg.get("content", "")
            if not content:
                continue
            conversations.append({"from": _role_to_sharegpt(role), "value": str(content)})

        for event in tool_events:
            name = event.get("name", "unknown")
            arguments = event.get("arguments", {})
            result = event.get("result", "")
            conversations.append({
                "from": "gpt",
                "value": f"<tool_call name=\"{name}\">{json.dumps(arguments, ensure_ascii=False, default=str)}</tool_call>",
            })
            conversations.append({
                "from": "tool",
                "value": f"<tool_response name=\"{name}\">{result}</tool_response>",
            })

        if final_content:
            conversations.append({"from": "gpt", "value": final_content})
        return conversations

    @staticmethod
    def _tool_stats(tool_events: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
        stats: dict[str, dict[str, int]] = {}
        for event in tool_events:
            name = str(event.get("name") or "unknown")
            bucket = stats.setdefault(name, {"count": 0, "success": 0, "failure": 0})
            bucket["count"] += 1
            if event.get("error"):
                bucket["failure"] += 1
            else:
                bucket["success"] += 1
        return stats


def iter_trajectories(
    *,
    base_dir: Path = TRAJECTORY_DIR,
    completed: bool | None = None,
):
    """Yield trajectory records from success/failure JSONL files."""
    for path in _trajectory_paths(base_dir, completed=completed):
        if not path.exists():
            continue
        with path.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if completed is not None and bool(record.get("completed")) is not completed:
                    continue
                yield record


def load_trajectories(
    *,
    base_dir: Path = TRAJECTORY_DIR,
    completed: bool | None = None,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for record in iter_trajectories(base_dir=base_dir, completed=completed):
        records.append(record)
        if limit is not None and len(records) >= limit:
            break
    return records


def export_trajectory_samples(
    output_path: Path,
    *,
    base_dir: Path = TRAJECTORY_DIR,
    completed_only: bool = True,
    limit: int | None = None,
    min_tool_calls: int = 0,
) -> Path:
    """Export filtered trajectory samples as JSONL for offline evaluation."""
    completed_filter = True if completed_only else None
    exported = 0
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as fh:
        for record in iter_trajectories(base_dir=base_dir, completed=completed_filter):
            if _tool_call_count(record) < min_tool_calls:
                continue
            fh.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
            exported += 1
            if limit is not None and exported >= limit:
                break
    return output_path


def summarize_trajectories(*, base_dir: Path = TRAJECTORY_DIR) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "total": 0,
        "completed": 0,
        "failed": 0,
        "streamed": 0,
        "tool_calls": 0,
        "tool_failures": 0,
        "by_model": {},
        "selected_skills": {},
    }
    for record in iter_trajectories(base_dir=base_dir, completed=None):
        summary["total"] += 1
        if record.get("completed"):
            summary["completed"] += 1
        else:
            summary["failed"] += 1
        if record.get("stream"):
            summary["streamed"] += 1

        model = str(record.get("model") or "unknown")
        summary["by_model"][model] = summary["by_model"].get(model, 0) + 1

        for stats in record.get("tool_stats", {}).values():
            if isinstance(stats, dict):
                summary["tool_calls"] += int(stats.get("count", 0))
                summary["tool_failures"] += int(stats.get("failure", 0))

        metadata = record.get("metadata", {})
        for selected in metadata.get("selected_skills", []) if isinstance(metadata, dict) else []:
            slug = selected.get("slug") if isinstance(selected, dict) else None
            if slug:
                summary["selected_skills"][slug] = summary["selected_skills"].get(slug, 0) + 1
    return summary


def _trajectory_paths(base_dir: Path, *, completed: bool | None) -> list[Path]:
    if completed is True:
        return [base_dir / SUCCESS_FILE]
    if completed is False:
        return [base_dir / FAILED_FILE]
    return [base_dir / SUCCESS_FILE, base_dir / FAILED_FILE]


def _tool_call_count(record: dict[str, Any]) -> int:
    total = 0
    for stats in record.get("tool_stats", {}).values():
        if isinstance(stats, dict):
            total += int(stats.get("count", 0))
    return total


def _role_to_sharegpt(role: str) -> str:
    if role == "user":
        return "human"
    if role == "assistant":
        return "gpt"
    return role or "unknown"


trajectory_recorder = TrajectoryRecorder()
