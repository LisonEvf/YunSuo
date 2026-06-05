"""AIRUI Renderer —— Dashboard 数据 → AIRUI Document 模板引擎。

纯函数，无状态，无 LLM 调用。每次从头构建，保证幂等。
"""
from __future__ import annotations

from typing import Any


def render_dashboard(data: dict[str, Any]) -> dict[str, Any]:
    """将 DataService.dashboard() 输出转换为 AIRUI Document。"""
    kpis = data.get("kpis", {})
    overview = data.get("overview", {})
    indexes = data.get("indexes", [])
    trend = data.get("trend", [])
    plates = data.get("plates", [])
    methods = data.get("methods", [])
    risks = data.get("risks", [])
    opportunities = data.get("opportunities", [])
    watchlist = data.get("watchlist", [])
    monitor = data.get("monitor", [])
    meta = data.get("meta", {})

    return {
        "schema": "air-ui@1",
        "viewport": {"width": 1200, "height": 900},
        "state": {
            "day": meta.get("day", ""),
            "cycle": overview.get("cycle", ""),
        },
        "root": {
            "type": "Dashboard",
            "props": {
                "columns": 12,
                "rowGap": 12,
                "columnGap": 12,
            },
            "children": [
                _build_kpi_row(kpis, overview),
                _build_trend_and_plates(trend, plates),
                _build_methods_and_risks(methods, risks, opportunities),
                _build_watchlist_and_monitor(watchlist, monitor, indexes),
            ],
        },
    }


def _widget(ref: str, title: str, col_span: int, row_span: int = 1,
            child: dict | None = None, refresh_interval: int | None = None) -> dict:
    """构造 Widget 容器。"""
    widget: dict[str, Any] = {
        "type": "Widget",
        "ref": ref,
        "props": {
            "title": title,
            "colSpan": col_span,
            "rowSpan": row_span,
        },
        "children": [child] if child else [],
    }
    if refresh_interval:
        widget["props"]["dataIntent"] = {"refreshInterval": refresh_interval}
    return widget


def _kpi(ref: str, label: str, value: Any, suffix: str = "", delta: float | None = None,
         positive_color: str = "#ef4444", negative_color: str = "#22c55e") -> dict:
    """构造 KPI 组件。"""
    props: dict[str, Any] = {
        "label": label,
        "value": value,
        "suffix": suffix,
        "positiveColor": positive_color,
        "negativeColor": negative_color,
    }
    if delta is not None:
        props["delta"] = delta
    return {"type": "KPI", "ref": ref, "props": props}


def _build_kpi_row(kpis: dict, overview: dict) -> dict:
    """第一行：情绪仪表盘 + 核心指标。"""
    children: list[dict] = []

    gauge_child = {
        "type": "Gauge",
        "props": {
            "value": kpis.get("sentiment", 0),
            "min": 0,
            "max": 100,
            "label": overview.get("cycle", ""),
        },
    }
    children.append(_widget("gauge-sentiment", "情绪综合指数", 2, child=gauge_child))

    kpi_defs = [
        ("kpi-limitUp", "涨停家数", kpis.get("limitUp", 0), "", kpis.get("sentimentDelta")),
        ("kpi-broken", "炸板家数", kpis.get("broken", 0)),
        ("kpi-limitDown", "跌停家数", kpis.get("limitDown", 0), "", None, "#22c55e", "#ef4444"),
        ("kpi-sealRate", "封板率", kpis.get("sealRate", 0), "%"),
        ("kpi-bombRate", "炸板率", kpis.get("bombRate", 0), "%"),
        ("kpi-yesterdayPremium", "昨日溢价", kpis.get("yesterdayPremium", 0), "%"),
    ]
    for kpi_args in kpi_defs:
        ref, label, value = kpi_args[0], kpi_args[1], kpi_args[2]
        suffix = kpi_args[3] if len(kpi_args) > 3 else ""
        delta = kpi_args[4] if len(kpi_args) > 4 else None
        pos_color = kpi_args[5] if len(kpi_args) > 5 else "#ef4444"
        neg_color = kpi_args[6] if len(kpi_args) > 6 else "#22c55e"
        children.append(_widget(ref, label, 2, child=_kpi(ref, label, value, suffix, delta, pos_color, neg_color)))

    return {"type": "Row", "children": children}


def _build_trend_and_plates(trend: list, plates: list) -> dict:
    """第二行：三线趋势图 + 板块 TOP10 表格。"""
    trend_data = _build_trend_chart_data(trend)
    chart_child = {
        "type": "Chart",
        "props": {
            "chartType": "line",
            "title": "情绪三线趋势",
            "data": trend_data,
        },
    }
    trend_widget = _widget("chart-trend", "情绪三线趋势", 8, child=chart_child, refresh_interval=45000)

    plate_table = _build_plate_table(plates)
    plate_widget = _widget("table-plates", "板块梯队 TOP10", 4, child=plate_table)

    return {"type": "Row", "children": [trend_widget, plate_widget]}


def _build_trend_chart_data(trend: list) -> dict:
    """构建三线趋势图数据。"""
    dates = [t.get("date", "")[5:] for t in trend]
    market_coef = [t.get("marketCoef", 0) for t in trend]
    short_sentiment = [t.get("shortSentiment", 0) for t in trend]
    money_loss = [t.get("moneyLoss", 0) for t in trend]

    return {
        "labels": dates,
        "series": [
            {"name": "大盘系数", "values": market_coef, "color": "#3b82f6"},
            {"name": "超短情绪", "values": short_sentiment, "color": "#ef4444"},
            {"name": "亏钱效应", "values": money_loss, "color": "#22c55e"},
        ],
    }


def _build_plate_table(plates: list) -> dict:
    """构建板块 TOP10 表格（支持 drilldown）。"""
    columns = [
        {"key": "name", "label": "板块", "width": 80},
        {"key": "pct", "label": "涨幅%", "width": 60},
        {"key": "leader", "label": "龙头", "width": 70},
        {"key": "limitUps", "label": "涨停", "width": 40},
        {"key": "maxBoard", "label": "最高板", "width": 50},
        {"key": "capital", "label": "资金", "width": 60},
        {"key": "strength", "label": "强度", "width": 50},
    ]
    rows = []
    for p in plates[:10]:
        rows.append({
            "name": p.get("name", ""),
            "pct": p.get("pct", 0),
            "leader": p.get("leader", ""),
            "limitUps": p.get("limitUps", 0),
            "maxBoard": p.get("maxBoard", 0),
            "capital": p.get("capital", ""),
            "strength": p.get("strength", 0),
            "_code": p.get("code", ""),
            "_role": p.get("role", ""),
            "_stage": p.get("stage", ""),
        })

    return {
        "type": "Table",
        "props": {
            "columns": columns,
            "rows": rows,
            "rowKey": "name",
            "interactions": [{"type": "drilldown", "emit": "plate-detail"}],
        },
    }


def _build_methods_and_risks(methods: list, risks: list, opportunities: list) -> dict:
    """第三行：赚钱手法 + 风险/机会。"""
    method_data = {
        "labels": [m.get("name", "") for m in methods],
        "values": [m.get("score", 0) for m in methods],
    }
    method_chart = {
        "type": "Chart",
        "props": {
            "chartType": "bar",
            "title": "赚钱手法评分",
            "data": method_data,
        },
    }
    method_widget = _widget("chart-methods", "赚钱手法评分", 6, child=method_chart)

    risk_table = _build_risk_table(risks, opportunities)
    risk_widget = _widget("table-risks", "风险提示与机会", 6, child=risk_table)

    return {"type": "Row", "children": [method_widget, risk_widget]}


def _build_risk_table(risks: list, opportunities: list) -> dict:
    """构建风险+机会表格。"""
    columns = [
        {"key": "type", "label": "类型", "width": 50},
        {"key": "title", "label": "标题", "width": 150},
        {"key": "level", "label": "等级", "width": 50},
        {"key": "text", "label": "说明", "width": 200},
    ]
    rows = []
    for r in risks:
        rows.append({"type": "风险", "title": r.get("title", ""), "level": r.get("level", ""), "text": r.get("text", "")})
    for o in opportunities:
        rows.append({"type": "机会", "title": o.get("title", ""), "level": o.get("grade", ""), "text": f"{o.get('text', '')} | 触发：{o.get('trigger', '')}"})

    return {
        "type": "Table",
        "props": {
            "columns": columns,
            "rows": rows,
        },
    }


def _build_watchlist_and_monitor(watchlist: list, monitor: list, indexes: list) -> dict:
    """第四行：观察池 + 核心指数。"""
    wl_table = _build_watchlist_table(watchlist)
    wl_widget = _widget("table-watchlist", "明日观察池", 8, child=wl_table)

    idx_table = _build_index_table(indexes)
    idx_widget = _widget("table-indexes", "核心指数", 4, child=idx_table)

    return {"type": "Row", "children": [wl_widget, idx_widget]}


def _build_watchlist_table(watchlist: list) -> dict:
    """构建观察池表格（行点击 drilldown）。"""
    columns = [
        {"key": "priority", "label": "优先级", "width": 50},
        {"key": "name", "label": "标的", "width": 80},
        {"key": "theme", "label": "题材", "width": 80},
        {"key": "condition", "label": "买点条件", "width": 200},
    ]
    rows = []
    for w in watchlist:
        rows.append({
            "priority": w.get("priority", ""),
            "name": w.get("name", ""),
            "theme": w.get("theme", ""),
            "condition": w.get("condition", ""),
            "_code": w.get("code", ""),
        })

    return {
        "type": "Table",
        "props": {
            "columns": columns,
            "rows": rows,
            "rowKey": "name",
            "interactions": [{"type": "drilldown", "emit": "stock-detail"}],
        },
    }


def _build_index_table(indexes: list) -> dict:
    """构建核心指数表格。"""
    columns = [
        {"key": "name", "label": "指数", "width": 80},
        {"key": "close", "label": "收盘", "width": 60},
        {"key": "pct", "label": "涨跌%", "width": 60},
    ]
    rows = [
        {"name": idx.get("name", ""), "close": idx.get("close", 0), "pct": idx.get("pct", 0)}
        for idx in indexes
    ]

    return {
        "type": "Table",
        "props": {
            "columns": columns,
            "rows": rows,
        },
    }
