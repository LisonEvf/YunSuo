# 云梭 Yunsuo

> 织 agent 运行为可交互的界面 —— FastAPI + React + AIRUI 的通用 agent 操作台。

采用 monorepo 结构，提供聊天、流式运行事件、技能注入、会话记忆、轨迹记录、AIRUI 产物渲染与运行检查面板。

## 当前能力

- 通用 agent 接口：`/api/chat`（支持 SSE 流式）、`/api/config`、`/api/skills`、`/api/memory`、`/api/usage`、`/api/trajectories/summary`。
- MCP 工具集成：`/api/mcp/status`、`/api/mcp/reconnect`，支持 stdio / HTTP / SSE 三种 transport，发现的工具以 `mcp_<server>_<tool>` 注入 agent 工具表。
- 插件市场（发现层）：`/api/plugins`、`/api/plugins/marketplace`、`/api/plugins/install`，支持 git clone 安装/卸载。
- LLM provider 预设与多实例切换：内置常用预设，可保存多个 provider 实例一键激活（仅 OpenAI 兼容协议）。
- 前端是 React 19 + Vite + Zustand 控制台：左侧聊天，主区 AIRUI 文档渲染（运行时间线、artifacts、skills/memory/trajectory inspector），底部状态栏。
- AIRUI WebSocket 通用产物面：`/ws/airui?session=default`，agent 调 `render_airui_panel` 推送持久产物，SSE 内联事件推送一次性产物。
- 会话记忆（SQLite + 关键词召回）、技能路由（关键词打分）、轨迹记录（JSONL）、后台复盘候选记录。
- `external/openkpl/` 与 `external/opentdx/` 作为历史/外部 SDK 子模块保留，当前主运行路径不再导入它们。

## Monorepo 结构

- `apps/api/`：FastAPI 后端、agent loop、skills 加载、memory、trajectory、AIRUI renderer/session/ws bridge。
- `apps/console/`：React + AIRUI renderer 控制台源码。
- `apps/api/static/airui/`：随后端提供的控制台静态构建产物。
- `packages/airui/`：AIRUI 子模块，包含 `packages/core` 与 `packages/renderer-react`。
- `packages/agent-skills/`：通用 agent skills，例如 task planning、debugging、code review、artifact design、writing、research synthesis。
- `external/`：历史/外部 SDK 子模块。
- `data/`：SQLite 记忆数据与运行轨迹。
- `docs/`：设计记录与参考文档。

## 本地开发

项目代码使用 Python 3.10+ 语法，建议使用 Python 3.12。前端建议使用 Bun。

安装依赖：

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r apps/api/requirements.txt pytest
cd apps/console && bun install
```

同时启动后端和前端：

```bash
bun run dev
```

单独启动后端：

```bash
python -m uvicorn app.main:app --app-dir apps/api --host 127.0.0.1 --port 8000
```

单独启动前端：

```bash
cd apps/console
bun run dev
```

启动后可访问：
- 后端健康检查：http://127.0.0.1:8000/health
- Agent 对话接口：http://127.0.0.1:8000/api/chat
- 控制台静态页：http://127.0.0.1:8000/console/
- AIRUI WebSocket：`ws://127.0.0.1:8000/ws/airui?session=default`

## 构建

构建控制台并输出到 `apps/api/static/airui/`：

```bash
bun run build:console
```

## Agent / LLM 配置

运行时代码默认读取环境变量与 `apps/api/config/agent.json`：

- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_MODEL`
- `LLM_MAX_TOKENS`
- `CONTEXT_WINDOW_TOKENS`

也可以通过 `/api/config` 读取或更新 agent 配置；更新后后端会重置单例 agent，使下一次请求使用最新配置。环境变量优先级最高，会覆盖文件配置。

## 测试

后端（[apps/api/tests](apps/api/tests)，当前覆盖核心 agent loop / MCP / skills / memory 等关键路径中的部分纯函数与归一化逻辑，agent.py 主循环尚未覆盖）：

```bash
bun run test:api
```

前端无单测；类型检查 + 构建一体（dev 模式 vite 不做类型检查，改完需手动跑）：

```bash
cd apps/console && bun run build
```

生产部署时，前端构建产物 `apps/api/static/airui/` 已加入 `.gitignore`，部署前需运行 `bun run build:console` 生成。

## 文档

- [docs/general-agent-console-design.md](docs/general-agent-console-design.md) — 重构历史记录（sentiment 看板 → 通用 agent console）
- [docs/2026-06-09-airui-usage.md](docs/2026-06-09-airui-usage.md) — AIRUI 中间表示、组件清单、事件与增量更新、React 渲染 API、console 集成
- [docs/2026-06-09-theme-system.md](docs/2026-06-09-theme-system.md) — 主题架构、内置主题、自定义风格重载
- [docs/hermes-agent-self-evolution.md](docs/hermes-agent-self-evolution.md) — 外部参考（agent 自演进，后端多处设计借鉴来源）
- [PROJECT_REPORT.md](PROJECT_REPORT.md) — 完整项目分析报告（架构、数据流、模块职责、改进建议）

## 注意事项

- `packages/airui/` 是子模块；首次 checkout 后需要确保子模块已初始化。
- 默认 AIRUI session 是 `default`；新建非 `default` session 只会收到 session id。
- 股票市场 REST API 与运行时工具已从主应用路径拆除；历史 SDK 保留在 `external/`。
- `apps/api/config/agent.json` 是运行时实际读取的配置；项目根 `config/agent.json` 已删除（旧残留）。
- SQLite 数据库（`data/*.db`）与前端构建产物（`apps/api/static/airui/`）已加入 `.gitignore`，不入 git。
- 生产部署需通过环境变量 `ALLOWED_ORIGINS`（逗号分隔）收紧 CORS 白名单；未设置时仅允许本地 5173/8000。