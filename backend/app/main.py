from __future__ import annotations

import json
import logging

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .services import data_service

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Sentiment Data API", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── 数据接口 ─────────────────────────────────────────────────────

@app.get("/health")
def health():
    return data_service.health()


@app.get("/api/dashboard")
def dashboard(day: str | None = Query(default=None, description="交易日，格式 YYYY-MM-DD")):
    return data_service.dashboard(day=day)


@app.get("/api/dashboard/trend")
def dashboard_trend(
    days: int = Query(default=15, ge=1, le=60),
    day: str | None = Query(default=None, description="截止交易日 YYYY-MM-DD"),
):
    return {"trend": data_service.dashboard_trend(days=days, day=day)}


@app.get("/api/quotes")
def quotes(symbols: str = Query(default="SZ:000001,SH:600000")):
    try:
        parsed = [item.strip() for item in symbols.split(",") if item.strip()]
        return data_service.quotes(parsed)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/kline/{market}/{code}")
def kline(
    market: str,
    code: str,
    period: str = Query(default="DAILY"),
    count: int = Query(default=80, ge=1, le=800),
    adjust: str = Query(default="NONE"),
):
    try:
        return data_service.kline(market, code, period_name=period, count=count, adjust_name=adjust)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/boards")
def boards(count: int = Query(default=80, ge=1, le=300)):
    try:
        return data_service.boards(count=count)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/boards/{board}/members")
def board_members(board: str, count: int = Query(default=30, ge=1, le=120)):
    try:
        return data_service.board_members(board=board, count=count)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ── Agent 接口 ───────────────────────────────────────────────────


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    stream: bool = False
    skills: list[str] | None = None


@app.post("/api/chat")
async def chat(req: ChatRequest):
    """Agent 对话接口，支持流式和非流式，可激活 skill。"""
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

    result = await agent.chat(messages, skills=req.skills)
    return result


async def _sse_stream(agent, messages: list[dict], skills: list[str] | None = None):
    """SSE 流式输出。"""
    async for event in agent.chat_stream(messages, skills=skills):
        yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


# ── Skill 接口 ───────────────────────────────────────────────────


@app.get("/api/skills")
def list_skills():
    """列出所有可用的 skill。"""
    from .agent.skills import list_skills as _list
    return {"skills": _list()}


# ── 记忆接口 ─────────────────────────────────────────────────────


@app.get("/api/memory")
def list_memory(
    keyword: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
):
    """搜索或列出记忆条目。"""
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
        raise HTTPException(status_code=404, detail="记忆不存在")
    return {"ok": True}


# ── Token 用量接口 ───────────────────────────────────────────────


@app.get("/api/usage")
def get_usage():
    """获取当前 Agent 的 token 用量统计。"""
    from .agent import get_agent
    try:
        return get_agent().get_usage()
    except ValueError:
        return {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
