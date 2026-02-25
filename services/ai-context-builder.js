/**
 * AI Context Builder — Comprehensive business context for chat
 * Two-tier system:
 *   Tier 1: Quick summary (always injected, ~50ms)
 *   Tier 2: Category-specific deep context (keyword-triggered)
 *
 * Also handles daily snapshot generation/caching.
 */

let pool = null;

function setPool(p) { pool = p; }

// ─── Keyword patterns for category detection ──────────────────

const CATEGORY_PATTERNS = {
    revenue:     /revenue|sales|invoice|billing|turnover|income|earning|business.*today|how.*doing|performance/i,
    collections: /collection|payment|received|paid|cash.*flow|recover|overdue|outstanding|due|debt|unpaid/i,
    staff:       /staff|attendance|employee|worker|present|absent|break|overtime|late|team|hr|manpower|who.*working/i,
    leads:       /lead|prospect|pipeline|follow.?up|customer.*new|inquiry|conversion|funnel/i,
    inventory:   /stock|inventory|product|item|reorder|warehouse|out.*stock|low.*stock|supply|brand/i,
    whatsapp:    /whatsapp|campaign|marketing|message|broadcast/i,
    insights:    /insight|analysis|alert|warning|suggestion|problem|issue/i,
    general:     /health.*check|overview|summary|everything|full.*report|how.*we.*doing|good\s*morning|brief\s*me/i
};

/**
 * Build chat context for a user message.
 * Returns { contextText, contextSummary, categories }
 */
async function buildChatContext(message) {
    if (!pool) return { contextText: '', contextSummary: 'no db', categories: [] };

    const lower = message.toLowerCase();
    const parts = [];
    const matched = [];

    try {
        // ── Tier 1: Quick summary (ALWAYS) ──────────────────────
        const quickSummary = await buildQuickSummary();
        if (quickSummary) parts.push(quickSummary);

        // ── Detect categories ───────────────────────────────────
        for (const [cat, pattern] of Object.entries(CATEGORY_PATTERNS)) {
            if (pattern.test(lower)) matched.push(cat);
        }

        // General = load all categories
        if (matched.includes('general')) {
            matched.length = 0;
            matched.push('revenue', 'collections', 'staff', 'leads', 'inventory', 'whatsapp', 'insights');
        }

        // If no specific category matched but it's a business question, use daily snapshot
        if (matched.length === 0) {
            const snapshot = await getLatestSnapshot();
            if (snapshot) {
                parts.push('\n--- Cached Daily Snapshot ---\n' + formatSnapshotForChat(snapshot));
                matched.push('snapshot');
            }
        }

        // ── Tier 2: Deep context per category ───────────────────
        const deepResults = await Promise.allSettled(
            matched.filter(c => c !== 'snapshot').map(cat => buildDeepContext(cat))
        );
        for (const r of deepResults) {
            if (r.status === 'fulfilled' && r.value) parts.push(r.value);
        }

    } catch (e) {
        console.error('[AI Context] Build error:', e.message);
    }

    const contextText = parts.length
        ? '=== LIVE BUSINESS DATA (from database — use this in your response) ===\n\n' + parts.join('\n\n')
        : '';

    const contextSummary = matched.length
        ? `ctx: ${matched.join(',')}`
        : 'ctx: quick-only';

    return { contextText, contextSummary, categories: matched };
}

// ─── Tier 1: Quick Summary ────────────────────────────────────

async function buildQuickSummary() {
    try {
        const [rows] = await pool.query(`
            SELECT
                (SELECT COALESCE(SUM(CASE WHEN DATE(invoice_date) = CURDATE() THEN total ELSE 0 END), 0) FROM zoho_invoices) as today_revenue,
                (SELECT COUNT(CASE WHEN DATE(invoice_date) = CURDATE() THEN 1 END) FROM zoho_invoices) as today_invoice_count,
                (SELECT COALESCE(SUM(CASE WHEN DATE(invoice_date) = DATE_SUB(CURDATE(), INTERVAL 1 DAY) THEN total ELSE 0 END), 0) FROM zoho_invoices) as yesterday_revenue,
                (SELECT COALESCE(SUM(CASE WHEN DATE(payment_date) = CURDATE() THEN amount ELSE 0 END), 0) FROM zoho_payments) as today_collections,
                (SELECT COUNT(*) FROM zoho_invoices WHERE status = 'overdue' AND balance > 0) as overdue_count,
                (SELECT COALESCE(SUM(balance), 0) FROM zoho_invoices WHERE status = 'overdue' AND balance > 0) as overdue_total,
                (SELECT COUNT(*) FROM staff_attendance WHERE date = CURDATE()) as staff_present,
                (SELECT COUNT(*) FROM users WHERE role = 'staff' AND status = 'active') as staff_total,
                (SELECT COUNT(*) FROM leads WHERE status NOT IN ('won','lost','closed')) as active_leads,
                (SELECT COUNT(*) FROM leads WHERE status = 'new' AND DATE(created_at) = CURDATE()) as new_leads_today,
                (SELECT COUNT(*) FROM zoho_items_map WHERE zoho_status = 'active' AND zoho_stock_on_hand = 0) as out_of_stock,
                (SELECT COUNT(*) FROM ai_insights WHERE is_read = 0 AND is_dismissed = 0 AND severity IN ('critical','warning')) as unread_alerts
        `);

        const d = rows[0];
        const revChange = d.yesterday_revenue > 0
            ? ((d.today_revenue - d.yesterday_revenue) / d.yesterday_revenue * 100).toFixed(1)
            : '0.0';
        const arrow = parseFloat(revChange) > 0 ? '↑' : parseFloat(revChange) < 0 ? '↓' : '→';
        const absent = d.staff_total - d.staff_present;

        return `## Today's Quick Dashboard (${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })})
Revenue: ₹${formatINR(d.today_revenue)} (${d.today_invoice_count} invoices) ${arrow}${revChange}% vs yesterday ₹${formatINR(d.yesterday_revenue)}
Collections: ₹${formatINR(d.today_collections)}
Overdue: ${d.overdue_count} invoices totaling ₹${formatINR(d.overdue_total)}
Staff: ${d.staff_present}/${d.staff_total} present (${absent} absent)
Leads: ${d.active_leads} active, ${d.new_leads_today} new today
Stock: ${d.out_of_stock} items out of stock
${d.unread_alerts > 0 ? `Alerts: ${d.unread_alerts} unread critical/warning insights` : ''}`;
    } catch (e) {
        console.error('[AI Context] Quick summary error:', e.message);
        return null;
    }
}

// ─── Tier 2: Deep Context by Category ─────────────────────────

async function buildDeepContext(category) {
    switch (category) {
        case 'revenue': return buildRevenueContext();
        case 'collections': return buildCollectionsContext();
        case 'staff': return buildStaffContext();
        case 'leads': return buildLeadsContext();
        case 'inventory': return buildInventoryContext();
        case 'whatsapp': return buildWhatsAppContext();
        case 'insights': return buildInsightsContext();
        default: return null;
    }
}

async function buildRevenueContext() {
    try {
        // Branch breakdown (today + yesterday) via zoho_daily_transactions
        const [branches] = await pool.query(`
            SELECT
                location_name as branch,
                COALESCE(SUM(CASE WHEN transaction_date = CURDATE() THEN invoice_amount ELSE 0 END), 0) as today,
                COALESCE(SUM(CASE WHEN transaction_date = DATE_SUB(CURDATE(), INTERVAL 1 DAY) THEN invoice_amount ELSE 0 END), 0) as yesterday,
                COALESCE(SUM(CASE WHEN transaction_date = CURDATE() THEN invoice_count ELSE 0 END), 0) as today_count
            FROM zoho_daily_transactions
            WHERE transaction_date >= DATE_SUB(CURDATE(), INTERVAL 1 DAY)
            GROUP BY location_name
            ORDER BY today DESC
        `);

        // Top 5 customers today
        const [topCustomers] = await pool.query(`
            SELECT customer_name, COUNT(*) as invoice_count, SUM(total) as total_amount
            FROM zoho_invoices WHERE DATE(invoice_date) = CURDATE()
            GROUP BY customer_name ORDER BY total_amount DESC LIMIT 5
        `);

        // This month vs last month
        const [monthly] = await pool.query(`
            SELECT
                COALESCE(SUM(CASE WHEN YEAR(invoice_date) = YEAR(CURDATE()) AND MONTH(invoice_date) = MONTH(CURDATE()) THEN total END), 0) as this_month,
                COALESCE(SUM(CASE WHEN YEAR(invoice_date) = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 MONTH)) AND MONTH(invoice_date) = MONTH(DATE_SUB(CURDATE(), INTERVAL 1 MONTH)) THEN total END), 0) as last_month,
                COUNT(CASE WHEN YEAR(invoice_date) = YEAR(CURDATE()) AND MONTH(invoice_date) = MONTH(CURDATE()) THEN 1 END) as this_month_count,
                COUNT(CASE WHEN YEAR(invoice_date) = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 MONTH)) AND MONTH(invoice_date) = MONTH(DATE_SUB(CURDATE(), INTERVAL 1 MONTH)) THEN 1 END) as last_month_count
            FROM zoho_invoices
        `);

        // This week vs last week
        const [weekly] = await pool.query(`
            SELECT
                COALESCE(SUM(CASE WHEN YEARWEEK(invoice_date, 1) = YEARWEEK(CURDATE(), 1) THEN total END), 0) as this_week,
                COALESCE(SUM(CASE WHEN YEARWEEK(invoice_date, 1) = YEARWEEK(DATE_SUB(CURDATE(), INTERVAL 7 DAY), 1) THEN total END), 0) as last_week
            FROM zoho_invoices
        `);

        let text = '## Revenue Deep Dive\n';

        // Branch breakdown
        text += '\n**Branch Breakdown (Today vs Yesterday):**\n';
        for (const b of branches) {
            const change = b.yesterday > 0 ? ((b.today - b.yesterday) / b.yesterday * 100).toFixed(1) : '-';
            const arrow = b.today > b.yesterday ? '↑' : b.today < b.yesterday ? '↓' : '→';
            text += `- ${b.branch || 'Unassigned'}: ₹${formatINR(b.today)} (${b.today_count} inv) ${arrow}${change}% vs yesterday ₹${formatINR(b.yesterday)}\n`;
        }

        // Top customers
        if (topCustomers.length) {
            text += '\n**Top 5 Customers Today:**\n';
            topCustomers.forEach((c, i) => {
                text += `${i + 1}. ${c.customer_name}: ₹${formatINR(c.total_amount)} (${c.invoice_count} invoices)\n`;
            });
        }

        // Monthly comparison
        const m = monthly[0];
        const monthChange = m.last_month > 0 ? ((m.this_month - m.last_month) / m.last_month * 100).toFixed(1) : '-';
        text += `\n**Monthly:** This month ₹${formatINR(m.this_month)} (${m.this_month_count} inv) vs Last month ₹${formatINR(m.last_month)} (${m.last_month_count} inv) — ${monthChange}% change`;

        // Weekly comparison
        const w = weekly[0];
        const weekChange = w.last_week > 0 ? ((w.this_week - w.last_week) / w.last_week * 100).toFixed(1) : '-';
        text += `\n**Weekly:** This week ₹${formatINR(w.this_week)} vs Last week ₹${formatINR(w.last_week)} — ${weekChange}% change`;

        return text;
    } catch (e) {
        console.error('[AI Context] Revenue error:', e.message);
        return null;
    }
}

async function buildCollectionsContext() {
    try {
        // Collection rate
        const [rates] = await pool.query(`
            SELECT
                (SELECT COALESCE(SUM(amount), 0) FROM zoho_payments WHERE YEAR(payment_date) = YEAR(CURDATE()) AND MONTH(payment_date) = MONTH(CURDATE())) as month_collected,
                (SELECT COALESCE(SUM(total), 0) FROM zoho_invoices WHERE YEAR(invoice_date) = YEAR(CURDATE()) AND MONTH(invoice_date) = MONTH(CURDATE())) as month_invoiced
        `);

        // Overdue aging brackets
        const [aging] = await pool.query(`
            SELECT
                COUNT(CASE WHEN DATEDIFF(CURDATE(), due_date) BETWEEN 1 AND 30 THEN 1 END) as days_1_30,
                COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), due_date) BETWEEN 1 AND 30 THEN balance END), 0) as amt_1_30,
                COUNT(CASE WHEN DATEDIFF(CURDATE(), due_date) BETWEEN 31 AND 60 THEN 1 END) as days_31_60,
                COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), due_date) BETWEEN 31 AND 60 THEN balance END), 0) as amt_31_60,
                COUNT(CASE WHEN DATEDIFF(CURDATE(), due_date) BETWEEN 61 AND 90 THEN 1 END) as days_61_90,
                COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), due_date) BETWEEN 61 AND 90 THEN balance END), 0) as amt_61_90,
                COUNT(CASE WHEN DATEDIFF(CURDATE(), due_date) > 90 THEN 1 END) as days_90_plus,
                COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), due_date) > 90 THEN balance END), 0) as amt_90_plus
            FROM zoho_invoices WHERE status = 'overdue' AND balance > 0
        `);

        // Top 10 debtors
        const [debtors] = await pool.query(`
            SELECT customer_name, COUNT(*) as invoice_count, SUM(balance) as total_owed,
                   MAX(DATEDIFF(CURDATE(), due_date)) as max_days_overdue
            FROM zoho_invoices WHERE status = 'overdue' AND balance > 0
            GROUP BY customer_name ORDER BY total_owed DESC LIMIT 10
        `);

        // Payment promises due today
        let promises = [];
        try {
            const [pp] = await pool.query(`
                SELECT pp.*, zi.customer_name, zi.balance
                FROM payment_promises pp
                JOIN zoho_invoices zi ON pp.invoice_id = zi.zoho_invoice_id
                WHERE pp.promise_date = CURDATE() AND pp.status = 'pending'
                ORDER BY zi.balance DESC
            `);
            promises = pp;
        } catch (e) { /* payment_promises may not exist */ }

        const r = rates[0];
        const collectionRate = r.month_invoiced > 0 ? (r.month_collected / r.month_invoiced * 100).toFixed(1) : '0.0';
        const a = aging[0];

        let text = '## Collections & Overdue Report\n';
        text += `\n**Collection Rate (This Month):** ${collectionRate}% (₹${formatINR(r.month_collected)} collected / ₹${formatINR(r.month_invoiced)} invoiced)\n`;

        text += '\n**Overdue Aging:**\n';
        text += `- 1-30 days: ${a.days_1_30} invoices, ₹${formatINR(a.amt_1_30)}\n`;
        text += `- 31-60 days: ${a.days_31_60} invoices, ₹${formatINR(a.amt_31_60)}\n`;
        text += `- 61-90 days: ${a.days_61_90} invoices, ₹${formatINR(a.amt_61_90)}\n`;
        text += `- 90+ days: ${a.days_90_plus} invoices, ₹${formatINR(a.amt_90_plus)}\n`;

        if (debtors.length) {
            text += '\n**Top 10 Debtors:**\n';
            debtors.forEach((d, i) => {
                text += `${i + 1}. ${d.customer_name}: ₹${formatINR(d.total_owed)} (${d.invoice_count} inv, ${d.max_days_overdue} days max)\n`;
            });
        }

        if (promises.length) {
            text += `\n**Payment Promises Due Today:** ${promises.length} promises\n`;
            promises.forEach(p => {
                text += `- ${p.customer_name}: ₹${formatINR(p.balance)}\n`;
            });
        }

        return text;
    } catch (e) {
        console.error('[AI Context] Collections error:', e.message);
        return null;
    }
}

async function buildStaffContext() {
    try {
        // Currently clocked-in staff
        const [clockedIn] = await pool.query(`
            SELECT u.full_name as name, b.name as branch_name, sa.clock_in_time,
                   TIMESTAMPDIFF(MINUTE, sa.clock_in_time, NOW()) as minutes_since_clockin,
                   sa.total_break_minutes, sa.overtime_minutes
            FROM staff_attendance sa
            JOIN users u ON sa.user_id = u.id
            LEFT JOIN branches b ON sa.branch_id = b.id
            WHERE sa.date = CURDATE() AND sa.clock_out_time IS NULL
            ORDER BY sa.clock_in_time ASC
        `);

        // Absent staff
        const [absent] = await pool.query(`
            SELECT u.full_name as name, b.name as branch_name
            FROM users u
            LEFT JOIN branches b ON u.branch_id = b.id
            WHERE u.role = 'staff' AND u.status = 'active'
            AND u.id NOT IN (SELECT user_id FROM staff_attendance WHERE date = CURDATE())
        `);

        // Late arrivals (clocked in after 9:30 AM)
        const [late] = await pool.query(`
            SELECT u.full_name as name, sa.clock_in_time,
                   TIMESTAMPDIFF(MINUTE, CONCAT(CURDATE(), ' 09:30:00'), sa.clock_in_time) as minutes_late
            FROM staff_attendance sa
            JOIN users u ON sa.user_id = u.id
            WHERE sa.date = CURDATE() AND TIME(sa.clock_in_time) > '09:30:00'
            ORDER BY sa.clock_in_time DESC
        `);

        // Break excess (over 60 min total break)
        const [breakExcess] = await pool.query(`
            SELECT u.full_name as name, sa.total_break_minutes
            FROM staff_attendance sa
            JOIN users u ON sa.user_id = u.id
            WHERE sa.date = CURDATE() AND sa.total_break_minutes > 60
            ORDER BY sa.total_break_minutes DESC
        `);

        // Pending OT requests
        const [otPending] = await pool.query(`
            SELECT u.full_name as name, sa.overtime_minutes, sa.ot_request_status
            FROM staff_attendance sa
            JOIN users u ON sa.user_id = u.id
            WHERE sa.date = CURDATE() AND sa.ot_request_status = 'pending' AND sa.overtime_minutes > 0
        `);

        // Today's completed staff stats
        const [completed] = await pool.query(`
            SELECT u.full_name as name, sa.total_working_minutes, sa.clock_in_time, sa.clock_out_time
            FROM staff_attendance sa
            JOIN users u ON sa.user_id = u.id
            WHERE sa.date = CURDATE() AND sa.clock_out_time IS NOT NULL
            ORDER BY sa.total_working_minutes DESC
        `);

        let text = '## Staff & Attendance Report\n';

        text += `\n**Currently Working (${clockedIn.length}):**\n`;
        if (clockedIn.length) {
            clockedIn.forEach(s => {
                const hours = Math.floor(s.minutes_since_clockin / 60);
                const mins = s.minutes_since_clockin % 60;
                text += `- ${s.name} (${s.branch_name || 'N/A'}): ${hours}h ${mins}m since clock-in${s.overtime_minutes > 0 ? ` [OT: ${s.overtime_minutes}m]` : ''}\n`;
            });
        } else {
            text += '- No one currently clocked in\n';
        }

        text += `\n**Absent Today (${absent.length}):**\n`;
        if (absent.length) {
            absent.forEach(s => { text += `- ${s.name} (${s.branch_name || 'N/A'})\n`; });
        } else {
            text += '- Full attendance!\n';
        }

        if (late.length) {
            text += `\n**Late Arrivals (${late.length}):**\n`;
            late.forEach(s => {
                text += `- ${s.name}: ${s.minutes_late} min late (arrived ${new Date(s.clock_in_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })})\n`;
            });
        }

        if (breakExcess.length) {
            text += `\n**Excessive Breaks (>60 min):**\n`;
            breakExcess.forEach(s => { text += `- ${s.name}: ${s.total_break_minutes} min total break\n`; });
        }

        if (otPending.length) {
            text += `\n**Pending OT Approvals (${otPending.length}):**\n`;
            otPending.forEach(s => { text += `- ${s.name}: ${s.overtime_minutes} min OT\n`; });
        }

        if (completed.length) {
            text += `\n**Completed Shifts (${completed.length}):**\n`;
            completed.forEach(s => {
                const hours = Math.floor(s.total_working_minutes / 60);
                const mins = s.total_working_minutes % 60;
                text += `- ${s.name}: ${hours}h ${mins}m worked\n`;
            });
        }

        return text;
    } catch (e) {
        console.error('[AI Context] Staff error:', e.message);
        return null;
    }
}

async function buildLeadsContext() {
    try {
        // Status funnel
        const [funnel] = await pool.query(`
            SELECT status, COUNT(*) as count, COALESCE(SUM(estimated_budget), 0) as total_value
            FROM leads WHERE status NOT IN ('closed')
            GROUP BY status ORDER BY FIELD(status, 'new','interested','quoted','won','lost')
        `);

        // Stale leads (>7 days no activity)
        const [stale] = await pool.query(`
            SELECT l.name, l.phone, l.status, l.source, u.full_name as assigned_name,
                   DATEDIFF(CURDATE(), l.updated_at) as days_inactive
            FROM leads l
            LEFT JOIN users u ON l.assigned_to = u.id
            WHERE l.status NOT IN ('won','lost','closed')
            AND DATEDIFF(CURDATE(), l.updated_at) > 7
            ORDER BY days_inactive DESC LIMIT 10
        `);

        // Today's follow-ups due
        const [followups] = await pool.query(`
            SELECT l.name, l.phone, l.status, l.estimated_budget as estimated_value, u.full_name as assigned_name
            FROM leads l
            LEFT JOIN users u ON l.assigned_to = u.id
            WHERE DATE(l.next_followup_date) = CURDATE() AND l.status NOT IN ('won','lost','closed')
            ORDER BY l.estimated_budget DESC
        `);

        // Top scored leads
        let topScored = [];
        try {
            const [ts] = await pool.query(`
                SELECT als.score, als.next_action, l.name, l.phone, l.status, l.estimated_budget as estimated_value
                FROM ai_lead_scores als
                JOIN leads l ON als.lead_id = l.id
                WHERE l.status NOT IN ('won','lost','closed')
                ORDER BY als.score DESC LIMIT 5
            `);
            topScored = ts;
        } catch (e) { /* table may be empty */ }

        let text = '## Leads & Pipeline\n';

        text += '\n**Status Funnel:**\n';
        funnel.forEach(f => {
            text += `- ${f.status}: ${f.count} leads (₹${formatINR(f.total_value)} estimated value)\n`;
        });

        if (followups.length) {
            text += `\n**Follow-ups Due Today (${followups.length}):**\n`;
            followups.forEach(f => {
                text += `- ${f.name} (${f.status}): ₹${formatINR(f.estimated_value || 0)} — assigned to ${f.assigned_name || 'Unassigned'}\n`;
            });
        }

        if (stale.length) {
            text += `\n**Stale Leads (>7 days inactive, top 10):**\n`;
            stale.forEach(s => {
                text += `- ${s.name} (${s.status}): ${s.days_inactive} days — ${s.assigned_name || 'Unassigned'}\n`;
            });
        }

        if (topScored.length) {
            text += '\n**Top AI-Scored Leads:**\n';
            topScored.forEach((s, i) => {
                text += `${i + 1}. ${s.name} — Score: ${s.score}/100 (${s.status}, ₹${formatINR(s.estimated_value || 0)})${s.next_action ? ` → ${s.next_action}` : ''}\n`;
            });
        }

        return text;
    } catch (e) {
        console.error('[AI Context] Leads error:', e.message);
        return null;
    }
}

async function buildInventoryContext() {
    try {
        // Out of stock items
        const [outOfStock] = await pool.query(`
            SELECT zoho_item_name, zoho_sku FROM zoho_items_map
            WHERE zoho_status = 'active' AND zoho_stock_on_hand = 0
            ORDER BY zoho_item_name LIMIT 20
        `);

        // Below reorder level
        const [belowReorder] = await pool.query(`
            SELECT zoho_item_name, zoho_sku, zoho_stock_on_hand, zoho_reorder_level
            FROM zoho_items_map
            WHERE zoho_status = 'active' AND zoho_reorder_level > 0 AND zoho_stock_on_hand <= zoho_reorder_level AND zoho_stock_on_hand > 0
            ORDER BY (zoho_stock_on_hand / zoho_reorder_level) ASC LIMIT 20
        `);

        // Recent stock check results
        let recentChecks = [];
        try {
            const [sc] = await pool.query(`
                SELECT sca.status, COUNT(*) as count,
                       SUM(CASE WHEN sca.status = 'completed' THEN 1 ELSE 0 END) as completed,
                       MAX(sca.updated_at) as last_check
                FROM stock_check_assignments sca
                WHERE sca.created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
                GROUP BY sca.status
            `);
            recentChecks = sc;
        } catch (e) { /* table may not exist */ }

        let text = '## Inventory Report\n';

        text += `\n**Out of Stock (${outOfStock.length} items):**\n`;
        if (outOfStock.length) {
            outOfStock.forEach(i => { text += `- ${i.zoho_item_name} (SKU: ${i.zoho_sku || 'N/A'})\n`; });
        } else {
            text += '- All items in stock!\n';
        }

        text += `\n**Below Reorder Level (${belowReorder.length} items):**\n`;
        if (belowReorder.length) {
            belowReorder.forEach(i => {
                text += `- ${i.zoho_item_name}: ${i.zoho_stock_on_hand} remaining (reorder at ${i.zoho_reorder_level})\n`;
            });
        } else {
            text += '- All items above reorder levels\n';
        }

        if (recentChecks.length) {
            text += '\n**Recent Stock Checks (last 7 days):**\n';
            recentChecks.forEach(c => { text += `- ${c.status}: ${c.count} assignments\n`; });
        }

        return text;
    } catch (e) {
        console.error('[AI Context] Inventory error:', e.message);
        return null;
    }
}

async function buildWhatsAppContext() {
    try {
        const [campaigns] = await pool.query(`
            SELECT name, status, total_leads as total_recipients,
                   sent_count, delivered_count, read_count, failed_count,
                   created_at
            FROM wa_campaigns
            ORDER BY created_at DESC LIMIT 5
        `);

        let text = '## WhatsApp & Marketing\n';
        if (campaigns.length) {
            text += '\n**Recent Campaigns:**\n';
            campaigns.forEach(c => {
                const deliveryRate = c.sent_count > 0 ? (c.delivered_count / c.sent_count * 100).toFixed(0) : '0';
                const readRate = c.delivered_count > 0 ? (c.read_count / c.delivered_count * 100).toFixed(0) : '0';
                text += `- "${c.name}" (${c.status}): ${c.sent_count}/${c.total_recipients} sent, ${deliveryRate}% delivered, ${readRate}% read, ${c.failed_count} failed\n`;
            });
        } else {
            text += '- No recent campaigns\n';
        }

        return text;
    } catch (e) {
        console.error('[AI Context] WhatsApp error:', e.message);
        return null;
    }
}

async function buildInsightsContext() {
    try {
        const [insights] = await pool.query(`
            SELECT category, severity, title, description, action_recommended, created_at
            FROM ai_insights
            WHERE is_read = 0 AND is_dismissed = 0 AND severity IN ('critical','warning')
            ORDER BY FIELD(severity, 'critical','warning'), created_at DESC LIMIT 10
        `);

        let text = '## Unread Alerts & Insights\n';
        if (insights.length) {
            insights.forEach(i => {
                text += `\n**[${i.severity.toUpperCase()}] ${i.title}** (${i.category})\n`;
                text += `${i.description}\n`;
                if (i.action_recommended) text += `→ Action: ${i.action_recommended}\n`;
            });
        } else {
            text += '- No critical/warning alerts pending\n';
        }

        return text;
    } catch (e) {
        console.error('[AI Context] Insights error:', e.message);
        return null;
    }
}

// ─── Daily Snapshot ───────────────────────────────────────────

async function generateDailySnapshot() {
    if (!pool) throw new Error('No database pool');

    const start = Date.now();
    const data = {};

    try {
        // Revenue summary
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
        data.revenue = rev[0];

        // Collections
        const [col] = await pool.query(`
            SELECT
                COALESCE(SUM(CASE WHEN DATE(payment_date) = CURDATE() THEN amount END), 0) as today,
                COALESCE(SUM(CASE WHEN YEAR(payment_date) = YEAR(CURDATE()) AND MONTH(payment_date) = MONTH(CURDATE()) THEN amount END), 0) as this_month
            FROM zoho_payments
        `);
        data.collections = col[0];

        // Overdue
        const [od] = await pool.query(`
            SELECT COUNT(*) as count, COALESCE(SUM(balance), 0) as total
            FROM zoho_invoices WHERE status = 'overdue' AND balance > 0
        `);
        data.overdue = od[0];

        // Staff
        const [staff] = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM staff_attendance WHERE date = CURDATE()) as present,
                (SELECT COUNT(*) FROM users WHERE role = 'staff' AND status = 'active') as total
        `);
        data.staff = staff[0];

        // Leads
        const [leads] = await pool.query(`
            SELECT
                COUNT(*) as active,
                COUNT(CASE WHEN status = 'new' THEN 1 END) as new_leads,
                COUNT(CASE WHEN DATEDIFF(CURDATE(), updated_at) > 7 THEN 1 END) as stale
            FROM leads WHERE status NOT IN ('won','lost','closed')
        `);
        data.leads = leads[0];

        // Stock
        const [stock] = await pool.query(`
            SELECT
                COUNT(CASE WHEN zoho_stock_on_hand = 0 THEN 1 END) as out_of_stock,
                COUNT(CASE WHEN zoho_reorder_level > 0 AND zoho_stock_on_hand <= zoho_reorder_level AND zoho_stock_on_hand > 0 THEN 1 END) as below_reorder
            FROM zoho_items_map WHERE zoho_status = 'active'
        `);
        data.stock = stock[0];

        const duration = Date.now() - start;

        // Upsert snapshot
        await pool.query(`
            INSERT INTO ai_business_context (context_date, context_type, context_data, generation_time_ms)
            VALUES (CURDATE(), 'daily_snapshot', ?, ?)
            ON DUPLICATE KEY UPDATE context_data = VALUES(context_data), generation_time_ms = VALUES(generation_time_ms), generated_at = NOW()
        `, [JSON.stringify(data), duration]);

        console.log(`[AI Context] Daily snapshot generated in ${duration}ms`);
        return data;
    } catch (e) {
        console.error('[AI Context] Snapshot generation error:', e.message);
        throw e;
    }
}

async function getLatestSnapshot() {
    try {
        const [rows] = await pool.query(`
            SELECT context_data, generated_at FROM ai_business_context
            WHERE context_type = 'daily_snapshot'
            ORDER BY context_date DESC LIMIT 1
        `);
        if (!rows.length) return null;
        const data = typeof rows[0].context_data === 'string' ? JSON.parse(rows[0].context_data) : rows[0].context_data;
        data._generated_at = rows[0].generated_at;
        return data;
    } catch (e) {
        return null;
    }
}

function formatSnapshotForChat(snapshot) {
    const parts = [];
    if (snapshot.revenue) {
        const r = snapshot.revenue;
        parts.push(`Revenue: Today ₹${formatINR(r.today)} (${r.today_count} inv), Yesterday ₹${formatINR(r.yesterday)}, Week ₹${formatINR(r.this_week)}, Month ₹${formatINR(r.this_month)} (${r.month_count} inv)`);
    }
    if (snapshot.collections) {
        parts.push(`Collections: Today ₹${formatINR(snapshot.collections.today)}, Month ₹${formatINR(snapshot.collections.this_month)}`);
    }
    if (snapshot.overdue) {
        parts.push(`Overdue: ${snapshot.overdue.count} invoices, ₹${formatINR(snapshot.overdue.total)}`);
    }
    if (snapshot.staff) {
        parts.push(`Staff: ${snapshot.staff.present}/${snapshot.staff.total} present`);
    }
    if (snapshot.leads) {
        parts.push(`Leads: ${snapshot.leads.active} active (${snapshot.leads.new_leads} new, ${snapshot.leads.stale} stale)`);
    }
    if (snapshot.stock) {
        parts.push(`Stock: ${snapshot.stock.out_of_stock} out, ${snapshot.stock.below_reorder} below reorder`);
    }
    if (snapshot._generated_at) {
        parts.push(`(Snapshot from ${new Date(snapshot._generated_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })})`);
    }
    return parts.join('\n');
}

// ─── Utility ──────────────────────────────────────────────────

function formatINR(amount) {
    const num = parseFloat(amount) || 0;
    if (num >= 10000000) return (num / 10000000).toFixed(2) + 'Cr';
    if (num >= 100000) return (num / 100000).toFixed(2) + 'L';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toFixed(0);
}

module.exports = {
    setPool,
    buildChatContext,
    generateDailySnapshot,
    getLatestSnapshot,
    formatINR
};
