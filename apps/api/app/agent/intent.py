"""结构化意图（Intent）模型 —— 生成式 UI 点击即对话的基石。

设计参见 docs/generative-ui-agent-design.md §4「点击即对话」。

传统交互：点击 → 自然语言描述 → agent 当普通文本理解。
生成式 UI：点击 → 结构化意图 payload → agent 精准生成下一屏。

意图通过 user message 的「信封」传输，保持对现有消息驱动 agent loop
的最小侵入：前端在 user content 里嵌入一个 <<yunsuo-intent:...>> 标记块，
后端 parse_intent_envelope 解析并还原为 Intent 对象，再由 agent loop
显式注入 system prompt（而非让 LLM 从自然语言里猜）。
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

# 消息信封标记。设计为单行可嵌入任意 user content 的前缀块，
# 既便于正则解析，又能在 LLM 视角下作为显式结构化上下文。
_ENVELOPE_BEGIN = "<<yunsuo-intent:"
_ENVELOPE_END = ">>"

_ENVELOPE_RE = re.compile(
    re.escape(_ENVELOPE_BEGIN) + r"\s*(\{.*?\})\s*" + re.escape(_ENVELOPE_END),
    re.DOTALL,
)


@dataclass
class Intent:
    """一次点击提交的结构化意图。

    action:   动作类别，如 open / drilldown / filter / select / export / custom
    target:   目标对象引用，通常是 AIRUI 组件 ref（如 artifact-sales-table）
    label:    人类可读的预判标签（点击会做什么 / 为什么摆这个选项）
    params:   附带参数（行数据、筛选值、选中项等）
    source:   来源描述，如 widget ref + interaction 类型
    prompt:   自由文本兜底（预判不准时用户补充，或旧版 action.prompt）
    """

    action: str = ""
    target: str = ""
    label: str = ""
    params: dict[str, Any] = field(default_factory=dict)
    source: str = ""
    prompt: str = ""

    def is_empty(self) -> bool:
        return not (self.action or self.target or self.label or self.prompt)

    def to_context_block(self) -> str:
        """格式化为注入 system prompt 的结构化上下文块。"""
        if self.is_empty():
            return ""
        lines = [
            "## Current Click Intent (structured)",
            "The user just clicked an interactive element. Treat this structured intent as",
            "the authoritative description of what they want next, more precise than any",
            "surrounding prose. Respond by rendering the next AIRUI screen that serves it.",
        ]
        if self.action:
            lines.append(f"- action: {self.action}")
        if self.target:
            lines.append(f"- target: {self.target}")
        if self.label:
            lines.append(f"- predicted_label: {self.label}")
        if self.source:
            lines.append(f"- source: {self.source}")
        if self.params:
            try:
                params_json = json.dumps(self.params, ensure_ascii=False)
            except (TypeError, ValueError):
                params_json = str(self.params)
            if len(params_json) > 800:
                params_json = params_json[:800] + "…(truncated)"
            lines.append(f"- params: {params_json}")
        if self.prompt:
            lines.append(f"- freeform_hint: {self.prompt}")
        lines.append("")
        lines.append(
            "If the intent is ambiguous, render the most likely next screen AND attach a"
            " `correct` action (label like \"不对，我想…\") so the user can correct cheaply."
        )
        return "\n".join(lines)


def encode_intent_envelope(intent: dict[str, Any]) -> str:
    """把意图字典编码为可嵌入 user content 的信封字符串。"""
    compact = json.dumps(intent, ensure_ascii=False, separators=(",", ":"))
    return f"{_ENVELOPE_BEGIN}{compact}{_ENVELOPE_END}"


def parse_intent_envelope(content: str) -> tuple[Intent, str]:
    """从 user content 中解析意图信封。

    返回 (Intent, 剥离信封后的剩余自然语言)。无信封时返回空 Intent 与原文。
    """
    if not content or not isinstance(content, str):
        return Intent(), content or ""
    match = _ENVELOPE_RE.search(content)
    if not match:
        return Intent(), content
    raw_json = match.group(1)
    try:
        data = json.loads(raw_json)
    except json.JSONDecodeError:
        return Intent(), content
    if not isinstance(data, dict):
        return Intent(), content
    remaining = (content[: match.start()] + content[match.end():]).strip()
    intent = Intent(
        action=str(data.get("action") or ""),
        target=str(data.get("target") or ""),
        label=str(data.get("label") or data.get("predicted_label") or ""),
        source=str(data.get("source") or ""),
        params=data.get("params") if isinstance(data.get("params"), dict) else {},
        prompt=str(data.get("prompt") or data.get("freeform_hint") or ""),
    )
    return intent, remaining


def extract_intents_from_messages(
    messages: list[dict[str, Any]],
) -> tuple[Intent | None, list[dict[str, Any]]]:
    """从消息列表中提取最近一条 user 消息的意图。

    返回 (最近意图或 None, 清洗后的消息列表)。清洗指把 user content 里的
    信封剥离，保留自然语言部分，避免信封噪音进入 LLM 上下文。
    """
    cleaned: list[dict[str, Any]] = []
    latest_intent: Intent | None = None
    for msg in messages:
        role = msg.get("role")
        content = msg.get("content")
        if role == "user" and isinstance(content, str):
            intent, remaining = parse_intent_envelope(content)
            if not intent.is_empty():
                latest_intent = intent
            new_msg = dict(msg)
            # 信封剥离后若只剩意图无自然语言，用 label/prompt 作为可读内容兜底，
            # 保证 LLM 仍能看到一条可理解的 user turn。
            if not remaining and not intent.is_empty():
                remaining = intent.label or intent.prompt or f"[{intent.action}] {intent.target}"
            new_msg["content"] = remaining
            cleaned.append(new_msg)
        else:
            cleaned.append(msg)
    return latest_intent, cleaned


# ── 预判偏差记忆（Prediction Miss Memory）──────────────────────
# 设计参见 docs/generative-ui-agent-design.md §5「预判、修正与记忆」。
# 当用户修正了 agent 的预判（点击 correct / 修正入口），前端把
# corrected_from（原预判意图）连同实际意图一起回传。后端记录为偏差样本，
# 写入 data/reviews/prediction_misses.jsonl，并可在下一轮注入 system prompt，
# 让预判随使用越来越准。

import threading
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[4]
PREDICTION_MISS_FILE = PROJECT_ROOT / "data" / "reviews" / "prediction_misses.jsonl"
_RECENT_PREDICTION_MISSES_LIMIT = 8


class PredictionMissRecorder:
    """把"预判 vs 实际"偏差样本追加写入 JSONL，线程安全。"""

    def __init__(self, path: Path = PREDICTION_MISS_FILE):
        self.path = path
        self._lock = threading.Lock()

    def record(
        self,
        *,
        predicted: dict[str, Any] | None,
        actual: "Intent",
        context: str = "",
    ) -> Path | None:
        if actual.is_empty():
            return None
        sample = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "predicted": predicted or {},
            "actual": {
                "action": actual.action,
                "target": actual.target,
                "label": actual.label,
                "params": actual.params,
                "prompt": actual.prompt,
            },
            "context": (context or "")[:240],
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(sample, ensure_ascii=False, default=str)
        with self._lock:
            with self.path.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        return self.path

    def recent(self, limit: int = _RECENT_PREDICTION_MISSES_LIMIT) -> list[dict[str, Any]]:
        """读取最近的偏差样本（倒序，最多 limit 条）。读取失败静默返回空列表。"""
        if not self.path.exists():
            return []
        try:
            with self._lock:
                lines = self.path.read_text(encoding="utf-8").splitlines()
        except OSError:
            return []
        out: list[dict[str, Any]] = []
        for line in reversed(lines):
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
            if len(out) >= limit:
                break
        return out


prediction_miss_recorder = PredictionMissRecorder()


def record_prediction_miss_if_any(intent: "Intent", context: str = "") -> Path | None:
    """如果意图携带 corrected_from（被修正的原预判），记录一条偏差样本。

    返回写入路径；无 corrected_from 时返回 None。
    """
    corrected_from = intent.params.get("corrected_from") if intent.params else None
    if not isinstance(corrected_from, dict):
        return None
    return prediction_miss_recorder.record(
        predicted=corrected_from,
        actual=intent,
        context=context,
    )


def build_prediction_miss_context_block(limit: int = _RECENT_PREDICTION_MISSES_LIMIT) -> str:
    """把最近的预判偏差样本格式化为可注入 system prompt 的上下文块。

    让 agent 看到过去哪些预判被纠正过，从而在生成 actions 时避开同类误判。
    """
    samples = prediction_miss_recorder.recent(limit=limit)
    if not samples:
        return ""
    lines = [
        "## Recent Prediction Misses (learn from these corrections)",
        "These are recent cases where your predicted action was NOT what the user wanted.",
        "When generating actions / predicted affordances below, avoid repeating these mismatches.",
    ]
    for i, sample in enumerate(samples, 1):
        predicted = sample.get("predicted") or {}
        actual = sample.get("actual") or {}
        pa = predicted.get("action") or "?"
        pt = predicted.get("target") or predicted.get("label") or "?"
        plabel = predicted.get("label")
        aa = actual.get("action") or "?"
        at = actual.get("target") or actual.get("label") or actual.get("prompt") or "?"
        alabel = actual.get("label") or actual.get("prompt")
        ctx = sample.get("context") or ""
        p_part = f"{pa}:{pt}{(' ' + plabel) if plabel and plabel != pt else ''}"
        a_part = f"{aa}:{at}{(' ' + alabel) if alabel and alabel != at else ''}"
        lines.append(f"{i}. predicted[{p_part}] -> user wanted[{a_part}]{(' ' + ctx) if ctx else ''}")
    return "\n".join(lines)
