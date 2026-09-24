"""Migration 46→47: settings for retired hosted services are dropped.

The hosted tool gateway, hosted cron provider and hosted telemetry upload are gone. A config that
still carries their settings must migrate to a config with none of them, leaving every other
setting untouched.
"""

import os
from unittest.mock import patch

import yaml


def _write_config(home, config):
    (home / "config.yaml").write_text(yaml.safe_dump(config), encoding="utf-8")


def _read_config(home):
    return yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8"))


def _run_ladder(home, current_ver=46):
    from cryozen_cli.config_migrations import run_migrations

    results = {"env_added": [], "config_added": [], "warnings": []}
    with patch.dict(os.environ, {"CRYOZEN_HOME": str(home)}):
        run_migrations(current_ver, results, quiet=True)
    return results


def test_migration_drops_retired_service_settings_and_keeps_the_rest(tmp_path):
    _write_config(
        tmp_path,
        {
            "_config_version": 46,
            "model": {"provider": "openrouter", "default": "moonshotai/kimi-k2.6"},
            "tool_gateway_declined_tools": ["web"],
            "web": {"use_gateway": True, "backend": "firecrawl"},
            "tts": {"provider": "edge"},
            "terminal": {"modal_mode": "managed", "backend": "local"},
            "telemetry": {
                "send": True,
                "endpoint": "https://ingest.example",
                "local": True,
            },
            "cron": {"chronos": {"callback_url": "https://cb"}, "provider": "chronos"},
            "dashboard": {
                "theme": "cryozen-blue",
                "oauth": {"client_id": "agent:1", "portal_url": ""},
            },
        },
    )

    results = _run_ladder(tmp_path)
    raw = _read_config(tmp_path)

    assert not results["warnings"]
    assert raw["model"] == {"provider": "openrouter", "default": "moonshotai/kimi-k2.6"}
    assert "tool_gateway_declined_tools" not in raw
    assert raw["web"] == {"backend": "firecrawl"}
    assert raw["tts"] == {"provider": "edge"}
    assert raw["terminal"] == {"backend": "local"}
    assert raw["telemetry"] == {"local": True}
    assert "chronos" not in raw["cron"] and "provider" not in raw["cron"]
    assert raw["dashboard"] == {"theme": "cryozen-blue", "oauth": {}}


def test_migration_is_a_no_op_for_a_clean_config(tmp_path):
    config = {
        "_config_version": 46,
        "model": {"provider": "openrouter", "default": "x/y"},
    }
    _write_config(tmp_path, config)

    results = _run_ladder(tmp_path)

    assert results["config_added"] == []
    assert _read_config(tmp_path) == config
