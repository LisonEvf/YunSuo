from __future__ import annotations

import re
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

            trend_days = recent_weekdays(active_day, 15)
            trend = self._build_history_trend(kpl, trend_days, warnings)

            # 昨日打板股（用于计算 openPremium）
            prev_day = trend_days[-2] if len(trend_days) >= 2 else None
            prev_daban = capture("openkpl.history.prev_daban", lambda: kpl.history.daban_list(prev_day, st=30)) if prev_day else None

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
            prev_daban=prev_daban,
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
                zf_info = getattr(zf, "info", None)
                day_zt = int(pick_number(getattr(zf_info, "sj_zt", None), getattr(zt, "zt_count", 0)))
                day_dt = int(pick_number(getattr(zf_info, "sj_dt", None), getattr(zt, "dt_count", 0)))
                score = self._sentiment_score(zt=zt, zhangfu=zf)
                # 历史日 feng_ban_lv 不准确，用涨停/跌停比估算封板率
                seal_rate_raw = pick_number(getattr(zt, "feng_ban_lv", 0), default=-1)
                if seal_rate_raw > 30:
                    seal_rate = seal_rate_raw
                else:
                    seal_rate = day_zt / max(day_zt + day_dt * 0.4, 1) * 100
                bomb_rate = max(0, round(100 - seal_rate, 2))
                # 每日板块强度（热力图用）
                day_plates: list[dict[str, Any]] = []
                try:
                    pl = kpl.history.weight_performance_list(day, st=15)
                    for item in list(getattr(pl, "info", []) or [])[:15]:
                        name = getattr(item, "plate_name", "")
                        pct = pick_number(getattr(item, "pct", 0))
                        if name:
                            day_plates.append({"name": name, "strength": round(abs(pct) * 1000, 0)})
                except Exception:
                    pass
                points.append(
                    {
                        "date": day,
                        "score": score,
                        "limit_up": day_zt,
                        "limit_down": day_dt,
                        "amount": round(pick_number(getattr(volume, "last", 0)) / 10000, 2),
                        "seal_rate": round(seal_rate, 2),
                        "bomb_rate": bomb_rate,
                        "plates": day_plates,
                        "cycle": self._daily_status(score, day_dt, bomb_rate, day_zt),
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
        prev_daban: Any = None,
    ) -> dict[str, Any]:
        active_day = day or getattr(market_status, "day", "") or getattr(emotion, "day", "")
        daban = getattr(emotion, "daban", None)
        zhangfu_info = getattr(zhangfu, "info", None)

        limit_up = int(pick_number(getattr(daban, "t_zhangting", None), getattr(daily_nums, "zt", None), getattr(zhangting, "zt_count", None)))
        limit_down = int(pick_number(getattr(daban, "t_dieting", None), getattr(daily_nums, "dt", None), getattr(zhangting, "dt_count", None)))
        seal_rate = pick_number(getattr(daban, "t_fengban", None), getattr(zhangting, "feng_ban_lv", None), default=0)
        bomb_rate = max(0, round(100 - seal_rate, 2)) if seal_rate else 0
        broken = int(pick_number(getattr(daily_nums, "pb", None)))
        if broken <= 0 and seal_rate > 0 and limit_up > 0:
            broken = round(limit_up * (100 - seal_rate) / seal_rate)
        yesterday_premium = pick_number(getattr(daban, "zr_ztj", None), getattr(zhangting, "zt_avg_pct", None))
        link_board_premium = pick_number(getattr(daban, "zr_lbj", None))
        up_count = int(pick_number(getattr(daban, "sz_js", None), getattr(zhangfu_info, "sz_js", None)))
        down_count = int(pick_number(getattr(daban, "xd_js", None), getattr(zhangfu_info, "xd_js", None)))
        market_amount = round(pick_number(getattr(volume, "last", None), getattr(daban, "qscln", None)) / 10000, 2)
        sentiment = self._sentiment_score(daban=daban, zt=zhangting, zhangfu=zhangfu)
        # trend 最后一天用实际值覆盖，保证仪表盘与趋势图一致
        if trend:
            t = trend[-1]
            t["score"] = sentiment
            t["seal_rate"] = round(seal_rate, 2)
            t["bomb_rate"] = bomb_rate
            t["cycle"] = self._daily_status(sentiment, t["limit_down"], bomb_rate, t["limit_up"])
        # 为所有 trend 点预计算三线数据
        for t in trend:
            s, lu, ld = t["score"], t["limit_up"], t["limit_down"]
            t["marketCoef"] = round(s * 0.7 + (lu / max(lu + ld, 1)) * 30, 1)
            t["shortSentiment"] = round(s, 1)
            t["moneyLoss"] = round(max(0, min(100, (1 - ld / max(lu, 1)) * 100)), 1)
        cycle = self._cycle_label(sentiment, limit_down, bomb_rate, limit_up)
        advice = self._position_advice(sentiment, limit_down, bomb_rate)
        plate_rows = self._plate_rows(emotion, plates, plate_list, daban_list)
        plate_rows = self._fill_middle_stocks(plate_rows)
        watchlist = self._watchlist(daban_list, plate_rows)
        risks = self._risks(limit_down, bomb_rate, sentiment, zhangting, sharp)
        methods = self._methods(sentiment, limit_up, broken, limit_down, bomb_rate, yesterday_premium)

        index_pcts = [pick_number(row.get("pct")) for row in indexes]
        avg_index_pct = round(sum(index_pcts) / len(index_pcts), 2) if index_pcts else 0

        # 衍生指标
        # sj_zt = 实际涨停（非ST），不是首板涨停；需从 PHBList + daban_list ext 推算连板数
        link_board_count = self._count_link_boards(emotion, daban_list)
        first_board_count = max(0, limit_up - link_board_count)
        recent_bomb_rates = [t.get("bomb_rate", 0) for t in trend[-5:] if t.get("bomb_rate") is not None]
        bomb_rate_5d = round(sum(recent_bomb_rates) / max(len(recent_bomb_rates), 1), 2) if recent_bomb_rates else bomb_rate
        market_amount_delta = 0.0
        if len(trend) >= 2:
            prev_amount = trend[-2].get("amount", 0)
            if prev_amount > 0:
                market_amount_delta = round((market_amount - prev_amount) / prev_amount * 100, 2)
        non_board_up = max(0, up_count - limit_up)
        non_board_total = max(1, up_count + down_count - limit_up - limit_down)
        non_board_temp = round(non_board_up / non_board_total * 100, 1)

        # 涨跌幅分布（从 zhangfu_detail.buckets 提取）
        zhangfu_buckets = getattr(getattr(zhangfu, "info", None), "buckets", None) or {}
        zhangfu_distribution = [
            {"range": f"{k:+d}%", "count": v} for k, v in sorted(zhangfu_buckets.items(), key=lambda x: int(x[0]))
        ]

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
                "bombRate5d": bomb_rate_5d,
                "firstBoardCount": first_board_count,
                "linkBoardCount": link_board_count,
                "marketAmountDelta": market_amount_delta,
                "nonBoardTemp": non_board_temp,
                "openPremium": self._calc_open_premium(prev_daban),
                "marketCoef": round(50 + avg_index_pct * 10, 1),
                "zhangfuDistribution": zhangfu_distribution,
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
        info = getattr(zhangfu, "info", None)
        limit_up = int(pick_number(getattr(info, "sj_zt", None), getattr(zt, "zt_count", None), default=30))
        limit_down = int(pick_number(getattr(info, "sj_dt", None), getattr(zt, "dt_count", None), default=20))
        up_count = pick_number(getattr(info, "sz_js", None), default=2500)
        down_count = pick_number(getattr(info, "xd_js", None), default=2500)
        breadth = up_count / max(up_count + down_count, 1) * 100
        # 不再依赖 feng_ban_lv（历史日不准确），用涨停/跌停比估算封板强度
        seal_strength = min(limit_up, 120) / max(min(limit_up, 120) + limit_down * 0.4, 1) * 100
        score = seal_strength * 0.35 + min(limit_up, 120) / 120 * 35 + breadth * 0.2 - min(limit_down, 80) / 80 * 20
        return round(max(0, min(score, 100)), 1)

    # 细化标签 → 6阶粗标签映射（stepper用）
    _FINE_TO_COARSE: dict[str, str] = {
        "冰冰点": "冰点",
        "冰点": "冰点",
        "背离": "退潮",
        "耦合": "常态",
        "退潮": "退潮",
        "常态": "常态",
        "启动": "启动",
        "发酵": "发酵",
        "高潮": "高潮",
    }

    def _daily_status(self, sentiment: float, limit_down: int, bomb_rate: float, limit_up: int) -> str:
        """唯一真值源：返回细化周期标签。"""
        if sentiment < 10 or limit_down >= 40:
            return "冰冰点"
        if limit_down >= 50 or sentiment < 20:
            return "冰点"
        if (limit_up >= 60 and sentiment < 40) or (limit_up <= 20 and sentiment >= 60):
            return "背离"
        if bomb_rate < 25 and 40 <= sentiment <= 60:
            return "耦合"
        if sentiment < 35 or bomb_rate >= 45:
            return "退潮"
        if sentiment < 55:
            return "常态"
        if sentiment < 70:
            return "启动"
        if sentiment < 85:
            return "发酵"
        return "高潮"

    def _cycle_label(self, sentiment: float, limit_down: int, bomb_rate: float, limit_up: int = 0) -> str:
        """从 _daily_status 映射到 6 阶粗标签（供 stepper 使用）。"""
        fine = self._daily_status(sentiment, limit_down, bomb_rate, limit_up)
        return self._FINE_TO_COARSE.get(fine, fine)

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

        # PHBList(涨停排行) concept 更干净，优先用于匹配
        phb_stocks = list(getattr(emotion, "phb", []) or [])
        daban_stocks = list(getattr(daban_list, "stocks", []) or [])

        for row in rows:
            # 两阶段匹配：PHBList（概念名更精准）→ daban_list（覆盖面更广）
            related = self._match_stocks_to_plate(row["name"], row["code"], phb_stocks, daban_stocks)
            link_boards = [s for s in related if self._is_link_board_stock(s)]
            first_boards_count = len(related) - len(link_boards)

            row["limitUps"] = len(related)
            row["firstBoards"] = first_boards_count
            row["linkBoardCount"] = len(link_boards)
            row["maxBoard"] = self._infer_max_board(related)
            if not row["leader"] and related:
                # 优先取连板股做龙头，否则取第一个
                leader = next((s for s in related if self._is_link_board_stock(s)), related[0])
                row["leader"] = getattr(leader, "name", "")
                row["leaderCode"] = getattr(leader, "code", "")
            # 强度公式：基础(pct*1000 与 heatmap 一致) + 涨停家数 + 连板高度 + 龙头涨幅
            row["strength"] = round(
                abs(row["pct"]) * 1000 + row["limitUps"] * 600 + row["maxBoard"] * 1200 + max(row["leaderPct"], 0) * 100,
                1,
            )
            row["role"] = "主线" if row["strength"] >= 3000 or row["limitUps"] >= 3 else "支线"
            row["stage"] = self._plate_stage(row["pct"], row["limitUps"], row["maxBoard"])
            row["capital"] = self._infer_capital_type(row, daban_stocks)
        rows.sort(key=lambda item: item["strength"], reverse=True)
        total_limit_ups = max(sum(r["limitUps"] for r in rows[:10]), 1)
        for row in rows[:10]:
            row["sharePct"] = round(row["limitUps"] / total_limit_ups * 100, 1)
            row["middleStock"] = ""
            row["middleCode"] = ""
        return rows[:10]

    def _match_stocks_to_plate(
        self, plate_name: str, plate_code: str, phb_stocks: list[Any], daban_stocks: list[Any]
    ) -> list[Any]:
        """两阶段匹配：PHBList concept（精准）→ daban_list concept（广泛）。"""
        seen: set[str] = set()
        matched: list[Any] = []

        def _try_add(stock: Any) -> None:
            code = getattr(stock, "code", "")
            if code and code not in seen:
                seen.add(code)
                matched.append(stock)

        # 阶段1：PHBList（概念名更精准，如"元器件"直接匹配板名"元件"）
        for stock in phb_stocks:
            concept = getattr(stock, "concept", "")
            tags = getattr(stock, "tags", "")
            if self._concept_match(plate_name, concept) or self._concept_match(plate_name, tags):
                _try_add(stock)

        # 阶段2：daban_list（概念更广泛，如"AI PC、端侧AI"）
        for stock in daban_stocks:
            concept = getattr(stock, "concept", "")
            if self._concept_match(plate_name, concept):
                _try_add(stock)

        return matched

    @staticmethod
    def _concept_match(plate_name: str, concept: str) -> bool:
        """板块名与概念标签双向匹配。支持多分隔符拆分后逐词匹配，含子序列匹配。"""
        if not plate_name or not concept:
            return False
        # 精确子串匹配
        if plate_name in concept:
            return True
        # 拆分关键词逐词匹配
        keywords = re.split(r"[、，,;|/\s]+", concept)
        for kw in keywords:
            kw = kw.strip()
            if len(kw) < 2:
                continue
            if plate_name in kw or kw in plate_name:
                return True
            # 子序列匹配：板块名字符按序出现在关键词中（如 "元件" 匹配 "元器件"）
            it = iter(kw)
            if all(c in it for c in plate_name):
                return True
        return False

    @staticmethod
    def _is_link_board_stock(stock: Any) -> bool:
        """判断个股是否为连板股（含"N板"/"N连" ext 信息）。"""
        lianban = getattr(stock, "lianban", "")
        if lianban and "板" in lianban:
            return True
        text = " ".join(str(v) for v in getattr(stock, "ext", [])[:8])
        for n in range(10, 1, -1):
            if f"{n}板" in text or f"{n}连" in text:
                return True
        return False

    def _infer_max_board(self, stocks: list[Any]) -> int:
        max_board = 1 if stocks else 0
        for stock in stocks:
            lianban = getattr(stock, "lianban", "")
            if lianban:
                m = re.search(r"(\d+)板", lianban)
                if m:
                    max_board = max(max_board, int(m.group(1)))
                    continue
            text = " ".join(str(v) for v in getattr(stock, "ext", [])[:8])
            for n in range(10, 1, -1):
                if f"{n}板" in text or f"{n}连" in text:
                    max_board = max(max_board, n)
                    break
        return max_board

    def _infer_capital_type(self, plate_row: dict[str, Any], daban_stocks: list[Any]) -> str:
        """从打板股主力净流入判断资金类型。"""
        plate_name = plate_row["name"]
        total_main_net = 0
        count = 0
        for stock in daban_stocks:
            concept = getattr(stock, "concept", "")
            if self._concept_match(plate_name, concept):
                net_in = getattr(stock, "main_net_in", 0) or 0
                total_main_net += net_in
                count += 1
        if count > 0 and total_main_net > 0:
            return "机构主导"
        if plate_row["pct"] >= 2:
            return "游资主导"
        return "混合博弈"

    def _fill_middle_stocks(self, plate_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """用 TDX 板块成分股按市值排选取中军股。"""
        try:
            with TdxClient() as client:
                for row in plate_rows:
                    code = row.get("code", "")
                    leader_code = row.get("leaderCode", "")
                    if not code:
                        continue
                    try:
                        members = client.stock_board_members(
                            code, count=15, sort_type=SORT_TYPE.MARKET_CAP, sort_order=SORT_ORDER.DESC
                        )
                        for m in members or []:
                            m_code = str(m.get("code", ""))
                            m_close = pick_number(m.get("close", 0))
                            m_pre_close = pick_number(m.get("pre_close", 0))
                            # 中军：市值最大、涨幅正向、非龙头
                            if m_code and m_code != leader_code and m_close > 0 and m_close >= m_pre_close:
                                row["middleStock"] = m.get("name", "")
                                row["middleCode"] = m_code
                                break
                    except Exception:
                        pass
        except Exception:
            pass
        return plate_rows

    def _count_link_boards(self, emotion: Any, daban_list: Any) -> int:
        """从 PHBList + daban_list 统计连板股总数。"""
        count = 0
        seen: set[str] = set()
        # PHBList 有 lianban 字段
        for stock in list(getattr(emotion, "phb", []) or []):
            lianban = getattr(stock, "lianban", "")
            if lianban and "板" in lianban:
                code = getattr(stock, "code", "")
                if code:
                    seen.add(code)
                count += 1
        # daban_list ext 字段
        for stock in list(getattr(daban_list, "stocks", []) or []):
            code = getattr(stock, "code", "")
            if code in seen:
                continue
            if self._is_link_board_stock(stock):
                seen.add(code)
                count += 1
        return count

    def _calc_open_premium(self, prev_daban: Any) -> str:
        """计算昨日打板股今日开盘溢价（平均开盘涨幅）。"""
        stocks = list(getattr(prev_daban, "stocks", []) or [])[:20]
        if not stocks:
            return "--"
        try:
            with TdxClient() as client:
                pairs = []
                for stock in stocks:
                    code = getattr(stock, "code", "")
                    if not code:
                        continue
                    market = MARKET.SH if code.startswith(("6", "9")) else MARKET.SZ
                    if code.startswith("3") and len(code) == 6:
                        market = MARKET.SZ
                    if code.startswith("8") or code.startswith("4"):
                        market = MARKET.BJ
                    pairs.append((market, code))
                quotes = client.stock_quotes(pairs) if pairs else []
                premiums = []
                for q in quotes:
                    open_p = pick_number(q.get("open", 0))
                    pre_close = pick_number(q.get("pre_close", 0))
                    if open_p > 0 and pre_close > 0:
                        premiums.append(round((open_p - pre_close) / pre_close * 100, 2))
                if premiums:
                    return f"{round(sum(premiums) / len(premiums), 2)}%"
        except Exception:
            pass
        return "--"

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

    def _risks(self, limit_down: int, bomb_rate: float, sentiment: float, zhangting: Any, sharp: Any = None) -> list[dict[str, Any]]:
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
        # 急速回撤风险
        sharp_num = int(pick_number(getattr(sharp, "num", None), default=0))
        if sharp_num >= 5:
            sharp_stocks = list(getattr(sharp, "stocks", []) or [])[:3]
            names = "、".join(getattr(s, "name", "") for s in sharp_stocks)
            risks.append(
                {
                    "title": "急速回撤预警",
                    "level": "高" if sharp_num >= 8 else "中",
                    "text": f"盘中急速回撤 {sharp_num} 只（{names}），高位接力风险加大。",
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
        sentiment: float,
        limit_up: int,
        broken: int,
        limit_down: int,
        bomb_rate: float,
        yesterday_premium: float,
    ) -> list[dict[str, Any]]:
        # 空仓观望：信号不足或亏钱效应偏强时推荐
        cash = min(100, max(0, bomb_rate * 0.5 + limit_down * 1.0 + (100 - sentiment) * 0.4))
        # 超跌反弹：冰点修复初期、分歧末端
        bounce = min(100, max(0, 60 - sentiment * 0.6 - limit_down * 0.5 + max(0, 25 - bomb_rate) * 0.8))
        # 低吸半路：主线明确、回流确认
        dip = min(100, max(0, sentiment * 0.5 + max(0, 50 - bomb_rate) * 0.6 + max(0, yesterday_premium) * 3))
        # 首板打板：封板质量、板块带动、承接
        first_board = min(100, max(0, limit_up * 0.7 - broken * 0.3 + max(0, 50 - bomb_rate) * 0.5))
        # 龙头接力：情绪强、赚钱效应好
        relay = min(100, max(0, sentiment * 0.6 + max(0, 100 - bomb_rate * 2) * 0.3 + yesterday_premium * 5 - limit_down * 0.5))
        # 高位打板：强趋势延续、炸板率可控
        high_board = min(100, max(0, sentiment * 0.5 - bomb_rate * 0.8 - limit_down * 0.7 + 20))
        return [
            {"name": "空仓观望", "score": round(cash, 1), "status": "推荐" if cash >= 60 else "备选", "note": "当信号不足或亏钱效应偏强时，休息本身就是策略。"},
            {"name": "超跌反弹", "score": round(bounce, 1), "status": "可做" if bounce >= 50 else "观察", "note": "只适合在分歧末端、情绪修复初期轻仓试错。"},
            {"name": "低吸半路", "score": round(dip, 1), "status": "可做" if dip >= 55 else "观察", "note": "更依赖主线明确和回流确认，不适合盲目埋伏。"},
            {"name": "首板打板", "score": round(first_board, 1), "status": "可做" if first_board >= 55 else "观察", "note": "需要封板质量、板块带动和承接都在线。"},
            {"name": "龙头接力", "score": round(relay, 1), "status": "可做" if relay >= 55 else "回避", "note": "更吃情绪强弱与赚钱效应，高潮和退潮期都容易失真。"},
            {"name": "高位打板", "score": round(high_board, 1), "status": "观察" if high_board >= 50 else "回避", "note": "仅在强趋势延续、炸板率可控时才有价值。"},
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
