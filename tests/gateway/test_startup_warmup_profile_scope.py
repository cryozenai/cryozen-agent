"""Boot probes run inside the launch profile's scope under multiplex.

``get_tool_definitions`` runs every ``check_fn``; probes resolve provider routing overrides through
``agent.secret_scope.get_secret``. With multiplex active and no scope on the executor thread that read
fails closed, the override is absent, and default routing applies instead of the profile's. The
warm-up must run under the same binding a routed turn gets, and the binding must reach the
executor thread.
"""
from __future__ import annotations

import asyncio
import types

import pytest

from agent import secret_scope
from gateway import run as gateway_run
from gateway.run_startup import GatewayStartupMixin

OVERRIDE = "https://openrouter.example.test/api/v1"
OVERRIDE_VAR = "OPENROUTER_BASE_URL"


@pytest.fixture
def multiplex_home(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    (home / ".env").write_text(f"{OVERRIDE_VAR}={OVERRIDE}\n")
    monkeypatch.setenv("CRYOZEN_HOME", str(home))
    monkeypatch.delenv(OVERRIDE_VAR, raising=False)
    secret_scope.set_multiplex_active(True)
    try:
        yield home
    finally:
        secret_scope.set_multiplex_active(False)


def _probe(seen: dict):
    def probe() -> int:
        seen["scope_installed"] = secret_scope._SECRET_SCOPE.get() is not None
        seen["routing_override"] = secret_scope.get_secret(OVERRIDE_VAR)
        return 1
    return probe


class _Runner(GatewayStartupMixin):
    def __init__(self, *, multiplex: bool):
        self.config = types.SimpleNamespace(multiplex_profiles=multiplex)


def _run_warmup(monkeypatch, *, multiplex: bool) -> dict:
    """Drive ``_warm_turn_prerequisites`` with the sync warm-up replaced by a probe that records what
    the executor thread can see, then what the loop task sees once the warm-up has returned."""
    seen: dict = {}
    monkeypatch.setattr(gateway_run, "_warm_turn_machinery_sync", _probe(seen))

    async def drive() -> None:
        await _Runner(multiplex=multiplex)._warm_turn_prerequisites()
        # Same task as the warm-up (asyncio.run copies the context, so the caller's view proves nothing).
        from cryozen_constants import get_cryozen_home_override
        seen["scope_after"] = secret_scope._SECRET_SCOPE.get()
        seen["home_override_after"] = get_cryozen_home_override()

    asyncio.run(drive())
    return seen


def test_multiplex_warmup_runs_check_fns_inside_the_launch_profile_scope(multiplex_home, monkeypatch):
    """The executor thread sees the launch profile's secret scope, so the .env routing override resolves
    exactly as it does on a routed turn — never the fail-closed 'absent' that heals to production. The
    binding is per activity: once the warm-up returns, the loop thread is unscoped again."""
    seen = _run_warmup(monkeypatch, multiplex=True)
    assert seen["scope_installed"] is True
    assert seen["routing_override"] == OVERRIDE
    assert seen["scope_after"] is None
    assert seen["home_override_after"] is None


def test_single_profile_warmup_keeps_environ_semantics(tmp_path, monkeypatch):
    """Multiplex off: no scope is installed and the process env stays the override source."""
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("CRYOZEN_HOME", str(home))
    monkeypatch.setenv(OVERRIDE_VAR, OVERRIDE)
    secret_scope.set_multiplex_active(False)
    seen = _run_warmup(monkeypatch, multiplex=False)
    assert seen["scope_installed"] is False
    assert seen["routing_override"] == OVERRIDE
