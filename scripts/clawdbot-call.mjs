#!/usr/bin/env node
// Helper: reads prompt from a file, calls Clawdbot gateway via WebSocket.
// Bypasses CLI argument size limit (kernel ARG_MAX / MAX_ARG_STRLEN).
// Usage: node clawdbot-call.mjs <prompt-file> [model]

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { callGateway } from "/www/server/nvm/versions/node/v22.20.0/lib/node_modules/clawdbot/dist/gateway/call.js";

const promptFile = process.argv[2];
if (!promptFile) {
    console.error(JSON.stringify({ status: "error", error: "Usage: node clawdbot-call.mjs <prompt-file> [model]" }));
    process.exit(1);
}

const message = readFileSync(promptFile, "utf8");
const model = process.argv[3]; // Optional model override (e.g. "anthropic/claude-sonnet-4-5")

const params = {
    message,
    agentId: "main",
    timeout: 280,
    idempotencyKey: randomUUID(),
};
if (model) params.model = model;

try {
    const response = await callGateway({
        method: "agent",
        params,
        expectFinal: true,
        timeoutMs: 290000,
    });
    console.log(JSON.stringify(response));
} catch (err) {
    console.error(JSON.stringify({ status: "error", error: String(err.message || err) }));
    process.exit(1);
}
