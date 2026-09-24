---
sidebar_position: 15
title: "Subscription Proxy"
description: "Use your xAI Grok OAuth sign-in as an OpenAI-compatible endpoint for external apps"
---

# Subscription Proxy

The subscription proxy is a local HTTP server that lets external apps (OpenViking, Karakeep, Open WebUI, anything that speaks OpenAI-compatible chat completions) use a provider subscription you signed in to through Cryozen as their LLM endpoint.
The proxy attaches the right credentials, refreshing them automatically, so the app never needs a static API key.

This is different from the [API server](./api-server.md):

| | API server | Subscription proxy |
|---|---|---|
| What it serves | Your agent (full toolset, memory, skills) | Raw model inference |
| Use case | "Use Cryozen as a chat backend" | "Use my Grok subscription from another app" |
| Auth | Your `API_SERVER_KEY` | Any bearer (proxy attaches the real one) |
| Tool calls | Yes, the agent runs tools | No, passthrough only |

Use the API server when you want the **agent** as a backend.
Use the proxy when you just want **the model** through your subscription.

## Quick Start

### 1. Sign in to your provider (one-time)

```bash
cryozen auth add xai-oauth --type oauth
```

This opens your browser for the xAI Grok OAuth flow.
Cryozen stores the credential in `~/.cryozen-agent/auth.json`, the same place all Cryozen provider logins live.
See [xAI Grok OAuth](../../guides/xai-grok-oauth.md) for details.

### 2. Start the proxy

```bash
cryozen proxy start
```

```
Starting Cryozen proxy for xAI Grok OAuth
  Listening on:  http://127.0.0.1:8645/v1
  Forwarding to: (resolved per-request from your subscription)
  Use any bearer token in the client — the proxy attaches your real credential.
```

Leave this running in the foreground.
Use `tmux`, `nohup`, or a systemd unit if you want it to survive logout.

### 3. Point your app at it

Any OpenAI-compatible app config takes the same triple:

```
Base URL:   http://127.0.0.1:8645/v1
API key:    anything (e.g. "sk-unused")
Model:      grok-4.6
```

The proxy ignores the `Authorization` header from your app and attaches your real xAI credential to the upstream request.
Refreshes happen automatically when the bearer approaches expiry.
If you have several xAI OAuth credentials in a [credential pool](./credential-pools.md), a `401` refreshes the current one and a `429` rotates to the next.

## Available providers

```bash
cryozen proxy providers
```

Currently shipped: `xai` (xAI Grok OAuth).
More OAuth providers can be added by implementing the `UpstreamAdapter` interface in `cryozen_cli/proxy/adapters/`.

## Check status

```bash
cryozen proxy status
```

```
Cryozen proxy upstream adapters

  [xai     ] xAI Grok OAuth — ready (bearer expires 2026-05-15T06:43:21Z)
```

If you see `not logged in`, run `cryozen auth add xai-oauth --type oauth`.
If you see `credentials need attention`, your credential was revoked or has no usable token; run `cryozen auth reset xai-oauth` or sign in again.

## Allowed paths

The proxy only forwards paths the upstream actually serves.
For xAI:

| Path | Purpose |
|------|---------|
| `/v1/chat/completions` | Chat completions (streaming + non-streaming) |
| `/v1/responses` | Responses API |
| `/v1/completions` | Legacy text completions |
| `/v1/embeddings` | Embeddings |
| `/v1/models` | Model list |

Other paths (`/v1/images/generations`, `/v1/audio/speech`, etc.) return 404 with a clear error pointing at the allowed paths.
This keeps stray clients from leaking unexpected requests to the upstream.

## Configuring OpenViking

[OpenViking](https://github.com/volcengine/OpenViking) is a context database that needs an LLM provider for its VLM (the vision/language model used to extract memories) and an embedding model.
With the proxy, you can point its `vlm.api_base` at your local proxy.

Edit `~/.openviking/ov.conf`:

```json
{
  "vlm": {
    "provider": "openai",
    "model": "grok-4.6",
    "api_base": "http://127.0.0.1:8645/v1",
    "api_key": "unused-proxy-attaches-real-creds"
  }
}
```

Then start your proxy in a terminal alongside `openviking-server`:

```bash
# Terminal 1
cryozen proxy start

# Terminal 2
openviking-server
```

OpenViking's VLM calls now flow through your xAI subscription.
The embedding model side may still need its own provider, depending on which embedding models your xAI plan serves.

## Configuring Karakeep (or any bookmark/summarizer app)

[Karakeep](https://karakeep.app/) takes an OpenAI-compatible API for bookmark summarization.
In its config:

```bash
# Karakeep .env
OPENAI_API_BASE_URL=http://127.0.0.1:8645/v1
OPENAI_API_KEY=any-non-empty-string
INFERENCE_TEXT_MODEL=grok-4.6
```

The same pattern works for Open WebUI, LobeChat, NextChat, or any other OpenAI-compatible client.

## Exposing on LAN

By default the proxy binds `127.0.0.1` (localhost only).
To let other machines on your network use it:

```bash
cryozen proxy start --host 0.0.0.0 --port 8645
```

**Be aware:** anyone on your network can now use your subscription.
The proxy has no auth of its own; it accepts any bearer.
Use a firewall, VPN, or reverse proxy with proper auth if you expose this beyond your trusted network.

## Rate limits

Your xAI plan's rate limits apply across the whole proxy.
The proxy does not fan out; every client shares the credentials you signed in with.

## Architecture

The proxy is intentionally minimal.
Per request:

1. Receive `POST /v1/chat/completions` from your app
2. Look up the adapter's current credential (refresh if expiring)
3. Forward the request body verbatim, with `Authorization: Bearer <credential>`
4. Stream the response back unchanged (SSE preserved)

No transformation.
No logging of request bodies.
No agent loop.
The proxy is a credential-attaching pass-through.

## Adding OAuth providers

The adapter system is pluggable.
Adding a new provider requires implementing `UpstreamAdapter` in `cryozen_cli/proxy/adapters/<provider>.py` and registering it in `adapters/__init__.py`.
Providers that aren't OpenAI-compatible at the protocol level (the Anthropic Messages API, for example) would need a transformation layer, which is out of scope for the current shape.
