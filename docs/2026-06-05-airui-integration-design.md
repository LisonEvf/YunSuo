# AIRUI 看板融合设计与现状

> 目标：将 AIRUI 可视化看板能力融入 sentiment 项目，使 Python Agent
> 可以驱动看板渲染与交互。
>
> 当前状态更新：2026-06-07

## 1. 现状摘要

AIRUI 后端核心链路已经落地并通过自动化测试：

- `backend/app/airui/session.py`：DashboardSession + SessionManager。
- `backend/app/airui/patch.py`：JSON Patch apply/diff。
- `backend/app/airui/renderer.py`：Dashboard 数据到 AirUIDocument。
- `backend/app/airui/ws_bridge.py`：FastAPI WebSocket bridge。
- `backend/app/airui/drilldown.py`：看板 drilldown 事件到 Agent 分析入口。
- `backend/app/main.py`：注册 `/ws/airui`，挂载 `/dashboard` 静态目录，启动时构建默认看板。

前端源码已替换为 React + AIRUI SPA，但当前 checkout/构建/静态部署存在阻塞：

- `AIRUI/` 子模块 URL 当前为 `.\\AIRUI\\`，在 macOS/Linux checkout 会失败。
- `frontend/` 依赖 `@air-ui/core` 和 `@air-ui/renderer-react` 的 workspace 包；
  `AIRUI/packages/core`、`AIRUI/packages/renderer-react` 缺失时无法安装。
- `backend/Dockerfile` 使用 `npm ci || true`，但没有 `package-lock.json`，Docker 构建会在
  `npm run build` 阶段因 `tsc` 缺失失败。
- 当前静态产物 `backend/static/airui/index.html` 引用 `/assets/...`，而后端挂载在
  `/dashboard`，浏览器访问 `/dashboard/` 会空白。

## 2. 架构

```
浏览器 React SPA
  ├─ ChatPanel       -> POST /api/chat (SSE)
  └─ DashboardView   -> ws://host/ws/airui?session=default
          |
          v
FastAPI
  ├─ /api/*          -> DataService / Agent
  ├─ /ws/airui       -> ws_bridge.py
  ├─ /dashboard/*    -> backend/static/airui
  └─ startup task    -> DataService.dashboard() -> render_dashboard() -> default session
```

渲染分两层：

- 自动渲染层：`DataService.dashboard()` 生成数据，`render_dashboard()` 转为
  `air-ui@1` 文档，WebSocket 推送到 `default` session。
- Agent 决策层：用户对话或 drilldown 触发 Agent；Agent 可调用
  `render_airui_panel` / `patch_airui_panel` 更新看板。

## 3. AIRUI 文档格式

`render_dashboard(data)` 输出标准 AirUIDocument：

```python
{
    "schema": "air-ui@1",
    "viewport": {"width": 1200, "height": 900},
    "state": {"day": "...", "cycle": "..."},
    "root": {
        "type": "Dashboard",
        "props": {"columns": 12, "rowGap": 12, "columnGap": 12},
        "children": [...]
    },
}
```

主要组件映射：

| Dashboard 字段 | AIRUI 组件 | ref |
|---|---|---|
| `overview` + `kpis.sentiment` | `Gauge` | `gauge-sentiment` |
| `kpis.limitUp` 等 | `KPI` in `Widget` | `kpi-*` |
| `trend` | `Chart` line | `chart-trend` |
| `plates` | `Table` | `table-plates` |
| `methods` | `Chart` bar | `chart-methods` |
| `risks` + `opportunities` | `Table` | `table-risks` |
| `watchlist` | `Table` | `table-watchlist` |
| `indexes` | `Table` | `table-indexes` |

## 4. WebSocket 协议

路由：

```text
/ws/airui?session=default
```

服务端到浏览器：

```json
{"type": "session", "sessionId": "default"}
{"type": "document", "data": {"schema": "air-ui@1"}}
{"type": "patch", "data": []}
```

浏览器到服务端：

```json
{
  "type": "interaction",
  "widgetRef": "table-plates",
  "interaction": "drilldown",
  "payload": {}
}
```

当前限制：启动时只为 `default` session 构建初始文档。新 session 会收到
`session` 消息，但不会自动收到 `document`，除非后续显式推送。

## 5. 测试结果

使用 Python 3.12 和 `backend/requirements.txt` 安装依赖后：

```bash
cd backend
python -m pytest tests -v
```

当前结果：

```text
31 passed
```

覆盖：

| 测试文件 | 数量 | 覆盖 |
|---|---:|---|
| `test_airui_session.py` | 8 | session CRUD、事件队列 |
| `test_airui_patch.py` | 7 | JSON Patch apply/diff |
| `test_airui_renderer.py` | 11 | AIRUI 文档结构和组件映射 |
| `test_airui_ws.py` | 3 | WebSocket session/document/interaction |
| `test_airui_e2e.py` | 2 | render -> session -> WS round trip |

## 6. 本地验证记录

已验证通过：

- FastAPI app 可导入并注册 `/health`、`/api/dashboard`、`/ws/airui`、`/dashboard`。
- `GET /health` 返回 `status: ok`。
- `GET /api/dashboard` 可返回真实市场数据，`meta.warnings` 为 0。
- `ws://127.0.0.1:8000/ws/airui?session=default` 可收到 `air-ui@1` document。

已验证失败/阻塞：

- `bun install` 因 `AIRUI/packages/*` workspace 缺失失败。
- `docker compose build --no-cache` 因 Dockerfile 前端阶段未安装依赖失败。
- 浏览器访问 `/dashboard/` 空白，原因是 HTML 引用 `/assets/...`，实际资源路径是
  `/dashboard/assets/...`。

## 7. 修复优先级

1. 修复 `.gitmodules` 的 `AIRUI` URL，保证跨平台能 checkout。
2. 修复 Dockerfile 前端阶段，统一使用 Bun 或补齐 npm lock。
3. 在 `frontend/vite.config.ts` 设置 `base: "/dashboard/"` 并重新构建静态产物。
4. 为 `/dashboard/` 增加浏览器级 smoke test。
5. 视需要让新 session 自动复制 `default` document 或触发一次初始渲染。
