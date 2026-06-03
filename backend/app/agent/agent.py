"""核心 Agent —— conversation loop 模式。

对话循环：
  user message → LLM → tool_calls → execute → LLM → ... → final response

支持：
  - 普通请求（非流式）
  - SSE 流式请求（逐 token 输出 + 工具调用状态推送）

能力：
  - 重试 + 错误分类（retry.py）
  - 上下文压缩（context.py）
  - 会话记忆（memory.py）
  - 工具防护（guardrails.py）
  - Dashboard 快照预取 + 并行工具执行
"""
from __future__ import annotations

import asyncio
import json
import logging
import threading
from typing import Any, AsyncIterator

from openai import AsyncOpenAI, APIStatusError

from .config import (
    AGENT_MAX_ITERATIONS, LLM_API_KEY, LLM_BASE_URL, LLM_MAX_TOKENS,
    LLM_MODEL, RETRY_MAX_ATTEMPTS,
)
from .context import ContextManager
from .guardrails import ToolGuardrails
from .memory import memory_manager
from .retry import classify_error, jittered_backoff
from .system_prompt import build_system_prompt
from .tools import TOOL_DEFINITIONS, execute_tool

_MAX_TOOL_RESULT_CHARS = 6000
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
        self._system_prompt = build_system_prompt()
        self._context = ContextManager()
        self._guardrails = ToolGuardrails()

    def _build_messages(
        self,
        messages: list[dict[str, Any]],
        skills: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        from .skills import build_skill_prompt

        system_content = self._system_prompt

        # 注入记忆上下文
        last_user_msg = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                last_user_msg = m.get("content", "")
                break
        if last_user_msg:
            memory_block = memory_manager.build_context_block(last_user_msg)
            if memory_block:
                system_content += memory_block

        if skills:
            parts: list[str] = []
            for slug in skills:
                prompt = build_skill_prompt(slug.strip().lstrip("/"))
                if prompt:
                    parts.append(prompt)
            if parts:
                system_content += "\n\n" + "\n\n---\n\n".join(parts)

        return [{"role": "system", "content": system_content}, *messages]

    async def _fetch_snapshot(self) -> dict[str, Any] | None:
        try:
            from ..services import data_service
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(None, data_service.dashboard)
        except Exception:
            return None

    async def _call_llm(
        self,
        api_messages: list[dict[str, Any]],
        *,
        stream: bool = False,
    ):
        """LLM 调用 + 重试。"""
        common_kwargs = {
            "model": self.model,
            "messages": api_messages,
            "tools": self.tools,
            "max_tokens": LLM_MAX_TOKENS,
        }
        if stream:
            common_kwargs["stream"] = True
            common_kwargs["stream_options"] = {"include_usage": True}

        last_err: Exception | None = None
        for attempt in range(1, RETRY_MAX_ATTEMPTS + 1):
            try:
                return await self.client.chat.completions.create(**common_kwargs)
            except APIStatusError as exc:
                classified = classify_error(exc)
                if not classified.retryable or attempt >= RETRY_MAX_ATTEMPTS:
                    raise
                delay = jittered_backoff(attempt)
                logger.warning(
                    "LLM API error (%s), retry %.1fs (%d/%d): %s",
                    classified.reason.value, delay, attempt, RETRY_MAX_ATTEMPTS,
                    exc.message[:200],
                )
                last_err = exc
                await asyncio.sleep(delay)
            except Exception as exc:
                classified = classify_error(exc)
                if not classified.retryable or attempt >= RETRY_MAX_ATTEMPTS:
                    raise
                delay = jittered_backoff(attempt)
                logger.warning(
                    "LLM error, retry %.1fs (%d/%d): %s",
                    delay, attempt, RETRY_MAX_ATTEMPTS, str(exc)[:200],
                )
                last_err = exc
                await asyncio.sleep(delay)

        raise last_err  # type: ignore[misc]

    def _maybe_compress(self, api_messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """同步检查是否需要压缩，返回可能压缩后的消息列表。"""
        if self._context.should_compress(api_messages):
            return api_messages  # 实际压缩在 async 方法中
        return api_messages

    # ── 非流式对话 ──────────────────────────────────────────────

    async def chat(
        self,
        messages: list[dict[str, Any]],
        skills: list[str] | None = None,
    ) -> dict[str, Any]:
        """运行完整对话循环，返回最终回复。"""
        api_messages = self._build_messages(messages, skills=skills)
        tool_calls_log: list[dict[str, Any]] = []
        self._guardrails.reset_turn()

        for _ in range(AGENT_MAX_ITERATIONS):
            # 上下文压缩
            if self._context.should_compress(api_messages):
                api_messages = await self._context.compress(api_messages)

            try:
                response = await self._call_llm(api_messages)
            except APIStatusError as exc:
                logger.warning("LLM API error: %s %s", exc.status_code, exc.message[:200])
                return {"content": f"LLM 调用失败（{exc.status_code}）：{exc.message[:300]}", "tool_calls": tool_calls_log}
            except Exception as exc:
                logger.warning("LLM error: %s", exc)
                return {"content": f"LLM 调用异常：{exc!s:.300}", "tool_calls": tool_calls_log}

            choice = response.choices[0]
            msg = choice.message

            # 更新 token 用量
            if response.usage:
                self._context.update_usage(response.usage.prompt_tokens, response.usage.completion_tokens)

            if choice.finish_reason == "tool_calls" and msg.tool_calls:
                api_messages.append(msg.model_dump())
                snapshot = await self._fetch_snapshot()

                # 解析 + guardrail 检查
                pending = []
                for tc in msg.tool_calls:
                    fn_name = tc.function.name
                    fn_args = json.loads(tc.function.arguments)
                    logger.info("Tool call: %s(%s)", fn_name, json.dumps(fn_args, ensure_ascii=False)[:200])
                    tool_calls_log.append({"name": fn_name, "arguments": fn_args})
                    pending.append((tc.id, fn_name, fn_args))

                # 分离允许/阻止的工具
                allowed: list[tuple[str, str, dict]] = []
                for tc_id, fn_name, fn_args in pending:
                    decision = self._guardrails.check(fn_name, fn_args)
                    if decision.allows_execution:
                        allowed.append((tc_id, fn_name, fn_args))
                    else:
                        api_messages.append({
                            "role": "tool",
                            "tool_call_id": tc_id,
                            "content": json.dumps({"error": decision.reason}, ensure_ascii=False),
                        })
                        logger.info("Tool blocked: %s — %s", fn_name, decision.reason)

                # 并行执行允许的工具
                if allowed:
                    results = await asyncio.gather(
                        *[execute_tool(name, args, snapshot=snapshot) for _, name, args in allowed],
                        return_exceptions=True,
                    )
                    for (tc_id, fn_name, fn_args), result in zip(allowed, results):
                        self._guardrails.record(fn_name, fn_args)
                        if isinstance(result, Exception):
                            result = json.dumps({"error": str(result)}, ensure_ascii=False)
                        api_messages.append({
                            "role": "tool",
                            "tool_call_id": tc_id,
                            "content": _truncate_tool_result(result),
                        })
                continue

            # 最终回复 — 自动提取记忆
            result = {
                "content": msg.content or "",
                "tool_calls": tool_calls_log,
                "usage": {
                    "prompt_tokens": response.usage.prompt_tokens if response.usage else 0,
                    "completion_tokens": response.usage.completion_tokens if response.usage else 0,
                },
            }
            self._save_memory_if_needed(messages, result["content"])
            return result

        return {"content": "已达到最大迭代次数，请简化问题后重试。", "tool_calls": tool_calls_log}

    # ── SSE 流式对话 ────────────────────────────────────────────

    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        skills: list[str] | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """流式对话循环，yield SSE 事件 dict。"""
        api_messages = self._build_messages(messages, skills=skills)
        self._guardrails.reset_turn()

        for _ in range(AGENT_MAX_ITERATIONS):
            # 上下文压缩
            if self._context.should_compress(api_messages):
                api_messages = await self._context.compress(api_messages)

            try:
                stream = await self._call_llm(api_messages, stream=True)
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
                    continue
                delta = chunk.choices[0].delta

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

            if not tool_calls_map:
                yield {"type": "done"}
                return

            sorted_tools = sorted(tool_calls_map.items())
            assistant_msg: dict[str, Any] = {
                "role": "assistant",
                "content": "".join(content_parts) or None,
                "tool_calls": [
                    {
                        "id": tc["id"],
                        "type": "function",
                        "function": {"name": tc["name"], "arguments": tc["arguments"]},
                    }
                    for _, tc in sorted_tools
                ],
            }
            api_messages.append(assistant_msg)

            yield {
                "type": "tool_start",
                "tools": [{"name": tc["name"], "arguments": tc["arguments"]} for _, tc in sorted_tools],
            }

            snapshot = await self._fetch_snapshot()

            # 解析 + guardrail 检查
            pending = [
                (tc["id"], tc["name"], json.loads(tc["arguments"]))
                for _, tc in sorted_tools
            ]
            allowed: list[tuple[str, str, dict]] = []
            for tc_id, fn_name, fn_args in pending:
                decision = self._guardrails.check(fn_name, fn_args)
                if decision.allows_execution:
                    allowed.append((tc_id, fn_name, fn_args))
                else:
                    yield {"type": "tool_result", "name": fn_name, "result": json.dumps({"error": decision.reason}), "error": decision.reason}
                    api_messages.append({
                        "role": "tool",
                        "tool_call_id": tc_id,
                        "content": json.dumps({"error": decision.reason}, ensure_ascii=False),
                    })
                    logger.info("Tool blocked: %s — %s", fn_name, decision.reason)

            if allowed:
                results = await asyncio.gather(
                    *[execute_tool(name, args, snapshot=snapshot) for _, name, args in allowed],
                    return_exceptions=True,
                )
                for (tc_id, fn_name, fn_args), result in zip(allowed, results):
                    self._guardrails.record(fn_name, fn_args)
                    if isinstance(result, Exception):
                        result = json.dumps({"error": str(result)}, ensure_ascii=False)
                    event: dict[str, Any] = {"type": "tool_result", "name": fn_name, "result": result}
                    try:
                        parsed = json.loads(result)
                        if isinstance(parsed, dict) and "error" in parsed:
                            event["error"] = parsed["error"]
                    except json.JSONDecodeError:
                        pass
                    yield event
                    api_messages.append({
                        "role": "tool",
                        "tool_call_id": tc_id,
                        "content": _truncate_tool_result(result),
                    })

        yield {"type": "delta", "content": "\n\n[已达到最大迭代次数]"}
        yield {"type": "done"}

    # ── 辅助方法 ──────────────────────────────────────────────────

    def _save_memory_if_needed(self, messages: list[dict[str, Any]], assistant_content: str) -> None:
        """非流式回复后尝试提取用户偏好。"""
        user_msg = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                user_msg = m.get("content", "")
                break
        if user_msg and assistant_content:
            try:
                memory_manager.extract_and_save(user_msg, assistant_content)
            except Exception:
                pass

    def get_usage(self) -> dict[str, Any]:
        return self._context.get_usage()


# ── 全局单例（线程安全）────────────────────────────────────────────

_agent: SentimentAgent | None = None
_agent_lock = threading.Lock()


def get_agent() -> SentimentAgent:
    global _agent
    if _agent is None:
        with _agent_lock:
            if _agent is None:
                if not LLM_API_KEY:
                    raise ValueError("LLM_API_KEY 未配置，请在环境变量中设置")
                _agent = SentimentAgent()
    return _agent


def _truncate_tool_result(result: str, max_chars: int = _MAX_TOOL_RESULT_CHARS) -> str:
    """截断过大的工具结果，优先按 JSON 列表条目截断以保持结构完整。"""
    if len(result) <= max_chars:
        return result

    try:
        data = json.loads(result)
        if isinstance(data, list) and len(data) > 5:
            budget = max_chars - 80
            items: list[Any] = []
            total_len = 2
            for item in data:
                chunk = json.dumps(item, ensure_ascii=False, default=str)
                if total_len + len(chunk) + 1 > budget:
                    break
                items.append(item)
                total_len += len(chunk) + 1
            if items:
                return (
                    json.dumps(items, ensure_ascii=False, default=str)
                    + f"\n[共 {len(data)} 条，已截断保留前 {len(items)} 条]"
                )
    except (json.JSONDecodeError, TypeError):
        pass

    head = max_chars * 3 // 4
    return result[:head] + f"\n...[truncated, total {len(result)} chars]..."
