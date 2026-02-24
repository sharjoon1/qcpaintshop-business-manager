/**
 * AI Marketing Strategy Analyzer
 * Aggregates sales data by product, brand, customer segment
 * Generates weekly marketing tips and recommendations
 */

const aiEngine = require('./ai-engine');

let pool = null;
function setPool(p) { pool = p; }

// ─── Data Collection ───────────────────────────────────────────

async function collectMarketingData() {
    const data = {};

    // Sales by brand (last 30 days vs previous 30 days)
    try {
        const [brandSales] = await pool.query(`
            SELECT
                COALESCE(im.zoho_brand, 'Unknown') as brand,
                COUNT(DISTINCT CASE WHEN zi.invoice_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN zi.zoho_invoice_id END) as current_invoices,
                COALESCE(SUM(CASE WHEN zi.invoice_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN zil.line_total END), 0) as current_revenue,
                COUNT(DISTINCT CASE WHEN zi.invoice_date BETWEEN DATE_SUB(CURDATE(), INTERVAL 60 DAY) AND DATE_SUB(CURDATE(), INTERVAL 31 DAY) THEN zi.zoho_invoice_id END) as prev_invoices,
                COALESCE(SUM(CASE WHEN zi.invoice_date BETWEEN DATE_SUB(CURDATE(), INTERVAL 60 DAY) AND DATE_SUB(CURDATE(), INTERVAL 31 DAY) THEN zil.line_total END), 0) as prev_revenue
            FROM zoho_invoice_line_items zil
            JOIN zoho_invoices zi ON zil.invoice_id = zi.id
            LEFT JOIN zoho_items_map im ON zil.item_id = im.zoho_item_id COLLATE utf8mb4_unicode_ci
            WHERE zi.invoice_date >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)
            GROUP BY im.zoho_brand
            ORDER BY current_revenue DESC
            LIMIT 20
        `);
        data.brand_sales = brandSales;
    } catch (e) {
        data.brand_sales = [];
    }

    // Sales by category (last 30 days)
    try {
        const [categorySales] = await pool.query(`
            SELECT
                COALESCE(im.zoho_category_name, 'Unknown') as category,
                COUNT(DISTINCT zi.zoho_invoice_id) as invoice_count,
                COALESCE(SUM(zil.line_total), 0) as revenue,
                COALESCE(SUM(zil.quantity), 0) as quantity_sold
            FROM zoho_invoice_line_items zil
            JOIN zoho_invoices zi ON zil.invoice_id = zi.id
            LEFT JOIN zoho_items_map im ON zil.item_id = im.zoho_item_id COLLATE utf8mb4_unicode_ci
            WHERE zi.invoice_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            GROUP BY im.zoho_category_name
            ORDER BY revenue DESC
            LIMIT 15
        `);
        data.category_sales = categorySales;
    } catch (e) {
        data.category_sales = [];
    }

    // Top selling items (last 30 days)
    try {
        const [topItems] = await pool.query(`
            SELECT
                zil.item_name,
                COALESCE(SUM(zil.quantity), 0) as quantity_sold,
                COALESCE(SUM(zil.line_total), 0) as revenue
            FROM zoho_invoice_line_items zil
            JOIN zoho_invoices zi ON zil.invoice_id = zi.id
            WHERE zi.invoice_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            GROUP BY zil.item_name
            ORDER BY revenue DESC
            LIMIT 15
        `);
        data.top_items = topItems;
    } catch (e) {
        data.top_items = [];
    }

    // Customer segments (by purchase frequency)
    try {
        const [segments] = await pool.query(`
            SELECT
                CASE
                    WHEN invoice_count >= 10 THEN 'VIP (10+ orders)'
                    WHEN invoice_count >= 5 THEN 'Regular (5-9 orders)'
                    WHEN invoice_count >= 2 THEN 'Returning (2-4 orders)'
                    ELSE 'One-time'
                END as segment,
                COUNT(*) as customer_count,
                COALESCE(SUM(total_revenue), 0) as total_revenue
            FROM (
                SELECT customer_name, COUNT(*) as invoice_count, SUM(total) as total_revenue
                FROM zoho_invoices
                WHERE invoice_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
                GROUP BY customer_name
            ) sub
            GROUP BY segment
            ORDER BY total_revenue DESC
        `);
        data.customer_segments = segments;
    } catch (e) {
        data.customer_segments = [];
    }

    // Low-moving stock (items with stock but no recent sales)
    try {
        const [slowMoving] = await pool.query(`
            SELECT im.zoho_item_name as item_name, im.zoho_stock_on_hand as stock, im.zoho_brand as brand
            FROM zoho_items_map im
            LEFT JOIN zoho_invoice_line_items zil ON im.zoho_item_id = zil.item_id COLLATE utf8mb4_unicode_ci
                AND zil.id IN (SELECT zil2.id FROM zoho_invoice_line_items zil2
                              JOIN zoho_invoices zi2 ON zil2.invoice_id = zi2.id
                              WHERE zi2.invoice_date >= DATE_SUB(CURDATE(), INTERVAL 60 DAY))
            WHERE im.zoho_stock_on_hand > 0 AND im.zoho_status = 'active'
                AND zil.id IS NULL
            ORDER BY im.zoho_stock_on_hand DESC
            LIMIT 20
        `);
        data.slow_moving = slowMoving;
    } catch (e) {
        data.slow_moving = [];
    }

    // Monthly revenue trend (last 6 months)
    try {
        const [monthlyTrend] = await pool.query(`
            SELECT
                DATE_FORMAT(invoice_date, '%Y-%m') as month,
                COALESCE(SUM(total), 0) as revenue,
                COUNT(*) as invoice_count
            FROM zoho_invoices
            WHERE invoice_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
            GROUP BY DATE_FORMAT(invoice_date, '%Y-%m')
            ORDER BY month
        `);
        data.monthly_trend = monthlyTrend;
    } catch (e) {
        data.monthly_trend = [];
    }

    return data;
}

// ─── Analysis Runner ───────────────────────────────────────────

async function runMarketingAnalysis() {
    const startTime = Date.now();

    const [runResult] = await pool.query(
        'INSERT INTO ai_analysis_runs (analysis_type, status) VALUES (?, ?)',
        ['marketing_tips', 'running']
    );
    const runId = runResult.insertId;

    try {
        const data = await collectMarketingData();
        const prompt = buildMarketingPrompt(data);

        const messages = [
            { role: 'system', content: aiEngine.getSystemPrompt(`You are a marketing strategist for a paint retail company in India.
Consider Indian paint market seasonality:
- Peak: Oct-Mar (festival season, winter construction)
- Moderate: Jul-Sep (post-monsoon, Onam/Diwali prep)
- Low: Apr-Jun (summer heat reduces painting activity)
Output as valid JSON with the structure specified.`) },
            { role: 'user', content: prompt }
        ];

        const result = await aiEngine.generateWithFailover(messages);

        let insights = [];
        let summary = result.text;
        try {
            const jsonMatch = result.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                summary = parsed.summary || result.text.substring(0, 500);
                insights = parsed.insights || [];
            }
        } catch (e) {
            summary = result.text.substring(0, 1000);
        }

        for (const insight of insights) {
            await pool.query(
                `INSERT INTO ai_insights (analysis_run_id, category, severity, title, description, action_recommended)
                 VALUES (?, 'marketing', ?, ?, ?, ?)`,
                [runId, insight.severity || 'info', insight.title, insight.description, insight.action_recommended]
            );
        }

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

function buildMarketingPrompt(data) {
    const lines = [];
    const now = new Date();
    const monthName = now.toLocaleString('en-IN', { month: 'long', timeZone: 'Asia/Kolkata' });

    lines.push(`## Weekly Marketing Analysis — ${monthName} ${now.getFullYear()}`);
    lines.push('');

    // Brand sales with trend
    if (data.brand_sales.length) {
        lines.push('### Brand Performance (Current vs Previous 30 Days)');
        data.brand_sales.forEach(b => {
            const change = b.prev_revenue > 0 ? ((b.current_revenue - b.prev_revenue) / b.prev_revenue * 100).toFixed(1) : 'N/A';
            lines.push(`- ${b.brand}: ₹${Number(b.current_revenue).toLocaleString('en-IN')} (${change}% change)`);
        });
        lines.push('');
    }

    // Category sales
    if (data.category_sales.length) {
        lines.push('### Category Sales (Last 30 Days)');
        data.category_sales.forEach(c => {
            lines.push(`- ${c.category}: ₹${Number(c.revenue).toLocaleString('en-IN')} (${c.quantity_sold} units, ${c.invoice_count} invoices)`);
        });
        lines.push('');
    }

    // Top items
    if (data.top_items.length) {
        lines.push('### Top Selling Products');
        data.top_items.forEach((item, i) => {
            lines.push(`${i + 1}. ${item.item_name}: ${item.quantity_sold} sold, ₹${Number(item.revenue).toLocaleString('en-IN')}`);
        });
        lines.push('');
    }

    // Customer segments
    if (data.customer_segments.length) {
        lines.push('### Customer Segments (Last 90 Days)');
        data.customer_segments.forEach(s => {
            lines.push(`- ${s.segment}: ${s.customer_count} customers, ₹${Number(s.total_revenue).toLocaleString('en-IN')}`);
        });
        lines.push('');
    }

    // Slow-moving stock
    if (data.slow_moving.length) {
        lines.push(`### Slow-Moving Stock (${data.slow_moving.length} items, no sales in 60 days)`);
        data.slow_moving.slice(0, 10).forEach(s => {
            lines.push(`- ${s.item_name} (${s.brand || 'Unknown'}): ${s.stock} units in stock`);
        });
        lines.push('');
    }

    // Monthly trend
    if (data.monthly_trend.length) {
        lines.push('### Monthly Revenue Trend');
        data.monthly_trend.forEach(m => {
            lines.push(`- ${m.month}: ₹${Number(m.revenue).toLocaleString('en-IN')} (${m.invoice_count} invoices)`);
        });
        lines.push('');
    }

    lines.push(`Provide 3-5 actionable marketing tips as JSON:
{
  "summary": "Brief marketing overview",
  "insights": [
    {
      "severity": "info|warning",
      "title": "Short actionable title",
      "description": "Detailed marketing insight",
      "action_recommended": "Specific action to take"
    }
  ]
}`);

    return lines.join('\n');
}

module.exports = {
    setPool,
    collectMarketingData,
    runMarketingAnalysis
};
