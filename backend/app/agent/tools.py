"""Agent 工具定义与执行器。

复刻 hermes-agent 的 tool dispatch 模式：
- TOOL_DEFINITIONS: OpenAI function calling 格式的工具 schema
- execute_tool(name, args, snapshot): 统一工具调度入口

dashboard 按功能拆分为 5 个精简工具，避免单次返回数据过大撑爆 context。
支持 snapshot 参数：同轮次多个工具共享同一份 dashboard 快照，保证数据一致性。
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Callable

from ..utils import to_jsonable, pick_number, recent_weekdays
from ..connections import get_kpl

logger = logging.getLogger(__name__)


def _data_svc():
    from ..services import data_service
    return data_service


# ── OpenAI function-calling 工具 schema ──────────────────────────

TOOL_DEFINITIONS: list[dict[str, Any]] = [
    # ── 情绪概览类 ──
    {
        "type": "function",
        "function": {
            "name": "get_sentiment_overview",
            "description": "获取市场情绪概览：情绪周期定位、综合指数、涨停/跌停/炸板家数、封板率、昨日溢价、涨跌家数、两市成交额等核心 KPI",
            "parameters": {
                "type": "object",
                "properties": {
                    "day": {"type": "string", "description": "交易日 YYYY-MM-DD，不传取最近交易日"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_plate_top",
            "description": "获取板块梯队 TOP10，包含板块名称、涨幅、龙头、涨停家数、连板高度、资金类型、强度评分",
            "parameters": {
                "type": "object",
                "properties": {
                    "day": {"type": "string", "description": "交易日 YYYY-MM-DD"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_trend_history",
            "description": "获取近 N 日情绪趋势，每日返回：日期、情绪评分、涨停/跌停家数、成交额、封板率、周期状态",
            "parameters": {
                "type": "object",
                "properties": {
                    "days": {"type": "integer", "description": "天数，默认 5"},
                    "day": {"type": "string", "description": "截止交易日 YYYY-MM-DD"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_risks_and_opportunities",
            "description": "获取风险提示和机会研判：跌停扩散风险、炸板率风险、高潮兑现风险、急速回撤预警、机会板块等",
            "parameters": {
                "type": "object",
                "properties": {
                    "day": {"type": "string", "description": "交易日 YYYY-MM-DD"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_trade_methods",
            "description": "获取赚钱手法评分：空仓观望、超跌反弹、低吸半路、首板打板、龙头接力、高位打板的适合度和建议",
            "parameters": {
                "type": "object",
                "properties": {
                    "day": {"type": "string", "description": "交易日 YYYY-MM-DD"},
                },
                "required": [],
            },
        },
    },
    # ── 行情数据类 ──
    {
        "type": "function",
        "function": {
            "name": "get_stock_quotes",
            "description": "获取个股实时行情（价格、涨跌幅、成交量等）",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbols": {
                        "type": "string",
                        "description": "股票代码，格式 '市场:代码'，多个用逗号分隔，如 'SZ:000001,SH:600000'",
                    },
                },
                "required": ["symbols"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_stock_kline",
            "description": "获取个股 K 线数据（日线/周线/月线），支持前复权/后复权",
            "parameters": {
                "type": "object",
                "properties": {
                    "market": {"type": "string", "enum": ["SZ", "SH", "BJ"], "description": "市场"},
                    "code": {"type": "string", "description": "股票代码，如 '000001'"},
                    "period": {"type": "string", "enum": ["DAILY", "WEEKLY", "MONTHLY"], "description": "周期，默认日线"},
                    "count": {"type": "integer", "description": "返回条数，默认 80"},
                    "adjust": {"type": "string", "enum": ["NONE", "FRONT", "BACK"], "description": "复权方式，默认不复权"},
                },
                "required": ["market", "code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_board_list",
            "description": "获取行业板块涨幅排行列表",
            "parameters": {
                "type": "object",
                "properties": {
                    "count": {"type": "integer", "description": "返回条数，默认 80"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_board_members",
            "description": "获取板块成分股明细，按涨跌幅排序",
            "parameters": {
                "type": "object",
                "properties": {
                    "board": {"type": "string", "description": "板块代码，如 '881001'"},
                    "count": {"type": "integer", "description": "返回条数，默认 30"},
                },
                "required": ["board"],
            },
        },
    },
    # ── KPL 情绪/资讯类 ──
    {
        "type": "function",
        "function": {
            "name": "get_market_emotion",
            "description": "获取市场情绪原始数据，包括打板统计、涨停排行、风向标、资金反抽等",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_news_flash",
            "description": "获取 7x24 市场快讯，支持按关键词搜索",
            "parameters": {
                "type": "object",
                "properties": {
                    "keyword": {"type": "string", "description": "搜索关键词"},
                    "limit": {"type": "integer", "description": "返回条数，默认 20"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_plate_ranking",
            "description": "获取概念板块排行数据（实时或历史）",
            "parameters": {
                "type": "object",
                "properties": {
                    "order": {"type": "integer", "description": "排序方式，1=涨幅降序"},
                    "count": {"type": "integer", "description": "返回条数，默认 30"},
                    "date": {"type": "string", "description": "历史日期 YYYY-MM-DD，不传则实时"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_lhb",
            "description": "获取龙虎榜数据，包括市场动向、热门题材、个股席位明细",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_stock_zhangting_gene",
            "description": "获取个股涨停基因评分（封板率、连板能力、板块号召力等）",
            "parameters": {
                "type": "object",
                "properties": {"code": {"type": "string", "description": "股票代码"}},
                "required": ["code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_stock_plates",
            "description": "获取个股所属概念板块列表",
            "parameters": {
                "type": "object",
                "properties": {"code": {"type": "string", "description": "股票代码"}},
                "required": ["code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_theme_detail",
            "description": "获取题材详情，包含成分股、关联板块、涨停映射",
            "parameters": {
                "type": "object",
                "properties": {"theme_id": {"type": "string", "description": "题材 ID"}},
                "required": ["theme_id"],
            },
        },
    },
]


# ── 工具实现 ──────────────────────────────────────────────────────


def _sentiment_overview(args: dict, snapshot: dict | None = None) -> dict[str, Any]:
    """情绪概览：overview + kpis + indexes。"""
    day = args.get("day")
    full = snapshot if (snapshot and not day) else _data_svc().dashboard(day=day)
    return {
        "overview": full["overview"],
        "kpis": full["kpis"],
        "indexes": full["indexes"],
    }


def _plate_top(args: dict, snapshot: dict | None = None) -> list[dict[str, Any]]:
    """板块 TOP10。"""
    day = args.get("day")
    full = snapshot if (snapshot and not day) else _data_svc().dashboard(day=day)
    return full["plates"]


def _trend_history(args: dict, snapshot: dict | None = None) -> list[dict[str, Any]]:
    """趋势历史，精简版：不含每日板块热力数据。"""
    days = args.get("days", 5)
    day = args.get("day")
    full = snapshot if (snapshot and not day) else _data_svc().dashboard(day=day)
    trend = full.get("trend", [])
    slim = []
    for t in trend[-days:]:
        slim.append({
            "date": t["date"],
            "score": t["score"],
            "limitUp": t["limit_up"],
            "limitDown": t["limit_down"],
            "amount": t["amount"],
            "sealRate": t["seal_rate"],
            "bombRate": t["bomb_rate"],
            "cycle": t["cycle"],
            "marketCoef": t.get("marketCoef"),
            "shortSentiment": t.get("shortSentiment"),
            "moneyLoss": t.get("moneyLoss"),
        })
    return slim


def _risks_and_opps(args: dict, snapshot: dict | None = None) -> dict[str, Any]:
    """风险提示 + 机会研判。"""
    day = args.get("day")
    full = snapshot if (snapshot and not day) else _data_svc().dashboard(day=day)
    return {
        "cycle": full["overview"]["cycle"],
        "sentiment": full["overview"]["sentiment"],
        "risks": full["risks"],
        "opportunities": full["opportunities"],
    }


def _trade_methods(args: dict, snapshot: dict | None = None) -> list[dict[str, Any]]:
    """赚钱手法评分。"""
    day = args.get("day")
    full = snapshot if (snapshot and not day) else _data_svc().dashboard(day=day)
    return full["methods"]


# ── 行情数据类 ──


def _stock_quotes(args: dict, snapshot: dict | None = None) -> dict[str, Any]:
    symbols = [s.strip() for s in args.get("symbols", "").split(",") if s.strip()]
    if not symbols:
        return {"error": "symbols 参数不能为空"}
    return _data_svc().quotes(symbols)


def _stock_kline(args: dict, snapshot: dict | None = None) -> dict[str, Any]:
    market = args.get("market")
    code = args.get("code")
    if not market or not code:
        return {"error": "market 和 code 参数必填"}
    return _data_svc().kline(
        market=market, code=code,
        period_name=args.get("period", "DAILY"),
        count=args.get("count", 80),
        adjust_name=args.get("adjust", "NONE"),
    )


def _board_list(args: dict, snapshot: dict | None = None) -> dict[str, Any]:
    return _data_svc().boards(count=args.get("count", 80))


def _board_members(args: dict, snapshot: dict | None = None) -> dict[str, Any]:
    board = args.get("board")
    if not board:
        return {"error": "board 参数必填"}
    return _data_svc().board_members(board=board, count=args.get("count", 30))


# ── KPL SDK 直接调用 ──


def _kpl_emotion(args: dict, snapshot: dict | None = None) -> dict[str, Any]:
    kpl = get_kpl()
    data = kpl.emotion.today()
    return {
        "daban": to_jsonable(data.daban) if data.daban else None,
        "plates": to_jsonable(data.plates) if data.plates else None,
        "phb": to_jsonable(data.phb) if data.phb else None,
        "day": data.day,
        "ts": data.ts,
    }


def _kpl_news(args: dict, snapshot: dict | None = None) -> Any:
    kpl = get_kpl()
    keyword = args.get("keyword")
    limit = args.get("limit", 20)
    if keyword:
        result = kpl.news_flash.search(keyword, st=limit)
    else:
        result = kpl.news_flash.list(st=limit)
    return to_jsonable(result)


def _kpl_plate_ranking(args: dict, snapshot: dict | None = None) -> Any:
    kpl = get_kpl()
    return kpl.plate.ranking_raw(
        order=args.get("order", 1),
        st=args.get("count", 30),
        date=args.get("date"),
    )


def _kpl_lhb(args: dict, snapshot: dict | None = None) -> dict[str, Any]:
    kpl = get_kpl()
    overview = kpl.lhb.today()
    detail = kpl.lhb.stock_list()
    return {"overview": to_jsonable(overview), "detail": to_jsonable(detail)}


def _kpl_zhangting_gene(args: dict, snapshot: dict | None = None) -> Any:
    code = args.get("code")
    if not code:
        return {"error": "code 参数必填"}
    kpl = get_kpl()
    return to_jsonable(kpl.stock.zhangting_gene(code))


def _kpl_stock_plates(args: dict, snapshot: dict | None = None) -> Any:
    code = args.get("code")
    if not code:
        return {"error": "code 参数必填"}
    kpl = get_kpl()
    return to_jsonable(kpl.stock.stock_plates(code))


def _kpl_theme_detail(args: dict, snapshot: dict | None = None) -> Any:
    theme_id = args.get("theme_id")
    if not theme_id:
        return {"error": "theme_id 参数必填"}
    kpl = get_kpl()
    return to_jsonable(kpl.theme.info(theme_id))


# ── Handler 注册表（替代 match/case，便于扩展）────────────────────

_HANDLERS: dict[str, Callable[[dict, dict | None], Any]] = {
    "get_sentiment_overview": _sentiment_overview,
    "get_plate_top": _plate_top,
    "get_trend_history": _trend_history,
    "get_risks_and_opportunities": _risks_and_opps,
    "get_trade_methods": _trade_methods,
    "get_stock_quotes": _stock_quotes,
    "get_stock_kline": _stock_kline,
    "get_board_list": _board_list,
    "get_board_members": _board_members,
    "get_market_emotion": _kpl_emotion,
    "get_news_flash": _kpl_news,
    "get_plate_ranking": _kpl_plate_ranking,
    "get_lhb": _kpl_lhb,
    "get_stock_zhangting_gene": _kpl_zhangting_gene,
    "get_stock_plates": _kpl_stock_plates,
    "get_theme_detail": _kpl_theme_detail,
}


# ── 工具执行器 ───────────────────────────────────────────────────


def _sync_execute(name: str, args: dict[str, Any], snapshot: dict | None = None) -> str:
    from .. import sdk_bootstrap  # noqa: F401
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
