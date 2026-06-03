"""工具调用防护 — 重复检测、频率限制。

借鉴 hermes-agent tool_guardrails 的幂等/变异分类思路，
防止 LLM 在同一轮次内重复调用相同工具浪费 token。
"""
from __future__ import annotations

import hashlib
import json
import logging
from collections import defaultdict
from dataclasses import dataclass

logger = logging.getLogger(__name__)

MAX_DUPLICATE_CALLS = 2
MAX_CALLS_PER_TOOL = 5

IDEMPOTENT_TOOLS = frozenset({
    "get_sentiment_overview", "get_plate_top", "get_trend_history",
    "get_stock_quotes", "get_stock_kline", "get_board_list",
    "get_board_members", "get_market_emotion", "get_news_flash",
    "get_plate_ranking", "get_stock_zhangting_gene", "get_stock_plates",
    "get_theme_detail",
})


@dataclass
class GuardrailDecision:
    allows_execution: bool = True
    reason: str = ""


class ToolGuardrails:
    def __init__(self):
        self._call_history: list[tuple[str, str]] = []
        self._tool_counts: dict[str, int] = defaultdict(int)

    def reset_turn(self):
        self._call_history.clear()
        self._tool_counts.clear()

    def check(self, name: str, args: dict) -> GuardrailDecision:
        if self._tool_counts[name] >= MAX_CALLS_PER_TOOL:
            return GuardrailDecision(
                allows_execution=False,
                reason=f"工具 {name} 本轮已调用 {self._tool_counts[name]} 次，达到上限。请使用已有数据继续分析。",
            )

        if name not in IDEMPOTENT_TOOLS:
            args_hash = _hash_args(args)
            dup = sum(1 for n, h in self._call_history if n == name and h == args_hash)
            if dup >= MAX_DUPLICATE_CALLS:
                return GuardrailDecision(
                    allows_execution=False,
                    reason=f"工具 {name} 已用相同参数调用过，请勿重复。",
                )

        return GuardrailDecision(allows_execution=True)

    def record(self, name: str, args: dict):
        self._tool_counts[name] += 1
        self._call_history.append((name, _hash_args(args)))


def _hash_args(args: dict) -> str:
    canonical = json.dumps(args, sort_keys=True, ensure_ascii=False)
    return hashlib.md5(canonical.encode()).hexdigest()
