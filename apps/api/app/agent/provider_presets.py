"""内置 provider 预设表（与前端 providerPresets.ts 保持一致）+ 覆盖层合并。

合并发生在后端（单一合并源）：内置表是 base，agent.json 的 provider_presets 是用户覆盖层。
修改任一处的内置条目时，必须同步另一处（ts ↔ py）。
"""
from __future__ import annotations

BUILTIN_PROVIDER_PRESETS: list[dict] = [
    {"key": "openai", "name": "OpenAI", "provider": "openai",
     "base_url": "https://api.openai.com/v1", "defaultModel": "gpt-4o",
     "maxOutputTokens": 4096, "color": "#10A37F",
     "websiteUrl": "https://platform.openai.com", "apiKeyUrl": "https://platform.openai.com/api-keys"},
    {"key": "deepseek", "name": "DeepSeek", "provider": "openai",
     "base_url": "https://api.deepseek.com/v1", "defaultModel": "deepseek-chat",
     "maxOutputTokens": 4096, "color": "#4D6B85",
     "websiteUrl": "https://platform.deepseek.com", "apiKeyUrl": "https://platform.deepseek.com/api_keys"},
    {"key": "qwen", "name": "通义千问 (百炼)", "provider": "openai",
     "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1", "defaultModel": "qwen-plus",
     "maxOutputTokens": 4096, "color": "#615CED",
     "websiteUrl": "https://bailian.console.aliyun.com", "apiKeyUrl": "https://bailian.console.aliyun.com/?apiKey=1"},
    {"key": "moonshot", "name": "Moonshot Kimi", "provider": "openai",
     "base_url": "https://api.moonshot.cn/v1", "defaultModel": "moonshot-v1-8k",
     "maxOutputTokens": 4096, "color": "#1D1D1F",
     "websiteUrl": "https://platform.moonshot.cn", "apiKeyUrl": "https://platform.moonshot.cn/console/api-keys"},
    {"key": "zhipu", "name": "智谱 GLM", "provider": "openai",
     "base_url": "https://open.bigmodel.cn/api/paas/v4", "defaultModel": "glm-4-plus",
     "maxOutputTokens": 4096, "color": "#3859FF",
     "websiteUrl": "https://open.bigmodel.cn", "apiKeyUrl": "https://open.bigmodel.cn/usercenter/apikeys"},
    {"key": "siliconflow", "name": "硅基流动", "provider": "openai",
     "base_url": "https://api.siliconflow.cn/v1", "defaultModel": "deepseek-ai/DeepSeek-V3",
     "maxOutputTokens": 4096, "color": "#FF6B35",
     "websiteUrl": "https://siliconflow.cn", "apiKeyUrl": "https://cloud.siliconflow.cn/account/ak"},
    {"key": "openrouter", "name": "OpenRouter", "provider": "openai",
     "base_url": "https://openrouter.ai/api/v1", "defaultModel": "openai/gpt-4o",
     "maxOutputTokens": 4096, "color": "#646669",
     "websiteUrl": "https://openrouter.ai", "apiKeyUrl": "https://openrouter.ai/keys"},
    {"key": "volcengine", "name": "火山方舟 (豆包)", "provider": "openai",
     "base_url": "https://ark.cn-beijing.volces.com/api/v3", "defaultModel": "doubao-pro-32k",
     "maxOutputTokens": 4096, "color": "#3370FF",
     "websiteUrl": "https://www.volcengine.com/product/doubao",
     "apiKeyUrl": "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey"},
    {"key": "ollama", "name": "Ollama (本地)", "provider": "openai",
     "base_url": "http://localhost:11434/v1", "defaultModel": "qwen2.5:7b",
     "maxOutputTokens": 4096, "color": "#6B7280", "websiteUrl": "https://ollama.com", "local": True},
    {"key": "llamacpp", "name": "llama.cpp (本地)", "provider": "openai",
     "base_url": "http://localhost:8080/v1", "defaultModel": "local-model",
     "maxOutputTokens": 4096, "color": "#8B5CF6",
     "websiteUrl": "https://github.com/ggerganov/llama.cpp", "local": True},
    {"key": "custom", "name": "自定义", "provider": "openai",
     "base_url": "", "defaultModel": "", "maxOutputTokens": 4096, "color": "#8B8F98"},
]


def merge_presets(builtin: list[dict], overlay: list[dict]) -> list[dict]:
    """按 key 合并内置表与用户覆盖层。

    - 覆盖层 hidden=True → 移除同名内置项
    - 否则 → 与同名内置项浅合并（覆盖层字段优先）
    - 覆盖层中内置没有的 key → 作为新模板追加
    返回结果不含 hidden 字段。
    """
    overlay_by_key: dict[str, dict] = {}
    for ov in overlay or []:
        if isinstance(ov, dict) and ov.get("key"):
            overlay_by_key[str(ov["key"])] = ov

    result: list[dict] = []
    for b in builtin:
        key = b.get("key")
        ov = overlay_by_key.pop(key, None) if key is not None else None
        if ov is None:
            result.append(dict(b))
        elif ov.get("hidden"):
            continue
        else:
            merged = dict(b)
            merged.update({k: v for k, v in ov.items() if k != "hidden"})
            result.append(merged)

    for ov in overlay_by_key.values():
        if not ov.get("hidden"):
            result.append({k: v for k, v in ov.items() if k != "hidden"})
    return result
