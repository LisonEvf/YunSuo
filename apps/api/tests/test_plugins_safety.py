"""plugins.py 安装源协议白名单测试。"""
from __future__ import annotations

from app.agent.plugins import _is_safe_source, install


def test_https_source_allowed():
    assert _is_safe_source("https://github.com/user/plugin.git") is True


def test_http_source_allowed():
    assert _is_safe_source("http://internal.gitlab.local/group/plugin.git") is True


def test_file_protocol_blocked():
    assert _is_safe_source("file:///etc/passwd") is False


def test_ssh_protocol_blocked():
    assert _is_safe_source("git@github.com:user/plugin.git") is False


def test_ssh_scheme_blocked():
    assert _is_safe_source("ssh://git@github.com/user/plugin.git") is False


def test_git_scheme_blocked():
    assert _is_safe_source("git://github.com/user/plugin.git") is False


def test_install_rejects_unsafe_source(monkeypatch):
    monkeypatch.setattr("app.agent.plugins._resolve_install_base", lambda: None)
    result = install("file:///etc/passwd", "evil")
    assert result["ok"] is False
    assert "https" in result["error"]
