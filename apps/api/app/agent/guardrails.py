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
    "get_agent_runtime_status",
    "render_airui_panel",
    "patch_airui_panel",
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


# ── 工具名修复（借鉴 hermes-agent repair_tool_call）──────────────────────
# LLM 有时会输出工具名变体：大小写错误、连字符/空格分隔、CamelCase、
# 多余 _tool 后缀等。在放弃前先尝试修复，避免 "Unknown tool" 错误。

def repair_tool_name(name: str, valid_names: set[str]) -> str | None:
    """尝试把 LLM 输出的工具名变体修复为有效工具名。

    步骤（借鉴 hermes-agent）：
    1. XML/引号截断（处理 VolcEngine 等平台的属性泄漏）
    2. 小写直接匹配
    3. 连字符/空格转下划线
    4. CamelCase 转 snake_case
    5. 去掉 _tool 后缀
    6. 模糊匹配（difflib, cutoff=0.7）
    """
    import re
    from difflib import get_close_matches

    if not name or not valid_names:
        return None

    cleaned = name
    # 1. 截断 XML/引号泄漏（如 `terminal" parameter="command"`）
    for ch in ('"', "'", "<"):
        idx = cleaned.find(ch)
        if idx > 0:
            cleaned = cleaned[:idx].strip()

    # 2. 小写直接匹配
    low = cleaned.lower()
    if low in valid_names:
        return low

    # 3. 连字符/空格转下划线
    norm = low.replace("-", "_").replace(" ", "_")
    if norm in valid_names:
        return norm

    # 4. CamelCase 转 snake_case
    snake = re.sub(r"(?<!^)(?=[A-Z])", "_", cleaned).lower().replace("-", "_").replace(" ", "_")
    if snake in valid_names:
        return snake

    # 5. 去掉 _tool 后缀（可能需要多次）
    stripped = snake
    for _ in range(3):
        for suffix in ("_tool", "_fn", "_function"):
            if stripped.endswith(suffix):
                stripped = stripped[: -len(suffix)]
                break
        else:
            break
    if stripped in valid_names:
        return stripped

    # 6. 模糊匹配
    matches = get_close_matches(norm, list(valid_names), n=1, cutoff=0.7)
    return matches[0] if matches else None


# ── 工具调用去重（借鉴 hermes-agent _deduplicate_tool_calls）─────────────
# 在单轮内去除完全相同的 (tool_name, args_json) 重复调用，只保留第一个。

def deduplicate_tool_calls(
    pending: list[tuple[str, str, dict]],
) -> list[tuple[str, str, dict]]:
    """去除单轮内完全重复的 (id, name, args) 调用。

    pending 格式：[(call_id, tool_name, args_dict), ...]
    相同 name + 相同 args 的调用只保留第一个。
    """
    seen: set[tuple[str, str]] = set()
    unique: list[tuple[str, str, dict]] = []
    for call_id, name, args in pending:
        args_key = json.dumps(args, sort_keys=True, ensure_ascii=False)
        key = (name, args_key)
        if key not in seen:
            seen.add(key)
            unique.append((call_id, name, args))
        else:
            logger.info("去重：移除重复工具调用 %s（相同参数）", name)
    return unique
