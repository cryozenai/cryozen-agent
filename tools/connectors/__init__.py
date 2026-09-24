"""Connection boundary for local MCP servers and catalog installs.

Only the names below are cross-package surface; imports beyond it need a design decision.
Siblings: ``contract`` (states, actors, transition table), ``operation`` (the record),
``live`` (open operation per session), ``run`` (the lifecycle loop), ``mcp`` / ``catalog``
(per-kind hooks), ``targets``, ``session``.
"""

from tools.connectors.tool import MANAGE_CONNECTIONS_SCHEMA, connections_available, manage_connections

__all__ = [
    "MANAGE_CONNECTIONS_SCHEMA",
    "connections_available",
    "manage_connections",
]
