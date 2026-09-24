"""manage_connections follows session grants, not process-wide state."""

import json

import pytest


@pytest.mark.parametrize("enabled,disabled,allowed", [
    ([], [], False),
    (["safe"], [], False),
    (["cryozen-webhook"], [], False),
    (["connections"], [], True),
    (["cryozen-cli"], ["connections"], False),
    (["safe"], ["connections"], False),
    (None, ["connections"], False),
    (None, [], True),
])
def test_connections_scope_controls_schema_and_execution(monkeypatch, enabled, disabled, allowed):
    import model_tools
    from tools.connectors import tool as tool_mod
    from tools.registry import invalidate_check_fn_cache

    monkeypatch.setattr(tool_mod, "connections_available", lambda: True)
    invalidate_check_fn_cache()
    scope = {"enabled_toolsets": enabled, "disabled_toolsets": disabled}
    defs = model_tools.get_tool_definitions(**scope, quiet_mode=True, skip_tool_search_assembly=True)
    assert ("manage_connections" in {td["function"]["name"] for td in defs}) is allowed
    if enabled == []:
        assert model_tools.get_tool_definitions(**scope, quiet_mode=True) == []
    if not allowed:
        out = json.loads(model_tools.handle_function_call("manage_connections", {"action": "install"}, **scope))
        assert "not available in this session" in out["error"]


def test_ordinary_platform_defaults_grant_connections_without_widening_webhook():
    from cryozen_cli.tools_config import _get_platform_tools
    from toolsets import resolve_toolset

    for platform in ("cli", "telegram"):
        enabled = _get_platform_tools({}, platform)
        assert "connections" in enabled
        assert "manage_connections" in {name for ts in enabled for name in resolve_toolset(ts)}
    assert "connections" not in _get_platform_tools({}, "webhook")
    for selection in ([], ["safe"], ["file"]):
        assert "connections" not in _get_platform_tools({"platform_toolsets": {"cli": selection}}, "cli")
