/**
 * Add missing indexes on frequently queried columns
 *
 * Found via production analysis: these columns are used in WHERE/JOIN/ORDER BY
 * but lack indexes, causing full table scans.
 *
 * Run: node migrations/fix-missing-indexes.js
 * Normalized to exports.up(pool) (D2, 2026-06-11) — requiring this file no longer runs it.
 */

const INDEXES = [
    { table: 'zoho_daily_transactions', column: 'transaction_type', name: 'idx_transaction_type' },
    { table: 'zoho_invoices', column: 'zoho_contact_id', name: 'idx_zoho_contact_id' },
    { table: 'zoho_payments', column: 'zoho_contact_id', name: 'idx_zoho_contact_id' },
    { table: 'staff_tasks', column: 'created_at', name: 'idx_created_at' },
    { table: 'ai_messages', column: 'created_at', name: 'idx_created_at' },
    { table: 'stock_check_assignments', column: 'submitted_at', name: 'idx_submitted_at' },
    { table: 'painter_estimates', column: 'created_at', name: 'idx_created_at' },
];

exports.up = async function up(pool) {
    console.log('=== Adding Missing Indexes ===\n');

    let added = 0;
    for (const idx of INDEXES) {
        try {
            // Check if index already exists
            const [existing] = await pool.query(
                `SHOW INDEX FROM \`${idx.table}\` WHERE Column_name = ?`,
                [idx.column]
            );
            if (existing.length) {
                console.log(`  - ${idx.table}.${idx.column} — already indexed`);
                continue;
            }

            await pool.query(
                `ALTER TABLE \`${idx.table}\` ADD INDEX \`${idx.name}\` (\`${idx.column}\`)`
            );
            console.log(`  ✓ ${idx.table}.${idx.column}`);
            added++;
        } catch (err) {
            console.error(`  ✗ ${idx.table}.${idx.column}: ${err.message}`);
        }
    }

    console.log(`\nAdded ${added} indexes`);
};

// Direct-run support (legacy usage: node migrations/fix-missing-indexes.js)
if (require.main === module) {
    (async () => {
        require('dotenv').config();
        const mysql = require('mysql2/promise');
        const pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'business_manager',
            port: parseInt(process.env.DB_PORT, 10) || 3306
        });
        try {
            await exports.up(pool);
            console.log('Done.');
            process.exit(0);
        } catch (err) {
            console.error('Migration failed:', err.message);
            process.exit(1);
        }
    })();
}
