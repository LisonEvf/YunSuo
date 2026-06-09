"""会话记忆 — SQLite 存储，关键词召回。

轻量版记忆管理器，聚焦通用 agent 协作场景：
- 记住用户偏好（沟通风格、输出格式、常用工作流、项目关注点）
- 自动从对话中提取用户偏好
- 在 system prompt 中注入相关记忆
"""
from __future__ import annotations

import logging
import re
import sqlite3
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).resolve().parents[4] / "data" / "memory.db"
_local = threading.local()


class MemoryManager:
    def __init__(self):
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        if not hasattr(_local, "conn") or _local.conn is None:
            DB_PATH.parent.mkdir(parents=True, exist_ok=True)
            _local.conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
            _local.conn.execute("PRAGMA journal_mode=WAL")
            _local.conn.row_factory = sqlite3.Row
        return _local.conn

    def _init_db(self):
        conn = self._get_conn()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                content TEXT NOT NULL,
                keywords TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                access_count INTEGER DEFAULT 0
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_mem_category ON memories(category)")
        conn.commit()

    def save(self, category: str, content: str, keywords: list[str] | None = None) -> int:
        if keywords is None:
            keywords = _extract_keywords(content)
        now = datetime.now().isoformat()
        conn = self._get_conn()
        cursor = conn.execute(
            "INSERT INTO memories (category, content, keywords, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (category, content, ",".join(keywords), now, now),
        )
        conn.commit()
        return cursor.lastrowid

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

    def recall(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        """基于关键词召回相关记忆。"""
        keywords = _extract_keywords(query)
        if not keywords:
            return self._recent(limit)

        conn = self._get_conn()
        conditions = " OR ".join(["keywords LIKE ?" for _ in keywords])
        params = [f"%{kw}%" for kw in keywords] + [limit]
        rows = conn.execute(
            f"SELECT * FROM memories WHERE {conditions} ORDER BY updated_at DESC LIMIT ?",
            params,
        ).fetchall()

        now = datetime.now().isoformat()
        for row in rows:
            conn.execute(
                "UPDATE memories SET access_count = access_count + 1, updated_at = ? WHERE id = ?",
                (now, row["id"]),
            )
        conn.commit()
        return [dict(row) for row in rows]

    def _recent(self, limit: int) -> list[dict[str, Any]]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT * FROM memories ORDER BY updated_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(row) for row in rows]

    def search(self, keyword: str, limit: int = 20) -> list[dict[str, Any]]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT * FROM memories WHERE content LIKE ? OR keywords LIKE ? ORDER BY updated_at DESC LIMIT ?",
            (f"%{keyword}%", f"%{keyword}%", limit),
        ).fetchall()
        return [dict(row) for row in rows]

    def delete(self, memory_id: int) -> bool:
        conn = self._get_conn()
        cursor = conn.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
        conn.commit()
        return cursor.rowcount > 0

    def clear(self, category: str | None = None) -> int:
        conn = self._get_conn()
        if category:
            cursor = conn.execute("DELETE FROM memories WHERE category = ?", (category,))
        else:
            cursor = conn.execute("DELETE FROM memories")
        conn.commit()
        return cursor.rowcount

    def build_context_block(self, user_message: str, limit: int = 5) -> str:
        """为 system prompt 构建记忆上下文块。"""
        memories = self.recall(user_message, limit=limit)
        if not memories:
            return ""
        parts = ["\n[用户记忆 — 以下是你之前保存的偏好和历史结论，仅作参考：]"]
        for m in memories:
            parts.append(f"- [{m['category']}] {m['content']}")
        return "\n".join(parts)

    def extract_and_save(self, user_msg: str, assistant_msg: str) -> list[int]:
        """从对话中提取用户偏好并保存。仅保存明确的偏好陈述，不过度提取。"""
        saved_ids: list[int] = []
        pref_patterns = [
            r"我[喜不]?[喜欢爱].{2,20}",
            r"我[一般通常总是从来不].{2,20}",
            r"(?:偏好|习惯|风格)[^。，？\n]{2,20}",
            r"我[的]?(?:项目|代码|文档|工作流|输出)[^。，？\n]{0,30}",
            r"关注.{1,8}(?:方向|模块|主题|领域|任务|风险|质量)",
            r"(?:简洁|详细|中文|英文|表格|清单|步骤|示例)[^。，？\n]{2,15}(?:为主|偏多|偏好)",
        ]
        seen: set[str] = set()
        for pattern in pref_patterns:
            for match in re.findall(pattern, user_msg):
                text = match.strip()
                if len(text) >= 4 and text not in seen:
                    seen.add(text)
                    sid = self.save("user_preference", text, _extract_keywords(text))
                    saved_ids.append(sid)
        if saved_ids:
            logger.info("Auto-saved %d memory entries", len(saved_ids))
        return saved_ids

    def stats(self) -> dict[str, Any]:
        conn = self._get_conn()
        total = conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
        by_cat = conn.execute(
            "SELECT category, COUNT(*) as cnt FROM memories GROUP BY category"
        ).fetchall()
        return {
            "total": total,
            "by_category": {row[0]: row[1] for row in by_cat},
        }


_STOPWORDS = frozenset({
    "的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都",
    "一", "这", "中", "大", "为", "上", "个", "到", "说", "们", "你",
    "他", "她", "它", "着", "也", "对", "要", "会", "那", "吗", "吧",
    "呢", "啊", "把", "被", "让", "给", "比", "从", "向", "过",
})


def _extract_keywords(text: str) -> list[str]:
    cleaned = re.sub(r'[^一-鿿\w\s]', ' ', text)
    words = cleaned.split()
    return [w for w in words if len(w) >= 2 and w not in _STOPWORDS][:5]


memory_manager = MemoryManager()
