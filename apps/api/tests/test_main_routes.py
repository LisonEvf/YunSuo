"""main.py 路由层集成测试（TestClient，触发 lifespan）。"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    from app.agent import memory as mem_module

    if hasattr(mem_module._local, "conn"):
        mem_module._local.conn = None
    monkeypatch.setattr(mem_module, "DB_PATH", tmp_path / "routes_test.db")
    mem_module.memory_manager = mem_module.MemoryManager()

    from app.main import app
    with TestClient(app) as c:
        yield c


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert "chat" in data["capabilities"]


def test_lifespan_initializes_default_session(client):
    from app.airui.session import session_manager

    sess = session_manager.get_or_create("default")
    assert sess.doc is not None


def test_memory_recent_uses_public_interface(client):
    r = client.get("/api/memory?limit=5")
    assert r.status_code == 200
    assert "memories" in r.json()


def test_memory_search(client):
    r = client.get("/api/memory?keyword=test")
    assert r.status_code == 200


def test_skills_list(client):
    r = client.get("/api/skills")
    assert r.status_code == 200
    assert "skills" in r.json()


def test_usage_without_agent(client):
    r = client.get("/api/usage")
    assert r.status_code == 200
    assert r.json()["total_tokens"] == 0


def test_config_get_returns_merged_presets(client):
    r = client.get("/api/config")
    assert r.status_code == 200
    cfg = r.json()["config"]
    assert "model" in cfg
    assert "provider_presets" in cfg


def test_cors_header_present(client):
    r = client.options(
        "/health",
        headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert r.status_code in (200, 204)
    assert r.headers.get("access-control-allow-origin") == "http://127.0.0.1:5173"


def test_memory_delete_404_for_missing(client):
    r = client.delete("/api/memory/99999")
    assert r.status_code == 404


def test_list_models_success(client, monkeypatch):
    class _FakeModel:
        def __init__(self, mid):
            self.id = mid

    class _FakeResp:
        data = [_FakeModel("gpt-b"), _FakeModel("gpt-a")]

    class _FakeClient:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        class models:
            @staticmethod
            async def list():
                return _FakeResp()

    monkeypatch.setattr("openai.AsyncOpenAI", _FakeClient)

    r = client.post("/api/models", json={"base_url": "http://x/v1", "api_key": "k"})
    assert r.status_code == 200
    assert r.json()["models"] == ["gpt-a", "gpt-b"]


def test_list_models_provider_error_returns_502(client, monkeypatch):
    class _FailingClient:
        def __init__(self, **kwargs):
            pass

        class models:
            @staticmethod
            async def list():
                raise RuntimeError("connection refused")

    monkeypatch.setattr("openai.AsyncOpenAI", _FailingClient)

    r = client.post("/api/models", json={"base_url": "http://x/v1", "api_key": "k"})
    assert r.status_code == 502
    assert "connection refused" in r.json()["detail"]
