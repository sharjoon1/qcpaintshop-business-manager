# Clawdbot (Kai) AI Integration Guide
## Complete Technical Reference for act.qcpaintshop.com

> **Version**: 2.0 | **Date**: Feb 23, 2026 | **Stack**: Express.js + MySQL + Vanilla HTML/JS

---

## Table of Contents

1. [Functionality Analysis](#1-functionality-analysis)
2. [Architecture Overview](#2-architecture-overview)
3. [Integration Method — Gateway Bridge Pattern](#3-integration-method--gateway-bridge-pattern)
4. [Technical Stack & References](#4-technical-stack--references)
5. [Step-by-Step Replication Guide](#5-step-by-step-replication-guide)
6. [Nginx Configuration (Critical for SSE)](#6-nginx-configuration-critical-for-sse)
7. [Complete Code Reference](#7-complete-code-reference)
8. [Configuration Reference](#8-configuration-reference)
9. [Data Flow Diagrams](#9-data-flow-diagrams)
10. [Timeout Chain](#10-timeout-chain)
11. [Troubleshooting & Lessons Learned](#11-troubleshooting--lessons-learned)
12. [Replication on Another Website](#12-replication-on-another-website)

---

## 1. Functionality Analysis

### What Clawdbot (Kai) Does on act.qcpaintshop.com

Clawdbot serves as **one of three AI providers** (alongside Google Gemini and Anthropic Claude) powering the AI Business Intelligence system. It is NOT a chatbot widget — it's a **backend AI provider** that powers:

| Feature | Description | How Clawdbot is Used |
|---------|-------------|---------------------|
| **Business Chat** | Interactive AI assistant ("QC Manager") that answers business questions using live database context | Processes chat messages through system prompt + context + user message |
| **Automated Analysis** | Scheduled reports on revenue, staff, leads, marketing | Generates analysis insights from collected business data |
| **App Self-Analysis** | Scans the application itself (DB schema, routes, errors, health) and produces AI-powered findings | Analyzes scan data (up to 256KB+) and outputs issues with severity levels |
| **Lead Scoring** | AI-enhanced deterministic scoring (0-100) with conversion predictions | Enhances deterministic scores with AI insights for top leads |
| **Fix/Upgrade Prompts** | Generates implementation prompts from identified issues | Produces developer-ready fix instructions |
| **Marketing Tips** | Weekly AI-generated marketing suggestions based on business data | Analyzes brand/category/customer data for campaign ideas |

### Key Differentiator from Gemini/Claude

Clawdbot runs as a **local gateway process** on the same server — no external API calls from your app, no API keys needed in your code, no rate limits from cloud providers. It uses the Clawdbot framework which internally manages its own API quota (using Claude Opus under the hood).

---

## 2. Architecture Overview

### Three-Layer Architecture

```
LAYER 1: FRONTEND (admin-ai.html)
  ├── Chat Interface (Tab 1) — SSE streaming
  ├── Analysis Dashboard (Tab 2) — Insights display
  ├── AI Settings (Tab 4) — Provider selection
  └── App Analyzer (Tab 5) — Scan + AI analysis

LAYER 2: API ROUTES (routes/ai.js)
  ├── POST /api/ai/chat — Chat with context injection
  ├── POST /api/ai/analysis/run — Trigger analysis
  ├── POST /api/ai/app-analyze — App self-analysis (SSE)
  ├── POST /api/ai/generate-prompt — Fix prompt generation
  └── GET/PUT /api/ai/config — Provider configuration

LAYER 3: AI ENGINE (services/ai-engine.js)
  ├── Provider Router: generate() / streamToResponse()
  ├── Failover Chain: generateWithFailover() / streamWithFailover()
  ├── Gemini Provider: HTTPS API calls to generativelanguage.googleapis.com
  ├── Claude Provider: HTTPS API calls to api.anthropic.com
  └── Clawdbot Provider: Gateway bridge via WebSocket (scripts/clawdbot-call.mjs)
```

### Provider Failover Chain (3-Provider)

```
Request arrives
    ↓
Try PRIMARY provider (e.g., gemini)
    ↓ fails
Try FALLBACK provider (e.g., claude)
    ↓ fails
Try REMAINING provider (e.g., clawdbot)
    ↓ fails
Throw: "All providers failed for streaming. gemini: <err>. claude: <err>. clawdbot: <err>"
```

The chain is built dynamically: `[primary, fallback, ...remaining]` with `new Set()` deduplication.

### Critical: Why NOT CLI-Based

**The original approach — `execFile('clawdbot', ['agent', '--message', prompt])` — DOES NOT WORK** for production payloads. Here's why:

| Approach | Limit | Status |
|----------|-------|--------|
| `execFile('clawdbot', [prompt])` | Linux kernel `MAX_ARG_STRLEN` = 128KB per argument | **FAILS** for large prompts |
| `exec("clawdbot ... $(cat file)")` | Shell expands `$(cat file)` before `execve()` — hits same 128KB limit | **FAILS** |
| **Gateway Bridge** (current) | Writes prompt to temp file → helper reads file → sends via WebSocket (25MB max payload) | **WORKS** |

The gateway bridge pattern was the solution. Clawdbot runs a WebSocket gateway on `ws://127.0.0.1:18789` — we bypass the CLI entirely and call the gateway's `callGateway()` function directly.

---

## 3. Integration Method — Gateway Bridge Pattern

### How It Works

```
ai-engine.js                       scripts/clawdbot-call.mjs         Clawdbot Gateway
    │                                     │                               │
    ├─ Write prompt to /tmp file          │                               │
    ├─ execFile('node', [helper, file])   │                               │
    │                                     ├─ Read file from disk          │
    │                                     ├─ callGateway() via WebSocket ─┤
    │                                     │                               ├─ Process with Claude
    │                                     │◄── JSON response ─────────────┤
    │◄── stdout JSON ─────────────────────┤                               │
    ├─ Delete temp file                   │                               │
    ├─ Parse response                     │                               │
    └─ Return { text, tokensUsed, ... }   │                               │
```

### Integration Components

| Component | File | Lines | Role |
|-----------|------|-------|------|
| Gateway Bridge Script | `scripts/clawdbot-call.mjs` | 1-35 | ESM module: reads prompt from file, calls gateway via WebSocket |
| Exec + Temp File | `services/ai-engine.js` | 449-478 | Writes prompt to temp file, spawns helper, parses JSON response |
| Message Formatter | `services/ai-engine.js` | 480-493 | Converts messages array (OpenAI format) to single prompt string |
| Stream Simulator | `services/ai-engine.js` | 495-509 | Chunks full response into 100-char SSE pieces |
| Provider Router | `services/ai-engine.js` | 513-539 | Routes `generate()` / `streamToResponse()` to correct provider |
| Failover Chain | `services/ai-engine.js` | 541-592 | Tries all 3 providers in order before failing |
| Config UI | `public/admin-ai.html` | 379-391 | Dropdown to select primary/fallback provider |
| Config Storage | `ai_config` table | — | Persists provider choice in database |

---

## 4. Technical Stack & References

### Technologies Used

| Technology | Purpose | Reference |
|------------|---------|-----------|
| **Node.js** (`child_process.execFile`) | Spawns gateway helper as subprocess | [Node.js child_process docs](https://nodejs.org/api/child_process.html) |
| **Clawdbot Gateway** (WebSocket) | AI agent framework, gateway on port 18789 | `callGateway()` from Clawdbot's dist |
| **Server-Sent Events (SSE)** | Streams AI responses to browser | [MDN EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource) |
| **Express.js** | API routing and middleware | [Express.js](https://expressjs.com/) |
| **MySQL** | Business data + AI config storage | [mysql2](https://github.com/sidorares/node-mysql2) |
| **Nginx** (reverse proxy) | SSE timeout + buffering config | Dedicated `/api/ai/` location block |
| **Claude Opus** (via Clawdbot) | Underlying LLM powering Clawdbot | [Anthropic](https://docs.anthropic.com/) |

### Why Gateway Bridge (Not CLI)?

1. **No argument size limit** — WebSocket payload max is 25MB, not 128KB
2. **No API key management** — Clawdbot handles its own authentication
3. **No rate limit worries** — Independent from Gemini/Claude quotas
4. **Self-contained** — Works even if external APIs are down
5. **Skill system** — Clawdbot can be given domain-specific skills (like the site analyzer)

---

## 5. Step-by-Step Replication Guide

### Prerequisites

- Node.js 18+ installed on your server
- Clawdbot installed globally: `npm install -g clawdbot`
- Clawdbot configured with API key: `clawdbot config set apiKey <your-key>`
- Clawdbot gateway running: `clawdbot gateway start` (port 18789)
- Your Express.js (or similar) web application
- Nginx as reverse proxy (for SSE support)

---

### Step 1: Install and Verify Clawdbot

```bash
# Install globally
npm install -g clawdbot

# Configure (one-time setup)
clawdbot config set apiKey YOUR_ANTHROPIC_API_KEY

# Start the gateway (runs on ws://127.0.0.1:18789)
clawdbot gateway start

# Verify it works via CLI
clawdbot agent --agent main --message "Reply with just OK" --json
```

Expected response:
```json
{
  "status": "ok",
  "result": {
    "payloads": [{ "text": "OK" }],
    "meta": {
      "agentMeta": {
        "model": "claude-opus-4-5-20250219",
        "usage": { "input": 42, "output": 3 }
      }
    }
  }
}
```

---

### Step 2: Create the Gateway Bridge Script

Create `scripts/clawdbot-call.mjs`:

```javascript
#!/usr/bin/env node
// Helper: reads prompt from a file, calls Clawdbot gateway via WebSocket.
// Bypasses CLI argument size limit (kernel ARG_MAX / MAX_ARG_STRLEN).
// Usage: node clawdbot-call.mjs <prompt-file>

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { callGateway } from "/www/server/nvm/versions/node/v22.20.0/lib/node_modules/clawdbot/dist/gateway/call.js";
// ↑ IMPORTANT: Use the absolute path to YOUR Clawdbot installation's dist.
// Find it with: npm root -g    →    then append /clawdbot/dist/gateway/call.js

const promptFile = process.argv[2];
if (!promptFile) {
    console.error(JSON.stringify({ status: "error", error: "Usage: node clawdbot-call.mjs <prompt-file>" }));
    process.exit(1);
}

const message = readFileSync(promptFile, "utf8");

try {
    const response = await callGateway({
        method: "agent",
        params: {
            message,
            agentId: "main",
            timeout: 280,               // Agent processing timeout (seconds)
            idempotencyKey: randomUUID(), // REQUIRED — gateway rejects without it
        },
        expectFinal: true,
        timeoutMs: 290000,               // Gateway WebSocket timeout (ms)
    });
    console.log(JSON.stringify(response));
} catch (err) {
    console.error(JSON.stringify({ status: "error", error: String(err.message || err) }));
    process.exit(1);
}
```

**Key points:**
- Must be ESM (`.mjs`) — Clawdbot's dist uses ES module exports
- `idempotencyKey: randomUUID()` is **required** — gateway rejects calls without it
- The `callGateway` import path must be absolute to Clawdbot's global install location
- `timeout` (280s) < `timeoutMs` (290s) — agent finishes before gateway gives up

---

### Step 3: Create the AI Engine Module

Create `services/ai-engine.js` (or add to existing). Here's the Clawdbot-specific section:

```javascript
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ─── Clawdbot Provider (Gateway Bridge Pattern) ─────────────

// Path to the gateway bridge helper script
const CLAWDBOT_HELPER = path.join(__dirname, '..', 'scripts', 'clawdbot-call.mjs');

/**
 * Execute a prompt via Clawdbot Gateway (WebSocket bridge)
 *
 * Flow: Write prompt to temp file → execFile('node', [helper, file]) →
 *       helper reads file → sends via WebSocket to gateway →
 *       gateway processes → returns JSON → parse and return
 *
 * @param {string} message - The full prompt to send
 * @returns {Promise<{text, tokensUsed, model, provider}>}
 */
function clawdbotExec(message) {
    // Write prompt to temp file to bypass execve() argument limits
    const tmpFile = path.join(os.tmpdir(),
        `clawdbot-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    fs.writeFileSync(tmpFile, message, 'utf8');

    return new Promise((resolve, reject) => {
        execFile('node', [CLAWDBOT_HELPER, tmpFile], {
            timeout: 300000,            // 300s — outermost timeout (kill process)
            maxBuffer: 1024 * 1024 * 5  // 5MB stdout buffer
        }, (err, stdout, stderr) => {
            // Always clean up temp file
            try { fs.unlinkSync(tmpFile); } catch (_) {}

            if (err) {
                const detail = stderr ? stderr.trim() : err.message;
                return reject(new Error(`Clawdbot exec failed: ${detail}`));
            }
            try {
                const json = JSON.parse(stdout);
                if (json.status !== 'ok') {
                    return reject(new Error(`Clawdbot returned status: ${json.status}`));
                }
                const text = json.result?.payloads?.[0]?.text || '';
                const usage = json.result?.meta?.agentMeta?.usage || {};
                const model = json.result?.meta?.agentMeta?.model || 'clawdbot';
                const tokensUsed = (usage.input || 0) + (usage.output || 0);
                resolve({
                    text,
                    tokensUsed,
                    model: `clawdbot/${model}`,
                    provider: 'clawdbot'
                });
            } catch (e) {
                reject(new Error(`Clawdbot JSON parse failed: ${e.message}. stdout: ${stdout.substring(0, 200)}`));
            }
        });
    });
}

/**
 * Generate response from Clawdbot
 * Converts OpenAI-format messages array into a single prompt string
 * @param {Array<{role, content}>} messages
 * @param {Object} options - { temperature, maxTokens, model }
 * @returns {Promise<{text, tokensUsed, model, provider}>}
 */
async function clawdbotGenerate(messages, options = {}) {
    let prompt = '';
    for (const msg of messages) {
        if (msg.role === 'system') {
            prompt += `[System Instructions]\n${msg.content}\n\n`;
        } else if (msg.role === 'user') {
            prompt += `${msg.content}\n\n`;
        } else if (msg.role === 'assistant') {
            prompt += `[Previous Response]\n${msg.content}\n\n`;
        }
    }
    return clawdbotExec(prompt.trim());
}

/**
 * Stream response from Clawdbot via SSE
 * Clawdbot doesn't support true streaming, so we simulate it:
 * get full response → emit in 100-char SSE chunks
 * @param {Array<{role, content}>} messages
 * @param {Response} res - Express response object (SSE)
 * @param {Object} options
 * @returns {Promise<{text, tokensUsed, model, provider}>}
 */
async function clawdbotStreamToResponse(messages, res, options = {}) {
    const result = await clawdbotGenerate(messages, options);
    const text = result.text;

    // Emit in ~100 char chunks to simulate streaming
    const chunkSize = 100;
    for (let i = 0; i < text.length; i += chunkSize) {
        const chunk = text.slice(i, i + chunkSize);
        res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
    }

    return result;
}
```

---

### Step 4: Create the Provider Router with Failover

```javascript
// Add to your ai-engine.js — Public API section

async function generate(messages, options = {}) {
    const config = await getConfig();
    const provider = options.provider || config.primary_provider || 'gemini';
    const opts = {
        temperature: options.temperature || config.temperature || '0.3',
        maxTokens: options.maxTokens || config.max_tokens_per_request || '4096',
        model: options.model
    };

    if (provider === 'claude') return claudeGenerate(messages, opts);
    if (provider === 'clawdbot') return clawdbotGenerate(messages, opts);
    return geminiGenerate(messages, opts);
}

async function streamToResponse(messages, res, options = {}) {
    const config = await getConfig();
    const provider = options.provider || config.primary_provider || 'gemini';
    const opts = {
        temperature: options.temperature || config.temperature || '0.3',
        maxTokens: options.maxTokens || config.max_tokens_per_request || '4096',
        model: options.model
    };

    if (provider === 'claude') return claudeStreamToResponse(messages, res, opts);
    if (provider === 'clawdbot') return clawdbotStreamToResponse(messages, res, opts);
    return geminiStreamToResponse(messages, res, opts);
}

/**
 * Try all providers in order until one succeeds
 * Chain: primary → fallback → remaining providers
 */
async function generateWithFailover(messages, options = {}) {
    const config = await getConfig();
    const primary = options.provider || config.primary_provider || 'gemini';
    const fallback = config.fallback_provider || (primary === 'gemini' ? 'claude' : 'gemini');

    // Build ordered chain, deduplicate with Set
    const allProviders = ['gemini', 'claude', 'clawdbot'];
    const chain = [primary, fallback, ...allProviders.filter(p => p !== primary && p !== fallback)];
    const providers = [...new Set(chain)];

    const opts = {
        temperature: options.temperature || config.temperature || '0.3',
        maxTokens: options.maxTokens || config.max_tokens_per_request || '4096',
        model: options.model
    };

    const errors = [];
    for (let i = 0; i < providers.length; i++) {
        try {
            const result = await generate(messages, { ...opts, provider: providers[i] });
            return { ...result, failedOver: i > 0 };
        } catch (err) {
            console.error(`[AI Engine] Provider ${providers[i]} failed:`, err.message);
            errors.push(`${providers[i]}: ${err.message}`);
        }
    }
    throw new Error(`All AI providers failed. ${errors.join('. ')}`);
}

/**
 * Same as generateWithFailover but for SSE streaming
 */
async function streamWithFailover(messages, res, options = {}) {
    const config = await getConfig();
    const primary = options.provider || config.primary_provider || 'gemini';
    const fallback = config.fallback_provider || (primary === 'gemini' ? 'claude' : 'gemini');
    const allProviders = ['gemini', 'claude', 'clawdbot'];
    const chain = [primary, fallback, ...allProviders.filter(p => p !== primary && p !== fallback)];
    const providers = [...new Set(chain)];

    const opts = {
        temperature: options.temperature || config.temperature || '0.3',
        maxTokens: options.maxTokens || config.max_tokens_per_request || '4096',
        model: options.model
    };

    const errors = [];
    for (let i = 0; i < providers.length; i++) {
        try {
            return await streamToResponse(messages, res, { ...opts, provider: providers[i] });
        } catch (err) {
            console.error(`[AI Engine] Stream provider ${providers[i]} failed:`, err.message);
            errors.push(`${providers[i]}: ${err.message}`);
        }
    }
    throw new Error(`All providers failed for streaming. ${errors.join('. ')}`);
}

module.exports = {
    setPool, generate, streamToResponse,
    generateWithFailover, streamWithFailover,
    getSystemPrompt, getChatSystemPrompt,
    getConfig, clearConfigCache
};
```

---

### Step 5: Create API Routes

```javascript
// routes/ai.js
const express = require('express');
const router = express.Router();
const aiEngine = require('../services/ai-engine');

// ─── Chat Endpoint (SSE Streaming) ───────────────────────────

router.post('/chat', async (req, res) => {
    const { message, provider } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        const messages = [
            { role: 'system', content: aiEngine.getChatSystemPrompt(contextText) },
            { role: 'user', content: message }
        ];

        // Stream with failover (tries all 3 providers)
        const result = await aiEngine.streamWithFailover(messages, res, {
            provider,
            maxTokens: '8192',
            temperature: '0.5'
        });

        // Send completion event
        res.write(`data: ${JSON.stringify({
            type: 'done',
            tokens: result.tokensUsed,
            model: result.model
        })}\n\n`);
        res.end();

    } catch (err) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        res.end();
    }
});

// ─── Non-Streaming Analysis ──────────────────────────────────

router.post('/analyze', async (req, res) => {
    const { data, provider } = req.body;
    try {
        const messages = [
            { role: 'system', content: 'Analyze this data and return JSON insights.' },
            { role: 'user', content: JSON.stringify(data) }
        ];
        const result = await aiEngine.generateWithFailover(messages, { provider });
        res.json({ success: true, analysis: result.text, model: result.model });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
```

---

### Step 6: Frontend Provider Selection

```html
<!-- Settings Section -->
<div class="config-section">
    <h3>AI Provider Settings</h3>

    <div class="config-row">
        <label>Primary Provider</label>
        <select id="cfgPrimary" onchange="saveConfig('primary_provider', this.value)">
            <option value="gemini">Gemini</option>
            <option value="claude">Claude</option>
            <option value="clawdbot">Clawdbot (Kai)</option>
        </select>
    </div>

    <div class="config-row">
        <label>Fallback Provider</label>
        <select id="cfgFallback" onchange="saveConfig('fallback_provider', this.value)">
            <option value="claude">Claude</option>
            <option value="gemini">Gemini</option>
            <option value="clawdbot">Clawdbot (Kai)</option>
        </select>
    </div>
</div>
```

### Chat Interface with SSE

```html
<script>
async function sendMessage() {
    const message = document.getElementById('chatInput').value.trim();
    if (!message) return;

    const assistantDiv = appendMessage('assistant', '');

    try {
        const response = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
            },
            body: JSON.stringify({ message })
        });

        // Read SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.text) assistantDiv.textContent += data.text;
                        if (data.type === 'done') console.log(`Model: ${data.model}, Tokens: ${data.tokens}`);
                        if (data.type === 'error') assistantDiv.textContent = `Error: ${data.error}`;
                    } catch (e) { /* skip */ }
                }
            }
        }
    } catch (err) {
        assistantDiv.textContent = `Network error: ${err.message}`;
    }
}
</script>
```

---

## 6. Nginx Configuration (Critical for SSE)

**This section is critical.** Without it, Nginx will kill SSE connections after 60 seconds, causing `network error` on the browser.

### The Problem

Nginx default `proxy_read_timeout` is 60 seconds. The failover chain can take:
- Gemini fail (~2-5s) + Claude fail (~2-5s) + Clawdbot processing (30-120s for large prompts) = **35-130s total**

This exceeds 60s → Nginx drops the connection → browser sees `network error`.

Additionally, `proxy_buffering` (on by default) buffers SSE chunks and delivers them in batches, breaking the streaming experience.

### The Fix

Add a **dedicated `/api/ai/` location block** in your Nginx config **BEFORE** the general `/api/` or `/` block:

```nginx
# ── AI API: SSE-friendly (long timeout, no buffering) ──────
# MUST appear BEFORE the general proxy location block
location /api/ai/ {
    proxy_pass http://127.0.0.1:YOUR_APP_PORT;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # SSE-critical settings
    proxy_read_timeout 300s;          # Match the outermost timeout
    proxy_send_timeout 300s;
    proxy_buffering off;              # Stream chunks immediately
    chunked_transfer_encoding on;     # Support chunked responses
}

# ── General API proxy ──────────────────────────────────────
location / {
    proxy_pass http://127.0.0.1:YOUR_APP_PORT;
    # ... normal settings ...
}
```

### Reload Nginx

```bash
# If using BT Panel (aaPanel):
/www/server/nginx/sbin/nginx -s reload

# If using system nginx:
sudo systemctl reload nginx

# IMPORTANT: BT Panel nginx is at /www/server/nginx/sbin/nginx
# Running `systemctl reload nginx` will NOT affect BT Panel's nginx!
```

### Verify

```bash
# Test that SSE streams work (should take 10-60s, not timeout at 60s)
curl -X POST https://your-domain.com/api/ai/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"message":"What is 2+2?"}' \
  --no-buffer
```

---

## 7. Complete Code Reference

### File Map

| File | Lines | Purpose |
|------|-------|---------|
| `services/ai-engine.js` | 613 | Triple provider engine (Gemini + Claude + Clawdbot) |
| `scripts/clawdbot-call.mjs` | 35 | Gateway bridge: reads prompt file → WebSocket to Clawdbot gateway |
| `routes/ai.js` | ~650 | 22+ API endpoints for AI features |
| `public/admin-ai.html` | ~1300 | 5-tab AI dashboard (Chat, Analysis, History, Settings, App Analyzer) |
| `services/ai-context-builder.js` | ~300 | 2-tier business context injection for chat |
| `services/ai-analyzer.js` | ~200 | Zoho revenue/collections analysis |
| `services/ai-staff-analyzer.js` | ~180 | Staff performance analysis |
| `services/ai-lead-manager.js` | ~450 | Lead scoring + AI enhancement |
| `services/ai-marketing.js` | ~180 | Marketing campaign suggestions |
| `services/ai-scheduler.js` | ~200 | Cron job orchestrator for all AI tasks |
| `services/app-metadata-collector.js` | ~350 | Application self-scan (DB, routes, errors, health) |
| `scripts/analyze-site.js` | 229 | Standalone CLI analyzer (used by Clawdbot skill) |

### Key Function Signatures

```javascript
// ─── ai-engine.js ─────────────────────────────────────────

// Low-level Clawdbot functions
clawdbotExec(message)                           // → { text, tokensUsed, model, provider }
clawdbotGenerate(messages, options)              // → { text, tokensUsed, model, provider }
clawdbotStreamToResponse(messages, res, options) // → { text, tokensUsed, model, provider }

// Public API (provider-agnostic)
generate(messages, options)                      // → { text, tokensUsed, model, provider }
streamToResponse(messages, res, options)          // → { text, tokensUsed, model, provider }
generateWithFailover(messages, options)           // → { text, tokensUsed, model, provider, failedOver }
streamWithFailover(messages, res, options)        // → { text, tokensUsed, model, provider, failedOver }

// Config
getConfig()                                      // → { primary_provider, fallback_provider, ... }
clearConfigCache()                               // void — called after config update

// System prompts
getSystemPrompt(extraContext)                    // → string (BUSINESS_SYSTEM_PROMPT + context)
getChatSystemPrompt(extraContext)                // → string (CHAT_SYSTEM_PROMPT + context)
```

### Clawdbot Response JSON Structure (Full)

This is what `callGateway()` returns (and what `clawdbot-call.mjs` outputs to stdout):

```json
{
  "status": "ok",
  "result": {
    "payloads": [
      { "text": "The AI response text goes here..." }
    ],
    "meta": {
      "agentMeta": {
        "model": "claude-opus-4-5-20250219",
        "usage": {
          "input": 1234,
          "output": 567
        }
      }
    }
  }
}
```

**Extraction pattern:**
```javascript
const text = json.result?.payloads?.[0]?.text || '';
const usage = json.result?.meta?.agentMeta?.usage || {};
const model = json.result?.meta?.agentMeta?.model || 'clawdbot';
const tokensUsed = (usage.input || 0) + (usage.output || 0);
```

---

## 8. Configuration Reference

### ai_config Table Keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `primary_provider` | string | `gemini` | First provider to try: `gemini`, `claude`, or `clawdbot` |
| `fallback_provider` | string | `claude` | Second provider to try on failure |
| `gemini_api_key` | string | from .env | Google Gemini API key |
| `anthropic_api_key` | string | from .env | Anthropic Claude API key |
| `gemini_model` | string | `gemini-2.0-flash` | Gemini model name |
| `claude_model` | string | `claude-sonnet-4-20250514` | Claude model name |
| `temperature` | float | `0.3` | Analysis temperature (lower = more focused) |
| `max_tokens_per_request` | int | `4096` | Max output tokens for analysis |
| `chat_max_tokens` | int | `8192` | Max output tokens for chat |
| `chat_temperature` | float | `0.5` | Chat temperature (slightly creative) |
| `daily_snapshot_enabled` | bool | `1` | Enable daily context snapshots |

### Provider Comparison

| Feature | Gemini | Claude | Clawdbot |
|---------|--------|--------|----------|
| **Connection** | HTTPS API | HTTPS API | Local WebSocket gateway |
| **API Key Needed** | Yes (in app) | Yes (in app) | No (managed by Clawdbot) |
| **True Streaming** | Yes (SSE) | Yes (SSE) | No (simulated via chunking) |
| **Rate Limits** | Google quota | Anthropic quota | Clawdbot's own limits |
| **Latency** | ~2-5s first token | ~2-5s first token | ~5-60s (full response) |
| **Cost** | Per-token | Per-token | Via Clawdbot subscription |
| **Max Prompt Size** | ~1MB (API limit) | ~1MB (API limit) | ~25MB (WebSocket limit) |
| **Model** | gemini-2.0-flash | claude-sonnet-4 | claude-opus-4.5 (via Clawdbot) |

---

## 9. Data Flow Diagrams

### Chat Flow (POST /api/ai/chat)

```
User types message in chat textarea
        ↓
sendMessage() in admin-ai.html
        ↓
fetch('/api/ai/chat', { method: 'POST', body: { message, provider? } })
        ↓
routes/ai.js → POST /chat handler
        ↓
ai-context-builder.buildChatContext(message)
    ├── Tier 1: Quick summary (always runs, ~50ms)
    │   └── Revenue today/yesterday, collections, active staff, leads pipeline
    └── Tier 2: Deep context (keyword-triggered, 8 categories)
        ├── "revenue/sales" → Detailed revenue by branch, month trends
        ├── "collection/payment" → Outstanding amounts, aging
        ├── "staff/attendance" → Clock-in/out details, breaks, OT
        ├── "lead" → Pipeline stages, followup status
        ├── "stock/inventory" → Product counts, low stock alerts
        ├── "whatsapp" → Session status, message counts
        ├── "insight" → Recent AI analysis results
        └── (no keyword) → General summary
        ↓
messages = [
    { role: 'system', content: CHAT_SYSTEM_PROMPT + contextText },
    ...conversationHistory,
    { role: 'user', content: message }
]
        ↓
aiEngine.streamWithFailover(messages, res, options)
        ↓
Provider Chain: [primary] → [fallback] → [remaining]
        ↓
If clawdbot:
    clawdbotGenerate(messages)
        ↓
    Flatten messages into single prompt string:
    "[System Instructions]\n...\n\n[Previous Response]\n...\n\nUser message"
        ↓
    clawdbotExec(prompt)
        ↓
    Write prompt to /tmp/clawdbot-prompt-{timestamp}.txt
        ↓
    execFile('node', ['scripts/clawdbot-call.mjs', tmpFile])
        ↓
    Helper reads file → callGateway() via WebSocket to ws://127.0.0.1:18789
        ↓
    Gateway processes with Claude Opus → returns JSON
        ↓
    Parse JSON → extract text from result.payloads[0].text
        ↓
    Delete temp file
        ↓
    clawdbotStreamToResponse(): chunk text into 100-char SSE pieces
        ↓
    res.write('data: {"text":"chunk..."}\n\n')  × N chunks
        ↓
res.write('data: {"type":"done","tokens":N,"model":"clawdbot/claude-opus-4.5"}\n\n')
res.end()
        ↓
Browser SSE reader appends text chunks to chat message div
```

### App Self-Analysis Flow (Tab 5 — Large Payload)

```
Admin clicks "Scan Application" in App Analyzer tab
        ↓
Step 1: GET /api/ai/app-scan
    ↓
    appMetadataCollector.runFullScan()
        ├── collectDatabaseSchema() → tables, columns, indexes, row counts
        ├── collectRouteMap() → API endpoints per file
        ├── collectRecentErrors() → error_logs last 24h
        ├── collectHealthMetrics() → DB size, table count, AI config
        └── collectBusinessStats() → revenue, leads, staff counts
    ↓
    Returns ~256KB of scan data to browser

Step 2: POST /api/ai/app-analyze { scanData, focus }
    ↓
    Build AI prompt: system prompt + 256KB scan data + focus area
    ↓
    aiEngine.streamWithFailover(messages, res, { maxTokens: 8192 })
    ↓
    If Gemini/Claude fail → falls to Clawdbot
    ↓
    Clawdbot handles 256KB+ payload easily (WebSocket 25MB limit)
    ↓
    Stream analysis results as SSE (simulated chunking)
    ↓
    Display: ### [SEVERITY: critical] Issue Title
             Description and fix recommendations
```

---

## 10. Timeout Chain

The timeout chain is layered — each outer layer is slightly longer to ensure inner layers finish cleanly:

```
┌─────────────────────────────────────────────────────────────────┐
│ Nginx proxy_read_timeout: 300s                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Node execFile timeout: 300s (kills child process)         │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │ Gateway WebSocket timeoutMs: 290s                   │  │  │
│  │  │  ┌───────────────────────────────────────────────┐  │  │  │
│  │  │  │ Agent processing timeout: 280s                │  │  │  │
│  │  │  │  (actual Claude API call + tool use)          │  │  │  │
│  │  │  └───────────────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

| Layer | Timeout | Where Set | What Happens on Timeout |
|-------|---------|-----------|------------------------|
| **Agent** | 280s | `clawdbot-call.mjs` → `params.timeout` | Agent stops processing, returns error |
| **Gateway WS** | 290s | `clawdbot-call.mjs` → `timeoutMs` | WebSocket closes, throws in helper |
| **execFile** | 300s | `ai-engine.js` → `execFile({timeout})` | Node kills child process, returns error |
| **Nginx** | 300s | `proxy_read_timeout` in nginx conf | Nginx drops connection to browser |

**Why this order matters:** If the agent hangs at 280s, the gateway catches it at 290s. If the gateway hangs, execFile kills it at 300s. Nginx matches execFile at 300s so the connection stays open for the entire processing window.

---

## 11. Troubleshooting & Lessons Learned

### Error Resolution Table

| Error | Root Cause | Solution |
|-------|-----------|---------|
| `spawn E2BIG` | Prompt passed as CLI argument exceeds kernel `MAX_ARG_STRLEN` (128KB) | **Use gateway bridge pattern** — write to temp file, helper reads file, sends via WebSocket |
| `Argument list too long` | Shell `$(cat file)` expansion still hits `execve()` arg limit | Same fix — bypass CLI entirely, use WebSocket gateway |
| `invalid agent params: must have required property 'idempotencyKey'` | Clawdbot gateway requires `idempotencyKey` on every call | Add `idempotencyKey: randomUUID()` to `callGateway()` params |
| `network error` (browser) | Nginx default `proxy_read_timeout` is 60s | Add `/api/ai/` location block with `proxy_read_timeout 300s` and `proxy_buffering off` |
| `gateway timeout after 130000ms` | Default gateway timeout too short for large prompts | Increase to `timeoutMs: 290000`, agent timeout to `280` |
| `Clawdbot exec failed: command not found` | Clawdbot not in PATH | Install globally: `npm install -g clawdbot` |
| `Clawdbot JSON parse failed` | Non-JSON output (error message in stdout) | Check `clawdbot` gateway is running: `clawdbot gateway status` |
| `maxBuffer exceeded` | Response > buffer size | Increase `maxBuffer` in execFile options (currently 5MB) |
| Empty text in response | Clawdbot returned no payloads | Check `json.result.payloads` structure |
| Git conflict on deploy (`scripts/clawdbot-call.mjs`) | File was created manually on server before being committed to git | `rm -f` the untracked file, then `git pull` |

### Key Lessons Learned

| Lesson | Detail |
|--------|--------|
| **Linux ARG_MAX is real** | `execve()` has a 2MB total limit and 128KB per-argument limit. Even shell substitution `$(cat file)` expands before calling `execve`. The ONLY way to pass large data to a subprocess is via file, stdin, or IPC — NOT arguments |
| **Clawdbot uses WebSocket internally** | The CLI is just a wrapper. The real interface is `callGateway()` in `clawdbot/dist/gateway/call.js`, using WebSocket on port 18789 with 25MB max payload |
| **BT Panel nginx ≠ system nginx** | On BT Panel (aaPanel) servers, nginx binary is at `/www/server/nginx/sbin/nginx`. Running `systemctl reload nginx` does NOT affect it |
| **Nginx proxy_buffering kills SSE** | Buffering must be OFF for SSE to work. Without it, chunks accumulate and arrive in batches instead of streaming |
| **Timeout chain must be nested** | Inner timeouts < outer timeouts. If you set them equal, race conditions cause unpredictable failures |
| **ESM required for Clawdbot dist** | The gateway bridge script must be `.mjs` because Clawdbot's dist exports use ES module syntax |
| **idempotencyKey is mandatory** | The gateway silently rejects calls without it — always use `randomUUID()` |
| **Simulated streaming is fine** | Users can't tell the difference between real SSE streaming and 100-char-chunk simulation. The slight delay while Clawdbot processes is barely noticeable |
| **temp file cleanup in finally** | Always delete temp files in the `execFile` callback (success or error), not just on success. Use try/catch around `unlinkSync` in case file was already cleaned |

### Debug Logging

All provider failures are logged to console:
```
[AI Engine] Provider clawdbot failed: Clawdbot exec failed: gateway timeout after 290000ms
[AI Engine] Stream provider clawdbot failed: ...
```

Check PM2 logs on the server:
```bash
pm2 logs business-manager --lines 50 --nostream | grep -i clawdbot
```

### Testing

```bash
# 1. Test Clawdbot gateway directly (on server)
echo "Reply with just OK" > /tmp/test-prompt.txt
node /path/to/scripts/clawdbot-call.mjs /tmp/test-prompt.txt
# Should output: {"status":"ok","result":{"payloads":[{"text":"OK"}],...}}

# 2. Test via API (small message)
curl -X POST https://your-domain.com/api/ai/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"message":"What is 2+2?","provider":"clawdbot"}' \
  --no-buffer

# 3. Test with large payload (256KB scan data)
curl -X POST https://your-domain.com/api/ai/app-analyze \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d @large-scan-data.json \
  --no-buffer -w "\nHTTP %{http_code} in %{time_total}s\n"

# 4. Test failover (set primary=gemini with invalid key)
# Should fail gemini → fail claude → succeed on clawdbot
```

---

## 12. Replication on Another Website

To use the **already-running** Clawdbot gateway on the same server for another website:

### What You Need (3 Files)

1. **`scripts/clawdbot-call.mjs`** — Gateway bridge (copy as-is, adjust import path if needed)
2. **`services/ai-engine.js`** — Just the Clawdbot section (clawdbotExec, clawdbotGenerate, clawdbotStreamToResponse + generate/streamToResponse router)
3. **Nginx location block** — `/api/ai/` with SSE settings

### Minimal Setup

```
your-other-app/
├── scripts/
│   └── clawdbot-call.mjs      ← Copy from this project
├── services/
│   └── ai-engine.js           ← Clawdbot section only (or full file)
├── routes/
│   └── ai.js                  ← Your API routes
└── server.js
```

### Key Adjustments

1. **`clawdbot-call.mjs` import path**: Update the `callGateway` import to match your server's Clawdbot install location:
   ```javascript
   // Find your path:  npm root -g  →  append /clawdbot/dist/gateway/call.js
   import { callGateway } from "/your/node/lib/node_modules/clawdbot/dist/gateway/call.js";
   ```

2. **`CLAWDBOT_HELPER` path**: Ensure it points to where you placed `clawdbot-call.mjs`:
   ```javascript
   const CLAWDBOT_HELPER = path.join(__dirname, '..', 'scripts', 'clawdbot-call.mjs');
   ```

3. **Nginx**: Add the `/api/ai/` location block with `proxy_read_timeout 300s` and `proxy_buffering off`

4. **No API key needed**: Clawdbot uses the key already configured on the server. Your app doesn't need any API keys for the Clawdbot provider.

### The gateway is shared — both apps connect to the same `ws://127.0.0.1:18789`. No conflicts because each call gets a unique `idempotencyKey`.

---

## Quick Start Checklist

- [ ] Install Clawdbot on server: `npm install -g clawdbot`
- [ ] Configure API key: `clawdbot config set apiKey <key>`
- [ ] Start gateway: `clawdbot gateway start` (verify port 18789)
- [ ] Create `scripts/clawdbot-call.mjs` with correct import path
- [ ] Test gateway bridge: `node scripts/clawdbot-call.mjs /tmp/test.txt`
- [ ] Add Clawdbot functions to `services/ai-engine.js` (clawdbotExec, clawdbotGenerate, clawdbotStreamToResponse)
- [ ] Wire into provider router: `if (provider === 'clawdbot') return ...`
- [ ] Update failover chain to include all 3 providers
- [ ] Add `<option value="clawdbot">Clawdbot (Kai)</option>` to UI dropdowns
- [ ] Configure Nginx: `/api/ai/` location with `proxy_read_timeout 300s`, `proxy_buffering off`
- [ ] Reload Nginx (use correct binary — BT Panel vs system!)
- [ ] Test: `curl` chat endpoint with `--no-buffer`
- [ ] Test: Large payload (app-analyze) to verify no ARG_MAX issues
- [ ] Deploy and monitor PM2 logs

---

*This document was updated from the live codebase of act.qcpaintshop.com after resolving all production errors. All line numbers reference the state as of Feb 23, 2026. Version 2.0 replaces the original CLI-based approach with the Gateway Bridge Pattern.*
