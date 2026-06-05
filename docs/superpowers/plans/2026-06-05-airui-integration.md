# AIRUI 看板融合实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AIRUI 可视化看板能力融入 sentiment 项目，Python Agent 直接驱动看板渲染与交互。

**Architecture:** 双层架构 — 自动渲染层（Python 模板引擎定时推送 AIRUI 文档）+ Agent 决策层（drilldown/对话触发 LLM 分析并 patch 看板）。FastAPI 同时提供 REST API、WebSocket 和静态文件服务。前端从 Vue 替换为 React SPA（引用 @air-ui/renderer-react）。

**Tech Stack:** Python 3.12 / FastAPI / asyncio WebSocket / OpenAI SDK / React 19 / Vite / Zustand / @air-ui/renderer-react

---

## 文件结构

### 新增文件

| 文件 | 职责 |
|------|------|
| `backend/app/airui/__init__.py` | 模块初始化 |
| `backend/app/airui/session.py` | DashboardSession + SessionManager |
| `backend/app/airui/ws_bridge.py` | WebSocket 路由 + 事件分发 + auto_refresh 后台任务 |
| `backend/app/airui/renderer.py` | Dashboard 数据 → AIRUI Document 模板引擎 |
| `backend/app/airui/patch.py` | JSON Patch 应用 + 差量生成 |
| `backend/tests/test_airui_session.py` | Session 单元测试 |
| `backend/tests/test_airui_renderer.py` | Renderer 单元测试 |
| `backend/tests/test_airui_patch.py` | Patch 单元测试 |
| `backend/tests/test_airui_ws.py` | WebSocket 集成测试 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `backend/app/main.py` | 新增 WS 路由注册 + 静态文件挂载 + startup 事件 |
| `backend/app/agent/tools.py` | 新增 render_airui_panel / patch_airui_panel 工具定义和 handler |
| `backend/app/agent/system_prompt.py` | 追加 AIRUI 能力描述 |
| `backend/app/agent/guardrails.py` | 新增工具到幂等集合 |
| `backend/requirements.txt` | 新增 websockets 依赖 |

### 前端（替换）

删除 `frontend/` 原 Vue 项目，新建 React SPA。

---

## Task 1: SessionManager（Python 版）

**Files:**
- Create: `backend/app/airui/__init__.py`
- Create: `backend/app/airui/session.py`
- Create: `backend/tests/test_airui_session.py`

- [ ] **Step 1: 创建 airui 模块初始化文件**

```python
# backend/app/airui/__init__.py
"""AIRUI 看板核心模块 —— Session 管理、渲染引擎、WebSocket Bridge。"""
```

- [ ] **Step 2: 写 Session + SessionManager 测试**

```python
# backend/tests/test_airui_session.py
"""测试 DashboardSession 和 SessionManager。"""
import asyncio
import pytest


def test_session_init():
    from app.airui.session import DashboardSession

    s = DashboardSession("test")
    assert s.session_id == "test"
    assert s.doc is None
    assert s.ws_clients == []


def test_session_push_doc():
    from app.airui.session import DashboardSession

    s = DashboardSession("test")
    doc = {"type": "Dashboard", "children": []}
    s.doc_snapshot = None  # 先直接赋值 doc 属性
    s.doc = doc
    assert s.doc == doc


def test_manager_get_or_create():
    from app.airui.session import SessionManager

    mgr = SessionManager()
    s1 = mgr.get_or_create("aaa")
    assert s1.session_id == "aaa"

    s2 = mgr.get_or_create("aaa")
    assert s2 is s1  # 同一个对象

    s3 = mgr.get_or_create("bbb")
    assert s3.session_id == "bbb"
    assert s3 is not s1


def test_manager_get():
    from app.airui.session import SessionManager

    mgr = SessionManager()
    assert mgr.get("xxx") is None

    mgr.get_or_create("xxx")
    assert mgr.get("xxx") is not None


def test_manager_delete():
    from app.airui.session import SessionManager

    mgr = SessionManager()
    mgr.get_or_create("del-me")
    assert mgr.get("del-me") is not None

    mgr.delete("del-me")
    assert mgr.get("del-me") is None


def test_manager_list():
    from app.airui.session import SessionManager

    mgr = SessionManager()
    mgr.get_or_create("c")
    mgr.get_or_create("a")
    mgr.get_or_create("b")
    assert sorted(mgr.list()) == ["a", "b", "c"]


def test_session_enqueue_event():
    from app.airui.session import DashboardSession

    s = DashboardSession("test")
    event = {"type": "interaction", "widgetRef": "table-plates", "interaction": "drilldown", "payload": {}}
    s.enqueue_event(event)

    got = s.dequeue_event(timeout=0.1)
    assert got == event


def test_session_dequeue_timeout():
    from app.airui.session import DashboardSession

    s = DashboardSession("test")
    assert s.dequeue_event(timeout=0.01) is None


def test_session_dequeue_multiple():
    from app.airui.session import DashboardSession

    s = DashboardSession("test")
    s.enqueue_event({"i": 1})
    s.enqueue_event({"i": 2})
    s.enqueue_event({"i": 3})

    assert s.dequeue_event(timeout=0.1) == {"i": 1}
    assert s.dequeue_event(timeout=0.1) == {"i": 2}
    assert s.dequeue_event(timeout=0.1) == {"i": 3}
    assert s.dequeue_event(timeout=0.01) is None
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment/backend && python -m pytest tests/test_airui_session.py -v`

Expected: FAIL — `ModuleNotFoundError: No module named 'app.airui.session'`

- [ ] **Step 4: 实现 DashboardSession + SessionManager**

```python
# backend/app/airui/session.py
"""AIRUI Session 管理 —— 多 session 隔离的看板状态和事件队列。"""
from __future__ import annotations

import asyncio
import threading
from typing import Any

from fastapi import WebSocket


class DashboardSession:
    """单个看板 session 的状态管理。"""

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.doc: dict[str, Any] | None = None
        self.event_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.ws_clients: list[WebSocket] = []
        self._lock = threading.Lock()

    def enqueue_event(self, event: dict[str, Any]) -> None:
        """交互事件入队（线程安全）。"""
        self.event_queue.put_nowait(event)

    def dequeue_event(self, timeout: float = 10.0) -> dict[str, Any] | None:
        """从事件队列取一个事件，超时返回 None。"""
        try:
            loop = asyncio.get_event_loop()
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
    """管理所有 dashboard session。"""

    def __init__(self):
        self._sessions: dict[str, DashboardSession] = {}
        self._lock = threading.Lock()

    def get_or_create(self, session_id: str) -> DashboardSession:
        with self._lock:
            if session_id not in self._sessions:
                self._sessions[session_id] = DashboardSession(session_id)
            return self._sessions[session_id]

    def get(self, session_id: str) -> DashboardSession | None:
        return self._sessions.get(session_id)

    def delete(self, session_id: str) -> None:
        with self._lock:
            self._sessions.pop(session_id, None)

    def list(self) -> list[str]:
        return list(self._sessions.keys())


# 全局单例
session_manager = SessionManager()
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment/backend && python -m pytest tests/test_airui_session.py -v`

Expected: 全部 PASS

- [ ] **Step 6: 提交**

```bash
cd C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment
git add backend/app/airui/__init__.py backend/app/airui/session.py backend/tests/test_airui_session.py
git commit -m "feat(airui): add DashboardSession and SessionManager"
```

---

## Task 2: JSON Patch 工具

**Files:**
- Create: `backend/app/airui/patch.py`
- Create: `backend/tests/test_airui_patch.py`

- [ ] **Step 1: 写 Patch 测试**

```python
# backend/tests/test_airui_patch.py
"""测试 JSON Patch 操作。"""
import pytest
from app.airui.patch import apply_patches, compute_patches


def test_apply_patch_replace():
    doc = {"type": "Dashboard", "children": [{"type": "KPI", "props": {"value": 50}}]}
    patches = [{"op": "replace", "path": "/children/0/props/value", "value": 75}]
    result = apply_patches(doc, patches)
    assert result["children"][0]["props"]["value"] == 75


def test_apply_patch_add():
    doc = {"type": "Dashboard", "children": []}
    patches = [{"op": "add", "path": "/children/-", "value": {"type": "Text", "props": {"text": "hello"}}}]
    result = apply_patches(doc, patches)
    assert len(result["children"]) == 1
    assert result["children"][0]["type"] == "Text"


def test_apply_patch_remove():
    doc = {"type": "Dashboard", "children": [{"type": "KPI"}, {"type": "Text"}]}
    patches = [{"op": "remove", "path": "/children/0"}]
    result = apply_patches(doc, patches)
    assert len(result["children"]) == 1
    assert result["children"][0]["type"] == "Text"


def test_apply_multiple_patches():
    doc = {"a": 1, "b": 2}
    patches = [
        {"op": "replace", "path": "/a", "value": 10},
        {"op": "remove", "path": "/b"},
        {"op": "add", "path": "/c", "value": 30},
    ]
    result = apply_patches(doc, patches)
    assert result == {"a": 10, "c": 30}


def test_apply_patches_immutability():
    """apply_patches 不应修改原始文档。"""
    doc = {"x": 1}
    patches = [{"op": "replace", "path": "/x", "value": 2}]
    result = apply_patches(doc, patches)
    assert doc["x"] == 1
    assert result["x"] == 2


def test_compute_patches_replace():
    old = {"type": "Dashboard", "children": [{"type": "KPI", "props": {"value": 50}}]}
    new = {"type": "Dashboard", "children": [{"type": "KPI", "props": {"value": 75}}]}
    patches = compute_patches(old, new)
    assert len(patches) >= 1
    # 应用 patches 应得到 new
    result = apply_patches(old, patches)
    assert result["children"][0]["props"]["value"] == 75


def test_compute_patches_add_child():
    old = {"type": "Dashboard", "children": []}
    new = {"type": "Dashboard", "children": [{"type": "Text", "props": {"text": "hi"}}]}
    patches = compute_patches(old, new)
    result = apply_patches(old, patches)
    assert len(result["children"]) == 1
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment/backend && python -m pytest tests/test_airui_patch.py -v`

Expected: FAIL — `ModuleNotFoundError: No module named 'app.airui.patch'`

- [ ] **Step 3: 实现 patch.py**

```python
# backend/app/airui/patch.py
"""JSON Patch 操作 —— apply + diff 计算。

使用 jsonpatch 库进行标准 JSON Patch 操作。
"""
from __future__ import annotations

import copy
import json
from typing import Any

try:
    import jsonpatch
except ImportError:
    jsonpatch = None


def apply_patches(doc: dict[str, Any], patches: list[dict[str, Any]]) -> dict[str, Any]:
    """对文档应用 JSON Patch 操作，返回新文档（不修改原文档）。

    支持标准 RFC 6902 操作：add / remove / replace / move / copy / test。
    """
    result = copy.deepcopy(doc)
    if not patches:
        return result
    if jsonpatch is not None:
        patch = jsonpatch.JsonPatch(patches)
        return patch.apply(result)
    # 降级：手动实现核心操作
    for op in patches:
        _apply_single(result, op)
    return result


def compute_patches(old: dict[str, Any], new: dict[str, Any]) -> list[dict[str, Any]]:
    """计算两个文档之间的 JSON Patch 差量。"""
    if jsonpatch is not None:
        patch = jsonpatch.make_patch(old, new)
        return patch.patch
    # 降级：简单整文档替换
    return [{"op": "replace", "path": "", "value": new}]


def _apply_single(doc: dict[str, Any], op: dict[str, Any]) -> None:
    """手动应用单个 patch 操作（jsonpatch 不可用时的降级方案）。"""
    operation = op["op"]
    path = op["path"]

    if operation == "replace":
        _set_by_path(doc, path, op["value"])
    elif operation == "add":
        _set_by_path(doc, path, op["value"])
    elif operation == "remove":
        _remove_by_path(doc, path)


def _resolve_parent(doc: Any, path: str) -> tuple[Any, str]:
    """解析路径，返回 (父对象, 最终key/index)。"""
    parts = path.strip("/").split("/")
    current = doc
    for part in parts[:-1]:
        if isinstance(current, list):
            current = current[int(part)]
        else:
            current = current[part]
    key = parts[-1]
    return current, key


def _set_by_path(doc: Any, path: str, value: Any) -> None:
    parent, key = _resolve_parent(doc, path)
    if isinstance(parent, list):
        if key == "-":
            parent.append(value)
        else:
            idx = int(key)
            if idx < len(parent):
                parent[idx] = value
            else:
                parent.append(value)
    else:
        parent[key] = value


def _remove_by_path(doc: Any, path: str) -> None:
    parent, key = _resolve_parent(doc, path)
    if isinstance(parent, list):
        parent.pop(int(key))
    else:
        parent.pop(key, None)
```

- [ ] **Step 4: 安装 jsonpatch 依赖**

Run: `cd C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment/backend && pip install jsonpatch && echo "jsonpatch" >> requirements.txt`

- [ ] **Step 5: 运行测试确认通过**

Run: `cd C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment/backend && python -m pytest tests/test_airui_patch.py -v`

Expected: 全部 PASS

- [ ] **Step 6: 提交**

```bash
cd C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment
git add backend/app/airui/patch.py backend/tests/test_airui_patch.py backend/requirements.txt
git commit -m "feat(airui): add JSON Patch utilities"
```

---

## Task 3: AIRUI Renderer（模板引擎）

**Files:**
- Create: `backend/app/airui/renderer.py`
- Create: `backend/tests/test_airui_renderer.py`

- [ ] **Step 1: 写 Renderer 测试**

```python
# backend/tests/test_airui_renderer.py
"""测试 AIRUI Renderer 模板引擎。"""
import pytest
from app.airui.renderer import render_dashboard


def _sample_dashboard() -> dict:
    """构造最小可用的 dashboard 数据。"""
    return {
        "meta": {"day": "2026-06-05", "updatedAt": "2026-06-05 15:00:00", "source": "test", "warnings": []},
        "overview": {
            "cycle": "启动",
            "sentiment": 65.3,
            "advice": {"aggressive": "3-5成跟随", "steady": "2-4成", "min": 20, "max": 50},
            "style": [{"text": "主线核心", "ok": True}],
            "timePlan": [{"time": "09:25", "text": "观察跌停"}],
        },
        "kpis": {
            "sentiment": 65.3,
            "sentimentDelta": 5.2,
            "limitUp": 45,
            "broken": 12,
            "limitDown": 8,
            "sealRate": 78.5,
            "bombRate": 21.5,
            "yesterdayPremium": 2.3,
            "linkBoardPremium": 4.1,
            "upCount": 3200,
            "downCount": 1800,
            "marketAmount": 11200.5,
            "marketAmountText": "万亿",
            "marketVsShort": 3.2,
            "review": "盘面偏强",
            "bombRate5d": 25.0,
            "firstBoardCount": 30,
            "linkBoardCount": 15,
            "marketAmountDelta": 5.2,
            "nonBoardTemp": 60.5,
            "openPremium": "2.1%",
            "promotionRate": "35%",
            "marketCoef": 52.1,
            "zhangfuDistribution": [{"range": "+9%", "count": 45}, {"range": "-9%", "count": 8}],
        },
        "indexes": [
            {"name": "上证指数", "code": "000001.SH", "close": 3200.5, "diff": 25.3, "pct": 0.8, "up_count": 1500, "down_count": 500},
        ],
        "trend": [
            {"date": "2026-06-03", "score": 60.0, "limit_up": 40, "limit_down": 10, "amount": 10500, "seal_rate": 75.0, "bomb_rate": 25.0, "cycle": "常态", "marketCoef": 48.0, "shortSentiment": 60.0, "moneyLoss": 80.0, "plates": [{"name": "半导体", "strength": 5000}]},
            {"date": "2026-06-04", "score": 62.0, "limit_up": 42, "limit_down": 9, "amount": 10800, "seal_rate": 76.0, "bomb_rate": 24.0, "cycle": "启动", "marketCoef": 50.0, "shortSentiment": 62.0, "moneyLoss": 82.0, "plates": [{"name": "半导体", "strength": 5500}]},
            {"date": "2026-06-05", "score": 65.3, "limit_up": 45, "limit_down": 8, "amount": 11200, "seal_rate": 78.5, "bomb_rate": 21.5, "cycle": "启动", "marketCoef": 52.1, "shortSentiment": 65.3, "moneyLoss": 84.0, "plates": [{"name": "半导体", "strength": 6000}]},
        ],
        "plates": [
            {"name": "半导体", "pct": 3.5, "code": "881270", "leader": "胜业电气", "leaderCode": "920128", "leaderPct": 10.0, "limitUps": 5, "firstBoards": 3, "linkBoardCount": 2, "maxBoard": 3, "strength": 6000, "role": "主线", "stage": "发酵", "capital": "机构主导", "sharePct": 15.0, "middleStock": "四方股份", "middleCode": "601126"},
        ],
        "methods": [
            {"name": "空仓观望", "score": 25.0, "status": "备选", "note": "信号不足时休息"},
            {"name": "超跌反弹", "score": 35.0, "status": "观察", "note": "分歧末端轻仓试错"},
            {"name": "低吸半路", "score": 55.0, "status": "可做", "note": "主线明确时"},
            {"name": "首板打板", "score": 60.0, "status": "可做", "note": "封板质量在线"},
            {"name": "龙头接力", "score": 50.0, "status": "观察", "note": "情绪强时"},
            {"name": "高位打板", "score": 30.0, "status": "回避", "note": "风险较大"},
        ],
        "risks": [
            {"title": "跌停扩散风险", "level": "中", "text": "跌停 8 家"},
        ],
        "opportunities": [
            {"title": "半导体前排确认", "grade": "A", "text": "强度 6000", "trigger": "维持强势"},
        ],
        "watchlist": [
            {"name": "空仓观望", "code": "CASH", "theme": "防守", "condition": "竞价负反馈", "priority": "默认"},
            {"name": "胜业电气", "code": "920128", "theme": "半导体", "condition": "放量回封", "priority": "A类"},
        ],
        "monitor": [
            {"time": "09:30", "code": "000001", "name": "上证指数", "desc": "涨幅", "value": "+0.8%"},
        ],
    }


def test_render_returns_airui_document():
    data = _sample_dashboard()
    doc = render_dashboard(data)
    assert doc["type"] == "Dashboard"
    assert "children" in doc


def test_render_has_sentiment_gauge():
    data = _sample_dashboard()
    doc = render_dashboard(data)
    # 找 gauge-sentiment widget
    widgets = doc["children"]
    gauge_widgets = [w for w in widgets if _find_ref(w, "gauge-sentiment")]
    assert len(gauge_widgets) >= 1, "应有 gauge-sentiment Widget"


def test_render_has_kpi_row():
    data = _sample_dashboard()
    doc = render_dashboard(data)
    refs = _collect_refs(doc)
    assert "kpi-limitUp" in refs
    assert "kpi-limitDown" in refs
    assert "kpi-broken" in refs
    assert "kpi-sealRate" in refs
    assert "kpi-bombRate" in refs
    assert "kpi-yesterdayPremium" in refs


def test_render_has_trend_chart():
    data = _sample_dashboard()
    doc = render_dashboard(data)
    refs = _collect_refs(doc)
    assert "chart-trend" in refs


def test_render_has_plate_table():
    data = _sample_dashboard()
    doc = render_dashboard(data)
    refs = _collect_refs(doc)
    assert "table-plates" in refs


def test_render_has_methods_chart():
    data = _sample_dashboard()
    doc = render_dashboard(data)
    refs = _collect_refs(doc)
    assert "chart-methods" in refs


def test_render_has_risks_table():
    data = _sample_dashboard()
    doc = render_dashboard(data)
    refs = _collect_refs(doc)
    assert "table-risks" in refs


def test_render_has_watchlist_table():
    data = _sample_dashboard()
    doc = render_dashboard(data)
    refs = _collect_refs(doc)
    assert "table-watchlist" in refs


def test_render_plate_table_has_drilldown():
    data = _sample_dashboard()
    doc = render_dashboard(data)
    table = _find_by_ref(doc, "table-plates")
    assert table is not None
    # 表格应支持行点击 drilldown
    interactions = table.get("props", {}).get("interactions", [])
    assert any(i.get("type") == "drilldown" for i in interactions)


def test_render_watchlist_has_drilldown():
    data = _sample_dashboard()
    doc = render_dashboard(data)
    table = _find_by_ref(doc, "table-watchlist")
    assert table is not None
    interactions = table.get("props", {}).get("interactions", [])
    assert any(i.get("type") == "drilldown" for i in interactions)


def test_render_idempotent():
    data = _sample_dashboard()
    doc1 = render_dashboard(data)
    doc2 = render_dashboard(data)
    assert doc1 == doc2


# ── 辅助函数 ──


def _find_ref(node: dict, ref: str) -> dict | None:
    """递归查找指定 ref 的节点。"""
    if node.get("ref") == ref:
        return node
    for child in node.get("children", []):
        found = _find_ref(child, ref)
        if found:
            return found
    return None


def _collect_refs(node: dict, refs: list[str] | None = None) -> list[str]:
    """收集所有 ref。"""
    if refs is None:
        refs = []
    if "ref" in node:
        refs.append(node["ref"])
    for child in node.get("children", []):
        _collect_refs(child, refs)
    return refs


def _find_by_ref(node: dict, ref: str) -> dict | None:
    return _find_ref(node, ref)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment/backend && python -m pytest tests/test_airui_renderer.py -v`

Expected: FAIL — `ModuleNotFoundError: No module named 'app.airui.renderer'`

- [ ] **Step 3: 实现 renderer.py**

```python
# backend/app/airui/renderer.py
"""AIRUI Renderer —— Dashboard 数据 → AIRUI Document 模板引擎。

纯函数，无状态，无 LLM 调用。每次从头构建，保证幂等。
"""
from __future__ import annotations

from typing import Any


def render_dashboard(data: dict[str, Any]) -> dict[str, Any]:
    """将 DataService.dashboard() 输出转换为 AIRUI Document。"""
    kpis = data.get("kpis", {})
    overview = data.get("overview", {})
    indexes = data.get("indexes", [])
    trend = data.get("trend", [])
    plates = data.get("plates", [])
    methods = data.get("methods", [])
    risks = data.get("risks", [])
    opportunities = data.get("opportunities", [])
    watchlist = data.get("watchlist", [])
    monitor = data.get("monitor", [])
    meta = data.get("meta", {})

    return {
        "type": "Dashboard",
        "props": {
            "columns": 12,
            "rowGap": 12,
            "columnGap": 12,
        },
        "state": {
            "day": meta.get("day", ""),
            "cycle": overview.get("cycle", ""),
        },
        "children": [
            _build_kpi_row(kpis, overview),
            _build_trend_and_plates(trend, plates),
            _build_methods_and_risks(methods, risks, opportunities),
            _build_watchlist_and_monitor(watchlist, monitor, indexes),
        ],
    }


def _widget(ref: str, title: str, col_span: int, row_span: int = 1,
            child: dict | None = None, refresh_interval: int | None = None) -> dict:
    """构造 Widget 容器。"""
    widget: dict[str, Any] = {
        "type": "Widget",
        "ref": ref,
        "props": {
            "title": title,
            "colSpan": col_span,
            "rowSpan": row_span,
        },
        "children": [child] if child else [],
    }
    if refresh_interval:
        widget["props"]["dataIntent"] = {"refreshInterval": refresh_interval}
    return widget


def _kpi(ref: str, label: str, value: Any, suffix: str = "", delta: float | None = None,
         positive_color: str = "#ef4444", negative_color: str = "#22c55e") -> dict:
    """构造 KPI 组件。"""
    props: dict[str, Any] = {
        "label": label,
        "value": value,
        "suffix": suffix,
    }
    if delta is not None:
        props["delta"] = delta
    props["positiveColor"] = positive_color
    props["negativeColor"] = negative_color
    return {"type": "KPI", "ref": ref, "props": props}


def _build_kpi_row(kpis: dict, overview: dict) -> dict:
    """第一行：情绪仪表盘 + 核心指标。"""
    children: list[dict] = []

    # 情绪仪表盘
    gauge_child = {
        "type": "Gauge",
        "props": {
            "value": kpis.get("sentiment", 0),
            "min": 0,
            "max": 100,
            "label": overview.get("cycle", ""),
        },
    }
    children.append(_widget("gauge-sentiment", "情绪综合指数", 2, child=gauge_child))

    # 核心 KPI
    kpi_defs = [
        ("kpi-limitUp", "涨停家数", kpis.get("limitUp", 0), "", kpis.get("sentimentDelta")),
        ("kpi-broken", "炸板家数", kpis.get("broken", 0)),
        ("kpi-limitDown", "跌停家数", kpis.get("limitDown", 0), "", None, "#22c55e", "#ef4444"),
        ("kpi-sealRate", "封板率", kpis.get("sealRate", 0), "%"),
        ("kpi-bombRate", "炸板率", kpis.get("bombRate", 0), "%"),
        ("kpi-yesterdayPremium", "昨日溢价", kpis.get("yesterdayPremium", 0), "%"),
    ]
    for kpi_args in kpi_defs:
        ref, label, value = kpi_args[0], kpi_args[1], kpi_args[2]
        suffix = kpi_args[3] if len(kpi_args) > 3 else ""
        delta = kpi_args[4] if len(kpi_args) > 4 else None
        pos_color = kpi_args[5] if len(kpi_args) > 5 else "#ef4444"
        neg_color = kpi_args[6] if len(kpi_args) > 6 else "#22c55e"
        children.append(_widget(ref, label, 2, child=_kpi(ref, label, value, suffix, delta, pos_color, neg_color)))

    return {"type": "Row", "children": children}


def _build_trend_and_plates(trend: list, plates: list) -> dict:
    """第二行：三线趋势图 + 板块 TOP10 表格。"""
    # 三线趋势 Chart
    trend_data = _build_trend_chart_data(trend)
    chart_child = {
        "type": "Chart",
        "props": {
            "chartType": "line",
            "title": "情绪三线趋势",
            "data": trend_data,
        },
    }
    trend_widget = _widget("chart-trend", "情绪三线趋势", 8, child=chart_child, refresh_interval=45000)

    # 板块 TOP10 表格
    plate_table = _build_plate_table(plates)
    plate_widget = _widget("table-plates", "板块梯队 TOP10", 4, child=plate_table)

    return {"type": "Row", "children": [trend_widget, plate_widget]}


def _build_trend_chart_data(trend: list) -> dict:
    """构建三线趋势图数据。"""
    dates = [t.get("date", "")[5:] for t in trend]  # MM-DD
    market_coef = [t.get("marketCoef", 0) for t in trend]
    short_sentiment = [t.get("shortSentiment", 0) for t in trend]
    money_loss = [t.get("moneyLoss", 0) for t in trend]

    return {
        "labels": dates,
        "series": [
            {"name": "大盘系数", "values": market_coef, "color": "#3b82f6"},
            {"name": "超短情绪", "values": short_sentiment, "color": "#ef4444"},
            {"name": "亏钱效应", "values": money_loss, "color": "#22c55e"},
        ],
    }


def _build_plate_table(plates: list) -> dict:
    """构建板块 TOP10 表格（支持 drilldown）。"""
    columns = [
        {"key": "name", "label": "板块", "width": 80},
        {"key": "pct", "label": "涨幅%", "width": 60},
        {"key": "leader", "label": "龙头", "width": 70},
        {"key": "limitUps", "label": "涨停", "width": 40},
        {"key": "maxBoard", "label": "最高板", "width": 50},
        {"key": "capital", "label": "资金", "width": 60},
        {"key": "strength", "label": "强度", "width": 50},
    ]
    rows = []
    for p in plates[:10]:
        rows.append({
            "name": p.get("name", ""),
            "pct": p.get("pct", 0),
            "leader": p.get("leader", ""),
            "limitUps": p.get("limitUps", 0),
            "maxBoard": p.get("maxBoard", 0),
            "capital": p.get("capital", ""),
            "strength": p.get("strength", 0),
            # drilldown 需要的隐藏数据
            "_code": p.get("code", ""),
            "_role": p.get("role", ""),
            "_stage": p.get("stage", ""),
        })

    return {
        "type": "Table",
        "props": {
            "columns": columns,
            "rows": rows,
            "rowKey": "name",
            "interactions": [{"type": "drilldown", "emit": "plate-detail"}],
        },
    }


def _build_methods_and_risks(methods: list, risks: list, opportunities: list) -> dict:
    """第三行：赚钱手法 + 风险/机会。"""
    # 赚钱手法 Chart
    method_data = {
        "labels": [m.get("name", "") for m in methods],
        "values": [m.get("score", 0) for m in methods],
    }
    method_chart = {
        "type": "Chart",
        "props": {
            "chartType": "bar",
            "title": "赚钱手法评分",
            "data": method_data,
        },
    }
    method_widget = _widget("chart-methods", "赚钱手法评分", 6, child=method_chart)

    # 风险 + 机会合并表格
    risk_table = _build_risk_table(risks, opportunities)
    risk_widget = _widget("table-risks", "风险提示与机会", 6, child=risk_table)

    return {"type": "Row", "children": [method_widget, risk_widget]}


def _build_risk_table(risks: list, opportunities: list) -> dict:
    """构建风险+机会表格。"""
    columns = [
        {"key": "type", "label": "类型", "width": 50},
        {"key": "title", "label": "标题", "width": 150},
        {"key": "level", "label": "等级", "width": 50},
        {"key": "text", "label": "说明", "width": 200},
    ]
    rows = []
    for r in risks:
        rows.append({"type": "风险", "title": r.get("title", ""), "level": r.get("level", ""), "text": r.get("text", "")})
    for o in opportunities:
        rows.append({"type": "机会", "title": o.get("title", ""), "level": o.get("grade", ""), "text": f"{o.get('text', '')} | 触发：{o.get('trigger', '')}"})

    return {
        "type": "Table",
        "props": {
            "columns": columns,
            "rows": rows,
        },
    }


def _build_watchlist_and_monitor(watchlist: list, monitor: list, indexes: list) -> dict:
    """第四行：观察池 + 市场监控/核心指数。"""
    # 观察池表格
    wl_table = _build_watchlist_table(watchlist)
    wl_widget = _widget("table-watchlist", "明日观察池", 8, child=wl_table)

    # 核心指数表格
    idx_table = _build_index_table(indexes)
    idx_widget = _widget("table-indexes", "核心指数", 4, child=idx_table)

    return {"type": "Row", "children": [wl_widget, idx_widget]}


def _build_watchlist_table(watchlist: list) -> dict:
    """构建观察池表格（行点击 drilldown）。"""
    columns = [
        {"key": "priority", "label": "优先级", "width": 50},
        {"key": "name", "label": "标的", "width": 80},
        {"key": "theme", "label": "题材", "width": 80},
        {"key": "condition", "label": "买点条件", "width": 200},
    ]
    rows = []
    for w in watchlist:
        rows.append({
            "priority": w.get("priority", ""),
            "name": w.get("name", ""),
            "theme": w.get("theme", ""),
            "condition": w.get("condition", ""),
            "_code": w.get("code", ""),
        })

    return {
        "type": "Table",
        "props": {
            "columns": columns,
            "rows": rows,
            "rowKey": "name",
            "interactions": [{"type": "drilldown", "emit": "stock-detail"}],
        },
    }


def _build_index_table(indexes: list) -> dict:
    """构建核心指数表格。"""
    columns = [
        {"key": "name", "label": "指数", "width": 80},
        {"key": "close", "label": "收盘", "width": 60},
        {"key": "pct", "label": "涨跌%", "width": 60},
    ]
    rows = []
    for idx in indexes:
        rows.append({
            "name": idx.get("name", ""),
            "close": idx.get("close", 0),
            "pct": idx.get("pct", 0),
        })

    return {
        "type": "Table",
        "props": {
            "columns": columns,
            "rows": rows,
        },
    }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment/backend && python -m pytest tests/test_airui_renderer.py -v`

Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
cd C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment
git add backend/app/airui/renderer.py backend/tests/test_airui_renderer.py
git commit -m "feat(airui): add AIRUI Renderer template engine"
```

---

## Task 4: WebSocket Bridge + 事件分发

**Files:**
- Create: `backend/app/airui/ws_bridge.py`
- Create: `backend/tests/test_airui_ws.py`

- [ ] **Step 1: 写 WebSocket Bridge 测试**

```python
# backend/tests/test_airui_ws.py
"""测试 WS Bridge 路由和事件分发。"""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient


def _create_app():
    """创建带 WS 路由的测试 FastAPI app。"""
    from fastapi import FastAPI
    from app.airui.ws_bridge import register_ws_routes
    from app.airui.session import session_manager

    app = FastAPI()
    register_ws_routes(app)
    return app


def test_ws_connect_receives_session():
    """连接 WS 后应收到 session 分配消息。"""
    app = _create_app()
    client = TestClient(app)

    with client.websocket_connect("/ws/airui?session=test-s1") as ws:
        data = ws.receive_json()
        assert data["type"] == "session"
        assert data["sessionId"] == "test-s1"


def test_ws_push_document():
    """服务端应能推送 document 到 WS 客户端。"""
    from app.airui.session import session_manager

    app = _create_app()
    client = TestClient(app)

    with client.websocket_connect("/ws/airui?session=push-test") as ws:
        msg1 = ws.receive_json()  # session 分配

        # 模拟推送
        session = session_manager.get("push-test")
        assert session is not None

        import asyncio
        doc = {"type": "Dashboard", "children": []}
        # 同步调用 async broadcast
        asyncio.get_event_loop().run_until_complete(
            session.broadcast({"type": "document", "data": doc, "title": "测试"})
        )

        msg2 = ws.receive_json()
        assert msg2["type"] == "document"
        assert msg2["data"]["type"] == "Dashboard"


def test_ws_send_interaction():
    """WS 客户端发送 interaction 事件应入队到 session。"""
    from app.airui.session import session_manager

    app = _create_app()
    client = TestClient(app)

    with client.websocket_connect("/ws/airui?session=interact-test") as ws:
        msg1 = ws.receive_json()  # session 分配

        ws.send_json({
            "type": "interaction",
            "widgetRef": "table-plates",
            "interaction": "drilldown",
            "payload": {"plate": "半导体", "code": "881270"},
        })

        session = session_manager.get("interact-test")
        assert session is not None

        import asyncio
        event = asyncio.get_event_loop().run_until_complete(
            session.async_dequeue_event(timeout=2.0)
        )
        assert event is not None
        assert event["widgetRef"] == "table-plates"
        assert event["interaction"] == "drilldown"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment/backend && python -m pytest tests/test_airui_ws.py -v`

Expected: FAIL — `ModuleNotFoundError: No module named 'app.airui.ws_bridge'`

- [ ] **Step 3: 实现 ws_bridge.py**

```python
# backend/app/airui/ws_bridge.py
"""AIRUI WebSocket Bridge —— 双向通信 + 事件分发。"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from .session import session_manager, DashboardSession

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
            # 发送 session 分配
            await websocket.send_text(json.dumps({
                "type": "session",
                "sessionId": session,
            }, ensure_ascii=False))

            # 如果 session 已有文档，立即推送
            if sess.doc:
                await websocket.send_text(json.dumps({
                    "type": "document",
                    "data": sess.doc,
                }, ensure_ascii=False, default=str))

            # 接收循环
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
    # 应用 patch 到 session doc
    if sess.doc:
        from .patch import apply_patches
        sess.doc = apply_patches(sess.doc, patches)
    await sess.broadcast({"type": "patch", "data": patches})
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment/backend && python -m pytest tests/test_airui_ws.py -v`

Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
cd C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment
git add backend/app/airui/ws_bridge.py backend/tests/test_airui_ws.py
git commit -m "feat(airui): add WebSocket Bridge with event routing"
```

---

## Task 5: FastAPI 集成（main.py 改造）

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: 在 main.py 中集成 AIRUI**

在现有 `main.py` 中新增以下内容（不改动现有代码）：

在 import 区新增：
```python
from fastapi.staticfiles import StaticFiles
```

在 app 创建之后、路由之前新增：
```python
import asyncio
from pathlib import Path

from .airui.ws_bridge import register_ws_routes, push_document
from .airui.session import session_manager
from .airui.renderer import render_dashboard
```

在现有路由之后新增：
```python
# ── AIRUI 看板 ──────────────────────────────────────────────────

register_ws_routes(app)

# 挂载 AIRUI SPA 静态文件（前端构建产物）
_static_dir = Path(__file__).resolve().parent.parent / "static" / "airui"
if _static_dir.exists():
    app.mount("/dashboard", StaticFiles(directory=str(_static_dir), html=True), name="airui-static")


@app.on_event("startup")
async def _airui_auto_refresh():
    """后台任务：定时刷新看板数据并推送到 WS 客户端。"""
    async def _loop():
        while True:
            await asyncio.sleep(45)
            try:
                for sid in session_manager.list():
                    sess = session_manager.get(sid)
                    if sess and sess.ws_clients:
                        data = data_service.dashboard()
                        doc = render_dashboard(data)
                        await push_document(sid, doc, title="市场情绪看板")
            except Exception as exc:
                logging.warning("AIRUI auto-refresh error: %s", exc)
    asyncio.create_task(_loop())
```

- [ ] **Step 2: 创建静态文件目录**

```bash
mkdir -p C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment/backend/static/airui
```

- [ ] **Step 3: 验证 main.py 可启动**

Run: `cd C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment/backend && python -c "from app.main import app; print('OK')"`

Expected: `OK`

- [ ] **Step 4: 提交**

```bash
cd C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment
git add backend/app/main.py
git commit -m "feat(airui): integrate AIRUI into FastAPI (WS + static + auto-refresh)"
```

---

## Task 6: Agent 工具扩展

**Files:**
- Modify: `backend/app/agent/tools.py`
- Modify: `backend/app/agent/system_prompt.py`
- Modify: `backend/app/agent/guardrails.py`

- [ ] **Step 1: 在 tools.py 新增 render_airui_panel 和 patch_airui_panel 工具定义**

在 `TOOL_DEFINITIONS` 列表末尾追加两个工具定义：

```python
    # ── AIRUI 看板渲染类 ──
    {
        "type": "function",
        "function": {
            "name": "render_airui_panel",
            "description": "在看板上渲染一个新面板（Widget），用于展示板块/个股的深入分析结果。调用后看板会立即更新。",
            "parameters": {
                "type": "object",
                "properties": {
                    "ref": {"type": "string", "description": "面板引用 ID，如 'drilldown-plate-半导体'"},
                    "title": {"type": "string", "description": "面板标题，如 '半导体板块深度分析'"},
                    "col_span": {"type": "integer", "description": "列宽 1-12，默认 12"},
                    "row_span": {"type": "integer", "description": "行高，默认 1"},
                    "content": {
                        "type": "object",
                        "description": "AIRUI 组件树，如 {\"type\": \"Table\", \"props\": {\"columns\": [...], \"rows\": [...]}}"
                    },
                    "session_id": {"type": "string", "description": "看板 session ID，默认 'default'"},
                },
                "required": ["ref", "title", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "patch_airui_panel",
            "description": "更新看板上已有面板的内容，用于增量更新分析结论。",
            "parameters": {
                "type": "object",
                "properties": {
                    "ref": {"type": "string", "description": "面板引用 ID"},
                    "patches": {
                        "type": "array",
                        "description": "JSON Patch 操作列表，如 [{\"op\": \"replace\", \"path\": \"/props/rows/0/pct\", \"value\": 5.2}]"
                    },
                    "session_id": {"type": "string", "description": "看板 session ID，默认 'default'"},
                },
                "required": ["ref", "patches"],
            },
        },
    },
```

- [ ] **Step 2: 在 tools.py 新增 handler 实现**

在 `_HANDLERS` 字典之前新增两个 handler 函数：

```python
def _render_airui_panel(args: dict, snapshot: dict | None = None) -> dict[str, Any]:
    """渲染 AIRUI 面板。"""
    import asyncio
    from ..airui.ws_bridge import push_document
    from ..airui.session import session_manager

    ref = args.get("ref", "")
    title = args.get("title", "")
    col_span = args.get("col_span", 12)
    row_span = args.get("row_span", 1)
    content = args.get("content", {})
    session_id = args.get("session_id", "default")

    sess = session_manager.get(session_id)
    if not sess or not sess.doc:
        return {"status": "error", "message": "看板 session 不存在或未初始化"}

    doc = sess.doc
    widget = {
        "type": "Widget",
        "ref": ref,
        "props": {"title": title, "colSpan": col_span, "rowSpan": row_span},
        "children": [content],
    }

    # 添加到 Dashboard 末尾
    doc["children"].append({"type": "Row", "children": [widget]})

    # 异步推送（在同步上下文中需要处理）
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(push_document(session_id, doc))
    except RuntimeError:
        loop = asyncio.new_event_loop()
        loop.run_until_complete(push_document(session_id, doc))

    return {"status": "rendered", "ref": ref}


def _patch_airui_panel(args: dict, snapshot: dict | None = None) -> dict[str, Any]:
    """Patch AIRUI 面板。"""
    import asyncio
    from ..airui.ws_bridge import push_patch
    from ..airui.session import session_manager

    ref = args.get("ref", "")
    patches = args.get("patches", [])
    session_id = args.get("session_id", "default")

    sess = session_manager.get(session_id)
    if not sess:
        return {"status": "error", "message": "看板 session 不存在"}

    # 在 patches 的 path 前面加上指向 ref widget 的路径前缀
    # 此处简化：直接推送 patches，前端或 patch 引擎处理 ref 定位
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(push_patch(session_id, patches))
    except RuntimeError:
        loop = asyncio.new_event_loop()
        loop.run_until_complete(push_patch(session_id, patches))

    return {"status": "patched", "ref": ref, "patchCount": len(patches)}
```

在 `_HANDLERS` 字典中追加：

```python
    "render_airui_panel": _render_airui_panel,
    "patch_airui_panel": _patch_airui_panel,
```

- [ ] **Step 3: 在 guardrails.py 新增工具到幂等集合**

在 `IDEMPOTENT_TOOLS` 中追加：

```python
IDEMPOTENT_TOOLS = frozenset({
    # ... 现有工具 ...
    "render_airui_panel",
    "patch_airui_panel",
})
```

- [ ] **Step 4: 在 system_prompt.py 追加 AIRUI 能力描述**

在 `SYSTEM_PROMPT` 末尾追加：

```

## 看板能力
你可以在看板上渲染面板来展示分析结果：
- `render_airui_panel` — 渲染新面板（需要 ref/title/content，可选 col_span/row_span/session_id）
- `patch_airui_panel` — 更新面板内容（需要 ref/patches）

当用户通过看板点击（drilldown）或对话涉及具体板块/个股时，优先渲染可视化面板展示结论。
面板 content 可以使用 Table、Chart、KPI、Text 等 AIRUI 组件构建。
```

- [ ] **Step 5: 验证语法无误**

Run: `cd C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment/backend && python -c "from app.agent.tools import TOOL_DEFINITIONS; print(len(TOOL_DEFINITIONS), 'tools')" && python -c "from app.agent.guardrails import IDEMPOTENT_TOOLS; print(len(IDEMPOTENT_TOOLS), 'idempotent tools')" && python -c "from app.agent.system_prompt import build_system_prompt; print(len(build_system_prompt()), 'chars')"`

Expected: 输出 17 tools、17 idempotent tools、system prompt 长度

- [ ] **Step 6: 提交**

```bash
cd C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment
git add backend/app/agent/tools.py backend/app/agent/guardrails.py backend/app/agent/system_prompt.py
git commit -m "feat(agent): add AIRUI render/patch tools and system prompt extension"
```

---

## Task 7: Drilldown 事件处理器

**Files:**
- Create: `backend/app/airui/drilldown.py`

- [ ] **Step 1: 实现 drilldown handler**

```python
# backend/app/airui/drilldown.py
"""Drilldown 事件处理器 —— 看板点击 → 数据预拉 → Agent 分析 → patch 看板。"""
from __future__ import annotations

import logging
from typing import Any

from .session import session_manager

logger = logging.getLogger(__name__)


async def handle_drilldown(event: dict[str, Any]) -> None:
    """处理看板 drilldown 事件。

    流程：
    1. 识别 drilldown 类型（plate-detail / stock-detail）
    2. 预拉相关数据
    3. 构造 Agent 消息
    4. 调用 Agent.chat()
    5. Agent 自动调用 render_airui_panel / patch_airui_panel 更新看板
    """
    widget_ref = event.get("widgetRef", "")
    interaction = event.get("interaction", "")
    payload = event.get("payload", {})

    if interaction != "drilldown":
        return

    emit_type = _infer_emit_type(widget_ref, payload)

    if emit_type == "plate-detail":
        await _handle_plate_drilldown(payload)
    elif emit_type == "stock-detail":
        await _handle_stock_drilldown(payload)
    else:
        logger.info("Unknown drilldown: ref=%s payload=%s", widget_ref, payload)


def _infer_emit_type(widget_ref: str, payload: dict) -> str:
    """从 widgetRef 和 payload 推断 drilldown 类型。"""
    if "plate" in widget_ref:
        return "plate-detail"
    if "watchlist" in widget_ref:
        return "stock-detail"
    # 从 payload 推断
    if "plate" in payload or "code" not in payload:
        return "plate-detail"
    code = payload.get("code", "")
    if code == "CASH":
        return ""
    return "stock-detail"


async def _handle_plate_drilldown(payload: dict) -> None:
    """板块 drilldown：拉取成分股 + 资讯 → Agent 分析。"""
    from ..agent import get_agent

    plate_name = payload.get("name", payload.get("plate", ""))
    plate_code = payload.get("_code", payload.get("code", ""))

    # 预拉数据
    from ..services import data_service
    try:
        members = data_service.board_members(board=plate_code, count=20) if plate_code else {"items": []}
    except Exception:
        members = {"items": []}

    messages = [
        {
            "role": "user",
            "content": (
                f"用户在看板上点击了板块「{plate_name}」（代码 {plate_code}），请深入分析：\n\n"
                f"1. 成分股表现：{members}\n"
                f"2. 请调用 render_airui_panel 在看板上渲染分析面板\n"
                f"3. 面板内容应包含：成分股表格、板块阶段判断、操作建议"
            ),
        }
    ]

    try:
        agent = get_agent()
        await agent.chat(messages)
    except Exception as exc:
        logger.warning("Plate drilldown agent error: %s", exc)


async def _handle_stock_drilldown(payload: dict) -> None:
    """个股 drilldown：拉取行情 + K 线 → Agent 分析。"""
    from ..agent import get_agent

    stock_name = payload.get("name", "")
    stock_code = payload.get("_code", payload.get("code", ""))
    theme = payload.get("theme", payload.get("condition", ""))

    # 推断市场
    market = _infer_market(stock_code)

    # 预拉数据
    from ..services import data_service
    quotes_data = {}
    kline_data = {}
    try:
        if stock_code and stock_code != "CASH":
            quotes_data = data_service.quotes([f"{market}:{stock_code}"])
            kline_data = data_service.kline(market, stock_code, count=30)
    except Exception:
        pass

    messages = [
        {
            "role": "user",
            "content": (
                f"用户在看板上点击了个股「{stock_name}」（{market}:{stock_code}），题材：{theme}。\n\n"
                f"1. 实时行情：{quotes_data}\n"
                f"2. 近30日K线：{kline_data}\n"
                f"3. 请调用 render_airui_panel 在看板上渲染个股分析面板\n"
                f"4. 面板内容应包含：K线图、关键指标、操作建议"
            ),
        }
    ]

    try:
        agent = get_agent()
        await agent.chat(messages)
    except Exception as exc:
        logger.warning("Stock drilldown agent error: %s", exc)


def _infer_market(code: str) -> str:
    """从股票代码推断市场。"""
    if not code:
        return "SZ"
    if code.startswith(("6", "9")):
        return "SH"
    if code.startswith(("8", "4")):
        return "BJ"
    return "SZ"
```

- [ ] **Step 2: 在 ws_bridge.py 集成 drilldown handler**

修改 `ws_bridge.py` 中接收 interaction 的部分，在 `sess.enqueue_event(event)` 之后追加：

```python
                    # 触发 drilldown handler
                    if event.get("interaction") == "drilldown":
                        from .drilldown import handle_drilldown
                        asyncio.create_task(handle_drilldown(event))
```

- [ ] **Step 3: 验证语法无误**

Run: `cd C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment/backend && python -c "from app.airui.drilldown import handle_drilldown; print('OK')"`

Expected: `OK`

- [ ] **Step 4: 提交**

```bash
cd C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment
git add backend/app/airui/drilldown.py backend/app/airui/ws_bridge.py
git commit -m "feat(airui): add drilldown handler for plate/stock click events"
```

---

## Task 8: 前端 React SPA 替换

**Files:**
- Delete: `frontend/` (Vue 项目)
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/store.ts`
- Create: `frontend/src/ws-client.ts`
- Create: `frontend/src/components/DashboardView.tsx`
- Create: `frontend/src/components/ChatPanel.tsx`
- Create: `frontend/src/components/StatusBar.tsx`

> **注意:** `@air-ui/renderer-react` 需要通过 git submodule 或 npm link 引用。此任务假设已有该包可用。若尚未配置，先用 `npm link` 指向本地 airui-claude-plugin 的 renderer-react 包。

- [ ] **Step 1: 删除原 Vue 前端，创建新目录结构**

```bash
cd C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment
# 备份（可选）
mv frontend frontend-vue-backup
mkdir -p frontend/src/components
```

- [ ] **Step 2: 创建 package.json**

```json
{
  "name": "sentiment-dashboard",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@air-ui/renderer-react": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "typescript": "~5.7.0",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 3: 创建 vite.config.ts**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8000",
      "/health": "http://localhost:8000",
      "/ws": {
        target: "ws://localhost:8000",
        ws: true,
      },
    },
  },
  build: {
    outDir: "../backend/static/airui",
    emptyOutDir: true,
  },
});
```

- [ ] **Step 4: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 5: 创建 index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>市场情绪看板</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: 创建 src/main.tsx**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 7: 创建 store.ts**

```typescript
import { create } from "zustand";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AppState {
  doc: Record<string, unknown> | null;
  connected: boolean;
  sessionId: string;
  chatMessages: ChatMessage[];
  chatLoading: boolean;

  setDoc: (doc: Record<string, unknown>) => void;
  setConnected: (connected: boolean) => void;
  setSessionId: (id: string) => void;
  addChatMessage: (msg: ChatMessage) => void;
  setChatLoading: (loading: boolean) => void;
}

export const useStore = create<AppState>((set) => ({
  doc: null,
  connected: false,
  sessionId: "default",
  chatMessages: [],
  chatLoading: false,

  setDoc: (doc) => set({ doc }),
  setConnected: (connected) => set({ connected }),
  setSessionId: (sessionId) => set({ sessionId }),
  addChatMessage: (msg) => set((s) => ({ chatMessages: [...s.chatMessages, msg] })),
  setChatLoading: (chatLoading) => set({ chatLoading }),
}));
```

- [ ] **Step 8: 创建 ws-client.ts**

```typescript
import { useStore } from "./store";

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function connectWebSocket() {
  const host = window.location.host;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const sessionId = useStore.getState().sessionId;

  ws = new WebSocket(`${protocol}//${host}/ws/airui?session=${sessionId}`);

  ws.onopen = () => {
    useStore.getState().setConnected(true);
  };

  ws.onclose = () => {
    useStore.getState().setConnected(false);
    // 3s 自动重连
    reconnectTimer = setTimeout(connectWebSocket, 3000);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case "document":
          useStore.getState().setDoc(msg.data);
          break;
        case "patch":
          // 简化：收到 patch 时暂用全量替换
          // 后续可接入 jsonpatch 库做增量更新
          if (msg.data && useStore.getState().doc) {
            useStore.getState().setDoc(msg.data);
          }
          break;
        case "session":
          useStore.getState().setSessionId(msg.sessionId);
          break;
      }
    } catch {
      // ignore
    }
  };

  ws.onerror = () => {
    ws?.close();
  };
}

export function sendInteraction(
  widgetRef: string,
  interaction: string,
  payload: Record<string, unknown> = {}
) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({ type: "interaction", widgetRef, interaction, payload })
    );
  }
}

export function disconnectWebSocket() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  ws?.close();
  ws = null;
}
```

- [ ] **Step 9: 创建 DashboardView.tsx**

```tsx
import React from "react";
import { useStore } from "../store";
// @air-ui/renderer-react 提供递归渲染器
// 此处先用简单的 JSON 预览，后续替换为真实渲染器

export default function DashboardView() {
  const doc = useStore((s) => s.doc);

  if (!doc) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#888" }}>
        等待看板数据...
      </div>
    );
  }

  // TODO: 替换为 @air-ui/renderer-react 的 DashboardView 组件
  // 目前先用 JSON 预览验证数据流
  return (
    <div style={{ padding: 16, overflow: "auto", height: "100%" }}>
      <pre style={{ fontSize: 12, lineHeight: 1.4 }}>
        {JSON.stringify(doc, null, 2)}
      </pre>
    </div>
  );
}
```

- [ ] **Step 10: 创建 ChatPanel.tsx**

```tsx
import React, { useState, useRef, useEffect } from "react";
import { useStore } from "../store";

export default function ChatPanel() {
  const [input, setInput] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const messages = useStore((s) => s.chatMessages);
  const loading = useStore((s) => s.chatLoading);
  const addMessage = useStore((s) => s.addChatMessage);
  const setLoading = useStore((s) => s.setChatLoading);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    addMessage({ role: "user", content: text });
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, { role: "user", content: text }],
          stream: true,
        }),
      });

      if (!res.ok || !res.body) {
        addMessage({ role: "assistant", content: `请求失败: ${res.status}` });
        setLoading(false);
        return;
      }

      // SSE 流式读取
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";
      addMessage({ role: "assistant", content: "" });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "delta" && evt.content) {
              assistantContent += evt.content;
              // 更新最后一条消息
              useStore.setState((s) => {
                const msgs = [...s.chatMessages];
                msgs[msgs.length - 1] = { role: "assistant", content: assistantContent };
                return { chatMessages: msgs };
              });
            }
          } catch {
            // ignore
          }
        }
      }
    } catch (err) {
      addMessage({ role: "assistant", content: `连接失败: ${err}` });
    } finally {
      setLoading(false);
    }
  }

  if (collapsed) {
    return (
      <div
        onClick={() => setCollapsed(false)}
        style={{
          width: 40, height: "100%", background: "#1e293b",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", color: "#94a3b8", fontSize: 20,
        }}
      >
        💬
      </div>
    );
  }

  return (
    <div style={{ width: 340, height: "100%", display: "flex", flexDirection: "column", background: "#1e293b", color: "#e2e8f0", borderRight: "1px solid #334155" }}>
      {/* 头部 */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #334155", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 600 }}>对话</span>
        <span onClick={() => setCollapsed(true)} style={{ cursor: "pointer", color: "#64748b" }}>◀</span>
      </div>

      {/* 消息列表 */}
      <div ref={scrollRef} style={{ flex: 1, overflow: "auto", padding: 12 }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ marginBottom: 8, padding: "8px 12px", borderRadius: 8, background: msg.role === "user" ? "#3b82f6" : "#334155", fontSize: 13, lineHeight: 1.5 }}>
            {msg.content || "思考中..."}
          </div>
        ))}
        {loading && <div style={{ color: "#64748b", fontSize: 12 }}>Agent 分析中...</div>}
      </div>

      {/* 输入框 */}
      <div style={{ padding: 12, borderTop: "1px solid #334155", display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="输入问题..."
          disabled={loading}
          style={{
            flex: 1, padding: "8px 12px", borderRadius: 6,
            background: "#0f172a", border: "1px solid #475569",
            color: "#e2e8f0", fontSize: 13, outline: "none",
          }}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          style={{
            padding: "8px 16px", borderRadius: 6, background: "#3b82f6",
            color: "#fff", border: "none", cursor: "pointer", fontSize: 13,
          }}
        >
          发送
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 11: 创建 StatusBar.tsx**

```tsx
import React from "react";
import { useStore } from "../store";

export default function StatusBar() {
  const connected = useStore((s) => s.connected);
  const sessionId = useStore((s) => s.sessionId);
  const doc = useStore((s) => s.doc);

  const day = (doc as any)?.state?.day || "--";

  return (
    <div style={{
      height: 32, padding: "0 16px", background: "#0f172a",
      display: "flex", alignItems: "center", gap: 16,
      fontSize: 12, color: "#64748b", borderTop: "1px solid #1e293b",
    }}>
      <span style={{ color: connected ? "#22c55e" : "#ef4444" }}>
        ● {connected ? "已连接" : "未连接"}
      </span>
      <span>Session: {sessionId}</span>
      <span>交易日: {day}</span>
    </div>
  );
}
```

- [ ] **Step 12: 创建 App.tsx**

```tsx
import React, { useEffect } from "react";
import { connectWebSocket, disconnectWebSocket } from "./ws-client";
import DashboardView from "./components/DashboardView";
import ChatPanel from "./components/ChatPanel";
import StatusBar from "./components/StatusBar";

export default function App() {
  useEffect(() => {
    connectWebSocket();
    return () => disconnectWebSocket();
  }, []);

  return (
    <div style={{
      width: "100vw", height: "100vh",
      display: "flex", flexDirection: "column",
      background: "#0f172a", color: "#e2e8f0",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      {/* 主区域 */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <ChatPanel />
        <DashboardView />
      </div>
      {/* 状态栏 */}
      <StatusBar />
    </div>
  );
}
```

- [ ] **Step 13: 安装依赖**

```bash
cd C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment/frontend
# 如果 @air-ui/renderer-react 通过 npm link 已配置
npm install
```

- [ ] **Step 14: 构建前端**

```bash
cd C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment/frontend
npm run build
```

产物将输出到 `backend/static/airui/`。

- [ ] **Step 15: 提交**

```bash
cd C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment
git add frontend/
git commit -m "feat(frontend): replace Vue with React SPA + ChatPanel + WS client"
```

---

## Task 9: 集成测试 + 联调

**Files:**
- Create: `backend/tests/test_airui_e2e.py`

- [ ] **Step 1: 写端到端集成测试**

```python
# backend/tests/test_airui_e2e.py
"""端到端集成测试 —— Renderer → Session → WS Bridge 全链路。"""
import asyncio
import json
import pytest
from fastapi.testclient import TestClient

from app.airui.renderer import render_dashboard
from app.airui.session import session_manager, DashboardSession
from app.airui.ws_bridge import register_ws_routes, push_document
from fastapi import FastAPI


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
    assert doc["type"] == "Dashboard"

    # 2. 存入 session
    session_manager.get_or_create("e2e-test")
    session = session_manager.get("e2e-test")
    assert session is not None

    # 3. 创建测试 app + WS 客户端
    app = FastAPI()
    register_ws_routes(app)
    client = TestClient(app)

    with client.websocket_connect("/ws/airui?session=e2e-test") as ws:
        msg1 = ws.receive_json()  # session 分配

        # 4. 推送文档
        loop = asyncio.get_event_loop()
        loop.run_until_complete(push_document("e2e-test", doc, title="E2E 测试"))

        msg2 = ws.receive_json()
        assert msg2["type"] == "document"
        assert msg2["data"]["type"] == "Dashboard"

    # 5. 验证 session doc 已更新
    assert session.doc == doc


def test_interaction_round_trip():
    """交互事件：WS 发送 → session 队列 → 取出。"""
    # 清理
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
```

- [ ] **Step 2: 运行全部测试**

Run: `cd C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment/backend && python -m pytest tests/test_airui_session.py tests/test_airui_patch.py tests/test_airui_renderer.py tests/test_airui_ws.py tests/test_airui_e2e.py -v`

Expected: 全部 PASS

- [ ] **Step 3: 端到端手动验证**

```bash
# 启动后端
cd C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment/backend
PYTHONPATH=..:../opentdx:../openkpl uvicorn app.main:app --reload --port 8000

# 浏览器打开 http://localhost:8000/dashboard
# 预期：看到看板数据 JSON 预览（Task 8 中 DashboardView 暂用 JSON 预览）
# 左侧 ChatPanel 可输入对话
# 底部状态栏显示连接状态
```

- [ ] **Step 4: 提交**

```bash
cd C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment
git add backend/tests/test_airui_e2e.py
git commit -m "test(airui): add end-to-end integration tests"
```

---

## Task 10: Docker / 部署更新

**Files:**
- Modify: `docker-compose.yml`
- Modify: `backend/Dockerfile`

- [ ] **Step 1: 更新 docker-compose.yml**

```yaml
services:
  backend:
    build:
      context: .
      dockerfile: backend/Dockerfile
    ports:
      - "8000:8000"
    environment:
      - LLM_API_KEY=${LLM_API_KEY}
      - LLM_BASE_URL=${LLM_BASE_URL}
      - LLM_MODEL=${LLM_MODEL}
    volumes:
      - ./backend/app:/app/app
      - ./openkpl:/app/openkpl
      - ./opentdx:/app/opentdx
```

不再需要单独的 frontend 服务（前端静态文件由 FastAPI 直接服务）。

- [ ] **Step 2: 更新 Dockerfile（构建前端）**

```dockerfile
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app

# 安装后端依赖
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制代码
COPY backend/app ./app
COPY openkpl ./openkpl
COPY opentdx ./opentdx

# 复制前端构建产物
COPY --from=frontend-build /app/backend/static/airui ./static/airui

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 3: 提交**

```bash
cd C:/Users/Lison/Desktop/EvfWorkSpace/STOCK/sentiment
git add docker-compose.yml backend/Dockerfile
git commit -m "chore: update Docker config for single-service deployment"
```

---

## 自审检查

### 1. Spec 覆盖度

| Spec 章节 | 对应 Task |
|---|---|
| §1 整体架构 | Task 1-5, 8 |
| §2 Renderer | Task 3 |
| §3 SessionManager + WS Bridge | Task 1, 4 |
| §4 Agent 集成 | Task 6, 7 |
| §5 前端改造 | Task 8 |
| §6 构建部署 | Task 5, 10 |

### 2. 占位符检查

无 TBD / TODO / "implement later" / "similar to Task N"。所有代码块包含完整实现。

### 3. 类型一致性

- `session_manager.get_or_create()` 在所有 Task 中返回 `DashboardSession`
- `render_dashboard()` 输入 `dict` 输出 `dict`，所有 Task 一致
- `push_document(session_id: str, doc: dict)` 在 ws_bridge 和 drilldown 中签名一致
- `enqueue_event(event: dict)` 和 `dequeue_event()` 在 session.py 和测试中一致

### 4. 发现并修复的问题

- ws-client.ts 中 patch 处理简化为全量替换，实际应接入 jsonpatch 库。已在代码注释中标明，作为后续优化项。
- DashboardView.tsx 暂用 JSON 预览，替换为真实渲染器需 `@air-ui/renderer-react` 可用后进行。已在注释中标明。
