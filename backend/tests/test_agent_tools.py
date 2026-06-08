import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.agent.tools import _normalize_airui_component


def test_normalize_airui_component_supports_common_agent_table_shape():
    component = _normalize_airui_component({
        "type": "DataTable",
        "props": {
            "columns": [{"key": "task", "label": "Task"}],
            "rows": [{"task": "Review"}],
        },
    })

    assert component["type"] == "Table"
    assert component["props"]["data"] == [{"task": "Review"}]
    assert "rows" not in component["props"]


def test_normalize_airui_component_maps_unknown_textual_shapes_to_text():
    component = _normalize_airui_component({
        "type": "Markdown",
        "props": {"content": "Done"},
    })

    assert component == {"type": "Text", "props": {"value": "Done"}}


def test_normalize_airui_component_recurses_through_children():
    component = _normalize_airui_component({
        "type": "Panel",
        "props": {"title": "Summary"},
        "children": [
            {"type": "Metric", "props": {"label": "Open", "count": 2}},
            {"props": {"text": "No explicit type"}},
        ],
    })

    assert component["type"] == "Widget"
    assert component["children"][0]["type"] == "KPI"
    assert component["children"][0]["props"]["value"] == 2
    assert component["children"][1] == {"type": "Text", "props": {"value": "No explicit type"}}
