"""MCP 客户端 —— 连接外部 MCP server，发现工具并注入 agent 工具注册表。

支持 stdio（command+args）、HTTP（Streamable HTTP）、SSE 三种 transport。
工具发现后以 ``mcp_<server>_<tool>`` 命名注册，供 agent 像内置工具一样调用。

参考 hermes-agent/tools/mcp_tool.py，砍掉 OAuth / sampling / parallel /
circuit-breaker / stderr 重定向，保留核心连接 + 发现 + 调用。

架构：专用 background event loop（daemon thread）承载所有 MCP 连接，
工具调用通过 run_coroutine_threadsafe 同步等待，复用 tools.execute_tool
的 thread-executor 路径，无需改动 agent 主循环。

server 配置结构（config.mcp.servers[*]）::

    {
      "name": "filesystem",        # 必填，唯一标识
      "enabled": true,             # 默认 true
      # stdio transport:
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "env": {"FOO": "bar"},
      # 或 http / sse transport:
      "url": "https://example.com/mcp",
      "transport": "http",         # 省略默认 http；"sse" 走 SSE
      "headers": {"Authorization": "Bearer xxx"}
    }
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
from typing import Any, Callable

import httpx

from . import config

logger = logging.getLogger(__name__)

# ── mcp SDK（可选：未安装则 MCP 功能禁用）─────────────────────────────
try:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    _MCP_AVAILABLE = True
except ImportError:
    ClientSession = None  # type: ignore[assignment]
    StdioServerParameters = None  # type: ignore[assignment]
    stdio_client = None  # type: ignore[assignment]
    _MCP_AVAILABLE = False
    logger.debug("mcp package not installed — MCP support disabled")

try:
    from mcp.client.streamable_http import streamable_http_client
except ImportError:
    streamable_http_client = None  # type: ignore[assignment]

try:
    from mcp.client.sse import sse_client
except ImportError:
    sse_client = None  # type: ignore[assignment]


# ── background event loop ────────────────────────────────────────────
_loop: asyncio.AbstractEventLoop | None = None
_thread: threading.Thread | None = None
_loop_lock = threading.Lock()


def _ensure_loop() -> asyncio.AbstractEventLoop:
    """启动后台 daemon 线程承载 MCP event loop（幂等）。"""
    global _loop, _thread
    with _loop_lock:
        if _loop is not None and _loop.is_running():
            return _loop
        loop = asyncio.new_event_loop()

        def _runner() -> None:
            asyncio.set_event_loop(loop)
            loop.run_forever()

        _thread = threading.Thread(target=_runner, name="mcp-event-loop", daemon=True)
        _thread.start()
        _loop = loop
        return loop


def _run_coro(coro: Any, timeout: float = 60.0) -> Any:
    """把 coro 调度到 MCP loop 并阻塞当前线程等待结果。"""
    loop = _ensure_loop()
    future = asyncio.run_coroutine_threadsafe(coro, loop)
    return future.result(timeout=timeout)


# ── 单个 server 连接 ──────────────────────────────────────────────────
class _MCPServer:
    """一个 MCP server 的长连接 + 工具清单。"""

    def __init__(self, name: str) -> None:
        self.name = name
        self.session: Any = None
        self.tools: list[Any] = []
        self._task: asyncio.Task | None = None
        self._ready: asyncio.Event = asyncio.Event()
        self._stop: asyncio.Event = asyncio.Event()

    async def start(self, cfg: dict, connect_timeout: float = 60.0) -> None:
        self._task = asyncio.create_task(self._serve(cfg))
        try:
            await asyncio.wait_for(self._ready.wait(), timeout=connect_timeout)
        except (asyncio.TimeoutError, Exception):
            await self._cancel_task()
            raise

    async def shutdown(self) -> None:
        self._stop.set()
        await self._cancel_task()

    async def _cancel_task(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass

    async def _serve(self, cfg: dict) -> None:
        try:
            if cfg.get("command"):
                await self._serve_stdio(cfg)
            elif cfg.get("transport") == "sse" and cfg.get("url"):
                await self._serve_sse(cfg)
            elif cfg.get("url"):
                await self._serve_http(cfg)
            else:
                raise ValueError(
                    f"MCP server '{self.name}': must specify 'command' or 'url'"
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("MCP server '%s' connect failed: %s", self.name, exc)
            if not self._ready.is_set():
                self._ready.set()  # 解除 start 的 wait_for，让上层看到空 tools

    async def _handshake(self, read: Any, write: Any) -> None:
        """initialize + list_tools，然后保持 session 直到 shutdown。"""
        async with ClientSession(read, write) as session:
            await session.initialize()
            self.session = session
            result = await session.list_tools()
            self.tools = list(result.tools)
            self._ready.set()
            logger.info(
                "MCP server '%s': %d tools discovered", self.name, len(self.tools)
            )
            await self._stop.wait()

    async def _serve_stdio(self, cfg: dict) -> None:
        env = cfg.get("env")
        params = StdioServerParameters(
            command=cfg["command"],
            args=list(cfg.get("args") or []),
            env={**os.environ, **env} if env else None,
        )
        async with stdio_client(params) as (read, write):
            await self._handshake(read, write)

    async def _serve_http(self, cfg: dict) -> None:
        if streamable_http_client is None:
            raise ImportError("mcp streamable_http transport not available")
        headers = cfg.get("headers") or {}
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(60.0, read=300.0), headers=headers
        ) as http_client:
            async with streamable_http_client(
                cfg["url"], http_client=http_client
            ) as streams:
                await self._handshake(streams[0], streams[1])

    async def _serve_sse(self, cfg: dict) -> None:
        if sse_client is None:
            raise ImportError("mcp SSE transport not available")
        async with sse_client(
            cfg["url"], headers=cfg.get("headers") or {}
        ) as (read, write):
            await self._handshake(read, write)


# ── 全局 registry ────────────────────────────────────────────────────
_servers: dict[str, _MCPServer] = {}
_registry_lock = threading.Lock()


def load_all() -> tuple[list[dict], dict[str, Callable[[dict], str]]]:
    """连接所有 enabled server，返回 (OpenAI function schemas, sync handlers)。

    schemas 直接可并入 ``TOOL_DEFINITIONS``；handlers 是 ``{prefixed_name: fn}``，
    通过 :func:`register_in_tools` 注入 ``tools._HANDLERS``。
    """
    schemas: list[dict] = []
    handlers: dict[str, Callable[[dict], str]] = {}
    if not _MCP_AVAILABLE:
        logger.info("mcp package not installed — MCP tools disabled")
        return schemas, handlers

    mcp_cfg = config.AGENT_CONFIG.get("mcp", {}) or {}
    if not mcp_cfg.get("enabled", True):
        logger.info("MCP disabled by config — skipping")
        return schemas, handlers

    for entry in mcp_cfg.get("servers") or []:
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("name") or "").strip()
        if not name or not entry.get("enabled", True):
            continue
        server = _MCPServer(name)
        try:
            _run_coro(server.start(entry), timeout=70.0)
        except Exception as exc:
            logger.warning("MCP server '%s' load failed: %s", name, exc)
            continue
        if not server.tools:
            continue
        with _registry_lock:
            _servers[name] = server
        for mcp_tool in server.tools:
            schema, prefixed = _convert_schema(name, mcp_tool)
            schemas.append(schema)
            handlers[prefixed] = _make_handler(name, getattr(mcp_tool, "name", ""))
    return schemas, handlers


def _make_handler(server_name: str, tool_name: str) -> Callable[[dict], str]:
    """生成符合 tools._HANDLERS 接口的 sync handler。"""

    def _handler(args: dict, **_kwargs: Any) -> str:
        return call(server_name, tool_name, args)

    return _handler


def call(server_name: str, tool_name: str, args: dict, timeout: float = 120.0) -> str:
    """同步调用 MCP 工具，返回 JSON 字符串（含 result 或 error）。"""
    with _registry_lock:
        server = _servers.get(server_name)
    session = server.session if server else None
    if session is None:
        return json.dumps(
            {"error": f"MCP server '{server_name}' not connected"},
            ensure_ascii=False,
        )

    async def _do() -> dict:
        result = await session.call_tool(tool_name, arguments=args)
        parts = [getattr(b, "text", "") for b in (result.content or [])]
        text = "\n".join(p for p in parts if p)
        if getattr(result, "isError", False):
            return {"error": text or "MCP tool returned an error"}
        structured = getattr(result, "structuredContent", None)
        if structured is not None:
            return (
                {"result": text, "structuredContent": structured}
                if text
                else {"result": structured}
            )
        return {"result": text}

    try:
        out = _run_coro(_do(), timeout=timeout)
        return json.dumps(out, ensure_ascii=False, default=str)
    except Exception as exc:
        return json.dumps(
            {"error": f"MCP call '{server_name}/{tool_name}' failed: {exc}"},
            ensure_ascii=False,
        )


def register_in_tools(handlers: dict[str, Callable[[dict], str]]) -> None:
    """把 MCP handlers 注入 tools._HANDLERS（先清旧 mcp_ 前缀项，幂等）。"""
    from . import tools as _tools

    for key in list(_tools._HANDLERS):
        if key.startswith("mcp_"):
            del _tools._HANDLERS[key]
    _tools._HANDLERS.update(handlers)


def shutdown_all() -> None:
    """断开所有 server（reset_agent / 进程退出前调用）。"""
    with _registry_lock:
        servers = list(_servers.values())
        _servers.clear()
    for server in servers:
        try:
            _run_coro(server.shutdown(), timeout=10.0)
        except Exception:
            pass


def status() -> list[dict]:
    """返回已连接 server 的工具清单：[{name, connected, tools: [{name, description}]}]。

    供 /api/mcp/status 暴露给前端做"能力感知"——只回报实际连上并发现工具的 server。
    """
    with _registry_lock:
        items = list(_servers.items())
    out: list[dict] = []
    for name, server in items:
        tools = [
            {
                "name": getattr(t, "name", ""),
                "description": getattr(t, "description", "") or "",
            }
            for t in server.tools
        ]
        out.append({"name": name, "connected": server.session is not None, "tools": tools})
    return out


def _convert_schema(server_name: str, mcp_tool: Any) -> tuple[dict, str]:
    """MCP tool → OpenAI function definition，工具名加 server 前缀防冲突。"""
    raw_name = getattr(mcp_tool, "name", "") or ""
    raw_desc = getattr(mcp_tool, "description", "") or ""
    input_schema = getattr(mcp_tool, "inputSchema", None) or {
        "type": "object",
        "properties": {},
    }
    prefixed = f"mcp_{server_name}_{raw_name}"
    schema = {
        "type": "function",
        "function": {
            "name": prefixed,
            "description": f"[MCP/{server_name}] {raw_desc}".strip(),
            "parameters": input_schema,
        },
    }
    return schema, prefixed
