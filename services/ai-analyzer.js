/**
 * AI Zoho Business Analyzer
 * Collects revenue, collections, overdue, stock data from DB
 * Sends to AI for analysis, stores structured insights
 */

const aiEngine = require('./ai-engine');

let pool = null;
function setPool(p) { pool = p; }

// ─── Data Collection ───────────────────────────────────────────

async function collectZohoData(period = 'daily') {
    const data = {};

    // Revenue - today, yesterday, this week, this month
    const [todayRev] = await pool.query(`
        SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as count
        FROM zoho_invoices WHERE DATE(invoice_date) = CURDATE()
    `);
    const [yesterdayRev] = await pool.query(`
        SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as count
        FROM zoho_invoices WHERE DATE(invoice_date) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)
    `);
    const [weekRev] = await pool.query(`
        SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as count
        FROM zoho_invoices WHERE YEARWEEK(invoice_date, 1) = YEARWEEK(CURDATE(), 1)
    `);
    const [monthRev] = await pool.query(`
        SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as count
        FROM zoho_invoices WHERE YEAR(invoice_date) = YEAR(CURDATE()) AND MONTH(invoice_date) = MONTH(CURDATE())
    `);

    data.revenue = {
        today: { total: todayRev[0].total, count: todayRev[0].count },
        yesterday: { total: yesterdayRev[0].total, count: yesterdayRev[0].count },
        this_week: { total: weekRev[0].total, count: weekRev[0].count },
        this_month: { total: monthRev[0].total, count: monthRev[0].count }
    };

    // Collections (payments)
    const [todayCol] = await pool.query(`
        SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
        FROM zoho_payments WHERE DATE(payment_date) = CURDATE()
    `);
    const [yesterdayCol] = await pool.query(`
        SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
        FROM zoho_payments WHERE DATE(payment_date) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)
    `);
    const [monthCol] = await pool.query(`
        SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
        FROM zoho_payments WHERE YEAR(payment_date) = YEAR(CURDATE()) AND MONTH(payment_date) = MONTH(CURDATE())
    `);

    data.collections = {
        today: { total: todayCol[0].total, count: todayCol[0].count },
        yesterday: { total: yesterdayCol[0].total, count: yesterdayCol[0].count },
        this_month: { total: monthCol[0].total, count: monthCol[0].count }
    };

    // Overdue invoices by age bracket
    const [overdue] = await pool.query(`
        SELECT
            COUNT(CASE WHEN DATEDIFF(CURDATE(), due_date) BETWEEN 1 AND 30 THEN 1 END) as overdue_1_30,
            COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), due_date) BETWEEN 1 AND 30 THEN balance END), 0) as amount_1_30,
            COUNT(CASE WHEN DATEDIFF(CURDATE(), due_date) BETWEEN 31 AND 60 THEN 1 END) as overdue_31_60,
            COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), due_date) BETWEEN 31 AND 60 THEN balance END), 0) as amount_31_60,
            COUNT(CASE WHEN DATEDIFF(CURDATE(), due_date) BETWEEN 61 AND 90 THEN 1 END) as overdue_61_90,
            COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), due_date) BETWEEN 61 AND 90 THEN balance END), 0) as amount_61_90,
            COUNT(CASE WHEN DATEDIFF(CURDATE(), due_date) > 90 THEN 1 END) as overdue_90_plus,
            COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), due_date) > 90 THEN balance END), 0) as amount_90_plus,
            COUNT(*) as total_count,
            COALESCE(SUM(balance), 0) as total_amount
        FROM zoho_invoices
        WHERE status = 'overdue' AND balance > 0
    `);

    data.overdue = overdue[0];

    // Top 10 debtors
    const [debtors] = await pool.query(`
        SELECT customer_name, COUNT(*) as invoice_count, SUM(balance) as total_owed
        FROM zoho_invoices
        WHERE status = 'overdue' AND balance > 0
        GROUP BY customer_name
        ORDER BY total_owed DESC
        LIMIT 10
    `);

    data.top_debtors = debtors;

    // Branch performance (revenue + collections)
    try {
        const [branchRev] = await pool.query(`
            SELECT
                COALESCE(wl.branch_name, 'Unknown') as branch_name,
                COUNT(*) as invoice_count,
                COALESCE(SUM(zi.total), 0) as revenue
            FROM zoho_invoices zi
            LEFT JOIN zoho_locations_map wl ON zi.location_id = wl.zoho_location_id COLLATE utf8mb4_unicode_ci
            WHERE DATE(zi.invoice_date) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            GROUP BY wl.branch_name
            ORDER BY revenue DESC
        `);
        data.branch_performance = branchRev;
    } catch (e) {
        data.branch_performance = [];
    }

    // Stock alerts (items at or below reorder level)
    const [stockAlerts] = await pool.query(`
        SELECT item_name, zoho_stock_on_hand as stock, zoho_reorder_level as reorder_level
        FROM zoho_items_map
        WHERE zoho_stock_on_hand <= zoho_reorder_level AND zoho_reorder_level > 0 AND zoho_status = 'active'
        ORDER BY (zoho_stock_on_hand / GREATEST(zoho_reorder_level, 1)) ASC
        LIMIT 20
    `);

    data.stock_alerts = stockAlerts;

    // Weekly trends (for weekly analysis)
    if (period === 'weekly') {
        const [weeklyTrend] = await pool.query(`
            SELECT
                DATE(invoice_date) as date,
                COALESCE(SUM(total), 0) as revenue,
                COUNT(*) as invoice_count
            FROM zoho_invoices
            WHERE invoice_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            GROUP BY DATE(invoice_date)
            ORDER BY date
        `);
        data.weekly_revenue_trend = weeklyTrend;

        const [weeklyCol] = await pool.query(`
            SELECT
                DATE(payment_date) as date,
                COALESCE(SUM(amount), 0) as collected
            FROM zoho_payments
            WHERE payment_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            GROUP BY DATE(payment_date)
            ORDER BY date
        `);
        data.weekly_collection_trend = weeklyCol;
    }

    return data;
}

// ─── Analysis Runner ───────────────────────────────────────────

async function runZohoAnalysis(period = 'daily') {
    const startTime = Date.now();
    const analysisType = period === 'weekly' ? 'zoho_weekly' : 'zoho_daily';

    // Create run record
    const [runResult] = await pool.query(
        'INSERT INTO ai_analysis_runs (analysis_type, status) VALUES (?, ?)',
        [analysisType, 'running']
    );
    const runId = runResult.insertId;

    try {
        // Collect data
        const data = await collectZohoData(period);

        // Build prompt
        const prompt = buildZohoPrompt(data, period);

        // Generate analysis
        const messages = [
            { role: 'system', content: aiEngine.getSystemPrompt('You are analyzing Zoho Books financial data. Output your analysis as valid JSON with the structure specified.') },
            { role: 'user', content: prompt }
        ];

        const result = await aiEngine.generateWithFailover(messages);

        // Parse insights from response
        let insights = [];
        let summary = result.text;
        try {
            // Try to extract JSON from the response
            const jsonMatch = result.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                summary = parsed.summary || result.text.substring(0, 500);
                insights = parsed.insights || [];
            }
        } catch (e) {
            // If JSON parse fails, use the raw text as summary
            summary = result.text.substring(0, 1000);
        }

        // Store insights
        for (const insight of insights) {
            await pool.query(
                `INSERT INTO ai_insights (analysis_run_id, category, severity, title, description, action_recommended)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [runId, insight.category || 'general', insight.severity || 'info',
                 insight.title || 'Insight', insight.description || '', insight.action_recommended || '']
            );
        }

        // Update run record
        const durationMs = Date.now() - startTime;
        await pool.query(
            `UPDATE ai_analysis_runs SET status = 'completed', summary = ?, full_response = ?,
             data_snapshot = ?, model_provider = ?, tokens_used = ?, duration_ms = ? WHERE id = ?`,
            [summary, result.text, JSON.stringify(data), result.provider, result.tokensUsed, durationMs, runId]
        );

        return { runId, summary, insights, provider: result.provider, tokensUsed: result.tokensUsed, durationMs };

    } catch (error) {
        await pool.query(
            'UPDATE ai_analysis_runs SET status = ?, summary = ? WHERE id = ?',
            ['failed', error.message, runId]
        );
        throw error;
    }
}

function buildZohoPrompt(data, period) {
    const lines = [];
    lines.push(`## ${period === 'weekly' ? 'Weekly' : 'Daily'} Zoho Books Analysis`);
    lines.push(`Date: ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
    lines.push('');

    // Revenue
    lines.push('### Revenue');
    lines.push(`Today: ₹${Number(data.revenue.today.total).toLocaleString('en-IN')} (${data.revenue.today.count} invoices)`);
    lines.push(`Yesterday: ₹${Number(data.revenue.yesterday.total).toLocaleString('en-IN')} (${data.revenue.yesterday.count} invoices)`);
    lines.push(`This Week: ₹${Number(data.revenue.this_week.total).toLocaleString('en-IN')} (${data.revenue.this_week.count} invoices)`);
    lines.push(`This Month: ₹${Number(data.revenue.this_month.total).toLocaleString('en-IN')} (${data.revenue.this_month.count} invoices)`);
    lines.push('');

    // Collections
    lines.push('### Collections');
    lines.push(`Today: ₹${Number(data.collections.today.total).toLocaleString('en-IN')} (${data.collections.today.count} payments)`);
    lines.push(`Yesterday: ₹${Number(data.collections.yesterday.total).toLocaleString('en-IN')} (${data.collections.yesterday.count} payments)`);
    lines.push(`This Month: ₹${Number(data.collections.this_month.total).toLocaleString('en-IN')} (${data.collections.this_month.count} payments)`);
    lines.push('');

    // Overdue
    lines.push('### Overdue Invoices');
    lines.push(`Total: ${data.overdue.total_count} invoices, ₹${Number(data.overdue.total_amount).toLocaleString('en-IN')}`);
    lines.push(`1-30 days: ${data.overdue.overdue_1_30} invoices, ₹${Number(data.overdue.amount_1_30).toLocaleString('en-IN')}`);
    lines.push(`31-60 days: ${data.overdue.overdue_31_60} invoices, ₹${Number(data.overdue.amount_31_60).toLocaleString('en-IN')}`);
    lines.push(`61-90 days: ${data.overdue.overdue_61_90} invoices, ₹${Number(data.overdue.amount_61_90).toLocaleString('en-IN')}`);
    lines.push(`90+ days: ${data.overdue.overdue_90_plus} invoices, ₹${Number(data.overdue.amount_90_plus).toLocaleString('en-IN')}`);
    lines.push('');

    // Top debtors
    if (data.top_debtors.length) {
        lines.push('### Top 10 Debtors');
        data.top_debtors.forEach((d, i) => {
            lines.push(`${i + 1}. ${d.customer_name}: ₹${Number(d.total_owed).toLocaleString('en-IN')} (${d.invoice_count} invoices)`);
        });
        lines.push('');
    }

    // Branch performance
    if (data.branch_performance.length) {
        lines.push('### Branch Performance (Last 30 Days)');
        data.branch_performance.forEach(b => {
            lines.push(`- ${b.branch_name}: ₹${Number(b.revenue).toLocaleString('en-IN')} (${b.invoice_count} invoices)`);
        });
        lines.push('');
    }

    // Stock alerts
    if (data.stock_alerts.length) {
        lines.push(`### Stock Alerts (${data.stock_alerts.length} items at/below reorder level)`);
        data.stock_alerts.slice(0, 10).forEach(s => {
            lines.push(`- ${s.item_name}: ${s.stock} in stock (reorder at ${s.reorder_level})`);
        });
        lines.push('');
    }

    // Weekly trends
    if (data.weekly_revenue_trend) {
        lines.push('### Weekly Revenue Trend');
        data.weekly_revenue_trend.forEach(d => {
            lines.push(`- ${d.date}: ₹${Number(d.revenue).toLocaleString('en-IN')} (${d.invoice_count} invoices)`);
        });
        lines.push('');
    }

    lines.push('Please analyze this data and provide insights as JSON with the format specified in the system prompt.');
    return lines.join('\n');
}

// ─── WhatsApp Summary ──────────────────────────────────────────

function buildWhatsAppSummary(result) {
    let msg = `📊 *Daily Business Summary*\n`;
    msg += `_${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}_\n\n`;
    msg += result.summary.substring(0, 1500);

    const criticals = result.insights.filter(i => i.severity === 'critical');
    if (criticals.length) {
        msg += '\n\n🚨 *Critical Alerts:*\n';
        criticals.forEach(c => {
            msg += `• ${c.title}\n`;
        });
    }

    return msg;
}

module.exports = {
    setPool,
    collectZohoData,
    runZohoAnalysis,
    buildWhatsAppSummary
};
