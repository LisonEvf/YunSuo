"""端到端集成测试 —— Renderer → Session → WS Bridge 全链路。"""
import asyncio
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.airui.renderer import render_dashboard
from app.airui.session import session_manager
from app.airui.ws_bridge import register_ws_routes, push_document


def _minimal_dashboard_data() -> dict:
    return {
        "meta": {"day": "2026-06-05", "updatedAt": "", "source": "test", "warnings": []},
        "overview": {"cycle": "常态", "sentiment": 50, "advice": {"aggressive": "1成", "steady": "空仓", "min": 0, "max": 10}, "style": [], "timePlan": []},
        "kpis": {"sentiment": 50, "sentimentDelta": 0, "limitUp": 30, "broken": 8, "limitDown": 5, "sealRate": 70, "bombRate": 30, "yesterdayPremium": 1.5, "linkBoardPremium": 2.0, "upCount": 2000, "downCount": 2500, "marketAmount": 9000, "marketAmountText": "", "marketVsShort": 0, "review": "", "bombRate5d": 28, "firstBoardCount": 20, "linkBoardCount": 10, "marketAmountDelta": 0, "nonBoardTemp": 50, "openPremium": "--", "promotionRate": "--", "marketCoef": 50, "zhangfuDistribution": []},
        "indexes": [],
        "trend": [],
        "plates": [],
        "methods": [],
        "risks": [],
        "opportunities": [],
        "watchlist": [],
        "monitor": [],
    }


def test_render_to_session_to_ws():
    """全链路：render → session.doc → WS 推送。"""
    # 1. 渲染
    data = _minimal_dashboard_data()
    doc = render_dashboard(data)
    assert doc["schema"] == "air-ui@1"
    assert doc["root"]["type"] == "Dashboard"

    # 2. 创建 app + WS
    app = FastAPI()
    register_ws_routes(app)
    client = TestClient(app)

    with client.websocket_connect("/ws/airui?session=e2e-test") as ws:
        msg1 = ws.receive_json()  # session 分配
        assert msg1["type"] == "session"

        # 3. 推送文档
        loop = asyncio.get_event_loop()
        loop.run_until_complete(push_document("e2e-test", doc, title="E2E 测试"))

        msg2 = ws.receive_json()
        assert msg2["type"] == "document"
        assert msg2["data"]["schema"] == "air-ui@1"

    # 4. 验证 session doc 已更新
    session = session_manager.get("e2e-test")
    assert session is not None
    assert session.doc == doc


def test_interaction_round_trip():
    """交互事件：WS 发送 → session 队列 → 取出。"""
    session_manager.delete("round-trip")

    app = FastAPI()
    register_ws_routes(app)
    client = TestClient(app)

    with client.websocket_connect("/ws/airui?session=round-trip") as ws:
        msg1 = ws.receive_json()

        ws.send_json({
            "type": "interaction",
            "widgetRef": "table-plates",
            "interaction": "drilldown",
            "payload": {"name": "半导体", "code": "881270"},
        })

    session = session_manager.get("round-trip")
    assert session is not None
    event = session.dequeue_event(timeout=1.0)
    assert event is not None
    assert event["widgetRef"] == "table-plates"
    assert event["payload"]["name"] == "半导体"
