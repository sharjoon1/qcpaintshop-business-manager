const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function safeQuery(pool, label, sql, params) {
    try {
        const [rows] = await pool.query(sql, params || []);
        return rows;
    } catch (e) {
        console.log(`  (${label} skipped: ${e.sqlMessage || e.message})`);
        return [];
    }
}

(async () => {
    const pool = mysql.createPool({
        host: process.env.DB_HOST, user: process.env.DB_USER,
        password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
        port: parseInt(process.env.DB_PORT) || 3306
    });

    // 1. Error logs mentioning break
    const errors = await safeQuery(pool, 'error_logs',
        `SELECT id, error_message, severity, created_at FROM error_logs
         WHERE error_message LIKE '%break%' AND created_at >= DATE_SUB(NOW(), INTERVAL 48 HOUR)
         ORDER BY created_at DESC LIMIT 10`
    );
    console.log('=== BREAK ERRORS (48h) ===');
    errors.forEach(e => console.log(`  [${e.severity}] ${e.error_message} (${e.created_at})`));
    if (!errors.length) console.log('  (none)');

    // 2. Today's breaks
    const breaks = await safeQuery(pool, 'breaks',
        `SELECT a.id, u.full_name, a.break_start_time, a.break_end_time,
                a.break_duration_minutes, a.clock_in_time, a.clock_out_time
         FROM staff_attendance a JOIN users u ON a.user_id = u.id
         WHERE a.date = CURDATE() AND a.break_start_time IS NOT NULL
         ORDER BY a.id DESC LIMIT 10`
    );
    console.log('\n=== TODAY BREAKS ===');
    breaks.forEach(b => console.log(`  ${b.full_name}: break ${b.break_start_time} -> ${b.break_end_time || 'ACTIVE'} (${b.break_duration_minutes}min), clocked_out=${b.clock_out_time || 'NO'}`));
    if (!breaks.length) console.log('  (none)');

    // 3. Stuck breaks (break started, no end, last 7 days)
    const stuck = await safeQuery(pool, 'stuck_breaks',
        `SELECT a.id, u.full_name, a.break_start_time, a.break_end_time, a.clock_out_time, a.date, a.auto_clockout_type
         FROM staff_attendance a JOIN users u ON a.user_id = u.id
         WHERE a.break_start_time IS NOT NULL AND a.break_end_time IS NULL
         AND a.date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
         ORDER BY a.date DESC LIMIT 20`
    );
    console.log('\n=== STUCK BREAKS (open break, no end, last 7 days) ===');
    stuck.forEach(s => console.log(`  ${s.full_name}: break started ${s.break_start_time}, date=${s.date}, clocked_out=${s.clock_out_time || 'NO'}, auto_type=${s.auto_clockout_type || '-'}`));
    if (!stuck.length) console.log('  (none)');

    // 4. AI insights mentioning break
    const insights = await safeQuery(pool, 'ai_insights',
        `SELECT id, insight_type, title, description, severity, created_at FROM ai_insights
         WHERE (title LIKE '%break%' OR description LIKE '%break%')
         AND created_at >= DATE_SUB(NOW(), INTERVAL 48 HOUR)
         ORDER BY created_at DESC LIMIT 10`
    );
    console.log('\n=== AI INSIGHTS ABOUT BREAKS (48h) ===');
    insights.forEach(i => console.log(`  [${i.severity}] ${i.title}: ${(i.description || '').substring(0, 200)} (${i.created_at})`));
    if (!insights.length) console.log('  (none)');

    // 5. AI analysis runs
    const aiRuns = await safeQuery(pool, 'ai_runs',
        `SELECT id, analysis_type, status, summary, created_at FROM ai_analysis_runs
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
         ORDER BY created_at DESC LIMIT 5`
    );
    console.log('\n=== RECENT AI ANALYSIS RUNS (24h) ===');
    aiRuns.forEach(r => console.log(`  [${r.status}] ${r.analysis_type}: ${(r.summary || '').substring(0, 150)} (${r.created_at})`));
    if (!aiRuns.length) console.log('  (none)');

    // 6. AI messages mentioning break (what the AI told the user)
    const aiMsgs = await safeQuery(pool, 'ai_messages',
        `SELECT m.id, m.role, m.content, m.created_at FROM ai_messages m
         WHERE m.content LIKE '%break%tracking%' OR m.content LIKE '%break%system%' OR m.content LIKE '%break%fail%'
         AND m.created_at >= DATE_SUB(NOW(), INTERVAL 48 HOUR)
         ORDER BY m.created_at DESC LIMIT 5`
    );
    console.log('\n=== AI MESSAGES ABOUT BREAK TRACKING (48h) ===');
    aiMsgs.forEach(m => console.log(`  [${m.role}] ${(m.content || '').substring(0, 300)} (${m.created_at})`));
    if (!aiMsgs.length) console.log('  (none)');

    // 7. Check break enforcement config
    const config = await safeQuery(pool, 'config',
        `SELECT config_key, config_value FROM ai_config WHERE config_key LIKE '%break%'`
    );
    console.log('\n=== BREAK CONFIG ===');
    config.forEach(c => console.log(`  ${c.config_key} = ${c.config_value}`));
    if (!config.length) console.log('  (none)');

    // 8. Recent all errors (last 24h, top 10)
    const allErrors = await safeQuery(pool, 'all_errors',
        `SELECT id, error_message, severity, frequency_count, created_at FROM error_logs
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
         ORDER BY created_at DESC LIMIT 10`
    );
    console.log('\n=== ALL RECENT ERRORS (24h) ===');
    allErrors.forEach(e => console.log(`  [${e.severity}] (x${e.frequency_count}) ${(e.error_message || '').substring(0, 150)} (${e.created_at})`));
    if (!allErrors.length) console.log('  (none)');

    await pool.end();
})();
