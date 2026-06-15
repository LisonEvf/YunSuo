# 云梭阶段 0：基础配置 + 使用体验优化（含"交互即对话"最小验证）

> 日期：2026-06-15 ｜ 状态：待 review ｜ 作者：brainstorming 产出

## 1. 背景与产品哲学

云梭的终极形态：**用户通过使用（不改代码）把云梭演化成以 LLM 为核心能力的专属 SaaS**。核心设计哲学是「交互即对话」——UI 不是聊天的附属，UI 操作本身就是对话；agent 渲染 UI 时主动判断用户关心点、预设下一步操作，用户大多时候不需打字；对话窗口退居次要。

演进分三阶段：

| 阶段 | 内容 |
|---|---|
| **阶段 0（本 spec）** | 基础配置/使用体验优化 + 「交互即对话」最小验证 |
| 阶段 1 | Workspace 隔离 + 能力配置闭环（plugin/skill 可执行） |
| 阶段 2 | prompt-first 生成 + 「交互即对话」完整重构（AIRUI 双向化、结构化 intent、对话窗口彻底退居） |

**阶段 0 的取舍**：主体是基础优化，但纳入「交互即对话」的最小验证（C1），让方向立刻可感知。大改（主区结构、结构化 intent、prompt-first）全部留到阶段 2。用内置 76 组件，不自定义 catalog、不跟进 A2UI 跨平台生态。

## 2. 范围

**纳入（5 项）**：
- A1 MCP 配置即时生效
- A2 provider 切换即时生效
- B1 去掉 45s 重轮询
- B2 对话窗口弱化（最小步）
- **C1 artifact「预设下一步」按钮**（阶段 0 灵魂）

**非目标（留到后续阶段）**：
- 结构化 `tool_invoke` intent（阶段 2）
- 对话窗口彻底退居 / 主区布局重构（阶段 2）
- workspace 隔离（阶段 1）
- prompt-first 生成（阶段 2）
- 设置即时校验 / 未保存提示（A3，可缓）
- api_key 脱敏（SaaS 化时做）

## 3. 详细设计

### C1. artifact「预设下一步」按钮（核心）

**问题**：agent 渲染 artifact 后即终止，面板只读、无 next-action，闭环断裂，用户必须回对话框打字（Gap ②）。

**方案**：agent 为每个 artifact 附 2-4 个 `suggested_actions`（label + prompt），画廊在每个面板底部渲染按钮，点击 = `sendChat(prompt)`，用户不打字即可驱动 agent 下一轮。

**数据流**：
```
LLM → render_airui_panel(ref, title, content, actions)
  → tools.py 把 actions 存进 Widget.props.actions
  → WS push_document → 前端 store.doc
  → ConsoleView.collectArtifactPanels 提取 actions 进 ArtifactPanel
  → ArtifactGallery 在卡片底部渲染 actions 按钮
  → 点击 → sendChat(action.prompt) → 新一轮 agent run → 新 artifact + 新 actions（闭环）
```

**改动点**：
- 后端 `apps/api/app/agent/tools.py`：
  - `render_airui_panel` 的 TOOL_DEFINITIONS 加可选参数 `actions`（数组，每项 `{label, prompt, variant?}`）—— tools.py:26-44
  - `_render_airui_panel` 把 `args.get("actions")` 存进 Widget.props —— tools.py:166-171
- 后端 `apps/api/app/agent/system_prompt.py`：「AIRUI Artifact Guidance」段加引导——每个 artifact 附 2-4 个 actions，label 简短（≤6 字），prompt 是可直接执行的指令，面向用户可能的下一步
- 前端 `apps/console/src/airui-custom/helpers.ts`：`ArtifactPanel` interface 加 `actions?: { label: string; prompt: string; variant?: string }[]` —— helpers.ts:91-95
- 前端 `apps/console/src/components/ConsoleView.tsx`：`collectArtifactPanels` 从 `widget.props.actions` 提取进 ArtifactPanel —— ConsoleView.tsx:26-39
- 前端 `apps/console/src/airui-custom/gallery.tsx`：每个卡片底部（content 下方）渲染 actions 按钮区，onClick `sendChat(action.prompt)` —— gallery.tsx:126-128

**关键约束**：`normalizeAirUIComponent`（helpers.ts:87）用 `{ ...node, type, props, children }` 透传 props，不会丢字段；actions 放**外层 Widget.props**（不是内层 content），`collectArtifactPanels` 取 `widget.props` 即可拿到，无需改归一化逻辑。

**降级**：actions 为空或缺失时，画廊不渲染按钮区，完全不影响现有体验。

### A1. MCP 配置即时生效

**问题**：McpServers 改配置后需「先点底部保存，再点重连」两步（llm.tsx:65 注释明确「改配置需先点底部保存」），割裂。

**方案**：McpServers 卡片的「重连」改为「应用并重连」，一步完成：merge `draft.mcp` → appConfig → `PUT /api/config` → `POST /api/mcp/reconnect` → 更新 `state.mcpServers`。

**改动点**：
- 前端 `apps/console/src/airui-custom/llm.tsx`：
  - 抽 `applyMcpAndReconnect()`：把 draft.mcp merge 进 appConfig → PUT /api/config → POST /api/mcp/reconnect → setDoc 更新 mcpServers
  - 卡片顶部 reconnect 按钮（llm.tsx:66-79）改为调用 `applyMcpAndReconnect`
- 后端：无改动（复用 `/api/config` PUT + `/api/mcp/reconnect`）

### A2. provider 切换即时生效

**问题**：`LlmProviderPanel.activate` 只改 draft，要 `saveSettings`（底部统一保存）才 PUT —— llm.tsx:244-259。

**方案**：`activate` 改 async，立即 PUT `/api/config`（含新 `active_provider_id` + 同步后的 model）。后端 PUT 路由已 `reset_agent()`（main.py:113-120 已核对），下一轮对话即用新 provider。

**改动点**：
- 前端 `apps/console/src/airui-custom/llm.tsx`：`activate(id)`（llm.tsx:244-259）改 async——merge → PUT /api/config → `setAppConfig(saved)`
- 后端：无改动（PUT /api/config 已 reset_agent，main.py:119）

### B1. 去掉 45s 重轮询

**问题**：ConsoleView 每 45s 轮询 6 个接口（ConsoleView.tsx:232），重且与 WS 数据易不一致。

**方案**：移除 `setInterval`，改成事件驱动——mount 时一次 + chat done 后一次 + 进设置页一次。

**改动点**：
- 前端 `apps/console/src/components/ConsoleView.tsx`：
  - 移除 `setInterval(loadInspector, 45000)`（ConsoleView.tsx:232），保留 mount 时 `loadInspector()` 一次
  - 把 `loadInspector` 通过 store action 或模块 ref 暴露，供 chat.ts 触发
  - `openSettings`（ConsoleView.tsx:46-63）触发一次 inspector 拉取（确保 mcp/plugins/config 最新）
- 前端 `apps/console/src/chat.ts`：`done` 事件后（chat.ts:108-110）触发 `refreshInspector()`
- 后端：无改动

### B2. 对话窗口弱化（最小步）

**问题**：ChatPanel 默认 360px 展开占主视觉（App.tsx:91-94），与「弱化对话窗口」哲学相悖。

**方案**：agent 产出首个 artifact 后自动折叠 chat（让用户聚焦 artifact + actions 按钮），用户可 Ctrl+B 随时展开。配合 C1 形成闭环——点按钮驱动，对话框非必需。

**改动点**：
- 前端 `apps/console/src/chat.ts`：airui 事件首次产出后（chat.ts:100-102）`setAppConfig({ ui: { chatCollapsed: true } })`，用模块级标志位保证整场会话只自动折叠一次（避免反复打断）
- 前端 `apps/console/src/store.ts`：`chatCollapsed` 已在 ui 配置（store.ts:73），无需改 schema
- 后端：无改动

## 4. 与后续阶段的衔接

- **C1 → 阶段 2**：actions 点击走 `sendChat(预设 prompt)` 是「结构化 intent」的前身；阶段 2 升级为 `tool_invoke` 结构化事件，agent 直接执行工具、不走 LLM 解析自然语言
- **B2 → 阶段 2**：「产出即折叠」是对话窗口退居的最小验证；阶段 2 做主区布局重构，对话窗口成为可收起的次要面板
- **A1/A2 → 阶段 1**：即时生效为 workspace 多租户配置的流畅度打底

## 5. 验证

- 后端：`bun run test:api` 保持 84 passed；为 `render_airui_panel` 的 actions 参数加 1 个单测（断言 Widget.props.actions 透传）
- 前端：`bun run build:console`（tsc + vite build）通过
- 手动验收路径：
  1. 配一个 MCP server → 改配置 → 点「应用并重连」→ 一步生效（A1）
  2. 切换 provider → 下一条消息立即用新 provider（A2）
  3. 静置 1 分钟 → 无轮询请求（B1）；发一条消息 → done 后 inspector 刷新
  4. 让 agent 生成一个看板 → 看到底部出现 actions 按钮 + chat 自动折叠 → 点一个 action → 新一轮产出（C1 + B2）

## 6. 风险

- **actions 质量依赖 LLM**：system_prompt 引导可能不稳定（漏生成 / prompt 不好）。降级：actions 缺失时画廊不渲染按钮，不影响现有体验；上线后据实测调 prompt
- **B1 改事件驱动后数据陈旧**：长时无操作时 inspector 不刷新。缓解：inspector 区加一个手动「刷新」入口，或面板可见时低频（5min）拉取作为兜底
- **B2 自动折叠可能打扰习惯对话的用户**：用「整场会话只折叠一次」+ Ctrl+B 可随时展开缓解；阶段 0 不改默认展开状态，避免新用户首屏懵
