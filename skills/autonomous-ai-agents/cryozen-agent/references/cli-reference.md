# Cryozen CLI Reference

Live sources when anything looks stale: `cryozen --help`, `cryozen <command> --help`,
https://cryozenai.github.io/cryozen-agent/docs/reference/cli-commands

### Global Flags

```
cryozen [flags] [command]        (no subcommand = interactive chat)

  --version, -V             Show version
  -z, --oneshot PROMPT      One-shot: print ONLY the final response (for scripts/pipes)
  -m MODEL  --provider P    Model/provider override for this invocation
  -t, --toolsets LIST       Comma-separated toolsets for this invocation
  --resume, -r SESSION      Resume session by ID or title
  --continue, -c [NAME]     Resume by name, or most recent session
  --worktree, -w            Isolated git worktree mode (parallel agents)
  --skills, -s SKILL        Preload skills (comma-separate or repeat)
  --profile, -p NAME        Use a named profile
  --yolo                    Skip dangerous command approval
  --tui / --cli             Force the Ink TUI / classic REPL
  --ignore-rules            Skip AGENTS.md/SOUL.md/memory/skill injection
  --safe-mode               Disable ALL customizations (troubleshooting)
  --pass-session-id         Include session ID in system prompt
```

### Chat

```
cryozen chat [flags]
  -q, --query TEXT          Single query, non-interactive
  --image PATH              Attach a local image to a single query
  -Q, --quiet               Suppress banner, spinner, tool previews
  --checkpoints             Enable filesystem checkpoints (/rollback)
  --max-turns N             Cap tool-calling iterations
  --source TAG              Session source tag (default: cli)
```
(plus the global flags above)

### Configuration

```
cryozen setup [section]      Wizard (model|tts|terminal|gateway|tools|agent)
cryozen model                Interactive model/provider picker
cryozen fallback [add|remove|list]  Fallback provider chain
cryozen config [show|edit|get|set|unset|path|env-path|check|migrate]
cryozen login / logout       OAuth sign-in / clear stored auth
cryozen doctor [--fix]       Check dependencies and config
cryozen status [--all]       Component status
```

### Tools & Skills

```
cryozen tools [list|enable NAME|disable NAME]   Per-platform toolsets (curses UI with no args)

cryozen skills list|browse|search QUERY|inspect ID
cryozen skills install ID    Hub identifier OR a direct https://…/SKILL.md URL
cryozen skills config        Enable/disable skills per platform
cryozen skills check|update|uninstall|publish PATH
cryozen skills tap add REPO  Add a GitHub repo as a skill source
cryozen bundles              Skill bundles (one /<name> alias loads several skills)
```

### MCP Servers

```
cryozen mcp add NAME (--url or --command) | remove | list | test NAME
cryozen mcp catalog | install NAME     Curated catalog install
cryozen mcp configure NAME             Toggle tool selection
cryozen mcp serve                      Run Cryozen as an MCP server
```
Details (transport, tool discovery, catalog): `references/native-mcp.md`.

### Gateway (Messaging Platforms)

```
cryozen gateway run|install|start|stop|restart|status|setup
```

20+ platforms: Telegram, Discord, Slack, WhatsApp (Baileys + Business Cloud API), iMessage (Photon — `cryozen photon setup`), Signal, Email, SMS, Matrix, Mattermost, Teams, LINE, SimpleX, ntfy, Google Chat, Home Assistant, DingTalk, Feishu, WeCom, Weixin, API Server, Webhooks. Open WebUI connects via the API Server adapter. Most adapters ship under `plugins/platforms/`.
Docs: https://cryozenai.github.io/cryozen-agent/docs/user-guide/messaging/

### Sessions

```
cryozen sessions list|browse|rename ID TITLE|delete ID|export OUT|prune|stats
```

### Cron / Webhooks

```
cryozen cron list|create SCHED|edit ID|pause|resume|run ID|remove|status
    Schedules: '30m', 'every 2h', '0 9 * * *', ISO timestamp
cryozen webhook subscribe NAME|list|remove NAME|test NAME
```
Webhook payloads/routes: `references/webhooks.md`.

### Profiles

```
cryozen profile list|create NAME (--clone|--clone-all|--clone-from)|use|show|delete
cryozen profile rename A B | alias NAME | export NAME | import FILE
cryozen profile migrate-identity A B   Retry a completed rename's session/routing identity migration
```

### Credentials & Pools

```
cryozen auth                 Interactive credential manager
cryozen auth add [PROVIDER]  Add OAuth or API-key credential (openai-codex, qwen-oauth, …)
cryozen auth list|remove P IDX|reset PROVIDER|status
```
Multiple credentials per provider form a pool that rotates automatically and skips exhausted keys.

### Other

```
cryozen desktop / gui        Native desktop app
cryozen dashboard            Web admin panel + embedded chat (--stop / --status)
cryozen proxy                OpenAI-compatible local proxy backed by an OAuth provider
cryozen kanban <verb>        Multi-agent work-queue board
cryozen project              Named multi-folder workspaces
cryozen skin list|use|set    Switch/tweak skins (see references/themes.md)
cryozen pets <verb>          Pet mascots (see references/petdex.md)
cryozen memory setup|status|off|reset   Memory provider
cryozen secrets bitwarden|onepassword   External secret stores
cryozen moa                  Mixture-of-Agents slots
cryozen hooks / security / backup / import / checkpoints / console
cryozen logs [-f] [errors]   View agent/error logs
cryozen send                 One-off message through a gateway platform
cryozen pairing / plugins / insights / journey / computer-use
cryozen acp                  ACP server (IDE integration)
cryozen completion bash|zsh|fish
cryozen update / uninstall / claw migrate
```

Plugin- and provider-supplied subcommands (e.g. `cryozen photon setup`) only appear once their plugin is installed/active.

### Where to Find Things

| Looking for... | Location |
|---|---|
| Config options | `cryozen config edit` · [Configuration docs](https://cryozenai.github.io/cryozen-agent/docs/user-guide/configuration) |
| Tools / toolsets | `cryozen tools list` · [Tools reference](https://cryozenai.github.io/cryozen-agent/docs/reference/tools-reference) |
| Skills catalog | `cryozen skills browse` · [Skills catalog](https://cryozenai.github.io/cryozen-agent/docs/reference/skills-catalog) |
| Provider setup | `cryozen model` · [Providers guide](https://cryozenai.github.io/cryozen-agent/docs/integrations/providers) |
| Env variables | `cryozen config env-path` · [Env vars reference](https://cryozenai.github.io/cryozen-agent/docs/reference/environment-variables) |
| Gateway logs | `~/.cryozen-agent/logs/gateway.log` (or `cryozen logs`) |
| Sessions | `cryozen sessions browse` (reads state.db) |
