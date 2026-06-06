# 市场情绪策略看板

FastAPI + React + AIRUI 的市场情绪策略看板。后端聚合本地 `openkpl`
与 `opentdx` 数据能力，提供 REST API、Agent 对话接口、AIRUI
WebSocket 看板推送和静态前端服务。

## 当前状态

- 后端 AIRUI 核心链路可运行：`/api/dashboard` 能生成看板数据，
  `/ws/airui?session=default` 能推送 `air-ui@1` 文档。
- 后端 AIRUI 自动化测试当前为 `31 passed`。
- `frontend/` 已替换为 React 19 + Vite + Zustand + AIRUI renderer，不再是 Vue 项目。
- `frontend-vue-backup/` 保留旧 Vue 实现，仅作备份。
- `AIRUI/` 子模块当前配置为本地 Windows 路径形式，跨平台 checkout 会失败；
  在修复子模块 URL 前，前端源码安装/构建会被阻塞。
- 已提交的 `backend/static/airui/index.html` 引用 `/assets/...`，但后端挂载在
  `/dashboard` 下，直接访问 `/dashboard/` 会因静态资源 404 出现空白页。

## 项目结构

- `backend/`：FastAPI 后端、数据聚合、Agent、AIRUI renderer/session/ws bridge。
- `frontend/`：React + AIRUI SPA 源码。
- `backend/static/airui/`：当前随后端提供的前端静态产物。
- `AIRUI/`：AIRUI workspace 子模块，预期包含 `packages/core` 和
  `packages/renderer-react`。
- `openkpl/`：本地开盘啦数据 SDK 子模块。
- `opentdx/`：本地通达信行情 SDK 子模块。
- `skills/`：Agent 可加载的交易分析 skills。
- `data/`：SQLite 缓存和记忆数据。

## 本地后端开发

项目代码使用 Python 3.10+ 语法，建议使用 Python 3.12：

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt pytest
uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

启动后可访问：

- 后端健康检查：http://127.0.0.1:8000/health
- 聚合数据接口：http://127.0.0.1:8000/api/dashboard
- AIRUI 静态页：http://127.0.0.1:8000/dashboard/
- AIRUI WebSocket：`ws://127.0.0.1:8000/ws/airui?session=default`

## Agent / LLM 配置

运行时代码默认读取环境变量：

- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_MODEL`
- `LLM_MAX_TOKENS`
- `CONTEXT_WINDOW_TOKENS`

当前代码默认值已对齐本地 OpenAI-compatible 服务：

- base URL：`http://192.168.31.57:11232/v1`
- model：`Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf`
- context window：`65536`

`backend/config/agent.json` 是配置样稿/外部配置文件；当前代码不会自动读取它。

## 测试

后端 AIRUI 测试：

```bash
cd backend
python -m pytest tests -v
```

前端构建目前需要先修复 `AIRUI/` 子模块。修复后预期流程：

```bash
bun install
cd frontend
bun run build
```

## 已知问题

- `.gitmodules` 中 `AIRUI` URL 为 `.\\AIRUI\\`，在 macOS/Linux 上无法初始化。
- `backend/Dockerfile` 使用 `npm ci || true`，但 `frontend/` 没有
  `package-lock.json`，Docker 前端阶段会缺少 `tsc/vite` 并构建失败。
- `frontend/vite.config.ts` 未设置 `base: "/dashboard/"`，导致后端静态页加载
  `/assets/...` 失败。
- 新建非 `default` AIRUI session 只会收到 session id，不会自动收到初始 dashboard 文档。
