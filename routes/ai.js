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

let pool = null;
let io = null;

function setPool(p) { pool = p; }
function setIO(i) { io = i; }

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

        // Build context: load conversation history
        const [history] = await pool.query(
            'SELECT role, content FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC',
            [convId]
        );

        // Detect business intent and inject context
        const businessContext = await buildBusinessContext(message);

        const messages = [
            { role: 'system', content: aiEngine.getSystemPrompt(businessContext) },
            ...history.map(h => ({ role: h.role, content: h.content }))
        ];

        // Stream response
        const result = await aiEngine.streamWithFailover(messages, res, { provider });

        // Save assistant message
        await pool.query(
            'INSERT INTO ai_messages (conversation_id, role, content, tokens_used, model) VALUES (?, ?, ?, ?, ?)',
            [convId, 'assistant', result.text, result.tokensUsed, result.model]
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

// ─── Business Context Injection ────────────────────────────────

async function buildBusinessContext(message) {
    const lower = message.toLowerCase();
    const contextParts = [];

    try {
        // Revenue / sales queries
        if (lower.match(/revenue|sales|invoice|billing|turnover/)) {
            const [rev] = await pool.query(`
                SELECT
                    COALESCE(SUM(CASE WHEN DATE(invoice_date) = CURDATE() THEN total END), 0) as today,
                    COALESCE(SUM(CASE WHEN DATE(invoice_date) = DATE_SUB(CURDATE(), INTERVAL 1 DAY) THEN total END), 0) as yesterday,
                    COALESCE(SUM(CASE WHEN YEARWEEK(invoice_date, 1) = YEARWEEK(CURDATE(), 1) THEN total END), 0) as this_week,
                    COALESCE(SUM(CASE WHEN YEAR(invoice_date) = YEAR(CURDATE()) AND MONTH(invoice_date) = MONTH(CURDATE()) THEN total END), 0) as this_month,
                    COUNT(CASE WHEN DATE(invoice_date) = CURDATE() THEN 1 END) as today_count,
                    COUNT(CASE WHEN YEAR(invoice_date) = YEAR(CURDATE()) AND MONTH(invoice_date) = MONTH(CURDATE()) THEN 1 END) as month_count
                FROM zoho_invoices
            `);
            contextParts.push(`Current Revenue Data: Today ₹${rev[0].today} (${rev[0].today_count} invoices), Yesterday ₹${rev[0].yesterday}, This Week ₹${rev[0].this_week}, This Month ₹${rev[0].this_month} (${rev[0].month_count} invoices)`);
        }

        // Collections / payments
        if (lower.match(/collection|payment|received|paid/)) {
            const [col] = await pool.query(`
                SELECT
                    COALESCE(SUM(CASE WHEN DATE(payment_date) = CURDATE() THEN payment_amount END), 0) as today,
                    COALESCE(SUM(CASE WHEN YEAR(payment_date) = YEAR(CURDATE()) AND MONTH(payment_date) = MONTH(CURDATE()) THEN payment_amount END), 0) as this_month
                FROM zoho_payments
            `);
            contextParts.push(`Collections: Today ₹${col[0].today}, This Month ₹${col[0].this_month}`);
        }

        // Overdue
        if (lower.match(/overdue|outstanding|pending|due|debt/)) {
            const [od] = await pool.query(`
                SELECT COUNT(*) as count, COALESCE(SUM(balance), 0) as total
                FROM zoho_invoices WHERE status = 'overdue' AND balance > 0
            `);
            contextParts.push(`Overdue: ${od[0].count} invoices totaling ₹${od[0].total}`);
        }

        // Staff / attendance
        if (lower.match(/staff|attendance|employee|worker|present|absent|break|overtime/)) {
            const [att] = await pool.query(`
                SELECT
                    COUNT(*) as present,
                    (SELECT COUNT(*) FROM users WHERE role = 'staff' AND status = 'active') as total_staff,
                    COALESCE(AVG(total_working_minutes), 0) as avg_working,
                    COALESCE(SUM(overtime_minutes), 0) as total_ot
                FROM staff_attendance WHERE date = CURDATE()
            `);
            const absent = att[0].total_staff - att[0].present;
            contextParts.push(`Staff Today: ${att[0].present} present, ${absent} absent (of ${att[0].total_staff}), Avg work ${Math.round(att[0].avg_working)} min, Total OT ${att[0].total_ot} min`);
        }

        // Leads
        if (lower.match(/lead|prospect|pipeline|follow.?up/)) {
            const [leads] = await pool.query(`
                SELECT
                    COUNT(*) as total,
                    COUNT(CASE WHEN status = 'new' THEN 1 END) as new_leads,
                    COUNT(CASE WHEN status = 'interested' THEN 1 END) as interested,
                    COUNT(CASE WHEN status = 'quoted' THEN 1 END) as quoted,
                    COUNT(CASE WHEN DATEDIFF(CURDATE(), updated_at) > 7 THEN 1 END) as stale
                FROM leads WHERE status NOT IN ('won', 'lost', 'closed')
            `);
            contextParts.push(`Active Leads: ${leads[0].total} total (${leads[0].new_leads} new, ${leads[0].interested} interested, ${leads[0].quoted} quoted, ${leads[0].stale} stale 7+ days)`);
        }

        // Stock
        if (lower.match(/stock|inventory|product|item|reorder/)) {
            const [stock] = await pool.query(`
                SELECT
                    COUNT(*) as total_items,
                    COUNT(CASE WHEN zoho_stock_on_hand <= zoho_reorder_level AND zoho_reorder_level > 0 THEN 1 END) as below_reorder,
                    COUNT(CASE WHEN zoho_stock_on_hand = 0 THEN 1 END) as out_of_stock
                FROM zoho_items_map WHERE zoho_status = 'active'
            `);
            contextParts.push(`Stock: ${stock[0].total_items} items, ${stock[0].below_reorder} below reorder level, ${stock[0].out_of_stock} out of stock`);
        }
    } catch (e) {
        // Context injection failure is non-fatal
        console.error('[AI Chat] Context build error:', e.message);
    }

    if (contextParts.length) {
        return 'Current business data (auto-fetched from database):\n' + contextParts.join('\n');
    }
    return '';
}

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

module.exports = { router, setPool, setIO };
