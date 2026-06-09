"""AIRUI Session 管理 —— 多 session 隔离的控制台状态和事件队列。"""
from __future__ import annotations

import asyncio
import threading
from typing import Any

from fastapi import WebSocket


class ConsoleSession:
    """单个 AIRUI 控制台 session 的状态管理。"""

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.doc: dict[str, Any] | None = None
        self.event_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.ws_clients: list[WebSocket] = []

    def enqueue_event(self, event: dict[str, Any]) -> None:
        """交互事件入队（线程安全）。"""
        self.event_queue.put_nowait(event)

    def dequeue_event(self, timeout: float = 10.0) -> dict[str, Any] | None:
        """从事件队列取一个事件，超时返回 None。"""
        try:
            loop = asyncio.get_event_loop()
            if loop.is_closed():
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

        try:
            return loop.run_until_complete(
                asyncio.wait_for(self.event_queue.get(), timeout=timeout)
            )
        except (asyncio.TimeoutError, asyncio.CancelledError):
            return None

    async def async_dequeue_event(self, timeout: float = 10.0) -> dict[str, Any] | None:
        """异步版本的事件出队。"""
        try:
            return await asyncio.wait_for(self.event_queue.get(), timeout=timeout)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            return None

    async def broadcast(self, message: dict[str, Any]) -> None:
        """向所有 WS 客户端广播消息。"""
        import json

        data = json.dumps(message, ensure_ascii=False, default=str)
        disconnected: list[WebSocket] = []
        for ws in self.ws_clients:
            try:
                await ws.send_text(data)
            except Exception:
                disconnected.append(ws)
        for ws in disconnected:
            self.ws_clients.remove(ws)


class SessionManager:
    """管理所有 AIRUI 控制台 session。"""

    def __init__(self):
        self._sessions: dict[str, ConsoleSession] = {}
        self._lock = threading.Lock()

    def get_or_create(self, session_id: str) -> ConsoleSession:
        with self._lock:
            if session_id not in self._sessions:
                self._sessions[session_id] = ConsoleSession(session_id)
            return self._sessions[session_id]

    def get(self, session_id: str) -> ConsoleSession | None:
        return self._sessions.get(session_id)

    def delete(self, session_id: str) -> None:
        with self._lock:
            self._sessions.pop(session_id, None)

    def list(self) -> list[str]:
        return list(self._sessions.keys())


# 全局单例
session_manager = SessionManager()
