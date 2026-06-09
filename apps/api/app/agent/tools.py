"""Generic agent tool definitions and dispatch."""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Callable

from ..utils import to_jsonable

logger = logging.getLogger(__name__)


TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_agent_runtime_status",
            "description": "Get current generic agent runtime status: skills, memory stats, trajectory summary, and model config.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "render_airui_panel",
            "description": "Render a generic AIRUI artifact panel in the operations console.",
            "parameters": {
                "type": "object",
                "properties": {
                    "ref": {"type": "string", "description": "Stable panel reference ID, e.g. 'artifact-plan'."},
                    "title": {"type": "string", "description": "Panel title."},
                    "col_span": {"type": "integer", "description": "Grid width from 1 to 12. Default: 12."},
                    "row_span": {"type": "integer", "description": "Relative panel height. Default: 1."},
                    "content": {
                        "type": "object",
                        "description": "AIRUI component tree, such as Table, Chart, KPI, Row, Column, or Text.",
                    },
                    "session_id": {"type": "string", "description": "AIRUI session ID. Default: 'default'."},
                },
                "required": ["ref", "title", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "patch_airui_panel",
            "description": "Apply JSON Patch operations to the current AIRUI console document.",
            "parameters": {
                "type": "object",
                "properties": {
                    "patches": {
                        "type": "array",
                        "description": "JSON Patch operations, e.g. [{\"op\":\"replace\",\"path\":\"/root/children/0/props/title\",\"value\":\"Done\"}].",
                    },
                    "session_id": {"type": "string", "description": "AIRUI session ID. Default: 'default'."},
                },
                "required": ["patches"],
            },
        },
    },
]


def _runtime_status(args: dict, snapshot: dict | None = None) -> dict[str, Any]:
    from . import config
    from .memory import memory_manager
    from .skills import list_skills, load_skill_usage
    from .trajectory import summarize_trajectories

    return {
        "model": {
            "name": config.LLM_MODEL,
            "base_url": config.LLM_BASE_URL,
            "max_tokens": config.LLM_MAX_TOKENS,
        },
        "skills": list_skills(),
        "skill_usage": load_skill_usage(),
        "memory": memory_manager.stats(),
        "trajectories": summarize_trajectories(),
    }


def _render_airui_panel(args: dict, snapshot: dict | None = None) -> dict[str, Any]:
    from ..airui.renderer import render_console
    from ..airui.session import session_manager
    from ..airui.ws_bridge import push_document

    ref = str(args.get("ref", "")).strip()
    title = str(args.get("title", "")).strip()
    content = args.get("content", {})
    session_id = str(args.get("session_id") or "default")
    col_span = int(args.get("col_span", 12))
    row_span = int(args.get("row_span", 1))

    if not ref:
        return {"status": "error", "message": "ref is required"}
    if not title:
        return {"status": "error", "message": "title is required"}
    if not isinstance(content, dict):
        return {"status": "error", "message": "content must be an AIRUI component object"}
    content = _normalize_airui_component(content)

    sess = session_manager.get_or_create(session_id)
    if not sess.doc:
        sess.doc = render_console()

    doc = sess.doc
    root = doc.setdefault("root", {"type": "Dashboard", "children": []})
    children = root.setdefault("children", [])

    artifact_row = _find_ref(root, "row-artifacts")
    target_children = artifact_row.setdefault("children", []) if artifact_row else children
    _remove_ref(target_children, ref)
    target_children.append({
        "type": "Widget",
        "ref": ref,
        "props": {"title": title, "colSpan": max(1, min(col_span, 12)), "rowSpan": max(1, row_span)},
        "children": [content],
    })

    _run_push(push_document(session_id, doc, title="General Agent Console"))
    return {"status": "rendered", "ref": ref, "session_id": session_id}


def _patch_airui_panel(args: dict, snapshot: dict | None = None) -> dict[str, Any]:
    from ..airui.ws_bridge import push_patch

    patches = args.get("patches", [])
    session_id = str(args.get("session_id") or "default")
    if not isinstance(patches, list):
        return {"status": "error", "message": "patches must be a list"}

    _run_push(push_patch(session_id, patches))
    return {"status": "patched", "patchCount": len(patches), "session_id": session_id}


_HANDLERS: dict[str, Callable[[dict, dict | None], Any]] = {
    "get_agent_runtime_status": _runtime_status,
    "render_airui_panel": _render_airui_panel,
    "patch_airui_panel": _patch_airui_panel,
}


def _sync_execute(name: str, args: dict[str, Any], snapshot: dict | None = None) -> str:
    try:
        handler = _HANDLERS.get(name)
        if not handler:
            return json.dumps({"error": f"Unknown tool: {name}"}, ensure_ascii=False)
        result = handler(args, snapshot)
        return json.dumps(to_jsonable(result), ensure_ascii=False, default=str)
    except Exception as exc:
        logger.warning("Tool %s(%s) failed: %s", name, args, exc)
        return json.dumps({"error": str(exc)}, ensure_ascii=False)


async def execute_tool(
    name: str, args: dict[str, Any], *, snapshot: dict | None = None,
) -> str:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _sync_execute, name, args, snapshot)


def _find_ref(node: dict[str, Any], ref: str) -> dict[str, Any] | None:
    if node.get("ref") == ref:
        return node
    for child in node.get("children", []) or []:
        if isinstance(child, dict):
            found = _find_ref(child, ref)
            if found:
                return found
    return None


def _remove_ref(nodes: list[Any], ref: str) -> None:
    nodes[:] = [node for node in nodes if not (isinstance(node, dict) and node.get("ref") == ref)]


def _run_push(coro) -> None:
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(coro)
    except RuntimeError:
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(coro)
        finally:
            loop.close()


_AIRUI_TYPE_ALIASES = {
    "card": "Widget",
    "panel": "Widget",
    "container": "Column",
    "stack": "Column",
    "vstack": "Column",
    "hstack": "Row",
    "paragraph": "Text",
    "markdown": "Text",
    "heading": "Text",
    "title": "Text",
    "datatable": "Table",
    "dataTable": "Table",
    "metric": "KPI",
    "stat": "KPI",
    "kpi": "KPI",
}

_AIRUI_BUILTIN_TYPES = {
    "Column",
    "Row",
    "Divider",
    "Text",
    "Button",
    "Input",
    "Select",
    "Switch",
    "Checkbox",
    "Radio",
    "Slider",
    "Image",
    "Dropdown",
    "KPI",
    "PlateCard",
    "Gauge",
    "Progress",
    "Tag",
    "Badge",
    "Avatar",
    "Skeleton",
    "Table",
    "Pagination",
    "Chart",
    "Tabs",
    "Breadcrumb",
    "Steps",
    "Modal",
    "Drawer",
    "DropdownMenu",
    "Alert",
    "Loading",
    "ErrorFallback",
    "Tooltip",
    "Dashboard",
    "Widget",
    "Accordion",
    "Timeline",
    "Tree",
}
_AIRUI_CANONICAL_TYPES = {
    name.replace(" ", "").replace("-", "").replace("_", "").lower(): name
    for name in _AIRUI_BUILTIN_TYPES
}


def _normalize_airui_component(node: Any) -> dict[str, Any]:
    if isinstance(node, (str, int, float, bool)):
        return {"type": "Text", "props": {"value": str(node)}}
    if not isinstance(node, dict):
        return {"type": "Text", "props": {"value": ""}}

    normalized = dict(node)
    props = dict(normalized.get("props") or {})
    component_type = _normalize_airui_type(normalized.get("type"), props)

    if component_type == "Table" and "data" not in props and "rows" in props:
        props["data"] = props.pop("rows")
    if component_type == "Text" and "value" not in props:
        props["value"] = props.pop("text", props.pop("content", props.get("label", "")))
    if component_type == "KPI" and "value" not in props and "count" in props:
        props["value"] = props.pop("count")

    children = normalized.get("children")
    if isinstance(children, list):
        normalized["children"] = [_normalize_airui_component(child) for child in children]

    normalized["type"] = component_type
    normalized["props"] = props
    return normalized


def _normalize_airui_type(value: Any, props: dict[str, Any]) -> str:
    raw = str(value or "").strip()
    if not raw:
        if "columns" in props and ("data" in props or "rows" in props):
            return "Table"
        if "value" in props or "count" in props:
            return "KPI"
        return "Text"

    if raw in _AIRUI_BUILTIN_TYPES:
        return raw

    compact = raw.replace(" ", "").replace("-", "").replace("_", "")
    alias = _AIRUI_TYPE_ALIASES.get(raw) or _AIRUI_TYPE_ALIASES.get(compact) or _AIRUI_TYPE_ALIASES.get(compact.lower())
    if alias:
        return alias

    canonical = _AIRUI_CANONICAL_TYPES.get(compact.lower())
    if canonical:
        return canonical

    pascal = compact[:1].upper() + compact[1:].lower()
    if pascal in _AIRUI_BUILTIN_TYPES:
        return pascal

    return "Text"
