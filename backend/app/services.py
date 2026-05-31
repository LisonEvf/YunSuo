from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Callable

from . import sdk_bootstrap  # noqa: F401
from .utils import format_ts, percent_change, pick_number, recent_weekdays, to_jsonable

from kpl_sdk.client import KplClient
from opentdx.const import ADJUST, BOARD_TYPE, MARKET, PERIOD, SORT_ORDER, SORT_TYPE
from opentdx.tdxClient import TdxClient


INDEX_SYMBOLS = [
    {"name": "上证指数", "market": MARKET.SH, "code": "999999", "display": "000001.SH"},
    {"name": "深证成指", "market": MARKET.SZ, "code": "399001", "display": "399001.SZ"},
    {"name": "创业板指", "market": MARKET.SZ, "code": "399006", "display": "399006.SZ"},
    {"name": "科创50", "market": MARKET.SH, "code": "000688", "display": "000688.SH"},
    {"name": "上证50", "market": MARKET.SH, "code": "000016", "display": "000016.SH"},
    {"name": "沪深300", "market": MARKET.SH, "code": "000300", "display": "000300.SH"},
    {"name": "北证50", "market": MARKET.BJ, "code": "899050", "display": "899050.BJ"},
]

MARKET_ALIASES = {
    "SZ": MARKET.SZ,
    "SH": MARKET.SH,
    "BJ": MARKET.BJ,
}

PERIOD_ALIASES = {item.name: item for item in PERIOD}
ADJUST_ALIASES = {item.name: item for item in ADJUST}


@dataclass
class CacheItem:
    expires_at: float
    value: Any


class TTLCache:
    def __init__(self, ttl_seconds: int = 45):
        self.ttl_seconds = ttl_seconds
        self._items: dict[str, CacheItem] = {}

    def get_or_set(self, key: str, factory: Callable[[], Any]) -> Any:
        now = time.time()
        item = self._items.get(key)
        if item and item.expires_at > now:
            return item.value
        value = factory()
        self._items[key] = CacheItem(expires_at=now + self.ttl_seconds, value=value)
        return value


class DataService:
    def __init__(self):
        self.cache = TTLCache(ttl_seconds=45)

    def health(self) -> dict[str, Any]:
        return {
            "status": "ok",
            "service": "sentiment-backend",
            "providers": ["openkpl", "opentdx"],
        }

    def dashboard(self, day: str | None = None) -> dict[str, Any]:
        cache_key = f"dashboard:{day or 'latest'}"
        return self.cache.get_or_set(cache_key, lambda: self._build_dashboard(day))

    def _build_dashboard(self, day: str | None) -> dict[str, Any]:
        warnings: list[str] = []
        raw: dict[str, Any] = {}

        def capture(name: str, fn: Callable[[], Any]) -> Any:
            try:
                raw[name] = fn()
                return raw[name]
            except Exception as exc:
                warnings.append(f"{name}: {exc}")
                return None

        with KplClient(timeout=8) as kpl:
            market_status = capture("openkpl.market.status", kpl.market.status)
            emotion = capture("openkpl.emotion.today", kpl.emotion.today)

            active_day = day or getattr(market_status, "day", None) or getattr(emotion, "day", None)
            disk_review = capture("openkpl.history.disk_review", lambda: kpl.history.disk_review(active_day))
            zhangting = capture(
                "openkpl.history.zhangting_expression",
                lambda: kpl.history.zhangting_expression(active_day),
            )
            zhangfu = capture("openkpl.history.zhangfu_detail", lambda: kpl.history.zhangfu_detail(active_day))
            volume = capture("openkpl.history.market_scln", lambda: kpl.history.market_scln(active_day))
            daily_nums = capture("openkpl.history.get_num", lambda: kpl.history.get_num(active_day))
            plates = capture(
                "openkpl.history.weight_performance",
                lambda: kpl.history.weight_performance(active_day),
            )
            plate_list = capture(
                "openkpl.history.weight_performance_list",
                lambda: kpl.history.weight_performance_list(active_day, st=20),
            )
            daban_list = capture(
                "openkpl.history.daban_list",
                lambda: kpl.history.daban_list(active_day, st=30),
            )
            sharp = capture("openkpl.history.sharp_withdrawal", lambda: kpl.history.sharp_withdrawal(active_day))

            trend_days = recent_weekdays(active_day, 5)
            trend = self._build_history_trend(kpl, trend_days, warnings)

        indexes = capture("opentdx.index_info", self.core_indexes) or []
        monitor = capture("opentdx.market_monitor", self.market_monitor) or []

        normalized = self._normalize_dashboard(
            day=day,
            market_status=market_status,
            emotion=emotion,
            disk_review=disk_review,
            zhangting=zhangting,
            zhangfu=zhangfu,
            volume=volume,
            daily_nums=daily_nums,
            plates=plates,
            plate_list=plate_list,
            daban_list=daban_list,
            sharp=sharp,
            trend=trend,
            indexes=indexes,
            monitor=monitor,
            warnings=warnings,
        )
        normalized["raw"] = {
            "emotion": to_jsonable(emotion),
            "market_status": to_jsonable(market_status),
        }
        return normalized

    def _build_history_trend(self, kpl: KplClient, days: list[str], warnings: list[str]) -> list[dict[str, Any]]:
        points: list[dict[str, Any]] = []
        for day in days:
            try:
                zt = kpl.history.zhangting_expression(day)
                zf = kpl.history.zhangfu_detail(day)
                volume = kpl.history.market_scln(day)
                score = self._sentiment_score(zt=zt, zhangfu=zf)
                points.append(
                    {
                        "date": day,
                        "score": score,
                        "limit_up": getattr(zt, "zt_count", 0),
                        "limit_down": getattr(zt, "dt_count", 0),
                        "amount": round(pick_number(getattr(volume, "last", 0)) / 10000, 2),
                    }
                )
            except Exception as exc:
                warnings.append(f"openkpl.history.trend({day}): {exc}")
        return points

    def core_indexes(self) -> list[dict[str, Any]]:
        with TdxClient() as client:
            rows = client.index_info([(item["market"], item["code"]) for item in INDEX_SYMBOLS])
        result: list[dict[str, Any]] = []
        for meta, row in zip(INDEX_SYMBOLS, rows, strict=False):
            close = pick_number(row.get("close"))
            pre_close = pick_number(row.get("pre_close"))
            diff = pick_number(row.get("diff"), close - pre_close)
            pct = round(diff / pre_close * 100, 2) if pre_close else 0
            result.append(
                {
                    "name": meta["name"],
                    "code": meta["display"],
                    "close": round(close, 2),
                    "diff": round(diff, 2),
                    "pct": pct,
                    "up_count": row.get("up_count", 0),
                    "down_count": row.get("down_count", 0),
                }
            )
        return result

    def market_monitor(self) -> list[dict[str, Any]]:
        with TdxClient() as client:
            rows = []
            for market in (MARKET.SH, MARKET.SZ):
                rows.extend(client.stock_market_monitor(market, count=12))
        return to_jsonable(rows[:20])

    def quotes(self, symbols: list[str]) -> dict[str, Any]:
        def parse_symbol(symbol: str) -> tuple[MARKET, str]:
            market_name, code = symbol.replace(".", ":").split(":", 1)
            return MARKET_ALIASES[market_name.upper()], code

        parsed = [parse_symbol(symbol) for symbol in symbols]
        with TdxClient() as client:
            rows = client.stock_quotes(parsed)
        return {"items": to_jsonable(rows)}

    def kline(
        self,
        market_name: str,
        code: str,
        period_name: str = "DAILY",
        count: int = 80,
        adjust_name: str = "NONE",
    ) -> dict[str, Any]:
        market = MARKET_ALIASES[market_name.upper()]
        period = PERIOD_ALIASES[period_name.upper()]
        adjust = ADJUST_ALIASES[adjust_name.upper()]
        safe_count = max(1, min(count, 800))
        with TdxClient() as client:
            rows = client.stock_kline(market, code, period, count=safe_count, adjust=adjust)
        return {"items": to_jsonable(rows)}

    def board_members(self, board: str, count: int = 30) -> dict[str, Any]:
        safe_count = max(1, min(count, 120))
        with TdxClient() as client:
            rows = client.stock_board_members(
                board,
                count=safe_count,
                sort_type=SORT_TYPE.CHANGE_PCT,
                sort_order=SORT_ORDER.DESC,
            )
        return {"items": to_jsonable(rows)}

    def boards(self, count: int = 80) -> dict[str, Any]:
        safe_count = max(1, min(count, 300))
        with TdxClient() as client:
            rows = client.stock_board_list(BOARD_TYPE.ALL, count=safe_count)
        return {"items": to_jsonable(rows)}

    def _normalize_dashboard(
        self,
        *,
        day: str | None,
        market_status: Any,
        emotion: Any,
        disk_review: Any,
        zhangting: Any,
        zhangfu: Any,
        volume: Any,
        daily_nums: Any,
        plates: Any,
        plate_list: Any,
        daban_list: Any,
        sharp: Any,
        trend: list[dict[str, Any]],
        indexes: list[dict[str, Any]],
        monitor: list[dict[str, Any]],
        warnings: list[str],
    ) -> dict[str, Any]:
        active_day = day or getattr(market_status, "day", "") or getattr(emotion, "day", "")
        daban = getattr(emotion, "daban", None)
        zhangfu_info = getattr(zhangfu, "info", None)

        limit_up = int(pick_number(getattr(zhangting, "zt_count", None), getattr(daban, "t_zhangting", None), getattr(daily_nums, "zt", None)))
        limit_down = int(pick_number(getattr(zhangting, "dt_count", None), getattr(daban, "t_dieting", None), getattr(daily_nums, "dt", None)))
        broken = int(pick_number(getattr(sharp, "num", None), getattr(daily_nums, "pb", None)))
        seal_rate = pick_number(getattr(daban, "t_fengban", None), getattr(zhangting, "feng_ban_lv", None), default=0)
        bomb_rate = max(0, round(100 - seal_rate, 2)) if seal_rate else 0
        yesterday_premium = pick_number(getattr(daban, "zr_ztj", None), getattr(zhangting, "zt_avg_pct", None))
        link_board_premium = pick_number(getattr(daban, "zr_lbj", None))
        up_count = int(pick_number(getattr(daban, "sz_js", None), getattr(zhangfu_info, "sz_js", None)))
        down_count = int(pick_number(getattr(daban, "xd_js", None), getattr(zhangfu_info, "xd_js", None)))
        market_amount = round(pick_number(getattr(volume, "last", None), getattr(daban, "qscln", None)) / 10000, 2)
        sentiment = self._sentiment_score(daban=daban, zt=zhangting, zhangfu=zhangfu)
        cycle = self._cycle_label(sentiment, limit_down, bomb_rate)
        advice = self._position_advice(sentiment, limit_down, bomb_rate)
        plate_rows = self._plate_rows(emotion, plates, plate_list, daban_list)
        watchlist = self._watchlist(daban_list, plate_rows)
        risks = self._risks(limit_down, bomb_rate, sentiment, zhangting)
        methods = self._methods(limit_up, broken, limit_down, bomb_rate, yesterday_premium)

        index_pcts = [pick_number(row.get("pct")) for row in indexes]
        avg_index_pct = round(sum(index_pcts) / len(index_pcts), 2) if index_pcts else 0

        return {
            "meta": {
                "day": active_day,
                "updatedAt": format_ts(getattr(emotion, "ts", None)) or format_ts(getattr(market_status, "time", None)),
                "source": "openkpl + opentdx",
                "warnings": warnings,
            },
            "overview": {
                "cycle": cycle,
                "sentiment": sentiment,
                "advice": advice,
                "style": self._style_match(cycle, bomb_rate, limit_down),
                "timePlan": [
                    {"time": "09:25", "text": f"观察跌停家数是否大于 {max(10, limit_down)}"},
                    {"time": "09:35", "text": f"观察炸板率是否低于 {round(max(18, bomb_rate), 1)}%"},
                    {"time": "10:00", "text": "若主线继续加强，聚焦前排核心"},
                ],
            },
            "kpis": {
                "sentiment": sentiment,
                "sentimentDelta": trend[-1]["score"] - trend[-2]["score"] if len(trend) >= 2 else 0,
                "limitUp": limit_up,
                "broken": broken,
                "limitDown": limit_down,
                "sealRate": round(seal_rate, 2),
                "bombRate": bomb_rate,
                "yesterdayPremium": round(yesterday_premium, 2),
                "linkBoardPremium": round(link_board_premium, 2),
                "upCount": up_count,
                "downCount": down_count,
                "marketAmount": market_amount,
                "marketAmountText": getattr(volume, "yclnstr", ""),
                "marketVsShort": round(abs(avg_index_pct * 10 - sentiment / 10), 2),
                "review": getattr(disk_review, "sign", "") or getattr(zhangting, "sign", ""),
            },
            "indexes": indexes,
            "trend": trend,
            "plates": plate_rows,
            "methods": methods,
            "risks": risks,
            "opportunities": self._opportunities(cycle, plate_rows, risks),
            "watchlist": watchlist,
            "monitor": monitor,
        }

    def _sentiment_score(self, daban: Any = None, zt: Any = None, zhangfu: Any = None) -> float:
        score = pick_number(getattr(daban, "zhqd", None), default=-1)
        if score >= 0:
            return round(max(0, min(score, 100)), 1)
        seal_rate = pick_number(getattr(zt, "feng_ban_lv", None), default=50)
        limit_up = pick_number(getattr(zt, "zt_count", None), default=30)
        limit_down = pick_number(getattr(zt, "dt_count", None), default=20)
        info = getattr(zhangfu, "info", None)
        up_count = pick_number(getattr(info, "sz_js", None), default=2500)
        down_count = pick_number(getattr(info, "xd_js", None), default=2500)
        breadth = up_count / max(up_count + down_count, 1) * 100
        score = seal_rate * 0.35 + min(limit_up, 120) / 120 * 35 + breadth * 0.2 - min(limit_down, 80) / 80 * 20
        return round(max(0, min(score, 100)), 1)

    def _cycle_label(self, sentiment: float, limit_down: int, bomb_rate: float) -> str:
        if limit_down >= 50 or sentiment < 20:
            return "冰点"
        if sentiment < 35 or bomb_rate >= 45:
            return "退潮"
        if sentiment < 55:
            return "常态"
        if sentiment < 70:
            return "启动"
        if sentiment < 85:
            return "发酵"
        return "高潮"

    def _position_advice(self, sentiment: float, limit_down: int, bomb_rate: float) -> dict[str, Any]:
        if limit_down >= 40 or bomb_rate >= 45:
            return {"aggressive": "0-1成防守", "steady": "空仓等待", "min": 0, "max": 10}
        if sentiment < 35:
            return {"aggressive": "1成试错", "steady": "0-1成", "min": 0, "max": 15}
        if sentiment < 60:
            return {"aggressive": "1-3成试错", "steady": "1-2成", "min": 10, "max": 30}
        if sentiment < 80:
            return {"aggressive": "3-5成跟随", "steady": "2-4成", "min": 20, "max": 50}
        return {"aggressive": "降速择强", "steady": "不追加速", "min": 10, "max": 35}

    def _style_match(self, cycle: str, bomb_rate: float, limit_down: int) -> list[dict[str, Any]]:
        avoid = "高位缩量加速" if cycle in {"高潮", "发酵"} else "无逻辑跟风"
        return [
            {"text": "主线核心", "ok": cycle not in {"退潮", "冰点"}},
            {"text": "龙头换手板", "ok": bomb_rate < 35 and limit_down < 30},
            {"text": f"回避：{avoid}", "ok": False},
        ]

    def _plate_rows(self, emotion: Any, plates: Any, plate_list: Any, daban_list: Any) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        source_rows = list(getattr(plates, "sz", []) or [])
        for item in source_rows:
            rows.append(
                {
                    "name": getattr(item, "plate_name", ""),
                    "pct": round(pick_number(getattr(item, "plate_pct", None)), 2),
                    "code": getattr(item, "plate_code", ""),
                    "leader": getattr(item, "stock_name", ""),
                    "leaderCode": getattr(item, "stock_code", ""),
                    "leaderPct": round(pick_number(getattr(item, "stock_pct", None)), 2),
                }
            )
        for item in list(getattr(plate_list, "info", []) or [])[:12]:
            name = getattr(item, "plate_name", "")
            if name and all(row["name"] != name for row in rows):
                rows.append(
                    {
                        "name": name,
                        "pct": round(pick_number(getattr(item, "pct", None)), 2),
                        "code": getattr(item, "plate_code", ""),
                        "leader": "",
                        "leaderCode": "",
                        "leaderPct": 0,
                    }
                )
        for item in list(getattr(emotion, "plates", []) or []):
            name = getattr(item, "name", "")
            if name and all(row["name"] != name for row in rows):
                rows.append(
                    {
                        "name": name,
                        "pct": round(pick_number(getattr(item, "pct", None)), 2),
                        "code": str(getattr(item, "code", "")),
                        "leader": "",
                        "leaderCode": "",
                        "leaderPct": 0,
                    }
                )

        stocks = list(getattr(daban_list, "stocks", []) or [])
        for row in rows:
            related = [s for s in stocks if row["name"] and row["name"] in getattr(s, "concept", "")]
            row["limitUps"] = len(related)
            row["firstBoards"] = len(related)
            row["maxBoard"] = self._infer_max_board(related)
            if not row["leader"] and related:
                row["leader"] = related[0].name
                row["leaderCode"] = related[0].code
            row["strength"] = round(abs(row["pct"]) * 1000 + row["limitUps"] * 850 + max(row["leaderPct"], 0) * 100, 1)
            row["role"] = "主线" if row["strength"] >= 3000 or row["limitUps"] >= 3 else "支线"
            row["stage"] = self._plate_stage(row["pct"], row["limitUps"], row["maxBoard"])
            row["capital"] = "机构主导" if row["pct"] >= 2 else "混合博弈"
        rows.sort(key=lambda item: item["strength"], reverse=True)
        return rows[:10]

    def _infer_max_board(self, stocks: list[Any]) -> int:
        max_board = 1 if stocks else 0
        for stock in stocks:
            text = " ".join(str(v) for v in getattr(stock, "ext", [])[:8])
            for n in range(10, 1, -1):
                if f"{n}板" in text or f"{n}连" in text:
                    max_board = max(max_board, n)
                    break
        return max_board

    def _plate_stage(self, pct: float, limit_ups: int, max_board: int) -> str:
        if max_board >= 5 or limit_ups >= 8:
            return "高潮"
        if limit_ups >= 3 or pct >= 2:
            return "发酵"
        if limit_ups >= 1 or pct > 0:
            return "启动"
        return "轮动"

    def _watchlist(self, daban_list: Any, plates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        stocks = list(getattr(daban_list, "stocks", []) or [])[:8]
        result = [
            {
                "name": "空仓观望",
                "code": "CASH",
                "theme": "防守",
                "condition": "若竞价负反馈扩散，优先执行防守策略",
                "priority": "默认",
            }
        ]
        priority = ["A类", "B类", "B类", "C类", "C类", "C类", "C类", "C类"]
        for idx, stock in enumerate(stocks):
            result.append(
                {
                    "name": getattr(stock, "name", ""),
                    "code": getattr(stock, "code", ""),
                    "theme": (getattr(stock, "concept", "") or (plates[0]["name"] if plates else "主线")).split(";")[0],
                    "condition": "放量回封且板块共振",
                    "priority": priority[idx] if idx < len(priority) else "C类",
                }
            )
        return result[:8]

    def _risks(self, limit_down: int, bomb_rate: float, sentiment: float, zhangting: Any) -> list[dict[str, Any]]:
        risks: list[dict[str, Any]] = []
        if limit_down >= 10:
            risks.append(
                {
                    "title": "跌停家数扩散风险",
                    "level": "高" if limit_down >= 30 else "中",
                    "text": f"跌停家数达到 {limit_down} 家，市场负反馈可能继续扩散。",
                }
            )
        if bomb_rate >= 30:
            risks.append(
                {
                    "title": "炸板率偏高",
                    "level": "高" if bomb_rate >= 45 else "中",
                    "text": f"炸板率约 {bomb_rate:.1f}%，追高交易需要降低预期。",
                }
            )
        if sentiment >= 80:
            risks.append(
                {
                    "title": "情绪高潮兑现风险",
                    "level": "中",
                    "text": "综合情绪进入高位区，注意一致转分歧。",
                }
            )
        if not risks:
            risks.append(
                {
                    "title": "三线未明显失衡",
                    "level": "低",
                    "text": getattr(zhangting, "sign", "") or "继续观察主线集中度和竞价反馈。",
                }
            )
        return risks

    def _methods(
        self,
        limit_up: int,
        broken: int,
        limit_down: int,
        bomb_rate: float,
        yesterday_premium: float,
    ) -> list[dict[str, Any]]:
        high_board = max(0, 100 - bomb_rate - limit_down * 0.7)
        first_board = min(100, max(0, limit_up * 0.7 - broken * 0.3 + 30))
        old_leader = min(100, max(0, 50 + yesterday_premium * 8 - limit_down * 0.5))
        cash = min(100, max(0, bomb_rate + limit_down * 1.5))
        return [
            {"name": "高位打板", "score": round(high_board, 1), "status": "观察" if high_board >= 55 else "回避", "note": "只看充分换手后的核心前排。"},
            {"name": "低位首板", "score": round(first_board, 1), "status": "可做" if first_board >= 60 else "观察", "note": "优先选择板块共振和回封质量。"},
            {"name": "老龙反抽", "score": round(old_leader, 1), "status": "观察", "note": "只在冰点修复或主线分歧时小仓试错。"},
            {"name": "空仓观望", "score": round(cash, 1), "status": "防守" if cash >= 55 else "备选", "note": "竞价和开盘反馈不达标时优先防守。"},
        ]

    def _opportunities(
        self,
        cycle: str,
        plates: list[dict[str, Any]],
        risks: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        high_risk = any(risk["level"] == "高" for risk in risks)
        if high_risk or not plates:
            return [
                {
                    "title": "等待明确信号",
                    "grade": "C",
                    "text": "当前尚未形成高确定性机会，优先观察盘中结构变化。",
                    "trigger": "风险指标转弱或主线确认",
                }
            ]
        lead = plates[0]
        return [
            {
                "title": f"{lead['name']} 前排确认",
                "grade": "A" if cycle in {"启动", "发酵"} else "B",
                "text": f"{lead['name']} 当前强度靠前，重点观察核心股竞价和回封效率。",
                "trigger": "板块涨幅维持前列，龙头不弱转强",
            }
        ]


data_service = DataService()
