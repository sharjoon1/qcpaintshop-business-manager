/**
 * AI Staff Performance Analyzer
 * Collects attendance, breaks, overtime, task data
 * Generates AI-powered staff performance insights
 */

const aiEngine = require('./ai-engine');

let pool = null;
function setPool(p) { pool = p; }

// ─── Data Collection ───────────────────────────────────────────

async function collectStaffData(period = 'daily') {
    const data = {};

    // Today's attendance with details
    const [attendance] = await pool.query(`
        SELECT
            u.name, u.id as user_id, b.name as branch_name,
            sa.clock_in, sa.clock_out, sa.date,
            sa.total_working_minutes, sa.break_minutes, sa.overtime_minutes,
            sa.prayer_minutes, sa.outside_work_minutes,
            sa.excess_break_minutes, sa.break_exceeded,
            sa.auto_clockout_type,
            sa.ot_request_status, sa.ot_approved_minutes
        FROM staff_attendance sa
        JOIN users u ON sa.user_id = u.id
        LEFT JOIN branches b ON u.branch_id = b.id
        WHERE sa.date = CURDATE()
        ORDER BY u.name
    `);

    data.today_attendance = attendance;

    // Absent staff (users who are active but have no attendance today)
    const [absent] = await pool.query(`
        SELECT u.name, u.id as user_id, b.name as branch_name
        FROM users u
        LEFT JOIN branches b ON u.branch_id = b.id
        LEFT JOIN staff_attendance sa ON u.id = sa.user_id AND sa.date = CURDATE()
        WHERE u.role = 'staff' AND u.status = 'active' AND sa.id IS NULL
    `);

    data.absent_today = absent;

    // Late arrivals (clock_in after expected start)
    try {
        const [lateArrivals] = await pool.query(`
            SELECT
                u.name, sa.clock_in,
                shc.expected_start,
                TIMESTAMPDIFF(MINUTE,
                    CONCAT(sa.date, ' ', shc.expected_start),
                    sa.clock_in
                ) as minutes_late
            FROM staff_attendance sa
            JOIN users u ON sa.user_id = u.id
            LEFT JOIN shop_hours_config shc ON u.branch_id = shc.branch_id
            WHERE sa.date = CURDATE()
                AND sa.clock_in > CONCAT(sa.date, ' ', shc.expected_start)
            ORDER BY minutes_late DESC
        `);
        data.late_arrivals = lateArrivals;
    } catch (e) {
        data.late_arrivals = [];
    }

    // Break excess
    const [breakExcess] = await pool.query(`
        SELECT u.name, sa.break_minutes, sa.excess_break_minutes, sa.break_allowance_minutes
        FROM staff_attendance sa
        JOIN users u ON sa.user_id = u.id
        WHERE sa.date = CURDATE() AND sa.excess_break_minutes > 0
        ORDER BY sa.excess_break_minutes DESC
    `);

    data.break_excess = breakExcess;

    // OT requests today
    const [otRequests] = await pool.query(`
        SELECT
            u.name, otr.status, otr.requested_minutes, otr.approved_minutes,
            otr.created_at
        FROM overtime_requests otr
        JOIN users u ON otr.user_id = u.id
        WHERE DATE(otr.created_at) = CURDATE()
        ORDER BY otr.created_at DESC
    `);

    data.ot_requests = otRequests;

    // Summary stats
    const [summary] = await pool.query(`
        SELECT
            COUNT(*) as total_present,
            COALESCE(AVG(total_working_minutes), 0) as avg_working_minutes,
            COALESCE(SUM(overtime_minutes), 0) as total_overtime_minutes,
            COALESCE(SUM(break_minutes), 0) as total_break_minutes,
            COUNT(CASE WHEN auto_clockout_type IS NOT NULL THEN 1 END) as auto_clockouts
        FROM staff_attendance
        WHERE date = CURDATE()
    `);

    data.summary = summary[0];
    data.summary.total_absent = absent.length;

    // Weekly rolling averages (for daily context)
    if (period === 'daily') {
        const [weeklyAvg] = await pool.query(`
            SELECT
                u.name, u.id as user_id,
                COUNT(DISTINCT sa.date) as days_present,
                COALESCE(AVG(sa.total_working_minutes), 0) as avg_working,
                COALESCE(AVG(sa.break_minutes), 0) as avg_break,
                COALESCE(SUM(sa.excess_break_minutes), 0) as total_excess_break,
                COALESCE(SUM(sa.overtime_minutes), 0) as total_overtime
            FROM users u
            LEFT JOIN staff_attendance sa ON u.id = sa.user_id
                AND sa.date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            WHERE u.role = 'staff' AND u.status = 'active'
            GROUP BY u.id, u.name
            ORDER BY avg_working DESC
        `);
        data.weekly_averages = weeklyAvg;
    }

    // Weekly analysis: 7-day day-by-day breakdown
    if (period === 'weekly') {
        const [weeklyBreakdown] = await pool.query(`
            SELECT
                sa.date,
                COUNT(*) as present,
                COALESCE(AVG(sa.total_working_minutes), 0) as avg_working,
                COALESCE(SUM(sa.overtime_minutes), 0) as total_ot,
                COALESCE(SUM(sa.excess_break_minutes), 0) as total_excess_break,
                COUNT(CASE WHEN sa.auto_clockout_type IS NOT NULL THEN 1 END) as auto_clockouts
            FROM staff_attendance sa
            WHERE sa.date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            GROUP BY sa.date
            ORDER BY sa.date
        `);
        data.weekly_breakdown = weeklyBreakdown;
    }

    return data;
}

// ─── Analysis Runner ───────────────────────────────────────────

async function runStaffAnalysis(period = 'daily') {
    const startTime = Date.now();
    const analysisType = period === 'weekly' ? 'staff_weekly' : 'staff_daily';

    const [runResult] = await pool.query(
        'INSERT INTO ai_analysis_runs (analysis_type, status) VALUES (?, ?)',
        [analysisType, 'running']
    );
    const runId = runResult.insertId;

    try {
        const data = await collectStaffData(period);
        const prompt = buildStaffPrompt(data, period);

        const messages = [
            { role: 'system', content: aiEngine.getSystemPrompt('You are analyzing staff attendance and performance data. Output your analysis as valid JSON with the structure specified.') },
            { role: 'user', content: prompt }
        ];

        const result = await aiEngine.generateWithFailover(messages);

        // Parse insights
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

        // Store insights (all staff category)
        for (const insight of insights) {
            await pool.query(
                `INSERT INTO ai_insights (analysis_run_id, category, severity, title, description, action_recommended)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [runId, 'staff', insight.severity || 'info',
                 insight.title || 'Staff Insight', insight.description || '', insight.action_recommended || '']
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

function buildStaffPrompt(data, period) {
    const lines = [];
    lines.push(`## ${period === 'weekly' ? 'Weekly' : 'Daily'} Staff Performance Analysis`);
    lines.push(`Date: ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
    lines.push('');

    // Summary
    lines.push('### Summary');
    lines.push(`Present: ${data.summary.total_present} | Absent: ${data.summary.total_absent}`);
    lines.push(`Avg Working: ${Math.round(data.summary.avg_working_minutes)} min`);
    lines.push(`Total OT: ${data.summary.total_overtime_minutes} min | Auto Clock-outs: ${data.summary.auto_clockouts}`);
    lines.push('');

    // Absent staff
    if (data.absent_today.length) {
        lines.push(`### Absent Today (${data.absent_today.length})`);
        data.absent_today.forEach(s => lines.push(`- ${s.name} (${s.branch_name || 'No branch'})`));
        lines.push('');
    }

    // Late arrivals
    if (data.late_arrivals.length) {
        lines.push(`### Late Arrivals (${data.late_arrivals.length})`);
        data.late_arrivals.forEach(s => {
            lines.push(`- ${s.name}: ${s.minutes_late} min late (arrived ${new Date(s.clock_in).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })})`);
        });
        lines.push('');
    }

    // Break excess
    if (data.break_excess.length) {
        lines.push(`### Excess Break Time (${data.break_excess.length} staff)`);
        data.break_excess.forEach(s => {
            lines.push(`- ${s.name}: ${s.excess_break_minutes} min excess (took ${s.break_minutes} min, allowed ${s.break_allowance_minutes} min)`);
        });
        lines.push('');
    }

    // OT requests
    if (data.ot_requests.length) {
        lines.push(`### Overtime Requests Today (${data.ot_requests.length})`);
        data.ot_requests.forEach(r => {
            lines.push(`- ${r.name}: ${r.status} (requested ${r.requested_minutes} min${r.approved_minutes ? ', approved ' + r.approved_minutes + ' min' : ''})`);
        });
        lines.push('');
    }

    // Weekly averages
    if (data.weekly_averages && data.weekly_averages.length) {
        lines.push('### 7-Day Staff Averages');
        data.weekly_averages.forEach(s => {
            if (s.days_present > 0) {
                lines.push(`- ${s.name}: ${s.days_present} days, avg ${Math.round(s.avg_working)} min work, ${Math.round(s.avg_break)} min break`);
            }
        });
        lines.push('');
    }

    // Weekly breakdown
    if (data.weekly_breakdown) {
        lines.push('### Weekly Day-by-Day');
        data.weekly_breakdown.forEach(d => {
            lines.push(`- ${d.date}: ${d.present} present, avg ${Math.round(d.avg_working)} min, OT: ${d.total_ot} min`);
        });
        lines.push('');
    }

    lines.push('Analyze this staff data. Identify top performers, attendance issues, break abuse patterns, overtime trends. Provide insights as JSON.');
    return lines.join('\n');
}

function buildWhatsAppSummary(result) {
    let msg = `👥 *Daily Staff Report*\n`;
    msg += `_${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}_\n\n`;
    msg += result.summary.substring(0, 1500);

    const warnings = result.insights.filter(i => i.severity === 'warning' || i.severity === 'critical');
    if (warnings.length) {
        msg += '\n\n⚠️ *Attention Needed:*\n';
        warnings.forEach(w => {
            msg += `• ${w.title}\n`;
        });
    }

    return msg;
}

module.exports = {
    setPool,
    collectStaffData,
    runStaffAnalysis,
    buildWhatsAppSummary
};
