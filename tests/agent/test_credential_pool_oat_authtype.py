"""Claude subscription OAuth tokens (``sk-ant-oat``) are never used as Anthropic credentials.

Older releases could store them in the pool (Claude Code borrowing, PKCE login, a pasted setup
token). Loading such an auth.json must drop those rows, persist the drop, keep API-key rows, and
never hand the OAuth token to the resolver.
"""

import json

from agent.credential_pool import AUTH_TYPE_API_KEY, AUTH_TYPE_OAUTH, PooledCredential


def test_anthropic_real_api_key_unchanged():
    entry = PooledCredential.from_dict(
        "anthropic",
        {"auth_type": "api_key", "access_token": "sk-ant-api-EXAMPLE"},
    )
    assert entry.auth_type == AUTH_TYPE_API_KEY


def test_load_drops_legacy_oauth_rows_and_keeps_api_keys(tmp_path, monkeypatch):
    cryozen_home = tmp_path / "cryozen"
    cryozen_home.mkdir()
    monkeypatch.setenv("CRYOZEN_HOME", str(cryozen_home))
    for key in ("ANTHROPIC_API_KEY", "ANTHROPIC_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"):
        monkeypatch.delenv(key, raising=False)
    api_key = "sk-ant-api03-kept"
    auth_file = cryozen_home / "auth.json"
    auth_file.write_text(
        json.dumps({
            "version": 1,
            "credential_pool": {
                "anthropic": [
                    {
                        "id": "legacy-oat",
                        "label": "Legacy setup token",
                        "auth_type": AUTH_TYPE_API_KEY,
                        "priority": 0,
                        "source": "manual",
                        "access_token": "sk-ant-oat01-legacy",
                    },
                    {
                        "id": "pkce",
                        "label": "PKCE",
                        "auth_type": AUTH_TYPE_OAUTH,
                        "priority": 1,
                        "source": "manual:cryozen_pkce",
                        "access_token": "sk-ant-oat01-pkce",
                        "refresh_token": "rt",
                    },
                    {
                        "id": "borrowed",
                        "label": "claude_code",
                        "auth_type": AUTH_TYPE_OAUTH,
                        "priority": 2,
                        "source": "claude_code",
                    },
                    {
                        "id": "key",
                        "label": "api",
                        "auth_type": AUTH_TYPE_API_KEY,
                        "priority": 3,
                        "source": "manual",
                        "access_token": api_key,
                    },
                ],
            },
        })
    )

    from agent.anthropic_credentials import resolve_anthropic_token
    from agent.credential_pool import load_pool

    pool = load_pool("anthropic")
    assert [e.access_token for e in pool.entries()] == [api_key]
    persisted = json.loads(auth_file.read_text())["credential_pool"]["anthropic"]
    assert [row["id"] for row in persisted] == ["key"]
    assert (
        resolve_anthropic_token() is None
    )  # no ANTHROPIC_API_KEY; OAuth rows never resolve
