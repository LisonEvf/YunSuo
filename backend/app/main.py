from __future__ import annotations

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .services import data_service


app = FastAPI(title="Sentiment Data API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return data_service.health()


@app.get("/api/dashboard")
def dashboard(day: str | None = Query(default=None, description="交易日，格式 YYYY-MM-DD")):
    return data_service.dashboard(day=day)


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
