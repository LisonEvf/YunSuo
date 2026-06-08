from app.airui.renderer import render_console


def _sample_console_state() -> dict:
    return {
        "session_id": "test",
        "runtime": {"status": "ready"},
        "skills": [
            {"slug": "task-planning", "name": "task-planning", "description": "Plan work"},
            {"slug": "debugging", "name": "debugging", "description": "Diagnose failures"},
        ],
        "memory": {"total": 3},
        "trajectories": {"total": 5, "completed": 4, "failed": 1},
        "timeline": [
            {"step": "Request accepted", "status": "done", "detail": "User asked for a plan"},
        ],
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
    doc = render_console(_sample_console_state())
    assert doc["schema"] == "air-ui@1"
    assert doc["state"]["mode"] == "general-agent"
    assert doc["root"]["type"] == "Dashboard"


def test_render_has_status_row():
    refs = _collect_refs(render_console(_sample_console_state())["root"])
    assert "row-status" in refs
    assert "kpi-status" in refs
    assert "kpi-skills" in refs
    assert "kpi-memory" in refs
    assert "kpi-trajectories" in refs


def test_render_has_timeline_and_artifacts():
    refs = _collect_refs(render_console(_sample_console_state())["root"])
    assert "row-timeline" in refs
    assert "table-run-timeline" in refs
    assert "row-artifacts" in refs
    assert "artifact-empty" in refs


def test_render_has_inspector_tables():
    refs = _collect_refs(render_console(_sample_console_state())["root"])
    assert "row-inspector" in refs
    assert "table-active-skills" in refs
    assert "table-runtime-inspector" in refs


def test_active_skills_table_uses_generic_skills():
    widget = _find_by_ref(render_console(_sample_console_state())["root"], "table-active-skills")
    assert widget is not None
    table = widget["children"][0]
    rows = table["props"]["data"]
    assert rows[0]["slug"] == "task-planning"


def test_render_idempotent():
    doc1 = render_console(_sample_console_state())
    doc2 = render_console(_sample_console_state())
    assert doc1 == doc2
