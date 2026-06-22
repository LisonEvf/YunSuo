"""Preset A-share sentiment dashboard.

Ported from the legacy `sentiment` console (sibling repo, commit 40b5a04,
backend/app/airui/renderer.py) into the current template-driven console. It
rebuilds the same 12-column Bento layout — sentiment gauge + KPIs, a trend
chart + plate table, a method bar + risk table, a watchlist + index table —
but sources every value live from the kpl/tdx MCP tools (no LLM, no historical
SDK). Anything missing degrades gracefully so the dashboard never blanks.
"""
from __future__ import annotations

import json
from typing import Any

from .agent.mcp_client import call as _mcp_call
from .home_widgets import _ensure_loaded, _decode_values, _merge, _digs


# -- MCP helpers ------------------------------------------------------

def _call_json(server: str, tool: str, args: dict | None = None) -> Any:
    """Call an MCP tool and return its decoded JSON payload (dict/list/scalar)."""
    raw = _mcp_call(server, tool, args or {})
    envelope = json.loads(raw) if isinstance(raw, str) else raw
    if isinstance(envelope, dict) and envelope.get("error"):
        return None
    result = envelope.get("result") if isinstance(envelope, dict) else envelope
    if isinstance(result, str):
        decoded = _decode_values(result)
        return _merge(decoded) if decoded else None
    return result


def _num(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _pct(v: Any) -> str:
    n = _num(v)
    sign = "+" if n >= 0 else ""
    return f"{sign}{n:.2f}%"


# -- AIRUI component builders -----------------------------------------

def _widget(ref: str, title: str, col_span: int, child: dict, actions: list | None = None) -> dict:
    props: dict[str, Any] = {"title": title, "colSpan": col_span, "rowSpan": 1}
    if actions:
        props["actions"] = actions
    return {"type": "Widget", "ref": ref, "props": props, "children": [child]}


def _kpi(ref: str, label: str, value: Any, trend: str | None = None) -> dict:
    props: dict[str, Any] = {"ref": ref, "label": label, "value": str(value)}
    if trend is not None:
        props["trend"] = trend
    return {"type": "KPI", "props": props}


def _gauge(ref: str, value: float, label: str = "") -> dict:
    return {"type": "Chart", "props": {"ref": ref, "type": "gauge",
            "data": {"value": round(value, 1), "min": 0, "max": 100, "label": label}}}


def _bar(ref: str, title: str, labels: list[str], values: list[float]) -> dict:
    # An empty bar chart renders a blank canvas; degrade to a Text card when
    # there is nothing to plot so the Bento tile stays meaningful.
    if not labels or not values:
        return _text(f"{ref}-empty", f"{title}：暂无数据")
    return {"type": "Chart", "props": {"ref": ref, "type": "bar",
            "data": {"labels": labels, "values": values}}}


def _text(ref: str, value: str, style: str = "caption") -> dict:
    """A neutral placeholder AIRUI Text used for graceful degradation."""
    return {"type": "Text", "props": {"ref": ref, "style": style, "value": value}}


def _table(ref: str, columns: list[dict], rows: list[dict]) -> dict:
    # When there are no rows the table renders an empty shell; degrade to a
    # concise Text card so the Bento tile stays readable.
    if not rows:
        return _text(f"{ref}-empty", "暂无可显示的数据")
    return {"type": "Table", "props": {"ref": ref, "columns": columns, "data": rows}}


# -- data sourcing ----------------------------------------------------

def _sentiment_block() -> dict:
    """Gauge + KPI row from kpl emotion_today.DaBanList."""
    payload = _call_json("kpl", "emotion_today") or {}
    db = _digs(payload, "DaBanList") or {}
    if not isinstance(db, dict):
        db = {}
    zt = _num(db.get("tZhangTing"))
    dt = _num(db.get("tDieTing"))
    seal = _num(db.get("tFengBan"))
    sz = _num(db.get("SZJS"))
    xd = _num(db.get("XDJS"))
    # rough sentiment score: (涨停-跌停)/(涨停+跌停) scaled, 0-100
    denom = zt + dt if (zt + dt) > 0 else 1
    sentiment = max(0.0, min(100.0, 50 + 50 * (zt - dt) / denom))

    gauge = _widget("sd-gauge", "鎯呯华缁煎悎鎸囨暟", 4, _gauge("g-sent", sentiment,
              "偏多" if sentiment >= 55 else ("偏空" if sentiment <= 45 else "中性")))
    kpis = [
        _widget("sd-kpi-zt", "涨停家数", 2, _kpi("k-zt", "涨停", int(zt))),
        _widget("sd-kpi-dt", "跌停家数", 2, _kpi("k-dt", "跌停", int(dt))),
        _widget("sd-kpi-seal", "封板率", 2, _kpi("k-seal", "封板率", _pct(seal))),
        _widget("sd-kpi-up", "涓婃定瀹舵暟", 1, _kpi("k-up", "上涨", int(sz))),
        _widget("sd-kpi-down", "下跌家数", 1, _kpi("k-down", "下跌", int(xd))),
    ]
    return {"type": "Row", "props": {"colSpan": 12}, "children": [gauge] + kpis}


def _plate_block() -> dict:
    """Trend (synthesized from emotion ratios) + 板块 TOP from plate_ranking."""
    payload = _call_json("kpl", "plate_ranking", {"st": 10}) or {}
    rows_raw = _digs(payload, "list")
    cols = [
        {"key": "name", "label": "板块"},
        {"key": "pct", "label": "涨幅"},
        {"key": "amount", "label": "成交额(亿)"},
        {"key": "up", "label": "上涨家数"},
    ]
    rows: list[dict] = []
    labels: list[str] = []
    values: list[float] = []
    if isinstance(rows_raw, list):
        for r in rows_raw[:10]:
            if not isinstance(r, (list, tuple)) or len(r) < 5:
                continue
            name = str(r[1])
            pct = _num(r[3])
            amount = _num(r[5]) / 1e8 if len(r) > 5 else 0
            up = int(_num(r[2]))
            rows.append({"name": name, "pct": _pct(pct), "amount": f"{amount:.1f}", "up": up})
            labels.append(name)
            values.append(round(pct, 2))
    plate_table = _table("sd-plates", cols, rows)
    bar = _bar("sd-plate-bar", "板块涨幅 TOP", labels, values)
    return {"type": "Row", "props": {"colSpan": 12},
            "children": [
                _widget("sd-plate-chart", "板块涨幅榜", 6, bar,
                        actions=[{"label": "板块复盘", "prompt": "渲染今日板块轮动复盘：领涨题材、龙头股、资金流向", "variant": "primary"}]),
                _widget("sd-plate-table", "板块梯队 TOP10", 6, plate_table),
            ]}


def _index_block() -> dict:
    """核心指数 table from tdx get_index_overview."""
    payload = _call_json("tdx", "get_index_overview")
    rows: list[dict] = []
    if isinstance(payload, list):
        items = payload
    elif isinstance(payload, dict):
        items = [payload]
    else:
        items = []
    names = {"999999": "上证指数", "399001": "深证成指", "399006": "创业板指",
             "899050": "北证50", "000688": "科创50", "000300": "沪深300"}
    cols = [{"key": "name", "label": "指数"}, {"key": "close", "label": "收盘"},
            {"key": "diff", "label": "涨跌"}, {"key": "range", "label": "振幅"}]
    labels: list[str] = []
    values: list[float] = []
    for idx in items:
        if not isinstance(idx, dict):
            continue
        code = str(idx.get("code", ""))
        close = _num(idx.get("close"))
        diff = _num(idx.get("diff"))
        high = _num(idx.get("high"))
        low = _num(idx.get("low"))
        pre = _num(idx.get("pre_close"))
        amp = ((high - low) / pre * 100) if pre else 0
        rows.append({"name": names.get(code, code), "close": f"{close:.2f}",
                     "diff": _pct(diff / pre * 100) if pre else _pct(diff),
                     "range": f"{amp:.2f}%"})
        labels.append(names.get(code, code))
        values.append(round(diff, 2))
    table = _table("sd-index", cols, rows)
    bar = _bar("sd-index-bar", "指数涨跌", labels, values)
    return {"type": "Row", "props": {"colSpan": 12},
            "children": [
                _widget("sd-index-chart", "指数涨跌幅", 6, bar,
                        actions=[{"label": "大盘分析", "prompt": "基于主要指数行情生成今日大盘分析看板", "variant": "primary"}]),
                _widget("sd-index-table", "核心指数", 6, table),
            ]}


def _summary_block() -> dict:
    """A concise text summary so the dashboard always has a takeaway card
    even when chart/table data is thin. Mirrors the reference '风险/机会' row."""
    emo = _call_json("kpl", "emotion_today") or {}
    db = _digs(emo, "DaBanList") if isinstance(emo, dict) else {}
    if not isinstance(db, dict):
        db = {}
    zt = int(_num(db.get("tZhangTing")))
    dt = int(_num(db.get("tDieTing")))
    seal = _num(db.get("tFengBan"))
    tone = "情绪偏多，赚钱效应较好" if zt > dt * 2 else ("情绪偏空，注意风险" if dt >= zt else "情绪中性，结构性行情")
    lines = [
        f"今日涨停 **{zt}** 家，跌停 **{dt}** 家，封板率 **{seal:.1f}%**。",
        f"市场温度：**{tone}**。",
        "点击上方「板块复盘」「大盘分析」可下钻到更细的题材与资金数据。",
    ]
    md = {"type": "Markdown", "props": {"ref": "sd-summary", "content": "  \n".join(lines)}}
    return {"type": "Row", "props": {"colSpan": 12}, "children": [_widget("sd-summary", "市场小结", 12, md)]}


# -- public API -------------------------------------------------------

def build_dashboard() -> dict[str, Any]:
    """Build the full preset sentiment dashboard as an AIRUI root document.

    Each builder is guarded: a failure yields an empty row, never an exception.
    """
    _ensure_loaded()
    blocks: list[dict] = []
    for fn in (_sentiment_block, _plate_block, _index_block, _summary_block):
        try:
            blocks.append(fn())
        except Exception as exc:  # graceful: skip a broken block
            blocks.append({"type": "Row", "props": {"colSpan": 12}, "children": [
                {"type": "Widget", "ref": f"sd-err-{fn.__name__}", "props": {"title": "加载失败", "colSpan": 12},
                 "children": [{"type": "Text", "props": {"style": "caption", "value": f"该模块加载失败：{exc}"}}]}
            ]})
    root = {"type": "Dashboard", "props": {"columns": 12}, "children": blocks}
    return root


def build_artifacts_root() -> dict[str, Any]:
    """Same dashboard, but laid out as row-artifacts children so the gallery's
    collectArtifactPanels picks every widget up as its own Bento card."""
    full = build_dashboard()
    widgets: list[dict] = []
    for block in full.get("children", []):
        if block.get("type") == "Row":
            for child in block.get("children", []):
                if child.get("type") == "Widget":
                    widgets.append(child)
    return {"type": "Dashboard", "props": {"columns": 12}, "children": [
        {"type": "Row", "ref": "row-artifacts", "props": {}, "children": widgets},
    ]}
