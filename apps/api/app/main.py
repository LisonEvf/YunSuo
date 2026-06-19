from __future__ import annotations

import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .airui.renderer import render_console
from .airui.session import session_manager
from .airui.ws_bridge import register_ws_routes
from .home_widgets import resolve_widgets

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    sess = session_manager.get_or_create("default")
    if not sess.doc:
        sess.doc = render_console()
    yield


app = FastAPI(title="Yunsuo API", version="1.0.0", lifespan=lifespan)

_allowed_env = os.environ.get("ALLOWED_ORIGINS", "").strip()
_allowed_origins = [o.strip() for o in _allowed_env.split(",") if o.strip()] or [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_ws_routes(app)

_static_dir = Path(__file__).resolve().parent.parent / "static" / "airui"
if _static_dir.exists():
    app.mount("/console", StaticFiles(directory=str(_static_dir), html=True), name="console-static")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "yunsuo",
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


class HomeWidgetsRequest(BaseModel):
    widgets: list[dict]


@app.post("/api/chat")
async def chat(req: ChatRequest):
    """General agent chat endpoint with optional streaming and skill activation."""
    # DEV-ONLY deterministic multi-card stream (YUNSUO_DEMO_CHAT=1). Emits the
    # enriched `airui` events the real agent produces, so the frontend
    # multi-card pipeline can be verified without a configured LLM.
    if os.environ.get("YUNSUO_DEMO_CHAT") == "1" and req.stream:
        return _demo_multi_card_stream()
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
    from .agent.config import load_agent_config, get_merged_presets, get_merged_domain_templates

    cfg = load_agent_config()
    cfg["provider_presets"] = get_merged_presets(cfg)
    cfg["domain_templates"] = get_merged_domain_templates(cfg)
    return {"config": cfg}


@app.put("/api/config")
def update_config(req: ConfigRequest):
    from .agent import reset_agent
    from .agent.config import save_agent_config

    config = save_agent_config(req.config)
    reset_agent()
    return {"ok": True, "config": config}


class ModelListRequest(BaseModel):
    base_url: str
    api_key: str
    provider: str = "openai"


@app.post("/api/models")
async def list_models(req: ModelListRequest):
    """列出 provider 的可用模型（OpenAI 兼容 GET /v1/models）。"""
    from openai import AsyncOpenAI

    try:
        client = AsyncOpenAI(api_key=req.api_key, base_url=req.base_url)
        resp = await client.models.list()
        return {"models": sorted(m.id for m in resp.data)}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"获取模型列表失败：{exc}") from exc


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
        logger.warning("mcp reconnect: agent rebuild failed: %s", exc)
    return {"servers": _status()}


@app.post("/api/home/widgets")
def home_widgets(req: HomeWidgetsRequest):
    """Resolve live home widgets to AIRUI components backed by MCP tools.

    Each widget calls its MCP tool directly (no LLM) and is normalized into a
    Table/KPI/Text card, so a custom start page can show live data. Failures
    degrade per-widget to a text card instead of erroring the whole request.
    """
    return {"widgets": resolve_widgets(req.widgets)}


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



def _demo_multi_card_stream():
    """DEV-ONLY: stream three enriched airui panels (KPI row, sales table, trend chart)."""
    import json

    panels = [
        {
            "ref": "artifact-kpi", "title": "核心指标", "col_span": 12, "row_span": 1,
            "actions": [{"label": "详情", "prompt": "展开 KPI 详情", "variant": "primary"},
                        {"label": "导出", "prompt": "导出核心 KPI 数据"}],
            "content": {"type": "Row", "children": [
                {"type": "KPI", "props": {"label": "月度营收", "value": "¥1.28亿", "trend": "+12.4%"}},
                {"type": "KPI", "props": {"label": "活跃用户", "value": "86,420", "trend": "+5.1%"}},
                {"type": "KPI", "props": {"label": "新增订单", "value": "23,901", "trend": "+8.7%"}},
                {"type": "KPI", "props": {"label": "转化率", "value": "34.2%", "trend": "-1.2%"}},
            ]},
        },
        {
            "ref": "artifact-sales-table", "title": "区域销售明细", "col_span": 12, "row_span": 1,
            "actions": [{"label": "排序", "prompt": "按销售额降序排列"}, {"label": "筛选", "prompt": "筛选前十区域"}],
            "content": {"type": "Table", "props": {
                "columns": [{"key": "region", "label": "地区"}, {"key": "product", "label": "产品"},
                            {"key": "qty", "label": "销量"}, {"key": "revenue", "label": "营收(万)"},
                            {"key": "growth", "label": "增长"}],
                "data": [
                    {"region": "华东", "product": "云索 Pro", "qty": 4120, "revenue": 824, "growth": "+15%"},
                    {"region": "华北", "product": "云索 Lite", "qty": 3380, "revenue": 507, "growth": "+9%"},
                    {"region": "华南", "product": "数据中台", "qty": 1240, "revenue": 372, "growth": "+22%"},
                    {"region": "西南", "product": "云索 Pro", "qty": 980, "revenue": 196, "growth": "-3%"},
                    {"region": "华中", "product": "数据中台", "qty": 1560, "revenue": 468, "growth": "+11%"},
                ],
            }},
        },
        {
            "ref": "artifact-trend-chart", "title": "营收趋势", "col_span": 12, "row_span": 1,
            "actions": [{"label": "查看详情", "prompt": "展开月度趋势分析"}],
            "content": {"type": "Chart", "props": {"option": {
                "tooltip": {"trigger": "axis"}, "legend": {"data": ["营收"]},
                "xAxis": {"type": "category", "data": ["1月", "2月", "3月", "4月", "5月", "6月"]},
                "yAxis": {"type": "value", "name": "万元"},
                "series": [{"name": "营收", "type": "line", "smooth": True,
                            "data": [1820, 2010, 1980, 2240, 2380, 2510],
                            "areaStyle": {"opacity": 0.15}, "lineStyle": {"width": 3}}],
            }}},
        },
    ]

    async def _stream():
        yield "data: " + json.dumps({"type": "skills", "skills": []}) + "\n"
        yield "data: " + json.dumps({"type": "delta", "content": "已为您生成包含核心指标、区域销售明细和营收趋势的运营概览面板。"}) + "\n"
        yield "data: " + json.dumps({"type": "tool_start", "tools": [{"name": "render_airui_panel"} for _ in panels]}) + "\n"
        for p in panels:
            yield "data: " + json.dumps({"type": "tool_result", "name": "render_airui_panel",
                                         "result": json.dumps({"status": "rendered", "ref": p["ref"]})}) + "\n"
            yield "data: " + json.dumps({"type": "airui", "data": p}, ensure_ascii=False) + "\n"
        yield "data: " + json.dumps({"type": "done"}) + "\n"

    return StreamingResponse(_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


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
    return {"memories": memory_manager.recent(limit)}


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
