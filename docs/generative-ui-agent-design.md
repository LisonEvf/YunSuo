# 云梭 Generative-UI Agent 设计

> 状态：设计 / 演进方向（2026-06-21）
> 关联：[PROJECT_REPORT.md](../PROJECT_REPORT.md) · [README.md](../README.md) · [general-agent-console-design.md](general-agent-console-design.md) · [2026-06-09-airui-usage.md](2026-06-09-airui-usage.md)

## 1. 定位

云梭是一个**基于生成式 UI 交互的通用 AI Agent**。它的核心主张是：

> 让用户**仅通过点击**就能完成与 LLM 的完整交互。

这意味着 UI 不再只是 agent 的产物展示区，而是交互本身。每一屏 AIRUI 文档都是 agent 对"用户下一步可能想做什么"的预判，每个可点击元素都是一次结构化的意图提交。用户点击即推进下一轮，如此循环，形成闭环；预判不准时，通过弹窗修正，并把修正沉淀成记忆，让下一屏的预判更准。

项目存在的意义是降低 AI 的使用门槛：

- 方便**外行用户**也能参与到 AI 生态中来，不要求会写 prompt；
- 用户可以基于上述循环，**预设专属自己的面板和流程**；
- 配合 agent 的 **skill** 能力与 **MCP** 能力，把"个人面板 + 流程编排"组装成可用的工具链；
- 让**普通人也可以客制化专属 SaaS**——把"写需求"变成"点点点 + 偶尔改一句"。

## 2. 与现状的关系

云梭当前形态是 FastAPI + React + AIRUI 的"通用 agent 操作台"：左侧聊天为主输入面，主区渲染运行时间线、artifacts、skills/memory/trajectory inspector。这为生成式 UI 交互提供了完整底座，但**交互范式仍是消息驱动**（用户打字 → assistant 回复）。

本设计文档描述的是一次**交互范式升级**，不是推翻现有架构。两者关系：

| 维度 | 现状（消息驱动） | 目标（点击驱动） |
|---|---|---|
| 主输入 | 聊天框文本 | 点击可交互元素 |
| 一轮交互 | user message → assistant reply | click → agent 生成下一屏 UI |
| 文字输入 | 主通道 | 降级为"预判修正 / 补充"的兜底通道 |
| AIRUI 文档 | 产物展示面 | 交互本身（回复载体） |
| 记忆 | 偏好 / 事实召回 | 偏好 + **预判偏差**召回 |
| 面板 | HOME_PROMPTS 起手卡片 | 可定义、可复用的"预判面板 / 流程" |

已有可复用的基础：AIRUI 的 `interaction` 事件与 `/ws/airui` 双向通道、前端 `HOME_PROMPTS`（starter 卡片 → prompt 映射）、`ConsoleView` 的交互回调、`airui-custom.tsx` 的 home/wiki/settings/gallery 组件、skill 路由与 MCP 工具注入。这些让"点击回流"在技术上是可达的，缺的是上层的**意图建模 + 预判/修正/记忆 + 面板/流程一等公民**。

## 3. 核心交互闭环

```text
① 预设面板（系统或用户预设的起手 AIRUI 文档）
        │
        ▼
② agent 预判：根据上下文 + 记忆，生成"用户下一步可能想做什么"的可点击 UI
   （每个可点击元素 = 一个结构化意图 payload + 一句预判说明）
        │
        ▼
③ 用户点击  ──────────────► 命中预判：点击即提交下一轮
        │                          │
        │  预判不准                 ▼
        ▼                   ④ agent 生成下一屏（回到 ②）
③ 修正弹窗：展示当前预判 / 候选意图 / 自由输入
        │
        ▼
④ 用户修正 → 系统记录"预判 vs 实际"偏差样本（预判记忆）
        │
        ▼
     回到 ②，下一屏基于修正后的意图与更新后的记忆生成
```

四类要素：

- **预设面板（preset panel）**：一屏起手 AIRUI 文档，让用户一进来就看到合理选项，不必从零想需求。系统为常见领域（研报、排期、数据查询…）预置；用户也可自定义。
- **预判 UI（predicted affordances）**：agent 为当前上下文生成的可点击选项，每项携带结构化意图 payload 与一句"点击会做什么"的预判标签。
- **修正弹窗（correction modal）**：预判不准时的兜底入口，暴露当前预判、候选意图和一个自由输入框，既能让用户一键纠偏，也允许外行用户偶尔用文字补充。
- **预判记忆（intent / preference memory）**：把"预判 vs 实际意图"的偏差作为一类可检索的长期资产，喂回下一轮生成，让预判随使用越来越准。

## 4. 点击即对话（Click as a Turn）

把整个交互重新建模为"点击即一次 user turn"。传统 agent loop 是 message-driven：

```text
user message → [memory + skills 注入] → LLM → tool_calls → … → reply
```

生成式 UI 下扩展为 click-driven：

```text
click 事件（结构化意图 payload）
   → 解析为意图对象（action + target + params + 来源元素 ref）
   → 作为下一轮 user turn 注入
   → [memory + skills + 当前点击上下文 + 预判历史] 注入
   → LLM 生成下一屏 AIRUI 文档（reply 的载体就是 UI）
   → 可选：先调用 skill / MCP 工具取数，再渲染文档
```

关键设计点：

- **意图 payload 而非自然语言**：每个可交互元素声明自己点击后表达的意图（如 `{action: "open_report", target: "research/latest", params: {...}}`），点击时由前端把 payload 回传，后端还原成结构化 user turn。这样既保留"点击即可推进"的低门槛，又给 agent 足够信息精准生成下一屏。
- **预判标签**：每个选项附带一句话说明"点击后会做什么 / 为什么摆这个选项"。它是给外行用户的提示，也是 agent 对自身预判的显式声明，便于后续校验。
- **AIRUI 文档即回复**：`/ws/airui` 的 document/patch 推送不再只承载"产物"，而是承载"下一轮回复"。聊天内联的 SSE `airui` 事件用于一次性产物，WS 通道用于持久面板，二者分工保持不变。

> 技术落点：意图 payload 可挂在 AIRUI 组件的 `interaction` / 事件元数据上，经现有 WS 回流通道进入 agent loop；`_build_messages_with_selection` 需要扩展，把"当前点击意图 + 预判历史"作为上下文块一并注入。

## 5. 预判、修正与记忆

这是本定位的灵魂，也是与"普通聊天 agent"的根本区别。

**预判**。agent 在生成每一屏时，不只是展示数据，而是主动猜测"用户接下来最可能点哪个"。预判的来源：当前上下文、领域预设面板的约束、以及预判记忆里的历史偏差。预判质量 = 命中率（用户点击的选项确实在预判集合里）。

**修正**。当用户点开一个选项发现不是想要的，或干脆找不到想要的选项，触发修正弹窗。弹窗三类入口：

1. 选错的选项 → "我其实想 …" 的候选意图列表（agent 基于上下文重新给候选）；
2. 缺失选项 → 自由输入框（外行用户也能用文字补一句）；
3. 直接编辑当前意图 payload → 给进阶用户的结构化编辑。

**记忆**。每次修正产生一条"预判 vs 实际"偏差样本，与现有 `memory.py`（关键词召回 + 偏好提取）、`review.py`（信号词识别复盘候选）同源：

- 偏差样本作为**预判记忆**存入记忆库，按领域 / 面板 / 意图类别召回；
- 通过 `trajectory.py` 的 JSONL 轨迹记录完整点击路径，供后台复盘；
- `review.py` 的后台复盘通道可识别"频繁预判失败"的模式，生成面板/预判改进候选。

> 与 [hermes-agent-self-evolution.md](hermes-agent-self-evolution.md) 中"前台即时响应、后台异步进化"思路一致：点击闭环保证即时可用，偏差记忆 + 后台复盘让预判随时间变准。

## 6. 面板与流程：用户能力的分层

"预设专属自己的面板和流程"是本定位对用户的价值分层，分两层：

**系统预设面板（built-in）**。agent 为常见领域预置一屏起手 AIRUI 文档，外行用户进来直接看到合理选项。这是降低门槛的第一层。它对应现有 `HOME_PROMPTS` 的升级：从"固定 prompt 映射"升级为"可生成的预判面板"。

**用户自定义面板与流程（user-defined）**。用户把常用点击路径固化成自己的面板 / 流程，这是"客制化专属 SaaS"的落点。本质上，面板 / 流程是一棵以 AIRUI 文档为节点、以点击意图为边的**交互状态机 / 决策树**：

```text
面板 = 起手节点 + 若干"点击 → 下一屏"的边
流程 = 一条固定路径（或带分支），把多个面板串成"一键流"
```

用户可保存、命名、复用、分享这些面板 / 流程。它们把 skill（行为能力）与 MCP（外部数据与操作）编排成普通人能直接用的成品。

> 与 skill / MCP 的关系：skill 提供"怎么做"的能力（如 task-planning、artifact-design），MCP 提供"能调用什么"的能力（外部工具与数据源）。面板 / 流程把它们按用户的真实工作流编排成一屏屏可点击的 UI。三者层次：**skill = 原子行为，MCP = 原子连接，面板/流程 = 编排成品**。

## 7. 普通人客制化专属 SaaS

这是项目存在的意义层面的目标，也是上述设计的最终产出。落点是把"做一个 SaaS 工具"从"写代码 + 配后端"降级为"配面板 + 接 MCP + 跑流程"：

- 用户不写代码，通过点击 + 偶尔修正，把 agent 引导成自己想要的工作流；
- 把这套工作流固化成面板 / 流程，即可作为个人 SaaS 反复使用；
- 通过 MCP 接入自己的数据源与操作（数据库、表格、第三方 API），工具能力随需扩展；
- skill 让 agent 在该工作流里更专业，预判记忆让面板越用越顺手。

对"外行用户"的承诺：门槛是"会点击、偶尔会说一句话"，而不是"会写 prompt、会配参数"。

## 8. 演进路径与现状 Gap

本设计是方向，不是已实现状态。为避免文档夸大，明确当前 gap：

| 能力 | 现状 | 目标 |
|---|---|---|
| 点击回流通道 | ✅ 已有（AIRUI interaction + `/ws/airui`） | 复用，无需重建 |
| 意图 payload 建模 | ✅ 已落地（[intent.py](../apps/api/app/agent/intent.py) + 前端 `sendIntent`/`sendPanelAction`，点击携带结构化意图信封，agent loop 注入 system prompt） | 持续打磨意图类别 |
| 预判 UI / 预判标签 | 🟡 进行中（system prompt 已要求 actions 携带结构化 `intent` + `variant:"primary"` 预判 + `correct` 修正路径；HOME_PROMPTS 起手卡片为预设面板雏形） | 每屏预判命中率可观测 |
| 修正弹窗 | ✅ 已落地（[CorrectionModal.tsx](../apps/console/src/components/CorrectionModal.tsx) 三类入口：候选意图 / 自由输入 / 结构化编辑；gallery 全局「不对，我想…」入口 + correct action 触发） | 持续打磨候选生成 |
| 预判记忆 | ✅ 已落地（corrected_from 偏差样本写入 data/reviews/prediction_misses.jsonl，下一轮注入 system prompt 让预判更准） | 召回策略可加权 |
| 面板 / 流程一等公民 | ✅ 已落地（[panels.py](../apps/api/app/agent/panels.py) SQLite 存储 Panel+Flow；/api/panels、/api/panels/{id}/run、/api/flows 路由；前端 panels 客户端 + 首页面板库 + gallery 存为面板） | 流程串联多面板运行 + 分享 |
| skill / MCP 编排 | ✅ 已落地（面板可声明 mcp_tools，/run 注入提示让 agent 优先调用；流程串联多面板/提示一键运行） | skill 自动编排（按面板意图选 skill） |

建议的演进顺序（每步都可独立交付、可验证）：

1. ✅ **意图 payload 与点击即对话**（已落地）：[intent.py](../apps/api/app/agent/intent.py) 定义 Intent 模型与信封编解码；agent loop 的 _build_messages_with_selection 提取并注入结构化意图；system prompt 升级生成式 UI 指引；前端 sendIntent/sendPanelAction + gallery actions 点击携带结构化意图信封。覆盖测试 	ests/test_intent.py（9 用例）。
2. ✅ **预判标签 + 修正弹窗**（已落地）：system prompt 已要求 actions 带 ariant:"primary" 预判 + correct 修正路径；[CorrectionModal.tsx](../apps/console/src/components/CorrectionModal.tsx) 提供候选意图 / 自由输入 / 结构化编辑三类入口；gallery 提供 correct action 触发与全局「不对，我想…」入口；corrected_from 偏差样本写入 data/reviews/prediction_misses.jsonl 并在下一轮注入 system prompt。覆盖测试 	ests/test_intent.py（16 用例）。
3. ✅ **预判记忆接入**（已落地）：corrected_from 偏差样本写入 data/reviews/prediction_misses.jsonl，uild_prediction_miss_context_block 在每轮 system prompt 注入历史偏差，跑通"越用越准"。覆盖测试 	ests/test_intent.py（16 用例）。
4. ✅ **面板 / 流程数据模型**（已落地）：[panels.py](../apps/api/app/agent/panels.py) 定义 Panel（起手提示 + 种子意图 + 领域标签）与 Flow（步骤路径）的 SQLite 存储；/api/panels + /api/panels/{id}/run + /api/flows 路由；前端 panels 客户端 + 首页面板库（列出/运行/删除）+ gallery「存为面板」。覆盖测试 	ests/test_panels.py（8 用例）。
5. ✅ **系统预设面板库**（已落地）：`seed_builtin_panels()` 在 lifespan 启动时幂等种子化 4 个内置预设（运营看板 / 周报复盘 / 数据探索 / 方案对比），外行用户首次进入即见合理选项；内置面板受保护不可删（DELETE 返回 403），与用户面板区分展示。
6. ✅ **用户自定义 + MCP 编排**（已落地）：Panel 支持 `mcp_tools` 声明依赖的 MCP 工具，`/panels/{id}/run` 把工具提示注入起手 prompt（面板接 MCP）；Flow 的 `/flows/{id}/run` 串联多面板/内联提示为有序步骤，前端依次流式执行（一键流）；前端面板库区分内置/用户面板，gallery「存为面板」把会话固化为可复用面板。至此「普通人客制化专属 SaaS」的完整路径贯通。

## 9. 设计原则

- **点击优先，文字兜底**：默认路径是纯点击，文字输入只在预判失败时作为兜底，不成为主负担。
- **预判显式化**：agent 对自己的预判要有可读的声明（预判标签），既服务用户，也便于校验与复盘。
- **诚实记忆**：修正不是失败，而是学习信号；偏差样本与偏好/事实记忆同等重要。
- **编排成品化**：skill 与 MCP 是原子，面板/流程是给普通人用的成品；价值在编排，不在堆原子。
- **不推翻底座**：AIRUI 文档模型、agent loop、WS 通道、记忆/轨迹/复盘子系统保持复用，升级的是交互范式与上层建模。