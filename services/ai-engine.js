/**
 * AI Engine - Dual LLM Abstraction (Gemini + Claude)
 * Provides generate(), generateStream(), generateWithFailover()
 * Token tracking, system prompts, configurable providers
 */

const https = require('https');
const http = require('http');

let pool = null;

function setPool(p) { pool = p; }

// ─── Provider configs ──────────────────────────────────────────

const GEMINI_BASE = 'generativelanguage.googleapis.com';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

const CLAUDE_BASE = 'api.anthropic.com';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
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

// ─── Config loader ─────────────────────────────────────────────

async function getConfig() {
    if (!pool) return { primary_provider: 'gemini', fallback_provider: 'claude', max_tokens_per_request: '4096', temperature: '0.3' };
    try {
        const [rows] = await pool.query('SELECT config_key, config_value FROM ai_config');
        const config = {};
        rows.forEach(r => { config[r.config_key] = r.config_value; });
        return config;
    } catch (e) {
        return { primary_provider: 'gemini', fallback_provider: 'claude', max_tokens_per_request: '4096', temperature: '0.3' };
    }
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

async function geminiGenerate(messages, options = {}) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not set');

    const temperature = parseFloat(options.temperature || 0.3);
    const maxTokens = parseInt(options.maxTokens || 4096);

    // Build Gemini contents from messages array
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

    const body = JSON.stringify({
        contents,
        ...(systemInstruction ? { systemInstruction } : {}),
        generationConfig: {
            temperature,
            maxOutputTokens: maxTokens
        }
    });

    const model = options.model || GEMINI_MODEL;
    const resp = await httpsRequest({
        hostname: GEMINI_BASE,
        path: `/v1beta/models/${model}:generateContent?key=${apiKey}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, body);

    const json = JSON.parse(resp.data);
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const tokensUsed = (json.usageMetadata?.promptTokenCount || 0) + (json.usageMetadata?.candidatesTokenCount || 0);

    return { text, tokensUsed, model: `gemini/${model}`, provider: 'gemini' };
}

// ─── Claude provider ───────────────────────────────────────────

async function claudeGenerate(messages, options = {}) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const temperature = parseFloat(options.temperature || 0.3);
    const maxTokens = parseInt(options.maxTokens || 4096);

    // Separate system from messages
    let system = '';
    const apiMessages = [];
    for (const msg of messages) {
        if (msg.role === 'system') {
            system += (system ? '\n\n' : '') + msg.content;
        } else {
            apiMessages.push({ role: msg.role, content: msg.content });
        }
    }

    const body = JSON.stringify({
        model: options.model || CLAUDE_MODEL,
        max_tokens: maxTokens,
        temperature,
        ...(system ? { system } : {}),
        messages: apiMessages
    });

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

    return { text, tokensUsed, model: `claude/${options.model || CLAUDE_MODEL}`, provider: 'claude' };
}

// Claude streaming - returns SSE-compatible chunks via callback
async function claudeStreamToResponse(messages, res, options = {}) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const temperature = parseFloat(options.temperature || 0.3);
    const maxTokens = parseInt(options.maxTokens || 4096);

    let system = '';
    const apiMessages = [];
    for (const msg of messages) {
        if (msg.role === 'system') {
            system += (system ? '\n\n' : '') + msg.content;
        } else {
            apiMessages.push({ role: msg.role, content: msg.content });
        }
    }

    const body = JSON.stringify({
        model: options.model || CLAUDE_MODEL,
        max_tokens: maxTokens,
        temperature,
        stream: true,
        ...(system ? { system } : {}),
        messages: apiMessages
    });

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
            apiRes.on('end', () => resolve({ text: fullText, tokensUsed, model: `claude/${options.model || CLAUDE_MODEL}`, provider: 'claude' }));
            apiRes.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(120000, () => { req.destroy(); reject(new Error('Stream timeout')); });
        req.write(body);
        req.end();
    });
}

// Gemini streaming - pipe to SSE response
async function geminiStreamToResponse(messages, res, options = {}) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not set');

    const temperature = parseFloat(options.temperature || 0.3);
    const maxTokens = parseInt(options.maxTokens || 4096);

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

    const body = JSON.stringify({
        contents,
        ...(systemInstruction ? { systemInstruction } : {}),
        generationConfig: { temperature, maxOutputTokens: maxTokens }
    });

    const model = options.model || GEMINI_MODEL;

    return new Promise((resolve, reject) => {
        let fullText = '';
        let tokensUsed = 0;

        const req = https.request({
            hostname: GEMINI_BASE,
            path: `/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, (apiRes) => {
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
                            if (json.usageMetadata) {
                                tokensUsed = (json.usageMetadata.promptTokenCount || 0) + (json.usageMetadata.candidatesTokenCount || 0);
                            }
                        } catch (e) { /* skip */ }
                    }
                }
            });
            apiRes.on('end', () => resolve({ text: fullText, tokensUsed, model: `gemini/${model}`, provider: 'gemini' }));
            apiRes.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(120000, () => { req.destroy(); reject(new Error('Stream timeout')); });
        req.write(body);
        req.end();
    });
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Generate a full response (non-streaming)
 * @param {Array} messages - [{role: 'system'|'user'|'assistant', content: string}]
 * @param {Object} options - {provider, temperature, maxTokens, model}
 * @returns {Object} {text, tokensUsed, model, provider}
 */
async function generate(messages, options = {}) {
    const config = await getConfig();
    const provider = options.provider || config.primary_provider || 'gemini';
    const opts = {
        temperature: options.temperature || config.temperature || '0.3',
        maxTokens: options.maxTokens || config.max_tokens_per_request || '4096',
        model: options.model
    };

    if (provider === 'claude') {
        return claudeGenerate(messages, opts);
    }
    return geminiGenerate(messages, opts);
}

/**
 * Stream response to an Express SSE response object
 * @param {Array} messages
 * @param {Object} res - Express response (already configured for SSE)
 * @param {Object} options
 * @returns {Object} {text, tokensUsed, model, provider}
 */
async function streamToResponse(messages, res, options = {}) {
    const config = await getConfig();
    const provider = options.provider || config.primary_provider || 'gemini';
    const opts = {
        temperature: options.temperature || config.temperature || '0.3',
        maxTokens: options.maxTokens || config.max_tokens_per_request || '4096',
        model: options.model
    };

    if (provider === 'claude') {
        return claudeStreamToResponse(messages, res, opts);
    }
    return geminiStreamToResponse(messages, res, opts);
}

/**
 * Generate with automatic failover to secondary provider
 * @param {Array} messages
 * @param {Object} options
 * @returns {Object} {text, tokensUsed, model, provider, failedOver}
 */
async function generateWithFailover(messages, options = {}) {
    const config = await getConfig();
    const primary = options.provider || config.primary_provider || 'gemini';
    const fallback = primary === 'gemini' ? 'claude' : 'gemini';
    const opts = {
        temperature: options.temperature || config.temperature || '0.3',
        maxTokens: options.maxTokens || config.max_tokens_per_request || '4096',
        model: options.model
    };

    try {
        const result = await generate(messages, { ...opts, provider: primary });
        return { ...result, failedOver: false };
    } catch (primaryErr) {
        console.error(`[AI Engine] Primary provider (${primary}) failed:`, primaryErr.message);
        try {
            const result = await generate(messages, { ...opts, provider: fallback });
            return { ...result, failedOver: true };
        } catch (fallbackErr) {
            console.error(`[AI Engine] Fallback provider (${fallback}) also failed:`, fallbackErr.message);
            throw new Error(`Both AI providers failed. Primary (${primary}): ${primaryErr.message}. Fallback (${fallback}): ${fallbackErr.message}`);
        }
    }
}

/**
 * Stream with failover - if primary fails, falls back to non-streaming secondary
 */
async function streamWithFailover(messages, res, options = {}) {
    const config = await getConfig();
    const primary = options.provider || config.primary_provider || 'gemini';
    const fallback = primary === 'gemini' ? 'claude' : 'gemini';
    const opts = {
        temperature: options.temperature || config.temperature || '0.3',
        maxTokens: options.maxTokens || config.max_tokens_per_request || '4096',
        model: options.model
    };

    try {
        return await streamToResponse(messages, res, { ...opts, provider: primary });
    } catch (primaryErr) {
        console.error(`[AI Engine] Primary stream (${primary}) failed:`, primaryErr.message);
        try {
            return await streamToResponse(messages, res, { ...opts, provider: fallback });
        } catch (fallbackErr) {
            throw new Error(`Both providers failed for streaming`);
        }
    }
}

/**
 * Get the business system prompt, optionally with extra context
 */
function getSystemPrompt(extraContext = '') {
    return BUSINESS_SYSTEM_PROMPT + (extraContext ? '\n\n' + extraContext : '');
}

module.exports = {
    setPool,
    generate,
    streamToResponse,
    generateWithFailover,
    streamWithFailover,
    getSystemPrompt,
    getConfig
};
