/**
 * 内置 LLM provider 预设模板（仅 OpenAI 兼容协议）。
 *
 * 注意：本表是「内置默认值」。用户通过对话或设置页的改动存为后端 agent.json 的覆盖层；
 * 前端设置页渲染的是后端 /api/config 返回的「合并后列表」（store.appConfig.provider_presets），
 * 不再直接使用本表的 providerPresets。本表仅供：
 *   ① 后端 provider_presets.py 的 Python 镜像作一致性参考
 *   ② colorForProvider 品牌色匹配
 *   ③ 「恢复默认」语义的权威来源
 * 修改内置条目时，必须同步 apps/api/app/agent/provider_presets.py。
 */
export interface ProviderPreset {
  key: string;
  /** 显示名（品牌名不翻译） */
  name: string;
  provider: string;
  base_url: string;
  defaultModel: string;
  maxOutputTokens: number;
  websiteUrl?: string;
  apiKeyUrl?: string;
  /** 品牌色（hex），用于 UI 色块图标与激活态 */
  color?: string;
  /** 本地部署标记，用于 UI 分组 */
  local?: boolean;
}

export const providerPresets: ProviderPreset[] = [
  {
    key: "openai",
    name: "OpenAI",
    provider: "openai",
    base_url: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    maxOutputTokens: 4096,
    color: "#10A37F",
    websiteUrl: "https://platform.openai.com",
    apiKeyUrl: "https://platform.openai.com/api-keys",
  },
  {
    key: "deepseek",
    name: "DeepSeek",
    provider: "openai",
    base_url: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    maxOutputTokens: 4096,
    color: "#4D6B85",
    websiteUrl: "https://platform.deepseek.com",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    key: "qwen",
    name: "通义千问 (百炼)",
    provider: "openai",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    maxOutputTokens: 4096,
    color: "#615CED",
    websiteUrl: "https://bailian.console.aliyun.com",
    apiKeyUrl: "https://bailian.console.aliyun.com/?apiKey=1",
  },
  {
    key: "moonshot",
    name: "Moonshot Kimi",
    provider: "openai",
    base_url: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
    maxOutputTokens: 4096,
    color: "#1D1D1F",
    websiteUrl: "https://platform.moonshot.cn",
    apiKeyUrl: "https://platform.moonshot.cn/console/api-keys",
  },
  {
    key: "zhipu",
    name: "智谱 GLM",
    provider: "openai",
    base_url: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-plus",
    maxOutputTokens: 4096,
    color: "#3859FF",
    websiteUrl: "https://open.bigmodel.cn",
    apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
  },
  {
    key: "siliconflow",
    name: "硅基流动",
    provider: "openai",
    base_url: "https://api.siliconflow.cn/v1",
    defaultModel: "deepseek-ai/DeepSeek-V3",
    maxOutputTokens: 4096,
    color: "#FF6B35",
    websiteUrl: "https://siliconflow.cn",
    apiKeyUrl: "https://cloud.siliconflow.cn/account/ak",
  },
  {
    key: "openrouter",
    name: "OpenRouter",
    provider: "openai",
    base_url: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o",
    maxOutputTokens: 4096,
    color: "#646669",
    websiteUrl: "https://openrouter.ai",
    apiKeyUrl: "https://openrouter.ai/keys",
  },
  {
    key: "volcengine",
    name: "火山方舟 (豆包)",
    provider: "openai",
    base_url: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-pro-32k",
    maxOutputTokens: 4096,
    color: "#3370FF",
    websiteUrl: "https://www.volcengine.com/product/doubao",
    apiKeyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
  },
  {
    key: "ollama",
    name: "Ollama (本地)",
    provider: "openai",
    base_url: "http://localhost:11434/v1",
    defaultModel: "qwen2.5:7b",
    maxOutputTokens: 4096,
    color: "#6B7280",
    websiteUrl: "https://ollama.com",
    local: true,
  },
  {
    key: "llamacpp",
    name: "llama.cpp (本地)",
    provider: "openai",
    base_url: "http://localhost:8080/v1",
    defaultModel: "local-model",
    maxOutputTokens: 4096,
    color: "#8B5CF6",
    websiteUrl: "https://github.com/ggerganov/llama.cpp",
    local: true,
  },
  {
    key: "custom",
    name: "自定义",
    provider: "openai",
    base_url: "",
    defaultModel: "",
    maxOutputTokens: 4096,
    color: "#8B8F98",
  },
];

/** 按 base_url host 匹配预设品牌色；未命中则按名称哈希到调色板 */
export function colorForProvider(inst: { base_url?: string; name?: string; model_name?: string }): string {
  const url = inst.base_url || "";
  for (const p of providerPresets) {
    if (!p.color || !p.base_url) continue;
    try {
      if (url.includes(new URL(p.base_url).host)) return p.color;
    } catch {
      // base_url 非法，跳过
    }
  }
  const palette = ["#615CED", "#3859FF", "#10A37F", "#FF6B35", "#3370FF", "#8B5CF6"];
  const seed = (inst.name || inst.model_name || "x").charCodeAt(0);
  return palette[seed % palette.length];
}
