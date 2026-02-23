/**
 * AI Routes — 15+ endpoints for chat, insights, config, lead scores, analysis
 * SSE streaming for chat, Socket.io for real-time updates
 */

const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/permissionMiddleware');
const aiEngine = require('../services/ai-engine');
const aiAnalyzer = require('../services/ai-analyzer');
const aiStaffAnalyzer = require('../services/ai-staff-analyzer');
const aiLeadManager = require('../services/ai-lead-manager');
const aiMarketing = require('../services/ai-marketing');
const aiScheduler = require('../services/ai-scheduler');
const contextBuilder = require('../services/ai-context-builder');

let pool = null;
let io = null;
let appCollector = null;

function setPool(p) { pool = p; contextBuilder.setPool(p); }
function setIO(i) { io = i; }
function setCollector(c) { appCollector = c; }

// ═══════════════════════════════════════════════════════════════
// CONVERSATIONS
// ═══════════════════════════════════════════════════════════════

// GET /api/ai/conversations — list user's conversations
router.get('/conversations', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT id, title, model_provider, created_at, updated_at
             FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50`,
            [req.user.id]
        );
        res.json({ data: rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/ai/conversations — create new conversation
router.post('/conversations', requireAuth, async (req, res) => {
    try {
        const { title, model_provider } = req.body;
        const [result] = await pool.query(
            'INSERT INTO ai_conversations (user_id, title, model_provider) VALUES (?, ?, ?)',
            [req.user.id, title || 'New Chat', model_provider || 'gemini']
        );
        res.json({ id: result.insertId, title: title || 'New Chat', model_provider: model_provider || 'gemini' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// DELETE /api/ai/conversations/:id
router.delete('/conversations/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM ai_conversations WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/ai/conversations/:id/messages
router.get('/conversations/:id/messages', requireAuth, async (req, res) => {
    try {
        // Verify ownership
        const [conv] = await pool.query(
            'SELECT id FROM ai_conversations WHERE id = ? AND user_id = ?',
            [req.params.id, req.user.id]
        );
        if (!conv.length) return res.status(404).json({ error: 'Conversation not found' });

        const [messages] = await pool.query(
            'SELECT id, role, content, tokens_used, model, created_at FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC',
            [req.params.id]
        );
        res.json({ data: messages });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// CHAT (SSE Streaming)
// ═══════════════════════════════════════════════════════════════

router.post('/chat', requireAuth, async (req, res) => {
    const { conversation_id, message, provider } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();

    let convId = conversation_id;

    try {
        // Create conversation if needed
        if (!convId) {
            const title = message.substring(0, 80) + (message.length > 80 ? '...' : '');
            const [result] = await pool.query(
                'INSERT INTO ai_conversations (user_id, title, model_provider) VALUES (?, ?, ?)',
                [req.user.id, title, provider || 'gemini']
            );
            convId = result.insertId;
            res.write(`data: ${JSON.stringify({ type: 'conversation', id: convId, title })}\n\n`);
        }

        // Save user message
        await pool.query(
            'INSERT INTO ai_messages (conversation_id, role, content) VALUES (?, ?, ?)',
            [convId, 'user', message]
        );

        // Build context: load conversation history + business context
        const [history] = await pool.query(
            'SELECT role, content FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC',
            [convId]
        );

        // Build comprehensive business context via context builder
        const { contextText, contextSummary } = await contextBuilder.buildChatContext(message);

        // Use chat-specific system prompt + context
        const config = await aiEngine.getConfig();
        const chatMaxTokens = config.chat_max_tokens || '8192';
        const chatTemperature = config.chat_temperature || '0.5';

        const messages = [
            { role: 'system', content: aiEngine.getChatSystemPrompt(contextText) },
            ...history.map(h => ({ role: h.role, content: h.content }))
        ];

        // Stream response with chat-specific settings
        const result = await aiEngine.streamWithFailover(messages, res, {
            provider,
            maxTokens: chatMaxTokens,
            temperature: chatTemperature
        });

        // Save assistant message with context summary for debugging
        await pool.query(
            'INSERT INTO ai_messages (conversation_id, role, content, tokens_used, model, context_summary) VALUES (?, ?, ?, ?, ?, ?)',
            [convId, 'assistant', result.text, result.tokensUsed, result.model, contextSummary]
        );

        // Update conversation timestamp
        await pool.query('UPDATE ai_conversations SET updated_at = NOW() WHERE id = ?', [convId]);

        // Send done event
        res.write(`data: ${JSON.stringify({ type: 'done', tokens: result.tokensUsed, model: result.model })}\n\n`);
        res.end();

    } catch (e) {
        console.error('[AI Chat] Error:', e.message);
        res.write(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`);
        res.end();
    }
});

// ═══════════════════════════════════════════════════════════════
// INSIGHTS
// ═══════════════════════════════════════════════════════════════

// GET /api/ai/insights — list insights
router.get('/insights', requireAuth, async (req, res) => {
    try {
        const { category, severity, unread, limit = 50, offset = 0 } = req.query;
        let where = 'WHERE is_dismissed = 0';
        const params = [];

        if (category) { where += ' AND category = ?'; params.push(category); }
        if (severity) { where += ' AND severity = ?'; params.push(severity); }
        if (unread === '1') { where += ' AND is_read = 0'; }

        const [rows] = await pool.query(
            `SELECT id, analysis_run_id, category, severity, title, description, action_recommended, is_read, created_at
             FROM ai_insights ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), parseInt(offset)]
        );
        res.json({ data: rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/ai/insights/summary — unread counts
router.get('/insights/summary', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT
                category,
                severity,
                COUNT(*) as count
            FROM ai_insights
            WHERE is_read = 0 AND is_dismissed = 0
            GROUP BY category, severity
        `);

        const summary = { total: 0, by_category: {}, by_severity: { info: 0, warning: 0, critical: 0 } };
        rows.forEach(r => {
            summary.total += r.count;
            summary.by_category[r.category] = (summary.by_category[r.category] || 0) + r.count;
            summary.by_severity[r.severity] = (summary.by_severity[r.severity] || 0) + r.count;
        });

        res.json(summary);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// PUT /api/ai/insights/:id/read
router.put('/insights/:id/read', requireAuth, async (req, res) => {
    try {
        await pool.query('UPDATE ai_insights SET is_read = 1 WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// PUT /api/ai/insights/:id/dismiss
router.put('/insights/:id/dismiss', requireAuth, async (req, res) => {
    try {
        await pool.query('UPDATE ai_insights SET is_dismissed = 1 WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/ai/insights/read-all — mark all as read
router.post('/insights/read-all', requireAuth, async (req, res) => {
    try {
        const { category } = req.body;
        let query = 'UPDATE ai_insights SET is_read = 1 WHERE is_read = 0';
        const params = [];
        if (category) { query += ' AND category = ?'; params.push(category); }
        const [result] = await pool.query(query, params);
        res.json({ success: true, updated: result.affectedRows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// ANALYSIS RUNS
// ═══════════════════════════════════════════════════════════════

// GET /api/ai/analysis-runs
router.get('/analysis-runs', requireAuth, async (req, res) => {
    try {
        const { type, limit = 20 } = req.query;
        let where = '';
        const params = [];
        if (type) { where = 'WHERE analysis_type = ?'; params.push(type); }

        const [rows] = await pool.query(
            `SELECT id, analysis_type, status, summary, model_provider, tokens_used, duration_ms, created_at
             FROM ai_analysis_runs ${where} ORDER BY created_at DESC LIMIT ?`,
            [...params, parseInt(limit)]
        );
        res.json({ data: rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/ai/analysis/run — manually trigger analysis
router.post('/analysis/run', requireAuth, async (req, res) => {
    const { type } = req.body;
    const validTypes = ['zoho_daily', 'zoho_weekly', 'staff_daily', 'lead_scoring', 'marketing_tips'];
    if (!validTypes.includes(type)) {
        return res.status(400).json({ error: `Invalid type. Valid: ${validTypes.join(', ')}` });
    }

    res.json({ status: 'started', type });

    // Run async (don't block response)
    try {
        switch (type) {
            case 'zoho_daily': await aiScheduler.runZohoDaily(); break;
            case 'zoho_weekly': await aiScheduler.runZohoWeekly(); break;
            case 'staff_daily': await aiScheduler.runStaffDaily(); break;
            case 'lead_scoring': await aiScheduler.runLeadScoring(); break;
            case 'marketing_tips': await aiScheduler.runMarketingWeekly(); break;
        }
    } catch (e) {
        console.error(`[AI Route] Manual ${type} run failed:`, e.message);
    }
});

// ═══════════════════════════════════════════════════════════════
// LEAD SCORES
// ═══════════════════════════════════════════════════════════════

// GET /api/ai/lead-scores
router.get('/lead-scores', requireAuth, async (req, res) => {
    try {
        const { limit = 50, min_score = 0 } = req.query;
        const [rows] = await pool.query(`
            SELECT als.*, l.name as lead_name, l.phone, l.status as lead_status,
                   l.source, l.estimated_value, u.name as assigned_name
            FROM ai_lead_scores als
            JOIN leads l ON als.lead_id = l.id
            LEFT JOIN users u ON als.suggested_assignee = u.id
            WHERE als.score >= ?
            ORDER BY als.score DESC LIMIT ?`,
            [parseInt(min_score), parseInt(limit)]
        );
        res.json({ data: rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/ai/lead-scores/:leadId
router.get('/lead-scores/:leadId', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT als.*, l.name as lead_name, l.phone, l.status as lead_status
             FROM ai_lead_scores als JOIN leads l ON als.lead_id = l.id
             WHERE als.lead_id = ? ORDER BY als.scored_at DESC LIMIT 1`,
            [req.params.leadId]
        );
        if (!rows.length) return res.status(404).json({ error: 'No score found' });
        res.json(rows[0]);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

// GET /api/ai/config
router.get('/config', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT config_key, config_value, updated_at FROM ai_config');
        const config = {};
        rows.forEach(r => { config[r.config_key] = r.config_value; });
        // Mask API keys — only send last 4 chars to frontend
        const sensitiveKeys = ['gemini_api_key', 'anthropic_api_key'];
        for (const k of sensitiveKeys) {
            if (config[k]) {
                config[k] = '••••••••' + config[k].slice(-4);
            }
        }
        res.json(config);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// PUT /api/ai/config
router.put('/config', requireAuth, async (req, res) => {
    try {
        const updates = req.body;
        for (const [key, value] of Object.entries(updates)) {
            // Skip masked API key values (starts with ••••) — means user didn't change it
            if ((key === 'gemini_api_key' || key === 'anthropic_api_key') && String(value).startsWith('••••')) {
                continue;
            }
            await pool.query(
                `INSERT INTO ai_config (config_key, config_value) VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE config_value = ?`,
                [key, String(value), String(value)]
            );
        }
        // Clear cached config so changes take effect immediately
        aiEngine.clearConfigCache();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// SUGGESTIONS
// ═══════════════════════════════════════════════════════════════

// GET /api/ai/suggestions — list suggestions (filterable)
router.get('/suggestions', requireAuth, async (req, res) => {
    try {
        const { category, status, limit = 50, offset = 0 } = req.query;
        let where = 'WHERE 1=1';
        const params = [];

        if (category) { where += ' AND category = ?'; params.push(category); }
        if (status) { where += ' AND status = ?'; params.push(status); }

        const [rows] = await pool.query(
            `SELECT id, category, suggestion, reasoning, priority, status, source, conversation_id, created_at, updated_at
             FROM ai_suggestions ${where} ORDER BY FIELD(priority,'critical','high','medium','low'), created_at DESC LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), parseInt(offset)]
        );
        res.json({ data: rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/ai/suggestions/summary — counts by status
router.get('/suggestions/summary', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT status, COUNT(*) as count FROM ai_suggestions GROUP BY status
        `);
        const summary = { total: 0, by_status: {} };
        rows.forEach(r => { summary.total += r.count; summary.by_status[r.status] = r.count; });
        res.json(summary);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// PUT /api/ai/suggestions/:id — update status
router.put('/suggestions/:id', requireAuth, async (req, res) => {
    try {
        const { status } = req.body;
        const validStatuses = ['new', 'acknowledged', 'in_progress', 'implemented', 'dismissed'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Valid: ${validStatuses.join(', ')}` });
        }
        await pool.query('UPDATE ai_suggestions SET status = ? WHERE id = ?', [status, req.params.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/ai/context/refresh — manually refresh daily snapshot
router.post('/context/refresh', requireAuth, async (req, res) => {
    try {
        const data = await contextBuilder.generateDailySnapshot();
        res.json({ success: true, data });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════

// GET /api/ai/stats
router.get('/stats', requireAuth, async (req, res) => {
    try {
        const [runs] = await pool.query(`
            SELECT
                COUNT(*) as total_runs,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
                COALESCE(SUM(tokens_used), 0) as total_tokens,
                COALESCE(AVG(duration_ms), 0) as avg_duration_ms
            FROM ai_analysis_runs
        `);

        const [messages] = await pool.query(`
            SELECT COUNT(*) as total_messages, COALESCE(SUM(tokens_used), 0) as chat_tokens
            FROM ai_messages WHERE role = 'assistant'
        `);

        const [insights] = await pool.query(`
            SELECT
                COUNT(*) as total_insights,
                COUNT(CASE WHEN is_read = 0 AND is_dismissed = 0 THEN 1 END) as unread
            FROM ai_insights
        `);

        const [recentRuns] = await pool.query(`
            SELECT analysis_type, status, model_provider, tokens_used, duration_ms, created_at
            FROM ai_analysis_runs ORDER BY created_at DESC LIMIT 10
        `);

        res.json({
            analysis: runs[0],
            chat: messages[0],
            insights: insights[0],
            recent_runs: recentRuns,
            // Rough cost estimate (Gemini Flash ~$0.075/1M tokens, Claude ~$3/1M input)
            estimated_cost_usd: ((runs[0].total_tokens + messages[0].chat_tokens) * 0.000001 * 0.5).toFixed(4)
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// APP ANALYZER
// ═══════════════════════════════════════════════════════════════

// GET /api/ai/app-scan — run full application scan
router.get('/app-scan', requireAuth, async (req, res) => {
    try {
        if (!appCollector) return res.status(500).json({ error: 'App collector not initialized' });
        const scanData = await appCollector.runFullScan();
        res.json(scanData);
    } catch (e) {
        console.error('[AI AppScan] Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/ai/app-analyze — AI deep analysis of scan data (SSE streaming)
router.post('/app-analyze', requireAuth, async (req, res) => {
    const { scanData, focus } = req.body;
    if (!scanData) return res.status(400).json({ error: 'scanData required' });

    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();

    try {
        // Build focused context based on area
        let contextParts = [];
        if (!focus || focus === 'all') {
            contextParts.push(JSON.stringify(scanData, null, 1));
        } else {
            if (focus === 'database' && scanData.database) contextParts.push('DATABASE:\n' + JSON.stringify(scanData.database, null, 1));
            if (focus === 'routes' && scanData.routes) contextParts.push('ROUTES:\n' + JSON.stringify(scanData.routes, null, 1));
            if (focus === 'errors' && scanData.errors) contextParts.push('ERRORS:\n' + JSON.stringify(scanData.errors, null, 1));
            if (focus === 'performance' && scanData.health) contextParts.push('HEALTH:\n' + JSON.stringify(scanData.health, null, 1));
            if (scanData.business) contextParts.push('BUSINESS STATS:\n' + JSON.stringify(scanData.business, null, 1));
        }

        const analysisPrompt = `You are an expert application analyzer for a Node.js/Express business management app (QC Paint Shop Business Manager).

APPLICATION METADATA:
${contextParts.join('\n\n')}

Analyze this application data and provide:
1. **Critical Issues** — bugs, security risks, performance problems that need immediate fixing
2. **Warnings** — things that could become problems (missing indexes, empty tables, large tables, error patterns)
3. **Optimization Opportunities** — performance improvements, code structure improvements
4. **Feature Gaps** — missing functionality based on the data model and routes

For EACH issue found, output it in this format:
### [SEVERITY: critical/warning/info] Issue Title
**Location:** table/route/component affected
**Description:** What the issue is and why it matters
**Fix Prompt:**
\`\`\`
Provide a ready-to-paste prompt for Claude Code that would fix this specific issue. Be specific about file paths, table names, and exact changes needed.
\`\`\`

Focus area: ${focus || 'all'}
Be thorough but concise. Prioritize actionable items.`;

        const messages = [
            { role: 'system', content: 'You are a senior full-stack developer analyzing a production Node.js/Express application. Output structured findings with fix prompts.' },
            { role: 'user', content: analysisPrompt }
        ];

        const result = await aiEngine.streamWithFailover(messages, res, {
            maxTokens: '8192',
            temperature: '0.3'
        });

        res.write(`data: ${JSON.stringify({ type: 'done', tokens: result.tokensUsed, model: result.model })}\n\n`);
        res.end();

    } catch (e) {
        console.error('[AI AppAnalyze] Error:', e.message);
        res.write(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`);
        res.end();
    }
});

// POST /api/ai/generate-prompt — generate implementation prompt
router.post('/generate-prompt', requireAuth, async (req, res) => {
    const { type, description, context } = req.body;
    if (!type || !description) return res.status(400).json({ error: 'type and description required' });

    try {
        let systemMsg, userMsg;

        if (type === 'fix') {
            systemMsg = 'You are a senior developer. Generate a precise, copy-paste-ready prompt for Claude Code to fix the described issue in a Node.js/Express app (QC Paint Shop Business Manager). Include specific file paths, exact changes, and testing steps.';
            userMsg = `Generate a fix prompt for this issue:\n\n${description}\n\n${context ? 'Additional context:\n' + context : ''}

Output ONLY the prompt text that a developer would paste into Claude Code. Start with "Fix:" or "In file X, ..." — make it actionable and specific.`;
        } else if (type === 'upgrade') {
            systemMsg = 'You are a senior developer and business analyst. Based on the application metadata, suggest upgrades and new features. For each suggestion, generate a ready-to-paste Claude Code implementation prompt.';
            userMsg = `Based on this application data, suggest the top 5 most impactful upgrades or new features:\n\n${description}\n\n${context ? 'Business context:\n' + context : ''}

For each suggestion, provide:
1. **Title** — what to build
2. **Business Value** — why it matters (1 sentence)
3. **Implementation Prompt:**
\`\`\`
A complete, ready-to-paste prompt for Claude Code that implements this feature. Be specific about file locations, database changes, UI placement, and testing.
\`\`\``;
        } else {
            // custom
            systemMsg = 'You are a senior full-stack developer. Convert the user\'s plain-language requirement into a detailed, technical implementation prompt for Claude Code. The app is a Node.js/Express business management system (QC Paint Shop Business Manager) with MySQL, Socket.io, Tailwind CSS, and vanilla JS frontend.';
            userMsg = `Convert this requirement into a detailed Claude Code implementation prompt:\n\n"${description}"\n\n${context ? 'App context:\n' + context : ''}

Output a complete, specific prompt that includes:
- What files to create/modify
- Database schema changes if needed
- API endpoints with request/response format
- Frontend UI description
- Testing steps

Start directly with the implementation instructions — no preamble.`;
        }

        const messages = [
            { role: 'system', content: systemMsg },
            { role: 'user', content: userMsg }
        ];

        const result = await aiEngine.generateWithFailover(messages, {
            maxTokens: '4096',
            temperature: '0.4'
        });

        res.json({ success: true, prompt: result.text, model: result.model, tokens: result.tokensUsed });

    } catch (e) {
        console.error('[AI GeneratePrompt] Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

module.exports = { router, setPool, setIO, setCollector };
