import asyncio

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.airui.renderer import render_console
from app.airui.session import session_manager
from app.airui.ws_bridge import push_document, register_ws_routes


def test_render_to_session_to_ws():
    doc = render_console({"session_id": "e2e-test"})
    assert doc["schema"] == "air-ui@1"
    assert doc["state"]["mode"] == "general-agent"

    app = FastAPI()
    register_ws_routes(app)
    client = TestClient(app)

    with client.websocket_connect("/ws/airui?session=e2e-test") as ws:
        msg1 = ws.receive_json()
        assert msg1["type"] == "session"

        loop = asyncio.get_event_loop()
        loop.run_until_complete(push_document("e2e-test", doc, title="General Agent Console"))

        msg2 = ws.receive_json()
        assert msg2["type"] == "document"
        assert msg2["data"]["schema"] == "air-ui@1"

    session = session_manager.get("e2e-test")
    assert session is not None
    assert session.doc == doc


def test_interaction_round_trip():
    session_manager.delete("round-trip")

    app = FastAPI()
    register_ws_routes(app)
    client = TestClient(app)

    with client.websocket_connect("/ws/airui?session=round-trip") as ws:
        ws.receive_json()

        ws.send_json({
            "type": "interaction",
            "widgetRef": "artifact-plan",
            "interaction": "inspect",
            "payload": {"section": "steps"},
        })

    session = session_manager.get("round-trip")
    assert session is not None
    event = session.dequeue_event(timeout=1.0)
    assert event is not None
    assert event["widgetRef"] == "artifact-plan"
    assert event["payload"]["section"] == "steps"
