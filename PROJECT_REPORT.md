# 云梭 Yunsuo — 项目分析报告

> 分析时间：2026-06-10 ｜ 分支：`general` ｜ 仓库：`yunsuo`（旧代号 `sentiment`）

## 1. 项目定位

项目代号 **云梭（Yunsuo）**——仓库最初是 A 股市场情绪看板（旧代号 `sentiment`），已重构为基于生成式 UI 的通用 AI Agent。

**顶层定位**：让用户**仅通过点击**就能完成与 LLM 的交互。每一屏 AIRUI 文档都是 agent 对"用户下一步可能想做什么"的预判，点击即推进下一轮，形成闭环；预判不准时弹窗修正，修正沉淀成预判记忆让下一屏更准。目标是降低门槛，让外行用户不写 prompt，靠"点点点 + 偶尔改一句"把 agent 变成专属面板/流程，配合 skill 与 MCP 做到普通人也能客制化专属 SaaS。完整设计见 [docs/generative-ui-agent-design.md](docs/generative-ui-agent-design.md)。

**当前实现形态**（该定位的底座，交互范式仍偏消息驱动）：FastAPI + React + AIRUI 的 monorepo，提供聊天、流式运行事件、技能注入、会话记忆、轨迹记录、AIRUI 产物渲染与运行检查面板。从"消息驱动"演进到"点击驱动"是项目下一步方向；现状 gap 集中在四块——意图 payload 建模、预判标签 + 修正弹窗、预判记忆、面板/流程一等公民（详见设计文档 §8）。

历史股票语义已从主运行路径拆除：REST/工具/技能全部通用化，旧 SDK 保留在 [external/](external/)，旧界面已删除（README 仍提及 [archive/](archive/)，实际目录不存在，见 §11）。

## 2. 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Python 3.10+（建议 3.12）、FastAPI、Uvicorn、OpenAI SDK（兼容任意 OpenAI API 的 provider，默认 `llamacpp/qwen3-coder`）、httpx、jsonpatch、mcp SDK、SQLite（WAL） |
| 前端 | React 19、Vite 6、TypeScript 5.7、Zustand 5、ECharts 5 |
| AIRUI | 独立子模块 `@air-ui/core` + `@air-ui/renderer-react`（独立仓库 [LisonEvf/AIRUI](https://github.com/LisonEvf/AIRUI)） |
| 构建/编排 | Bun workspaces、concurrently |
| 容器 | docker compose（声明了 `apps/api/Dockerfile`，实际文件不存在，见 §11） |

**代码规模**：后端 21 个 Python 模块约 3706 行，前端 15 个 TS/TSX 文件约 3093 行，AIRUI renderer 17 个组件文件。

## 3. Monorepo 结构

```
yunsuo/
├── apps/
│   ├── api/                      FastAPI 后端
│   │   ├── app/
│   │   │   ├── main.py           路由层（chat/config/skills/memory/mcp/plugins/usage/trajectories）
│   │   │   ├── agent/            核心 agent loop 与各子系统
│   │   │   ├── airui/            AIRUI 集成（renderer/session/ws_bridge/patch）
│   │   │   └── utils.py          to_jsonable 等通用工具
│   │   ├── config/agent.json     ★ 运行时实际读取的配置
│   │   ├── tests/                pytest
│   │   └── static/airui/         前端构建产物（被 /console 挂载）
│   └── console/                  React + AIRUI 控制台源码
│       └── src/                  store/ws-client/chat/components/i18n/themes/...
├── packages/
│   ├── airui/                    AIRUI 子模块（core + renderer-react + playground）
│   └── agent-skills/             通用 agent skills（SKILL.md 集合）
├── external/                     历史 SDK 子模块（openkpl/opentdx，主路径不导入）
├── data/                         SQLite 记忆库 + JSONL 轨迹 + skill 使用统计
├── docs/                         设计记录、执行计划、评估报告
├── config/agent.json             ✗ 过时残留（见 §11）
├── docker-compose.yml
└── package.json                  Bun workspaces 根
```

## 4. 后端架构（apps/api）

### 4.1 路由层 — [apps/api/app/main.py](apps/api/app/main.py)

| 端点 | 方法 | 职责 |
|---|---|---|
| `/health` | GET | 健康 + 能力清单 |
| `/api/chat` | POST | agent 对话，支持 SSE 流式（`stream:true`） |
| `/api/config` | GET/PUT | 读取/更新 agent 配置；PUT 后 `reset_agent()` 使新配置立即生效 |
| `/api/mcp/status` `/api/mcp/reconnect` | GET/POST | MCP 能力感知 / 强制重连 |
| `/api/plugins` `/api/plugins/marketplace` `/api/plugins/install` `/api/plugins/{name}` | GET/POST/DELETE | 插件发现 + 市场 + git clone 安装/卸载 |
| `/api/skills` `/api/skills/curation` | GET | 技能列表 / curator 建议（dry_run） |
| `/api/memory` `/api/memory/stats` `/api/memory/{id}` | GET/DELETE | 记忆检索/统计/删除 |
| `/api/usage` | GET | 当前 agent 的 token 用量 |
| `/api/trajectories/summary` | GET | 轨迹汇总 |
| `/ws/airui?session=default` | WS | AIRUI 双向通道 |
| `/console/` | Static | 前端构建产物（若 static 目录存在） |

启动钩子 [`_airui_console_init`](apps/api/app/main.py#L230) 为 `default` session 注入初始 console 文档。

### 4.2 Agent 核心 — [apps/api/app/agent/agent.py](apps/api/app/agent/agent.py)

`GeneralAgent` 实现 conversation loop：

```
user message → [注入 memory + skills] → LLM → tool_calls → guardrail → 并行执行 → LLM → ... → final response
```

关键设计：
- **双模式**：[chat()](apps/api/app/agent/agent.py#L169)（非流式，返回完整 dict）与 [chat_stream()](apps/api/app/agent/agent.py#L330)（SSE yield 事件：`skills`/`delta`/`tool_start`/`tool_result`/`airui`/`done`）
- **消息构建** [`_build_messages_with_selection`](apps/api/app/agent/agent.py#L70)：system prompt + 记忆上下文块 + 选中的 skill 指令注入
- **工具执行**：`asyncio.gather` 并行执行，工具结果经 `_truncate_tool_result`（默认 6000 字符，JSON 列表优先按条目截断保持结构）
- **内联 AIRUI**：`render_airui_panel` 成功时额外 yield `airui` 事件，让产物同时进入聊天流和 WS 通道（[agent.py:499](apps/api/app/agent/agent.py#L499)）
- **单例**：[`get_agent()`](apps/api/app/agent/agent.py#L620) 双重检查锁，LLM_API_KEY 缺失抛 ValueError → HTTP 503；[`reset_agent()`](apps/api/app/agent/agent.py#L647) 清理 MCP 长连接 + skill 扫描缓存
- **工具装载** [`_load_tools`](apps/api/app/agent/agent.py#L632)：内置工具 + MCP 工具合并，MCP 加载失败不阻断启动

### 4.3 Agent 子系统一览

| 模块 | 行数 | 职责 |
|---|---|---|
| [config.py](apps/api/app/agent/config.py) | 187 | 配置加载（DEFAULT → 文件 → env，env 优先级最高）；**provider 双向同步**：`providers[]` + `active_provider_id` 与 `model` 字段互写，运行时只读 `model`，agent.py 零改动 |
| [context.py](apps/api/app/agent/context.py) | 140 | token 估算 + 自动压缩：75% 阈值触发，head（system）+ tail（最近 4 轮）保护，中间用 LLM 摘要，失败降级为 assistant 片段拼接 |
| [retry.py](apps/api/app/agent/retry.py) | 62 | 错误分类（rate_limit/overloaded/server_error/timeout/auth/context_overflow/unknown 共 7 类，auth 不可重试）+ 抖动指数退避 |
| [guardrails.py](apps/api/app/agent/guardrails.py) | 66 | 工具防护：每工具 5 次/轮上限；非幂等工具相同参数 2 次上限；幂等工具白名单（3 个内置工具） |
| [skills.py](apps/api/app/agent/skills.py) | 415 | SKILL.md 扫描（60s TTL 缓存）+ 关键词打分路由（slug/name/关键词提示/词匹配加权）+ 使用统计持久化 + curator（stale/duplicate 检测） |
| [memory.py](apps/api/app/agent/memory.py) | 177 | SQLite + 关键词 LIKE 召回；`extract_and_save` 用正则从用户消息提取偏好陈述（不过度提取） |
| [mcp_client.py](apps/api/app/agent/mcp_client.py) | 343 | MCP 客户端（stdio/http/sse 三 transport）；**后台 daemon 线程承载 event loop**，`run_coroutine_threadsafe` 同步等待，工具以 `mcp_<server>_<tool>` 命名注入 `tools._HANDLERS` |
| [plugins.py](apps/api/app/agent/plugins.py) | 149 | marketplace 源清单拉取（urllib，单源失败不阻断）+ `git clone --depth 1` 安装；插件名正则白名单防路径遍历；**仅发现层，执行系统未实现** |
| [tools.py](apps/api/app/agent/tools.py) | 393 | 3 个内置工具（`get_agent_runtime_status`/`render_airui_panel`/`patch_airui_panel`）+ AIRUI 组件归一化（60+ 别名 → 76 种内置类型规范化） |
| [trajectory.py](apps/api/app/agent/trajectory.py) | 236 | JSONL ShareGPT 格式轨迹记录，成功/失败分文件；`summarize_trajectories` 汇总工具调用与 skill 命中 |
| [review.py](apps/api/app/agent/review.py) | 133 | 后台复盘候选记录：基于信号词（"记住/以后/不要"等）识别 memory/skill 候选 + 质量标记（工具失败/空回复/未完成），写 `data/reviews/background_reviews.jsonl` |
| [system_prompt.py](apps/api/app/agent/system_prompt.py) | 46 | 通用 agent system prompt + AIRUI 产物指引（推荐 refs、组件示例、≤15 行表格约束） |

### 4.4 AIRUI 集成 — [apps/api/app/airui/](apps/api/app/airui/)

- [renderer.py](apps/api/app/airui/renderer.py)：[`render_console()`](apps/api/app/airui/renderer.py#L7) 构建初始文档——4 行布局：status KPI 行 / timeline 表格行 / artifacts 行（`ref=row-artifacts`，工具产物的挂载点）/ inspector 行（skills + memory/trajectory 表）
- [session.py](apps/api/app/airui/session.py)：`ConsoleSession`（doc + asyncio 事件队列 + ws_clients 列表）+ `SessionManager` 单例；`broadcast` 自动清理断连客户端
- [ws_bridge.py](apps/api/app/airui/ws_bridge.py)：`/ws/airui` 路由（连接时下发 session + 当前 document，接收 `interaction` 事件入队）；`push_document`/`push_patch` 向 session 广播
- [patch.py](apps/api/app/airui/patch.py)：`jsonpatch` 应用 + diff 计算（薄封装）

## 5. 前端架构（apps/console）

### 5.1 状态管理 — [apps/console/src/store.ts](apps/console/src/store.ts)

两个独立 Zustand store：
- **`useStore`（应用态）**：`appConfig`（完整 agent 配置，含 `providers[]`/`active_provider_id`/`marketplaces[]`）、`chatMessages`、`activeTools`、`activeSkills`、`runEvents`、`doc`（后端 AIRUI 影子文档）、`connected`/`sessionId`
- **`useAirUIStore`**（来自 `@air-ui/renderer-react`）：渲染主区 AIRUI 文档，独立于应用 store 避免与 patch 互触

`setAppConfig` 做深层 merge，保证局部更新不丢字段。

### 5.2 组件

| 文件 | 职责 |
|---|---|
| [App.tsx](apps/console/src/App.tsx) | 入口：WS 连接、主题应用（system 跟随媒体查询）、自定义主题 storage 同步；布局 = ChatPanel + ConsoleView + StatusBar |
| [components/ChatPanel.tsx](apps/console/src/components/ChatPanel.tsx) | 左侧 320px 聊天栏：消息气泡、工具状态胶囊、textarea（Enter 发送/Shift+Enter 换行） |
| [components/ConsoleView.tsx](apps/console/src/components/ConsoleView.tsx) | 主区核心：渲染 AIRUI 文档、处理交互回调（home/wiki/settings/save/home starter）、REST 轮询 inspector（15s）、合并 WS 影子面板 + 聊天内联 airui 进主画廊 |
| [components/StatusBar.tsx](apps/console/src/components/StatusBar.tsx) | 底部状态栏 |
| [components/ThemeSwitcher.tsx](apps/console/src/components/ThemeSwitcher.tsx) | 主题切换 |

### 5.3 关键逻辑文件

| 文件 | 职责 |
|---|---|
| [chat.ts](apps/console/src/chat.ts) | **流式聊天发送**：POST `/api/chat` stream，解析 SSE 事件驱动 store；产出 airui 写入最后一条 assistant 消息；`HOME_PROMPTS` 映射 starter 卡片 → prompt |
| [ws-client.ts](apps/console/src/ws-client.ts) | WS 连接（dev 走 127.0.0.1:8000，prod 走同源）+ 3s 自动重连 + `interaction` 发送 |
| [consoleLayout.ts](apps/console/src/consoleLayout.ts) | 初始 AIRUI 文档骨架（119 行） |
| [airui-custom.tsx](apps/console/src/airui-custom.tsx) | **1398 行**，最大文件：注册 console 专用组件（home/wiki/settings/gallery 等）、`normalizeAirUIComponent`、`ArtifactPanel` 类型 |
| [i18n.ts](apps/console/src/i18n.ts) | 中英双语（288 行），zh-CN 全面中文化，仅 API Key/Base URL/LLM/artifacts/agent 等术语保留英文 |
| [themes.ts](apps/console/src/themes.ts) | 6 主题（light/dark/graphite/neon/glass/system）+ 自定义主题（localStorage） |
| [providerPresets.ts](apps/console/src/providerPresets.ts) | LLM 提供商预设清单（157 行） |

## 6. AIRUI 子系统（packages/airui）

独立子模块，提供"声明式 UI as data"能力。

- **[@air-ui/core](packages/airui/packages/core/)**：类型定义（[`types.ts`](packages/airui/packages/core/src/types.ts) 定义 `Component`/`AirUIDocument`/`Patch`/`EventHandler` + 76 种 `BUILTIN_COMPONENTS`）、validator、state（`applyPatch`/`applyPatches`/`interpolate`/`resolveEventRefs`）
- **[@air-ui/renderer-react](packages/airui/packages/renderer-react/)**：React 渲染器，组件按类别分 17 个文件（layout/typography/form/data-table/data-display/data-workbench/domain-views/engine/feedback/overlay/navigation/media/structure/content/advanced-form/app-shell/chart）+ host/store/interaction/registry/resolve/hooks；**入口是 `dist` 非 `src`**（改源码必须在包内 `bun run build`），导出 `./theme.css`（light 基线）
- **Patch 系统**：RFC 6902 子集（replace/add/remove）+ 自定义 `update-state`（合并 stateDelta）
- **playground/**：独立 demo 应用

> 注意：AIRUI 是 submodule，改动需进入子模块提交；`packages/airui` 在 git status 显示为 modified 即 submodule 指针变化。

## 7. Agent Skills（packages/agent-skills）

6 个**已实现**的通用 skills（各 15-16 行 markdown，frontmatter + 指令正文）：

| slug | 定位 |
|---|---|
| `task-planning` | 目标 → 执行计划/里程碑/风险/验证步骤 |
| `debugging` | 复现/隔离/假设/插桩/修复/回归测试 |
| `code-review` | bug/回归/测试缺口/可维护性/安全审查 |
| `artifact-design` | 设计紧凑可视化产物（表格/时间线/看板） |
| `writing` | 起草/改写/总结/结构化文档 |
| `research-synthesis` | 选项对比/证据综合/决策归纳 |

**6 个空残留目录**（股票时代旧 skills，SKILL.md 已删但目录未清）：`market-analysis`/`plate-rotation`/`position-advice`/`risk-control`/`stock-research`/`trade-plan`。扫描器 `rglob("SKILL.md")` 自动忽略它们，但建议清理。

技能路由由 [skills.py:_score_skill](apps/api/app/agent/skills.py#L333) 完成：slug 命中 +10、name 命中 +8、关键词提示 +4、词匹配 +1.5，取 top-2（显式指定的总是保留）。

## 8. 数据流与通信

```
┌──────────┐  POST /api/chat (SSE)   ┌──────────┐  OpenAI API   ┌────────┐
│ ChatPanel │ ─────────────────────▶ │  agent   │ ◀──────────▶ │  LLM   │
│  chat.ts  │ ◀── delta/tool/airui ─ │  loop    │               └────────┘
└──────┬────┘                        └────┬─────┘
       │                                  │ render_airui_panel
       │                                  ▼
       │  WS /ws/airui             ┌──────────────┐
       │ ◀── document/patch ────── │ airui ws_     │
       │                           │ bridge/session│
       └──────────────────────────▶└──────────────┘
┌──────────────┐
│ ConsoleView  │  REST 轮询 15s: skills/memory/trajectories/config/mcp/plugins
└──────────────┘
```

**AIRUI 双通道**：
1. **WS 通道**（持久产物）：agent 调 `render_airui_panel` → 后端写入 `session.doc` 的 `row-artifacts` → WS `push_document` → 前端 `store.doc` → ConsoleView `collectArtifactPanels` 提取进主画廊
2. **聊天内联通道**（一次性产物）：SSE `airui` 事件 → 写入最后一条 assistant 消息的 `airui` 字段 → ConsoleView 合并进主画廊

## 9. 配置系统

**配置优先级**（[config.py:load_agent_config](apps/api/app/agent/config.py#L104)）：

```
DEFAULT_AGENT_CONFIG  ＜  apps/api/config/agent.json (文件)  ＜  环境变量 (最高)
```

**Provider 书签集合**（核心抽象）：
- `providers[]`：已配置的 provider 实例列表（书签），每项 `{id, name, provider, base_url, api_key, model_name, max_output_tokens}`
- `active_provider_id`：当前激活实例 id
- **双向同步**：加载时 `_sync_active_to_model`（实例 → model，运行时只读 model）；保存时 `_sync_model_to_active`（model → 实例，保持书签反映最新编辑）
- env 覆盖最后应用，优先级最高

环境变量：`LLM_API_KEY`/`LLM_BASE_URL`/`LLM_MODEL`/`LLM_MAX_TOKENS`/`CONTEXT_WINDOW_TOKENS`/`AGENT_MAX_ITERATIONS`/`RETRY_MAX_ATTEMPTS`。

## 10. 测试与构建

**测试**：
- 后端：`bun run test:api` → [pytest tests](apps/api/tests/test_agent_tools.py)，覆盖 AIRUI 内置类型集合 + 别名归一化（41 行）
- 前端：无单测，`bun run build:console`（`tsc -b && vite build`）即类型检查 + 构建
- AIRUI 子模块：各自有 vitest（core/renderer-react）

**构建产物**：`apps/console/dist/` → 部署到 `apps/api/static/airui/` 被 `/console` 挂载。

**开发启动**：`bun run dev`（concurrently 并起 uvicorn + vite）。dev 模式 vite 不做类型检查，改完需手动 `tsc -b`。

## 11. 发现的问题与改进建议

> 以下为分析中发现的实际偏差，按优先级排列。

### 11.1 文档/配置与实现不符

1. **[docker-compose.yml](docker-compose.yml) 引用的 `apps/api/Dockerfile` 不存在** — `docker compose up --build` 会直接失败。README 已移除 Docker 说明避免误导，但根因仍需补 Dockerfile 或移除 compose 配置。
2. ✅ **[README.md](README.md) 提及 `archive/` 旧 Vue 前端** — 已在本次文档更新中修正（删除 archive 提及、补充 MCP/plugins/provider 预设等已实现能力、新增文档索引与配置注意事项）。
3. **根 [config/agent.json](config/agent.json) 是过时残留** — 内容为旧格式（`model.provider: openai`, `api_key: sk-xxxxx` 占位），后端实际读 `apps/api/config/agent.json`（[config.py:CONFIG_PATH](apps/api/app/agent/config.py#L8)）。根 config 易误导，建议删除或加注释说明。
4. **6 个空 stock skill 目录** — 见 §7，建议 `rm -rf` 清理。

### 11.2 设计层面

5. **plugins 仅发现层** — [plugins.py](apps/api/app/agent/plugins.py) 只做 marketplace 拉取 + git clone 落盘，无执行系统；前端能浏览/安装但 agent 不会加载。README/设计文档已声明为非目标，但 UI 暴露了该能力，用户可能误解为可用。
6. **memory 自动提取靠正则** — [memory.py:extract_and_save](apps/api/app/agent/memory.py#L127) 用 6 条正则从用户消息提取偏好，存在误提取风险（如"我不喜欢X"会被 `我[喜不]?[喜欢爱]` 匹配但语义取反）。无去重上限，长对话可能堆积。
7. **`/api/memory` 暴露 `_recent` 私有方法** — [main.py:183](apps/api/app/main.py#L183) 直接调 `memory_manager._recent(limit)`，下划线前缀表明是内部实现，建议提供公开 `recent()` 接口。

### 11.3 工程化

8. **工作区有未提交改动** — `.run-logs/frontend.out.log`（运行日志，已在 .gitignore 但仍被 tracked）和 `packages/airui`（submodule 指针漂移）。
9. **`.run-logs/` 含截图与日志** — 已在 .gitignore 但部分文件已被 tracked，建议 `git rm --cached` 清理。
10. **[utils.py](apps/api/app/utils.py) 可能残留股票时代 helpers** — `to_jsonable` 通用，但 `pick_number` 等数值处理函数可能已无调用方，建议核查死代码。

### 11.4 安全

11. **CORS 全开** — [main.py:17](apps/api/app/main.py#L17) `allow_origins=["*"]` + `allow_credentials=True`，生产部署需收紧。
12. **`git clone` 安装插件** — [plugins.py:install](apps/api/app/agent/plugins.py#L84) 执行服务端 git clone，source 来自用户输入，虽有 `--depth 1` 与超时，但任意 URL 克隆存在供应链风险（clone 钩子、大仓库 DoS）。生产环境应加白名单或沙箱。

## 12. 核心文件速查

| 用途 | 文件 |
|---|---|
| 入口/路由 | [apps/api/app/main.py](apps/api/app/main.py) |
| Agent loop | [apps/api/app/agent/agent.py](apps/api/app/agent/agent.py) |
| 配置（provider 同步） | [apps/api/app/agent/config.py](apps/api/app/agent/config.py) |
| 运行时配置 | [apps/api/config/agent.json](apps/api/config/agent.json) |
| MCP 客户端 | [apps/api/app/agent/mcp_client.py](apps/api/app/agent/mcp_client.py) |
| 技能路由 | [apps/api/app/agent/skills.py](apps/api/app/agent/skills.py) |
| 工具定义/归一化 | [apps/api/app/agent/tools.py](apps/api/app/agent/tools.py) |
| AIRUI 初始文档 | [apps/api/app/airui/renderer.py](apps/api/app/airui/renderer.py) |
| 前端状态 | [apps/console/src/store.ts](apps/console/src/store.ts) |
| 流式聊天 | [apps/console/src/chat.ts](apps/console/src/chat.ts) |
| 主区渲染 | [apps/console/src/components/ConsoleView.tsx](apps/console/src/components/ConsoleView.tsx) |
| 自定义组件 | [apps/console/src/airui-custom.tsx](apps/console/src/airui-custom.tsx) |
| AIRUI 类型 | [packages/airui/packages/core/src/types.ts](packages/airui/packages/core/src/types.ts) |

## 13. 演进脉络（近 10 提交）

```
b36f755 feat: 添加市场源              ← plugins marketplace
66d0c0c refactor：优化设置体验
5e2fb49 feat: 预设提供商              ← providerPresets
d85774f docs: add LLM provider presets & switch design spec
d60ad9f refactor: 重构初始页面
20ba354 feat: add mcp & skill         ← MCP + skills 接入
ab06c37 fix：fix i18n
8b74654 refactor：refactor setting
623ee9f refactor：refactor base ui
e886cf2 style：update style
```

近期主线：MCP/Skills 接入 → 基础 UI 重构 → Provider 预设 + 切换 → 插件市场源 → 设置体验优化。当前分支 `general`，主分支 `main`。
