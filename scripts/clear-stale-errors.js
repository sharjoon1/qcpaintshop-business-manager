#!/usr/bin/env node
// Clear stale error logs that cause false positives in analyzer reports
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

(async () => {
    const pool = mysql.createPool({
        host: process.env.DB_HOST, user: process.env.DB_USER,
        password: process.env.DB_PASSWORD, database: process.env.DB_NAME
    });

    // Check recent errors (last 2h since deploy)
    const [recent] = await pool.query(`
        SELECT error_message, COUNT(*) as cnt, MAX(created_at) as last_seen
        FROM error_logs WHERE created_at > DATE_SUB(NOW(), INTERVAL 2 HOUR)
        GROUP BY error_message ORDER BY cnt DESC LIMIT 10
    `);
    console.log('=== ERRORS SINCE LAST DEPLOY (2h) ===');
    if (recent.length === 0) console.log('NONE - All clear!');
    else recent.forEach(r => console.log(`${r.cnt}x | ${r.last_seen} | ${r.error_message.substring(0, 150)}`));

    // Check stale errors
    const [total] = await pool.query('SELECT COUNT(*) as cnt FROM error_logs');
    const [stale] = await pool.query('SELECT COUNT(*) as cnt FROM error_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 2 HOUR)');
    console.log(`\nTotal: ${total[0].cnt} (stale: ${stale[0].cnt}, recent: ${total[0].cnt - stale[0].cnt})`);

    // Clear stale logs
    const [del] = await pool.query('DELETE FROM error_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 2 HOUR)');
    console.log(`Cleared ${del.affectedRows} stale error log entries`);

    await pool.end();
    process.exit(0);
})();
