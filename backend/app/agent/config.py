from __future__ import annotations

import os

LLM_API_KEY: str = os.getenv("LLM_API_KEY", "llamacpp")
LLM_BASE_URL: str = os.getenv("LLM_BASE_URL", "http://127.0.0.1:11232/v1")
LLM_MODEL: str = os.getenv("LLM_MODEL", "deepseek-chat")
LLM_MAX_TOKENS: int = int(os.getenv("LLM_MAX_TOKENS", "4096"))
AGENT_MAX_ITERATIONS: int = int(os.getenv("AGENT_MAX_ITERATIONS", "12"))
RETRY_MAX_ATTEMPTS: int = int(os.getenv("RETRY_MAX_ATTEMPTS", "3"))
CONTEXT_WINDOW_TOKENS: int = int(os.getenv("CONTEXT_WINDOW_TOKENS", "32000"))
