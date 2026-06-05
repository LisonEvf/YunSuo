"""测试 DashboardSession 和 SessionManager。"""
import asyncio
import pytest


def test_session_init():
    from app.airui.session import DashboardSession

    s = DashboardSession("test")
    assert s.session_id == "test"
    assert s.doc is None
    assert s.ws_clients == []


def test_manager_get_or_create():
    from app.airui.session import SessionManager

    mgr = SessionManager()
    s1 = mgr.get_or_create("aaa")
    assert s1.session_id == "aaa"

    s2 = mgr.get_or_create("aaa")
    assert s2 is s1

    s3 = mgr.get_or_create("bbb")
    assert s3.session_id == "bbb"
    assert s3 is not s1


def test_manager_get():
    from app.airui.session import SessionManager

    mgr = SessionManager()
    assert mgr.get("xxx") is None

    mgr.get_or_create("xxx")
    assert mgr.get("xxx") is not None


def test_manager_delete():
    from app.airui.session import SessionManager

    mgr = SessionManager()
    mgr.get_or_create("del-me")
    assert mgr.get("del-me") is not None

    mgr.delete("del-me")
    assert mgr.get("del-me") is None


def test_manager_list():
    from app.airui.session import SessionManager

    mgr = SessionManager()
    mgr.get_or_create("c")
    mgr.get_or_create("a")
    mgr.get_or_create("b")
    assert sorted(mgr.list()) == ["a", "b", "c"]


def test_session_enqueue_event():
    from app.airui.session import DashboardSession

    s = DashboardSession("test")
    event = {"type": "interaction", "widgetRef": "table-plates", "interaction": "drilldown", "payload": {}}
    s.enqueue_event(event)

    got = s.dequeue_event(timeout=0.1)
    assert got == event


def test_session_dequeue_timeout():
    from app.airui.session import DashboardSession

    s = DashboardSession("test")
    assert s.dequeue_event(timeout=0.01) is None


def test_session_dequeue_multiple():
    from app.airui.session import DashboardSession

    s = DashboardSession("test")
    s.enqueue_event({"i": 1})
    s.enqueue_event({"i": 2})
    s.enqueue_event({"i": 3})

    assert s.dequeue_event(timeout=0.1) == {"i": 1}
    assert s.dequeue_event(timeout=0.1) == {"i": 2}
    assert s.dequeue_event(timeout=0.1) == {"i": 3}
    assert s.dequeue_event(timeout=0.01) is None
