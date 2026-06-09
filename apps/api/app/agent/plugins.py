"""Plugin marketplace：拉取用户配置的市场源清单 + git clone 安装/卸载。

插件仍为发现层（执行系统未实现），marketplace 只负责浏览 + 把插件目录落到
plugins.search_paths，使 list_plugins 能发现它。
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import urllib.request
from pathlib import Path

from . import config

# 插件名只允许安全字符，防路径遍历
_NAME_RE = re.compile(r"[A-Za-z0-9_\-]+")


def _project_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _resolve_install_base() -> Path | None:
    """返回第一个 search_path 解析后的目录（不存在则创建）。"""
    cfg = config.AGENT_CONFIG.get("plugins", {}) or {}
    paths = cfg.get("search_paths") or []
    if not paths:
        return None
    sp = Path(paths[0])
    base = sp if sp.is_absolute() else _project_root() / sp
    base.mkdir(parents=True, exist_ok=True)
    return base


def _installed_names() -> set[str]:
    from .config import list_plugins

    return {p["name"] for p in list_plugins()}


def fetch_marketplaces() -> dict:
    """拉取所有 enabled marketplace 源清单，合并去重并标注安装状态。

    返回 {marketplaces:[{id,name,url,ok,error?}], plugins:[{...源字段, installed, source_id}]}。
    单个源失败不阻断其他源。
    """
    cfg = config.AGENT_CONFIG.get("plugins", {}) or {}
    sources = cfg.get("marketplaces") or []
    installed = _installed_names()
    sources_meta: list[dict] = []
    merged: dict[str, dict] = {}  # by plugin name 去重

    for src in sources:
        if not isinstance(src, dict) or src.get("enabled") is False:
            continue
        sid = str(src.get("id") or src.get("url") or "")
        sname = str(src.get("name") or sid)
        url = str(src.get("url") or "")
        if not url:
            continue
        try:
            with urllib.request.urlopen(url, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            plugins = data.get("plugins") if isinstance(data, dict) else data
            if not isinstance(plugins, list):
                plugins = []
            for p in plugins:
                if not isinstance(p, dict):
                    continue
                pname = str(p.get("name") or "").strip()
                if not pname:
                    continue
                merged[pname] = {
                    "name": pname,
                    "description": str(p.get("description") or ""),
                    "author": str(p.get("author") or ""),
                    "version": str(p.get("version") or ""),
                    "category": str(p.get("category") or ""),
                    "source": str(p.get("source") or ""),
                    "iconColor": str(p.get("iconColor") or "#8B8F98"),
                    "installed": pname in installed,
                    "source_id": sid,
                }
            sources_meta.append({"id": sid, "name": sname, "url": url, "ok": True})
        except Exception as exc:
            sources_meta.append({"id": sid, "name": sname, "url": url, "ok": False, "error": str(exc)})

    return {"marketplaces": sources_meta, "plugins": list(merged.values())}


def install(source: str, name: str) -> dict:
    """git clone source（浅克隆）到 search_paths[0]/{name}。"""
    if not source or not name:
        return {"ok": False, "error": "source and name required"}
    if not _NAME_RE.fullmatch(name):
        return {"ok": False, "error": "invalid plugin name (only A-Z 0-9 _ - allowed)"}
    base = _resolve_install_base()
    if base is None:
        return {"ok": False, "error": "plugins.search_paths 未配置"}
    dest = base / name
    if dest.exists():
        return {"ok": False, "error": f"plugin '{name}' already exists"}
    try:
        subprocess.run(
            ["git", "clone", "--depth", "1", source, str(dest)],
            capture_output=True,
            timeout=120,
            check=True,
        )
    except subprocess.CalledProcessError as exc:
        if dest.exists():
            shutil.rmtree(dest, ignore_errors=True)
        err = (exc.stderr or b"").decode("utf-8", errors="replace").strip()
        return {"ok": False, "error": f"git clone failed: {err}"}
    except subprocess.TimeoutExpired:
        if dest.exists():
            shutil.rmtree(dest, ignore_errors=True)
        return {"ok": False, "error": "git clone timeout"}
    except FileNotFoundError:
        return {"ok": False, "error": "git not installed on server"}
    try:
        rel = str(dest.relative_to(_project_root()))
    except ValueError:
        rel = str(dest)
    return {"ok": True, "name": name, "path": rel}


def uninstall(name: str) -> dict:
    """从所有 search_paths 查找并删除插件目录 {name}。"""
    if not name:
        return {"ok": False, "error": "name required"}
    if not _NAME_RE.fullmatch(name):
        return {"ok": False, "error": "invalid plugin name"}
    cfg = config.AGENT_CONFIG.get("plugins", {}) or {}
    paths = cfg.get("search_paths") or []
    root = _project_root()
    removed: list[str] = []
    for p in paths:
        sp = Path(p)
        base = sp if sp.is_absolute() else root / sp
        target = base / name
        if target.is_dir():
            shutil.rmtree(target, ignore_errors=True)
            removed.append(str(target))
    if not removed:
        return {"ok": False, "error": f"plugin '{name}' not found in any search_path"}
    return {"ok": True, "name": name, "removed": removed}
