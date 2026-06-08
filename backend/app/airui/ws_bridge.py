"""AIRUI WebSocket Bridge —— 双向通信 + 事件分发。"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from .session import session_manager

logger = logging.getLogger(__name__)


def register_ws_routes(app: FastAPI) -> None:
    """在 FastAPI app 上注册 AIRUI WebSocket 路由。"""

    @app.websocket("/ws/airui")
    async def airui_ws(websocket: WebSocket, session: str = "default"):
        """WebSocket 双向通信端点。"""
        await websocket.accept()
        sess = session_manager.get_or_create(session)
        sess.ws_clients.append(websocket)

        try:
            await websocket.send_text(json.dumps({
                "type": "session",
                "sessionId": session,
            }, ensure_ascii=False))

            if sess.doc:
                await websocket.send_text(json.dumps({
                    "type": "document",
                    "data": sess.doc,
                }, ensure_ascii=False, default=str))

            while True:
                raw = await websocket.receive_text()
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                msg_type = msg.get("type")

                if msg_type == "interaction":
                    event = {
                        "widgetRef": msg.get("widgetRef", ""),
                        "interaction": msg.get("interaction", ""),
                        "payload": msg.get("payload", {}),
                    }
                    sess.enqueue_event(event)
                    logger.info("Interaction on session %s: %s", session, event.get("interaction"))

        except WebSocketDisconnect:
            logger.info("WS disconnected: session=%s", session)
        finally:
            if websocket in sess.ws_clients:
                sess.ws_clients.remove(websocket)


async def push_document(session_id: str, doc: dict[str, Any], title: str | None = None) -> None:
    """向指定 session 推送完整文档。"""
    sess = session_manager.get(session_id)
    if not sess:
        return
    sess.doc = doc
    await sess.broadcast({
        "type": "document",
        "data": doc,
        **({"title": title} if title else {}),
    })


async def push_patch(session_id: str, patches: list[dict[str, Any]]) -> None:
    """向指定 session 推送 patch。"""
    sess = session_manager.get(session_id)
    if not sess:
        return
    if sess.doc:
        from .patch import apply_patches
        sess.doc = apply_patches(sess.doc, patches)
    await sess.broadcast({"type": "patch", "data": patches})
