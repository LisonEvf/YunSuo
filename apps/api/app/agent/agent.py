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
  - 运行上下文预取 + 并行工具执行
"""
from __future__ import annotations

import asyncio
import json
import logging
import threading
from typing import Any, AsyncIterator

from openai import AsyncOpenAI, APIStatusError

from . import config
from .context import ContextManager
from .guardrails import ToolGuardrails
from .memory import memory_manager
from .review import background_review_recorder
from .retry import classify_error, jittered_backoff
from .skills import build_skill_prompt, record_skill_usage, select_relevant_skills
from .system_prompt import build_system_prompt
from .tools import TOOL_DEFINITIONS, execute_tool
from .trajectory import trajectory_recorder

_MAX_TOOL_RESULT_CHARS = 6000
logger = logging.getLogger(__name__)

# 触发 config_changed 事件推送的配置类工具
_CONFIG_TOOLS = {"update_provider_presets", "update_providers", "activate_provider"}


class GeneralAgent:
    """General-purpose agent runtime."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
    ):
        config.reload_config()
        self.api_key = api_key or config.LLM_API_KEY
        self.base_url = base_url or config.LLM_BASE_URL
        self.model = model or config.LLM_MODEL
        self.client = AsyncOpenAI(api_key=self.api_key, base_url=self.base_url)
        self.tools = _load_tools()
        self._system_prompt = build_system_prompt()
        self._context = ContextManager()
        self._guardrails = ToolGuardrails()

    def _build_messages(
        self,
        messages: list[dict[str, Any]],
        skills: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        api_messages, _ = self._build_messages_with_selection(messages, skills=skills)
        return api_messages

    def _build_messages_with_selection(
        self,
        messages: list[dict[str, Any]],
        skills: list[str] | None = None,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
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

        selected_skills: list[dict[str, Any]] = []
        if config.AGENT_CONFIG.get("skills", {}).get("enabled", True):
            selected_skills = select_relevant_skills(
                last_user_msg,
                explicit_skills=skills,
                auto_fill=skills is None,
            )

        if selected_skills:
            parts: list[str] = []
            for selected in selected_skills:
                prompt = build_skill_prompt(str(selected["slug"]))
                if prompt:
                    parts.append(prompt)
            if parts:
                system_content += "\n\n" + "\n\n---\n\n".join(parts)
                try:
                    record_skill_usage(selected_skills)
                except Exception as exc:
                    logger.warning("Skill usage recording failed: %s", exc)

        return [{"role": "system", "content": system_content}, *messages], selected_skills

    async def _fetch_snapshot(self) -> dict[str, Any] | None:
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
            "max_tokens": config.LLM_MAX_TOKENS,
        }
        if stream:
            common_kwargs["stream"] = True
            common_kwargs["stream_options"] = {"include_usage": True}

        last_err: Exception | None = None
        for attempt in range(1, config.RETRY_MAX_ATTEMPTS + 1):
            try:
                return await self.client.chat.completions.create(**common_kwargs)
            except APIStatusError as exc:
                classified = classify_error(exc)
                if not classified.retryable or attempt >= config.RETRY_MAX_ATTEMPTS:
                    raise
                delay = jittered_backoff(attempt)
                logger.warning(
                    "LLM API error (%s), retry %.1fs (%d/%d): %s",
                    classified.reason.value, delay, attempt, config.RETRY_MAX_ATTEMPTS,
                    exc.message[:200],
                )
                last_err = exc
                await asyncio.sleep(delay)
            except Exception as exc:
                classified = classify_error(exc)
                if not classified.retryable or attempt >= config.RETRY_MAX_ATTEMPTS:
                    raise
                delay = jittered_backoff(attempt)
                logger.warning(
                    "LLM error, retry %.1fs (%d/%d): %s",
                    delay, attempt, config.RETRY_MAX_ATTEMPTS, str(exc)[:200],
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
        api_messages, selected_skills = self._build_messages_with_selection(messages, skills=skills)
        trajectory_metadata = _trajectory_metadata(selected_skills)
        tool_calls_log: list[dict[str, Any]] = []
        tool_events: list[dict[str, Any]] = []
        system_prompt = api_messages[0].get("content", "")
        self._guardrails.reset_turn()

        for _ in range(config.AGENT_MAX_ITERATIONS):
            # 上下文压缩
            if self._context.should_compress(api_messages):
                api_messages = await self._context.compress(api_messages)

            try:
                response = await self._call_llm(api_messages)
            except APIStatusError as exc:
                logger.warning("LLM API error: %s %s", exc.status_code, exc.message[:200])
                self._record_trajectory(
                    system_prompt=system_prompt,
                    messages=messages,
                    tool_events=tool_events,
                    final_content="",
                    completed=False,
                    error=f"LLM API error {exc.status_code}: {exc.message[:300]}",
                    metadata=trajectory_metadata,
                )
                return {"content": f"LLM 调用失败（{exc.status_code}）：{exc.message[:300]}", "tool_calls": tool_calls_log}
            except Exception as exc:
                logger.warning("LLM error: %s", exc)
                self._record_trajectory(
                    system_prompt=system_prompt,
                    messages=messages,
                    tool_events=tool_events,
                    final_content="",
                    completed=False,
                    error=f"LLM error: {exc!s:.300}",
                    metadata=trajectory_metadata,
                )
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
                        blocked_result = json.dumps({"error": decision.reason}, ensure_ascii=False)
                        api_messages.append({
                            "role": "tool",
                            "tool_call_id": tc_id,
                            "content": blocked_result,
                        })
                        tool_events.append({
                            "name": fn_name,
                            "arguments": fn_args,
                            "result": blocked_result,
                            "error": decision.reason,
                            "blocked": True,
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
                        error_text = ""
                        if isinstance(result, Exception):
                            error_text = str(result)
                            result = json.dumps({"error": str(result)}, ensure_ascii=False)
                        elif _looks_like_tool_error(str(result)):
                            error_text = _extract_tool_error(str(result))
                        api_messages.append({
                            "role": "tool",
                            "tool_call_id": tc_id,
                            "content": _truncate_tool_result(result),
                        })
                        tool_events.append({
                            "name": fn_name,
                            "arguments": fn_args,
                            "result": _truncate_tool_result(result),
                            "error": error_text,
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
            self._record_trajectory(
                system_prompt=system_prompt,
                messages=messages,
                tool_events=tool_events,
                final_content=result["content"],
                completed=True,
                metadata=trajectory_metadata,
            )
            self._record_background_review(
                messages=messages,
                tool_events=tool_events,
                final_content=result["content"],
                selected_skills=selected_skills,
                completed=True,
            )
            return result

        self._record_trajectory(
            system_prompt=system_prompt,
            messages=messages,
            tool_events=tool_events,
            final_content="已达到最大迭代次数，请简化问题后重试。",
            completed=False,
            error="max_iterations_reached",
            metadata=trajectory_metadata,
        )
        self._record_background_review(
            messages=messages,
            tool_events=tool_events,
            final_content="已达到最大迭代次数，请简化问题后重试。",
            selected_skills=selected_skills,
            completed=False,
        )
        return {"content": "已达到最大迭代次数，请简化问题后重试。", "tool_calls": tool_calls_log}

    # ── SSE 流式对话 ────────────────────────────────────────────

    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        skills: list[str] | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """流式对话循环，yield SSE 事件 dict。"""
        api_messages, selected_skills = self._build_messages_with_selection(messages, skills=skills)
        trajectory_metadata = _trajectory_metadata(selected_skills)
        tool_events: list[dict[str, Any]] = []
        system_prompt = api_messages[0].get("content", "")
        self._guardrails.reset_turn()

        yield {"type": "skills", "skills": selected_skills}

        for _ in range(config.AGENT_MAX_ITERATIONS):
            # 上下文压缩
            if self._context.should_compress(api_messages):
                api_messages = await self._context.compress(api_messages)

            try:
                stream = await self._call_llm(api_messages, stream=True)
            except APIStatusError as exc:
                logger.warning("LLM stream error: %s %s", exc.status_code, exc.message[:200])
                self._record_trajectory(
                    system_prompt=system_prompt,
                    messages=messages,
                    tool_events=tool_events,
                    final_content="",
                    completed=False,
                    stream=True,
                    error=f"LLM API error {exc.status_code}: {exc.message[:300]}",
                    metadata=trajectory_metadata,
                )
                yield {"type": "delta", "content": f"LLM 调用失败（{exc.status_code}）：{exc.message[:300]}"}
                yield {"type": "done"}
                return
            except Exception as exc:
                logger.warning("LLM stream error: %s", exc)
                self._record_trajectory(
                    system_prompt=system_prompt,
                    messages=messages,
                    tool_events=tool_events,
                    final_content="",
                    completed=False,
                    stream=True,
                    error=f"LLM error: {exc!s:.300}",
                    metadata=trajectory_metadata,
                )
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
                final_content = "".join(content_parts)
                self._save_memory_if_needed(messages, final_content)
                self._record_trajectory(
                    system_prompt=system_prompt,
                    messages=messages,
                    tool_events=tool_events,
                    final_content=final_content,
                    completed=True,
                    stream=True,
                    metadata=trajectory_metadata,
                )
                self._record_background_review(
                    messages=messages,
                    tool_events=tool_events,
                    final_content=final_content,
                    selected_skills=selected_skills,
                    completed=True,
                )
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
                    blocked_result = json.dumps({"error": decision.reason}, ensure_ascii=False)
                    yield {"type": "tool_result", "name": fn_name, "result": blocked_result, "error": decision.reason}
                    api_messages.append({
                        "role": "tool",
                        "tool_call_id": tc_id,
                        "content": blocked_result,
                    })
                    tool_events.append({
                        "name": fn_name,
                        "arguments": fn_args,
                        "result": blocked_result,
                        "error": decision.reason,
                        "blocked": True,
                    })
                    logger.info("Tool blocked: %s — %s", fn_name, decision.reason)

            if allowed:
                results = await asyncio.gather(
                    *[execute_tool(name, args, snapshot=snapshot) for _, name, args in allowed],
                    return_exceptions=True,
                )
                for (tc_id, fn_name, fn_args), result in zip(allowed, results):
                    self._guardrails.record(fn_name, fn_args)
                    error_text = ""
                    if isinstance(result, Exception):
                        error_text = str(result)
                        result = json.dumps({"error": str(result)}, ensure_ascii=False)
                    event: dict[str, Any] = {"type": "tool_result", "name": fn_name, "result": result}
                    try:
                        parsed = json.loads(result)
                        if isinstance(parsed, dict) and "error" in parsed:
                            event["error"] = parsed["error"]
                            error_text = str(parsed["error"])
                    except json.JSONDecodeError:
                        pass
                    yield event
                    # 当 render_airui_panel 成功时，推送内联 AIRUI 事件给聊天
                    if fn_name == "render_airui_panel" and "error" not in event:
                        content = fn_args.get("content", {})
                        if content:
                            yield {"type": "airui", "data": content}
                    # 配置类工具成功后，推送合并后的完整 config 让前端实时刷新
                    if fn_name in _CONFIG_TOOLS and "error" not in event:
                        _cfg = config.load_agent_config()
                        _cfg["provider_presets"] = config.get_merged_presets(_cfg)
                        yield {"type": "config_changed", "config": _cfg}
                    api_messages.append({
                        "role": "tool",
                        "tool_call_id": tc_id,
                        "content": _truncate_tool_result(result),
                    })
                    tool_events.append({
                        "name": fn_name,
                        "arguments": fn_args,
                        "result": _truncate_tool_result(result),
                        "error": error_text,
                    })

        self._record_trajectory(
            system_prompt=system_prompt,
            messages=messages,
            tool_events=tool_events,
            final_content="[已达到最大迭代次数]",
            completed=False,
            stream=True,
            error="max_iterations_reached",
            metadata=trajectory_metadata,
        )
        self._record_background_review(
            messages=messages,
            tool_events=tool_events,
            final_content="[已达到最大迭代次数]",
            selected_skills=selected_skills,
            completed=False,
        )
        yield {"type": "delta", "content": "\n\n[已达到最大迭代次数]"}
        yield {"type": "done"}

    # ── 辅助方法 ──────────────────────────────────────────────────

    def _save_memory_if_needed(self, messages: list[dict[str, Any]], assistant_content: str) -> None:
        """回复后尝试提取用户偏好。"""
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

    def _record_trajectory(
        self,
        *,
        system_prompt: str,
        messages: list[dict[str, Any]],
        tool_events: list[dict[str, Any]],
        final_content: str,
        completed: bool,
        stream: bool = False,
        error: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        try:
            trajectory_recorder.record(
                system_prompt=system_prompt,
                input_messages=messages,
                tool_events=tool_events,
                final_content=final_content,
                model=self.model,
                completed=completed,
                stream=stream,
                error=error,
                metadata=metadata,
            )
        except Exception as exc:
            logger.warning("Trajectory recording failed: %s", exc)

    def _record_background_review(
        self,
        *,
        messages: list[dict[str, Any]],
        tool_events: list[dict[str, Any]],
        final_content: str,
        selected_skills: list[dict[str, Any]],
        completed: bool,
    ) -> None:
        try:
            background_review_recorder.record(
                messages=messages,
                tool_events=tool_events,
                final_content=final_content,
                selected_skills=selected_skills,
                completed=completed,
            )
        except Exception as exc:
            logger.warning("Background review recording failed: %s", exc)

    def get_usage(self) -> dict[str, Any]:
        return self._context.get_usage()


# ── 全局单例（线程安全）────────────────────────────────────────────

def _trajectory_metadata(selected_skills: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "selected_skills": [
            {
                "slug": item.get("slug"),
                "source": item.get("source"),
                "score": item.get("score"),
            }
            for item in selected_skills
        ]
    }


_agent: GeneralAgent | None = None
_agent_lock = threading.Lock()


def get_agent() -> GeneralAgent:
    global _agent
    if _agent is None:
        with _agent_lock:
            if _agent is None:
                config.reload_config()
                if not config.LLM_API_KEY:
                    raise ValueError("LLM_API_KEY 未配置，请在环境变量中设置")
                _agent = GeneralAgent()
    return _agent


def _load_tools() -> list[dict]:
    """内置工具 + MCP 工具合并。MCP 加载失败不阻断启动。"""
    tools = list(TOOL_DEFINITIONS)
    try:
        from . import mcp_client

        schemas, handlers = mcp_client.load_all()
        if schemas:
            tools.extend(schemas)
            mcp_client.register_in_tools(handlers)
    except Exception as exc:
        logger.warning("MCP tool loading failed: %s", exc)
    return tools


def reset_agent() -> None:
    """Drop the singleton so the next request uses the latest saved config."""
    global _agent
    with _agent_lock:
        _agent = None
    # lock 外清理 MCP 长连接 + skill 扫描缓存，下次 get_agent 用新配置重建
    try:
        from . import mcp_client, skills

        mcp_client.shutdown_all()
        skills.invalidate_cache()
    except Exception as exc:
        logger.warning("reset_agent cleanup failed: %s", exc)


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


def _looks_like_tool_error(result: str) -> bool:
    try:
        parsed = json.loads(result)
    except json.JSONDecodeError:
        return False
    return isinstance(parsed, dict) and "error" in parsed


def _extract_tool_error(result: str) -> str:
    try:
        parsed = json.loads(result)
    except json.JSONDecodeError:
        return ""
    if isinstance(parsed, dict) and "error" in parsed:
        return str(parsed["error"])
    return ""
