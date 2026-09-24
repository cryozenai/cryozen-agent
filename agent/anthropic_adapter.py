"""Anthropic Messages API adapter: client construction + the Messages call for Cryozen's
OpenAI-style internals. Auth: API keys -> x-api-key (Bearer for endpoints that require it).
Endpoint predicates, payload conversion and credentials live in
``agent/anthropic_{endpoints,message_convert,credentials}.py``; import them from there."""

import logging
import math
import re
from collections.abc import Iterable
from contextlib import suppress
from typing import Any, Dict, List, Optional

from utils import normalize_proxy_env_vars

from agent.anthropic_endpoints import (
    _base_url_needs_context_1m_beta, _is_azure_anthropic_endpoint, _is_kimi_coding_endpoint,
    _is_minimax_anthropic_endpoint, _is_opencode_endpoint,
    _is_third_party_anthropic_endpoint, _model_name_is_kimi_family, _normalize_base_url_text,
    _requires_bearer_auth,
)
from agent.anthropic_message_convert import (
    convert_messages_to_anthropic, convert_tools_to_anthropic, normalize_model_name,
)

from cryozen_cli import __version__ as _CRYOZEN_VERSION


# ``import anthropic`` is deliberately NOT at module top: the SDK costs ~220 ms of imports and
# every usage site is a cold user-triggered path. ``...`` = not yet tried; None = tried, missing.
_anthropic_sdk: Any = ...


def _get_anthropic_sdk():
    """Return the ``anthropic`` SDK module, importing lazily. None if not installed."""
    global _anthropic_sdk
    if _anthropic_sdk is ...:
        with suppress(Exception):  # ImportError or FeatureUnavailable — fall through to the import below
            from tools.lazy_deps import ensure as _lazy_ensure
            _lazy_ensure("provider.anthropic", prompt=False)
        try:
            import anthropic as _sdk
            _anthropic_sdk = _sdk
        except ImportError:
            _anthropic_sdk = None
    return _anthropic_sdk


def _require_sdk(purpose: str, verb: str = "Install it with"):
    """``_get_anthropic_sdk()`` or ImportError naming the feature that needs it."""
    sdk = _get_anthropic_sdk()
    if sdk is None:
        raise ImportError(f"The 'anthropic' package is required for {purpose}. {verb}: pip install 'anthropic>=0.39.0'")
    return sdk


logger = logging.getLogger(__name__)

THINKING_BUDGET = {"xhigh": 32000, "high": 16000, "medium": 8000, "low": 4000}
# Cryozen effort -> Anthropic adaptive-thinking effort (output_config.effort). 4.7+ exposes
# low/medium/high/xhigh/max; Opus/Sonnet 4.6 have no xhigh, so callers downgrade xhigh->max
# there (see _supports_xhigh_effort). "minimal" is a legacy alias for low on every model.
ADAPTIVE_EFFORT_MAP = {
    "ultra": "max", "max": "max", "xhigh": "xhigh", "high": "high", "medium": "medium", "low": "low",
    "minimal": "low",
}

# Thinking-mode classification. Claude 4.6 replaced budget-based extended thinking with *adaptive*
# thinking; 4.7 additionally forbids the manual ``thinking`` block and drops temperature/top_p/
# top_k. Newer releases share no common version substring, so an allowlist of "modern" versions
# would go stale and silently route a new model down the legacy path: unknown Claude models
# DEFAULT to the modern contract and only explicit *legacy* lists are kept (mirroring
# _get_anthropic_max_output's default-to-newest). Non-Claude Anthropic-Messages models (minimax,
# qwen3, GLM, ...) fall through to the legacy manual-thinking path, which they need.
# Older Claude families that need manual thinking (budget_tokens only); ``claude-3`` covers
# 3/3.5/3.7 and the ``-2025`` entries are date-stamped 4.0 ids.
_LEGACY_MANUAL_THINKING_CLAUDE_SUBSTRINGS = (
    "claude-3", "claude-opus-4-0", "claude-opus-4.0", "claude-opus-4-1", "claude-opus-4.1",
    "claude-sonnet-4-0", "claude-sonnet-4.0", "claude-opus-4-2025", "claude-sonnet-4-2025",
    "claude-opus-4-5", "claude-opus-4.5", "claude-sonnet-4-5", "claude-sonnet-4.5", "claude-haiku-4-5",
    "claude-haiku-4.5",
)
# Adaptive families that reject the "xhigh" effort (arrived with Opus 4.7) and still accept
# sampling params.
_NO_XHIGH_CLAUDE_SUBSTRINGS = ("claude-opus-4-6", "claude-opus-4.6", "claude-sonnet-4-6", "claude-sonnet-4.6")
# Adaptive families where thinking is mandatory: ``thinking: {"type": "disabled"}`` answers HTTP
# 400 (relays flag them ``reasoning.mandatory``). The failure is asymmetric — a missing entry
# 400s the turn, a spurious one only leaves thinking on — so when in doubt, add the family.
_MANDATORY_THINKING_CLAUDE_SUBSTRINGS = ("claude-fable",)
_FAST_MODE_SUPPORTED_SUBSTRINGS = ("opus-4-8", "opus-4.8", "opus-5")


def _is_claude_model(model: str | None) -> bool:
    return "claude" in (model or "").lower()


def _model_matches(model: str, substrings) -> bool:
    """Case-insensitive substring match of ``model`` against a family list."""
    m = model.lower()
    return any(v in m for v in substrings)


# Max output tokens per model (Anthropic docs + Cline catalog). Anthropic requires max_tokens; a
# fixed 16384 starved thinking-enabled models (thinking tokens count toward the limit).
# ``claude-fable`` = Mythos-class named models (1M context); ``minimax`` is a third-party
# Anthropic-compatible endpoint; DashScope enforces ``qwen3`` max_tokens in [1, 65536].
_ANTHROPIC_OUTPUT_LIMITS = {
    "claude-fable": 128_000, "claude-sonnet-5": 128_000, "claude-opus-4-8": 128_000,
    "claude-opus-4-7": 128_000, "claude-opus-4-6": 128_000, "claude-sonnet-4-6": 64_000,
    "claude-opus-4-5": 64_000, "claude-sonnet-4-5": 64_000, "claude-haiku-4-5": 64_000,
    "claude-opus-4": 32_000, "claude-sonnet-4": 64_000, "claude-3-7-sonnet": 128_000,
    "claude-3-5-sonnet": 8_192, "claude-3-5-haiku": 8_192, "claude-3-opus": 4_096,
    "claude-3-sonnet": 4_096, "claude-3-haiku": 4_096, "minimax": 131_072, "qwen3": 65_536,
}
# Unknown models get the highest current limit: future models are unlikely to have *less*.
_ANTHROPIC_DEFAULT_OUTPUT_LIMIT = 128_000


def _get_anthropic_max_output(model: str) -> int:
    """Max output tokens for ``model`` via longest substring match against
    ``_ANTHROPIC_OUTPUT_LIMITS`` (so date-stamped ids and ``:1m``/``:fast`` suffixes resolve, and
    ``claude-3-5-sonnet`` beats ``claude-3-5``). Dots normalize to hyphens (``claude-opus-4.6``)."""
    m = model.lower().replace(".", "-")
    best_key = max((key for key in _ANTHROPIC_OUTPUT_LIMITS if key in m), key=len, default=None)
    return _ANTHROPIC_OUTPUT_LIMITS[best_key] if best_key else _ANTHROPIC_DEFAULT_OUTPUT_LIMIT


def _resolve_positive_anthropic_max_tokens(value) -> Optional[int]:
    """``value`` floored to a positive int, or None when it is not a finite positive number.
    Anthropic 400s on max_tokens that are 0, negative, fractional or non-finite; the ``max_tokens
    or fallback`` idiom catches 0 but lets ``-1``/``0.5`` through. Booleans are excluded (they
    subclass int)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        if not math.isfinite(value):
            return None
    except Exception:  # e.g. OverflowError for ints too large for float
        return None
    return int(value) if int(value) > 0 else None  # int() truncates toward zero for floats


def _resolve_anthropic_messages_max_tokens(requested, model: str, context_length: Optional[int] = None) -> int:
    """``requested`` when it is a positive finite number, else the model's output ceiling. Raises
    ValueError if neither is positive. The context-window clamp is the caller's job so the
    positive-value contract stays endpoint-agnostic."""
    resolved = _resolve_positive_anthropic_max_tokens(requested) or _get_anthropic_max_output(model)
    if resolved > 0:
        return resolved
    raise ValueError(
        f"Anthropic Messages adapter requires a positive max_tokens value for "
        f"model {model!r}; got {requested!r} and no model default resolved."
    )


def _supports_adaptive_thinking(model: str) -> bool:
    """True for Claude models using adaptive thinking (4.6+): unknown Claude models default to
    adaptive, the explicit legacy list stays manual, and non-Claude models return False — except
    Kimi/Moonshot, whose Anthropic-compatible endpoints implement the adaptive contract."""
    return _model_name_is_kimi_family(model) or (
        _is_claude_model(model) and not _model_matches(model, _LEGACY_MANUAL_THINKING_CLAUDE_SUBSTRINGS)
    )


def _supports_xhigh_effort(model: str) -> bool:
    """True for models accepting the 'xhigh' effort (Opus 4.7+). Opus/Sonnet 4.6 400 on it —
    callers downgrade xhigh->max when this returns False."""
    return _supports_adaptive_thinking(model) and not _model_matches(model, _NO_XHIGH_CLAUDE_SUBSTRINGS)


def _accepts_thinking_disable(model: str) -> bool:
    """True when ``model`` accepts an explicit ``thinking: {"type": "disabled"}``. Adaptive Claude
    thinks by default, so "off" only works if the disable is sent; mandatory-thinking families
    400 on it and keep the omit behavior. Legacy manual-thinking models are opt-in via
    budget_tokens, so omission is already off. Scoped to Claude: Kimi's documented disable is
    omission, and sending it a new parameter on the strength of Claude's contract is a guess."""
    return (
        _is_claude_model(model)
        and _supports_adaptive_thinking(model)
        and not _model_matches(model, _MANDATORY_THINKING_CLAUDE_SUBSTRINGS)
    )


def _forbids_sampling_params(model: str) -> bool:
    """True for models that 400 on any non-default temperature/top_p/top_k (Opus 4.7 and later;
    unknown Claude defaults to forbidding). The 4.6 family and the legacy manual-thinking families
    still accept them. Callers omit the fields entirely — the API rejects anything non-null."""
    return _is_claude_model(model) and not _model_matches(
        model, _NO_XHIGH_CLAUDE_SUBSTRINGS + _LEGACY_MANUAL_THINKING_CLAUDE_SUBSTRINGS
    )


def _supports_fast_mode(model: str) -> bool:
    """True for models accepting ``speed: "fast"`` (Opus 4.8 / Opus 5, Claude API only). Explicit
    allowlist, not a version floor: Opus 4.6 had fast mode and lost it (requests silently run and
    bill at standard speed), Opus 4.7 hard-400s on the param. Dedicated ``...-fast`` ids select
    fast inference via the model field and must NOT also receive the speed parameter."""
    return "-fast" not in model and any(v in model for v in _FAST_MODE_SUPPORTED_SUBSTRINGS)


# Beta headers safe on ordinary/native Anthropic requests. GA on Claude 4.6+ (harmless no-op
# there) but older Claude and compatible endpoints still gate on them. Do NOT add
# ``context-1m-2025-08-07``: accounts without the long-context beta get HTTP 400, breaking short
# auxiliary calls. Bedrock/Azure still need it for 1M context and opt in on their own paths.
# MiniMax's Anthropic-compatible endpoints fail tool-use requests when the tool-streaming beta is
# present. ``_FAST_MODE_BETA`` enables the ``speed: "fast"`` request parameter.
_TOOL_STREAMING_BETA = "fine-grained-tool-streaming-2025-05-14"
_COMMON_BETAS = ["interleaved-thinking-2025-05-14", _TOOL_STREAMING_BETA]
_CONTEXT_1M_BETA = "context-1m-2025-08-07"
_FAST_MODE_BETA = "fast-mode-2026-02-01"


def _common_betas_for_base_url(base_url: str | None) -> list[str]:
    """Beta headers safe for the configured endpoint. MiniMax (Bearer-auth) rejects both the
    fine-grained-tool-streaming beta (every tool-use message errors) and the 1M-context beta.
    Azure AI Foundry also uses Bearer auth but keeps both — it needs the 1M beta for 1M context,
    which native Anthropic does not get by default (Bedrock opts in via its own client helper)."""
    betas = list(_COMMON_BETAS)
    if _base_url_needs_context_1m_beta(base_url):
        betas.append(_CONTEXT_1M_BETA)
    if _is_minimax_anthropic_endpoint(base_url):
        return [b for b in betas if b not in (_TOOL_STREAMING_BETA, _CONTEXT_1M_BETA)]
    return betas


def _beta_header(betas: list) -> Dict[str, str]:
    """``{"anthropic-beta": ...}`` when there are betas, else ``{}``."""
    return {"anthropic-beta": ",".join(betas)} if betas else {}


def _attribution_headers() -> Dict[str, str]:
    """Same client-attribution set sent to OpenRouter / Vercel AI Gateway / Fireworks."""
    return {
        "HTTP-Referer": "https://cryozenai.github.io/cryozen-agent", "X-Title": "Cryozen Agent",
        "User-Agent": f"CryozenAgent/{_CRYOZEN_VERSION}",
    }


def _client_timeout(timeout):
    """httpx.Timeout with the caller's read timeout (default 900s) and a 10s connect."""
    from httpx import Timeout
    read = timeout if (isinstance(timeout, (int, float)) and timeout > 0) else 900.0
    return Timeout(timeout=float(read), connect=10.0)


def _base_client_kwargs(base_url, timeout) -> tuple[str, Dict[str, Any]]:
    """Shared SDK constructor kwargs -> ``(normalized_base_url, kwargs)``. Retry is delegated to
    cryozen's outer loop (``max_retries=0``): the SDK default of 2 uses its own backoff that ignores
    Retry-After and double-retries inside our loop. Any trailing ``/v1`` is stripped because the
    SDK appends ``/v1/messages``. Azure's ``api-version`` goes through ``default_query`` so the
    base_url is not corrupted into ``/anthropic?api-version=.../v1/messages``."""
    kwargs: Dict[str, Any] = {"timeout": _client_timeout(timeout), "max_retries": 0}
    normalized = re.sub(r"/v1/?$", "", _normalize_base_url_text(base_url).rstrip("/"))
    if normalized:
        kwargs["base_url"] = normalized
        if _is_azure_anthropic_endpoint(normalized) and "api-version" not in normalized:
            kwargs["default_query"] = {"api-version": "2025-04-15"}
    return normalized, kwargs


def _build_anthropic_client_with_bearer_hook(token_provider, base_url: str = None, timeout: float = None):
    """Anthropic-on-Foundry Entra ID variant of :func:`build_anthropic_client`. The SDK stores
    ``api_key``/``auth_token`` as static strings, so per-request bearer refresh (Microsoft's
    documented Foundry pattern) uses a custom ``httpx.Client`` whose request hook mints a fresh JWT
    and rewrites ``Authorization``; the SDK skips its own auth when ``http_client`` is given. The
    placeholder ``auth_token`` is still required at construction and makes any leak diagnosable."""
    sdk = _require_sdk("Azure Foundry Anthropic-style endpoints with Entra ID auth", verb="Install with")
    normalize_proxy_env_vars()
    from agent.azure_identity_adapter import build_bearer_http_client
    normalized_base_url, kwargs = _base_client_kwargs(base_url, timeout)
    kwargs["http_client"] = build_bearer_http_client(token_provider, timeout=kwargs["timeout"])
    kwargs["auth_token"] = "entra-id-bearer-via-http-hook"
    headers = _beta_header(_common_betas_for_base_url(normalized_base_url))
    return _new_sdk_client(sdk, kwargs, headers, route=base_url)


def _new_sdk_client(sdk, kwargs: Dict[str, Any], headers: Dict[str, str], route: str = None):
    """``sdk.Anthropic(**kwargs)`` with ``headers`` attached, sending exactly ONE credential.
    ``route`` is the caller's un-normalized base_url (the ``/v1`` form ``custom_providers`` entries are
    keyed by; ``kwargs["base_url"]`` has it stripped) for the per-provider ``extra_headers`` lookup.

    The SDK fills whichever of ``api_key`` / ``auth_token`` we left unset from ANTHROPIC_API_KEY /
    ANTHROPIC_AUTH_TOKEN in the environment (both loaded from ~/.cryozen-agent/.env) and then sends dual
    auth — x-api-key *and* Authorization: Bearer — shipping a foreign credential to MiniMax
    / Entra / third-party endpoints (#26970, #105774). An ``Omit()`` default header is the
    SDK-sanctioned way to drop the other header, and unlike an attribute clear it survives
    ``with_options()``, which re-runs the constructor and re-reads the environment."""
    merged = dict(headers)
    if "api_key" in kwargs and "auth_token" not in kwargs:
        merged["Authorization"] = sdk.Omit()
    elif "auth_token" in kwargs and "api_key" not in kwargs:
        merged["X-Api-Key"] = sdk.Omit()
    # Per-provider ``custom_providers[].extra_headers`` last: the most specific config level wins
    # over the SDK User-Agent and the attribution/beta sets above, on every builder path (init,
    # /model switch, rebuild, auxiliary) — the OpenAI-wire clients already do this (#24293, #9721).
    merged.update(_custom_provider_extra_headers(route or kwargs.get("base_url")))
    if merged:
        kwargs["default_headers"] = merged
    return sdk.Anthropic(**kwargs)


def _custom_provider_extra_headers(base_url) -> Dict[str, str]:
    """``extra_headers`` of the ``custom_providers`` entry routed at *base_url*, else ``{}``.
    SECURITY: values routinely carry credentials (Cloudflare Access tokens) — never log them."""
    if not base_url:
        return {}
    try:
        from cryozen_cli.config import get_custom_provider_extra_headers
        return get_custom_provider_extra_headers(str(base_url))
    except Exception:
        logger.debug("custom-provider extra_headers skipped for Anthropic client", exc_info=True)
        return {}


def _auth_style(base_url, normalized_base_url) -> str:
    """Order-sensitive endpoint/key classification for :func:`build_anthropic_client`. ``kimi``:
    Kimi's /coding endpoint 403s without a User-Agent (the Kimi team asked for proper attribution).
    ``bearer``: MiniMax & co. want Authorization: Bearer. ``api_key``: native Anthropic and
    third-party proxies using x-api-key keys."""
    if _is_kimi_coding_endpoint(base_url):
        return "kimi"
    if _requires_bearer_auth(normalized_base_url):
        return "bearer"
    return "api_key"


def build_anthropic_client(api_key, base_url: str = None, timeout: float = None):
    """Create an Anthropic client. ``api_key`` is a static ``str`` or a ``Callable[[], str]`` Entra
    ID bearer provider (routed through :func:`_build_anthropic_client_with_bearer_hook`).
    ``timeout`` overrides the 900s read timeout (connect stays 10s)."""
    sdk = _require_sdk("the Anthropic provider")
    if callable(api_key) and not isinstance(api_key, str):
        return _build_anthropic_client_with_bearer_hook(api_key, base_url, timeout)
    normalize_proxy_env_vars()
    normalized_base_url, kwargs = _base_client_kwargs(base_url, timeout)
    if "default_query" in kwargs:  # historical: this path also strips a stray trailing slash on Azure
        kwargs["base_url"] = normalized_base_url.rstrip("/")
    style = _auth_style(base_url, normalized_base_url)
    kwargs["auth_token" if style == "bearer" else "api_key"] = api_key
    headers = _beta_header(_common_betas_for_base_url(normalized_base_url))
    if style == "kimi":
        headers = {**_attribution_headers(), **headers}
    if _is_opencode_endpoint(base_url):
        # OpenCode identifies clients by request headers (like OpenRouter). The OpenAI-wire paths
        # get these from profile.default_headers, but this route never sees the profile.
        for k, v in _attribution_headers().items():
            headers.setdefault(k, v)
    return _new_sdk_client(sdk, kwargs, headers, route=base_url)


def build_anthropic_bedrock_client(region: str):
    """AnthropicBedrock client for Bedrock Claude models (boto3 default credential chain). The
    SDK's native Bedrock adapter gives full Claude feature parity (prompt caching, thinking
    budgets, adaptive thinking, fast mode) that Converse lacks. The common betas plus
    ``context-1m-2025-08-07`` are attached: without the latter Bedrock caps Opus 4.6/4.7 at 200K.
    A configured ``bedrock.guardrail`` rides as InvokeModel headers so every client built here
    (primary, auxiliary, per-request rebuild) enforces it."""
    from agent.bedrock_adapter import bedrock_guardrail_headers, scoped_aws_session_kwargs
    sdk = _require_sdk("the Bedrock provider")
    if not hasattr(sdk, "AnthropicBedrock"):
        raise ImportError("anthropic.AnthropicBedrock not available. Upgrade with: pip install 'anthropic>=0.39.0'")
    # Routed multiplex profile: its own AWS_* from the secret scope (the SDK would otherwise read the
    # launch profile's process env); unscoped passes nothing and keeps the default chain.
    scoped = scoped_aws_session_kwargs()
    aws_kwargs = {"aws_access_key": scoped.get("aws_access_key_id"), "aws_secret_key": scoped.get("aws_secret_access_key"),
                  "aws_session_token": scoped.get("aws_session_token"), "aws_profile": scoped.get("profile_name")}
    return sdk.AnthropicBedrock(
        aws_region=region, timeout=_client_timeout(None), **{k: v for k, v in aws_kwargs.items() if v},
        max_retries=0,  # retry belongs to cryozen's outer loop (honors Retry-After)
        default_headers={**_beta_header([*_COMMON_BETAS, _CONTEXT_1M_BETA]), **bedrock_guardrail_headers()},
    )


def _thinking_kwargs(reasoning_config: Dict[str, Any], model: str, effective_max_tokens: int) -> Dict[str, Any]:
    """Map ``reasoning_config`` to Anthropic thinking kwargs. Adaptive models (Claude 4.6+,
    Kimi/Moonshot) get ``thinking.type=adaptive`` + ``output_config.effort``; older models and
    manual-only compat endpoints (MiniMax) get budget_tokens. Haiku has no extended thinking. On
    4.7+ ``thinking.display`` defaults to "omitted", hiding the reasoning Cryozen shows in its CLI,
    so "summarized" is requested to keep the activity feed populated."""
    if reasoning_config.get("enabled") is False:
        # Adaptive models think by DEFAULT, so omitting the parameter is not a disable — the user
        # silently keeps paying. Mandatory-thinking models 400 on the disable, so they keep the
        # omission: a silently-ignored disable beats a dead turn.
        return {"thinking": {"type": "disabled"}} if _accepts_thinking_disable(model) else {}
    if "haiku" in model.lower():
        return {}
    effort = str(reasoning_config.get("effort", "medium")).lower()
    if _supports_adaptive_thinking(model):
        adaptive_effort = ADAPTIVE_EFFORT_MAP.get(effort, "medium")
        if adaptive_effort == "xhigh" and not _supports_xhigh_effort(model):
            adaptive_effort = "max"
        return {"thinking": {"type": "adaptive", "display": "summarized"}, "output_config": {"effort": adaptive_effort}}
    budget = THINKING_BUDGET.get(effort, 8000)
    return {
        "thinking": {"type": "enabled", "budget_tokens": budget},
        "temperature": 1,  # required when thinking is enabled on older models
        "max_tokens": max(effective_max_tokens, budget + 4096),
    }


# OpenAI tool_choice -> Anthropic; any other string is a forced tool name.
_TOOL_CHOICE_MAP = {None: {"type": "auto"}, "auto": {"type": "auto"}, "required": {"type": "any"}}


def build_anthropic_kwargs(
    model: str, messages: List[Dict], tools: Optional[List[Dict]], max_tokens: Optional[int],
    reasoning_config: Optional[Dict[str, Any]], tool_choice: Optional[str] = None,
    preserve_dots: bool = False, context_length: Optional[int] = None,
    base_url: str | None = None, fast_mode: bool = False,
) -> Dict[str, Any]:
    """Build kwargs for anthropic.messages.create(). ``max_tokens`` is the OUTPUT cap for one
    response; ``context_length`` is the TOTAL window (input + output). ``max_tokens=None`` uses the
    model's native output ceiling; if that exceeds ``context_length`` (small local endpoints) it is
    clamped to ``context_length - 1``. The clamp ignores prompt size — callers must catch
    "max_tokens too large given prompt" and retry smaller (parse_available_output_tokens_from_error).
    ``preserve_dots`` keeps model-name
    dots (DashScope: qwen3.5-plus); a third-party ``base_url`` strips thinking signatures;
    ``fast_mode`` adds ``extra_body.speed="fast"`` plus the fast-mode beta on native Anthropic only."""
    system, anthropic_messages = convert_messages_to_anthropic(messages, base_url=base_url, model=model)
    anthropic_tools = convert_tools_to_anthropic(tools) if tools else []
    model = normalize_model_name(model, preserve_dots=preserve_dots)
    # Non-positive/non-finite values fail locally instead of 400-ing upstream.
    effective_max_tokens = _resolve_anthropic_messages_max_tokens(max_tokens, model, context_length=context_length)
    if context_length and effective_max_tokens > context_length:
        effective_max_tokens = max(context_length - 1, 1)
    kwargs: Dict[str, Any] = {"model": model, "messages": anthropic_messages, "max_tokens": effective_max_tokens}
    if system:
        kwargs["system"] = system
    if anthropic_tools:
        kwargs["tools"] = anthropic_tools
        if tool_choice == "none":
            kwargs.pop("tools", None)  # no Anthropic "none" — omit tools to prevent use
        elif tool_choice is None or isinstance(tool_choice, str):
            kwargs["tool_choice"] = _TOOL_CHOICE_MAP.get(tool_choice) or {"type": "tool", "name": tool_choice}
    # Map reasoning_config to Anthropic's thinking parameter. Claude 4.6+ models use adaptive thinking +
    # output_config.effort. Older models use manual thinking with budget_tokens. MiniMax Anthropic-compat
    # endpoints support thinking (manual mode only, not adaptive). Haiku does NOT support extended thinking
    # — skip entirely. Kimi / Moonshot models also use adaptive thinking: their Anthropic-compatible
    # endpoints (api.moonshot.cn/anthropic, api.kimi.com/coding) accept ``thinking.type="adaptive"`` +
    # ``output_config.effort``, and the replay-validation 400s that originally motivated dropping the
    # parameter (#13848) no longer occur. (Kimi on chat_completions enables thinking via extra_body in the
    # ChatCompletionsTransport — see #13503.) On 4.7+ the `thinking.display` field defaults to "omitted",
    # which silently hides reasoning text that Cryozen surfaces in its CLI. We request "summarized" so the
    # reasoning blocks stay populated — matching 4.6 behavior and preserving the activity-feed UX during
    # long tool runs.
    if reasoning_config and isinstance(reasoning_config, dict):
        kwargs.update(_thinking_kwargs(reasoning_config, model, effective_max_tokens))
    # Safety net so upstream 4.6 -> 4.7 migrations don't need coordinated edits everywhere callers
    # (auxiliary_client, ...) set sampling params.
    if _forbids_sampling_params(model):
        for key in ("temperature", "top_p", "top_k"):
            kwargs.pop(key, None)
    # Fast mode: native Anthropic only — third-party providers reject the unknown beta/param and
    # Anthropic scopes it to the Claude API (not Bedrock/Vertex/Foundry). Per-request extra_headers
    # OVERRIDE the client-level anthropic-beta header, so rebuild the full beta list.
    if fast_mode and not _is_third_party_anthropic_endpoint(base_url) and _supports_fast_mode(model):
        kwargs.setdefault("extra_body", {})["speed"] = "fast"
        kwargs["extra_headers"] = _beta_header(_common_betas_for_base_url(base_url) + [_FAST_MODE_BETA])
    return kwargs


# Keys exclusive to the OpenAI Responses / Codex shape; the Messages SDK raises ``TypeError: ...
# unexpected keyword argument`` on any of them.
_RESPONSES_ONLY_KWARGS = frozenset({"instructions", "input", "store", "parallel_tool_calls"})


def sanitize_anthropic_kwargs(api_kwargs: Any, *, log_prefix: str = "") -> Any:
    """Drop Responses-API-only keys before an Anthropic Messages SDK call. Boundary guard for
    api_mode-flip races (a concurrent auxiliary call mutating a shared agent between kwargs build
    and dispatch): a Responses-shaped payload reaching ``messages.stream()`` dies with a
    non-retryable TypeError that takes the whole turn and fallback chain with it. Mutates and
    returns ``api_kwargs``; logs a WARNING so the race stays visible."""
    leaked = _RESPONSES_ONLY_KWARGS.intersection(api_kwargs) if isinstance(api_kwargs, dict) else ()
    if leaked:
        for key in leaked:
            del api_kwargs[key]
        logger.warning(
            "%sStripped Responses-only kwarg(s) %s from an Anthropic Messages "
            "call (api_mode flip race — see #31673). The call will proceed; "
            "this breadcrumb means a kwargs build ran under a Responses "
            "api_mode while dispatch ran under anthropic_messages.",
            log_prefix,
            sorted(leaked),
        )
    return api_kwargs


def buffer_anthropic_tool_input(api_kwargs: dict[str, Any], base_url: str | None) -> None:
    """Retry knob for a malformed fine-grained tool-JSON stream (#107830): the beta streams tool
    args unvalidated, so a model that emits ``{"names": cronjob_manage}`` breaks the SDK parser
    and an identical retry breaks identically. ``eager_input_streaming: false`` per tool restores
    Anthropic's buffered, validated args for the rest of this turn (the flag lives on the turn's
    kwargs, so a later retry of the same turn keeps it; the changed ``tools`` block costs one
    prompt-cache miss, cheaper than a dead turn). Off the happy path on purpose:
    buffering a large payload is a zero-event gap the stale-stream detector kills. No-op on
    endpoints that never get the beta (MiniMax) rather than sending them an unknown field."""
    if _TOOL_STREAMING_BETA not in _common_betas_for_base_url(base_url):
        return
    for tool in api_kwargs.get("tools") or ():
        tool["eager_input_streaming"] = False


def _is_stream_unavailable_error(exc: Exception) -> bool:
    """True when an Anthropic stream call should fall back to create()."""
    err_lower = str(exc).lower()
    if "stream" in err_lower and "not supported" in err_lower:
        return True
    if "invokemodelwithresponsestream" not in err_lower:
        return False
    from agent.bedrock_adapter import is_streaming_access_denied_error
    return is_streaming_access_denied_error(exc)


def _stream_final_message(stream_fn, api_kwargs, log_prefix, on_stream_event, on_response):
    """``messages.stream()`` -> final Message, ticking the best-effort callbacks."""
    with stream_fn(**{k: v for k, v in api_kwargs.items() if k != "stream"}) as stream:
        if callable(on_response):
            try:
                on_response(getattr(stream, "response", None))
            except Exception:
                logger.debug("%son_response callback failed", log_prefix, exc_info=True)
        # Consume manually so each event ticks the progress callback; get_final_message then
        # returns the accumulated snapshot. TimeoutError is the caller's deadline seam: the host
        # has given up, so abandon the stream (``with`` closes it) instead of streaming an answer
        # nobody reads.
        # Some SDK versions drop optional message_delta metadata from the final snapshot.
        # Non-iterable shims (get_final_message-only) skip straight to the snapshot.
        stop_details = None
        for event in (stream if isinstance(stream, Iterable) else ()):
            if getattr(event, "type", None) == "message_delta":
                details = getattr(getattr(event, "delta", None), "stop_details", None)
                if details is not None:
                    stop_details = details
            if not callable(on_stream_event):
                continue
            try:
                on_stream_event(event)
            except TimeoutError:
                # The callback is the caller's deadline seam (#99692: the host waiting on this summary has
                # already given up). Abandon the stream — the ``with`` closes it — instead of streaming an
                # answer nobody will read.
                raise
            except Exception:
                logger.debug("%son_stream_event callback failed", log_prefix, exc_info=True)
        message = stream.get_final_message()
        if stop_details is not None:
            message.stop_details = stop_details
        return message


def create_anthropic_message(
    client: Any, api_kwargs: dict, *, log_prefix: str = "", prefer_stream: bool = True,
    on_stream_event=None, on_response=None,
) -> Any:
    """Create an Anthropic message, aggregating via stream when available. Some Anthropic-compatible
    gateways are SSE-only and answer ``create()`` with ``text/event-stream``, which the SDK surfaces
    as raw text (callers then crash on ``.content``), so prefer ``messages.stream()`` like the main
    turn path and fall back to ``create()`` only for providers that explicitly don't support
    streaming (restricted Bedrock roles). Both callbacks are best-effort and fire only on the
    streaming path: ``on_stream_event(event)`` lets liveness watchdogs see forward progress;
    ``on_response(httpx_response)`` exposes headers the parsed Message drops (rate-limit and
    balance headers)."""
    sanitize_anthropic_kwargs(api_kwargs, log_prefix=log_prefix)
    messages_api = getattr(client, "messages", None)
    stream_fn = getattr(messages_api, "stream", None)
    if prefer_stream and callable(stream_fn):
        try:
            return _stream_final_message(stream_fn, api_kwargs, log_prefix, on_stream_event, on_response)
        except TimeoutError:
            raise
        except Exception as exc:
            if not _is_stream_unavailable_error(exc):
                raise
            logger.debug(
                "%sAnthropic Messages stream unavailable; falling back to messages.create(): %s", log_prefix, exc
            )
    return messages_api.create(**{k: v for k, v in api_kwargs.items() if k != "stream"})


# ---- BEGIN PLUGIN-COMPAT (revert-scheduled; see COMPAT_MANIFEST.md) ----
# Names external plugins imported from this module before the Sep 2026 decomposition.
# Internal code MUST NOT use these (scripts/check_compat_pointers.py fails CI if it does).
# The whole block is removed by reverting the commit that added it.
from pathlib import Path  # noqa: F401,E402
from typing import Tuple  # noqa: F401,E402
import copy  # noqa: F401,E402
import json  # noqa: F401,E402
import os  # noqa: F401,E402
import platform  # noqa: F401,E402
import secrets  # noqa: F401,E402
import stat  # noqa: F401,E402
from urllib.parse import urlparse  # noqa: F401,E402


_PLUGIN_COMPAT_LAZY = {
    'base_url_host_matches': ('utils', 'base_url_host_matches'),
    'base_url_hostname': ('utils', 'base_url_hostname'),
    'get_cryozen_home': ('cryozen_constants', 'get_cryozen_home'),
    'resolve_anthropic_token': ('agent.anthropic_credentials', 'resolve_anthropic_token'),
}


def __getattr__(name):  # PEP 562 — lazy so no import cycles
    target = _PLUGIN_COMPAT_LAZY.get(name)
    if target is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    import importlib
    from cryozen_cli.plugin_compat import warn_once
    warn_once(__name__, name, *target)
    return getattr(importlib.import_module(target[0]), target[1])
# ---- END PLUGIN-COMPAT ----
