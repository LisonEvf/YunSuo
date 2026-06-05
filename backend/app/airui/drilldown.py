"""Drilldown 事件处理器 —— 看板点击 → 数据预拉 → Agent 分析 → patch 看板。"""
from __future__ import annotations

import logging
from typing import Any

from .session import session_manager

logger = logging.getLogger(__name__)


async def handle_drilldown(event: dict[str, Any]) -> None:
    """处理看板 drilldown 事件。"""
    widget_ref = event.get("widgetRef", "")
    interaction = event.get("interaction", "")
    payload = event.get("payload", {})

    if interaction != "drilldown":
        return

    emit_type = _infer_emit_type(widget_ref, payload)

    if emit_type == "plate-detail":
        await _handle_plate_drilldown(payload)
    elif emit_type == "stock-detail":
        await _handle_stock_drilldown(payload)
    else:
        logger.info("Unknown drilldown: ref=%s payload=%s", widget_ref, payload)


def _infer_emit_type(widget_ref: str, payload: dict) -> str:
    """从 widgetRef 和 payload 推断 drilldown 类型。"""
    if "plate" in widget_ref:
        return "plate-detail"
    if "watchlist" in widget_ref:
        return "stock-detail"
    code = payload.get("_code", payload.get("code", ""))
    if code == "CASH":
        return ""
    if "plate" in payload or "code" not in payload:
        return "plate-detail"
    return "stock-detail"


async def _handle_plate_drilldown(payload: dict) -> None:
    """板块 drilldown：拉取成分股 → Agent 分析。"""
    from ..agent import get_agent

    plate_name = payload.get("name", payload.get("plate", ""))
    plate_code = payload.get("_code", payload.get("code", ""))

    from ..services import data_service
    try:
        members = data_service.board_members(board=plate_code, count=20) if plate_code else {"items": []}
    except Exception:
        members = {"items": []}

    messages = [
        {
            "role": "user",
            "content": (
                f"用户在看板上点击了板块「{plate_name}」（代码 {plate_code}），请深入分析：\n\n"
                f"1. 成分股表现：{members}\n"
                f"2. 请调用 render_airui_panel 在看板上渲染分析面板\n"
                f"3. 面板内容应包含：成分股表格、板块阶段判断、操作建议"
            ),
        }
    ]

    try:
        agent = get_agent()
        await agent.chat(messages)
    except Exception as exc:
        logger.warning("Plate drilldown agent error: %s", exc)


async def _handle_stock_drilldown(payload: dict) -> None:
    """个股 drilldown：拉取行情 + K 线 → Agent 分析。"""
    from ..agent import get_agent

    stock_name = payload.get("name", "")
    stock_code = payload.get("_code", payload.get("code", ""))
    theme = payload.get("theme", payload.get("condition", ""))

    market = _infer_market(stock_code)

    from ..services import data_service
    quotes_data = {}
    kline_data = {}
    try:
        if stock_code and stock_code != "CASH":
            quotes_data = data_service.quotes([f"{market}:{stock_code}"])
            kline_data = data_service.kline(market, stock_code, count=30)
    except Exception:
        pass

    messages = [
        {
            "role": "user",
            "content": (
                f"用户在看板上点击了个股「{stock_name}」（{market}:{stock_code}），题材：{theme}。\n\n"
                f"1. 实时行情：{quotes_data}\n"
                f"2. 近30日K线：{kline_data}\n"
                f"3. 请调用 render_airui_panel 在看板上渲染个股分析面板\n"
                f"4. 面板内容应包含：K线图、关键指标、操作建议"
            ),
        }
    ]

    try:
        agent = get_agent()
        await agent.chat(messages)
    except Exception as exc:
        logger.warning("Stock drilldown agent error: %s", exc)


def _infer_market(code: str) -> str:
    """从股票代码推断市场。"""
    if not code:
        return "SZ"
    if code.startswith(("6", "9")):
        return "SH"
    if code.startswith(("8", "4")):
        return "BJ"
    return "SZ"
