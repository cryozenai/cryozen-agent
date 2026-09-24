"""Anthropic credential resolution: Console API keys only.

``resolve_anthropic_token()`` returns the profile-scoped ``ANTHROPIC_API_KEY``. Claude
subscription OAuth / setup tokens (``sk-ant-oat*``) belong to Anthropic's own clients; their
terms do not allow third-party products to use them, so Cryozen refuses them everywhere.
"""

import logging
from typing import Any, Optional

from agent.secret_scope import get_secret as _get_secret

logger = logging.getLogger(__name__)

_warned_consumer_oauth_key = False


def _getenv(name: str, default: str = "") -> str:
    """Profile-scoped os.getenv for credential reads (fail-closed on unscoped reads when multiplexing)."""
    val = _get_secret(name, default)
    return val if val is not None else default


def is_consumer_oauth_token(key: Any) -> bool:
    """True for Claude subscription OAuth / setup tokens (``sk-ant-oat*``), which Cryozen does not accept."""
    return isinstance(key, str) and key.strip().startswith("sk-ant-oat")


def _available_anthropic_token(
    token: Optional[str], model: Optional[str]
) -> Optional[str]:
    """Return *token* unless the pool holds an active cooldown for it on *model*.

    Only model-aware callers (the API-call paths) are gated: diagnostics that
    resolve a token without a model (usage display, model discovery) keep it.
    """
    if not token or not model:
        return token or None
    try:
        from agent.credential_pool import load_pool

        if load_pool("anthropic").token_is_blocked(token, model=model):
            return None
    except Exception:
        # Credential discovery must remain available when the pool store is
        # unavailable or malformed.
        logger.debug("Failed to check Anthropic model cooldown", exc_info=True)
    return token


def resolve_anthropic_token(*, model: Optional[str] = None) -> Optional[str]:
    """``ANTHROPIC_API_KEY``, or None when it is unset or holds a subscription OAuth token.

    With *model*, a key the credential pool has benched for that model resolves to ``None``
    instead of being handed straight back to the caller that just saw it rate-limited."""
    global _warned_consumer_oauth_key
    api_key = _getenv("ANTHROPIC_API_KEY").strip()
    if is_consumer_oauth_token(api_key):
        if not _warned_consumer_oauth_key:
            _warned_consumer_oauth_key = True
            logger.warning(
                "ANTHROPIC_API_KEY holds a Claude subscription OAuth token (sk-ant-oat...), which "
                "Cryozen does not use. Create an API key at https://platform.claude.com/settings/keys."
            )
        return None
    return _available_anthropic_token(api_key, model)
