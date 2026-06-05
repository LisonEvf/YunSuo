# AIRUI 看板融合设计方案

> 将 airui-claude-plugin 的可视化看板能力融入 sentiment 项目，使 Python Agent 直接驱动看板渲染与交互，不再依赖 Claude Code 对话。

---

## 决策记录

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 前端方案 | 用 AIRUI React SPA 替换 Vue 看板 | 统一技术栈，获得 AIRUI 组件库能力 |
| 交互入口 | 看板内嵌 ChatPanel + 点击 drilldown 为主 | Agent 仅在需要智能分析时介入 |
| 后端方案 | Python 重写 WS Bridge + SessionManager | 消除 Bun 进程依赖，统一 Python 技术栈 |
| 前端组件管理 | npm 包引用 @air-ui/renderer-react | 保持独立仓库，通过 submodule/link 引用 |
| LLM 方案 | 复用现有 SentimentAgent | 一个 Agent 实例处理对话 + 看板渲染 |
| 渲染架构 | 双层：自动渲染层 + Agent 决策层 | 看板初始渲染零 LLM 开销，drilldown 才触发 LLM |

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
│   │   │   └── patch.py         # JSON Patch 应用 + 差量生成
│   │   └── ...
│   └── ...
│
├── frontend/                    # 替换为 AIRUI React SPA
│   ├── package.json             # 引用 @air-ui/renderer-react
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx              # 主布局（左侧 ChatPanel + 右侧看板）
│   │   ├── ChatPanel.tsx        # 新增：侧边对话栏
│   │   ├── store.ts             # Zustand store
│   │   ├── ws-client.ts         # WS 客户端（与 Python ws_bridge 通信）
│   │   └── components/          # 复用 @air-ui/renderer-react 组件
│   └── vite.config.ts
│
└── ...
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

纯函数，把 `DataService.dashboard()` 的 JSON 输出转成 AIRUI Document。

### 映射关系

| Dashboard 数据字段 | AIRUI 组件 | ref |
|---|---|---|
| `overview` + `kpis.sentiment` | `Gauge` | `gauge-sentiment` |
| `kpis` (limitUp/broken/limitDown...) | 多个 `KPI` + `Widget` | `kpi-{field}` |
| `indexes` | `Table` | `table-indexes` |
| `trend` | `Chart` (line) | `chart-trend` |
| `plates` | `Table` + `Chart` (bar) | `table-plates` / `chart-plates` |
| `methods` | `Chart` (bar) | `chart-methods` |
| `risks` | `Table` | `table-risks` |
| `opportunities` | `Table` | `table-opportunities` |
| `watchlist` | `Table`（行点击 drilldown） | `table-watchlist` |
| `monitor` | `Table` | `table-monitor` |

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
   └─ Widget(colSpan=4): Table — 市场监控
```

### 关键设计点

- 每个 Widget 带 `ref`，用于 drilldown 定位和 patch
- Watchlist / PlateTable 的行点击 emit `drilldown` 事件，触发 Agent 分析
- Trend chart 的 `dataIntent.refreshInterval` 设为 45000ms（与 DataService 缓存同步）
- 函数内部无状态，每次调用从头构建，保证幂等

### 接口签名

```python
def render_dashboard(data: dict) -> dict:
    """Dashboard 数据 → AIRUI Document（纯函数，无 LLM）。"""
```

---

## 3. SessionManager + WS Bridge

### DashboardSession

```python
class DashboardSession:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.doc: dict | None = None           # 当前 AIRUI 文档快照
        self.event_queue: asyncio.Queue        # 浏览器交互事件队列
        self.ws_clients: list[WebSocket]       # 连接的浏览器 WS 客户端

    async def push_doc(self, doc: dict) -> None:
        """全量推送文档到所有 WS 客户端，更新 self.doc。"""

    async def push_patch(self, patches: list) -> None:
        """推送 patch 到所有 WS 客户端，更新 self.doc。"""

    async def enqueue_event(self, event: dict) -> None:
        """浏览器交互事件入队。"""
```

### SessionManager

```python
class SessionManager:
    _sessions: dict[str, DashboardSession]

    def get_or_create(self, session_id: str) -> DashboardSession
    def get(self, session_id: str) -> DashboardSession | None
    def delete(self, session_id: str) -> None
    def list(self) -> list[str]
```

### WS Bridge

注册为 FastAPI WebSocket 路由：

```python
@app.websocket("/ws/airui")
async def airui_ws(websocket: WebSocket, session: str = "default"):
```

### 通信协议

与现有 AIRUI TypeScript 版本保持一致：

```
# Server → Browser
{type: "document", data: AirUIDocument, title?: string}
{type: "patch", data: [Patch, ...]}
{type: "session", sessionId: string}

# Browser → Server
{type: "interaction", widgetRef: string, interaction: string, payload: object}
```

### 自动刷新

```python
async def auto_refresh_loop():
    """后台任务：定时刷新看板。"""
    while True:
        await asyncio.sleep(45)
        for session_id in session_manager.list():
            session = session_manager.get(session_id)
            if session and session.ws_clients:
                data = data_service.dashboard()
                doc = render_dashboard(data)
                await session.push_doc(doc)
```

在 FastAPI `startup` 事件中启动。

---

## 4. Agent 集成

### 新增 LLM 工具

| 工具 | 用途 | 注册到 TOOL_DEFINITIONS |
|---|---|---|
| `render_airui_panel` | 渲染新面板（如板块 drilldown 详情） | 是 |
| `patch_airui_panel` | 更新已有面板内容 | 是 |

#### render_airui_panel

```json
{
  "name": "render_airui_panel",
  "description": "在看板上渲染一个新面板（Widget），用于展示板块/个股的深入分析结果",
  "parameters": {
    "type": "object",
    "properties": {
      "ref": {"type": "string", "description": "面板引用 ID，如 'drilldown-plate-半导体'"},
      "title": {"type": "string", "description": "面板标题"},
      "col_span": {"type": "integer", "description": "列宽 1-12，默认 12"},
      "row_span": {"type": "integer", "description": "行高，默认 1"},
      "content": {"type": "object", "description": "AIRUI 组件树"}
    },
    "required": ["ref", "title", "content"]
  }
}
```

#### patch_airui_panel

```json
{
  "name": "patch_airui_panel",
  "description": "更新看板上已有面板的内容",
  "parameters": {
    "type": "object",
    "properties": {
      "ref": {"type": "string", "description": "面板引用 ID"},
      "patches": {"type": "array", "description": "JSON Patch 操作列表"}
    },
    "required": ["ref", "patches"]
  }
}
```

### Drilldown 交互流程

```
用户点击板块行"半导体"
  → WS: {type: "interaction", widgetRef: "table-plates",
          interaction: "drilldown", payload: {plate: "半导体", code: "881270", ...}}
  → ws_bridge 收到 → session.enqueue_event()
  → drilldown handler:
     1. 构造上下文：提取 payload 中的板块/个股信息
     2. 预拉数据：get_board_members("881270") + get_news_flash("半导体")
     3. 构造 Agent 消息：[{role: "user", content: "用户在看板点击了：半导体板块，请分析并渲染详情面板"}]
     4. 调用 Agent.chat(messages)
     5. Agent 内部调用 render_airui_panel → 工具执行时直接 push_doc 到 session
     6. 看板自动更新
```

### system_prompt 扩展

在现有 `SYSTEM_PROMPT` 末尾追加：

```
## 看板能力
你可以在看板上渲染面板来展示分析结果：
- `render_airui_panel` — 渲染新面板（ref/title/col_span/content）
- `patch_airui_panel` — 更新面板内容（ref/patches）

当用户通过看板点击（drilldown）或对话涉及具体板块/个股时，优先渲染可视化面板展示结论。
```

### 对话面板

前端 ChatPanel 调用现有 `/api/chat` SSE 流式接口，Agent 回复中可触发 render_airui_panel 更新看板。对话和看板共享同一 session。

---

## 5. 前端改造

### 目录结构

```
frontend/
├── package.json             # 引用 @air-ui/renderer-react
├── vite.config.ts
├── src/
│   ├── main.tsx
│   ├── App.tsx              # 主布局：左侧 ChatPanel + 右侧看板
│   ├── ChatPanel.tsx        # 侧边对话栏（可折叠）
│   ├── store.ts             # Zustand store（doc / connected / sessionId / messages）
│   ├── ws-client.ts         # WS 客户端（连 Python /ws/airui）
│   └── components/          # 复用 @air-ui/renderer-react 组件
```

### App.tsx 布局

```
┌──────────────────────────────────────────────┐
│  AIRUI Sentiment Dashboard                    │
├────────────┬─────────────────────────────────┤
│            │                                  │
│ ChatPanel  │  DashboardView                   │
│ (可折叠)    │  （AIRUI 递归渲染器）              │
│            │                                  │
│ 对话输入框  │                                  │
│ 历史消息    │  KPI / Gauge / Chart / Table ... │
│            │                                  │
│ 宽度 320px │                                  │
│            │                                  │
├────────────┴─────────────────────────────────┤
│  StatusBar（连接状态 + 数据时间）               │
└──────────────────────────────────────────────┘
```

### 依赖

```json
{
  "dependencies": {
    "@air-ui/renderer-react": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zustand": "^5.0.0"
  }
}
```

### ws-client.ts

与现有 AIRUI 协议一致，WS URL 改为 FastAPI 的 `/ws/airui`：

```typescript
const ws = new WebSocket(`ws://${host}/ws/airui?session=${sessionId}`)
// 收到 document → 更新 store.doc
// 收到 patch → 应用 patch 到 store.doc
// 用户点击 → 发送 interaction 事件
```

---

## 6. 构建部署

### FastAPI 入口改动

```python
# main.py 新增
from fastapi.staticfiles import StaticFiles
from .airui.ws_bridge import register_ws_routes
from .airui.session import session_manager
from .airui.renderer import render_dashboard

# 挂载 AIRUI SPA 静态文件
app.mount("/dashboard", StaticFiles(directory="static/airui", html=True))

# 注册 WS 路由
register_ws_routes(app)

# 启动自动刷新
@app.on_event("startup")
async def start_auto_refresh():
    asyncio.create_task(auto_refresh_loop())
```

### 构建流程

```bash
# 1. 构建前端
cd frontend && npm run build
# 产物复制到 backend/static/airui/

# 2. 启动后端（一个进程搞定）
cd backend && uvicorn app.main:app --port 8000
# 同时提供：
#   /dashboard/*   → AIRUI SPA 静态文件
#   /ws/airui      → WebSocket
#   /api/*         → REST API
```

不再需要 Bun，不再需要单独的前端服务。

### 删除内容

- `frontend/` 原 Vue 项目
- Bun 相关依赖
- docker-compose.yml 中单独的前端服务（简化为单后端服务）

---

## 7. 实施计划

| 步骤 | 内容 | 依赖 | 预估复杂度 |
|---|---|---|---|
| 1 | Python 重写 `airui/session.py` + `airui/ws_bridge.py` | 无 | 低 |
| 2 | Python 实现 `airui/renderer.py`（模板引擎） | 步骤 1 | 中 |
| 3 | FastAPI `main.py` 挂载 WS + 静态文件 + auto_refresh | 步骤 1-2 | 低 |
| 4 | 前端 React SPA 替换 Vue，接入 WS | 步骤 3 | 中 |
| 5 | 实现 `ChatPanel` + 对话接入 | 步骤 4 | 中 |
| 6 | Agent 集成 drilldown handler + render/patch 工具 | 步骤 3 | 中 |
| 7 | 联调测试 | 全部 | 中 |
