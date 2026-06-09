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
    {
        "type": "function",
        "function": {
            "name": "get_provider_config",
            "description": "Read current LLM provider preset templates (merged builtin + user overlay), saved provider instances (api_key masked), and the active provider id. Use this before modifying provider config.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_provider_presets",
            "description": "Replace the user provider-preset overlay (full list). Each entry: {key, name, provider, base_url, defaultModel, maxOutputTokens, ...}; add hidden:true to hide a builtin entry. Builtin defaults remain restorable by clearing the overlay. api_key is NOT allowed in presets.",
            "parameters": {
                "type": "object",
                "properties": {
                    "presets": {"type": "array", "description": "Full overlay list replacing the previous one."},
                },
                "required": ["presets"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_providers",
            "description": "Replace the full saved provider instance list. Each instance: {id, name, provider, base_url, api_key, model_name, max_output_tokens}. If the active id is removed, active_provider_id becomes null. Does NOT change the active id otherwise.",
            "parameters": {
                "type": "object",
                "properties": {
                    "providers": {"type": "array", "description": "Full instance list replacing the previous one."},
                },
                "required": ["providers"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "activate_provider",
            "description": "Activate a saved provider instance by id (affects the model used in the next conversation). Pass null to deactivate and fall back to the model field.",
            "parameters": {
                "type": "object",
                "properties": {
                    "provider_id": {"type": ["string", "null"], "description": "Instance id to activate, or null to deactivate."},
                },
                "required": ["provider_id"],
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

    _run_push(push_document(session_id, doc, title="云梭 Yunsuo"))
    return {"status": "rendered", "ref": ref, "session_id": session_id}


def _patch_airui_panel(args: dict, snapshot: dict | None = None) -> dict[str, Any]:
    from ..airui.ws_bridge import push_patch

    patches = args.get("patches", [])
    session_id = str(args.get("session_id") or "default")
    if not isinstance(patches, list):
        return {"status": "error", "message": "patches must be a list"}

    _run_push(push_patch(session_id, patches))
    return {"status": "patched", "patchCount": len(patches), "session_id": session_id}


def _mask_api_key(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 8:
        return "***"
    return f"{key[:3]}***{key[-4:]}"


def _mask_provider(p: dict) -> dict:
    out = dict(p)
    if "api_key" in out:
        out["api_key"] = _mask_api_key(str(out.get("api_key") or ""))
    return out


def _validate_presets(presets) -> str | None:
    """校验覆盖层；返回错误信息或 None。"""
    if not isinstance(presets, list):
        return "presets must be a list"
    from urllib.parse import urlparse

    seen: set[str] = set()
    for p in presets:
        if not isinstance(p, dict) or not p.get("key"):
            return "each preset must have a 'key'"
        key = str(p["key"])
        if key in seen:
            return f"duplicate preset key: {key}"
        seen.add(key)
        if p.get("hidden"):
            continue
        for field in ("name", "base_url", "defaultModel"):
            if not p.get(field):
                return f"preset {key} missing required field: {field}"
        if p.get("provider") != "openai":
            return f"preset {key}: provider must be 'openai' (only OpenAI-compatible)"
        try:
            u = urlparse(str(p["base_url"]))
            if u.scheme not in ("http", "https") or not u.netloc:
                return f"preset {key}: invalid base_url"
        except Exception:
            return f"preset {key}: invalid base_url"
    return None


def _get_provider_config(args: dict, snapshot: dict | None = None) -> dict[str, Any]:
    from .config import load_agent_config, get_merged_presets
    from .provider_presets import BUILTIN_PROVIDER_PRESETS

    cfg = load_agent_config()
    providers = cfg.get("providers") or []
    return {
        "provider_presets": get_merged_presets(cfg),
        "builtin_preset_keys": [p["key"] for p in BUILTIN_PROVIDER_PRESETS],
        "providers": [_mask_provider(p) for p in providers],
        "active_provider_id": cfg.get("active_provider_id"),
    }


def _update_provider_presets(args: dict, snapshot: dict | None = None) -> dict[str, Any]:
    from .config import load_agent_config, save_agent_config, get_merged_presets

    presets = args.get("presets")
    err = _validate_presets(presets)
    if err:
        return {"status": "error", "message": err}
    cfg = load_agent_config()
    cfg["provider_presets"] = presets
    save_agent_config(cfg)
    return {"status": "ok", "provider_presets": get_merged_presets(cfg)}


def _validate_providers(providers) -> str | None:
    if not isinstance(providers, list):
        return "providers must be a list"
    seen: set[str] = set()
    for p in providers:
        if not isinstance(p, dict):
            return "each provider must be an object"
        for field in ("id", "name", "base_url", "model_name"):
            if not p.get(field):
                return f"provider missing required field: {field}"
        pid = str(p["id"])
        if pid in seen:
            return f"duplicate provider id: {pid}"
        seen.add(pid)
        if p.get("provider") != "openai":
            return f"provider {pid}: provider must be 'openai'"
        mot = p.get("max_output_tokens")
        if not isinstance(mot, int) or isinstance(mot, bool) or mot <= 0:
            return f"provider {pid}: max_output_tokens must be a positive integer"
    return None


def _update_providers(args: dict, snapshot: dict | None = None) -> dict[str, Any]:
    from .config import load_agent_config, save_agent_config

    providers = args.get("providers")
    err = _validate_providers(providers)
    if err:
        return {"status": "error", "message": err}
    cfg = load_agent_config()
    cfg["providers"] = providers
    active_id = cfg.get("active_provider_id")
    if active_id and not any(p.get("id") == active_id for p in providers):
        cfg["active_provider_id"] = None
    save_agent_config(cfg)
    return {
        "status": "ok",
        "providers": [_mask_provider(p) for p in providers],
        "active_provider_id": cfg.get("active_provider_id"),
    }


def _activate_provider(args: dict, snapshot: dict | None = None) -> dict[str, Any]:
    from . import config as _config
    from .agent import reset_agent  # app/agent/agent.py 模块（延迟导入，避免与 agent.py 循环）
    from .memory import memory_manager

    provider_id = args.get("provider_id")  # None = 取消激活
    cfg = _config.load_agent_config()
    providers = cfg.get("providers") or []
    if provider_id is not None and not any(p.get("id") == provider_id for p in providers):
        return {"status": "error", "message": f"provider not found: {provider_id}"}

    cfg["active_provider_id"] = provider_id
    # 关键：先让 model 同步为目标实例，再 save。
    # 否则 save_agent_config 的 _sync_model_to_active 会用旧 model 反向覆盖目标实例。
    _config._sync_active_to_model(cfg)
    _config.save_agent_config(cfg)
    reset_agent()

    if provider_id:
        inst = next((p for p in providers if p.get("id") == provider_id), None)
        if inst:
            content = f"用户当前激活的 provider: {inst.get('name', '')} / {inst.get('model_name', '')}"
            try:
                memory_manager.upsert("provider_preference", content)
            except Exception as exc:
                logger.warning("provider_preference upsert failed: %s", exc)
    return {"status": "ok", "active_provider_id": provider_id}


_HANDLERS: dict[str, Callable[[dict, dict | None], Any]] = {
    "get_agent_runtime_status": _runtime_status,
    "render_airui_panel": _render_airui_panel,
    "patch_airui_panel": _patch_airui_panel,
    "get_provider_config": _get_provider_config,
    "update_provider_presets": _update_provider_presets,
    "update_providers": _update_providers,
    "activate_provider": _activate_provider,
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
    "heading": "Text",
    "title": "Text",
    "markdown": "Markdown",
    "code": "CodeBlock",
    "codeblock": "CodeBlock",
    "datatable": "Table",
    "dataTable": "Table",
    "datagrid": "DataGrid",
    "data-grid": "DataGrid",
    "metric": "KPI",
    "stat": "KPI",
    "kpi": "KPI",
    "video-player": "Video",
    "videoplayer": "Video",
    "audio-player": "Audio",
    "audioplayer": "Audio",
    "pdf": "PDFViewer",
    "pdfviewer": "PDFViewer",
    "pdf-viewer": "PDFViewer",
    "empty": "EmptyState",
    "empty-state": "EmptyState",
    "command": "CommandPalette",
    "commandpalette": "CommandPalette",
    "command-palette": "CommandPalette",
    "context-menu": "ContextMenu",
    "contextmenu": "ContextMenu",
    "top-nav": "TopNav",
    "topnav": "TopNav",
    "app-shell": "AppShell",
    "appshell": "AppShell",
    "split-pane": "SplitPane",
    "splitpane": "SplitPane",
    "scroll-area": "ScrollArea",
    "scrollarea": "ScrollArea",
    "number": "NumberInput",
    "numberinput": "NumberInput",
    "number-input": "NumberInput",
    "textarea": "Textarea",
    "date": "DatePicker",
    "date-picker": "DatePicker",
    "time": "TimePicker",
    "time-picker": "TimePicker",
    "date-range": "DateRangePicker",
    "date-range-picker": "DateRangePicker",
    "daterange": "DateRangePicker",
    "multiselect": "MultiSelect",
    "multi-select": "MultiSelect",
    "upload": "FileUpload",
    "file-upload": "FileUpload",
    "fileupload": "FileUpload",
    "rich-text": "RichText",
    "richtext": "RichText",
    "network": "NetworkGraph",
    "network-graph": "NetworkGraph",
    "networkgraph": "NetworkGraph",
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
    "Form",
    "Textarea",
    "DatePicker",
    "TimePicker",
    "DateRangePicker",
    "NumberInput",
    "Autocomplete",
    "MultiSelect",
    "FileUpload",
    "Video",
    "Audio",
    "ImageGallery",
    "Carousel",
    "Lightbox",
    "PDFViewer",
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
    "DataGrid",
    "EmptyState",
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
    "Toast",
    "Notification",
    "Popconfirm",
    "ContextMenu",
    "CommandPalette",
    "Dashboard",
    "Widget",
    "Accordion",
    "Timeline",
    "Tree",
    "AppShell",
    "Sidebar",
    "TopNav",
    "Toolbar",
    "SplitPane",
    "ScrollArea",
    "Markdown",
    "CodeBlock",
    "RichText",
    "Icon",
    "Calendar",
    "Kanban",
    "Map",
    "NetworkGraph",
    "Heatmap",
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
