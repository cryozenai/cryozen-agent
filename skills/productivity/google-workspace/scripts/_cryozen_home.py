"""Resolve CRYOZEN_HOME for standalone skill scripts.

Skill scripts may run outside the Cryozen process (e.g. system Python,
nix env, CI) where ``cryozen_constants`` is not importable.  This module
provides the same ``get_cryozen_home()`` and ``display_cryozen_home()``
contracts as ``cryozen_constants`` without requiring it on ``sys.path``.

When ``cryozen_constants`` IS available it is used directly so that any
future enhancements (profile resolution, Docker detection, etc.) are
picked up automatically.  The fallback path replicates the core logic
from ``cryozen_constants.py`` using only the stdlib.

All scripts under ``google-workspace/scripts/`` should import from here
instead of duplicating the ``CRYOZEN_HOME = Path(os.getenv(...))`` pattern.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from cryozen_constants import display_cryozen_home as display_cryozen_home
    from cryozen_constants import get_cryozen_home as get_cryozen_home
except (ModuleNotFoundError, ImportError):

    def get_cryozen_home() -> Path:
        """Return the Cryozen home directory (default: ~/.cryozen-agent).

        Mirrors ``cryozen_constants.get_cryozen_home()``."""
        val = os.environ.get("CRYOZEN_HOME", "").strip()
        return Path(val) if val else Path.home() / ".cryozen-agent"

    def display_cryozen_home() -> str:
        """Return a user-friendly ``~/``-shortened display string.

        Mirrors ``cryozen_constants.display_cryozen_home()``."""
        home = get_cryozen_home()
        try:
            return "~/" + home.relative_to(Path.home()).as_posix()
        except ValueError:
            return str(home)
