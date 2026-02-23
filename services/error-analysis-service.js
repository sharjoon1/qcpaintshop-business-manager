/**
 * Error Analysis Service
 * Stack trace parsing, error deduplication, trend analysis, AI fix suggestions
 */

const crypto = require('crypto');

let pool = null;
let aiEngine = null;

function setPool(p) { pool = p; }
function setAiEngine(engine) { aiEngine = engine; }

// ─── Stack Trace Parsing ─────────────────────────────────────

function parseStackTrace(stack) {
    if (!stack) return { file_path: null, line_number: null, function_name: null };

    const lines = stack.split('\n');
    // Skip the first line (error message), find first meaningful frame
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        // Match patterns like "at functionName (/path/to/file.js:123:45)"
        // or "at /path/to/file.js:123:45"
        const match = line.match(/at\s+(?:(.+?)\s+)?\(?(.+?):(\d+):\d+\)?/);
        if (match) {
            const funcName = match[1] || 'anonymous';
            const filePath = match[2];
            const lineNum = parseInt(match[3], 10);

            // Skip node_modules and internal node frames
            if (filePath.includes('node_modules') || filePath.startsWith('node:')) continue;

            // Normalize file path to relative
            const relPath = filePath.replace(/^.*?(routes|services|middleware|public)/, '$1');

            return {
                file_path: relPath.substring(0, 500),
                line_number: lineNum,
                function_name: funcName.substring(0, 200)
            };
        }
    }

    return { file_path: null, line_number: null, function_name: null };
}

// ─── Error Hashing for Deduplication ─────────────────────────

function computeErrorHash(errorMessage, errorType, requestUrl, filePath) {
    // Normalize the error message: remove dynamic values like IDs, timestamps
    let normalized = (errorMessage || '')
        .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\d]*Z?\b/g, '<TIMESTAMP>')
        .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<UUID>')
        .replace(/\bid\s*=\s*\d+/gi, 'id=<ID>')
        .replace(/\/\d+\//g, '/<ID>/')
        .replace(/\/\d+$/g, '/<ID>')
        .replace(/:\s*\d+/g, ': <NUM>')
        .substring(0, 500);

    const hashInput = `${errorType || ''}|${normalized}|${requestUrl || ''}|${filePath || ''}`;
    return crypto.createHash('sha256').update(hashInput).digest('hex').substring(0, 64);
}

// ─── Deduplicate Error (check existing, increment or insert) ──

async function deduplicateError(errorData) {
    if (!pool) return null;

    const { error_hash } = errorData;
    if (!error_hash) return null;

    try {
        // Check for existing error with same hash in the dedup window
        const [existing] = await pool.query(`
            SELECT id, frequency_count FROM error_logs
            WHERE error_hash = ? AND status != 'resolved'
            AND created_at >= NOW() - INTERVAL 24 HOUR
            ORDER BY created_at DESC LIMIT 1
        `, [error_hash]);

        if (existing.length > 0) {
            // Increment frequency count and update last_occurrence
            await pool.query(`
                UPDATE error_logs
                SET frequency_count = frequency_count + 1,
                    last_occurrence = NOW(),
                    severity = CASE
                        WHEN frequency_count + 1 >= 50 THEN 'critical'
                        WHEN frequency_count + 1 >= 20 THEN 'high'
                        ELSE severity
                    END
                WHERE id = ?
            `, [existing[0].id]);

            return { deduplicated: true, existingId: existing[0].id, newCount: existing[0].frequency_count + 1 };
        }

        return { deduplicated: false };
    } catch (err) {
        console.error('[ErrorAnalysis] Dedup check failed:', err.message);
        return { deduplicated: false };
    }
}

// ─── Error Trend Analysis ────────────────────────────────────

async function analyzeErrorTrends(options = {}) {
    if (!pool) return { trends: [], insights: [] };

    const { days = 7, module: moduleFilter } = options;
    const trends = [];
    const insights = [];

    try {
        // Daily error counts
        const [dailyCounts] = await pool.query(`
            SELECT DATE(created_at) as day, COUNT(*) as count,
                   SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical,
                   SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) as high
            FROM error_logs
            WHERE created_at >= NOW() - INTERVAL ? DAY
            ${moduleFilter ? 'AND request_url LIKE ?' : ''}
            GROUP BY day ORDER BY day
        `, moduleFilter ? [days, `%/${moduleFilter}%`] : [days]);

        trends.push({ type: 'daily_errors', data: dailyCounts });

        // Check for increasing trend
        if (dailyCounts.length >= 3) {
            const recent = dailyCounts.slice(-3);
            const increasing = recent[2]?.count > recent[1]?.count && recent[1]?.count > recent[0]?.count;
            if (increasing) {
                insights.push({
                    type: 'increasing_trend',
                    severity: 'warning',
                    message: `Error count is increasing: ${recent.map(d => d.count).join(' → ')} over the last 3 days`
                });
            }
        }

        // Most frequent errors (by hash)
        const [frequentErrors] = await pool.query(`
            SELECT error_hash, error_type, error_message, severity,
                   SUM(frequency_count) as total_occurrences,
                   COUNT(*) as unique_entries,
                   MAX(last_occurrence) as last_seen,
                   file_path, line_number, function_name
            FROM error_logs
            WHERE created_at >= NOW() - INTERVAL ? DAY
                AND error_hash IS NOT NULL
            GROUP BY error_hash
            ORDER BY total_occurrences DESC
            LIMIT 20
        `, [days]);

        trends.push({ type: 'frequent_errors', data: frequentErrors });

        // Errors by module (extracted from request_url)
        const [byModule] = await pool.query(`
            SELECT
                CASE
                    WHEN request_url LIKE '%/api/leads%' THEN 'leads'
                    WHEN request_url LIKE '%/api/attendance%' THEN 'attendance'
                    WHEN request_url LIKE '%/api/zoho%' THEN 'zoho'
                    WHEN request_url LIKE '%/api/painters%' THEN 'painters'
                    WHEN request_url LIKE '%/api/ai%' THEN 'ai'
                    WHEN request_url LIKE '%/api/chat%' THEN 'chat'
                    WHEN request_url LIKE '%/api/system%' THEN 'system'
                    WHEN request_url LIKE '%/api/auth%' THEN 'auth'
                    WHEN request_url LIKE '%/api/notifications%' THEN 'notifications'
                    WHEN request_url LIKE '%/api/wa-%' THEN 'whatsapp'
                    WHEN request_url LIKE '%/api/whatsapp%' THEN 'whatsapp'
                    WHEN error_type = 'frontend' THEN 'frontend'
                    ELSE 'other'
                END as module,
                COUNT(*) as count,
                SUM(CASE WHEN severity IN ('critical', 'high') THEN 1 ELSE 0 END) as severe_count
            FROM error_logs
            WHERE created_at >= NOW() - INTERVAL ? DAY
            GROUP BY module
            ORDER BY count DESC
        `, [days]);

        trends.push({ type: 'by_module', data: byModule });

        // New vs recurring
        const [newVsRecurring] = await pool.query(`
            SELECT
                SUM(CASE WHEN frequency_count = 1 THEN 1 ELSE 0 END) as new_errors,
                SUM(CASE WHEN frequency_count > 1 THEN 1 ELSE 0 END) as recurring_errors,
                SUM(CASE WHEN frequency_count > 10 THEN 1 ELSE 0 END) as chronic_errors
            FROM error_logs
            WHERE created_at >= NOW() - INTERVAL ? DAY
        `, [days]);

        trends.push({ type: 'new_vs_recurring', data: newVsRecurring[0] });

        if (newVsRecurring[0]?.chronic_errors > 0) {
            insights.push({
                type: 'chronic_errors',
                severity: 'high',
                message: `${newVsRecurring[0].chronic_errors} chronic errors (10+ occurrences) detected. These should be prioritized for fixing.`
            });
        }

        // Resolution metrics
        const [resolution] = await pool.query(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved,
                SUM(CASE WHEN status = 'ignored' THEN 1 ELSE 0 END) as ignored,
                SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as open_new,
                AVG(CASE WHEN resolved_at IS NOT NULL THEN TIMESTAMPDIFF(HOUR, created_at, resolved_at) END) as avg_resolution_hours
            FROM error_logs
            WHERE created_at >= NOW() - INTERVAL ? DAY
        `, [days]);

        trends.push({ type: 'resolution_metrics', data: resolution[0] });

    } catch (err) {
        console.error('[ErrorAnalysis] Trend analysis failed:', err.message);
    }

    return { trends, insights };
}

// ─── Module-Based Analysis ───────────────────────────────────

async function analyzeByModule(moduleName) {
    if (!pool) return null;

    try {
        const urlPattern = `%/api/${moduleName}%`;

        const [errors] = await pool.query(`
            SELECT id, error_type, error_message, severity, frequency_count,
                   request_url, request_method, file_path, line_number,
                   function_name, created_at, last_occurrence, status
            FROM error_logs
            WHERE request_url LIKE ? AND created_at >= NOW() - INTERVAL 7 DAY
            ORDER BY frequency_count DESC, created_at DESC
            LIMIT 50
        `, [urlPattern]);

        // Group by endpoint
        const byEndpoint = {};
        for (const err of errors) {
            const key = `${err.request_method} ${err.request_url}`;
            if (!byEndpoint[key]) byEndpoint[key] = { method: err.request_method, url: err.request_url, errors: [], totalCount: 0 };
            byEndpoint[key].errors.push(err);
            byEndpoint[key].totalCount += err.frequency_count || 1;
        }

        // Summary
        const [summary] = await pool.query(`
            SELECT
                COUNT(*) as total_errors,
                SUM(frequency_count) as total_occurrences,
                SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical,
                SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) as high,
                COUNT(DISTINCT error_hash) as unique_errors
            FROM error_logs
            WHERE request_url LIKE ? AND created_at >= NOW() - INTERVAL 7 DAY
        `, [urlPattern]);

        return {
            module: moduleName,
            summary: summary[0],
            endpoints: Object.values(byEndpoint).sort((a, b) => b.totalCount - a.totalCount),
            errors
        };
    } catch (err) {
        console.error('[ErrorAnalysis] Module analysis failed:', err.message);
        return null;
    }
}

// ─── AI-Powered Fix Suggestions ──────────────────────────────

async function generateFixSuggestion(errorId) {
    if (!pool || !aiEngine) return null;

    try {
        const [errors] = await pool.query(`
            SELECT * FROM error_logs WHERE id = ?
        `, [errorId]);

        if (errors.length === 0) return null;
        const error = errors[0];

        // Check for existing suggestions
        const [existing] = await pool.query(`
            SELECT id FROM fix_suggestions WHERE error_id = ? AND ai_generated = 1
        `, [errorId]);

        if (existing.length > 0) {
            // Return existing
            const [suggestions] = await pool.query('SELECT * FROM fix_suggestions WHERE error_id = ? ORDER BY confidence DESC', [errorId]);
            return suggestions;
        }

        // Build AI prompt
        const prompt = `Analyze this application error and provide fix suggestions.

Error Type: ${error.error_type}
Error Message: ${error.error_message}
File: ${error.file_path || 'unknown'}
Line: ${error.line_number || 'unknown'}
Function: ${error.function_name || 'unknown'}
Request: ${error.request_method || ''} ${error.request_url || ''}
Frequency: ${error.frequency_count} occurrences
Severity: ${error.severity}
Stack Trace: ${(error.stack_trace || '').substring(0, 1500)}

This is a Node.js/Express application (QC Paint Shop Business Manager) using MySQL, Socket.io, and various integrations (Zoho, WhatsApp).

Respond with valid JSON only:
{
  "suggestions": [
    {
      "type": "code_fix|config_change|data_fix|infrastructure|monitoring",
      "title": "Short title",
      "description": "What's wrong and why",
      "suggested_fix": "Specific fix instructions or code changes",
      "file_path": "Likely file to fix (if known)",
      "confidence": 0-100,
      "complexity": "trivial|simple|moderate|complex"
    }
  ]
}`;

        const result = await aiEngine.generateWithFailover(
            [{ role: 'user', content: prompt }],
            { maxTokens: 2048, temperature: 0.3 }
        );

        // Parse AI response
        let suggestions = [];
        try {
            const text = result.text || result.content || '';
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                suggestions = parsed.suggestions || [];
            }
        } catch (parseErr) {
            console.error('[ErrorAnalysis] Failed to parse AI fix suggestions:', parseErr.message);
            return null;
        }

        // Save suggestions to DB
        for (const s of suggestions) {
            await pool.query(`
                INSERT INTO fix_suggestions (error_id, error_hash, suggestion_type, title, description,
                    suggested_fix, file_path, confidence, complexity, ai_generated)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            `, [
                errorId,
                error.error_hash || null,
                s.type || 'code_fix',
                (s.title || 'Fix suggestion').substring(0, 500),
                s.description || null,
                s.suggested_fix || null,
                s.file_path || error.file_path || null,
                Math.min(100, Math.max(0, s.confidence || 50)),
                s.complexity || 'moderate'
            ]);
        }

        // Return saved suggestions
        const [saved] = await pool.query('SELECT * FROM fix_suggestions WHERE error_id = ? ORDER BY confidence DESC', [errorId]);
        return saved;
    } catch (err) {
        console.error('[ErrorAnalysis] Fix suggestion generation failed:', err.message);
        return null;
    }
}

// ─── Generate Fix for Bug Report ─────────────────────────────

async function generateBugFix(bugReportId) {
    if (!pool || !aiEngine) return null;

    try {
        const [bugs] = await pool.query('SELECT * FROM bug_reports WHERE id = ?', [bugReportId]);
        if (bugs.length === 0) return null;
        const bug = bugs[0];

        // Get related error if linked
        let errorContext = '';
        if (bug.related_error_id) {
            const [errors] = await pool.query('SELECT * FROM error_logs WHERE id = ?', [bug.related_error_id]);
            if (errors.length > 0) {
                const e = errors[0];
                errorContext = `\nRelated Error:
Type: ${e.error_type}, Message: ${e.error_message}
File: ${e.file_path || 'unknown'}, Line: ${e.line_number || 'unknown'}
Stack: ${(e.stack_trace || '').substring(0, 1000)}`;
            }
        }

        const prompt = `Analyze this bug report and provide fix suggestions.

Bug Title: ${bug.title}
Description: ${bug.description || 'N/A'}
Steps to Reproduce: ${bug.steps_to_reproduce || 'N/A'}
Expected: ${bug.expected_behavior || 'N/A'}
Actual: ${bug.actual_behavior || 'N/A'}
Module: ${bug.module || 'unknown'}
Priority: ${bug.priority}
${errorContext}

This is a Node.js/Express app with MySQL, vanilla HTML/JS frontend, Tailwind CSS.

Respond with valid JSON only:
{
  "suggestions": [
    {
      "type": "code_fix|config_change|data_fix|infrastructure|monitoring",
      "title": "Short title",
      "description": "Root cause analysis",
      "suggested_fix": "Specific fix instructions",
      "file_path": "File to modify",
      "confidence": 0-100,
      "complexity": "trivial|simple|moderate|complex"
    }
  ]
}`;

        const result = await aiEngine.generateWithFailover(
            [{ role: 'user', content: prompt }],
            { maxTokens: 2048, temperature: 0.3 }
        );

        let suggestions = [];
        try {
            const text = result.text || result.content || '';
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                suggestions = parsed.suggestions || [];
            }
        } catch (parseErr) {
            return null;
        }

        for (const s of suggestions) {
            await pool.query(`
                INSERT INTO fix_suggestions (bug_report_id, error_hash, suggestion_type, title, description,
                    suggested_fix, file_path, confidence, complexity, ai_generated)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            `, [
                bugReportId,
                bug.error_hash || null,
                s.type || 'code_fix',
                (s.title || 'Fix suggestion').substring(0, 500),
                s.description || null,
                s.suggested_fix || null,
                s.file_path || null,
                Math.min(100, Math.max(0, s.confidence || 50)),
                s.complexity || 'moderate'
            ]);
        }

        const [saved] = await pool.query('SELECT * FROM fix_suggestions WHERE bug_report_id = ? ORDER BY confidence DESC', [bugReportId]);
        return saved;
    } catch (err) {
        console.error('[ErrorAnalysis] Bug fix generation failed:', err.message);
        return null;
    }
}

// ─── Error Summary (for dashboard) ──────────────────────────

async function getErrorSummary() {
    if (!pool) return null;

    try {
        const [summary24h] = await pool.query(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical,
                SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) as high,
                SUM(CASE WHEN severity = 'medium' THEN 1 ELSE 0 END) as medium,
                SUM(CASE WHEN severity = 'low' THEN 1 ELSE 0 END) as low,
                SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as unresolved,
                COUNT(DISTINCT error_hash) as unique_errors
            FROM error_logs
            WHERE created_at >= NOW() - INTERVAL 24 HOUR
        `);

        const [bugSummary] = await pool.query(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_bugs,
                SUM(CASE WHEN status = 'investigating' THEN 1 ELSE 0 END) as investigating,
                SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
                SUM(CASE WHEN status = 'fixed' THEN 1 ELSE 0 END) as fixed,
                SUM(CASE WHEN priority = 'critical' THEN 1 ELSE 0 END) as critical_bugs
            FROM bug_reports
        `);

        const [fixSummary] = await pool.query(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'applied' THEN 1 ELSE 0 END) as applied,
                SUM(CASE WHEN ai_generated = 1 THEN 1 ELSE 0 END) as ai_generated,
                AVG(confidence) as avg_confidence
            FROM fix_suggestions
        `);

        return {
            errors: summary24h[0],
            bugs: bugSummary[0],
            fixes: fixSummary[0]
        };
    } catch (err) {
        console.error('[ErrorAnalysis] Summary failed:', err.message);
        return null;
    }
}

// ─── Auto-Create Bug Report from Chronic Error ───────────────

async function autoCreateBugFromError(errorId) {
    if (!pool) return null;

    try {
        const [errors] = await pool.query('SELECT * FROM error_logs WHERE id = ?', [errorId]);
        if (errors.length === 0) return null;
        const error = errors[0];

        // Check if bug already exists for this error hash
        if (error.error_hash) {
            const [existing] = await pool.query('SELECT id FROM bug_reports WHERE error_hash = ?', [error.error_hash]);
            if (existing.length > 0) return existing[0].id;
        }

        // Determine module from request URL
        let module = 'unknown';
        const url = error.request_url || '';
        const moduleMatch = url.match(/\/api\/([^\/]+)/);
        if (moduleMatch) module = moduleMatch[1];
        if (error.error_type === 'frontend') module = 'frontend';

        const [result] = await pool.query(`
            INSERT INTO bug_reports (title, description, module, priority, status,
                related_error_id, error_hash, environment)
            VALUES (?, ?, ?, ?, 'open', ?, ?, 'production')
        `, [
            `[Auto] ${error.error_type}: ${(error.error_message || '').substring(0, 200)}`,
            `Automatically created from error #${errorId} with ${error.frequency_count} occurrences.\n\nError: ${error.error_message}\nFile: ${error.file_path || 'unknown'}:${error.line_number || '?'}\nFunction: ${error.function_name || 'unknown'}\nEndpoint: ${error.request_method || ''} ${error.request_url || ''}`,
            module,
            error.severity === 'critical' ? 'critical' : error.severity === 'high' ? 'high' : 'medium',
            errorId,
            error.error_hash || null
        ]);

        return result.insertId;
    } catch (err) {
        console.error('[ErrorAnalysis] Auto bug creation failed:', err.message);
        return null;
    }
}

module.exports = {
    setPool,
    setAiEngine,
    parseStackTrace,
    computeErrorHash,
    deduplicateError,
    analyzeErrorTrends,
    analyzeByModule,
    generateFixSuggestion,
    generateBugFix,
    getErrorSummary,
    autoCreateBugFromError
};
