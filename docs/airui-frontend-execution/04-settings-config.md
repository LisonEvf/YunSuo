# AIRUI 前端执行方案 04：设置、LLM、Skill 与 MCP 配置

## 目标

新增设置模块，支持前端主题切换，并提供 LLM、Skill、MCP 配置能力。

## 主题设置

前端提供：

- 自动
- 浅色
- 深色
- 石墨

主题写入 `localStorage`，刷新后保留。主题变量覆盖背景、文字、边框、卡片、表格、输入框、强调色。

## LLM 配置

设置页读取 `/api/config`，展示并编辑：

- `model.provider`
- `model.name`
- `model.base_url`
- `model.api_key`
- `model.max_output_tokens`
- `runtime.max_iterations`
- `runtime.context_window_tokens`

保存时调用 `PUT /api/config`，写入 `backend/config/agent.json`。后端重建 Agent 单例，使新的 base_url/model/api_key 对后续对话立即生效。

## Skill 配置

设置页读取 `/api/skills`：

- 展示本地 skills 名称与描述。
- 可勾选启用项。
- 对话请求携带 `skills` 数组。

本阶段启用状态保存在前端 `localStorage`；后端仍以 `/api/chat` 请求中的 `skills` 为准。

## MCP 配置

当前项目已有 `backend/config/agent.json` 的 `mcp.servers` 字段，但 Agent 运行时尚未接入 MCP 调度器。本阶段提供：

- MCP enabled 开关。
- JSON 编辑区域维护 servers。
- 保存到配置文件。

运行时 MCP 接入作为后续工程项，设置页先作为配置登记入口。

## 交付标准

- 设置页能读到当前 LLM 配置。
- 修改并保存后，配置文件更新，后续对话使用新的 LLM 连接参数。
- Skill 勾选项会参与下一次对话请求。
- MCP 配置可保存，不影响当前看板运行。
