"""面板与流程数据模型测试 —— 生成式 UI 客制化 SaaS 基石。

设计见 docs/generative-ui-agent-design.md §6。
"""
from __future__ import annotations

import threading
from pathlib import Path
import tempfile

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    """每个测试用独立临时库，避免污染真实 data/panels.db。"""
    from app.agent import panels as P

    tmp_db = tmp_path / "panels.db"
    monkeypatch.setattr(P, "DB_PATH", tmp_db)
    # 重置线程局部连接，强制重建到临时库
    monkeypatch.setattr(P, "_local", threading.local())
    P._init_db()
    yield
    # TestClient 的 lifespan 会触发模块导入；重置后下次测试重建


# ── 模块级 CRUD ───────────────────────────────────────────────

def test_create_and_get_panel_roundtrip():
    from app.agent import panels as P

    panel = P.create_panel(
        name="华东销售看板",
        starter_prompt="生成华东区销售看板",
        domain="sales",
        tags=["华东", "销售"],
        seed_intent={"action": "open", "target": "artifact-sales", "params": {"region": "华东"}},
    )
    assert panel["id"] is not None
    assert panel["name"] == "华东销售看板"
    assert panel["tags"] == ["华东", "销售"]
    assert panel["seed_intent"]["action"] == "open"

    got = P.get_panel(panel["id"])
    assert got is not None
    assert got["starter_prompt"] == "生成华东区销售看板"


def test_list_panels_filters_by_domain():
    from app.agent import panels as P

    P.create_panel(name="A", starter_prompt="pa", domain="sales")
    P.create_panel(name="B", starter_prompt="pb", domain="ops")
    P.create_panel(name="C", starter_prompt="pc", domain="sales")

    assert len(P.list_panels()) == 3
    sales = P.list_panels(domain="sales")
    assert len(sales) == 2
    assert all(p["domain"] == "sales" for p in sales)


def test_update_panel_fields():
    from app.agent import panels as P

    panel = P.create_panel(name="orig", starter_prompt="p")
    updated = P.update_panel(panel["id"], description="新描述", tags=["x", "y"])
    assert updated["description"] == "新描述"
    assert updated["tags"] == ["x", "y"]
    assert updated["name"] == "orig"  # 未更新字段保留


def test_delete_panel():
    from app.agent import panels as P

    panel = P.create_panel(name="del", starter_prompt="p")
    assert P.delete_panel(panel["id"]) is True
    assert P.get_panel(panel["id"]) is None
    assert P.delete_panel(99999) is False  # 不存在的 id


def test_create_and_list_flows():
    from app.agent import panels as P

    p1 = P.create_panel(name="看板", starter_prompt="pa")
    flow = P.create_flow(
        name="每周复盘",
        steps=[{"label": "看板", "panel_id": p1["id"]}, {"label": "退款", "prompt": "分析退款"}],
    )
    assert len(flow["steps"]) == 2
    flows = P.list_flows()
    assert len(flows) == 1
    assert flows[0]["name"] == "每周复盘"

    assert P.delete_flow(flow["id"]) is True
    assert len(P.list_flows()) == 0


# ── 路由集成 ──────────────────────────────────────────────────

@pytest.fixture
def client():
    from app.main import app

    with TestClient(app) as c:
        yield c


def test_panel_crud_routes(client, monkeypatch):
    from app.agent import panels as P

    # 路由用模块级 DB_PATH，指向临时库
    tmp = Path(tempfile.mkdtemp()) / "panels.db"
    monkeypatch.setattr(P, "DB_PATH", tmp)
    monkeypatch.setattr(P, "_local", threading.local())
    P._init_db()

    # 创建
    r = client.post("/api/panels", json={"name": "测试面板", "starter_prompt": "生成看板", "domain": "test"})
    assert r.status_code == 200
    panel = r.json()["panel"]
    pid = panel["id"]

    # 列表
    r = client.get("/api/panels")
    assert r.status_code == 200
    assert any(p["id"] == pid for p in r.json()["panels"])

    # 获取单个
    r = client.get(f"/api/panels/{pid}")
    assert r.status_code == 200
    assert r.json()["panel"]["name"] == "测试面板"

    # 404
    r = client.get("/api/panels/99999")
    assert r.status_code == 404

    # 删除
    r = client.delete(f"/api/panels/{pid}")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_panel_run_route_returns_starter(client, monkeypatch):
    from app.agent import panels as P

    tmp = Path(tempfile.mkdtemp()) / "panels.db"
    monkeypatch.setattr(P, "DB_PATH", tmp)
    monkeypatch.setattr(P, "_local", threading.local())
    P._init_db()

    r = client.post("/api/panels", json={
        "name": "看板",
        "starter_prompt": "生成运营看板",
        "seed_intent": {"action": "open", "target": "artifact-kpi"},
    })
    pid = r.json()["panel"]["id"]

    r = client.get(f"/api/panels/{pid}/run")
    assert r.status_code == 200
    body = r.json()
    assert body["starter_prompt"] == "生成运营看板"
    assert body["seed_intent"]["action"] == "open"


def test_flow_crud_routes(client, monkeypatch):
    from app.agent import panels as P

    tmp = Path(tempfile.mkdtemp()) / "panels.db"
    monkeypatch.setattr(P, "DB_PATH", tmp)
    monkeypatch.setattr(P, "_local", threading.local())
    P._init_db()

    r = client.post("/api/flows", json={"name": "复盘流", "steps": [{"label": "s1", "prompt": "p1"}]})
    assert r.status_code == 200
    fid = r.json()["flow"]["id"]

    r = client.get("/api/flows")
    assert len(r.json()["flows"]) == 1

    r = client.delete(f"/api/flows/{fid}")
    assert r.status_code == 200


# ── 内置预设 + MCP 工具 + Flow run 测试 ──────────────────────────

def test_seed_builtin_panels_is_idempotent(tmp_path, monkeypatch):
    from app.agent import panels as P

    monkeypatch.setattr(P, "DB_PATH", tmp_path / "p.db")
    monkeypatch.setattr(P, "_local", threading.local())
    first = P.seed_builtin_panels()
    second = P.seed_builtin_panels()
    assert first > 0  # 首次种子化有新增
    assert second == 0  # 幂等：再次种子化不重复
    builtins = [p for p in P.list_panels() if p["is_builtin"]]
    assert len(builtins) == first
    assert all(p["is_builtin"] for p in builtins)


def test_builtin_panels_are_protected_from_deletion(tmp_path, monkeypatch):
    from app.agent import panels as P

    monkeypatch.setattr(P, "DB_PATH", tmp_path / "p.db")
    monkeypatch.setattr(P, "_local", threading.local())
    P.seed_builtin_panels()
    builtin = [p for p in P.list_panels() if p["is_builtin"]][0]
    # 内置面板删不掉
    assert P.delete_panel(builtin["id"]) is False
    assert P.get_panel(builtin["id"]) is not None


def test_list_panels_filtered_by_builtin(tmp_path, monkeypatch):
    from app.agent import panels as P

    monkeypatch.setattr(P, "DB_PATH", tmp_path / "p.db")
    monkeypatch.setattr(P, "_local", threading.local())
    P.seed_builtin_panels()
    P.create_panel(name="我的", starter_prompt="自定义")
    only_builtin = P.list_panels_filtered(builtin=True)
    only_user = P.list_panels_filtered(builtin=False)
    assert all(p["is_builtin"] for p in only_builtin)
    assert all(not p["is_builtin"] for p in only_user)
    assert any(p["name"] == "我的" for p in only_user)


def test_create_panel_with_mcp_tools(tmp_path, monkeypatch):
    from app.agent import panels as P

    monkeypatch.setattr(P, "DB_PATH", tmp_path / "p.db")
    monkeypatch.setattr(P, "_local", threading.local())
    panel = P.create_panel(
        name="行情", starter_prompt="看行情", mcp_tools=["mcp_kpl_emotion_today", "mcp_tdx_goods_quotes"]
    )
    assert panel["mcp_tools"] == ["mcp_kpl_emotion_today", "mcp_tdx_goods_quotes"]
    assert panel["is_builtin"] is False


def test_panel_run_route_injects_mcp_tools_hint(client, monkeypatch):
    from app.agent import panels as P

    tmp = Path(tempfile.mkdtemp()) / "p.db"
    monkeypatch.setattr(P, "DB_PATH", tmp)
    monkeypatch.setattr(P, "_local", threading.local())
    r = client.post("/api/panels", json={
        "name": "行情", "starter_prompt": "看今日行情", "mcp_tools": ["mcp_kpl_emotion_today"],
    })
    pid = r.json()["panel"]["id"]
    r = client.get(f"/api/panels/{pid}/run")
    body = r.json()
    assert "mcp_kpl_emotion_today" in body["starter_prompt"]
    assert body["mcp_tools"] == ["mcp_kpl_emotion_today"]


def test_flow_run_route_serializes_steps(client, monkeypatch):
    from app.agent import panels as P

    tmp = Path(tempfile.mkdtemp()) / "p.db"
    monkeypatch.setattr(P, "DB_PATH", tmp)
    monkeypatch.setattr(P, "_local", threading.local())
    panel = client.post("/api/panels", json={
        "name": "看板", "starter_prompt": "看板", "mcp_tools": ["mcp_tool_x"],
    }).json()["panel"]
    flow = client.post("/api/flows", json={
        "name": "流", "steps": [{"label": "看板", "panel_id": panel["id"]}, {"label": "总结", "prompt": "写周报"}],
    }).json()["flow"]
    r = client.get(f"/api/flows/{flow['id']}/run")
    body = r.json()
    assert len(body["steps"]) == 2
    # panel 步骤展开并带 MCP 增强
    assert body["steps"][0]["panel_id"] == panel["id"]
    assert "mcp_tool_x" in body["steps"][0]["prompt"]
    # 内联步骤
    assert body["steps"][1]["prompt"] == "写周报"


def test_builtin_panel_delete_route_returns_403(client, monkeypatch):
    """内置面板 DELETE 应返回 403（受保护），而非 404（不存在）。"""
    from app.agent import panels as P

    tmp = Path(tempfile.mkdtemp()) / "p.db"
    monkeypatch.setattr(P, "DB_PATH", tmp)
    monkeypatch.setattr(P, "_local", threading.local())
    P.seed_builtin_panels()
    builtin = [p for p in P.list_panels() if p["is_builtin"]][0]
    r = client.delete(f"/api/panels/{builtin['id']}")
    assert r.status_code == 403
    # 面板仍在
    assert P.get_panel(builtin["id"]) is not None
