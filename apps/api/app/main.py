from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="General Agent Client API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "general-agent-client",
        "capabilities": ["chat", "skills", "memory", "trajectories", "airui"],
    }


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    stream: bool = False
    skills: list[str] | None = None


class ConfigRequest(BaseModel):
    config: dict


@app.post("/api/chat")
async def chat(req: ChatRequest):
    """General agent chat endpoint with optional streaming and skill activation."""
    from .agent import get_agent

    try:
        agent = get_agent()
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    messages = [{"role": m.role, "content": m.content} for m in req.messages]

    if req.stream:
        return StreamingResponse(
            _sse_stream(agent, messages, skills=req.skills),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    return await agent.chat(messages, skills=req.skills)


@app.get("/api/config")
def get_config():
    from .agent.config import load_agent_config

    return {"config": load_agent_config()}


@app.put("/api/config")
def update_config(req: ConfigRequest):
    from .agent import reset_agent
    from .agent.config import save_agent_config

    config = save_agent_config(req.config)
    reset_agent()
    return {"ok": True, "config": config}


@app.get("/api/mcp/status")
def mcp_status():
    """实际连上的 MCP server + 发现的工具清单（能力感知）。"""
    from .agent.mcp_client import status as _status

    return {"servers": _status()}


@app.post("/api/mcp/reconnect")
def mcp_reconnect():
    """重连所有已保存的 enabled MCP server（用当前 config，非 draft 草稿）。

    重建 agent 触发 _load_tools → mcp_client.load_all，使新配置/断线 server 立即生效；
    返回最新连接状态。LLM 未配置等导致 agent 重建失败时不阻断，仍返回当前 status。
    """
    from .agent import reset_agent, get_agent
    from .agent.mcp_client import status as _status

    reset_agent()
    try:
        get_agent()
    except Exception as exc:
        logging.warning("mcp reconnect: agent rebuild failed: %s", exc)
    return {"servers": _status()}


@app.get("/api/plugins")
def plugins_list():
    """扫描 plugins.search_paths 发现的 plugin 目录（发现层，不执行）。"""
    from .agent.config import list_plugins

    return {"plugins": list_plugins()}


class PluginInstallRequest(BaseModel):
    source: str
    name: str


@app.get("/api/plugins/marketplace")
def plugins_marketplace():
    """合并所有 enabled marketplace 源的插件清单，标注每项安装状态。"""
    from .agent.plugins import fetch_marketplaces

    return fetch_marketplaces()


@app.post("/api/plugins/install")
def plugins_install(req: PluginInstallRequest):
    """git clone source 到 plugins.search_paths[0]/{name}（浅克隆，120s 超时）。"""
    from .agent.plugins import install

    return install(req.source, req.name)


@app.delete("/api/plugins/{name}")
def plugins_uninstall(name: str):
    """从所有 search_paths 删除已安装插件目录 {name}。"""
    from .agent.plugins import uninstall

    return uninstall(name)


async def _sse_stream(agent, messages: list[dict], skills: list[str] | None = None):
    async for event in agent.chat_stream(messages, skills=skills):
        yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


@app.get("/api/skills")
def list_skills():
    from .agent.skills import list_skills as _list

    return {"skills": _list()}


@app.get("/api/skills/curation")
def skill_curation():
    from .agent.skills import curate_skills

    return curate_skills(dry_run=True)


@app.get("/api/memory")
def list_memory(
    keyword: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
):
    from .agent.memory import memory_manager

    if keyword:
        return {"memories": memory_manager.search(keyword, limit=limit)}
    return {"memories": memory_manager._recent(limit)}


@app.get("/api/memory/stats")
def memory_stats():
    from .agent.memory import memory_manager

    return memory_manager.stats()


@app.delete("/api/memory/{memory_id}")
def delete_memory(memory_id: int):
    from .agent.memory import memory_manager

    if not memory_manager.delete(memory_id):
        raise HTTPException(status_code=404, detail="Memory entry not found")
    return {"ok": True}


@app.get("/api/usage")
def get_usage():
    from .agent import get_agent

    try:
        return get_agent().get_usage()
    except ValueError:
        return {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}


@app.get("/api/trajectories/summary")
def trajectory_summary():
    from .agent.trajectory import summarize_trajectories

    return summarize_trajectories()


from .airui.renderer import render_console
from .airui.session import session_manager
from .airui.ws_bridge import register_ws_routes

register_ws_routes(app)

_static_dir = Path(__file__).resolve().parent.parent / "static" / "airui"
if _static_dir.exists():
    app.mount("/console", StaticFiles(directory=str(_static_dir), html=True), name="console-static")


@app.on_event("startup")
async def _airui_console_init():
    """Initialize the default AIRUI session with a generic operations console."""
    sess = session_manager.get_or_create("default")
    if not sess.doc:
        sess.doc = render_console()
