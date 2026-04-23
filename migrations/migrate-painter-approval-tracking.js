/**
 * Migration: Painter Approval Tracking
 *
 * Alters:
 *   - painters: adds approval_request_count (INT, default 0)
 *   - painters: adds last_approval_request_at (DATETIME, nullable)
 *
 * Run: node migrations/migrate-painter-approval-tracking.js
 */

const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function runStep(pool, label, sql, params = []) {
    try {
        await pool.query(sql, params);
        console.log(`   OK  ${label}`);
        return 'ok';
    } catch (err) {
        const code = err.code || '';
        if (['ER_DUP_FIELDNAME', 'ER_DUP_ENTRY'].includes(code)) {
            console.log(`   SKIP ${label} (${code})`);
            return 'skip';
        }
        console.error(`   FAIL ${label} — ${err.message}`);
        return 'fail';
    }
}

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 5,
    });

    console.log('▶ Painter approval tracking migration');
    await runStep(pool, 'painters.approval_request_count',
        'ALTER TABLE painters ADD COLUMN approval_request_count INT NOT NULL DEFAULT 0');
    await runStep(pool, 'painters.last_approval_request_at',
        'ALTER TABLE painters ADD COLUMN last_approval_request_at DATETIME NULL');
    console.log('✓ Migration complete');
    await pool.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
