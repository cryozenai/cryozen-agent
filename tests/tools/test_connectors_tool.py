"""Behavior tests for manage_connections (local MCP servers)."""

import json
from unittest.mock import patch


import tools.connectors.tool  # noqa: F401 - registers the tool
from tools.connectors.tool import MANAGE_CONNECTIONS_SCHEMA, manage_connections


def test_only_mcp_actions_are_offered():
    enum = MANAGE_CONNECTIONS_SCHEMA["parameters"]["properties"]["action"]["enum"]
    assert set(enum) == {"install", "enable", "authorize"}

    out = json.loads(manage_connections({"action": "connect", "connectors": [{"name": "linear", "mcp": True}]}))
    assert "action must be one of" in out["error"]

    out = json.loads(manage_connections({"action": "install"}))
    assert "requires 'connectors'" in out["error"]


# ---------------------------------------------------------------------------
# blocking operations are never parallelized
# ---------------------------------------------------------------------------


def test_wait_never_rides_a_parallel_batch():
    """A three-minute block must not hold a gathered batch's siblings hostage."""
    from agent.tool_dispatch_helpers import _NEVER_PARALLEL_TOOLS

    assert "manage_connections" in _NEVER_PARALLEL_TOOLS


# ---------------------------------------------------------------------------
# reachability: a registered tool nobody enables is a tool nobody can call
# ---------------------------------------------------------------------------


def _session_tool_names(enabled_toolsets, *, connectors, disabled_toolsets=None):
    """Tool names a session would actually receive, through the real assembly.

    Skips the tool_search step so the assertion is about NAME resolution and
    check_fn, not about how many MCP servers the developer running the suite
    happens to have configured.
    """
    from model_tools import _compute_tool_definitions
    from tools.registry import invalidate_check_fn_cache

    with patch("tools.connectors.tool.connections_available", return_value=connectors):
        invalidate_check_fn_cache()
        try:
            defs = _compute_tool_definitions(
                enabled_toolsets=enabled_toolsets,
                disabled_toolsets=disabled_toolsets,
                quiet_mode=True,
                skip_tool_search_assembly=True,
            )
        finally:
            invalidate_check_fn_cache()
    return {d["function"]["name"] for d in defs}



def test_cli_session_gets_the_tool_outside_a_code_workspace(tmp_path, monkeypatch):
    """The path a plain `cryozen` run takes: _get_platform_tools, no git cwd."""
    from cryozen_cli.tools_config import _get_platform_tools

    monkeypatch.chdir(tmp_path)
    enabled = sorted(_get_platform_tools({}, "cli", include_default_mcp_servers=True))

    assert "connections" in enabled
    assert "manage_connections" in _session_tool_names(enabled, connectors=True)


def test_cli_session_gets_the_tool_inside_a_code_workspace(monkeypatch):
    """Same resolver, run from this repo — the surface the live miss was on."""
    from pathlib import Path

    from cryozen_cli.tools_config import _get_platform_tools

    monkeypatch.chdir(Path(__file__).resolve().parents[2])
    enabled = sorted(_get_platform_tools({}, "cli", include_default_mcp_servers=True))
    assert "manage_connections" in _session_tool_names(enabled, connectors=True)


def test_tui_and_desktop_sessions_get_the_tool(monkeypatch):
    """The path the TUI/desktop gateway takes to build its selection."""
    from tui_gateway.server import _load_enabled_toolsets

    monkeypatch.delenv("CRYOZEN_TUI_TOOLSETS", raising=False)
    for platform in ("tui", "desktop"):
        selection = _load_enabled_toolsets(platform)
        names = _session_tool_names(selection, connectors=True)
        assert "manage_connections" in names, platform


def test_focus_mode_coding_posture_gets_the_tool(monkeypatch):
    """An engineer pinned to the coding posture still gets the tool."""
    from pathlib import Path

    from agent.coding_context import coding_selection

    repo = Path(__file__).resolve().parents[2]
    monkeypatch.chdir(repo)
    selection = coding_selection(
        platform="cli", cwd=str(repo), config={"agent": {"coding_context": "focus"}}
    )
    assert selection == ["coding"]  # posture collapse still collapses
    assert "manage_connections" in _session_tool_names(selection, connectors=True)


def test_connectors_off_switch_removes_the_tool_everywhere(tmp_path, monkeypatch):
    """``tools.connectors.enabled: false`` is the tool's check_fn: no surface gets
    ``manage_connections`` in its schema."""
    from cryozen_cli.tools_config import _get_platform_tools
    from tui_gateway.server import _load_enabled_toolsets

    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("CRYOZEN_TUI_TOOLSETS", raising=False)
    selections = [
        sorted(_get_platform_tools({}, "cli", include_default_mcp_servers=True)),
        _load_enabled_toolsets("tui"),
        _load_enabled_toolsets("desktop"),
        ["coding"],
    ]
    for selection in selections:
        assert "manage_connections" not in _session_tool_names(selection, connectors=False), selection


def test_off_switch_reads_tools_connectors_enabled(monkeypatch):
    from tools.connectors import tool as tool_mod

    for raw, expected in (({}, True), ({"tools": {"connectors": {"enabled": False}}}, False),
                          ({"tools": {"connectors": {"enabled": "off"}}}, False),
                          ({"tools": {"connectors": {"enabled": True}}}, True)):
        monkeypatch.setattr("cryozen_cli.config.load_config_readonly", lambda raw=raw: raw)
        assert tool_mod.connections_available() is expected, raw


def test_operator_can_still_turn_it_off(tmp_path, monkeypatch):
    """`agent.disabled_toolsets: [connections]` wins; a bundle name does not.

    The name is added before the disabled subtraction, so the toolset behaves
    like any other. Naming a platform composite instead must NOT strip it —
    that branch preserves core tools on purpose (#33924).
    """
    from cryozen_cli.tools_config import _get_platform_tools

    monkeypatch.chdir(tmp_path)
    enabled = sorted(_get_platform_tools({}, "cli", include_default_mcp_servers=True))

    assert "manage_connections" not in _session_tool_names(
        enabled, connectors=True, disabled_toolsets=["connections"]
    )
    assert "manage_connections" in _session_tool_names(
        enabled, connectors=True, disabled_toolsets=["cryozen-cli"]
    )


def test_tool_is_never_deferrable():
    from tools.tool_search import is_deferrable_tool_name

    # Core names short-circuit before the toolset check, so listing
    # "connections" in _DIRECT_SURFACE_TOOLSETS would be redundant.
    assert is_deferrable_tool_name("manage_connections") is False
