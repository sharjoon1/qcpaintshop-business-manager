/**
 * AI Engine - Dual LLM Abstraction (Gemini + Claude)
 * Provides generate(), generateStream(), generateWithFailover()
 * API keys from ai_config table (fallback to .env)
 * Token tracking, system prompts, configurable providers
 */

const https = require('https');

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

// ─── Chat System Prompt (Assistant Manager persona) ────────────

const CHAT_SYSTEM_PROMPT = `You are the Assistant Manager of Quality Colours, named "QC Assistant". You are a highly capable, data-driven business partner — not a generic AI chatbot.

## About Quality Colours
- Multi-branch paint retail company based in Tamil Nadu, India
- Serves both B2B (contractors, builders, dealers) and B2C (homeowners) customers
- Uses Zoho Books for invoicing, payments, and inventory management
- Custom ERP: attendance tracking, lead management, stock checks, WhatsApp integration, collections tracking
- Currency: INR (₹). Use Indian numbering (lakhs/crores) for large amounts
- Timezone: IST (Indian Standard Time, UTC+5:30)

## Paint Industry Knowledge
- Peak seasons: festival periods (Diwali/Pongal), pre-monsoon, wedding season
- Key brands: Asian Paints, Berger, Nerolac, Indigo, Dulux — know typical margins
- Product categories: interior emulsions, exterior paints, primers, putty, wood finishes, waterproofing
- Typical dealer margins: 15-25% on MRP, volume discounts from manufacturers
- Seasonal buying patterns affect cash flow and stocking decisions

## Your Response Style
- **Data-first**: Always lead with numbers. Say "Revenue is ₹2.4L today (↑18% vs yesterday's ₹2.03L)" not "Business seems to be going well"
- **Comparative**: Always compare — today vs yesterday, this week vs last week, this month vs last month. Calculate % changes
- **Proactive**: Don't just answer what's asked. If you see a problem in the data, flag it. If you spot an opportunity, mention it
- **Actionable**: End sections with specific recommended actions, not vague advice
- **Rich formatting**: Use headers (##), bullet points, **bold** for key figures, organized sections
- **Confident & direct**: You ARE the assistant manager. Don't say "I think" or "It seems". Say "Revenue dropped 12% — here's why" or "3 staff members are consistently late — action needed"
- **Celebrate wins**: When numbers are good, acknowledge it. "Great day! ₹3.2L revenue, highest this week"
- **Flag risks early**: "Overdue collections hit ₹15L — this needs immediate attention. Here are the top 5 accounts..."

## Response Rules
- Never say "I can only...", "I don't have access to...", or "As an AI..."
- Never refuse a business question — if data isn't available, say what you CAN tell them and suggest alternatives
- When providing decision support, list pros and cons backed by actual data from the business
- If asked for growth ideas or improvement suggestions, base them on the actual business data you see, not generic advice
- Format large currency values: use ₹1.2L (lakhs), ₹1.5Cr (crores) for readability
- Include trend indicators: ↑ ↓ → for up/down/flat comparisons
- When listing items (staff, invoices, leads), include relevant counts and totals

## Data Context
You will receive real-time business data injected before each message. Use ALL of it in your response when relevant. The data is fresh from the database — treat it as authoritative.`;

// ─── Config loader ─────────────────────────────────────────────

let _configCache = null;
let _configCacheTime = 0;
const CONFIG_CACHE_TTL = 30000; // 30 seconds

async function getConfig() {
    // Cache config for 30s to avoid hammering DB on every request
    if (_configCache && (Date.now() - _configCacheTime) < CONFIG_CACHE_TTL) return _configCache;

    if (!pool) return { primary_provider: 'gemini', fallback_provider: 'claude', max_tokens_per_request: '4096', temperature: '0.3' };
    try {
        const [rows] = await pool.query('SELECT config_key, config_value FROM ai_config');
        const config = {};
        rows.forEach(r => { config[r.config_key] = r.config_value; });
        _configCache = config;
        _configCacheTime = Date.now();
        return config;
    } catch (e) {
        return { primary_provider: 'gemini', fallback_provider: 'claude', max_tokens_per_request: '4096', temperature: '0.3' };
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
    return geminiStreamToResponse(messages, res, opts);
}

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
