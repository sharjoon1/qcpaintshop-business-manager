#!/usr/bin/env node
// Helper: reads prompt from a file, calls Clawdbot gateway via WebSocket.
// Bypasses CLI argument size limit (kernel ARG_MAX / MAX_ARG_STRLEN).
// Usage: node clawdbot-call.mjs <prompt-file>
//
// The gateway module is resolved at runtime (portable across Node upgrades /
// server moves), in priority order:
//   1. CLAWDBOT_GATEWAY_PATH env — full path to clawdbot's dist/gateway/call.js
//   2. require.resolve('clawdbot/dist/gateway/call.js') — local node_modules
//   3. the legacy hardcoded prod path (nvm-global install)

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const LEGACY_GATEWAY_PATH =
    "/www/server/nvm/versions/node/v22.20.0/lib/node_modules/clawdbot/dist/gateway/call.js";

async function loadCallGateway() {
    const candidates = [];
    if (process.env.CLAWDBOT_GATEWAY_PATH) {
        candidates.push(process.env.CLAWDBOT_GATEWAY_PATH);
    }
    try {
        const require = createRequire(import.meta.url);
        candidates.push(require.resolve("clawdbot/dist/gateway/call.js"));
    } catch {
        // clawdbot not installed locally — fall through
    }
    candidates.push(LEGACY_GATEWAY_PATH);

    const failures = [];
    for (const candidate of candidates) {
        try {
            const mod = await import(pathToFileURL(candidate).href);
            if (typeof mod.callGateway === "function") return mod.callGateway;
            failures.push(`${candidate}: no callGateway export`);
        } catch (err) {
            failures.push(`${candidate}: ${err.code || err.message}`);
        }
    }
    throw new Error(
        `clawdbot gateway module not found (set CLAWDBOT_GATEWAY_PATH). Tried: ${failures.join("; ")}`
    );
}

const promptFile = process.argv[2];
if (!promptFile) {
    console.error(JSON.stringify({ status: "error", error: "Usage: node clawdbot-call.mjs <prompt-file>" }));
    process.exit(1);
}

const message = readFileSync(promptFile, "utf8");

try {
    const callGateway = await loadCallGateway();
    const response = await callGateway({
        method: "agent",
        params: {
            message,
            agentId: "main",
            timeout: 280,
            idempotencyKey: randomUUID(),
        },
        expectFinal: true,
        timeoutMs: 290000,
    });
    console.log(JSON.stringify(response));
} catch (err) {
    console.error(JSON.stringify({ status: "error", error: String(err.message || err) }));
    process.exit(1);
}
