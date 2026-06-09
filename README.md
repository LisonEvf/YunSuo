# General Agent Console

FastAPI + React + AIRUI 的通用 agent 客户端。项目现在采用 monorepo 结构，目标是提供一个可扩展的 agent 操作台：聊天、流式运行事件、技能选择、记忆、轨迹记录、AIRUI 产物渲染与运行检查面板。

## 当前能力

- 后端提供通用 agent 接口：`/api/chat`、`/api/config`、`/api/skills`、`/api/memory`、`/api/trajectories/summary`。
- 前端是 React + Vite + Zustand 控制台，首屏采用 Operations Console v1：左侧聊天，中间运行时间线与 AIRUI artifacts，右侧 Inspector。
- AIRUI WebSocket 保留为通用产物面：`/ws/airui?session=default`。
- 记忆、技能、轨迹、后台复盘保留，并已从股票市场语义改为通用协作语义。
- `external/openkpl/` 与 `external/opentdx/` 作为历史/外部 SDK 子模块保留，当前主运行路径不再导入它们。

## Monorepo 结构

- `apps/api/`：FastAPI 后端、agent loop、skills 加载、memory、trajectory、AIRUI renderer/session/ws bridge。
- `apps/console/`：React + AIRUI renderer 控制台源码。
- `apps/api/static/airui/`：随后端提供的控制台静态构建产物。
- `packages/airui/`：AIRUI 子模块，包含 `packages/core` 与 `packages/renderer-react`。
- `packages/agent-skills/`：通用 agent skills，例如 task planning、debugging、code review、artifact design、writing、research synthesis。
- `external/`：历史/外部 SDK 子模块。
- `archive/`：旧 Vue 前端和历史 HTML 模板。
- `data/`：SQLite 记忆数据与运行轨迹。
- `docs/`：设计记录、执行计划、评估报告。

## 本地开发

项目代码使用 Python 3.10+ 语法，建议使用 Python 3.12。前端建议使用 Bun。

安装依赖：

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r apps/api/requirements.txt pytest
bun install
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

Docker：

```bash
docker compose up --build
```

## Agent / LLM 配置

运行时代码默认读取环境变量与 `apps/api/config/agent.json`：

- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_MODEL`
- `LLM_MAX_TOKENS`
- `CONTEXT_WINDOW_TOKENS`

也可以通过 `/api/config` 读取或更新 agent 配置；更新后后端会重置单例 agent，使下一次请求使用最新配置。

## 测试

后端：

```bash
bun run test:api
```

前端：

```bash
bun run build:console
```

## 注意事项

- `packages/airui/` 是子模块；首次 checkout 后需要确保子模块已初始化。
- 默认 AIRUI session 是 `default`；新建非 `default` session 只会收到 session id。
- 股票市场 REST API 与运行时工具已从主应用路径拆除；历史 SDK 保留在 `external/`，历史界面保留在 `archive/`。
