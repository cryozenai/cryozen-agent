"""resolve_anthropic_token() must honour the profile secret scope.

Under multiplex one process serves several profiles; ``ANTHROPIC_API_KEY`` must come from the active
profile's secret scope, never from the launch process's ``os.environ``, and an unscoped read must fail
closed (``UnscopedSecretError``) instead of silently using another profile's key.
"""

import pytest

from agent import secret_scope as ss
from agent.anthropic_credentials import resolve_anthropic_token


@pytest.fixture(autouse=True)
def _reset_multiplex():
    ss.set_multiplex_active(False)
    yield
    ss.set_multiplex_active(False)


def _resolve_in_scope(secrets: dict) -> object:
    tok = ss.set_secret_scope(secrets)
    try:
        return resolve_anthropic_token()
    finally:
        ss.reset_secret_scope(tok)


def test_two_profiles_resolve_their_own_key_not_environ(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-api-SHARED-ENVIRON-WRONG")
    ss.set_multiplex_active(True)

    assert (
        _resolve_in_scope({"ANTHROPIC_API_KEY": "sk-ant-api-PROFILE-A"})
        == "sk-ant-api-PROFILE-A"
    )
    assert (
        _resolve_in_scope({"ANTHROPIC_API_KEY": "sk-ant-api-PROFILE-B"})
        == "sk-ant-api-PROFILE-B"
    )


def test_unscoped_call_in_multiplex_mode_fails_closed(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-api-PROCESS-LEVEL-SHOULD-NOT-LEAK")
    ss.set_multiplex_active(True)

    with pytest.raises(ss.UnscopedSecretError, match="ANTHROPIC"):
        resolve_anthropic_token()
