"""面板与流程数据模型 —— 生成式 UI「客制化专属 SaaS」的基石。

设计参见 docs/generative-ui-agent-design.md §6「面板与流程：用户能力的分层」。

概念：
- Panel（面板）= 可复用的起手屏。一个 starter_prompt 让 agent 渲染首屏，
  随后的点击意图循环（intent.py + agent loop）接管"点击 → 下一屏"。
  可选 seed_intent 预填默认意图/参数，domain/tags 用于组织与检索。
- Flow（流程）= 把多个面板/提示编排成"一键流"的脚本路径。
  steps 是有序列表，每步引用一个 panel_id 或内联 prompt。

存储：SQLite（data/panels.db），线程局部连接 + WAL，镜像 memory.py 模式。
"""
from __future__ import annotations

import json
import logging
import sqlite3
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).resolve().parents[4] / "data" / "panels.db"
_local = threading.local()


def _get_conn() -> sqlite3.Connection:
    if not hasattr(_local, "conn") or _local.conn is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _local.conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        _local.conn.execute("PRAGMA journal_mode=WAL")
        _local.conn.row_factory = sqlite3.Row
    return _local.conn


def _init_db() -> None:
    conn = _get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS panels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            starter_prompt TEXT NOT NULL,
            seed_intent TEXT DEFAULT '',
            domain TEXT DEFAULT '',
            tags TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_panels_domain ON panels(domain)")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS flows (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            steps TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.commit()


def _migrate() -> None:
    """幂等 schema 升级：is_builtin / mcp_tools 列（旧库升级用）。"""
    conn = _get_conn()
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(panels)").fetchall()}
    if "is_builtin" not in cols:
        conn.execute("ALTER TABLE panels ADD COLUMN is_builtin INTEGER DEFAULT 0")
    if "mcp_tools" not in cols:
        conn.execute("ALTER TABLE panels ADD COLUMN mcp_tools TEXT DEFAULT ''")
    conn.commit()


# ── 内置预设面板库（系统为常见领域预置，见设计文档 §6）───────────────

# 内置预设定义：name 作为去重键（同 name 的内置面板不重复创建）。
# 每个 starter_prompt 让 agent 渲染起手屏，随后的点击意图循环接管。
BUILTIN_PANELS: list[dict[str, Any]] = [
    {
        "name": "运营看板",
        "description": "KPI、趋势与明细一屏概览",
        "starter_prompt": "用 KPI 行、趋势图与数据表格生成一个运营概览面板",
        "domain": "general",
        "tags": ["运营", "概览"],
    },
    {
        "name": "周报复盘",
        "description": "本周进展、问题与下周计划",
        "starter_prompt": "起草一份周报复盘：本周进展、遇到的问题、下周计划，用清单和表格呈现",
        "domain": "general",
        "tags": ["复盘", "写作"],
    },
    {
        "name": "数据探索",
        "description": "查询并下钻分析数据",
        "starter_prompt": "提供一个数据探索面板：先给查询入口与常见维度，再根据我的点击下钻",
        "domain": "data",
        "tags": ["数据", "分析"],
    },
    {
        "name": "方案对比",
        "description": "多选项横向对比决策",
        "starter_prompt": "生成一个方案对比面板：选项维度对比表 + 推荐结论，附可下钻的详情",
        "domain": "general",
        "tags": ["决策", "对比"],
    },
]


def seed_builtin_panels(force: bool = False) -> int:
    """幂等种子化内置预设面板。返回新增条数。

    以 name + is_builtin=1 作为去重键：已存在则跳过（除非 force=True 强制刷新）。
   在 lifespan 启动钩子调用一次，保证外行用户首次进入即见合理选项。
   """
    _init_db()
    _migrate()
    conn = _get_conn()
    added = 0
    for spec in BUILTIN_PANELS:
        existing = conn.execute(
            "SELECT id FROM panels WHERE name = ? AND is_builtin = 1",
            (spec["name"],),
        ).fetchone()
        if existing and not force:
            continue
        now = datetime.now().isoformat()
        if existing and force:
            conn.execute(
                "UPDATE panels SET description = ?, starter_prompt = ?, domain = ?, tags = ?, updated_at = ? WHERE id = ?",
                (spec["description"], spec["starter_prompt"], spec["domain"],
                 json.dumps(spec.get("tags", []), ensure_ascii=False), now, existing["id"]),
            )
            continue
        conn.execute(
            """INSERT INTO panels (name, description, starter_prompt, seed_intent, domain, tags, created_at, updated_at, is_builtin)
               VALUES (?, ?, ?, '', ?, ?, ?, ?, 1)""",
            (spec["name"], spec["description"], spec["starter_prompt"],
             spec["domain"], json.dumps(spec.get("tags", []), ensure_ascii=False), now, now),
        )
        added += 1
    conn.commit()
    return added


# ── Panel CRUD ────────────────────────────────────────────────

def create_panel(
    *,
    name: str,
    starter_prompt: str,
    description: str = "",
    seed_intent: dict[str, Any] | None = None,
    domain: str = "",
    tags: list[str] | None = None,
    mcp_tools: list[str] | None = None,
) -> dict[str, Any]:
    _init_db()
    _migrate()
    now = datetime.now().isoformat()
    conn = _get_conn()
    cursor = conn.execute(
        """INSERT INTO panels (name, description, starter_prompt, seed_intent, domain, tags, mcp_tools, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            name,
            description,
            starter_prompt,
            json.dumps(seed_intent or {}, ensure_ascii=False) if seed_intent else "",
            domain,
            json.dumps(tags or [], ensure_ascii=False),
            json.dumps(mcp_tools or [], ensure_ascii=False),
            now,
            now,
        ),
    )
    conn.commit()
    return get_panel(cursor.lastrowid)  # type: ignore[arg-type]


def get_panel(panel_id: int) -> dict[str, Any] | None:
    _init_db()
    conn = _get_conn()
    row = conn.execute("SELECT * FROM panels WHERE id = ?", (panel_id,)).fetchone()
    return _row_to_panel(row) if row else None


def list_panels(domain: str | None = None) -> list[dict[str, Any]]:
    _init_db()
    _migrate()
    conn = _get_conn()
    if domain:
        rows = conn.execute(
            "SELECT * FROM panels WHERE domain = ? ORDER BY is_builtin DESC, updated_at DESC", (domain,)
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM panels ORDER BY is_builtin DESC, updated_at DESC").fetchall()
    return [_row_to_panel(r) for r in rows]


def list_panels_filtered(
    *,
    builtin: bool | None = None,
    domain: str | None = None,
) -> list[dict[str, Any]]:
    """列出面板，可按 builtin / domain 过滤。builtin=None 返回全部（内置在前）。"""
    _init_db()
    _migrate()
    conn = _get_conn()
    conditions: list[str] = []
    params: list[Any] = []
    if builtin is not None:
        conditions.append("is_builtin = ?")
        params.append(1 if builtin else 0)
    if domain:
        conditions.append("domain = ?")
        params.append(domain)
    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""
    rows = conn.execute(
        f"SELECT * FROM panels{where} ORDER BY is_builtin DESC, updated_at DESC", params
    ).fetchall()
    return [_row_to_panel(r) for r in rows]


def update_panel(panel_id: int, **fields: Any) -> dict[str, Any] | None:
    _init_db()
    conn = _get_conn()
    allowed = {"name", "description", "starter_prompt", "seed_intent", "domain", "tags"}
    updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not updates:
        return get_panel(panel_id)
    # 序列化 JSON 字段
    if "seed_intent" in updates and isinstance(updates["seed_intent"], dict):
        updates["seed_intent"] = json.dumps(updates["seed_intent"], ensure_ascii=False)
    if "tags" in updates and isinstance(updates["tags"], list):
        updates["tags"] = json.dumps(updates["tags"], ensure_ascii=False)
    updates["updated_at"] = datetime.now().isoformat()
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    params = list(updates.values()) + [panel_id]
    conn.execute(f"UPDATE panels SET {set_clause} WHERE id = ?", params)
    conn.commit()
    return get_panel(panel_id)


def delete_panel(panel_id: int) -> bool:
    _init_db()
    conn = _get_conn()
    # 内置预设面板受保护，不可删除（外行用户的兜底选项不能被误删）
    _migrate()
    row = conn.execute("SELECT is_builtin FROM panels WHERE id = ?", (panel_id,)).fetchone()
    if row and row["is_builtin"]:
        return False
    cursor = conn.execute("DELETE FROM panels WHERE id = ?", (panel_id,))
    conn.commit()
    return cursor.rowcount > 0


def _row_to_panel(row: sqlite3.Row) -> dict[str, Any]:
    seed = row["seed_intent"]
    tags = row["tags"]
    mcp_tools_raw = row["mcp_tools"] if "mcp_tools" in row.keys() else ""
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "starter_prompt": row["starter_prompt"],
        "seed_intent": json.loads(seed) if seed else {},
        "domain": row["domain"],
        "tags": json.loads(tags) if tags else [],
        "is_builtin": bool(row["is_builtin"]) if "is_builtin" in row.keys() else False,
        "mcp_tools": json.loads(mcp_tools_raw) if mcp_tools_raw else [],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


# ── Flow CRUD ─────────────────────────────────────────────────
# flow steps 形如 [{"label": "...", "panel_id": 1}, {"label": "...", "prompt": "..."}]

def create_flow(
    *,
    name: str,
    steps: list[dict[str, Any]] | None = None,
    description: str = "",
) -> dict[str, Any]:
    _init_db()
    now = datetime.now().isoformat()
    conn = _get_conn()
    cursor = conn.execute(
        """INSERT INTO flows (name, description, steps, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)""",
        (name, description, json.dumps(steps or [], ensure_ascii=False), now, now),
    )
    conn.commit()
    return get_flow(cursor.lastrowid)  # type: ignore[arg-type]


def get_flow(flow_id: int) -> dict[str, Any] | None:
    _init_db()
    conn = _get_conn()
    row = conn.execute("SELECT * FROM flows WHERE id = ?", (flow_id,)).fetchone()
    return _row_to_flow(row) if row else None


def list_flows() -> list[dict[str, Any]]:
    _init_db()
    conn = _get_conn()
    rows = conn.execute("SELECT * FROM flows ORDER BY updated_at DESC").fetchall()
    return [_row_to_flow(r) for r in rows]


def delete_flow(flow_id: int) -> bool:
    _init_db()
    conn = _get_conn()
    cursor = conn.execute("DELETE FROM flows WHERE id = ?", (flow_id,))
    conn.commit()
    return cursor.rowcount > 0


def _row_to_flow(row: sqlite3.Row) -> dict[str, Any]:
    steps = row["steps"]
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "steps": json.loads(steps) if steps else [],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


# 初始化表结构（模块导入即建表，与 memory.py 一致）
_init_db()
_migrate()
