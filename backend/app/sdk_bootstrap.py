"""Local SDK bootstrap for the repository layout.

The openkpl sources are stored in ./openkpl, while the package imports itself
as ``kpl_sdk``. This module registers that folder as the expected package name
for local development and Docker runtime without modifying the vendored SDK.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
OPENKPL_DIR = ROOT_DIR / "openkpl"
OPENTDX_DIR = ROOT_DIR / "opentdx"

if OPENTDX_DIR.exists():
    opentdx_path = str(OPENTDX_DIR)
    if opentdx_path not in sys.path:
        sys.path.insert(0, opentdx_path)

if OPENKPL_DIR.exists() and "kpl_sdk" not in sys.modules:
    pkg = types.ModuleType("kpl_sdk")
    pkg.__path__ = [str(OPENKPL_DIR)]
    pkg.__file__ = str(OPENKPL_DIR / "__init__.py")
    sys.modules["kpl_sdk"] = pkg
