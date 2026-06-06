# AIRUI 前端优化测试报告

## 测试时间

2026-06-07 02:12 CST

## 测试环境

- 分支状态：AIRUI 提交上的 detached HEAD
- 服务地址：http://127.0.0.1:8000
- 后端运行命令：`.venv-run/bin/uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000`
- LLM Base URL：`http://192.168.31.57:11232/v1`
- LLM Model：`Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf`

## 实现范围

- 新增 5 份执行方案文档：布局视觉、点击意图、对话同步、设置配置、执行测试。
- 重做 `backend/static/airui/index.html` 为可直接运行的工作台页面。
- 左侧对话栏固定占据视口高度，消息独立滚动。
- 右侧看板独立滚动，默认进入情绪仪表盘。
- 补齐原 Vue 前端核心模块入口：
  - 情绪仪表盘
  - 明日策略
  - 情绪周期三线
  - 板块强度 TOP8
  - 板块情绪热力
  - 核心指数
  - 赚钱手法
  - 风险 Checklist
  - 机会 Watchlist
  - 明日观察池
- 加入点击意图循环：
  - KPI、趋势、板块、风险、机会、观察池、指数、赚钱手法可点击。
  - 点击后右侧出现焦点面板和追问按钮。
  - 板块/观察池点击会通过 WebSocket 保留 AIRUI drilldown 交互。
- 对话返回后：
  - 左侧支持 Markdown 基础渲染。
  - 右侧自动切换 AI 研判，作为主表达展示。
- 新增设置模块：
  - 主题：自动、浅色、深色、石墨。
  - LLM 配置读写。
  - Skill 启用选择。
  - MCP servers JSON 配置登记。
- 新增后端 `/api/config` GET/PUT 接口。
- 配置保存后重建 Agent 单例，使后续对话使用新配置。

## 接口测试

| 项目 | 结果 |
|---|---|
| `GET /health` | 通过，返回 `sentiment-backend ok` |
| `GET /api/config` | 通过，返回当前 LLM/Skill/MCP 配置 |
| `GET /api/skills` | 通过，返回 6 个本地 skill |
| `GET /dashboard/` | 通过，返回新版工作台 HTML |

## 浏览器验证

| 项目 | 结果 |
|---|---|
| 页面标题 | `市场情绪工作台` |
| 左侧对话栏高度 | 960px，固定为视口高度 |
| body 滚动 | `overflow: hidden` |
| 右侧内容滚动 | `.content overflow: auto` |
| 默认视图 | 情绪仪表盘 |
| 首屏卡片数量 | 15 |
| 首屏点击意图数量 | 23 |
| 策略页卡片数量 | 18 |
| 策略页点击意图数量 | 39 |
| 设置页 LLM Base URL | `http://192.168.31.57:11232/v1` |
| 设置页 Skills | 6 个 |
| 设置页主题选项 | 4 个 |

## 对话验证

测试问题：

```text
用三点概括今日情绪，并给出稳健仓位
```

结果：

- 后端 `/api/chat` 返回 200。
- LLM 实际调用成功。
- 左侧对话追加 Markdown 内容。
- 右侧自动切到 AI 研判视图。
- 右侧展示本次问题、返回时间、正文 Markdown。
- 本次模型还调用了 `render_airui_panel`，后端日志显示工具调用成功。

## 自动化测试

命令：

```bash
cd backend && ../.venv-run/bin/python -m pytest tests -v
```

结果：

```text
31 passed, 2 warnings in 0.92s
```

警告：

- Starlette `TestClient` / `httpx` deprecation warning。
- `asyncio.get_event_loop()` deprecation warning。

## 遗留约束

- 当前正式 React/AIRUI 构建链仍受 AIRUI submodule 缺失影响，本次继续使用静态 HTML 工作台保证可运行体验。
- MCP 已支持配置登记和保存，但尚未接入 Agent 工具调度运行时。
- LLM 返回耗时较长，本次对话约 1 分钟完成；前端已保留分析中状态。
