"""Tests for Anthropic credential persistence helpers."""

from cryozen_cli.config import load_env


def test_save_anthropic_api_key_writes_key_and_clears_legacy_token_slot(
    tmp_path, monkeypatch
):
    home = tmp_path / "cryozen"
    home.mkdir()
    monkeypatch.setenv("CRYOZEN_HOME", str(home))
    (home / ".env").write_text("ANTHROPIC_TOKEN=sk-ant-oat01-legacy\n")

    from cryozen_cli.config import save_anthropic_api_key

    save_anthropic_api_key("sk-ant-api03-test-key")

    env_vars = load_env()
    assert env_vars["ANTHROPIC_API_KEY"] == "sk-ant-api03-test-key"
    assert env_vars.get("ANTHROPIC_TOKEN", "") == ""


def test_resolve_anthropic_token_refuses_subscription_oauth_token(monkeypatch):
    from agent.anthropic_credentials import resolve_anthropic_token

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-oat01-subscription")
    assert resolve_anthropic_token() is None
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-api03-real")
    assert resolve_anthropic_token() == "sk-ant-api03-real"
