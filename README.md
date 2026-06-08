# General Agent Console

FastAPI + React + AIRUI 的通用 agent 客户端。项目当前目标是提供一个可扩展的 agent 操作台：聊天、流式运行事件、技能选择、记忆、轨迹记录、AIRUI 产物渲染与运行检查面板。

## 当前能力

- 后端提供通用 agent API：`/api/chat`、`/api/config`、`/api/skills`、`/api/memory`、`/api/trajectories/summary`。
- 前端是 React + Vite + Zustand 控制台，首屏采用 Operations Console v1：左侧聊天，中间运行时间线与 AIRUI artifacts，右侧 Inspector。
- AIRUI WebSocket 仍保留为通用产物面：`/ws/airui?session=default`。
- 记忆、技能、轨迹、后台复盘保留，但已从股票市场语义改为通用协作语义。
- `openkpl/` 与 `opentdx/` 目录暂时保留在仓库中作为历史/外部 SDK 目录，当前主运行路径不再导入它们。

## 项目结构

- `backend/`：FastAPI 后端、agent loop、skills、memory、trajectory、AIRUI renderer/session/ws bridge。
- `frontend/`：React + AIRUI renderer 控制台源码。
- `backend/static/airui/`：随后端提供的前端静态产物。
- `AIRUI/`：AIRUI workspace 子模块，预期包含 `packages/core` 与 `packages/renderer-react`。
- `skills/`：通用 agent skills，例如 task planning、debugging、code review、artifact design、writing、research synthesis。
- `data/`：SQLite 记忆数据。
- `docs/general-agent-console-design.md`：本轮通用化设计记录。

## 本地后端开发

项目代码使用 Python 3.10+ 语法，建议使用 Python 3.12。

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r backend/requirements.txt pytest
uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

启动后可访问：

- 后端健康检查：http://127.0.0.1:8000/health
- Agent 对话接口：http://127.0.0.1:8000/api/chat
- 控制台静态页：http://127.0.0.1:8000/console/
- AIRUI WebSocket：`ws://127.0.0.1:8000/ws/airui?session=default`

## 前端开发

```bash
cd frontend
bun install
bun run dev
```

构建：

```bash
cd frontend
bun run build
```

如果本地没有 Bun，也可以使用 npm/pnpm，但当前包依赖包含 AIRUI workspace 依赖，需要保证 `AIRUI/` 子模块可用。

## Agent / LLM 配置

运行时代码默认读取环境变量与 `backend/config/agent.json`：

- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_MODEL`
- `LLM_MAX_TOKENS`
- `CONTEXT_WINDOW_TOKENS`

也可以通过 `/api/config` 读取或更新 agent 配置；更新后后端会重置单例 agent，使下一次请求使用最新配置。

## 测试

后端：

```bash
cd backend
python -m pytest tests -q
```

前端：

```bash
cd frontend
bun run build
```

## 已知注意事项

- `AIRUI/` 子模块当前可能仍受本地路径配置影响；前端安装/构建依赖它时，需要先确保 workspace 依赖可解析。
- 新建非 `default` AIRUI session 只会收到 session id；默认初始 console 文档由应用启动时写入 `default` session。
- 股票市场 REST API 与运行时工具已从主应用路径拆除；历史 SDK 目录尚未物理删除。
