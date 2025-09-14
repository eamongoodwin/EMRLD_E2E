# EMRLD_E2E: Key-forge Secure Messenger

> **Quantum-Grade End-to-End Encrypted Messaging** powered by the **EMRLD Chain** (Enhanced Multi-Round Layered Diffusion).

---

## Overview

**EMRLD_E2E** is a serverless secure messaging platform built on **Cloudflare Workers** with **KV storage** and **Turnstile verification**.  
It implements an experimental hybrid encryption framework — **EMRLD Chain + QI-XOR** — combining multi-round AES encryption, PBKDF2 key derivation, and quantum-inspired key masking for resilient communication.

The web client provides a modern, responsive UI for room creation, joining, and real-time chat, styled with a premium CSS design system.

---

## Features

- **Secure Access Verification** with Cloudflare Turnstile (bot protection).
- **Room Management**
  - Create secure chat rooms with password protection.
  - Join existing rooms with validated IDs (`emerald_xxxxxxxx`).
  - Automatic invite link generation.
- **End-to-End Encryption (E2E)**
  - Multi-round AES-GCM layered encryption.
  - PBKDF2 key derivation (10k iterations).
  - Quantum-inspired XOR masking for key obfuscation.
- **Messaging**
  - Optimistic UI updates with message polling.
  - Encrypted message storage in Cloudflare KV.
  - Configurable message retention (`MAX_ROOM_MESSAGES`).
- **Frontend**
  - Modern, responsive layout (desktop + mobile).
  - Accessible ARIA-compliant tab navigation.
  - Premium gradient theming with WCAG AA contrast.
- **Serverless Backend**
  - Built on Cloudflare Workers (no dedicated servers).
  - Static asset delivery + JSON API from a single worker.

---

## Architecture

```text
┌───────────────┐        ┌─────────────────────┐
│   Frontend    │ <----> │  Cloudflare Worker  │
│  (index.html) │        │   (worker.js API)   │
└───────────────┘        └─────────────────────┘
         │                          │
         ▼                          ▼
   Secure UI Layer         Cloudflare KV Storage
  (Turnstile, Rooms)      (Rooms, Messages, Metadata)
Frontend (index.html, styles.css)

UI screens: Verification → Setup → Chat.

Room creation/join forms, message composer, status banners.

Dynamically loads/sends messages via REST API calls.

Worker (worker.js)

Implements /api/room/create, /api/room/join, /api/message/send, /api/room/:id/messages.

Handles Turnstile token verification and CORS.

Provides SPA fallback for static assets.

Storage

KV namespace MESSENGER_KV stores room metadata and message history.

Deployment
Prerequisites
Cloudflare Workers

Wrangler CLI

Config (wrangler.toml)
toml
Copy code
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
MESSAGE_POLL_INTERVAL = "3000"
Build & Deploy
bash
Copy code
# Install wrangler if not present
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Publish worker and assets
wrangler publish
Usage
Visit the deployed worker URL.

Complete the Turnstile verification.

Choose:

Forge Room → Create a new secure chat room.

Join Room → Enter an existing room ID + password.

Begin secure chat. Messages are encrypted end-to-end and stored in KV.

Use Forge Invite to share invite links securely.

Security Notes
Encryption: AES-GCM multi-round + PBKDF2 key stretching + quantum-inspired XOR masking
worker

.

Verification: Turnstile enforced at entry point
worker

.

Storage: Messages never stored in plaintext; KV only holds encrypted payloads
worker

.

Retention: Up to 100 recent messages per room (configurable).

Disclaimer: EMRLD Chain is experimental and not a replacement for audited cryptographic standards.

Roadmap
 Multi-device session sync.

 Message deletion & expiry policies.

 Improved quantum-resistant primitives (NIST PQC integration).

 Push notifications (Web Push API).

License
MIT © 2025 Eamon Goodwin
