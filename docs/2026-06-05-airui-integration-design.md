# AIRUI 看板融合设计方案

> 将 airui-claude-plugin 的可视化看板能力融入 sentiment 项目，使 Python Agent 直接驱动看板渲染与交互，不再依赖 Claude Code 对话。
>
> **开发状态：✅ 已完成（2026-06-05）**

---

## 决策记录

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 前端方案 | 用 AIRUI React SPA 替换 Vue 看板 | 统一技术栈，获得 AIRUI 组件库能力 |
| 交互入口 | 看板内嵌 ChatPanel + 点击 drilldown 为主 | Agent 仅在需要智能分析时介入 |
| 后端方案 | Python 重写 WS Bridge + SessionManager | 消除 Bun 进程依赖，统一 Python 技术栈 |
| 前端组件管理 | npm 包引用 @air-ui/renderer-react | 保持独立仓库，通过 submodule 引用 |
| LLM 方案 | 复用现有 SentimentAgent | 一个 Agent 实例处理对话 + 看板渲染 |
| 渲染架构 | 双层：自动渲染层 + Agent 决策层 | 看板初始渲染零 LLM 开销，drilldown 才触发 LLM |

---

## 开发完成度

### 后端（Python）✅ 全部完成

| 文件 | 说明 | 状态 |
|------|------|------|
| `backend/app/airui/__init__.py` | 模块初始化 | ✅ |
| `backend/app/airui/session.py` | DashboardSession + SessionManager（线程安全） | ✅ 8 测试 |
| `backend/app/airui/patch.py` | JSON Patch apply + diff（基于 jsonpatch 库） | ✅ 7 测试 |
| `backend/app/airui/renderer.py` | Dashboard 数据 → AirUIDocument 模板引擎 | ✅ 11 测试 |
| `backend/app/airui/ws_bridge.py` | WebSocket 双向通信 + drilldown 事件路由 | ✅ 3 测试 |
| `backend/app/airui/drilldown.py` | 板块/个股 drilldown → Agent 分析 handler | ✅ |
| `backend/app/main.py` | WS 路由注册 + 静态文件挂载 + 45s 自动刷新 | ✅ |
| `backend/app/agent/tools.py` | 新增 render_airui_panel / patch_airui_panel 工具 | ✅ |
| `backend/app/agent/system_prompt.py` | 追加 AIRUI 看板能力描述 | ✅ |
| `backend/app/agent/guardrails.py` | 新工具加入幂等集合 | ✅ |
| `backend/requirements.txt` | 新增 jsonpatch>=1.33 | ✅ |

### 前端（React SPA）✅ 全部完成

| 文件 | 说明 | 状态 |
|------|------|------|
| `package.json` | 根 workspace 配置（frontend + AIRUI 子模块） | ✅ |
| `frontend/package.json` | 引用 @air-ui/core + @air-ui/renderer-react + echarts | ✅ |
| `frontend/vite.config.ts` | Vite 构建，产物输出到 backend/static/airui | ✅ |
| `frontend/tsconfig.json` | TypeScript 配置 | ✅ |
| `frontend/index.html` | SPA 入口 | ✅ |
| `frontend/src/main.tsx` | React 入口 | ✅ |
| `frontend/src/App.tsx` | 主布局：ChatPanel + DashboardView + StatusBar | ✅ |
| `frontend/src/store.ts` | Zustand store，使用 @air-ui/core applyPatches | ✅ |
| `frontend/src/ws-client.ts` | WS 客户端，3s 自动重连，patch 增量更新 | ✅ |
| `frontend/src/components/DashboardView.tsx` | InteractionProvider + AirUIComponent 渲染器 | ✅ |
| `frontend/src/components/ChatPanel.tsx` | 侧边对话栏，SSE 流式，可折叠 | ✅ |
| `frontend/src/components/StatusBar.tsx` | 底部连接状态 + 交易日 | ✅ |

### 部署 ✅ 全部完成

| 文件 | 说明 | 状态 |
|------|------|------|
| `AIRUI/` | git submodule 引入 @air-ui/core + @air-ui/renderer-react | ✅ |
| `docker-compose.yml` | 移除前端服务，单后端服务 | ✅ |
| `backend/Dockerfile` | 多阶段构建（前端 + 后端） | ✅ |
| `backend/static/airui/` | 前端构建产物 | ✅ 207KB |

### 测试 ✅ 31/31 PASS

| 测试文件 | 测试数 | 覆盖内容 |
|----------|--------|----------|
| `test_airui_session.py` | 8 | Session 初始化、get_or_create、get、delete、list、enqueue/dequeue |
| `test_airui_patch.py` | 7 | replace/add/remove、多重 patch、不可变性、compute_patches |
| `test_airui_renderer.py` | 11 | 文档结构、所有 Widget ref、drilldown 交互、幂等性 |
| `test_airui_ws.py` | 3 | WS 连接 session 分配、推送文档、交互事件入队 |
| `test_airui_e2e.py` | 2 | 全链路 render→session→WS、交互事件 round-trip |

### 设计方案与实际偏差

| 设计项 | 设计方案 | 实际实现 | 偏差说明 |
|--------|----------|----------|----------|
| Renderer 输出格式 | 扁平 `{type: "Dashboard", children: [...]}` | 标准 AirUIDocument `{schema, viewport, state, root}` | ✅ 按规范修正 |
| patch 处理 | 设计中未指定 | 使用 @air-ui/core 的 `applyPatches` | ✅ 补强 |
| Drilldown 文件 | 设计中未独立 | 独立为 `drilldown.py` | ✅ 职责更清晰 |
| 前端渲染器 | 设计中暂用 JSON 预览 | 直接用 AirUIComponent 真实渲染器 | ✅ 一步到位 |

---

## 1. 整体架构

```
sentiment/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 入口（新增 WS 路由 + 静态文件挂载）
│   │   ├── services.py          # DataService（不变）
│   │   ├── agent/               # 现有 Agent（扩展）
│   │   │   ├── agent.py         # SentimentAgent（新增 airui 工具）
│   │   │   ├── tools.py         # 工具定义（新增 render_airui_panel / patch_airui_panel）
│   │   │   └── ...
│   │   ├── airui/               # 新增：AIRUI 核心模块（Python 重写）
│   │   │   ├── __init__.py
│   │   │   ├── renderer.py      # Dashboard 数据 → AIRUI 文档模板引擎
│   │   │   ├── session.py       # SessionManager（Python 版）
│   │   │   ├── ws_bridge.py     # WebSocket Bridge（FastAPI WebSocket）
│   │   │   ├── patch.py         # JSON Patch 应用 + 差量生成
│   │   │   └── drilldown.py     # Drilldown 事件处理器
│   │   └── ...
│   ├── static/airui/            # 前端构建产物
│   └── tests/                   # 31 个测试
│
├── frontend/                    # AIRUI React SPA
│   ├── package.json             # 引用 @air-ui/core + @air-ui/renderer-react
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx              # 主布局（左侧 ChatPanel + 右侧看板）
│   │   ├── ChatPanel.tsx        # 侧边对话栏
│   │   ├── store.ts             # Zustand store（applyPatches 增量更新）
│   │   ├── ws-client.ts         # WS 客户端（与 Python ws_bridge 通信）
│   │   └── components/
│   │       ├── DashboardView.tsx # InteractionProvider + AirUIComponent
│   │       ├── ChatPanel.tsx
│   │       └── StatusBar.tsx
│   └── vite.config.ts           # 构建输出到 backend/static/airui
│
├── AIRUI/                       # git submodule → @air-ui/core + @air-ui/renderer-react
├── package.json                 # 根 workspace 配置
└── docker-compose.yml           # 单后端服务（含前端静态文件）
```

### 数据流

```
┌─────────────────────────────────────────────────────┐
│  浏览器 (React SPA)                                  │
│  ┌──────────────┐  ┌─────────────────────────────┐  │
│  │  ChatPanel   │  │  DashboardView (AIRUI 组件) │  │
│  │  用户对话     │  │  看板展示 + 用户点击         │  │
│  └──────┬───────┘  └──────────────┬──────────────┘  │
│         │    WS ◀──render/patch───┤    │ interaction │
└─────────┼─────────────────────────┼────┘────────────┘
          │                         │
┌─────────▼─────────────────────────▼──────────────────┐
│  FastAPI 后端                                         │
│                                                       │
│  ┌─────────────┐   ┌──────────────┐                  │
│  │  /ws/airui  │   │  /api/chat   │                  │
│  │  WS Bridge  │   │  Agent 对话   │                  │
│  └──────┬──────┘   └──────┬───────┘                  │
│         │                 │                           │
│  ┌──────▼─────────────────▼───────┐                  │
│  │        SessionManager          │                  │
│  │  session → eventQueue + doc    │                  │
│  └──────────────┬────────────────┘                  │
│                 │                                     │
│  ┌──────────────▼────────────────┐                  │
│  │  AIRUI Renderer (模板引擎)     │  ← 自动定时调用  │
│  │  DataService.dashboard()       │                  │
│  │    → AIRUI Document            │                  │
│  └───────────────────────────────┘                  │
│                                                       │
│  ┌───────────────────────────────┐                  │
│  │  SentimentAgent (LLM)         │  ← drilldown 时  │
│  │  新增: airui_render/patch 工具 │                  │
│  └───────────────────────────────┘                  │
└───────────────────────────────────────────────────────┘
```

### 两个层

1. **自动渲染层**：后端定时/数据变化时，`Renderer.render()` 把 `DataService.dashboard()` 转成 AIRUI 文档 → WS 推送
2. **Agent 决策层**：用户 drilldown/对话 → Agent 分析 → 调用 `render_airui_panel` / `patch_airui_panel` 更新局部看板

---

## 2. AIRUI Renderer（自动渲染层）

纯函数，把 `DataService.dashboard()` 的 JSON 输出转成标准 AirUIDocument。

### 输出格式

```python
{
    "schema": "air-ui@1",
    "viewport": {"width": 1200, "height": 900},
    "state": {"day": "2026-06-05", "cycle": "启动"},
    "root": {
        "type": "Dashboard",
        "props": {"columns": 12, "rowGap": 12, "columnGap": 12},
        "children": [...]
    }
}
```

### 映射关系

| Dashboard 数据字段 | AIRUI 组件 | ref |
|---|---|---|
| `overview` + `kpis.sentiment` | `Gauge` | `gauge-sentiment` |
| `kpis` (limitUp/broken/limitDown...) | 多个 `KPI` + `Widget` | `kpi-{field}` |
| `indexes` | `Table` | `table-indexes` |
| `trend` | `Chart` (line) | `chart-trend` |
| `plates` | `Table` | `table-plates` |
| `methods` | `Chart` (bar) | `chart-methods` |
| `risks` + `opportunities` | `Table` | `table-risks` |
| `watchlist` | `Table`（drilldown） | `table-watchlist` |

### 布局

```
Dashboard (grid 12列)
├─ Row
│  ├─ Widget(colSpan=2): Gauge — 情绪仪表盘
│  ├─ Widget(colSpan=2): KPI — 涨停家数
│  ├─ Widget(colSpan=2): KPI — 炸板率
│  ├─ Widget(colSpan=2): KPI — 跌停家数
│  ├─ Widget(colSpan=2): KPI — 封板率
│  └─ Widget(colSpan=2): KPI — 昨日溢价
├─ Row
│  ├─ Widget(colSpan=8): Chart(line) — 三线趋势
│  └─ Widget(colSpan=4): Table — 板块 TOP10（drilldown）
├─ Row
│  ├─ Widget(colSpan=6): Chart(bar) — 赚钱手法
│  ├─ Widget(colSpan=6): Table — 风险 + 机会
└─ Row
   ├─ Widget(colSpan=8): Table — 观察池（drilldown）
   └─ Widget(colSpan=4): Table — 核心指数
```

---

## 3. SessionManager + WS Bridge

### DashboardSession

- `doc`: 当前 AirUIDocument 快照
- `event_queue`: asyncio.Queue 交互事件队列
- `ws_clients`: 连接的 WS 客户端列表
- `broadcast()`: 向所有客户端广播
- `enqueue_event()` / `dequeue_event()`: 事件入队/出队

### SessionManager

- `get_or_create(id)`: 获取或创建 session（线程安全）
- `get(id)` / `delete(id)` / `list()`: CRUD

### WS Bridge

- 路由：`/ws/airui?session=default`
- 连接时推送 session 分配 + 现有文档
- 收到 interaction 事件 → 入队 + 触发 drilldown handler
- `push_document()` / `push_patch()`: 服务端主动推送

### 通信协议

```
# Server → Browser
{type: "document", data: AirUIDocument, title?: string}
{type: "patch", data: [Patch, ...]}
{type: "session", sessionId: string}

# Browser → Server
{type: "interaction", widgetRef: string, interaction: string, payload: object}
```

### 自动刷新

FastAPI startup 启动后台任务，45s 定时调用 `DataService.dashboard()` → `render_dashboard()` → `push_document()`。

---

## 4. Agent 集成

### 新增 LLM 工具

| 工具 | 用途 |
|---|---|
| `render_airui_panel` | 在看板上渲染新面板（ref/title/col_span/content） |
| `patch_airui_panel` | 更新已有面板内容（ref/patches） |

### Drilldown 交互流程

```
用户点击板块行 → WS 发送 drilldown 事件 → drilldown handler
→ 预拉数据（成分股/行情）→ 构造 Agent 消息 → Agent.chat()
→ Agent 调用 render_airui_panel → 看板自动更新
```

### system_prompt 扩展

追加 AIRUI 看板能力描述，引导 Agent 在 drilldown 时优先渲染可视化面板。

---

## 5. 前端改造

### 技术栈

- React 19 + Vite 6 + TypeScript
- @air-ui/core（AirUIDocument 类型 + applyPatches）
- @air-ui/renderer-react（AirUIComponent 递归渲染器）
- Zustand 状态管理
- ECharts 图表

### 布局

```
┌──────────────────────────────────────────────┐
│  AIRUI Sentiment Dashboard                    │
├────────────┬─────────────────────────────────┤
│ ChatPanel  │  DashboardView                   │
│ (340px可折) │  AirUIComponent 递归渲染器       │
│            │                                  │
│ SSE 流式   │  KPI / Gauge / Chart / Table ... │
│ 对话       │                                  │
├────────────┴─────────────────────────────────┤
│  StatusBar（连接状态 + Session + 交易日）      │
└──────────────────────────────────────────────┘
```

### 关键组件

- **DashboardView**: `InteractionProvider` + `AirUIComponent`，用户点击通过 interactionHandler → sendInteraction → WS
- **ChatPanel**: POST `/api/chat` SSE 流式，Agent 可触发看板更新
- **ws-client**: 3s 自动重连，document 全量推送，patch 增量更新（applyPatches）

---

## 6. 构建部署

### 构建流程

```bash
# 1. 确保 AIRUI 子模块有构建产物
cd AIRUI/packages/renderer-react && bunx tsc --build

# 2. 安装依赖
cd sentiment && bun install

# 3. 构建前端（产物输出到 backend/static/airui）
cd frontend && bunx --bun vite build

# 4. 启动后端（一个进程搞定）
cd backend && PYTHONPATH=..:../opentdx uvicorn app.main:app --port 8000
```

一个进程提供：
- `/dashboard/*` → AIRUI SPA 静态文件
- `/ws/airui` → WebSocket
- `/api/*` → REST API

### Docker

```bash
docker compose up --build
# 多阶段构建：node 编译前端 → python 运行后端
```

---

## 7. 实施计划完成状态

| 步骤 | 内容 | 状态 | 测试 |
|---|---|---|---|
| 1 | SessionManager + WS Bridge | ✅ | 8 + 3 |
| 2 | JSON Patch 工具 | ✅ | 7 |
| 3 | Renderer 模板引擎 | ✅ | 11 |
| 4 | FastAPI 集成 | ✅ | - |
| 5 | Agent 工具扩展 | ✅ | - |
| 6 | Drilldown 处理器 | ✅ | - |
| 7 | 前端 React SPA 替换 | ✅ | - |
| 8 | ChatPanel + WS 客户端 | ✅ | - |
| 9 | 集成测试 | ✅ | 2 |
| 10 | Docker 部署更新 | ✅ | - |

**总计 31 测试全部通过，前端构建成功。**
