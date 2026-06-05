"""测试 JSON Patch 操作。"""
from app.airui.patch import apply_patches, compute_patches


def test_apply_patch_replace():
    doc = {"type": "Dashboard", "children": [{"type": "KPI", "props": {"value": 50}}]}
    patches = [{"op": "replace", "path": "/children/0/props/value", "value": 75}]
    result = apply_patches(doc, patches)
    assert result["children"][0]["props"]["value"] == 75


def test_apply_patch_add():
    doc = {"type": "Dashboard", "children": []}
    patches = [{"op": "add", "path": "/children/-", "value": {"type": "Text", "props": {"text": "hello"}}}]
    result = apply_patches(doc, patches)
    assert len(result["children"]) == 1
    assert result["children"][0]["type"] == "Text"


def test_apply_patch_remove():
    doc = {"type": "Dashboard", "children": [{"type": "KPI"}, {"type": "Text"}]}
    patches = [{"op": "remove", "path": "/children/0"}]
    result = apply_patches(doc, patches)
    assert len(result["children"]) == 1
    assert result["children"][0]["type"] == "Text"


def test_apply_multiple_patches():
    doc = {"a": 1, "b": 2}
    patches = [
        {"op": "replace", "path": "/a", "value": 10},
        {"op": "remove", "path": "/b"},
        {"op": "add", "path": "/c", "value": 30},
    ]
    result = apply_patches(doc, patches)
    assert result == {"a": 10, "c": 30}


def test_apply_patches_immutability():
    doc = {"x": 1}
    patches = [{"op": "replace", "path": "/x", "value": 2}]
    result = apply_patches(doc, patches)
    assert doc["x"] == 1
    assert result["x"] == 2


def test_compute_patches_replace():
    old = {"type": "Dashboard", "children": [{"type": "KPI", "props": {"value": 50}}]}
    new = {"type": "Dashboard", "children": [{"type": "KPI", "props": {"value": 75}}]}
    patches = compute_patches(old, new)
    assert len(patches) >= 1
    result = apply_patches(old, patches)
    assert result["children"][0]["props"]["value"] == 75


def test_compute_patches_add_child():
    old = {"type": "Dashboard", "children": []}
    new = {"type": "Dashboard", "children": [{"type": "Text", "props": {"text": "hi"}}]}
    patches = compute_patches(old, new)
    result = apply_patches(old, patches)
    assert len(result["children"]) == 1
