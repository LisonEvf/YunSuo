from __future__ import annotations

import json
import os
from copy import deepcopy
from pathlib import Path

CONFIG_PATH = Path(__file__).resolve().parents[2] / "config" / "agent.json"

DEFAULT_AGENT_CONFIG: dict = {
    "runtime": {
        "max_iterations": 12,
        "retry_max_attempts": 3,
        "context_window_tokens": 65536,
    },
    "model": {
        "provider": "llamacpp",
        "name": "Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf",
        "base_url": "http://192.168.31.57:11232/v1",
        "api_key": "llama",
        "max_output_tokens": 4096,
    },
    "ui": {
        "theme": "light",
        "language": "zh-CN",
    },
    "skills": {
        "enabled": True,
        # search_paths: 扫描 SKILL.md 的目录列表（相对项目根）
        "search_paths": ["packages/agent-skills"],
    },
    "mcp": {
        "enabled": True,
        # servers: 每项结构见 agent/mcp_client.py 文档
        #   {name, enabled, command+args(+env) | url(+transport?, headers?)}
        "servers": [],
    },
    "plugins": {
        "enabled": True,
        # search_paths: plugin 目录列表（发现层，执行系统待实现）
        "search_paths": [],
    },
}


def _deep_merge(base: dict, override: dict) -> dict:
    merged = deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def load_agent_config() -> dict:
    """Load project config, then apply environment-variable overrides."""
    loaded: dict = {}
    if CONFIG_PATH.exists():
        try:
            loaded = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            loaded = {}

    cfg = _deep_merge(DEFAULT_AGENT_CONFIG, loaded)
    model = cfg.setdefault("model", {})
    runtime = cfg.setdefault("runtime", {})

    model["api_key"] = os.getenv("LLM_API_KEY", model.get("api_key", "llama"))
    model["base_url"] = os.getenv("LLM_BASE_URL", model.get("base_url", ""))
    model["name"] = os.getenv("LLM_MODEL", model.get("name", ""))
    model["max_output_tokens"] = int(os.getenv("LLM_MAX_TOKENS", str(model.get("max_output_tokens", 4096))))
    runtime["max_iterations"] = int(os.getenv("AGENT_MAX_ITERATIONS", str(runtime.get("max_iterations", 12))))
    runtime["retry_max_attempts"] = int(os.getenv("RETRY_MAX_ATTEMPTS", str(runtime.get("retry_max_attempts", 3))))
    runtime["context_window_tokens"] = int(
        os.getenv("CONTEXT_WINDOW_TOKENS", str(runtime.get("context_window_tokens", 65536)))
    )
    return cfg


def save_agent_config(config: dict) -> dict:
    """Persist project config. Environment variables may still override it at runtime."""
    merged = _deep_merge(DEFAULT_AGENT_CONFIG, config)
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(
        json.dumps(merged, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return reload_config()


def reload_config() -> dict:
    """Reload module-level constants used by the Agent runtime."""
    cfg = load_agent_config()
    model = cfg["model"]
    runtime = cfg["runtime"]

    globals()["AGENT_CONFIG"] = cfg
    globals()["LLM_API_KEY"] = str(model.get("api_key", ""))
    globals()["LLM_BASE_URL"] = str(model.get("base_url", ""))
    globals()["LLM_MODEL"] = str(model.get("name", ""))
    globals()["LLM_MAX_TOKENS"] = int(model.get("max_output_tokens", 4096))
    globals()["AGENT_MAX_ITERATIONS"] = int(runtime.get("max_iterations", 12))
    globals()["RETRY_MAX_ATTEMPTS"] = int(runtime.get("retry_max_attempts", 3))
    globals()["CONTEXT_WINDOW_TOKENS"] = int(runtime.get("context_window_tokens", 65536))
    return cfg


AGENT_CONFIG = reload_config()


def list_plugins() -> list[dict]:
    """扫描 plugins.search_paths 下的直接子目录，返回 plugin 清单（发现层，不执行）。

    执行系统未实现，此处仅列出目录占位供前端能力感知。结构未定，按目录名识别。
    """
    project_root = Path(__file__).resolve().parents[4]
    cfg = AGENT_CONFIG.get("plugins", {}) or {}
    paths = cfg.get("search_paths") or []
    plugins: list[dict] = []
    for p in paths:
        sp = Path(p)
        base = sp if sp.is_absolute() else project_root / sp
        if not base.is_dir():
            continue
        for child in sorted(base.iterdir()):
            if not child.is_dir() or child.name.startswith("."):
                continue
            try:
                rel = str(child.relative_to(project_root))
            except ValueError:
                rel = str(child)
            plugins.append({"name": child.name, "path": rel})
    return plugins
