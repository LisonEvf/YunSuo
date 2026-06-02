"""SQLite 历史趋势缓存 —— 避免每次 dashboard 都重新拉取 30 天历史。

缓存策略：
- 每个 (日期, 数据源) 为一个缓存行
- trend 每日数据一旦写入就不再更新（历史日不会变）
- 当天的数据不缓存（还在变化）
"""
from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[2] / "data" / "trend_cache.db"

_local = threading.local()


def _get_conn() -> sqlite3.Connection:
    if not hasattr(_local, "conn") or _local.conn is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS trend_cache (
                day TEXT NOT NULL,
                score REAL,
                limit_up INTEGER,
                limit_down INTEGER,
                amount REAL,
                seal_rate REAL,
                bomb_rate REAL,
                cycle TEXT,
                market_coef REAL,
                short_sentiment REAL,
                money_loss REAL,
                plates_json TEXT,
                PRIMARY KEY (day)
            )
        """)
        conn.commit()
        _local.conn = conn
    return _local.conn


def get_cached_days(days: list[str]) -> dict[str, dict]:
    """批量查询已缓存的历史日数据。"""
    conn = _get_conn()
    placeholders = ",".join("?" * len(days))
    rows = conn.execute(
        f"SELECT * FROM trend_cache WHERE day IN ({placeholders})", days
    ).fetchall()
    result = {}
    for row in rows:
        result[row[0]] = {
            "date": row[0],
            "score": row[1],
            "limit_up": row[2],
            "limit_down": row[3],
            "amount": row[4],
            "seal_rate": row[5],
            "bomb_rate": row[6],
            "cycle": row[7],
            "marketCoef": row[8],
            "shortSentiment": row[9],
            "moneyLoss": row[10],
            "plates": json.loads(row[11]) if row[11] else [],
        }
    return result


def save_trend_point(day: str, data: dict) -> None:
    """缓存一天的趋势数据（仅缓存非当天数据，历史日不会变）。"""
    conn = _get_conn()
    conn.execute(
        """INSERT OR REPLACE INTO trend_cache
           (day, score, limit_up, limit_down, amount, seal_rate, bomb_rate, cycle, market_coef, short_sentiment, money_loss, plates_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            day,
            data.get("score", 0),
            data.get("limit_up", 0),
            data.get("limit_down", 0),
            data.get("amount", 0),
            data.get("seal_rate", 0),
            data.get("bomb_rate", 0),
            data.get("cycle", ""),
            data.get("marketCoef", 0),
            data.get("shortSentiment", 0),
            data.get("moneyLoss", 0),
            json.dumps(data.get("plates", []), ensure_ascii=False),
        ),
    )
    conn.commit()
