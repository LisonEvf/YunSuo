# 对话式 Provider 预设管理 — 设计文档

> 日期：2026-06-10
> 状态：待审查

## 1. 背景与目标

云梭控制台的「LLM 提供商预设」设置页目前由前端硬编码的 [providerPresets.ts](../../../apps/console/src/providerPresets.ts) 提供 11 个内置模板（OpenAI / DeepSeek / Qwen 等），仅作「一键回填表单」起点；用户保存的真实账号配置是 `providers` 实例列表，存于 [agent.json](../../../apps/api/config/agent.json)。

当前 agent 没有任何修改配置或预设的工具——用户只能手动在设置页操作。

**目标**：让用户能通过自然语言对话增删改预设模板与 provider 实例，改动持久化并实时反映到设置页；同时让 agent 记住用户的 provider 偏好，下次能主动建议。

**已确认的决策**：
- **范围**：模板与 provider 实例都能对话改。
- **存储**：结构化的模板/实例写 agent.json；用户软偏好写 memory 系统。
- **模板关系**：内置模板可被用户覆盖改动，形成「覆盖层」，可恢复默认。
- **工具粒度**：整体读-改-写式，4 个工具。

## 2. 非目标

- 不引入通用 `save_memory` 工具（YAGNI）。
- 不改设置页的视觉布局，只改其数据来源（硬编码 → config）。
- 不支持非 OpenAI 兼容协议的 provider（沿用现状）。
- 不做模板的导入/导出、多用户、权限隔离。

## 3. 数据模型与覆盖层合并

### 3.1 agent.json 扩展

新增 `provider_presets` 字段（用户覆盖层）。条目结构同内置 `ProviderPreset`，多一个可选 `hidden: true`：

```jsonc
"provider_presets": [
  { "key": "deepseek", "defaultModel": "deepseek-v3" },        // 改内置
  { "key": "ollama", "hidden": true },                          // 隐藏内置
  { "key": "groq", "name": "Groq", "provider": "openai",        // 新增
    "base_url": "https://api.groq.com/openai/v1",
    "defaultModel": "llama-3.3-70b", "maxOutputTokens": 4096, "color": "#F55036" }
]
```

`ProviderPreset` 字段：`key, name, provider, base_url, defaultModel, maxOutputTokens, websiteUrl?, apiKeyUrl?, color?, local?`，覆盖层额外允许 `hidden?`。

`DEFAULT_AGENT_CONFIG` 加默认值 `"provider_presets": []`。`_deep_merge` 对 list 整体替换，新字段自动透传。

### 3.2 合并规则

后端公共函数 `merge_presets(builtin, overlay)`，按 `key` 匹配：

- 覆盖层条目 `hidden: true` → 移除同名内置项。
- 否则 → 与同名内置项**浅合并**（覆盖层字段优先）。
- 覆盖层中内置没有的 `key` → 作为新模板追加。

**恢复默认** = 清空 `provider_presets`（整层置 `[]`），内置 11 个原样回来。

### 3.3 单一合并源

合并逻辑只放后端 [config.py](../../../apps/api/app/agent/config.py)。

- `/api/config` GET 返回**已合并的完整 `provider_presets` 列表**（在路由层调用合并，`load_agent_config` 仍返回原始覆盖层）。
- `get_provider_config` 工具同样调用合并函数。
- 前端设置页改为从 `appConfig.provider_presets` 渲染。

### 3.4 内置表的 Python 镜像

新建 [apps/api/app/agent/provider_presets.py](../../../apps/api/app/agent/)，导出 `BUILTIN_PROVIDER_PRESETS`（11 个，字段与 ts 表一致）。合并发生在后端，必须有这份镜像。

**维护约束**：ts 与 py 两份内置表需保持一致。修改任一处时同步另一处。ts 表的 `colorForProvider` 工具函数保留（前端品牌色匹配仍用内置常量）。

## 4. agent 工具

加进 [tools.py](../../../apps/api/app/agent/tools.py) 的 `TOOL_DEFINITIONS` 与 `_HANDLERS`。

| 工具 | 参数 | 行为与约束 |
|---|---|---|
| `get_provider_config` | 无 | 返回 `{provider_presets(合并后), builtin_preset_keys, providers(api_key 掩码), active_provider_id}`。`builtin_preset_keys` 供 agent 判断「恢复默认」范围 |
| `update_provider_presets` | `presets: list`（完整覆盖层，整体替换） | 校验：每条有 `key`；非 `hidden` 项需 `name` + 合法 `base_url` + `defaultModel` + `provider=="openai"`。写回覆盖层。**不含 api_key** |
| `update_providers` | `providers: list`（完整实例列表） | 校验：`id` 唯一、`name`/`base_url`/`model_name` 必填、`api_key` 可空、`max_output_tokens` 正整数。若 `active_provider_id` 指向被删 id 则置 null。**不动 active_id** |
| `activate_provider` | `provider_id: string\|null` | 校验 id 存在（null=取消激活，回退 model 字段）。**先 `_sync_active_to_model` 再 `save_agent_config`**，随后 `reset_agent()`——唯一触发换运行模型的工具 |

### 4.1 activate_provider 反向同步陷阱

`save_agent_config` 内部会 `_sync_model_to_active`（model → active 实例）。若直接改 `active_provider_id` 就 save，旧 model 会反向覆盖目标实例配置。

**正确顺序**：`load_agent_config()` → set `active_provider_id` → `_sync_active_to_model(cfg)`（让 model = 目标实例）→ `save_agent_config(cfg)`。此时 model 已是目标实例值，反向同步无害。

### 4.2 工具 handler 共用配置函数

- 读：`load_agent_config()` + `get_merged_presets(cfg)`
- 写：构造完整 cfg dict → `save_agent_config(cfg)`（内部深合并 + 写文件 + `reload_config`）
- `activate_provider` 额外调 `reset_agent()`（重置单例，下次请求用新模型）

## 5. system prompt 更新

[system_prompt.py](../../../apps/api/app/agent/system_prompt.py)：

1. "Available Generic Tools" 段补 4 个新工具。
2. 新增 `## Provider Configuration` 段，指引 agent：
   - 流程：先 `get_provider_config` 看现状 → 按用户意图改 → `update_*` 写回。
   - 模板可增删改（覆盖层语义，可恢复默认）；实例是用户账号，激活后影响下次对话所用模型。
   - 改完简要说明改了什么；激活 / 删除活跃实例前提示影响。
   - **不主动询问 api_key 明文**；已存 key 自动掩码返回。

## 6. 前端同步（新增 `config_changed` SSE 事件）

### 6.1 后端

[agent.py](../../../apps/api/app/agent/agent.py) 工具 loop 里，当 4 个配置工具中任一**成功执行**（按工具名集合判定），额外 yield：

```jsonc
{ "type": "config_changed", "config": <cfg> }
```

`cfg` = `load_agent_config()` 的结果，其 `provider_presets` 已用 `get_merged_presets(cfg)` 替换为合并后的完整列表（与 `/api/config` GET 返回的一致）。

工具 handler 不耦合 SSE，loop 集中判定。复用现有 SSE 通道（`_sse_stream`），零新端点。

### 6.2 前端

[chat.ts](../../../apps/console/src/chat.ts) 加 `config_changed` 分支 → `useStore.getState().setAppConfig(evt.config)`。设置页因读 `appConfig.provider_presets` 自动刷新。

### 6.3 「恢复默认」入口

- 前端按钮：PUT `/api/config` 时 `provider_presets` 置 `[]`。
- agent 侧：`update_provider_presets` 传空列表。
- 两种入口等效。

## 7. memory 集成（轻量、自动）

### 7.1 现状缺口

agent 没有任何写 memory 的工具；`extract_and_save` 的正则不覆盖 provider 偏好语句。

### 7.2 最小实现

- `activate_provider` 成功后，handler 内部 upsert 一条 `category="provider_preference"` 记忆，如「用户当前激活 DeepSeek / deepseek-v3」。
- 给 [memory.py](../../../apps/api/app/agent/memory.py) 加 `upsert(category, content, keywords=None)`：同 `category` 下已有则更新 `content`/`keywords`/`updated_at`，否则 insert。避免每次激活产生冗余条目。
- recall 已有机制（`build_context_block` 注入 system prompt），下次 agent 能「看到」用户历史 provider 偏好并主动建议。

## 8. 安全

- 预设模板不含 `api_key`（现状，本设计保持）。
- provider 实例含 `api_key`，存 agent.json 明文（现状）；`get_provider_config` 工具返回结果中 api_key **一律掩码**（如 `sk-***ab12`），不进对话上下文、不进 trajectory 明文日志。
- 工具不主动询问 api_key 明文（system prompt 指引）；用户若在对话里贴 key，agent 应提示「建议在设置页填入而非对话中提供」并避免回显。

## 9. 错误处理

- 工具校验失败 → 返回 `{"status":"error","message":<原因>}`，不写文件，agent 据此向用户说明。
- `save_agent_config` / `reload_config` 异常 → 工具捕获，返回 error，不触发 `config_changed` 事件。
- `activate_provider` 的 `reset_agent` 若失败（如新配置无法初始化 agent）→ 返回 error 并回滚 active_id。

## 10. 测试

### 后端 pytest（`bun run test:api`，新建 `apps/api/tests/test_provider_config.py`）

- `merge_presets`：改 / 删(`hidden`) / 新增 / 恢复默认(空覆盖层) 四种场景。
- `get_provider_config`：api_key 掩码正确（实例 key 被掩、模板无 key）。
- `update_provider_presets`：缺 `key`、非法 `base_url`、`provider!="openai"`、缺 `defaultModel` 均拒绝。
- `update_providers`：`id` 重复拒绝；删除活跃实例后 `active_provider_id` 置 null。
- `activate_provider`：**验证反向同步陷阱**——切换后目标实例字段不被旧 model 覆盖。
- `upsert`（memory）：同 category 二次写入为更新而非新增。

### 前端

- `bun run build` 类型检查。
- 手动验证：对话「加 Groq 模板」→设置页实时出现；「激活 DeepSeek」→下次对话换模型；「恢复默认」→内置 11 个回来。

## 11. 落地范围

| 层 | 改动 |
|---|---|
| 后端 | 新建 `apps/api/app/agent/provider_presets.py`（内置表镜像）；`config.py` 加默认值 + `merge_presets` + `/api/config` GET 返回合并结果；`tools.py` 加 4 工具；`agent.py` loop 推 `config_changed`；`system_prompt.py` 加工具说明 + Provider Configuration 段；`memory.py` 加 `upsert` |
| 前端 | `store.ts` `AgentConfig` 加 `provider_presets`；`providerPresets.ts` 降级为内置常量 + 工具函数；`ConsoleView.tsx` 设置页改读 config + 「恢复默认」按钮；`chat.ts` 处理 `config_changed` |
| 测试 | `apps/api/tests/test_provider_config.py` |

## 12. 风险

- **双份内置表一致性**：ts 与 py 两份表需手动同步。缓解：py 表加单测校验 key 集合与 ts 一致（可选）；改动时在 PR 描述里点名。
- **小模型工具选择**：qwen3-coder 等模型可能在 4 个工具间选错。缓解：system prompt 给出明确流程（get → update_*），工具描述写清「整体替换」语义。
- **反向同步陷阱**：实现时若忽略 `_sync_active_to_model` 顺序会破坏目标实例。缓解：单测覆盖 + 代码注释。
