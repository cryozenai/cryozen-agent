"""Setup-completion summary (tool availability + "Setup Complete!" banner). setup.py names are
resolved through the module object so test patches on ``cryozen_cli.setup.<name>`` take effect."""

import logging

logger = logging.getLogger("cryozen_cli.setup")

# provider -> (label, env vars: any one set means available; empty = always).
# Local engines are (label, module, hint) and must be importable.
_TTS_SUMMARY_ROWS = {
    "elevenlabs": ("ElevenLabs", ("ELEVENLABS_API_KEY",)),
    "openai": ("OpenAI", ("VOICE_TOOLS_OPENAI_KEY", "OPENAI_API_KEY")),
    "minimax": ("MiniMax", ("MINIMAX_API_KEY",)), "mistral": ("Mistral Voxtral", ("MISTRAL_API_KEY",)),
    "gemini": ("Google Gemini", ("GEMINI_API_KEY", "GOOGLE_API_KEY")),
    "neutts": ("NeuTTS", "neutts", "run 'cryozen setup tts'"),
    "kittentts": ("KittenTTS", "kittentts", "run 'cryozen setup tts'")}
_TTS_SUMMARY_DEFAULT = ("Edge TTS", ())
_STT_SUMMARY_ROWS = {
    "openai": ("OpenAI", ("VOICE_TOOLS_OPENAI_KEY", "OPENAI_API_KEY")), "groq": ("Groq Whisper", ("GROQ_API_KEY",)),
    "elevenlabs": ("ElevenLabs Scribe", ("ELEVENLABS_API_KEY",)), "xai": ("xAI", ()),
    "deepinfra": ("DeepInfra", ("DEEPINFRA_API_KEY",))}
_STT_SUMMARY_DEFAULT = ("Local Whisper", "faster_whisper", "run 'cryozen tools' → Speech-to-Text")

# Browser "missing" hint keyed by the configured provider; anything else gets the generic hint.
_BROWSER_MISSING_HINTS = {
    "Browserbase": "npm install -g agent-browser and set BROWSERBASE_API_KEY/BROWSERBASE_PROJECT_ID",
    "Browser Use": "npm install -g agent-browser and set BROWSER_USE_API_KEY",
    "Camofox": "CAMOFOX_URL",
    "Local browser": "npm install -g agent-browser && agent-browser install --with-deps"}
_BROWSER_MISSING_DEFAULT = "npm install -g agent-browser, set CAMOFOX_URL, or configure Browser Use or Browserbase"
_BROWSER_LABELS = {"browserbase": "Browserbase", "browser-use": "Browser Use", "firecrawl": "Firecrawl",
                   "camofox": "Camofox", "local": "Local browser"}
_WEB_MISSING = ("EXA_API_KEY, PARALLEL_API_KEY, FIRECRAWL_API_KEY/FIRECRAWL_API_URL, TAVILY_API_KEY, "
                "PERPLEXITY_API_KEY, KEENABLE_API_KEY, or SEARXNG_URL")

_DONE_BANNER = (
    "┌─────────────────────────────────────────────────────────┐",
    "│              ✓ Setup Complete!                          │",
    "└─────────────────────────────────────────────────────────┘")
# (command, description) rows; the description carries its own alignment padding.
_EDIT_WIZARD_ROWS = (
    ("cryozen setup", "          Re-run the full wizard"), ("cryozen setup model", "    Change model/provider"),
    ("cryozen setup terminal", " Change terminal backend"), ("cryozen setup gateway", "  Configure messaging"),
    ("cryozen setup tools", "    Configure tool providers"))
_EDIT_CONFIG_ROWS = (
    ("cryozen config", "         View current settings"), ("cryozen config edit", "    Open config in your editor"),
    ("cryozen config set <key> <value>", ""))
_READY_ROWS = (
    ("cryozen", "              Start chatting"), ("cryozen gateway", "      Start messaging gateway"),
    ("cryozen doctor", "       Check for issues"))


def _voice_provider_status(kind: str, provider: str, rows: dict, default: tuple) -> tuple:
    """Summary row for a TTS/STT provider. A keyed provider whose key is missing
    falls through to the default row, matching the runtime fallback."""
    row = rows.get(provider, default)
    if isinstance(row[1], tuple) and row[1] and not any(_setup.get_env_value(v) for v in row[1]):
        row = default
    if isinstance(row[1], tuple):
        return (f"{kind} ({row[0]})", True, None)
    label, module, hint = row
    if _setup._module_installed(module):
        return (f"{kind} ({label}{' local' if kind == 'Text-to-Speech' else ''})", True, None)
    return (f"{kind} ({label} — not installed)", False, hint)


def _first_available_plugin_provider(registry: str, skip: str = None):
    """display_name of the first plugin-registered provider in ``agent.<registry>`` that reports
    available (fail-soft: any error means none), skipping ``skip``."""
    try:
        import importlib
        from cryozen_cli.plugins import _ensure_plugins_discovered
        _ensure_plugins_discovered()
        for provider in importlib.import_module(f"agent.{registry}").list_providers():
            if provider.name == skip:
                continue
            try:
                if provider.is_available():
                    return provider.display_name
            except Exception:
                continue
    except Exception:
        pass
    return None


# ---- tool_status row builders: each takes the config and returns a (name, available, hint)
# row or None (row omitted). Evaluated in _TOOL_ROW_BUILDERS order.

def _vision_row(config):
    # Use the same runtime resolver as the actual vision tools.
    try:
        from agent.auxiliary_client import get_available_vision_backends
        ok = bool(get_available_vision_backends())
    except Exception:
        ok = False
    return ("Vision (image analysis)", ok, None if ok else "run 'cryozen setup' to configure")


def _web_row(config):
    # Web tools (Exa, Parallel, Firecrawl, Tavily, Keenable, SearXNG, keyless tiers): the runtime check.
    try:
        from tools.web_tools import _get_backend, check_web_api_key
        if check_web_api_key():
            backend = _get_backend()
            return (f"Web Search & Extract ({backend})" if backend else "Web Search & Extract", True, None)
    except Exception:
        pass
    return ("Web Search & Extract", False, _WEB_MISSING)


def _browser_provider_state(config) -> tuple:
    """``(provider key, available)`` using the same precedence as runtime: an explicit
    ``browser.cloud_provider`` wins, else CAMOFOX_URL, Browser Use key, Browserbase keys, local."""
    from cryozen_cli.tools_config_post_setup import _has_agent_browser, _local_browser_runnable
    from tools.tool_backend_helpers import normalize_browser_cloud_provider
    env = _setup.get_env_value
    browser_cfg = config.get("browser") if isinstance(config.get("browser"), dict) else {}
    cli = _has_agent_browser()
    ready = {
        "camofox": lambda: bool(env("CAMOFOX_URL")),
        "browser-use": lambda: cli and bool(env("BROWSER_USE_API_KEY")),
        "browserbase": lambda: cli and bool(env("BROWSERBASE_API_KEY") and env("BROWSERBASE_PROJECT_ID")),
        "firecrawl": lambda: cli and bool(env("FIRECRAWL_API_KEY") or env("FIRECRAWL_API_URL")),
    }
    if "cloud_provider" in browser_cfg:
        provider = normalize_browser_cloud_provider(browser_cfg.get("cloud_provider"))
        if provider in ready:
            return provider, ready[provider]()
        return "local", _local_browser_runnable()
    for provider in ("camofox", "browser-use", "browserbase"):
        if ready[provider]():
            return provider, True
    return "local", _local_browser_runnable()


def _browser_row(config):
    # Browser tools (local Chromium, Camofox, Browserbase, Browser Use, or Firecrawl)
    provider, available = _browser_provider_state(config)
    label = _BROWSER_LABELS.get(provider, provider)
    if available:
        return (f"Browser Automation ({label})", True, None)
    return ("Browser Automation", False, _BROWSER_MISSING_HINTS.get(label, _BROWSER_MISSING_DEFAULT))


def _image_gen_row(config):
    # FAL, or any plugin-registered provider (OpenAI, etc.)
    from tools.tool_backend_helpers import fal_key_is_configured
    if fal_key_is_configured():
        return ("Image Generation", True, None)
    # Probe plugin-registered providers so OpenAI-only setups don't show as "missing FAL_KEY".
    backend = _first_available_plugin_provider("image_gen_registry", skip="fal")
    if backend:
        return (f"Image Generation ({backend})", True, None)
    return ("Image Generation", False, "FAL_KEY or OPENAI_API_KEY")


def _video_gen_row(config):
    # Opt-in via `cryozen tools` → Video Generation. Only show the row when a plugin reports
    # available so we don't badger users who don't care about video gen with a "missing" line.
    backend = _first_available_plugin_provider("video_gen_registry")
    return (f"Video Generation ({backend})", True, None) if backend else None


def _tts_row(config):
    # Configured provider, gated on its key (or local install)
    provider = _setup.cfg_get(config, "tts", "provider", default="edge")
    return _voice_provider_status("Text-to-Speech", provider, _TTS_SUMMARY_ROWS, _TTS_SUMMARY_DEFAULT)


def _stt_row(config):
    provider = _setup.cfg_get(config, "stt", "provider", default="local") or "local"
    return _voice_provider_status("Speech-to-Text", provider, _STT_SUMMARY_ROWS, _STT_SUMMARY_DEFAULT)


def _modal_row(config):
    if _setup.cfg_get(config, "terminal", "backend") != "modal":
        return None
    from tools.tool_backend_helpers import has_direct_modal_credentials
    if has_direct_modal_credentials():
        return ("Modal Execution", True, None)
    return ("Modal Execution", False, "run 'cryozen setup terminal'")


def _home_assistant_row(config):
    return ("Smart Home (Home Assistant)", True, None) if _setup.get_env_value("HASS_TOKEN") else None


def _spotify_row(config):
    # OAuth via cryozen auth spotify — check auth.json, not env vars
    try:
        from cryozen_cli.auth import get_provider_auth_state
        state = get_provider_auth_state("spotify") or {}
        if state.get("access_token") or state.get("refresh_token"):
            return ("Spotify (PKCE OAuth)", True, None)
    except Exception:
        pass
    return None


def _skills_hub_row(config):
    ok = bool(_setup.get_env_value("GITHUB_TOKEN"))
    return ("Skills Hub (GitHub)", ok, None if ok else "GITHUB_TOKEN")


def _always_on_rows(config):
    # Terminal (system deps met), task planning (in-memory), skills (bundled + user-created).
    return [("Terminal/Commands", True, None), ("Task Planning (todo)", True, None),
            ("Skills (view, create, edit)", True, None)]


_TOOL_ROW_BUILDERS = (
    _vision_row, _web_row, _browser_row, _image_gen_row, _video_gen_row, _tts_row, _stt_row,
    _modal_row, _home_assistant_row, _spotify_row, _skills_hub_row, _always_on_rows)


def _print_cmd_rows(rows):
    """Print (command, description) rows as '   <green cmd><desc>'."""
    for cmd, desc in rows:
        print(f"   {_setup.color(cmd, _setup.Colors.GREEN)}{desc}")


def _print_section_header(title):
    print(_setup.color("─" * 60, _setup.Colors.DIM), end="\n\n")
    print(_setup.color(title, _setup.Colors.CYAN, _setup.Colors.BOLD), end="\n\n")


def _print_setup_summary(config: dict, cryozen_home):
    """Print the setup completion summary."""
    from cryozen_constants import display_cryozen_home as _dhh
    # Provider readiness — the one thing setup must produce. A user who cancelled the API-key
    # prompt mid-wizard used to exit "successfully" with NO working model; say so loudly.
    try:
        from cryozen_cli.auth import resolve_provider
        resolve_provider()
    except Exception:
        print()
        _setup.print_warning("No inference provider is configured — Cryozen cannot chat yet.")
        _setup._info("  Finish this one step with either of:",
              "    cryozen model            (pick any provider/model)",
              "    cryozen setup            (guided provider + API key setup)")

    print()
    _setup.print_header("Tool Availability Summary")

    tool_status = []
    for build in _TOOL_ROW_BUILDERS:
        row = build(config)
        tool_status.extend(row if isinstance(row, list) else [] if row is None else [row])

    available_count = sum(1 for _, avail, _ in tool_status if avail)
    _setup._info(f"{available_count}/{len(tool_status)} tool categories available:", None)
    for name, available, missing_var in tool_status:
        print(f"   {_setup.color('✓', _setup.Colors.GREEN)} {name}" if available else
              f"   {_setup.color('✗', _setup.Colors.RED)} {name} "
              f"{_setup.color(f'(missing {missing_var})', _setup.Colors.DIM)}")
    print()

    if available_count < len(tool_status):
        _setup.print_warning("Some tools are disabled. Run 'cryozen setup tools' to configure them,")
        _setup.print_warning(f"or edit {_dhh()}/.env directly to add the missing API keys.")
        print()

    print()
    for line in _DONE_BANNER:
        print(_setup.color(line, _setup.Colors.GREEN))
    print()
    print(_setup.color(f"📁 All your files are in {_dhh()}/:", _setup.Colors.CYAN, _setup.Colors.BOLD), end="\n\n")
    for label, value in (("Settings:", f"  {_setup.get_config_path()}"), ("API Keys:", f"  {_setup.get_env_path()}"),
                         ("Data:", f"      {cryozen_home}/cron/, sessions/, logs/")):
        print(f"   {_setup.color(label, _setup.Colors.YELLOW)}{value}")
    print()

    _print_section_header("📝 To edit your configuration:")
    _print_cmd_rows(_EDIT_WIZARD_ROWS)
    print()
    _print_cmd_rows(_EDIT_CONFIG_ROWS)
    print("                          Set a specific value\n\n   Or edit the files directly:")
    for path in (_setup.get_config_path(), _setup.get_env_path()):
        print(f"   {_setup.color(f'nano {path}', _setup.Colors.DIM)}")
    print()

    _print_section_header("🚀 Ready to go!")
    _print_cmd_rows(_READY_ROWS)
    print()


import cryozen_cli.setup as _setup  # noqa: E402  (bottom: cryozen_cli.setup imports this module)
