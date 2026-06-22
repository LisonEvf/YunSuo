"""Built-in domain templates (overlay-merge model, mirroring provider_presets).

A domain template bundles the three customization legs -- home starters,
system_prompt, and (optionally) MCP servers -- so a user can switch the
console into a specialized SaaS in one click instead of editing three
separate settings tabs.

Merge happens backend-side (single source of truth):
  built-in templates are the base, agent.json's `domain_templates` is the
  user overlay. User templates with a key absent from built-ins are appended.
  A user overlay with `hidden: true` hides the matching built-in.
"""
from __future__ import annotations

BUILTIN_DOMAIN_TEMPLATES: list[dict] = [
    {
        "key": "general",
        "name": "通用助手",
        "icon": "sparkles",
        "description": "无领域绑定的通用工作台：自由提问、渲染数据看板。适合作为起始默认形态。",
        "system_prompt": "",
        "home": {
            "enabled": True,
            "title": "能力感知工作台",
            "subtitle": "点击下方任一入口，agent 会拉取数据并渲染看板。对话仅在需要时辅助。",
            "starters": [
                {"label": "概览看板", "prompt": "渲染一个概览看板：列出已接入的工具/技能与可用动作", "variant": "primary"},
                {"label": "数据探查", "prompt": "拉取一份示例数据并渲染成表格，标注关键字段"},
            ],
        },
        "mcp": {"servers": []},
    },
    {
        "key": "stock-analyst",
        "name": "股市分析",
        "icon": "bolt",
        "description": "A 股研究助手：行情数据看板、个股分析、龙虎榜。回答须引用股票代码。",
        "system_prompt": "你是一个股市分析助手。回答时必须引用股票代码，例如 SH600519。",
        "home": {
            "enabled": True,
            "title": "股市研究台",
            "subtitle": "点击入口即可拉取行情数据并渲染分析看板。",
           "starters": [
              {"label": "大盘速览", "prompt": "渲染今日大盘概览看板：主要指数、涨跌家数、板块涨幅榜", "variant": "primary"},
               {"label": "情绪看板", "prompt": "渲染A股情绪看板：涨停/跌停/封板率/板块梯队/核心指数", "variant": "primary", "preset": "stock-sentiment"},
               {"label": "个股分析", "prompt": "对指定个股生成分析看板：K 线、资金流向、所属板块"},
               {"label": "龙虎榜", "prompt": "渲染今日龙虎榜数据：热门个股、机构与游资动向"},
           ],
           "widgets": [
               {
                   "ref": "home-idx", "title": "主要指数", "colSpan": 8, "kind": "table",
                   "tool": "mcp_tdx_get_index_overview",
                   "columns": ["code", "close", "diff", "up_count", "down_count"],
                   "actions": [{"label": "大盘分析", "prompt": "基于主要指数行情生成今日大盘分析看板", "variant": "primary"}],
               },
               {
                   "ref": "home-zt", "title": "今日涨停", "colSpan": 4, "kind": "kpi",
                   "tool": "mcp_kpl_emotion_today", "path": "DaBanList", "valueKey": "tZhangTing",
                   "actions": [{"label": "涨停复盘", "prompt": "渲染今日涨停复盘看板：连板梯队与封板率"}],
               },
               {
                   "ref": "home-down", "title": "下跌家数", "colSpan": 4, "kind": "kpi",
                   "tool": "mcp_kpl_emotion_today", "path": "DaBanList", "valueKey": "XDJS",
               },
           ],
       },
        "mcp": {"servers": [
            {"name": "kpl", "command": "bun",
             "args": ["c:\\Users\\Lison\\Desktop\\EvfWorkSpace\\STOCK\\TDX\\kpl-sdk\\dist\\server.js"]},
            {"name": "tdx", "command": "uvx", "args": ["--from", "tdx-mcp", "tdx-mcp"]},
        ]},
   },
    {
        "key": "inventory-ops",
        "name": "库存运营",
        "icon": "layout",
        "description": "仓储/库存运营台：库存概览、补货建议、滞销分析、日报导出。",
        "system_prompt": "你是一个库存运营助手。优先用表格与看板呈现库存、周转、预警数据，并附下一步动作。",
        "home": {
            "enabled": True,
            "title": "库存运营台",
            "subtitle": "点击下方任一入口，agent 将拉取数据并渲染看板。对话仅在需要时辅助。",
            "starters": [
                {"label": "今日库存概览", "prompt": "渲染今日库存概览看板：总库存、周转率、预警 SKU 表格，并附 2 个下一步动作", "variant": "primary"},
                {"label": "补货建议", "prompt": "根据近期出库与库存，生成一份补货建议表格，含建议数量与优先级"},
                {"label": "滞销分析", "prompt": "生成滞销品分析：列出 30 天无出库的 SKU 及占用资金，附趋势图"},
                {"label": "导出日报", "prompt": "把今日库存与补货要点整理成一份 Markdown 日报"},
            ],
        },
        "mcp": {"servers": []},
    },
]


def merge_domain_templates(builtin: list[dict], overlay: list[dict] | None) -> list[dict]:
    """Merge built-in domain templates with the user overlay layer.

    - overlay with matching key overrides built-in fields
    - overlay with `hidden: True` removes the matching built-in
    - overlay entries whose key is not in built-in are appended as new templates
    Result strips the `hidden` field.
    """
    overlay_by_key: dict[str, dict] = {}
    for ov in overlay or []:
        if isinstance(ov, dict) and ov.get("key"):
            overlay_by_key[str(ov["key"])] = ov

    result: list[dict] = []
    for b in builtin:
        key = b.get("key")
        ov = overlay_by_key.pop(key, None) if key is not None else None
        if ov is None:
            result.append(dict(b))
        elif ov.get("hidden"):
            continue
        else:
            merged = dict(b)
            merged.update({k: v for k, v in ov.items() if k != "hidden"})
            result.append(merged)

    for ov in overlay_by_key.values():
        if not ov.get("hidden"):
            result.append({k: v for k, v in ov.items() if k != "hidden"})
    return result
