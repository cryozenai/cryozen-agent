"""Resolve CRYOZEN_HOME for standalone skill scripts.

Skill scripts may run outside the Cryozen process (system Python, nix env,
CI) where ``cryozen_constants`` is not importable.  This module provides the
same ``get_cryozen_home()`` contract without requiring it on ``sys.path``.

When ``cryozen_constants`` IS available it is used directly so profile
resolution and any future enhancements are picked up automatically.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from cryozen_constants import get_cryozen_home as get_cryozen_home
except (ModuleNotFoundError, ImportError):

    def get_cryozen_home() -> Path:
        """Return the Cryozen home directory (default: ``~/.cryozen-agent``)."""
        val = os.environ.get("CRYOZEN_HOME", "").strip()
        return Path(val) if val else Path.home() / ".cryozen-agent"
