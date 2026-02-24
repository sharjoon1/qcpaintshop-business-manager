/**
 * AI Engine - Dual LLM Abstraction (Gemini + Claude)
 * Provides generate(), generateStream(), generateWithFailover()
 * API keys from ai_config table (fallback to .env)
 * Token tracking, system prompts, configurable providers
 */

const https = require('https');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pool = null;

function setPool(p) { pool = p; }

// ─── Provider configs ──────────────────────────────────────────

const GEMINI_BASE = 'generativelanguage.googleapis.com';
const GEMINI_DEFAULT_MODEL = 'gemini-2.0-flash';

const CLAUDE_BASE = 'api.anthropic.com';
const CLAUDE_DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const CLAUDE_VERSION = '2023-06-01';

// ─── System prompt ─────────────────────────────────────────────

const BUSINESS_SYSTEM_PROMPT = `You are an AI business assistant for Quality Colours, a paint retail company in India.

Key facts:
- Currency: INR (Indian Rupees, ₹)
- Timezone: IST (Indian Standard Time, UTC+5:30)
- Business: Paint retail with multiple branches
- Software: Zoho Books for invoicing, custom attendance tracking, lead management

When analyzing data:
- Always use ₹ symbol for currency values
- Format large numbers with Indian numbering (lakhs/crores) when appropriate
- Be specific with dates (use IST)
- Provide actionable recommendations
- Flag critical issues prominently
- Keep responses concise but comprehensive

When generating insights, output valid JSON with this structure:
{
  "summary": "Brief executive summary",
  "insights": [
    {
      "category": "revenue|collections|overdue|staff|leads|marketing|general",
      "severity": "info|warning|critical",
      "title": "Short title",
      "description": "Detailed description",
      "action_recommended": "What to do about it"
    }
  ]
}`;

// ─── Chat System Prompt (Business Manager persona) ─────────────

const CHAT_SYSTEM_PROMPT = `You are the Business Manager of Quality Colours, named "QC Manager". You are a seasoned paint industry executive with P&L responsibility — not just an assistant.

## About Quality Colours
- Multi-branch paint retail company based in Tamil Nadu, India
- Serves both B2B (contractors, builders, dealers) and B2C (homeowners) customers
- Uses Zoho Books for invoicing, payments, and inventory management
- Custom ERP: attendance tracking, lead management, stock checks, WhatsApp integration, collections tracking
- Currency: INR (₹). Use Indian numbering (lakhs/crores) for large amounts
- Timezone: IST (Indian Standard Time, UTC+5:30)

## Paint Industry Expertise
- Peak seasons: festival periods (Diwali/Pongal), pre-monsoon, wedding season
- Key brands: Asian Paints, Berger, Nerolac, Indigo, Dulux — know dealer margins, credit terms, schemes
- Product mix optimization: high-margin premium vs volume products
- Typical dealer economics: 15-25% margins, 30-45 day credit terms, quarterly incentives
- Market dynamics: monsoon impact, construction cycles, raw material price fluctuations
- Competition: local dealers, online platforms, direct sales

## Your Management Style
- **Strategic thinking**: Always connect daily operations to bigger business goals
- **Decision authority**: Make recommendations with confidence — you own the P&L
- **Performance-driven**: Focus on KPIs that matter: gross margin %, inventory turns, collection efficiency, sales per sq ft
- **Problem-solving**: When issues arise, provide 2-3 solution options with pros/cons
- **Growth-oriented**: Always looking for expansion opportunities, new revenue streams, efficiency gains
- **Team leadership**: Address staff performance directly, suggest training/incentives/restructuring
- **Financial acumen**: Understand working capital, cash conversion cycle, seasonal financing needs

## Response Approach
- **Executive summary first**: Lead with the key insight/decision needed
- **Data-driven analysis**: Use metrics to support every recommendation
- **Action-oriented**: Provide specific next steps with timelines and ownership
- **Risk assessment**: Flag potential issues before they become problems
- **Opportunity identification**: Spot growth/efficiency opportunities in the data
- **Stakeholder impact**: Consider effects on customers, staff, suppliers, cash flow

## Decision-Making Framework
1. Immediate impact on cash flow and customer satisfaction
2. Strategic alignment with growth and profitability goals
3. Resource requirements and ROI analysis
4. Implementation feasibility given current operations
5. Risk mitigation strategies

## Communication Style
- **Authoritative but collaborative**: "Based on the data, we need to..." not "Maybe we should consider..."
- **Business language**: Use terms like EBITDA, working capital, inventory turns, customer acquisition cost
- **Structured responses**: Executive summary → Analysis → Recommendations → Next steps
- **Metric-heavy**: Always include relevant KPIs and benchmarks
- **Forward-looking**: Connect current performance to future implications
- Format large currency values: use ₹1.2L (lakhs), ₹1.5Cr (crores) for readability
- Include trend indicators: ↑ ↓ → for up/down/flat comparisons

## Response Rules
- Never say "I can only..." — you're the manager, find solutions
- When data is missing, outline what you need and how to get it
- Provide specific recommendations with expected outcomes
- Address both operational efficiency and strategic growth
- Consider seasonal patterns and industry cycles in all advice
- Flag issues that need owner/senior management attention

## Data Context
You will receive real-time business data injected before each message. Use ALL of it in your response when relevant. The data is fresh from the database — treat it as authoritative. You have full authority to make operational recommendations and strategic suggestions for Quality Colours' growth and profitability.`;

// ─── Config loader ─────────────────────────────────────────────

let _configCache = null;
let _configCacheTime = 0;
const CONFIG_CACHE_TTL = 30000; // 30 seconds

async function getConfig() {
    // Cache config for 30s to avoid hammering DB on every request
    if (_configCache && (Date.now() - _configCacheTime) < CONFIG_CACHE_TTL) return _configCache;

    if (!pool) return { primary_provider: 'clawdbot', fallback_provider: 'clawdbot', max_tokens_per_request: '4096', temperature: '0.3' };
    try {
        const [rows] = await pool.query('SELECT config_key, config_value FROM ai_config');
        const config = {};
        rows.forEach(r => { config[r.config_key] = r.config_value; });
        _configCache = config;
        _configCacheTime = Date.now();
        return config;
    } catch (e) {
        return { primary_provider: 'clawdbot', fallback_provider: 'clawdbot', max_tokens_per_request: '4096', temperature: '0.3' };
    }
}

// Clear config cache (called when config is updated)
function clearConfigCache() {
    _configCache = null;
    _configCacheTime = 0;
}

/**
 * Get API key - checks ai_config first, falls back to .env
 */
async function getApiKey(provider) {
    const config = await getConfig();
    if (provider === 'gemini') {
        return config.gemini_api_key || process.env.GEMINI_API_KEY || '';
    }
    if (provider === 'claude') {
        return config.anthropic_api_key || process.env.ANTHROPIC_API_KEY || '';
    }
    return '';
}

/**
 * Check if a provider is enabled via ai_config flags
 * Enabled by default if no flag set — only disabled by explicit 'false'/'0'
 */
async function isProviderEnabled(provider) {
    const config = await getConfig();
    const key = provider === 'claude' ? 'claude_enabled' : `${provider}_enabled`;
    return config[key] !== 'false' && config[key] !== '0';
}

/**
 * Get model name for provider
 */
async function getModelName(provider) {
    const config = await getConfig();
    if (provider === 'gemini') {
        return config.gemini_model || process.env.AI_GEMINI_MODEL || GEMINI_DEFAULT_MODEL;
    }
    if (provider === 'claude') {
        return config.claude_model || CLAUDE_DEFAULT_MODEL;
    }
    return '';
}

// ─── HTTPS request helper ──────────────────────────────────────

function httpsRequest(options, body) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({ status: res.statusCode, data });
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 500)}`));
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(120000, () => { req.destroy(); reject(new Error('Request timeout (120s)')); });
        if (body) req.write(body);
        req.end();
    });
}

// ─── Gemini provider ───────────────────────────────────────────

function buildGeminiPayload(messages, temperature, maxTokens) {
    const contents = [];
    let systemInstruction = null;

    for (const msg of messages) {
        if (msg.role === 'system') {
            systemInstruction = { parts: [{ text: msg.content }] };
        } else {
            contents.push({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }]
            });
        }
    }

    return {
        contents,
        ...(systemInstruction ? { systemInstruction } : {}),
        generationConfig: { temperature, maxOutputTokens: maxTokens }
    };
}

function parseGeminiTokens(usageMetadata) {
    if (!usageMetadata) return 0;
    // Gemini API returns totalTokenCount, or promptTokenCount + candidatesTokenCount
    return usageMetadata.totalTokenCount ||
        ((usageMetadata.promptTokenCount || 0) + (usageMetadata.candidatesTokenCount || 0));
}

async function geminiGenerate(messages, options = {}) {
    const apiKey = await getApiKey('gemini');
    if (!apiKey) throw new Error('Gemini API key not configured. Add it in AI Settings.');

    const temperature = parseFloat(options.temperature || 0.3);
    const maxTokens = parseInt(options.maxTokens || 4096);
    const model = options.model || await getModelName('gemini');

    const body = JSON.stringify(buildGeminiPayload(messages, temperature, maxTokens));

    const resp = await httpsRequest({
        hostname: GEMINI_BASE,
        path: `/v1beta/models/${model}:generateContent?key=${apiKey}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, body);

    const json = JSON.parse(resp.data);
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const tokensUsed = parseGeminiTokens(json.usageMetadata);

    return { text, tokensUsed, model: `gemini/${model}`, provider: 'gemini' };
}

async function geminiStreamToResponse(messages, res, options = {}) {
    const apiKey = await getApiKey('gemini');
    if (!apiKey) throw new Error('Gemini API key not configured. Add it in AI Settings.');

    const temperature = parseFloat(options.temperature || 0.3);
    const maxTokens = parseInt(options.maxTokens || 4096);
    const model = options.model || await getModelName('gemini');

    const body = JSON.stringify(buildGeminiPayload(messages, temperature, maxTokens));

    return new Promise((resolve, reject) => {
        let fullText = '';
        let tokensUsed = 0;

        const req = https.request({
            hostname: GEMINI_BASE,
            path: `/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, (apiRes) => {
            // Check for HTTP errors from Gemini
            if (apiRes.statusCode !== 200) {
                let errData = '';
                apiRes.on('data', c => { errData += c; });
                apiRes.on('end', () => reject(new Error(`Gemini HTTP ${apiRes.statusCode}: ${errData.substring(0, 300)}`)));
                return;
            }

            let buffer = '';
            apiRes.on('data', (chunk) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const json = JSON.parse(line.slice(6));
                            const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
                            if (text) {
                                fullText += text;
                                res.write(`data: ${JSON.stringify({ text })}\n\n`);
                            }
                            // Token count — accumulate from every chunk that has it
                            const chunkTokens = parseGeminiTokens(json.usageMetadata);
                            if (chunkTokens > tokensUsed) tokensUsed = chunkTokens;
                        } catch (e) { /* skip parse errors */ }
                    }
                }
            });
            apiRes.on('end', () => {
                // Estimate tokens from text length if API didn't report
                if (tokensUsed === 0 && fullText.length > 0) {
                    tokensUsed = Math.ceil(fullText.length / 4); // rough estimate
                }
                resolve({ text: fullText, tokensUsed, model: `gemini/${model}`, provider: 'gemini' });
            });
            apiRes.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(120000, () => { req.destroy(); reject(new Error('Stream timeout')); });
        req.write(body);
        req.end();
    });
}

// ─── Claude provider ───────────────────────────────────────────

function buildClaudePayload(messages, model, maxTokens, temperature, stream) {
    let system = '';
    const apiMessages = [];
    for (const msg of messages) {
        if (msg.role === 'system') {
            system += (system ? '\n\n' : '') + msg.content;
        } else {
            apiMessages.push({ role: msg.role, content: msg.content });
        }
    }
    return {
        model,
        max_tokens: maxTokens,
        temperature,
        ...(stream ? { stream: true } : {}),
        ...(system ? { system } : {}),
        messages: apiMessages
    };
}

async function claudeGenerate(messages, options = {}) {
    const apiKey = await getApiKey('claude');
    if (!apiKey) throw new Error('Anthropic API key not configured. Add it in AI Settings.');

    const temperature = parseFloat(options.temperature || 0.3);
    const maxTokens = parseInt(options.maxTokens || 4096);
    const model = options.model || await getModelName('claude');

    const body = JSON.stringify(buildClaudePayload(messages, model, maxTokens, temperature, false));

    const resp = await httpsRequest({
        hostname: CLAUDE_BASE,
        path: '/v1/messages',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': CLAUDE_VERSION
        }
    }, body);

    const json = JSON.parse(resp.data);
    const text = json.content?.[0]?.text || '';
    const tokensUsed = (json.usage?.input_tokens || 0) + (json.usage?.output_tokens || 0);

    return { text, tokensUsed, model: `claude/${model}`, provider: 'claude' };
}

async function claudeStreamToResponse(messages, res, options = {}) {
    const apiKey = await getApiKey('claude');
    if (!apiKey) throw new Error('Anthropic API key not configured. Add it in AI Settings.');

    const temperature = parseFloat(options.temperature || 0.3);
    const maxTokens = parseInt(options.maxTokens || 4096);
    const model = options.model || await getModelName('claude');

    const body = JSON.stringify(buildClaudePayload(messages, model, maxTokens, temperature, true));

    return new Promise((resolve, reject) => {
        let fullText = '';
        let tokensUsed = 0;

        const req = https.request({
            hostname: CLAUDE_BASE,
            path: '/v1/messages',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': CLAUDE_VERSION
            }
        }, (apiRes) => {
            if (apiRes.statusCode !== 200) {
                let errData = '';
                apiRes.on('data', c => { errData += c; });
                apiRes.on('end', () => reject(new Error(`Claude HTTP ${apiRes.statusCode}: ${errData.substring(0, 300)}`)));
                return;
            }

            let buffer = '';
            apiRes.on('data', (chunk) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const event = JSON.parse(line.slice(6));
                            if (event.type === 'content_block_delta' && event.delta?.text) {
                                fullText += event.delta.text;
                                res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
                            }
                            if (event.type === 'message_delta' && event.usage) {
                                tokensUsed += event.usage.output_tokens || 0;
                            }
                            if (event.type === 'message_start' && event.message?.usage) {
                                tokensUsed += event.message.usage.input_tokens || 0;
                            }
                        } catch (e) { /* skip */ }
                    }
                }
            });
            apiRes.on('end', () => {
                if (tokensUsed === 0 && fullText.length > 0) {
                    tokensUsed = Math.ceil(fullText.length / 4);
                }
                resolve({ text: fullText, tokensUsed, model: `claude/${model}`, provider: 'claude' });
            });
            apiRes.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(120000, () => { req.destroy(); reject(new Error('Stream timeout')); });
        req.write(body);
        req.end();
    });
}

// ─── Clawdbot provider (Kai) ──────────────────────────────────

// Clawdbot gateway helper script path — calls gateway WebSocket directly,
// bypassing CLI argument size limits (kernel ARG_MAX / MAX_ARG_STRLEN)
const CLAWDBOT_HELPER = path.join(__dirname, '..', 'scripts', 'clawdbot-call.mjs');

function clawdbotExec(message) {
    // Write prompt to temp file, then call the gateway helper which reads
    // from file and sends via WebSocket (no argument size limit)
    const tmpFile = path.join(os.tmpdir(), `clawdbot-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    fs.writeFileSync(tmpFile, message, 'utf8');

    return new Promise((resolve, reject) => {
        execFile('node', [CLAWDBOT_HELPER, tmpFile], { timeout: 300000, maxBuffer: 1024 * 1024 * 5 }, (err, stdout, stderr) => {
            // Clean up temp file
            try { fs.unlinkSync(tmpFile); } catch (_) {}

            if (err) {
                // Include stderr for better debugging
                const detail = stderr ? stderr.trim() : err.message;
                return reject(new Error(`Clawdbot exec failed: ${detail}`));
            }
            try {
                const json = JSON.parse(stdout);
                if (json.status !== 'ok') return reject(new Error(`Clawdbot returned status: ${json.status}`));
                const text = json.result?.payloads?.[0]?.text || '';
                const usage = json.result?.meta?.agentMeta?.usage || {};
                const model = json.result?.meta?.agentMeta?.model || 'clawdbot';
                const tokensUsed = (usage.input || 0) + (usage.output || 0);
                resolve({ text, tokensUsed, model: `clawdbot/${model}`, provider: 'clawdbot' });
            } catch (e) {
                reject(new Error(`Clawdbot JSON parse failed: ${e.message}. stdout: ${stdout.substring(0, 200)}`));
            }
        });
    });
}

async function clawdbotGenerate(messages, options = {}) {
    // Combine system + user messages into one prompt for Clawdbot
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

async function clawdbotStreamToResponse(messages, res, options = {}) {
    // Clawdbot doesn't support true streaming, so we get the full response
    // then emit it in chunks to simulate streaming for the SSE client
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

// ─── Public API ────────────────────────────────────────────────

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

async function generateWithFailover(messages, options = {}) {
    const config = await getConfig();
    const primary = options.provider || config.primary_provider || 'clawdbot';
    const fallback = config.fallback_provider || (primary === 'gemini' ? 'claude' : 'gemini');
    // Build ordered provider chain: primary → fallback → remaining
    const allProviders = ['gemini', 'claude', 'clawdbot'];
    const chain = [primary, fallback, ...allProviders.filter(p => p !== primary && p !== fallback)];
    // Deduplicate while preserving order, then filter disabled providers
    const deduped = [...new Set(chain)];
    const providers = [];
    for (const p of deduped) {
        if (await isProviderEnabled(p)) providers.push(p);
    }
    if (providers.length === 0) throw new Error('No AI providers enabled. Check ai_config flags.');
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

async function streamWithFailover(messages, res, options = {}) {
    const config = await getConfig();
    const primary = options.provider || config.primary_provider || 'clawdbot';
    const fallback = config.fallback_provider || (primary === 'gemini' ? 'claude' : 'gemini');
    const allProviders = ['gemini', 'claude', 'clawdbot'];
    const chain = [primary, fallback, ...allProviders.filter(p => p !== primary && p !== fallback)];
    // Deduplicate and filter disabled providers
    const deduped = [...new Set(chain)];
    const providers = [];
    for (const p of deduped) {
        if (await isProviderEnabled(p)) providers.push(p);
    }
    if (providers.length === 0) throw new Error('No AI providers enabled. Check ai_config flags.');
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

function getSystemPrompt(extraContext = '') {
    return BUSINESS_SYSTEM_PROMPT + (extraContext ? '\n\n' + extraContext : '');
}

function getChatSystemPrompt(extraContext = '') {
    return CHAT_SYSTEM_PROMPT + (extraContext ? '\n\n' + extraContext : '');
}

module.exports = {
    setPool,
    generate,
    streamToResponse,
    generateWithFailover,
    streamWithFailover,
    getSystemPrompt,
    getChatSystemPrompt,
    getConfig,
    clearConfigCache
};
