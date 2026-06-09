"""上下文管理 — token 追踪、自动压缩。

借鉴 hermes-agent ContextCompressor 的 head/tail 保护策略，
用辅助 LLM 摘要中间轮次，避免长对话撑爆 context window。
"""
from __future__ import annotations

import logging
from typing import Any

from . import config

logger = logging.getLogger(__name__)

CHARS_PER_TOKEN = 3.5  # 中英混合经验值
COMPRESS_THRESHOLD = 0.75
PROTECT_RECENT_TURNS = 4  # 保护最近 N 轮（user+assistant = 2 条/轮）


class ContextManager:
    def __init__(self):
        config.reload_config()
        self.max_tokens = config.CONTEXT_WINDOW_TOKENS
        self.total_prompt_tokens = 0
        self.total_completion_tokens = 0
        self.compression_count = 0

    def estimate_tokens(self, messages: list[dict]) -> int:
        """粗估 token 数。"""
        total = 0
        for msg in messages:
            content = msg.get("content", "")
            if isinstance(content, str):
                total += len(content) / CHARS_PER_TOKEN
            elif isinstance(content, list):
                for part in content:
                    if isinstance(part, dict):
                        total += len(part.get("text", "")) / CHARS_PER_TOKEN
            total += 10  # role + metadata 开销
        return int(total)

    def should_compress(self, messages: list[dict], usage_tokens: int = 0) -> bool:
        if usage_tokens > 0:
            return usage_tokens >= self.max_tokens * COMPRESS_THRESHOLD
        return self.estimate_tokens(messages) >= self.max_tokens * COMPRESS_THRESHOLD

    async def compress(self, messages: list[dict]) -> list[dict]:
        """压缩上下文：保留 system + 最近 N 轮，摘要中间部分。"""
        if len(messages) <= 3:
            return messages

        system_msgs = [m for m in messages if m.get("role") == "system"]
        non_system = [m for m in messages if m.get("role") != "system"]

        protect_count = PROTECT_RECENT_TURNS * 2
        if len(non_system) <= protect_count:
            return messages

        old_messages = non_system[:-protect_count]
        recent_messages = non_system[-protect_count:]
        if not old_messages:
            return messages

        summary = await self._summarize(old_messages)
        self.compression_count += 1

        summary_msg = {
            "role": "system",
            "content": (
                "[上下文摘要 — 以下是之前对话的压缩摘要，作为背景参考，不要回答其中提及的问题：]\n\n"
                f"{summary}"
            ),
        }

        logger.info("Context compressed: %d old messages → 1 summary", len(old_messages))
        return [*system_msgs, summary_msg, *recent_messages]

    async def _summarize(self, messages: list[dict]) -> str:
        """用 LLM 生成摘要。"""
        from openai import AsyncOpenAI

        parts = []
        for msg in messages:
            role = msg.get("role", "")
            content = msg.get("content", "")
            if isinstance(content, str) and content.strip():
                parts.append(f"[{role}]: {content[:500]}")

        if not parts:
            return "（无历史对话内容）"

        text = "\n".join(parts)
        if len(text) > 6000:
            text = text[:6000] + "\n...[截断]"

        try:
            config.reload_config()
            client = AsyncOpenAI(api_key=config.LLM_API_KEY, base_url=config.LLM_BASE_URL)
            response = await client.chat.completions.create(
                model=config.LLM_MODEL,
                messages=[
                    {
                        "role": "system",
                        "content": "你是一个对话摘要助手。请将以下对话历史压缩为简洁的中文摘要（200字以内），保留关键事实、数据和结论。不要遗漏重要数字。",
                    },
                    {"role": "user", "content": text},
                ],
                max_tokens=300,
                temperature=0.3,
            )
            return response.choices[0].message.content or "（摘要生成失败）"
        except Exception as exc:
            logger.warning("Context summarization failed: %s", exc)
            return self._manual_summary(messages)

    @staticmethod
    def _manual_summary(messages: list[dict]) -> str:
        """LLM 摘要失败时的降级：拼接 assistant 回复片段。"""
        parts = []
        for msg in messages:
            if msg.get("role") == "assistant" and msg.get("content"):
                text = msg["content"][:200].strip()
                if text:
                    parts.append(text)
        if not parts:
            return "（历史对话已压缩）"
        return "；".join(parts[:3])

    def update_usage(self, prompt_tokens: int, completion_tokens: int) -> None:
        self.total_prompt_tokens += prompt_tokens
        self.total_completion_tokens += completion_tokens

    def get_usage(self) -> dict[str, Any]:
        return {
            "prompt_tokens": self.total_prompt_tokens,
            "completion_tokens": self.total_completion_tokens,
            "total_tokens": self.total_prompt_tokens + self.total_completion_tokens,
            "compression_count": self.compression_count,
            "context_limit": self.max_tokens,
        }
