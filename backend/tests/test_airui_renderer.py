"""测试 AIRUI Renderer 模板引擎。"""
from app.airui.renderer import render_dashboard


def _sample_dashboard() -> dict:
    return {
        "meta": {"day": "2026-06-05", "updatedAt": "2026-06-05 15:00:00", "source": "test", "warnings": []},
        "overview": {
            "cycle": "启动", "sentiment": 65.3,
            "advice": {"aggressive": "3-5成跟随", "steady": "2-4成", "min": 20, "max": 50},
            "style": [{"text": "主线核心", "ok": True}],
            "timePlan": [{"time": "09:25", "text": "观察跌停"}],
        },
        "kpis": {
            "sentiment": 65.3, "sentimentDelta": 5.2, "limitUp": 45, "broken": 12,
            "limitDown": 8, "sealRate": 78.5, "bombRate": 21.5, "yesterdayPremium": 2.3,
            "linkBoardPremium": 4.1, "upCount": 3200, "downCount": 1800,
            "marketAmount": 11200.5, "marketAmountText": "万亿", "marketVsShort": 3.2,
            "review": "盘面偏强", "bombRate5d": 25.0, "firstBoardCount": 30,
            "linkBoardCount": 15, "marketAmountDelta": 5.2, "nonBoardTemp": 60.5,
            "openPremium": "2.1%", "promotionRate": "35%", "marketCoef": 52.1,
            "zhangfuDistribution": [{"range": "+9%", "count": 45}, {"range": "-9%", "count": 8}],
        },
        "indexes": [
            {"name": "上证指数", "code": "000001.SH", "close": 3200.5, "diff": 25.3, "pct": 0.8, "up_count": 1500, "down_count": 500},
        ],
        "trend": [
            {"date": "2026-06-03", "score": 60.0, "limit_up": 40, "limit_down": 10, "amount": 10500, "seal_rate": 75.0, "bomb_rate": 25.0, "cycle": "常态", "marketCoef": 48.0, "shortSentiment": 60.0, "moneyLoss": 80.0, "plates": [{"name": "半导体", "strength": 5000}]},
            {"date": "2026-06-04", "score": 62.0, "limit_up": 42, "limit_down": 9, "amount": 10800, "seal_rate": 76.0, "bomb_rate": 24.0, "cycle": "启动", "marketCoef": 50.0, "shortSentiment": 62.0, "moneyLoss": 82.0, "plates": [{"name": "半导体", "strength": 5500}]},
            {"date": "2026-06-05", "score": 65.3, "limit_up": 45, "limit_down": 8, "amount": 11200, "seal_rate": 78.5, "bomb_rate": 21.5, "cycle": "启动", "marketCoef": 52.1, "shortSentiment": 65.3, "moneyLoss": 84.0, "plates": [{"name": "半导体", "strength": 6000}]},
        ],
        "plates": [
            {"name": "半导体", "pct": 3.5, "code": "881270", "leader": "胜业电气", "leaderCode": "920128", "leaderPct": 10.0, "limitUps": 5, "firstBoards": 3, "linkBoardCount": 2, "maxBoard": 3, "strength": 6000, "role": "主线", "stage": "发酵", "capital": "机构主导", "sharePct": 15.0, "middleStock": "四方股份", "middleCode": "601126"},
        ],
        "methods": [
            {"name": "空仓观望", "score": 25.0, "status": "备选", "note": "信号不足时休息"},
            {"name": "超跌反弹", "score": 35.0, "status": "观察", "note": "分歧末端轻仓试错"},
            {"name": "低吸半路", "score": 55.0, "status": "可做", "note": "主线明确时"},
            {"name": "首板打板", "score": 60.0, "status": "可做", "note": "封板质量在线"},
            {"name": "龙头接力", "score": 50.0, "status": "观察", "note": "情绪强时"},
            {"name": "高位打板", "score": 30.0, "status": "回避", "note": "风险较大"},
        ],
        "risks": [{"title": "跌停扩散风险", "level": "中", "text": "跌停 8 家"}],
        "opportunities": [{"title": "半导体前排确认", "grade": "A", "text": "强度 6000", "trigger": "维持强势"}],
        "watchlist": [
            {"name": "空仓观望", "code": "CASH", "theme": "防守", "condition": "竞价负反馈", "priority": "默认"},
            {"name": "胜业电气", "code": "920128", "theme": "半导体", "condition": "放量回封", "priority": "A类"},
        ],
        "monitor": [{"time": "09:30", "code": "000001", "name": "上证指数", "desc": "涨幅", "value": "+0.8%"}],
    }


def _collect_refs(node: dict, refs: list[str] | None = None) -> list[str]:
    if refs is None:
        refs = []
    if "ref" in node:
        refs.append(node["ref"])
    for child in node.get("children", []):
        _collect_refs(child, refs)
    return refs


def _find_by_ref(node: dict, ref: str) -> dict | None:
    if node.get("ref") == ref:
        return node
    for child in node.get("children", []):
        found = _find_by_ref(child, ref)
        if found:
            return found
    return None


def test_render_returns_airui_document():
    doc = render_dashboard(_sample_dashboard())
    assert doc["schema"] == "air-ui@1"
    assert "root" in doc
    assert doc["root"]["type"] == "Dashboard"


def test_render_has_sentiment_gauge():
    doc = render_dashboard(_sample_dashboard())
    assert _find_by_ref(doc["root"], "gauge-sentiment") is not None


def test_render_has_kpi_row():
    refs = _collect_refs(render_dashboard(_sample_dashboard())["root"])
    assert "kpi-limitUp" in refs
    assert "kpi-limitDown" in refs
    assert "kpi-broken" in refs
    assert "kpi-sealRate" in refs
    assert "kpi-bombRate" in refs
    assert "kpi-yesterdayPremium" in refs


def test_render_has_trend_chart():
    refs = _collect_refs(render_dashboard(_sample_dashboard())["root"])
    assert "chart-trend" in refs


def test_render_has_plate_table():
    refs = _collect_refs(render_dashboard(_sample_dashboard())["root"])
    assert "table-plates" in refs


def test_render_has_methods_chart():
    refs = _collect_refs(render_dashboard(_sample_dashboard())["root"])
    assert "chart-methods" in refs


def test_render_has_risks_table():
    refs = _collect_refs(render_dashboard(_sample_dashboard())["root"])
    assert "table-risks" in refs


def test_render_has_watchlist_table():
    refs = _collect_refs(render_dashboard(_sample_dashboard())["root"])
    assert "table-watchlist" in refs


def test_render_plate_table_has_drilldown():
    widget = _find_by_ref(render_dashboard(_sample_dashboard())["root"], "table-plates")
    assert widget is not None
    table = widget["children"][0] if widget.get("children") else widget
    interactions = table.get("props", {}).get("interactions", [])
    assert any(i.get("type") == "drilldown" for i in interactions)


def test_render_watchlist_has_drilldown():
    widget = _find_by_ref(render_dashboard(_sample_dashboard())["root"], "table-watchlist")
    assert widget is not None
    table = widget["children"][0] if widget.get("children") else widget
    interactions = table.get("props", {}).get("interactions", [])
    assert any(i.get("type") == "drilldown" for i in interactions)


def test_render_idempotent():
    doc1 = render_dashboard(_sample_dashboard())
    doc2 = render_dashboard(_sample_dashboard())
    assert doc1 == doc2
