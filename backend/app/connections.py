"""连接池管理器 —— KplClient / TdxClient 单例复用。

避免每次 dashboard 构建都创建新连接，减少 TCP 握手开销。
"""
from __future__ import annotations

import logging
import threading
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from kpl_sdk.client import KplClient
    from opentdx.tdxClient import TdxClient

logger = logging.getLogger(__name__)

_kpl: KplClient | None = None
_tdx: TdxClient | None = None
_lock = threading.Lock()


def get_kpl() -> KplClient:
    """获取 KplClient 单例。"""
    global _kpl
    if _kpl is None:
        with _lock:
            if _kpl is None:
                from kpl_sdk.client import KplClient as _Kpl
                logger.info("Creating KplClient singleton")
                _kpl = _Kpl(timeout=10)
    return _kpl


def get_tdx() -> TdxClient:
    """获取 TdxClient 单例（每次使用前 connect，用后不 disconnect，复用 TCP 连接）。"""
    global _tdx
    if _tdx is None:
        with _lock:
            if _tdx is None:
                from opentdx.tdxClient import TdxClient as _Tdx
                logger.info("Creating TdxClient singleton")
                _tdx = _Tdx()
    return _tdx


def reset() -> None:
    """关闭并重置所有连接（用于异常恢复）。"""
    global _kpl, _tdx
    with _lock:
        if _kpl is not None:
            try:
                _kpl.close()
            except Exception:
                pass
            _kpl = None
        if _tdx is not None:
            try:
                # TdxClient 没有 close，直接置空让下次重建
                _tdx = None
            except Exception:
                pass
            _tdx = None
