# 市场情绪策略看板

Vue 3 + FastAPI 项目，使用 `template` 中的 HTML 视觉模板，组合本地 `openkpl` 与 `opentdx` 数据能力，支持 Docker Compose 一键部署。

## 项目结构

- `frontend/`：Vue 3 + TypeScript + Vite 前端，看板页面与 API 调用层。
- `backend/`：FastAPI 后端，封装 openkpl 情绪/历史复盘与 opentdx 行情接口。
- `openkpl/`：本地 openkpl 数据 SDK 源码。
- `opentdx/`：本地 opentdx 行情 SDK 源码。
- `docker-compose.yml`：一键启动前后端。

## 一键部署

```bash
docker compose up --build
```

启动后访问：

- 前端看板：http://localhost:8080
- 后端健康检查：http://localhost:8000/health
- 聚合数据接口：http://localhost:8000/api/dashboard

## 本地开发

后端：

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
PYTHONPATH=..:../opentdx uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

前端：

```bash
cd frontend
npm install
npm run dev
```

Vite 开发服务会把 `/api` 和 `/health` 代理到 `localhost:8000`。

## API

- `GET /api/dashboard`：聚合情绪、指数、板块、风险与观察池。
- `GET /api/quotes?symbols=SZ:000001,SH:600000`：批量报价。
- `GET /api/kline/{market}/{code}?period=DAILY&count=80`：K 线。
- `GET /api/boards`：板块列表。
- `GET /api/boards/{board}/members`：板块成分行情。

数据源可能受外部行情服务状态影响。聚合接口会尽量返回可用部分，并在 `meta.warnings` 中标记失败的数据源。
