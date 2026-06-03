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

import logging
import re
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

SKILLS_DIR = Path(__file__).resolve().parents[3] / "skills"

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)

# TTL 缓存，避免每次调用 scan_skills 都遍历磁盘
_SCAN_CACHE: tuple[float, dict[str, dict[str, Any]]] = (0.0, {})
_SCAN_CACHE_TTL = 60.0


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
            slug = name.lower().replace(" ", "-").replace("_", "-")
            slug = re.sub(r"[^a-z0-9一-鿿-]", "", slug).strip("-")
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


def list_skills() -> list[dict[str, str]]:
    """返回可用的 skill 列表。"""
    return [
        {"slug": info["slug"], "name": info["name"], "description": info["description"]}
        for _, info in sorted(scan_skills().items())
    ]
