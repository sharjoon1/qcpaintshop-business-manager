/**
 * Fix App Analysis Issues v3
 * Addresses remaining issues from second AI App Analyzer report (Feb 24, 2026)
 *
 * Run: node migrations/fix-app-analysis-issues-v3.js
 *
 * Fixes:
 *   1. Widen WhatsApp phone columns to VARCHAR(255) (was 100)
 *   2. Add remaining FK indexes (17 columns from second report)
 *   3. Add remaining updated_at columns (12 tables)
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

        console.log('=== Fix App Analysis Issues v3 ===\n');
        let changes = 0;

        // ─── 1. Widen WhatsApp phone columns to VARCHAR(255) ─────────
        console.log('--- 1. WhatsApp phone column widening (→ 255) ---');
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
            if (tables.length === 0) { console.log(`  ⏭️  Table ${table} not found`); continue; }

            const [cols] = await pool.query(`
                SELECT CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
            `, [table, column]);
            if (cols.length === 0) { console.log(`  ⏭️  ${table}.${column} not found`); continue; }

            if (cols[0].CHARACTER_MAXIMUM_LENGTH >= 255) {
                console.log(`  ⏭️  ${table}.${column} already VARCHAR(${cols[0].CHARACTER_MAXIMUM_LENGTH})`);
                continue;
            }

            const nullClause = nullable ? 'NULL' : 'NOT NULL';
            await pool.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` VARCHAR(255) ${nullClause}`);
            console.log(`  ✅ ${table}.${column} widened to VARCHAR(255)`);
            changes++;
        }

        // ─── 2. Add remaining FK indexes ─────────────────────────────
        console.log('\n--- 2. Remaining FK indexes ---');
        const indexesToAdd = [
            { table: 'branches', column: 'zoho_location_id', name: 'idx_branches_zoho_loc' },
            { table: 'bug_reports', column: 'related_error_id', name: 'idx_br_related_error' },
            { table: 'painter_attendance', column: 'branch_id', name: 'idx_pa_branch' },
            { table: 'painter_estimate_items', column: 'zoho_item_id', name: 'idx_pei_zoho_item' },
            { table: 'painter_estimates', column: 'zoho_contact_id', name: 'idx_pe_zoho_contact' },
            { table: 'painter_point_transactions', column: 'reference_id', name: 'idx_ppt_reference' },
            { table: 'painter_slab_evaluations', column: 'slab_id', name: 'idx_pse_slab' },
            { table: 'salary_payments', column: 'transaction_id', name: 'idx_sp_transaction' },
            { table: 'staff_registrations', column: 'created_user_id', name: 'idx_sr_created_user' },
            { table: 'stock_check_assignments', column: 'zoho_location_id', name: 'idx_sca_zoho_loc' },
            { table: 'stock_check_assignments', column: 'adjustment_id', name: 'idx_sca_adjustment' },
            { table: 'users', column: 'upi_id', name: 'idx_users_upi' },
            { table: 'whatsapp_messages', column: 'quoted_msg_id', name: 'idx_wm_quoted' },
            { table: 'zoho_branch_allocations', column: 'zoho_location_id', name: 'idx_zba_zoho_loc' },
            { table: 'zoho_daily_transaction_details', column: 'zoho_location_id', name: 'idx_zdtd_zoho_loc' }
        ];

        for (const { table, column, name } of indexesToAdd) {
            const [tables] = await pool.query(`
                SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
            `, [table]);
            if (tables.length === 0) { console.log(`  ⏭️  Table ${table} not found`); continue; }

            const [cols] = await pool.query(`
                SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
            `, [table, column]);
            if (cols.length === 0) { console.log(`  ⏭️  ${table}.${column} not found`); continue; }

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

        // ─── 3. Add remaining updated_at columns ─────────────────────
        console.log('\n--- 3. Remaining updated_at columns ---');
        const tablesNeedingUpdatedAt = [
            'daily_task_materials',
            'guide_categories',
            'lead_followups',
            'overtime_requests',
            'painter_sessions',
            'role_permissions',
            'stock_check_items',
            'user_branches',
            'wa_instant_messages',
            'whatsapp_messages',
            'zoho_bulk_job_items'
        ];

        for (const table of tablesNeedingUpdatedAt) {
            const [tables] = await pool.query(`
                SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
            `, [table]);
            if (tables.length === 0) { console.log(`  ⏭️  Table ${table} not found`); continue; }

            const [cols] = await pool.query(`
                SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'updated_at'
            `, [table]);
            if (cols.length > 0) { console.log(`  ⏭️  ${table}.updated_at already exists`); continue; }

            await pool.query(`
                ALTER TABLE \`${table}\`
                ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            `);

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
