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

        console.log('Fixing app analysis issues...\n');

        // ─── 1. Fix user role enum to include manager and accountant ───
        console.log('--- 1. User role enum ---');
        const [roleCol] = await pool.query(`
            SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'
        `);
        if (roleCol.length > 0) {
            const currentType = roleCol[0].COLUMN_TYPE;
            if (!currentType.includes('manager')) {
                await pool.query(`
                    ALTER TABLE users MODIFY COLUMN role
                    ENUM('admin','manager','accountant','staff','customer','guest') DEFAULT 'guest'
                `);
                console.log(`✅ users.role enum updated (was: ${currentType})`);
            } else {
                console.log(`⏭️  users.role already includes manager: ${currentType}`);
            }
        }

        // ─── 2. Add missing FK indexes ───
        console.log('\n--- 2. Missing FK indexes ---');
        const indexesToAdd = [
            { table: 'attendance_daily_reports', column: 'branch_id', name: 'idx_adr_branch' },
            { table: 'collection_reminders', column: 'whatsapp_queue_id', name: 'idx_cr_wa_queue' },
            { table: 'customers', column: 'customer_type_id', name: 'idx_cust_type' },
            { table: 'customers', column: 'lead_id', name: 'idx_cust_lead' },
            { table: 'estimates', column: 'converted_invoice_id', name: 'idx_est_conv_inv' },
            { table: 'staff_attendance', column: 'ot_request_id', name: 'idx_sa_ot_req' },
            { table: 'staff_attendance', column: 'late_permission_id', name: 'idx_sa_late_perm' },
            { table: 'staff_attendance', column: 'early_checkout_permission_id', name: 'idx_sa_early_perm' },
            { table: 'zoho_items_map', column: 'zoho_tax_id', name: 'idx_zim_tax' },
            { table: 'zoho_payments', column: 'zoho_customer_id', name: 'idx_zp_customer' }
        ];

        for (const { table, column, name } of indexesToAdd) {
            // Check table exists
            const [tables] = await pool.query(`
                SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
            `, [table]);
            if (tables.length === 0) {
                console.log(`⏭️  Table ${table} does not exist, skipping`);
                continue;
            }

            // Check column exists
            const [cols] = await pool.query(`
                SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
            `, [table, column]);
            if (cols.length === 0) {
                console.log(`⏭️  ${table}.${column} does not exist, skipping`);
                continue;
            }

            // Check if index already exists on this column
            const [existing] = await pool.query(`
                SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
            `, [table, column]);
            if (existing.length > 0) {
                console.log(`⏭️  ${table}.${column} already indexed (${existing[0].INDEX_NAME})`);
                continue;
            }

            await pool.query(`ALTER TABLE \`${table}\` ADD INDEX \`${name}\` (\`${column}\`)`);
            console.log(`✅ Added index ${name} on ${table}.${column}`);
        }

        // ─── 3. Add missing updated_at columns ───
        console.log('\n--- 3. Missing updated_at columns ---');
        const tablesNeedingUpdatedAt = [
            'ai_messages',
            'attendance_daily_reports',
            'chat_messages',
            'collection_reminders',
            'error_logs',
            'geofence_violations',
            'guide_views',
            'notifications',
            'outside_work_periods',
            'prayer_periods',
            'push_subscriptions',
            'staff_activities',
            'whatsapp_followups'
        ];

        for (const table of tablesNeedingUpdatedAt) {
            const [tables] = await pool.query(`
                SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
            `, [table]);
            if (tables.length === 0) {
                console.log(`⏭️  Table ${table} does not exist, skipping`);
                continue;
            }

            const [cols] = await pool.query(`
                SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'updated_at'
            `, [table]);
            if (cols.length > 0) {
                console.log(`⏭️  ${table}.updated_at already exists`);
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

            console.log(`✅ ${table}.updated_at added`);
        }

        console.log('\n✅ All fixes applied!');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate();
