---
sidebar_position: 9
title: "Optional Skills Catalog"
description: "Official optional skills shipped with cryozen-agent — install via cryozen skills install official/<category>/<skill>"
---

# Optional Skills Catalog

Optional skills ship with cryozen-agent under `optional-skills/` but are **not active by default**. Install them explicitly:

```bash
cryozen skills install official/<category>/<skill>
```

For example:

```bash
cryozen skills install official/blockchain/solana
cryozen skills install official/mlops/flash-attention
```

Each skill below links to a dedicated page with its full definition, setup, and usage.

To uninstall:

```bash
cryozen skills uninstall <skill-name>
```

## autonomous-ai-agents

| Skill | Description |
|-------|-------------|
| [**agent-merge-conflict-arbiter**](../user-guide/skills/optional/autonomous-ai-agents/autonomous-ai-agents-agent-merge-conflict-arbiter.md) | Neutral arbiter for merge conflicts between two agents. |
| [**antigravity-cli**](../user-guide/skills/optional/autonomous-ai-agents/autonomous-ai-agents-antigravity-cli.md) | Operate the Antigravity CLI (agy): plugins, auth, sandbox. |
| [**blackbox**](../user-guide/skills/optional/autonomous-ai-agents/autonomous-ai-agents-blackbox.md) | Delegate coding tasks to the Blackbox AI multi-model CLI. |
| [**dynamic-workflow**](../user-guide/skills/optional/autonomous-ai-agents/autonomous-ai-agents-dynamic-workflow.md) | Plan-in-code fan-outs, adversarial verification, waves. |
| [**grok**](../user-guide/skills/optional/autonomous-ai-agents/autonomous-ai-agents-grok.md) | Delegate coding to xAI Grok Build CLI (features, PRs). |
| [**honcho**](../user-guide/skills/optional/autonomous-ai-agents/autonomous-ai-agents-honcho.md) | Configure and troubleshoot Honcho memory for Cryozen. |
| [**openhands**](../user-guide/skills/optional/autonomous-ai-agents/autonomous-ai-agents-openhands.md) | Delegate coding to OpenHands CLI (model-agnostic, LiteLLM). |

## blockchain

| Skill | Description |
|-------|-------------|
| [**evm**](../user-guide/skills/optional/blockchain/blockchain-evm.md) | Read-only EVM client: wallets, tokens, gas across 8 chains. |
| [**hyperliquid**](../user-guide/skills/optional/blockchain/blockchain-hyperliquid.md) | Hyperliquid market data, account history, trade review. |
| [**solana**](../user-guide/skills/optional/blockchain/blockchain-solana.md) | Query Solana wallets, tokens, txs, and NFTs in USD. |

## communication

| Skill | Description |
|-------|-------------|
| [**one-three-one-rule**](../user-guide/skills/optional/communication/communication-one-three-one-rule.md) | 1-3-1 decision briefs: problem, three options, one pick. |

## creative

| Skill | Description |
|-------|-------------|
| [**ascii-art**](../user-guide/skills/optional/creative/creative-ascii-art.md) | ASCII art: pyfiglet, cowsay, boxes, image-to-ascii. |
| [**comfyui**](../user-guide/skills/optional/creative/creative-comfyui.md) | Generate images, video, and audio via diffusion workflows. |
| [**concept-diagrams**](../user-guide/skills/optional/creative/creative-concept-diagrams.md) | Generate flat, minimal educational SVG visuals as HTML. |
| [**excalidraw**](../user-guide/skills/optional/creative/creative-excalidraw.md) | Hand-drawn Excalidraw JSON diagrams (arch, flow, seq). |
| [**heartmula**](../user-guide/skills/optional/creative/creative-heartmula.md) | HeartMuLa: Suno-like song generation from lyrics + tags. |
| [**meme-generation**](../user-guide/skills/optional/creative/creative-meme-generation.md) | Create meme PNGs from templates with Pillow text overlay. |
| [**pretext**](../user-guide/skills/optional/creative/creative-pretext.md) | Build creative browser demos with DOM-free text layout. |
| [**social-media-content-calendar**](../user-guide/skills/optional/creative/creative-social-media-content-calendar.md) | Plan multi-platform social campaigns: briefs to posting. |
| [**tldraw-offline**](../user-guide/skills/optional/creative/creative-tldraw-offline.md) | Drive and script tldraw offline canvases with an agent. |
| [**unreal-mcp**](../user-guide/skills/optional/creative/creative-unreal-mcp.md) | Automate Unreal Engine editor scenes, actors, and renders. |

## data-science

| Skill | Description |
|-------|-------------|
| [**jupyter-notebook**](../user-guide/skills/optional/data-science/data-science-jupyter-notebook.md) | Iterative Python via live Jupyter kernel (hamelnb). |

## devops

| Skill | Description |
|-------|-------------|
| [**actual-setup**](../user-guide/skills/optional/devops/devops-actual-setup.md) | Set up Actual Computer (actual.inc) inference in Cryozen. |
| [**cryozen-s6-container-supervision**](../user-guide/skills/optional/devops/devops-cryozen-s6-container-supervision.md) | Modify or debug s6 services in the Cryozen Docker image. |
| [**docker-management**](../user-guide/skills/optional/devops/devops-docker-management.md) | Manage Docker containers, images, volumes, and Compose. |
| [**inference-sh-cli**](../user-guide/skills/optional/devops/devops-inference-sh-cli.md) | Run 150+ AI apps (image, video, LLM) via inference.sh CLI. |
| [**pinggy-tunnel**](../user-guide/skills/optional/devops/devops-pinggy-tunnel.md) | Zero-install localhost tunnels over SSH via Pinggy. |
| [**watchers**](../user-guide/skills/optional/devops/devops-watchers.md) | Poll RSS, JSON APIs, and GitHub with watermark dedup. |

## email

| Skill | Description |
|-------|-------------|
| [**agentmail**](../user-guide/skills/optional/email/email-agentmail.md) | Use when an agent needs AgentMail CLI email inboxes. |

## finance

| Skill | Description |
|-------|-------------|
| [**polymarket**](../user-guide/skills/optional/finance/finance-polymarket.md) | Query Polymarket: markets, prices, orderbooks, history. |
| [**stocks**](../user-guide/skills/optional/finance/finance-stocks.md) | Stock quotes, history, search, compare, crypto via Yahoo. |

## gaming

| Skill | Description |
|-------|-------------|
| [**minecraft-modpack-server**](../user-guide/skills/optional/gaming/gaming-minecraft-modpack-server.md) | Host modded Minecraft servers (CurseForge, Modrinth). |

## health

| Skill | Description |
|-------|-------------|
| [**fitness-nutrition**](../user-guide/skills/optional/health/health-fitness-nutrition.md) | Workout planning, macros, and body metrics via wger/USDA. |
| [**neuroskill-bci**](../user-guide/skills/optional/health/health-neuroskill-bci.md) | Use live BCI cognitive and mood state from NeuroSkill. |

## mcp

| Skill | Description |
|-------|-------------|
| [**fastmcp**](../user-guide/skills/optional/mcp/mcp-fastmcp.md) | Build, test, and deploy Python MCP servers. |
| [**mcp-oauth-remote-gateway**](../user-guide/skills/optional/mcp/mcp-mcp-oauth-remote-gateway.md) | Manual OAuth for remote MCP servers on headless gateways. |
| [**mcporter**](../user-guide/skills/optional/mcp/mcp-mcporter.md) | List, auth, and call MCP servers/tools from the terminal. |

## migration

| Skill | Description |
|-------|-------------|
| [**openclaw-migration**](../user-guide/skills/optional/migration/migration-openclaw-migration.md) | Import an OpenClaw setup (memories, skills) into Cryozen. |

## mlops

| Skill | Description |
|-------|-------------|
| [**obliteratus**](../user-guide/skills/optional/mlops/mlops-obliteratus.md) | OBLITERATUS: abliterate LLM refusals (diff-in-means). |

## payments

| Skill | Description |
|-------|-------------|
| [**mpp-agent**](../user-guide/skills/optional/payments/payments-mpp-agent.md) | Pay HTTP 402 APIs via Machine Payments Protocol (MPP). |
| [**stripe-link-cli**](../user-guide/skills/optional/payments/payments-stripe-link-cli.md) | Agent payments via Stripe Link — cards, SPT, approvals. |
| [**stripe-projects**](../user-guide/skills/optional/payments/payments-stripe-projects.md) | Provision SaaS services + sync creds via Stripe Projects. |

## productivity

| Skill | Description |
|-------|-------------|
| [**canvas**](../user-guide/skills/optional/productivity/productivity-canvas.md) | Fetch Canvas LMS courses and assignments via API token. |
| [**live-dashboard**](../user-guide/skills/optional/productivity/productivity-live-dashboard.md) | Build self-updating dashboards from live sources. |
| [**property-listings**](../user-guide/skills/optional/productivity/productivity-property-listings.md) | Present property and rental listings as desktop cards. |
| [**shop**](../user-guide/skills/optional/productivity/productivity-shop.md) | Shop catalog search, checkout, order tracking, returns. |
| [**shopify**](../user-guide/skills/optional/productivity/productivity-shopify.md) | Query Shopify Admin/Storefront GraphQL APIs via curl. |
| [**siyuan**](../user-guide/skills/optional/productivity/productivity-siyuan.md) | Query and edit a SiYuan knowledge base via its API. |
| [**telephony**](../user-guide/skills/optional/productivity/productivity-telephony.md) | Provision Twilio numbers, SMS/MMS, and AI outbound calls. |

## research

| Skill | Description |
|-------|-------------|
| [**bioinformatics**](../user-guide/skills/optional/research/research-bioinformatics.md) | Gateway to 400+ genomics and computational biology skills. |
| [**darwinian-evolver**](../user-guide/skills/optional/research/research-darwinian-evolver.md) | Evolve prompts/regex/SQL/code with Imbue's evolution loop. |
| [**domain-intel**](../user-guide/skills/optional/research/research-domain-intel.md) | Passive recon of subdomains, SSL certs, WHOIS, and DNS. |
| [**drug-discovery**](../user-guide/skills/optional/research/research-drug-discovery.md) | Drug discovery: ChEMBL search, drug-likeness, interactions. |
| [**duckduckgo-search**](../user-guide/skills/optional/research/research-duckduckgo-search.md) | Free keyless web, news, and image search via ddgs. |
| [**gitnexus-explorer**](../user-guide/skills/optional/research/research-gitnexus-explorer.md) | Serve an interactive codebase knowledge graph web UI. |
| [**parallel-cli**](../user-guide/skills/optional/research/research-parallel-cli.md) | Agent-native web search, deep research, and enrichment. |
| [**pinecone-research**](../user-guide/skills/optional/research/research-pinecone-research.md) | Agent RAG and long-term memory with Pinecone. |
| [**qmd**](../user-guide/skills/optional/research/research-qmd.md) | Hybrid local search over notes, docs, and transcripts. |
| [**rss-feeds**](../user-guide/skills/optional/research/research-rss-feeds.md) | Read RSS, Atom, JSON feeds; discover feeds behind a page. |
| [**scrapling**](../user-guide/skills/optional/research/research-scrapling.md) | Scrape sites with stealth browsing and Cloudflare bypass. |
| [**searxng-search**](../user-guide/skills/optional/research/research-searxng-search.md) | Free keyless meta-search aggregating 70+ engines. |

## security

| Skill | Description |
|-------|-------------|
| [**1password**](../user-guide/skills/optional/security/security-1password.md) | Set up op CLI, sign in, and read or inject secrets. |
| [**godmode**](../user-guide/skills/optional/security/security-godmode.md) | Jailbreak LLMs: Parseltongue, GODMODE, ULTRAPLINIAN. |
| [**sherlock**](../user-guide/skills/optional/security/security-sherlock.md) | Find accounts for a username across 400+ platforms. |
| [**unbroker**](../user-guide/skills/optional/security/security-unbroker.md) | Autonomously remove your info from data-broker sites. |
| [**web-pentest**](../user-guide/skills/optional/security/security-web-pentest.md) | Authorized web pentest: recon, proof-based exploits, report. |

## smart-home

| Skill | Description |
|-------|-------------|
| [**openhue**](../user-guide/skills/optional/smart-home/smart-home-openhue.md) | Control Philips Hue lights, scenes, rooms via OpenHue CLI. |

## social-media

| Skill | Description |
|-------|-------------|
| [**reddit-reading**](../user-guide/skills/optional/social-media/social-media-reddit-reading.md) | Read Reddit: subreddits, search, threads, users. No browser. |

## software-development

| Skill | Description |
|-------|-------------|
| [**code-wiki**](../user-guide/skills/optional/software-development/software-development-code-wiki.md) | Generate wiki docs + Mermaid diagrams for any codebase. |
| [**rest-graphql-debug**](../user-guide/skills/optional/software-development/software-development-rest-graphql-debug.md) | Debug REST/GraphQL APIs: status codes, auth, schemas, repro. |

## web-development

| Skill | Description |
|-------|-------------|
| [**cloudflare-temporary-deploy**](../user-guide/skills/optional/web-development/web-development-cloudflare-temporary-deploy.md) | Deploy a Worker live, no account, via wrangler --temporary. |
| [**har-derived-api-client**](../user-guide/skills/optional/web-development/web-development-har-derived-api-client.md) | Record a site's XHR into a HAR, derive an HTTP client. |
| [**page-agent**](../user-guide/skills/optional/web-development/web-development-page-agent.md) | Embed an in-page natural-language GUI copilot in web apps. |
| [**publish-site**](../user-guide/skills/optional/web-development/web-development-publish-site.md) | Versioned site deploys to GitHub/Cloudflare/Netlify Pages. |

## yuanbao

| Skill | Description |
|-------|-------------|
| [**yuanbao**](../user-guide/skills/optional/yuanbao/yuanbao-yuanbao.md) | Yuanbao (元宝) groups: @mention users, query info/members. |

---

## Contributing Optional Skills

To add a new optional skill to the repository:

1. Create a directory under `optional-skills/<category>/<skill-name>/`
2. Add a `SKILL.md` with standard frontmatter (name, description, version, author)
3. Include any supporting files in `references/`, `templates/`, or `scripts/` subdirectories
4. Submit a pull request — the skill will appear in this catalog and get its own docs page once merged
