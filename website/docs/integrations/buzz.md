---
sidebar_position: 4
title: "Buzz Integration"
description: "All three ways to connect Cryozen Agent to Buzz — Block's Nostr-based human+agent workspace"
---

# Buzz Integration

[Buzz](https://github.com/block/buzz) is Block's open-source, self-hostable workspace where humans and AI agents share the same channels. It is built on Nostr: every message is a signed event on a relay you own, and every participant — human or agent — is a keypair.

Cryozen integrates with Buzz three ways. Pick by where Cryozen runs and what you want it to do:

| | ① Desktop runtime | ② Relay bridge (ACP) | ③ Native gateway platform |
|---|---|---|---|
| **What it is** | Buzz Desktop spawns Cryozen locally as a managed harness | Buzz's `buzz-acp` bridges a channel to `cryozen acp` over stdio | Cryozen's gateway joins Buzz as a first-class messaging platform |
| **Cryozen runs** | On your desktop, launched by Buzz | On a server, launched by `buzz-acp` | In your own gateway, alongside Telegram/Discord/etc. |
| **Best for** | Trying Cryozen inside Buzz Desktop with zero config | A hosted agent identity when Buzz owns the transport | Full Cryozen: memory, skills, approvals, cron, sessions |
| **Inbound** | ACP stdio | ACP stdio (via relay WebSocket) | NIP-42-authenticated Nostr WebSocket (poll fallback) |
| **Setup** | Automatic discovery | `buzz-acp` env vars | `cryozen gateway setup` → Buzz |

## ① Buzz Desktop managed runtime

Buzz Desktop ships Cryozen as a preset runtime. With Cryozen installed the normal way, open **Settings → Runtimes** and Cryozen appears automatically — discovery resolves the `cryozen-acp` launcher on your login-shell PATH, which the installer writes to `~/.local/bin` (and `cryozen update` self-heals on older installs).

Full setup, troubleshooting, and the security posture (Buzz auto-approves tool permissions — keep agents owner-only): **[ACP Host Integration → Buzz Desktop](../user-guide/features/acp.md#buzz-desktop)**

## ② Relay bridge (buzz-acp + ACP)

For a hosted Cryozen identity that joins Buzz *channels* while Buzz's own harness owns the transport:

```text
Buzz relay <-- WebSocket --> buzz-acp <-- ACP over stdio --> Cryozen Agent
```

The spawned Cryozen uses the same config, credentials, memory, and skills as `cryozen` on that host. Key minting, channel discovery, owner-only telemetry (`BUZZ_ACP_RELAY_OBSERVER`), and headless-permission guidance: **[ACP Host Integration → Buzz channels (relay bridge)](../user-guide/features/acp.md#buzz-channels-relay-bridge)**

## ③ Native gateway platform (recommended for full Cryozen)

The bundled `buzz` platform plugin makes Buzz a normal Cryozen messaging platform — channels, DMs, mention gating, threaded replies, reactions, images, and cron delivery (`deliver=buzz`), with Cryozen's own approvals, memory, and session management intact. Inbound arrives over a persistent NIP-42-authenticated Nostr WebSocket (dependency-free BIP-340 signing) with automatic fallback to CLI polling; outbound goes through the `buzz` CLI.

```bash
cryozen gateway setup   # pick Buzz
```

Full configuration reference (env vars, config.yaml, transport modes, access control): **[Messaging → Buzz](../user-guide/messaging/buzz.md)**

## Which one should I use?

- **Just exploring, Buzz Desktop user** → ① works out of the box.
- **Running a community relay and want an agent identity managed by Buzz** → ②.
- **You already run Cryozen as your agent and want Buzz as another channel** → ③. This is the deepest integration and the one that keeps every Cryozen feature.

①/② and ③ use different identities and transports; run ③ with its own dedicated Nostr keypair. The adapter takes a scoped lock on the relay+pubkey pair, so two Cryozen profiles cannot accidentally drive one Buzz identity.
