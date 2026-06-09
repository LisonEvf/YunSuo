# 对话式 Provider 预设管理 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户通过对话增删改 LLM provider 预设模板与 provider 实例，改动持久化到 agent.json 并实时同步到前端设置页，同时把激活偏好写入 memory。

**Architecture:** 后端新增 `provider_presets.py`（内置表镜像 + 覆盖层合并）；config/tools/system_prompt/agent/memory 协作提供 4 个 agent 工具 + `config_changed` SSE 事件；前端设置页改读 `appConfig.provider_presets`，chat 流处理 `config_changed` 刷新 store。

**Tech Stack:** Python 3.12 / FastAPI / pytest（后端）；React 19 / Vite / Zustand（前端）。

**Spec:** [docs/superpowers/specs/2026-06-10-conversational-provider-presets-design.md](../specs/2026-06-10-conversational-provider-presets-design.md)

---

## 文件结构

| 文件 | 责任 | 动作 |
|---|---|---|
| `apps/api/app/agent/provider_presets.py` | 内置预设表 Python 镜像 + `merge_presets` | 新建 |
| `apps/api/app/agent/config.py` | `DEFAULT_AGENT_CONFIG` 加默认值；`get_merged_presets` | 改 |
| `apps/api/app/agent/memory.py` | `MemoryManager.upsert` | 改 |
| `apps/api/app/agent/tools.py` | 4 工具定义 + handler + 校验/掩码 helper | 改 |
| `apps/api/app/agent/agent.py` | loop 推 `config_changed` 事件 | 改 |
| `apps/api/app/agent/system_prompt.py` | 工具说明 + Provider Configuration 段 | 改 |
| `apps/api/app/main.py` | `/api/config` GET 返回合并后 presets | 改 |
| `apps/api/tests/test_provider_config.py` | 后端测试 | 新建 |
| `apps/console/src/store.ts` | `AgentConfig.provider_presets` | 改 |
| `apps/console/src/airui-custom.tsx` | `LlmProviderPanel` 改读 config + 恢复默认按钮 | 改 |
| `apps/console/src/chat.ts` | `config_changed` 事件处理 | 改 |
| `apps/console/src/providerPresets.ts` | 注释说明降级为内置默认值 | 改（仅注释） |

---

## Task 1: 内置预设表 + 覆盖层合并

**Files:**
- Create: `apps/api/app/agent/provider_presets.py`
- Test: `apps/api/tests/test_provider_config.py`

- [ ] **Step 1: 写失败测试（merge_presets 四种场景）**

新建 `apps/api/tests/test_provider_config.py`：

```python
"""对话式 provider 预设管理 — 后端测试。"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# 让 tests/ 能 import app.*
API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.agent import config
from app.agent.provider_presets import BUILTIN_PROVIDER_PRESETS, merge_presets


@pytest.fixture(autouse=True)
def _restore_config():
    """每个测试后用真实 CONFIG_PATH reload，恢复全局 AGENT_CONFIG/LLM_* 常量。"""
    yield
    config.reload_config()


def test_merge_modify_builtin():
    """覆盖层浅合并：改内置 DeepSeek 默认模型。"""
    overlay = [{"key": "deepseek", "defaultModel": "deepseek-v3"}]
    merged = merge_presets(BUILTIN_PROVIDER_PRESETS, overlay)
    ds = next(p for p in merged if p["key"] == "deepseek")
    assert ds["defaultModel"] == "deepseek-v3"
    # 其他字段保留内置值
    assert ds["base_url"] == "https://api.deepseek.com/v1"
    assert ds["name"] == "DeepSeek"


def test_merge_hide_builtin():
    """覆盖层 hidden=true：移除内置 Ollama。"""
    overlay = [{"key": "ollama", "hidden": True}]
    merged = merge_presets(BUILTIN_PROVIDER_PRESETS, overlay)
    assert not any(p["key"] == "ollama" for p in merged)


def test_merge_add_new():
    """覆盖层新增内置没有的 key。"""
    overlay = [{"key": "groq", "name": "Groq", "provider": "openai",
                "base_url": "https://api.groq.com/openai/v1",
                "defaultModel": "llama-3.3-70b", "maxOutputTokens": 4096}]
    merged = merge_presets(BUILTIN_PROVIDER_PRESETS, overlay)
    groq = next(p for p in merged if p["key"] == "groq")
    assert groq["name"] == "Groq"
    assert "hidden" not in groq  # hidden 不应出现在最终结果


def test_merge_restore_default():
    """空覆盖层 = 完全恢复内置。"""
    merged = merge_presets(BUILTIN_PROVIDER_PRESETS, [])
    assert len(merged) == len(BUILTIN_PROVIDER_PRESETS)
    assert [p["key"] for p in merged] == [p["key"] for p in BUILTIN_PROVIDER_PRESETS]
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/api && python -m pytest tests/test_provider_config.py -v`
Expected: FAIL — `ModuleNotFoundError: app.agent.provider_presets`

- [ ] **Step 3: 实现 provider_presets.py**

新建 `apps/api/app/agent/provider_presets.py`：

```python
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
     "websiteUrl": "https://github.com/ggerganogger/llama.cpp", "local": True},
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/api && python -m pytest tests/test_provider_config.py -v`
Expected: PASS（4 个测试全过）

- [ ] **Step 5: 提交**

```bash
git add apps/api/app/agent/provider_presets.py apps/api/tests/test_provider_config.py
git commit -m "feat(api): 内置 provider 预设表与覆盖层合并"
```

---

## Task 2: config.py 集成合并 + 默认值

**Files:**
- Modify: `apps/api/app/agent/config.py`
- Test: `apps/api/tests/test_provider_config.py`

- [ ] **Step 1: 写失败测试（get_merged_presets）**

在 `tests/test_provider_config.py` 末尾追加：

```python
from app.agent import config


def test_get_merged_presets_uses_overlay(monkeypatch, tmp_path):
    """get_merged_presets 从给定 cfg 的覆盖层合并。"""
    cfg = {"provider_presets": [{"key": "deepseek", "defaultModel": "deepseek-v3"}]}
    merged = config.get_merged_presets(cfg)
    ds = next(p for p in merged if p["key"] == "deepseek")
    assert ds["defaultModel"] == "deepseek-v3"


def test_get_merged_presets_empty_overlay(monkeypatch, tmp_path):
    cfg = {"provider_presets": []}
    merged = config.get_merged_presets(cfg)
    assert len(merged) == len(BUILTIN_PROVIDER_PRESETS)
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/api && python -m pytest tests/test_provider_config.py::test_get_merged_presets_uses_overlay -v`
Expected: FAIL — `AttributeError: module 'app.agent.config' has no attribute 'get_merged_presets'`

- [ ] **Step 3: 改 config.py — 加默认值 + get_merged_presets**

在 `config.py` 的 `DEFAULT_AGENT_CONFIG` 字典里，`"active_provider_id": None,` 这一行**之后**插入：

```python
    # provider_presets: 用户覆盖层（与内置 BUILTIN_PROVIDER_PRESETS 合并后展示）。
    # 每项结构同内置预设，额外允许 hidden:true 表示隐藏同名内置项。
    "provider_presets": [],
```

在 `config.py` 的 `reload_config` 函数**之后**（`AGENT_CONFIG = reload_config()` 之前）插入：

```python
def get_merged_presets(cfg: dict | None = None) -> list[dict]:
    """返回内置预设与 cfg 覆盖层合并后的完整列表（供 /api/config 与工具共用）。"""
    from .provider_presets import BUILTIN_PROVIDER_PRESETS, merge_presets
    if cfg is None:
        cfg = AGENT_CONFIG
    return merge_presets(BUILTIN_PROVIDER_PRESETS, cfg.get("provider_presets") or [])
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/api && python -m pytest tests/test_provider_config.py -v`
Expected: PASS（6 个测试全过）

- [ ] **Step 5: 提交**

```bash
git add apps/api/app/agent/config.py apps/api/tests/test_provider_config.py
git commit -m "feat(api): config 加 provider_presets 默认值与合并函数"
```

---

## Task 3: /api/config GET 返回合并后 presets

**Files:**
- Modify: `apps/api/app/main.py:75-79`
- Test: `apps/api/tests/test_provider_config.py`

- [ ] **Step 1: 写失败测试（路由返回合并后）**

在 `tests/test_provider_config.py` 末尾追加（用 FastAPI TestClient，临时配置文件隔离）：

```python
def test_config_get_returns_merged_presets(monkeypatch, tmp_path):
    """/api/config 返回的 provider_presets 是合并后的完整列表。"""
    cfg_file = tmp_path / "agent.json"
    cfg_file.write_text(
        '{"model": {"provider": "openai", "name": "x", "base_url": "http://x/v1", '
        '"api_key": "k", "max_output_tokens": 4096, "display_name": ""}, '
        '"provider_presets": [{"key": "ollama", "hidden": true}]}',
        encoding="utf-8",
    )
    monkeypatch.setattr(config, "CONFIG_PATH", cfg_file)
    config.reload_config()

    # 直接调用路由函数（无参数，返回 dict），避免引入 TestClient/httpx 依赖
    from app.main import get_config
    out = get_config()
    presets = out["config"]["provider_presets"]
    # ollama 被 hidden，不应出现
    assert not any(p["key"] == "ollama" for p in presets)
    # 内置总数 = 11 - 1(ollama)
    assert len(presets) == len(BUILTIN_PROVIDER_PRESETS) - 1
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/api && python -m pytest tests/test_provider_config.py::test_config_get_returns_merged_presets -v`
Expected: FAIL — 返回的 `provider_presets` 是原始覆盖层 `[{key:ollama,hidden:true}]`，断言失败

- [ ] **Step 3: 改 main.py 的 get_config**

将 `main.py` 的 `get_config`（约 75-79 行）：

```python
@app.get("/api/config")
def get_config():
    from .agent.config import load_agent_config

    return {"config": load_agent_config()}
```

改为：

```python
@app.get("/api/config")
def get_config():
    from .agent.config import load_agent_config, get_merged_presets

    cfg = load_agent_config()
    # 返回给前端的 presets 用合并后的完整列表（覆盖原始覆盖层）
    cfg["provider_presets"] = get_merged_presets(cfg)
    return {"config": cfg}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/api && python -m pytest tests/test_provider_config.py -v`
Expected: PASS（7 个测试全过）

- [ ] **Step 5: 提交**

```bash
git add apps/api/app/main.py apps/api/tests/test_provider_config.py
git commit -m "feat(api): /api/config 返回合并后的 provider 预设"
```

---

## Task 4: memory.upsert

**Files:**
- Modify: `apps/api/app/agent/memory.py`
- Test: `apps/api/tests/test_provider_config.py`

- [ ] **Step 1: 写失败测试（upsert 同 category 更新而非新增）**

在 `tests/test_provider_config.py` 末尾追加（用临时 db 隔离）：

```python
def test_memory_upsert_same_category_updates(monkeypatch, tmp_path):
    """upsert 同 category 已有则更新，不新增重复条目。"""
    from app.agent import memory as mem_mod

    db_file = tmp_path / "memory.db"
    monkeypatch.setattr(mem_mod, "DB_PATH", db_file)
    # 重建 manager 用新路径
    mm = mem_mod.MemoryManager()

    mid1 = mm.upsert("provider_preference", "激活 DeepSeek / deepseek-chat")
    mid2 = mm.upsert("provider_preference", "激活 Groq / llama-3.3-70b")

    assert mid1 == mid2  # 同 category 复用同一条
    rows = mm.search("激活")
    assert len([r for r in rows if r["category"] == "provider_preference"]) == 1
    assert "Groq" in rows[0]["content"]
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/api && python -m pytest tests/test_provider_config.py::test_memory_upsert_same_category_updates -v`
Expected: FAIL — `AttributeError: 'MemoryManager' object has no attribute 'upsert'`

- [ ] **Step 3: 给 MemoryManager 加 upsert 方法**

在 `memory.py` 的 `MemoryManager.save` 方法**之后**插入：

```python
    def upsert(self, category: str, content: str, keywords: list[str] | None = None) -> int:
        """同 category 下已有则更新（最新一条），否则新增。避免重复条目。"""
        if keywords is None:
            keywords = _extract_keywords(content)
        now = datetime.now().isoformat()
        conn = self._get_conn()
        existing = conn.execute(
            "SELECT id FROM memories WHERE category = ? ORDER BY updated_at DESC LIMIT 1",
            (category,),
        ).fetchall()
        if existing:
            mem_id = existing[0]["id"]
            conn.execute(
                "UPDATE memories SET content = ?, keywords = ?, updated_at = ? WHERE id = ?",
                (content, ",".join(keywords), now, mem_id),
            )
            conn.commit()
            return mem_id
        return self.save(category, content, keywords)
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/api && python -m pytest tests/test_provider_config.py::test_memory_upsert_same_category_updates -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/api/app/agent/memory.py apps/api/tests/test_provider_config.py
git commit -m "feat(api): memory 加 upsert（同 category 更新）"
```

---

## Task 5: 工具 get_provider_config + update_provider_presets

**Files:**
- Modify: `apps/api/app/agent/tools.py`
- Test: `apps/api/tests/test_provider_config.py`

- [ ] **Step 1: 写失败测试（掩码 + 模板校验）**

在 `tests/test_provider_config.py` 末尾追加：

```python
def test_get_provider_config_masks_api_key(monkeypatch, tmp_path):
    """get_provider_config 返回的 providers 中 api_key 被掩码。"""
    cfg_file = tmp_path / "agent.json"
    cfg_file.write_text(
        '{"model": {"provider":"openai","name":"x","base_url":"http://x/v1",'
        '"api_key":"sk-secret123456","max_output_tokens":4096,"display_name":""},'
        '"providers":[{"id":"p1","name":"A","provider":"openai","base_url":"http://a/v1",'
        '"api_key":"sk-secret123456","model_name":"m","max_output_tokens":4096}],'
        '"active_provider_id":"p1","provider_presets":[]}',
        encoding="utf-8",
    )
    monkeypatch.setattr(config, "CONFIG_PATH", cfg_file)
    config.reload_config()

    from app.agent.tools import _get_provider_config
    out = _get_provider_config({})
    p = out["providers"][0]
    assert p["api_key"] != "sk-secret123456"
    assert "secret" not in p["api_key"]
    # 合并后的 presets 是完整内置列表
    assert len(out["provider_presets"]) == len(BUILTIN_PROVIDER_PRESETS)
    assert "openai" in out["builtin_preset_keys"]


def test_update_provider_presets_rejects_invalid(monkeypatch, tmp_path):
    cfg_file = tmp_path / "agent.json"
    cfg_file.write_text(
        '{"model":{"provider":"openai","name":"x","base_url":"http://x/v1",'
        '"api_key":"k","max_output_tokens":4096,"display_name":""},"provider_presets":[]}',
        encoding="utf-8",
    )
    monkeypatch.setattr(config, "CONFIG_PATH", cfg_file)
    config.reload_config()

    from app.agent.tools import _update_provider_presets
    # 缺 key
    assert "key" in _update_provider_presets({"presets": [{"name": "X"}]})["message"]
    # provider 非 openai
    r = _update_provider_presets({"presets": [{"key": "x", "name": "X", "provider": "anthropic",
        "base_url": "http://x/v1", "defaultModel": "m"}]})
    assert "openai" in r["message"]
    # 非法 base_url
    r = _update_provider_presets({"presets": [{"key": "x", "name": "X", "provider": "openai",
        "base_url": "not-a-url", "defaultModel": "m"}]})
    assert "base_url" in r["message"]


def test_update_provider_presets_writes_and_merges(monkeypatch, tmp_path):
    cfg_file = tmp_path / "agent.json"
    cfg_file.write_text(
        '{"model":{"provider":"openai","name":"x","base_url":"http://x/v1",'
        '"api_key":"k","max_output_tokens":4096,"display_name":""},"provider_presets":[]}',
        encoding="utf-8",
    )
    monkeypatch.setattr(config, "CONFIG_PATH", cfg_file)
    config.reload_config()

    from app.agent.tools import _update_provider_presets
    out = _update_provider_presets({"presets": [
        {"key": "groq", "name": "Groq", "provider": "openai",
         "base_url": "https://api.groq.com/openai/v1", "defaultModel": "llama-3.3-70b",
         "maxOutputTokens": 4096},
    ]})
    assert out["status"] == "ok"
    assert any(p["key"] == "groq" for p in out["provider_presets"])
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/api && python -m pytest tests/test_provider_config.py -k "get_provider_config_masks or update_provider_presets" -v`
Expected: FAIL — `ImportError: cannot import name '_get_provider_config'`

- [ ] **Step 3: 在 tools.py 加 helper + 2 个工具定义 + handler**

在 `tools.py` 顶部 `TOOL_DEFINITIONS` 列表**末尾**（`patch_airui_panel` 定义之后、列表结束 `]` 之前）追加 2 个工具定义：

```python
    {
        "type": "function",
        "function": {
            "name": "get_provider_config",
            "description": "Read current LLM provider preset templates (merged builtin + user overlay), saved provider instances (api_key masked), and the active provider id. Use this before modifying provider config.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_provider_presets",
            "description": "Replace the user provider-preset overlay (full list). Each entry: {key, name, provider, base_url, defaultModel, maxOutputTokens, ...}; add hidden:true to hide a builtin entry. Builtin defaults remain restorable by clearing the overlay. api_key is NOT allowed in presets.",
            "parameters": {
                "type": "object",
                "properties": {
                    "presets": {"type": "array", "description": "Full overlay list replacing the previous one."},
                },
                "required": ["presets"],
            },
        },
    },
```

在 `tools.py` 的 `_patch_airui_panel` 函数**之后**、`_HANDLERS` 字典**之前**插入 helper + 2 个 handler：

```python
def _mask_api_key(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 8:
        return "***"
    return f"{key[:3]}***{key[-4:]}"


def _mask_provider(p: dict) -> dict:
    out = dict(p)
    if "api_key" in out:
        out["api_key"] = _mask_api_key(str(out.get("api_key") or ""))
    return out


def _validate_presets(presets) -> str | None:
    """校验覆盖层；返回错误信息或 None。"""
    if not isinstance(presets, list):
        return "presets must be a list"
    from urllib.parse import urlparse

    seen: set[str] = set()
    for p in presets:
        if not isinstance(p, dict) or not p.get("key"):
            return "each preset must have a 'key'"
        key = str(p["key"])
        if key in seen:
            return f"duplicate preset key: {key}"
        seen.add(key)
        if p.get("hidden"):
            continue
        for field in ("name", "base_url", "defaultModel"):
            if not p.get(field):
                return f"preset {key} missing required field: {field}"
        if p.get("provider") != "openai":
            return f"preset {key}: provider must be 'openai' (only OpenAI-compatible)"
        try:
            u = urlparse(str(p["base_url"]))
            if u.scheme not in ("http", "https") or not u.netloc:
                return f"preset {key}: invalid base_url"
        except Exception:
            return f"preset {key}: invalid base_url"
    return None


def _get_provider_config(args: dict, snapshot: dict | None = None) -> dict[str, Any]:
    from .config import load_agent_config, get_merged_presets
    from .provider_presets import BUILTIN_PROVIDER_PRESETS

    cfg = load_agent_config()
    providers = cfg.get("providers") or []
    return {
        "provider_presets": get_merged_presets(cfg),
        "builtin_preset_keys": [p["key"] for p in BUILTIN_PROVIDER_PRESETS],
        "providers": [_mask_provider(p) for p in providers],
        "active_provider_id": cfg.get("active_provider_id"),
    }


def _update_provider_presets(args: dict, snapshot: dict | None = None) -> dict[str, Any]:
    from .config import load_agent_config, save_agent_config, get_merged_presets

    presets = args.get("presets")
    err = _validate_presets(presets)
    if err:
        return {"status": "error", "message": err}
    cfg = load_agent_config()
    cfg["provider_presets"] = presets
    save_agent_config(cfg)
    return {"status": "ok", "provider_presets": get_merged_presets(cfg)}
```

在 `tools.py` 的 `_HANDLERS` 字典里追加 2 个注册：

```python
    "get_provider_config": _get_provider_config,
    "update_provider_presets": _update_provider_presets,
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/api && python -m pytest tests/test_provider_config.py -k "get_provider_config_masks or update_provider_presets" -v`
Expected: PASS（3 个测试）

- [ ] **Step 5: 提交**

```bash
git add apps/api/app/agent/tools.py apps/api/tests/test_provider_config.py
git commit -m "feat(api): provider 配置工具 get/update_provider_presets"
```

---

## Task 6: 工具 update_providers + activate_provider

**Files:**
- Modify: `apps/api/app/agent/tools.py`
- Test: `apps/api/tests/test_provider_config.py`

- [ ] **Step 1: 写失败测试（实例校验 + active_id 失效 + 反向同步陷阱 + memory upsert 调用）**

在 `tests/test_provider_config.py` 末尾追加：

```python
def _write_cfg(tmp_path, providers, active_id=None):
    cfg_file = tmp_path / "agent.json"
    cfg_file.write_text(
        '{"model":{"provider":"openai","name":"x","base_url":"http://x/v1",'
        '"api_key":"k","max_output_tokens":4096,"display_name":""},'
        f '"providers":{json.dumps(providers)},'
        f '"active_provider_id":{json.dumps(active_id)}'
        ',"provider_presets":[]}',
        encoding="utf-8",
    )
    return cfg_file


def test_update_providers_clears_invalid_active_id(monkeypatch, tmp_path):
    import json as _json
    provs = [{"id": "p1", "name": "A", "provider": "openai", "base_url": "http://a/v1",
              "api_key": "k1", "model_name": "m1", "max_output_tokens": 4096},
             {"id": "p2", "name": "B", "provider": "openai", "base_url": "http://b/v1",
              "api_key": "k2", "model_name": "m2", "max_output_tokens": 4096}]
    monkeypatch.setattr(config, "CONFIG_PATH", _write_cfg(tmp_path, provs, "p2"))
    config.reload_config()

    from app.agent.tools import _update_providers
    # 删掉 p2（当前激活），active_id 应置 null
    out = _update_providers({"providers": [provs[0]]})
    assert out["status"] == "ok"
    assert out["active_provider_id"] is None


def test_update_providers_rejects_duplicate_id(monkeypatch, tmp_path):
    provs = [{"id": "p1", "name": "A", "provider": "openai", "base_url": "http://a/v1",
              "api_key": "k1", "model_name": "m1", "max_output_tokens": 4096}] * 2
    monkeypatch.setattr(config, "CONFIG_PATH", _write_cfg(tmp_path, []))
    config.reload_config()

    from app.agent.tools import _update_providers
    out = _update_providers({"providers": provs})
    assert out["status"] == "error"
    assert "duplicate" in out["message"]


def test_activate_provider_no_reverse_sync_corruption(monkeypatch, tmp_path):
    """激活 B 后，B 实例的字段不被旧 model（A 的值）覆盖。"""
    provs = [
        {"id": "A", "name": "Alpha", "provider": "openai", "base_url": "http://a/v1",
         "api_key": "key-A", "model_name": "model-A", "max_output_tokens": 4096},
        {"id": "B", "name": "Beta", "provider": "openai", "base_url": "http://b/v1",
         "api_key": "key-B", "model_name": "model-B", "max_output_tokens": 8192},
    ]
    monkeypatch.setattr(config, "CONFIG_PATH", _write_cfg(tmp_path, provs, "A"))
    config.reload_config()
    # 屏蔽真实 reset_agent（会清单例 + mcp/skill 缓存）
    import app.agent.agent as agent_mod
    monkeypatch.setattr(agent_mod, "reset_agent", lambda: None)
    # 屏蔽 memory 真实写入
    import app.agent.memory as mem_mod
    monkeypatch.setattr(mem_mod.memory_manager, "upsert", lambda *a, **k: 1)

    from app.agent.tools import _activate_provider
    out = _activate_provider({"provider_id": "B"})
    assert out["status"] == "ok"

    # 重新加载验证 B 未被破坏
    cfg = config.load_agent_config()
    b = next(p for p in cfg["providers"] if p["id"] == "B")
    assert b["base_url"] == "http://b/v1"
    assert b["model_name"] == "model-B"
    assert b["api_key"] == "key-B"
    assert b["max_output_tokens"] == 8192
    # model 现在应等于 B
    assert cfg["model"]["name"] == "model-B"
    assert cfg["active_provider_id"] == "B"


def test_activate_provider_unknown_id(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "CONFIG_PATH", _write_cfg(tmp_path, []))
    config.reload_config()
    from app.agent.tools import _activate_provider
    out = _activate_provider({"provider_id": "nope"})
    assert out["status"] == "error"
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/api && python -m pytest tests/test_provider_config.py -k "update_providers or activate_provider" -v`
Expected: FAIL — `ImportError: cannot import name '_update_providers'`

- [ ] **Step 3: 在 tools.py 加 2 个工具定义 + handler**

在 `TOOL_DEFINITIONS` 末尾再追加 2 个工具定义：

```python
    {
        "type": "function",
        "function": {
            "name": "update_providers",
            "description": "Replace the full saved provider instance list. Each instance: {id, name, provider, base_url, api_key, model_name, max_output_tokens}. If the active id is removed, active_provider_id becomes null. Does NOT change the active id otherwise.",
            "parameters": {
                "type": "object",
                "properties": {
                    "providers": {"type": "array", "description": "Full instance list replacing the previous one."},
                },
                "required": ["providers"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "activate_provider",
            "description": "Activate a saved provider instance by id (affects the model used in the next conversation). Pass null to deactivate and fall back to the model field.",
            "parameters": {
                "type": "object",
                "properties": {
                    "provider_id": {"type": ["string", "null"], "description": "Instance id to activate, or null to deactivate."},
                },
                "required": ["provider_id"],
            },
        },
    },
```

在 `_update_provider_presets` 函数**之后**插入校验 + 2 个 handler：

```python
def _validate_providers(providers) -> str | None:
    if not isinstance(providers, list):
        return "providers must be a list"
    seen: set[str] = set()
    for p in providers:
        if not isinstance(p, dict):
            return "each provider must be an object"
        for field in ("id", "name", "base_url", "model_name"):
            if not p.get(field):
                return f"provider missing required field: {field}"
        pid = str(p["id"])
        if pid in seen:
            return f"duplicate provider id: {pid}"
        seen.add(pid)
        if p.get("provider") != "openai":
            return f"provider {pid}: provider must be 'openai'"
        mot = p.get("max_output_tokens")
        if not isinstance(mot, int) or isinstance(mot, bool) or mot <= 0:
            return f"provider {pid}: max_output_tokens must be a positive integer"
    return None


def _update_providers(args: dict, snapshot: dict | None = None) -> dict[str, Any]:
    from .config import load_agent_config, save_agent_config

    providers = args.get("providers")
    err = _validate_providers(providers)
    if err:
        return {"status": "error", "message": err}
    cfg = load_agent_config()
    cfg["providers"] = providers
    active_id = cfg.get("active_provider_id")
    if active_id and not any(p.get("id") == active_id for p in providers):
        cfg["active_provider_id"] = None
    save_agent_config(cfg)
    return {
        "status": "ok",
        "providers": [_mask_provider(p) for p in providers],
        "active_provider_id": cfg.get("active_provider_id"),
    }


def _activate_provider(args: dict, snapshot: dict | None = None) -> dict[str, Any]:
    from . import config as _config
    from .agent import reset_agent  # 延迟导入，避免与 agent.py 循环
    from .memory import memory_manager

    provider_id = args.get("provider_id")  # None = 取消激活
    cfg = _config.load_agent_config()
    providers = cfg.get("providers") or []
    if provider_id is not None and not any(p.get("id") == provider_id for p in providers):
        return {"status": "error", "message": f"provider not found: {provider_id}"}

    cfg["active_provider_id"] = provider_id
    # 关键：先让 model 同步为目标实例，再 save。
    # 否则 save_agent_config 的 _sync_model_to_active 会用旧 model 反向覆盖目标实例。
    _config._sync_active_to_model(cfg)
    _config.save_agent_config(cfg)
    reset_agent()

    if provider_id:
        inst = next((p for p in providers if p.get("id") == provider_id), None)
        if inst:
            content = f"用户当前激活的 provider: {inst.get('name', '')} / {inst.get('model_name', '')}"
            try:
                memory_manager.upsert("provider_preference", content)
            except Exception as exc:
                logger.warning("provider_preference upsert failed: %s", exc)
    return {"status": "ok", "active_provider_id": provider_id}
```

> 注意 `_activate_provider` 里的导入路径：`from .agent import reset_agent`——`reset_agent` 定义在 `app/agent/agent.py`，且 `app/agent/__init__.py` 已 re-export（`main.py` 用 `from .agent import reset_agent` 验证过）。若 `__init__.py` 未 re-export，改用 `from .agent.agent import reset_agent`。

在 `_HANDLERS` 字典追加：

```python
    "update_providers": _update_providers,
    "activate_provider": _activate_provider,
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/api && python -m pytest tests/test_provider_config.py -k "update_providers or activate_provider" -v`
Expected: PASS（4 个测试，含反向同步陷阱验证）

- [ ] **Step 5: 跑全量后端测试确认无回归**

Run: `cd apps/api && python -m pytest tests -q`
Expected: 全部 PASS（原有 test_agent_tools 不受影响）

- [ ] **Step 6: 提交**

```bash
git add apps/api/app/agent/tools.py apps/api/tests/test_provider_config.py
git commit -m "feat(api): provider 工具 update_providers/activate_provider（含反向同步保护）"
```

---

## Task 7: agent loop 推 config_changed 事件

**Files:**
- Modify: `apps/api/app/agent/agent.py:497-513`

- [ ] **Step 1: 改 agent.py — 在工具结果后推 config_changed**

定位 `chat_stream` 里 yield `tool_result` event 的位置（约 497-502 行，airui 推送之后）。当前代码：

```python
                    yield event
                    # 当 render_airui_panel 成功时，推送内联 AIRUI 事件给聊天
                    if fn_name == "render_airui_panel" and "error" not in event:
                        content = fn_args.get("content", {})
                        if content:
                            yield {"type": "airui", "data": content}
```

在其**之后**（仍在该 `for (tc_id, fn_name, fn_args), result in zip(allowed, results):` 循环体内）追加：

```python
                    # 配置类工具成功后，推送合并后的完整 config 让前端实时刷新
                    if fn_name in _CONFIG_TOOLS and "error" not in event:
                        _cfg = config.load_agent_config()
                        _cfg["provider_presets"] = config.get_merged_presets(_cfg)
                        yield {"type": "config_changed", "config": _cfg}
```

在文件顶部 `logger = logging.getLogger(__name__)` **之后**（`GeneralAgent` 类定义之前）加常量：

```python
# 触发 config_changed 事件推送的配置类工具
_CONFIG_TOOLS = {"update_provider_presets", "update_providers", "activate_provider"}
```

- [ ] **Step 2: 验证语法 + 导入无误**

Run: `cd apps/api && python -c "from app.agent import agent; print(agent._CONFIG_TOOLS)"`
Expected: 打印 `{'update_provider_presets', 'update_providers', 'activate_provider'}`，无异常

- [ ] **Step 3: 跑全量后端测试**

Run: `cd apps/api && python -m pytest tests -q`
Expected: 全部 PASS

- [ ] **Step 4: 提交**

```bash
git add apps/api/app/agent/agent.py
git commit -m "feat(api): agent loop 推送 config_changed 事件"
```

---

## Task 8: system_prompt 更新

**Files:**
- Modify: `apps/api/app/agent/system_prompt.py`

- [ ] **Step 1: 改 system_prompt.py — 补工具说明 + Provider Configuration 段**

将 `SYSTEM_PROMPT` 中 `## Available Generic Tools` 段（列出 3 个工具的地方）替换为：

```python
## Available Generic Tools
- `get_agent_runtime_status`: inspect runtime status, configured model, skills, memory stats, and trajectory summary.
- `render_airui_panel`: render a generic AIRUI artifact panel in the operations console.
- `patch_airui_panel`: update the current AIRUI console document with JSON Patch operations.
- `get_provider_config`: read current provider preset templates (merged), saved provider instances (api_key masked), and active provider id.
- `update_provider_presets`: replace the user preset-template overlay (full list). Use hidden:true to hide a builtin entry.
- `update_providers`: replace the full saved provider instance list.
- `activate_provider`: activate a saved instance by id (or null to deactivate); affects the model used next turn.
```

在 `## Response Style` 段**之前**插入新段：

```python
## Provider Configuration
You can help the user manage LLM provider presets and saved instances through conversation.
- Workflow: call `get_provider_config` first to see the current state, then apply the user's intent with `update_provider_presets` / `update_providers` / `activate_provider`.
- Presets are templates that autofill the settings form; the user's edits form an overlay on top of builtin defaults. The builtin defaults can always be restored by clearing the overlay (empty list).
- Provider instances are the user's saved accounts; activating one changes the model used in the next turn.
- After any change, briefly tell the user what changed. Before activating or deleting the currently active instance, mention the impact.
- Never ask for api_key in plain text in the chat. Stored keys are returned masked. If the user pastes a key, suggest entering it in the settings page instead of the chat.
```

- [ ] **Step 2: 验证 system prompt 构建无误**

Run: `cd apps/api && python -c "from app.agent.system_prompt import build_system_prompt; print('Provider Configuration' in build_system_prompt())"`
Expected: 打印 `True`

- [ ] **Step 3: 提交**

```bash
git add apps/api/app/agent/system_prompt.py
git commit -m "feat(api): system prompt 补 provider 配置工具与指引"
```

---

## Task 9: 前端 — store 类型 + chat 事件 + 预设面板 + 恢复默认

**Files:**
- Modify: `apps/console/src/store.ts`
- Modify: `apps/console/src/chat.ts`
- Modify: `apps/console/src/airui-custom.tsx`
- Modify: `apps/console/src/providerPresets.ts`

- [ ] **Step 1: store.ts — AgentConfig 加 provider_presets**

在 `store.ts` 顶部 `import { create } from "zustand";` **之后**加类型导入：

```typescript
import type { ProviderPreset } from "./providerPresets";
```

在 `AgentConfig` 接口里，`active_provider_id: string | null;` 这一行**之后**加：

```typescript
  /** 合并后的 provider 预设模板列表（后端 /api/config 返回，前端只读展示） */
  provider_presets: ProviderPreset[];
```

在 `defaultAgentConfig` 里，`active_provider_id: null,` 这一行**之后**加：

```typescript
  provider_presets: [],
```

在 `setAppConfig` 的 set 回调里（`active_provider_id` 那行之后）加透传：

```typescript
        provider_presets: config.provider_presets ?? s.appConfig.provider_presets ?? [],
```

- [ ] **Step 2: chat.ts — 处理 config_changed 事件**

在 `chat.ts` 的 `if (evt.type === "done")` 分支**之前**插入：

```typescript
        if (evt.type === "config_changed" && evt.config) {
          useStore.getState().setAppConfig(evt.config);
        }
```

- [ ] **Step 3: airui-custom.tsx — LlmProviderPanel 改读 config + 恢复默认按钮**

在 `airui-custom.tsx` 第 5 行 `import type { ProviderInstance, MarketplaceSource } from "./store";` **替换为**：

```typescript
import { useStore, type ProviderInstance, type MarketplaceSource } from "./store";
```

在 `LlmProviderPanel` 组件函数体最前面（`const doc = useAirUIStore(...)` 之前）加：

```typescript
  const appConfig = useStore((s) => s.appConfig);
  const setAppConfig = useStore((s) => s.setAppConfig);
  const presets = appConfig.provider_presets ?? [];
```

把 `applyPreset` 里 `providerPresets.find((p) => p.key === key)` 改为 `presets.find((p) => p.key === key)`。

在 `hoverBorder` 函数**之后**加恢复默认函数：

```typescript
  const restoreDefaultPresets = async () => {
    const next = { ...appConfig, provider_presets: [] };
    const res = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: next }),
    });
    if (res.ok) {
      const payload = await res.json();
      setAppConfig(payload?.config ?? next);
    }
  };
```

把预设网格标题行（`providerPresetsHint` 那个 span）所在容器改为带「恢复默认」按钮：

```tsx
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text)" }}>{txt("providerPresets")}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, color: "var(--color-muted)" }}>{txt("providerPresetsHint")}</span>
            <button onClick={restoreDefaultPresets} style={{ fontSize: 11, color: "var(--color-primary)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>{txt("restoreDefault")}</button>
          </span>
        </div>
```

把 `providerPresets.map((p) => (` 改为 `presets.map((p) => (`。

- [ ] **Step 4: i18n — 加 restoreDefault 文案**

在 `apps/console/src/i18n.ts` 的 zh-CN 块（`providerPresetsHint` 那行附近）加：

```typescript
    restoreDefault: "恢复默认",
```

在 en-US 块对应位置加：

```typescript
    restoreDefault: "Restore defaults",
```

- [ ] **Step 5: providerPresets.ts — 注释说明降级**

把 `providerPresets.ts` 顶部注释（第 1-4 行）改为：

```typescript
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
```

- [ ] **Step 6: 类型检查 + 构建**

Run: `cd apps/console && bun run build`
Expected: 构建成功，无 TypeScript 错误

- [ ] **Step 7: 提交**

```bash
git add apps/console/src/store.ts apps/console/src/chat.ts apps/console/src/airui-custom.tsx apps/console/src/i18n.ts apps/console/src/providerPresets.ts
git commit -m "feat(console): 预设面板读 config + config_changed 同步 + 恢复默认"
```

---

## Task 10: 端到端验证

- [ ] **Step 1: 启动后端 + 前端**

Run: `cd c:/Users/Lison/Desktop/EvfWorkSpace/YunSuo && bun run dev`
（保持运行）

- [ ] **Step 2: 后端健康检查 + 配置读取**

Run: `curl -s http://127.0.0.1:8000/api/config | python -c "import sys,json; d=json.load(sys.stdin)['config']; print('presets:', len(d['provider_presets']), 'keys:', [p['key'] for p in d['provider_presets']])"`
Expected: 打印 `presets: 11` 和全部内置 key

- [ ] **Step 3: 手动验证对话改预设**

在控制台 http://127.0.0.1:8000/console/ 聊天框输入：
> 帮我新增一个 Groq 预设模板，base_url 是 https://api.groq.com/openai/v1，默认模型 llama-3.3-70b，品牌色 #F55036

Expected:
- agent 调 `get_provider_config` → `update_provider_presets`
- 设置页预设网格实时出现 Groq（无需刷新）
- 重启后端后 Groq 仍在（持久化）

- [ ] **Step 4: 手动验证隐藏内置 + 恢复默认**

聊天输入：
> 把 Ollama 预设隐藏掉

Expected: 设置页 Ollama 消失。点「恢复默认」按钮 → Ollama 回来。

- [ ] **Step 5: 手动验证激活实例 + memory**

（先在设置页保存一个 DeepSeek 实例）聊天输入：
> 帮我激活 DeepSeek 那个实例

Expected:
- agent 调 `activate_provider`
- 状态栏模型名切换为 DeepSeek 的 model
- `data/memory.db` 出现一条 `category=provider_preference` 记录
- 下次对话用的是 DeepSeek 模型

- [ ] **Step 6: 全量后端测试最终确认**

Run: `cd apps/api && python -m pytest tests -q`
Expected: 全部 PASS

---

## Self-Review 记录

**Spec 覆盖**：数据模型(T1-3)、4 工具(T5-6)、system prompt(T8)、config_changed 同步(T7,9)、memory upsert(T4,6)、api_key 掩码(T5)、恢复默认(T9)、测试(T1-6,10) — 全覆盖。

**类型一致性**：`get_merged_presets`、`_mask_api_key`、`_validate_presets`、`_validate_providers`、`upsert` 在定义与调用处名称一致；`provider_presets` 字段名前后端统一。

**已知实现注意点**：
- `_activate_provider` 用 `from .agent import reset_agent`（依赖 `__init__.py` re-export）；若失败改 `from .agent.agent import reset_agent`（Step 3 已注明）。
- 测试用 `monkeypatch.setattr(config, "CONFIG_PATH", ...)` 隔离，避免污染真实 `apps/api/config/agent.json`。
