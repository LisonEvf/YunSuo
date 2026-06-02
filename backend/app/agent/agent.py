"""核心 Agent —— 复刻 hermes-agent 的 conversation loop 模式。

对话循环：
  user message → LLM → tool_calls → execute → LLM → ... → final response

支持：
  - 普通请求（非流式）
  - SSE 流式请求（逐 token 输出 + 工具调用状态推送）
"""
from __future__ import annotations

import json
import logging
from typing import Any, AsyncIterator

from openai import AsyncOpenAI, APIStatusError

from .config import AGENT_MAX_ITERATIONS, LLM_API_KEY, LLM_BASE_URL, LLM_MAX_TOKENS, LLM_MODEL

# 粗估 context 上限（字符数），tool 结果超过此值会被截断
_MAX_TOOL_RESULT_CHARS = 6000
from .system_prompt import SYSTEM_PROMPT
from .tools import TOOL_DEFINITIONS, execute_tool

logger = logging.getLogger(__name__)


class SentimentAgent:
    """市场情绪分析 Agent。"""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
    ):
        self.api_key = api_key or LLM_API_KEY
        self.base_url = base_url or LLM_BASE_URL
        self.model = model or LLM_MODEL
        self.client = AsyncOpenAI(api_key=self.api_key, base_url=self.base_url)
        self.tools = TOOL_DEFINITIONS

    def _build_messages(
        self,
        messages: list[dict[str, Any]],
        skills: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        from .skills import build_skill_prompt

        system_content = SYSTEM_PROMPT
        if skills:
            parts: list[str] = []
            for slug in skills:
                prompt = build_skill_prompt(slug.strip().lstrip("/"))
                if prompt:
                    parts.append(prompt)
            if parts:
                system_content += "\n\n" + "\n\n---\n\n".join(parts)

        return [{"role": "system", "content": system_content}, *messages]

    # ── 非流式对话 ──────────────────────────────────────────────

    async def chat(
        self,
        messages: list[dict[str, Any]],
        skills: list[str] | None = None,
    ) -> dict[str, Any]:
        """运行完整对话循环，返回最终回复。"""
        api_messages = self._build_messages(messages, skills=skills)
        tool_calls_log: list[dict[str, Any]] = []

        for _ in range(AGENT_MAX_ITERATIONS):
            try:
                response = await self.client.chat.completions.create(
                    model=self.model,
                    messages=api_messages,
                    tools=self.tools,
                    max_tokens=LLM_MAX_TOKENS,
                )
            except APIStatusError as exc:
                logger.warning("LLM API error: %s %s", exc.status_code, exc.message[:200])
                return {"content": f"LLM 调用失败（{exc.status_code}）：{exc.message[:300]}", "tool_calls": tool_calls_log}
            except Exception as exc:
                logger.warning("LLM error: %s", exc)
                return {"content": f"LLM 调用异常：{exc!s:.300}", "tool_calls": tool_calls_log}
            choice = response.choices[0]
            msg = choice.message

            if choice.finish_reason == "tool_calls" and msg.tool_calls:
                api_messages.append(msg.model_dump())
                for tc in msg.tool_calls:
                    fn_name = tc.function.name
                    fn_args = json.loads(tc.function.arguments)
                    logger.info("Tool call: %s(%s)", fn_name, json.dumps(fn_args, ensure_ascii=False)[:200])
                    result = await execute_tool(fn_name, fn_args)
                    tool_calls_log.append({"name": fn_name, "arguments": fn_args})
                    api_messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": _truncate_tool_result(result),
                    })
                continue

            return {
                "content": msg.content or "",
                "tool_calls": tool_calls_log,
                "usage": {
                    "prompt_tokens": response.usage.prompt_tokens if response.usage else 0,
                    "completion_tokens": response.usage.completion_tokens if response.usage else 0,
                },
            }

        return {"content": "已达到最大迭代次数，请简化问题后重试。", "tool_calls": tool_calls_log}

    # ── SSE 流式对话 ────────────────────────────────────────────

    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        skills: list[str] | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """流式对话循环，yield SSE 事件 dict。

        事件类型：
          {"type": "delta", "content": "..."}   — 文本增量
          {"type": "tool_start", "tools": [...]} — 工具调用开始
          {"type": "tool_result", "name": "..."} — 工具执行完成
          {"type": "done"}                       — 结束
        """
        api_messages = self._build_messages(messages, skills=skills)

        for _ in range(AGENT_MAX_ITERATIONS):
            try:
                stream = await self.client.chat.completions.create(
                    model=self.model,
                    messages=api_messages,
                    tools=self.tools,
                    max_tokens=LLM_MAX_TOKENS,
                    stream=True,
                    stream_options={"include_usage": True},
                )
            except APIStatusError as exc:
                logger.warning("LLM stream error: %s %s", exc.status_code, exc.message[:200])
                yield {"type": "delta", "content": f"LLM 调用失败（{exc.status_code}）：{exc.message[:300]}"}
                yield {"type": "done"}
                return
            except Exception as exc:
                logger.warning("LLM stream error: %s", exc)
                yield {"type": "delta", "content": f"LLM 调用异常：{exc!s:.300}"}
                yield {"type": "done"}
                return

            content_parts: list[str] = []
            tool_calls_map: dict[int, dict[str, str]] = {}

            async for chunk in stream:
                if not chunk.choices:
                    # usage-only chunk at the end
                    continue
                delta = chunk.choices[0].delta
                finish_reason = chunk.choices[0].finish_reason

                if delta and delta.content:
                    content_parts.append(delta.content)
                    yield {"type": "delta", "content": delta.content}

                if delta and delta.tool_calls:
                    for tc in delta.tool_calls:
                        idx = tc.index
                        if idx not in tool_calls_map:
                            tool_calls_map[idx] = {"id": "", "name": "", "arguments": ""}
                        if tc.id:
                            tool_calls_map[idx]["id"] = tc.id
                        if tc.function:
                            if tc.function.name:
                                tool_calls_map[idx]["name"] = tc.function.name
                            if tc.function.arguments:
                                tool_calls_map[idx]["arguments"] += tc.function.arguments

                if finish_reason == "tool_calls" or (finish_reason is None and not chunk.choices):
                    pass  # continue accumulating

            # 判断是否需要执行工具
            if not tool_calls_map:
                yield {"type": "done"}
                return

            # 构造 assistant message 并执行工具
            assistant_msg: dict[str, Any] = {
                "role": "assistant",
                "content": "".join(content_parts) or None,
                "tool_calls": [
                    {
                        "id": tc["id"],
                        "type": "function",
                        "function": {"name": tc["name"], "arguments": tc["arguments"]},
                    }
                    for _, tc in sorted(tool_calls_map.items())
                ],
            }
            api_messages.append(assistant_msg)

            yield {
                "type": "tool_start",
                "tools": [{"name": tc["name"], "arguments": tc["arguments"]} for _, tc in sorted(tool_calls_map.items())],
            }

            for _, tc in sorted(tool_calls_map.items()):
                fn_name = tc["name"]
                fn_args = json.loads(tc["arguments"])
                logger.info("Stream tool call: %s(%s)", fn_name, json.dumps(fn_args, ensure_ascii=False)[:200])
                result = await execute_tool(fn_name, fn_args)
                yield {"type": "tool_result", "name": fn_name, "result": result}
                api_messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": _truncate_tool_result(result),
                })

        yield {"type": "delta", "content": "\n\n[已达到最大迭代次数]"}
        yield {"type": "done"}


# ── 全局单例 ─────────────────────────────────────────────────────

_agent: SentimentAgent | None = None


def get_agent() -> SentimentAgent:
    global _agent
    if _agent is None:
        if not LLM_API_KEY:
            raise ValueError("LLM_API_KEY 未配置，请在环境变量中设置")
        _agent = SentimentAgent()
    return _agent


def _truncate_tool_result(result: str, max_chars: int = _MAX_TOOL_RESULT_CHARS) -> str:
    """截断过大的工具结果，保留开头和结尾，中间用省略标记。"""
    if len(result) <= max_chars:
        return result
    head = max_chars // 2
    tail = max_chars // 4
    return result[:head] + f"\n...[truncated, total {len(result)} chars]...\n" + result[-tail:]
