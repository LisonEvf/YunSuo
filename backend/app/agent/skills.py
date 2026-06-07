"""Skill 注册与加载 —— 复刻 hermes-agent 的 skill 模式。

Skill 本质是一段 markdown 指令，通过 frontmatter 声明元数据，
按需注入到 agent 对话中，引导 agent 按特定框架进行分析。

存储：
  backend/skills/<skill-name>/SKILL.md

SKILL.md 格式：
  ---
  name: skill-name
  description: 一行描述
  ---
  正文（markdown 指令）
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SKILLS_DIR = PROJECT_ROOT / "skills"
SKILL_USAGE_PATH = PROJECT_ROOT / "data" / "skill_usage.json"

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
_HEADING_RE = re.compile(r"^#{1,6}\s+(.+)$", re.MULTILINE)
_ASCII_WORD_RE = re.compile(r"[a-z0-9][a-z0-9_-]{1,}", re.IGNORECASE)
_STOCK_CODE_RE = re.compile(r"\b(?:00|30|60|68|83|87)\d{4}\b")

# TTL 缓存，避免每次调用 scan_skills 都遍历磁盘
_SCAN_CACHE: tuple[float, dict[str, dict[str, Any]]] = (0.0, {})
_SCAN_CACHE_TTL = 60.0
_USAGE_LOCK = threading.Lock()

_KEYWORD_HINTS: dict[str, tuple[str, ...]] = {
    "market-analysis": (
        "市场", "情绪", "行情", "周期", "涨停", "跌停", "赚钱效应", "封板", "炸板", "大盘", "全景",
    ),
    "plate-rotation": (
        "板块", "题材", "主线", "轮动", "热点", "概念", "资金迁移", "方向", "切换", "接力",
    ),
    "position-advice": (
        "仓位", "几成", "加仓", "减仓", "空仓", "满仓", "持仓", "配置", "仓控", "轻仓", "重仓",
    ),
    "risk-control": (
        "风险", "风控", "止损", "回撤", "亏损", "离场", "防守", "高风险", "纪律", "排雷",
    ),
    "stock-research": (
        "个股", "股票", "代码", "标的", "龙头", "k线", "K线", "走势", "支撑位", "压力位", "龙虎榜",
    ),
    "trade-plan": (
        "计划", "交易计划", "明日", "明天", "买点", "卖点", "止盈", "竞价", "预案", "清单", "执行",
    ),
}


def _parse_frontmatter(content: str) -> tuple[dict[str, str], str]:
    m = _FRONTMATTER_RE.match(content)
    if not m:
        return {}, content
    meta: dict[str, str] = {}
    for line in m.group(1).strip().splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            meta[key.strip()] = value.strip()
    body = content[m.end():]
    return meta, body


def _normalize_slug(value: str) -> str:
    slug = value.strip().lstrip("/").lower().replace(" ", "-").replace("_", "-")
    return re.sub(r"[^a-z0-9一-鿿-]", "", slug).strip("-")


def _build_search_text(name: str, description: str, body: str) -> str:
    headings = " ".join(match.group(1) for match in _HEADING_RE.finditer(body))
    sample = body[:1200]
    return f"{name} {description} {headings} {sample}".lower()


def scan_skills() -> dict[str, dict[str, Any]]:
    """扫描 skills 目录，返回 {"/slug": info} 映射。带 TTL 缓存。"""
    global _SCAN_CACHE
    now = time.time()
    if now - _SCAN_CACHE[0] < _SCAN_CACHE_TTL:
        return _SCAN_CACHE[1]

    skills: dict[str, dict[str, Any]] = {}
    if not SKILLS_DIR.exists():
        _SCAN_CACHE = (now, skills)
        return skills

    for skill_md in sorted(SKILLS_DIR.rglob("SKILL.md")):
        try:
            content = skill_md.read_text(encoding="utf-8")
            meta, body = _parse_frontmatter(content)
            name = meta.get("name", skill_md.parent.name)
            slug = _normalize_slug(name)
            if not slug:
                continue
            description = meta.get("description", "")
            if not description:
                for line in body.strip().splitlines():
                    line = line.strip()
                    if line and not line.startswith("#"):
                        description = line[:100]
                        break
            skills[f"/{slug}"] = {
                "name": name,
                "slug": slug,
                "description": description,
                "skill_dir": str(skill_md.parent),
                "skill_md_path": str(skill_md),
                "search_text": _build_search_text(name, description, body),
            }
        except Exception as exc:
            logger.warning("Failed to load skill %s: %s", skill_md, exc)

    _SCAN_CACHE = (now, skills)
    return skills


def load_skill(slug: str) -> str | None:
    """加载 skill 内容，返回完整 markdown 正文。不包含 frontmatter。"""
    info = scan_skills().get(f"/{slug}")
    if not info:
        return None
    try:
        content = Path(info["skill_md_path"]).read_text(encoding="utf-8")
        _, body = _parse_frontmatter(content)
        return body.strip()
    except Exception:
        return None


def build_skill_prompt(slug: str) -> str | None:
    """构建 skill 注入文本（复刻 hermes-agent 的 activation note 模式）。"""
    body = load_skill(slug)
    if not body:
        return None
    info = scan_skills().get(f"/{slug}", {})
    name = info.get("name", slug)
    return (
        f'[IMPORTANT: 用户激活了 "{name}" 技能，请严格遵循以下指令框架进行分析。]\n\n'
        f"{body}"
    )


def select_relevant_skills(
    user_message: str,
    explicit_skills: list[str] | None = None,
    *,
    limit: int = 2,
    auto_fill: bool = True,
) -> list[dict[str, Any]]:
    """Select skills for a turn.

    Explicit skills are always kept. Auto selection only fills remaining slots
    when ``auto_fill`` is true, so callers can preserve manual-only behaviour.
    """
    available = scan_skills()
    selected: list[dict[str, Any]] = []
    selected_slugs: set[str] = set()

    for raw_slug in explicit_skills or []:
        slug = _normalize_slug(raw_slug)
        if not slug or slug in selected_slugs:
            continue
        info = available.get(f"/{slug}")
        if not info:
            continue
        selected.append(_selection_entry(info, source="explicit", score=None))
        selected_slugs.add(slug)

    remaining = max(limit - len(selected), 0)
    if not auto_fill or remaining <= 0:
        return selected

    scored: list[tuple[float, dict[str, Any]]] = []
    for info in available.values():
        slug = str(info.get("slug") or "")
        if slug in selected_slugs:
            continue
        score = _score_skill(user_message, info)
        if score > 0:
            scored.append((score, info))

    scored.sort(key=lambda item: (-item[0], str(item[1].get("slug") or "")))
    for score, info in scored[:remaining]:
        selected.append(_selection_entry(info, source="auto", score=score))
    return selected


def record_skill_usage(
    selected_skills: list[dict[str, Any]],
    *,
    usage_path: Path = SKILL_USAGE_PATH,
) -> None:
    """Persist lightweight skill usage counters for curator/eval readiness."""
    if not selected_skills:
        return

    now = datetime.now(timezone.utc).isoformat()
    with _USAGE_LOCK:
        data = load_skill_usage(usage_path=usage_path)
        usage = data.setdefault("skills", {})
        for selected in selected_skills:
            slug = str(selected.get("slug") or "")
            if not slug:
                continue
            source = str(selected.get("source") or "unknown")
            entry = usage.setdefault(slug, {})
            entry["name"] = selected.get("name") or slug
            entry["selected_count"] = int(entry.get("selected_count", 0)) + 1
            entry["viewed_count"] = int(entry.get("viewed_count", 0)) + 1
            entry["applied_count"] = int(entry.get("applied_count", 0)) + 1
            if source == "explicit":
                entry["explicit_count"] = int(entry.get("explicit_count", 0)) + 1
            elif source == "auto":
                entry["auto_count"] = int(entry.get("auto_count", 0)) + 1
            entry["last_source"] = source
            entry["last_score"] = selected.get("score")
            entry["last_used_at"] = now

        usage_path.parent.mkdir(parents=True, exist_ok=True)
        usage_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )


def load_skill_usage(*, usage_path: Path = SKILL_USAGE_PATH) -> dict[str, Any]:
    if not usage_path.exists():
        return {"version": 1, "skills": {}}
    try:
        data = json.loads(usage_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"version": 1, "skills": {}}
    if not isinstance(data, dict):
        return {"version": 1, "skills": {}}
    data.setdefault("version", 1)
    skills = data.setdefault("skills", {})
    if not isinstance(skills, dict):
        data["skills"] = {}
    return data


def curate_skills(
    *,
    usage_path: Path = SKILL_USAGE_PATH,
    stale_days: int = 30,
    duplicate_threshold: float = 0.60,
    dry_run: bool = True,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Return deterministic curator suggestions without mutating skill files."""
    checked_at = now or datetime.now(timezone.utc)
    usage = load_skill_usage(usage_path=usage_path).get("skills", {})
    skills = scan_skills()
    suggestions: list[dict[str, Any]] = []

    for info in sorted(skills.values(), key=lambda item: str(item.get("slug") or "")):
        slug = str(info.get("slug") or "")
        stats = usage.get(slug, {}) if isinstance(usage, dict) else {}
        last_used_at = stats.get("last_used_at") if isinstance(stats, dict) else None
        selected_count = int(stats.get("selected_count", 0)) if isinstance(stats, dict) else 0
        last_used = _parse_datetime(last_used_at)
        if not last_used:
            suggestions.append({
                "type": "unused",
                "slug": slug,
                "action": "review_or_keep",
                "reason": "Skill has no recorded usage yet.",
            })
            continue
        age_days = (checked_at - last_used).days
        if age_days >= stale_days:
            suggestions.append({
                "type": "stale",
                "slug": slug,
                "action": "review_or_refresh",
                "reason": f"Skill has not been selected for {age_days} days.",
                "selected_count": selected_count,
            })

    duplicate_suggestions = _find_duplicate_skill_suggestions(skills, duplicate_threshold)
    suggestions.extend(duplicate_suggestions)
    return {
        "dry_run": dry_run,
        "checked_at": checked_at.isoformat(),
        "checked_skills": len(skills),
        "usage_path": str(usage_path),
        "suggestions": suggestions,
    }


def _selection_entry(info: dict[str, Any], *, source: str, score: float | None) -> dict[str, Any]:
    return {
        "slug": info["slug"],
        "name": info["name"],
        "description": info.get("description", ""),
        "source": source,
        "score": score,
    }


def _score_skill(user_message: str, info: dict[str, Any]) -> float:
    query = (user_message or "").lower()
    if not query:
        return 0.0

    slug = str(info.get("slug") or "")
    name = str(info.get("name") or "").lower()
    search_text = str(info.get("search_text") or "")
    score = 0.0

    if slug and slug in query:
        score += 10.0
    if name and name != slug and name in query:
        score += 8.0

    for keyword in _KEYWORD_HINTS.get(slug, ()):
        needle = keyword.lower()
        if needle and needle in query:
            score += 4.0 if len(needle) > 1 else 2.0

    if slug == "stock-research" and _STOCK_CODE_RE.search(query):
        score += 8.0

    for word in set(_ASCII_WORD_RE.findall(query)):
        if len(word) >= 3 and word in search_text:
            score += 1.5

    return score


def _parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _find_duplicate_skill_suggestions(
    skills: dict[str, dict[str, Any]],
    duplicate_threshold: float,
) -> list[dict[str, Any]]:
    suggestions: list[dict[str, Any]] = []
    items = sorted(skills.values(), key=lambda item: str(item.get("slug") or ""))
    terms = {str(item.get("slug") or ""): _skill_terms(item) for item in items}
    for idx, left in enumerate(items):
        left_slug = str(left.get("slug") or "")
        left_terms = terms[left_slug]
        if not left_terms:
            continue
        for right in items[idx + 1:]:
            right_slug = str(right.get("slug") or "")
            right_terms = terms[right_slug]
            if not right_terms:
                continue
            overlap = len(left_terms & right_terms) / len(left_terms | right_terms)
            if overlap >= duplicate_threshold:
                suggestions.append({
                    "type": "possible_duplicate",
                    "slugs": [left_slug, right_slug],
                    "action": "review_merge_or_split",
                    "similarity": round(overlap, 3),
                    "reason": "Skills share a high proportion of routing terms.",
                })
    return suggestions


def _skill_terms(info: dict[str, Any]) -> set[str]:
    slug = str(info.get("slug") or "")
    text = f"{slug} {info.get('name', '')} {info.get('description', '')} {info.get('search_text', '')}".lower()
    terms = {word for word in _ASCII_WORD_RE.findall(text) if len(word) >= 3}
    terms.update(keyword.lower() for keyword in _KEYWORD_HINTS.get(slug, ()))
    return terms


def list_skills() -> list[dict[str, str]]:
    """返回可用的 skill 列表。"""
    return [
        {"slug": info["slug"], "name": info["name"], "description": info["description"]}
        for _, info in sorted(scan_skills().items())
    ]
