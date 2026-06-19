"""Home widgets: resolve a live-MCP widget spec into an AIRUI component.

A widget declares a tool target (an MCP tool, addressed by its prefixed
'mcp_<server>_<tool>' name) and display hints (kind / path / columns / ...).
This module calls the tool directly -- no LLM -- and normalizes the JSON result
into an AIRUI component (Table / KPI / Text) so the custom start page can show
live data instead of static launcher buttons.

Normalization is deliberately defensive: any failure degrades to a small text
card, so one broken widget never blanks the whole home.
"""
from __future__ import annotations

import json
from typing import Any

from .agent.mcp_client import call as _mcp_call
from .agent.mcp_client import status as _mcp_status


def _ensure_loaded() -> None:
    """Connect configured MCP servers if none are registered yet.

    MCP servers normally connect during agent init, which is gated on a
    configured LLM. Live home widgets should not depend on an LLM, so we prime
    the registry directly from saved config when it is empty. Safe to call
    repeatedly: it only loads when no servers are present.
    """
    try:
        if _mcp_status():
            return
        from .agent.mcp_client import load_all as _load_all

        _load_all()
    except Exception:
        # best-effort; resolve_widget will degrade per-widget on its own
        pass


# -- payload decoding -------------------------------------------------

def _decode_values(text: str) -> list:
    """Decode every top-level JSON value in *text*.

    MCP tools sometimes emit several JSON objects in one response (e.g. one
    dict per market index). Joined by newlines those are not a single valid
    document, so we decode repeatedly with raw_decode to recover all of them.
    """
    if not text:
        return []
    decoder = json.JSONDecoder()
    values: list = []
    s = text.strip()
    i, n = 0, len(s)
    while i < n:
        while i < n and s[i].isspace():
            i += 1
        if i >= n:
            break
        try:
            obj, end = decoder.raw_decode(s, i)
        except json.JSONDecodeError:
            break
        values.append(obj)
        i = end
    return values


def _digs(obj: Any, path) -> Any:
    """Follow a dotted *path* ('list', 'a.b.0') into *obj*; '' / None -> obj."""
    if not path:
        return obj
    cur: Any = obj
    for part in str(path).split("."):
        if cur is None:
            return None
        if isinstance(cur, dict):
            cur = cur.get(part)
        elif isinstance(cur, list) and part.isdigit():
            idx = int(part)
            cur = cur[idx] if 0 <= idx < len(cur) else None
        else:
            return None
    return cur


def _merge(values: list) -> Any:
    """Collapse decoded values into one payload for normalization.

    single value -> as-is; several dicts -> list of them (table rows); else first.
    """
    if len(values) == 1:
        return values[0]
    if values and all(isinstance(v, dict) for v in values):
        return list(values)
    return values[0] if values else None


# -- record / scalar extraction ---------------------------------------

def _is_scalar(v: Any) -> bool:
    return v is None or isinstance(v, (bool, int, float, str))


def _find_record_list(payload: Any):
    """Best list-of-records inside *payload* -> (records, named).

    named=True for list-of-dicts, False for list-of-lists (positional).
    Prefers dict-records, then the longest list.
    """
    dict_lists: list = []
    pos_lists: list = []

    def walk(node: Any) -> None:
        if isinstance(node, list):
            if len(node) > 0:
                first = node[0]
                if isinstance(first, dict):
                    dict_lists.append(node)
                elif isinstance(first, (list, tuple)):
                    pos_lists.append(node)
            for x in node:
                if isinstance(x, (dict, list)):
                    walk(x)
        elif isinstance(node, dict):
            for v in node.values():
                if isinstance(v, (dict, list)):
                    walk(v)

    walk(payload)
    if dict_lists:
        dict_lists.sort(key=len, reverse=True)
        return dict_lists[0], True
    if pos_lists:
        pos_lists.sort(key=len, reverse=True)
        return pos_lists[0], False
    return None


def _scalar(payload: Any) -> Any:
    """Reduce *payload* to a single displayable scalar."""
    if isinstance(payload, str):
        return payload if len(payload) <= 40 else None
    if _is_scalar(payload):
        return payload
    if isinstance(payload, dict):
        for k in ("value", "total", "count", "amount", "num", "close", "price"):
            if k in payload and _is_scalar(payload[k]):
                return payload[k]
        for v in payload.values():
            if _is_scalar(v):
                return v
        return None
    if isinstance(payload, list):
        return len(payload)
    return None


def _coerce_cell(v: Any) -> Any:
    if isinstance(v, str):
        return v
    if isinstance(v, bool):
        return "是" if v else "否"
    if isinstance(v, float):
        return round(v, 4)
    return v


# -- AIRUI component builders -----------------------------------------

def _make_kpi(ref: str, value: Any, label: str = "") -> dict:
    return {"type": "KPI", "props": {"ref": ref, "label": label or "",
            "value": "" if value is None else str(value)}}


def _make_text(ref: str, text: str) -> dict:
    body = (text or "").strip()
    return {"type": "Text", "props": {"ref": ref, "style": "caption",
            "value": body or "（无数据）"}}


def _make_table_from_dicts(ref, records, columns, limit) -> dict:
    if columns:
        keys = [k for k in columns if any(k in r for r in records)][:12]
    else:
        keys = list(dict.fromkeys(k for r in records for k in r.keys()))[:12]
    rows = [{k: _coerce_cell(r.get(k)) for k in keys} for r in records]
    if limit:
        rows = rows[: int(limit)]
    col_defs = [{"key": k, "label": k} for k in keys]
    return {"type": "Table", "props": {"ref": ref, "columns": col_defs, "data": rows}}


def _make_table_from_lists(ref, rows_raw, columns, limit) -> dict:
    width = max((len(r) for r in rows_raw), default=0)
    if columns:
        ncol = min(width, len(columns))
        labels = columns[:ncol]
    else:
        ncol = min(width, 6)
        labels = ["列" + str(i + 1) for i in range(ncol)]
    take = int(limit) if limit else len(rows_raw)
    rows = []
    for r in rows_raw[:take]:
        row = {}
        for i in range(ncol):
            row[labels[i]] = _coerce_cell(r[i] if i < len(r) else "")
        rows.append(row)
    col_defs = [{"key": lb, "label": lb} for lb in labels]
    return {"type": "Table", "props": {"ref": ref, "columns": col_defs, "data": rows}}


# -- kind-aware normalization -----------------------------------------

def _normalize_component(ref, payload, kind, columns, limit, value_key=None) -> dict:
    kind = (kind or "auto").lower()
    if isinstance(payload, str):
        return _make_text(ref, payload[:4000])
    if kind == "text":
        return _make_text(ref, json.dumps(payload, ensure_ascii=False)[:4000])

    if kind in ("table", "auto"):
        found = _find_record_list(payload)
        if found:
            records, named = found
            if named:
                return _make_table_from_dicts(ref, records, columns, limit)
            return _make_table_from_lists(ref, records, columns, limit)
        if kind == "table":
            return _make_text(ref, "（未找到可表格化的记录）")

    if kind in ("kpi", "auto"):
        val = None
        if isinstance(payload, dict) and value_key:
            val = payload.get(value_key)
        else:
            val = _scalar(payload)
        if val is not None:
            return _make_kpi(ref, val)

    return _make_text(ref, json.dumps(payload, ensure_ascii=False)[:4000])


# -- tool resolution --------------------------------------------------

def _tool_target(widget: dict):
    """Resolve (server_name, tool_name).

    Accepts explicit server/toolName, or a prefixed 'mcp_<server>_<tool>'
    string disambiguated against the connected MCP inventory (robust to
    underscores in server/tool names).
    """
    server = widget.get("server") or widget.get("serverName")
    tool = widget.get("toolName") or widget.get("tool_name")
    if server and tool:
        return str(server), str(tool)
    prefixed = widget.get("tool")
    if not prefixed:
        return None
    prefixed = str(prefixed)
    if not prefixed.startswith("mcp_"):
        return None
    try:
        for srv in _mcp_status():
            sname = srv.get("name")
            for t in srv.get("tools") or []:
                tname = t.get("name")
                if sname and tname and ("mcp_" + str(sname) + "_" + str(tname)) == prefixed:
                    return sname, tname
    except Exception:
        pass
    return None


# -- public API -------------------------------------------------------

def resolve_widget(widget: dict, cache: dict | None = None) -> dict:
    """Resolve one widget -> {ref, title, colSpan, component, actions?}.

    Never raises: any error becomes a text card so the home stays usable.
    """
    ref = str(widget.get("ref") or ("home-widget-" + str(id(widget))))
    title = widget.get("title") or ""
    col_span = widget.get("colSpan") or widget.get("col_span") or 6
    actions = widget.get("actions")
    try:
        target = _tool_target(widget)
        if not target:
            raise ValueError("缺少工具目标（tool）")
        server, tool = target
        args = widget.get("args") or {}
        if not isinstance(args, dict):
            args = {}
        cache_key = None
        decoded = None
        if cache is not None:
            cache_key = (server, tool, json.dumps(args, sort_keys=True, ensure_ascii=False))
            decoded = cache.get(cache_key)
        if decoded is None:
            raw = _mcp_call(server, tool, args)
            envelope = json.loads(raw) if isinstance(raw, str) else raw
            if isinstance(envelope, dict) and envelope.get("error"):
                raise RuntimeError(str(envelope["error"]))
            result = envelope.get("result") if isinstance(envelope, dict) else envelope
            text = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
            decoded = _decode_values(text)
            if cache is not None and cache_key is not None:
                cache[cache_key] = decoded
        payload = _digs(_merge(decoded), widget.get("path"))
        component = _normalize_component(
            ref, payload,
            widget.get("kind") or "auto",
            widget.get("columns"),
            widget.get("limit"),
            widget.get("valueKey") or widget.get("value_key"),
        )
    except Exception as exc:  # graceful degradation
        component = _make_text(ref, ("加载失败：" + str(exc))[:300])
    out = {"ref": ref, "title": title, "colSpan": int(col_span), "component": component}
    if actions:
        out["actions"] = actions
    return out


def resolve_widgets(widgets) -> list:
    if not isinstance(widgets, list):
        return []
    cache: dict = {}
    _ensure_loaded()
    return [resolve_widget(w, cache=cache) for w in widgets if isinstance(w, dict)]
