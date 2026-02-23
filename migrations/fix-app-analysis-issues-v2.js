/**
 * Fix App Analysis Issues v2
 * Addresses all critical/warning issues from AI App Analyzer report (Feb 23, 2026)
 *
 * Run: node migrations/fix-app-analysis-issues-v2.js
 *
 * Fixes:
 *   1. Widen WhatsApp phone columns from VARCHAR(50) → VARCHAR(100)
 *   2. Add missing foreign key indexes (high priority)
 *   3. Add missing updated_at columns on key tables
 *
 * All operations are idempotent — safe to run multiple times.
 */
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function migrate() {
    let pool;
    try {
        pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'business_manager',
            port: process.env.DB_PORT || 3306
        });

        console.log('=== Fix App Analysis Issues v2 ===\n');
        let changes = 0;

        // ─── 1. Widen WhatsApp phone columns to VARCHAR(100) ─────────
        console.log('--- 1. WhatsApp phone column widening ---');
        const phoneColumns = [
            { table: 'whatsapp_sessions', column: 'phone_number', nullable: true },
            { table: 'whatsapp_messages', column: 'phone_number', nullable: false },
            { table: 'whatsapp_contacts', column: 'phone_number', nullable: false },
            { table: 'whatsapp_followups', column: 'phone', nullable: false }
        ];

        for (const { table, column, nullable } of phoneColumns) {
            const [tables] = await pool.query(`
                SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
            `, [table]);
            if (tables.length === 0) {
                console.log(`  ⏭️  Table ${table} does not exist, skipping`);
                continue;
            }

            const [cols] = await pool.query(`
                SELECT CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
            `, [table, column]);
            if (cols.length === 0) {
                console.log(`  ⏭️  ${table}.${column} does not exist, skipping`);
                continue;
            }

            const currentSize = cols[0].CHARACTER_MAXIMUM_LENGTH;
            if (currentSize >= 100) {
                console.log(`  ⏭️  ${table}.${column} already VARCHAR(${currentSize}), no change needed`);
                continue;
            }

            const nullClause = nullable ? 'NULL' : 'NOT NULL';
            await pool.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` VARCHAR(100) ${nullClause}`);
            console.log(`  ✅ ${table}.${column} widened from VARCHAR(${currentSize}) to VARCHAR(100)`);
            changes++;
        }

        // ─── 2. Add missing foreign key indexes ──────────────────────
        console.log('\n--- 2. Missing FK indexes ---');
        const indexesToAdd = [
            // High priority (frequently joined columns from report)
            { table: 'branches', column: 'manager_user_id', name: 'idx_branches_manager' },
            { table: 'error_logs', column: 'user_id', name: 'idx_error_logs_user' },
            { table: 'error_logs', column: 'branch_id', name: 'idx_error_logs_branch' },
            { table: 'error_logs', column: 'session_id', name: 'idx_error_logs_session' },
            { table: 'guides', column: 'author_id', name: 'idx_guides_author' },
            { table: 'overtime_requests', column: 'branch_id', name: 'idx_ot_requests_branch' },
            { table: 'staff_registrations', column: 'otp_id', name: 'idx_staff_reg_otp' },
            { table: 'staff_registrations', column: 'assigned_branch_id', name: 'idx_staff_reg_branch' },
            { table: 'whatsapp_followups', column: 'zoho_customer_id', name: 'idx_wf_zoho_customer' },
            { table: 'whatsapp_followups', column: 'zoho_invoice_id', name: 'idx_wf_zoho_invoice' },
            { table: 'payment_promises', column: 'zoho_invoice_id', name: 'idx_pp_zoho_invoice' },
            { table: 'zoho_stock_history', column: 'reference_id', name: 'idx_zsh_reference' },
            { table: 'zoho_daily_transaction_details', column: 'zoho_transaction_id', name: 'idx_zdtd_transaction' },
            { table: 'painter_estimates', column: 'zoho_invoice_id', name: 'idx_pe_zoho_invoice' },
            { table: 'painters', column: 'zoho_contact_id', name: 'idx_painters_zoho_contact' }
        ];

        for (const { table, column, name } of indexesToAdd) {
            const [tables] = await pool.query(`
                SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
            `, [table]);
            if (tables.length === 0) {
                console.log(`  ⏭️  Table ${table} does not exist, skipping`);
                continue;
            }

            const [cols] = await pool.query(`
                SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
            `, [table, column]);
            if (cols.length === 0) {
                console.log(`  ⏭️  ${table}.${column} does not exist, skipping`);
                continue;
            }

            const [existing] = await pool.query(`
                SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
            `, [table, column]);
            if (existing.length > 0) {
                console.log(`  ⏭️  ${table}.${column} already indexed (${existing[0].INDEX_NAME})`);
                continue;
            }

            await pool.query(`ALTER TABLE \`${table}\` ADD INDEX \`${name}\` (\`${column}\`)`);
            console.log(`  ✅ Added index ${name} on ${table}.${column}`);
            changes++;
        }

        // ─── 3. Add missing updated_at columns ───────────────────────
        console.log('\n--- 3. Missing updated_at columns ---');
        const tablesNeedingUpdatedAt = [
            'users',
            'permissions',
            'estimate_items',
            'customer_types',
            'user_sessions',
            'otp_verifications'
        ];

        for (const table of tablesNeedingUpdatedAt) {
            const [tables] = await pool.query(`
                SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
            `, [table]);
            if (tables.length === 0) {
                console.log(`  ⏭️  Table ${table} does not exist, skipping`);
                continue;
            }

            const [cols] = await pool.query(`
                SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'updated_at'
            `, [table]);
            if (cols.length > 0) {
                console.log(`  ⏭️  ${table}.updated_at already exists`);
                continue;
            }

            await pool.query(`
                ALTER TABLE \`${table}\`
                ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            `);

            // Backfill from created_at if it exists
            const [createdCol] = await pool.query(`
                SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'created_at'
            `, [table]);
            if (createdCol.length > 0) {
                await pool.query(`UPDATE \`${table}\` SET updated_at = created_at WHERE updated_at IS NULL`);
            }

            console.log(`  ✅ ${table}.updated_at added`);
            changes++;
        }

        console.log(`\n=== Migration completed! ${changes} changes applied ===`);
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate();
