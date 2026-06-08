"""AIRUI renderer for the generic operations console."""
from __future__ import annotations

from typing import Any


def render_console(state: dict[str, Any] | None = None) -> dict[str, Any]:
    """Build the initial AIRUI document for a general agent console."""
    state = state or {}
    runtime = state.get("runtime", {})
    skills = state.get("skills", [])
    memory = state.get("memory", {})
    trajectories = state.get("trajectories", {})

    return {
        "schema": "air-ui@1",
        "viewport": {"width": 1200, "height": 900},
        "state": {
            "mode": "general-agent",
            "status": runtime.get("status", "ready"),
            "sessionId": state.get("session_id", "default"),
        },
        "root": {
            "type": "Dashboard",
            "props": {"columns": 12, "rowGap": 12, "columnGap": 12},
            "children": [
                _build_status_row(runtime, skills, memory, trajectories),
                _build_timeline_row(state.get("timeline", [])),
                _build_artifact_row(state.get("artifacts", [])),
                _build_inspector_row(skills, memory, trajectories),
            ],
        },
    }


def _widget(ref: str, title: str, col_span: int, child: dict | None = None, row_span: int = 1) -> dict:
    return {
        "type": "Widget",
        "ref": ref,
        "props": {"title": title, "colSpan": col_span, "rowSpan": row_span},
        "children": [child] if child else [],
    }


def _kpi(ref: str, label: str, value: Any, suffix: str = "") -> dict[str, Any]:
    return {"type": "KPI", "ref": ref, "props": {"label": label, "value": value, "suffix": suffix}}


def _build_status_row(runtime: dict, skills: list, memory: dict, trajectories: dict) -> dict:
    children = [
        _widget("kpi-status", "Runtime", 3, _kpi("kpi-status-value", "Status", runtime.get("status", "ready"))),
        _widget("kpi-skills", "Skills", 3, _kpi("kpi-skills-value", "Available", len(skills))),
        _widget("kpi-memory", "Memory", 3, _kpi("kpi-memory-value", "Entries", memory.get("total", 0))),
        _widget("kpi-trajectories", "Trajectories", 3, _kpi("kpi-trajectory-value", "Samples", trajectories.get("total", 0))),
    ]
    return {"type": "Row", "ref": "row-status", "props": {"colSpan": 12}, "children": children}


def _build_timeline_row(timeline: list[dict[str, Any]]) -> dict:
    rows = timeline or [
        {"step": "Ready", "status": "idle", "detail": "Send a message to start an agent run."},
        {"step": "Skill selection", "status": "waiting", "detail": "Relevant skills will appear after a request."},
        {"step": "Tool calls", "status": "waiting", "detail": "Generic tool results are shown here."},
    ]
    table = {
        "type": "Table",
        "props": {
            "columns": [
                {"key": "step", "label": "Step", "width": 120},
                {"key": "status", "label": "Status", "width": 80},
                {"key": "detail", "label": "Detail", "width": 360},
            ],
            "data": rows,
        },
    }
    return {
        "type": "Row",
        "ref": "row-timeline",
        "props": {"colSpan": 12},
        "children": [_widget("table-run-timeline", "Run Timeline", 12, table)],
    }


def _build_artifact_row(artifacts: list[dict[str, Any]]) -> dict:
    children: list[dict[str, Any]] = []
    if artifacts:
        children.extend(artifacts)
    else:
        children.append(_widget(
            "artifact-empty",
            "Artifacts",
            12,
            {
                "type": "Table",
                "props": {
                    "columns": [
                        {"key": "name", "label": "Artifact"},
                        {"key": "state", "label": "State"},
                        {"key": "detail", "label": "Detail"},
                    ],
                    "data": [{"name": "No artifact yet", "state": "empty", "detail": "Rendered panels will appear here."}],
                },
            },
        ))
    return {"type": "Row", "ref": "row-artifacts", "props": {"colSpan": 12}, "children": children}


def _build_inspector_row(skills: list, memory: dict, trajectories: dict) -> dict:
    skill_rows = [
        {"slug": item.get("slug", ""), "name": item.get("name", ""), "description": item.get("description", "")}
        for item in skills[:8]
        if isinstance(item, dict)
    ]
    if not skill_rows:
        skill_rows = [{"slug": "-", "name": "No skills loaded", "description": "Create or enable generic skills."}]

    skills_table = {
        "type": "Table",
        "props": {
            "columns": [
                {"key": "slug", "label": "Slug", "width": 90},
                {"key": "name", "label": "Name", "width": 120},
                {"key": "description", "label": "Description", "width": 280},
            ],
            "data": skill_rows,
        },
    }
    memory_table = {
        "type": "Table",
        "props": {
            "columns": [{"key": "metric", "label": "Metric"}, {"key": "value", "label": "Value"}],
            "data": [
                {"metric": "Memory entries", "value": memory.get("total", 0)},
                {"metric": "Trajectory samples", "value": trajectories.get("total", 0)},
                {"metric": "Failed trajectories", "value": trajectories.get("failed", 0)},
            ],
        },
    }
    return {
        "type": "Row",
        "ref": "row-inspector",
        "props": {"colSpan": 12},
        "children": [
            _widget("table-active-skills", "Active Skills", 6, skills_table),
            _widget("table-runtime-inspector", "Memory & Trajectory", 6, memory_table),
        ],
    }
