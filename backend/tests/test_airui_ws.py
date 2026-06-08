"""测试 WS Bridge 路由和事件分发。"""
import json
import asyncio
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.airui.ws_bridge import register_ws_routes
from app.airui.session import session_manager


def _create_app():
    app = FastAPI()
    register_ws_routes(app)
    return app


def test_ws_connect_receives_session():
    app = _create_app()
    client = TestClient(app)

    with client.websocket_connect("/ws/airui?session=test-s1") as ws:
        data = ws.receive_json()
        assert data["type"] == "session"
        assert data["sessionId"] == "test-s1"


def test_ws_push_document():
    app = _create_app()
    client = TestClient(app)

    with client.websocket_connect("/ws/airui?session=push-test") as ws:
        msg1 = ws.receive_json()  # session 分配

        session = session_manager.get("push-test")
        assert session is not None

        doc = {"type": "Dashboard", "children": []}
        asyncio.get_event_loop().run_until_complete(
            session.broadcast({"type": "document", "data": doc, "title": "测试"})
        )

        msg2 = ws.receive_json()
        assert msg2["type"] == "document"
        assert msg2["data"]["type"] == "Dashboard"


def test_ws_send_interaction():
    app = _create_app()
    client = TestClient(app)

    with client.websocket_connect("/ws/airui?session=interact-test") as ws:
        msg1 = ws.receive_json()

        ws.send_json({
            "type": "interaction",
            "widgetRef": "artifact-plan",
            "interaction": "inspect",
            "payload": {"section": "steps"},
        })

        session = session_manager.get("interact-test")
        assert session is not None

        event = asyncio.get_event_loop().run_until_complete(
            session.async_dequeue_event(timeout=2.0)
        )
        assert event is not None
        assert event["widgetRef"] == "artifact-plan"
        assert event["interaction"] == "inspect"
