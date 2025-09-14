# EMRLD_E2E — Key-Forge Secure Messenger

> **Quantum-grade, serverless E2E chat** on Cloudflare Workers + KV. Experimental crypto: **EMRLD-Chain (multi-round AES-GCM) + Quantum-Inspired XOR**.

<p align="left">
  <a href="https://developers.cloudflare.com/workers/">
    <img alt="Cloudflare Workers" src="https://img.shields.io/badge/Cloudflare-Workers-ff6f00?logo=cloudflare&logoColor=white">
  </a>
  <img alt="Status" src="https://img.shields.io/badge/status-experimental-orange">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-black">
</p>

---

## Table of Contents
- [Overview](#overview)
- [Architecture](#architecture)
- [API](#api)
- [Data Model](#data-model)
- [Crypto Model (Experimental)](#crypto-model-experimental)
- [Front-End UX](#front-end-ux)
- [Configuration](#configuration)
- [Local Dev](#local-dev)
- [Deploy](#deploy)
- [Security Notes & Limits](#security-notes--limits)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [License](#license)

---

## Overview
**EMRLD_E2E** is a single-worker application that serves the web UI and a JSON API for secure chat rooms. Rooms and messages are stored in **Cloudflare KV**; bot-gating uses **Cloudflare Turnstile**. The crypto pipeline layers multiple AES-GCM rounds and applies a quantum-inspired XOR mask to the ciphertext/key material (research/demo only).

---

## Architecture

```
Client (index.html + styles.css)
   ├── Turnstile gate (visible, session TTL)
   ├── Room forge/join flows
   └── Chat UI + polling

Cloudflare Worker (worker.js)
   ├── Static assets (ASSETS binding + SPA fallback)
   ├── REST API (/api/*)
   └── KV storage (MESSENGER_KV)

Cloudflare KV
   ├── room:<roomId>            (room metadata)
   └── room:<roomId>:messages   (message array, capped)
```

Key endpoints and static-asset SPA fallback live in `worker.js`. SPA fallback serves `index.html` for unknown GET routes.

---

## API

Base URL: `https://<your-worker-domain>`

### Health
- `GET /api/health` → `{"status":"healthy","ts":..., "service":"emerald-city"}`

### Turnstile
- `POST /api/turnstile/verify`  
  Body accepts JSON, form-urlencoded, or form-data with `cf-turnstile-response` or `token`.

### Rooms
- `POST /api/room/create`  
  **Body (JSON):** `{ "roomName": string, "password": string }`  
  **Resp:** `{ "success": true, "roomId": "emerald_xxxxxxxx", "roomName": string }`
- `POST /api/room/join`  
  **Body (JSON):** `{ "roomId": "emerald_xxxxxxxx", "password": string }`  
  **Resp:** `{ "success": true, "room": { id, name, messageCount } }`
- `GET /api/room/:roomId/messages`  
  **Resp:** `{ "success": true, "messages": Message[] }`
- `DELETE /api/room/:roomId`  
  **Body (JSON):** `{ "adminPassword": string }`  
  **Resp:** `{ "success": true, "message": "Room deleted" }`

### Messages
- `POST /api/message/send`  
  **Body (JSON):** `{ "roomId": string, "message": string, "senderName": string }`  
  **Resp:** `{ "success": true, "messageId": string, "encryptedMessage": Message }`

**Message shape (stored encrypted):**
```jsonc
{
  "id": "msg_abc123",
  "sender": "Alice",
  "timestamp": 1730000000000,
  "encryptedData": "<base64>",
  "keyData": "<base64>",
  "algorithm": "EMRLD-Chain + QI-XOR"
}
```

---

## Data Model
- **Room key:** `room:<roomId>` →  
  `{ id, name, created, adminPassword (hashed), messageCount }`
- **Messages key:** `room:<roomId>:messages` → `Message[]` (capped to 100 by default)

> **Retention:** Oldest messages are trimmed once the list exceeds `MAX_ROOM_MESSAGES` (default 100).

---

## Crypto Model (Experimental)
- **Layered encryption:** N rounds of AES-GCM applied to message bytes (demo uses 3 rounds).
- **Key derivation:** `PBKDF2(SHA-256, 10k iters)` per round, salted by `round-i` and a context string (e.g., room id).
- **Quantum-inspired mask:** a generated 256-bit byte array is SHA-256 hashed then XOR’d with the multi-round output.
- **Output metadata:** `{ rounds, algorithm: "EMRLD-Chain + QI-XOR", timestamp }` embedded with each message.

> **Disclaimer:** Not a standard, not audited; for research/education/demo only. Do not use for high-risk communications without formal review.

---

## Front-End UX
- **Screens:** `Verification → Setup (Forge/Join tabs) → Chat`
- **Validation:** Join IDs match `emerald_[A-Za-z0-9]{8}`; session-scoped Turnstile gating.
- **Chat UI:** polled message fetch; optimistic send; copyable Room ID; invite-link share helper.
- **Accessibility:** ARIA roles & live regions; keyboard-friendly inputs; strong visual focus states.

---

## Configuration

### `wrangler.toml` (core)
```toml
name = "emrld-e2e-clean"
main = "worker.js"
compatibility_date = "2024-09-19"

[assets]
directory = "."
binding = "ASSETS"
not_found_handling = "single-page-application"

[[kv_namespaces]]
binding = "MESSENGER_KV"
id = "<your-kv-id>"

[vars]
APP_NAME = "E2E Encrypted Messenger"
MAX_ROOM_MESSAGES = "100"
MESSAGE_POLL_INTERVAL = "3000"  # ms
# TURNSTILE_SECRET = "..."       # set via Secrets, not plain [vars]
```
> Set `TURNSTILE_SECRET` as an encrypted Worker Secret: `wrangler secret put TURNSTILE_SECRET`.

### Bindings
- **ASSETS**: serves `index.html`, `styles.css`, images, etc., with SPA fallback.
- **MESSENGER_KV**: persists rooms/messages.

---

## Local Dev

```bash
# Install wrangler
npm i -g wrangler

# Login once
wrangler login

# Run locally with live reload and persisted state
wrangler dev --local --assets . --persist-to .wrangler/state --live-reload
```

> The HTML boot code uses the official Turnstile **test sitekey** locally and your production key when deployed.

---

## Deploy

```bash
# Publish the Worker + static assets
wrangler publish
```
After publish, open `https://<name>.<account>.workers.dev/` (or your custom domain).

---

## Security Notes & Limits
- **Turnstile:** An `/api/turnstile/verify` endpoint exists; in-code verification may be bypassed for testing. Ensure verification is enforced in production.
- **KV confidentiality:** The Worker encrypts messages before writing. KV stores only encrypted payloads + metadata. Still treat KV as untrusted storage.
- **Message cap:** Default 100 per room; increase with caution (KV item size & latency).
- **Experimental crypto:** Not a substitute for audited protocols (e.g., Signal’s Double Ratchet).

---

## Troubleshooting
- **403 / Bot gate loops:** Verify Turnstile sitekey/secret and CSP `frame-src`/`script-src` includes `challenges.cloudflare.com`.
- **CSP violations:** Check browser console; update the `<meta http-equiv="Content-Security-Policy">` if assets/widgets are blocked.
- **Missing assets on deep links:** Ensure SPA fallback is enabled (`not_found_handling = "single-page-application"`).

---

## Roadmap
- Multi-device session sync
- Message expiry/retention policies (TTL)
- PQC primitives (NIST finalists) for KEM & signatures
- Web Push notifications

---

## License
MIT © 2025 Eamon Goodwin
