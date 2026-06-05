"""JSON Patch 操作 —— apply + diff 计算。"""
from __future__ import annotations

import copy
from typing import Any

import jsonpatch


def apply_patches(doc: dict[str, Any], patches: list[dict[str, Any]]) -> dict[str, Any]:
    """对文档应用 JSON Patch 操作，返回新文档（不修改原文档）。"""
    result = copy.deepcopy(doc)
    if not patches:
        return result
    return jsonpatch.apply_patch(result, patches)


def compute_patches(old: dict[str, Any], new: dict[str, Any]) -> list[dict[str, Any]]:
    """计算两个文档之间的 JSON Patch 差量。"""
    return jsonpatch.make_patch(old, new).patch
