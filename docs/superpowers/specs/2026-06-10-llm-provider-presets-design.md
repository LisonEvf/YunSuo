# LLM Provider 预设与切换

> 参考 cc-switch 的 provider preset 思路，适配本项目（后端只走 OpenAI 兼容协议）。

## 目标

1. 内置多个常用 LLM provider 预设模板，一键回填表单。
2. 支持保存多个「已配置 provider 实例」，在它们之间一键切换激活。

## 范围

- 仅支持 **OpenAI 兼容协议** 的 provider（覆盖 OpenAI、DeepSeek、通义、Kimi、智谱 GLM、硅基流动、OpenRouter、火山豆包、Ollama、llama.cpp 等）。
- 不支持 Anthropic / Gemini 原生协议（后端 [agent.py](apps/api/app/agent/agent.py) 用 `AsyncOpenAI` 调用，加适配层不在本次范围）。

## 数据结构（[agent.json](config/agent.json)，向后兼容）

```jsonc
{
  "providers": [
    {
      "id": "deepseek-1",
      "name": "DeepSeek",            // 显示名（列表展示用）
      "provider": "openai",          // 协议标签，目前固定 openai
      "base_url": "https://api.deepseek.com/v1",
      "api_key": "sk-xxx",
      "model_name": "deepseek-chat",
      "max_output_tokens": 4096
    }
  ],
  "active_provider_id": "deepseek-1",
  "model": {                          // 保留：由 active provider 同步而来
    "provider": "openai",             // 后端 agent.py 照旧读 model，零改动
    "name": "deepseek-chat",
    "base_url": "https://api.deepseek.com/v1",
    "api_key": "sk-xxx",
    "max_output_tokens": 4096
  }
}
```

### 同步规则（后端 [config.py](apps/api/app/agent/config.py)）

- `load_agent_config()`：读完磁盘后，若 `active_provider_id` 命中 `providers` 中某项，用该项覆盖 `model`（api_key/name/base_url/max_output_tokens/provider）。
- `save_agent_config()`：前端发完整 config；后端把 `model` 与 active provider 双向同步（active provider 实例的 5 字段 = model 的 5 字段）。
- 没有 `providers` / `active_provider_id` 时，行为完全等同于现状（向后兼容）。

## 内置预设模板（前端 TS 常量）

字段：`{ key, name, provider, base_url, defaultModel, maxOutputTokens, websiteUrl, apiKeyUrl }`

约 10 项：OpenAI、DeepSeek、通义千问（百炼）、Moonshot Kimi、智谱 GLM、硅基流动、OpenRouter、火山方舟（豆包）、Ollama（本地 `http://localhost:11434/v1`）、llama.cpp（本地）、Custom（空模板）。

预设不含 api_key，仅作为「一键回填表单」的起点；保存后才进入 `providers` 列表。

## 前端 UI（[consoleLayout.ts](apps/console/src/consoleLayout.ts) LLM 卡片）

在现有 5 个 `Setting` 字段之上，卡片顶部增加：

1. **预设选择**（`Select` / 下拉）：选预设 → 回填 provider/base_url/model_name/max_output_tokens（api_key 留空待填）。
2. **已保存 Provider 列表**（自定义组件 `ProviderList`）：每项显示 name + model_name，带「激活」「删除」操作；激活 = 设 `active_provider_id` 并把表单字段同步过去。
3. 表单新增「显示名」字段（`model.display_name`，仅前端用，不入后端 model）。
4. 底部「保存为新 Provider」按钮：当前表单 + 随机 id 存入 `providers` 并设为 active。

## 落点清单

- 后端：[apps/api/app/agent/config.py](apps/api/app/agent/config.py)（load/save 同步逻辑）
- 前端 store：[apps/console/src/store.ts](apps/console/src/store.ts)（`AgentConfig` 加 `providers` / `active_provider_id`）
- 前端预设：新增 `apps/console/src/providerPresets.ts`
- 前端布局：[apps/console/src/consoleLayout.ts](apps/console/src/consoleLayout.ts)（LLM 卡片）
- 前端逻辑：[apps/console/src/components/ConsoleView.tsx](apps/console/src/components/ConsoleView.tsx)（draft / save / 激活切换交互）
- i18n：[apps/console/src/i18n.ts](apps/console/src/i18n.ts)（新增文案）

## 不做（YAGNI）

- provider 拖拽排序、测速、用量脚本、OAuth、apiFormat 转换 —— cc-switch 有但本次不做。
- 预设从后端返回 / 用户自定义预设库 —— 先前端硬编码。
