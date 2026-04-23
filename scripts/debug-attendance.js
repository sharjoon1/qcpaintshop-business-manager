const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
    const pool = mysql.createPool({
        host: process.env.DB_HOST, user: process.env.DB_USER,
        password: process.env.DB_PASSWORD, database: process.env.DB_NAME
    });

    // 1. Check attendance for today using LEFT JOIN (in case branch is missing)
    const [rows] = await pool.query(
        `SELECT a.user_id, a.date, a.branch_id, u.full_name, u.phone, b.name as branch_name
         FROM staff_attendance a
         JOIN users u ON a.user_id = u.id
         LEFT JOIN branches b ON a.branch_id = b.id
         WHERE a.date = CURDATE()
         ORDER BY a.user_id LIMIT 10`
    );
    console.log('Today attendance (LEFT JOIN):', rows.length);
    rows.forEach(r => console.log(`  ${r.full_name} | branch_id=${r.branch_id} | branch_name=${r.branch_name} | phone=${r.phone}`));

    // 2. Try with INNER JOIN (the original query)
    const [rows2] = await pool.query(
        `SELECT a.user_id, u.full_name, b.name as branch_name
         FROM staff_attendance a
         JOIN users u ON a.user_id = u.id
         JOIN branches b ON a.branch_id = b.id
         WHERE a.date = CURDATE()
         ORDER BY a.user_id LIMIT 10`
    );
    console.log('\nToday attendance (INNER JOIN):', rows2.length);

    // 3. Check attendance_daily_reports table
    const [reports] = await pool.query('SELECT * FROM attendance_daily_reports WHERE report_date = CURDATE() LIMIT 5');
    console.log('\nReports today:', reports.length);

    // 4. Try generateReport
    const report = require('../services/attendance-report');
    report.setPool(pool);
    if (rows.length > 0) {
        const r = await report.generateReport(rows[0].user_id, new Date().toISOString().split('T')[0]);
        console.log('\nReport for', rows[0].full_name, ':', r ? 'OK' : 'NULL');
        if (r) console.log(r.text.substring(0, 200));
    }

    await pool.end();
})().catch(e => { console.error('FATAL:', e.message, e.sql); process.exit(1); });
