"""Readiness probe for the agent-browser CLI (``tools_config_post_setup._has_agent_browser``):
the `cryozen tools` rows and the setup summary must agree with the runtime resolution cascade."""

import shutil
import sys

from cryozen_cli import tools_config_post_setup as ps
from tools import browser_tool_install as bt_install


def _block_legacy_agent_browser_checks(monkeypatch):
    """Make the legacy checks (PATH lookup + local node_modules/.bin) find nothing."""
    real_which = shutil.which
    monkeypatch.setattr(
        shutil,
        "which",
        lambda cmd, *args, **kwargs: (
            None if cmd == "agent-browser" else real_which(cmd, *args, **kwargs)
        ),
    )
    monkeypatch.setattr("cryozen_constants.agent_browser_runnable", lambda path: False)


def test_has_agent_browser_true_for_npx_only_resolution(monkeypatch):
    """No PATH binary and no runnable node_modules copy, but the browser_tool
    cascade resolves the npx fallback: browser capability is available."""
    _block_legacy_agent_browser_checks(monkeypatch)

    calls = []

    def fake_find_agent_browser(*, validate=True):
        calls.append({"validate": validate})
        return "npx agent-browser"

    monkeypatch.setattr(bt_install, "_find_agent_browser", fake_find_agent_browser)
    monkeypatch.setattr(
        "tools.browser_tool_install._requires_real_termux_browser_install", lambda cmd: False
    )

    assert ps._has_agent_browser() is True
    # A readiness probe must resolve without spawning the daemon.
    assert calls and all(call["validate"] is False for call in calls)


def test_has_agent_browser_false_for_termux_local_bare_npx(monkeypatch):
    """On Termux in local mode the bare npx fallback is not a usable install."""
    _block_legacy_agent_browser_checks(monkeypatch)

    monkeypatch.setattr(
        bt_install,
        "_find_agent_browser",
        lambda *, validate=True: "npx agent-browser",
    )
    monkeypatch.setattr(
        "tools.browser_tool_install._requires_real_termux_browser_install",
        lambda cmd: cmd.strip() == "npx agent-browser",
    )

    assert ps._has_agent_browser() is False


def test_has_agent_browser_false_when_nothing_resolvable(monkeypatch):
    _block_legacy_agent_browser_checks(monkeypatch)

    def raise_not_found(*, validate=True):
        raise FileNotFoundError("agent-browser CLI not found")

    monkeypatch.setattr(bt_install, "_find_agent_browser", raise_not_found)

    assert ps._has_agent_browser() is False


def test_has_agent_browser_import_failure_falls_back_to_path_check(monkeypatch):
    """If tools.browser_tool_install cannot be imported, the old PATH + node_modules
    check must still answer (prior behaviour), not crash."""
    monkeypatch.setitem(sys.modules, "tools.browser_tool_install", None)
    real_which = shutil.which
    monkeypatch.setattr(
        shutil,
        "which",
        lambda cmd, *args, **kwargs: (
            "/fake/bin/agent-browser"
            if cmd == "agent-browser"
            else real_which(cmd, *args, **kwargs)
        ),
    )
    monkeypatch.setattr(
        "cryozen_constants.agent_browser_runnable",
        lambda path: path == "/fake/bin/agent-browser",
    )

    assert ps._has_agent_browser() is True


def test_has_agent_browser_import_failure_falls_back_to_cryozen_managed_node_path(
    monkeypatch, tmp_path
):
    """If tools.browser_tool_install cannot be imported, the managed-Node rung must
    still find a runnable agent-browser under the Cryozen Node dir even when
    it's absent from the probe process's PATH — the Windows installer shape
    where install succeeded but the GUI still said needs setup."""
    monkeypatch.setitem(sys.modules, "tools.browser_tool_install", None)
    managed_dir = tmp_path / "node"
    managed_dir.mkdir()
    managed_bin = managed_dir / "agent-browser"
    managed_bin.write_text("#!/bin/sh\nexit 0\n")
    managed_bin.chmod(0o755)

    real_which = shutil.which
    monkeypatch.setattr(
        shutil,
        "which",
        lambda cmd, *args, **kwargs: (
            None
            if cmd == "agent-browser" and not kwargs.get("path")
            else real_which(cmd, *args, **kwargs)
        ),
    )
    monkeypatch.setattr(
        "cryozen_constants.with_cryozen_node_path", lambda: {"PATH": str(managed_dir)}
    )
    monkeypatch.setattr(
        "cryozen_constants.agent_browser_runnable",
        lambda p: bool(p) and str(p) == str(managed_bin),
    )

    assert ps._has_agent_browser() is True


def test_has_agent_browser_import_failure_and_no_binary_is_false(monkeypatch):
    monkeypatch.setitem(sys.modules, "tools.browser_tool_install", None)
    _block_legacy_agent_browser_checks(monkeypatch)

    assert ps._has_agent_browser() is False
