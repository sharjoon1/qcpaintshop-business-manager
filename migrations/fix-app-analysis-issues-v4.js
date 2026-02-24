/**
 * Fix App Analysis Issues v4
 * Addresses remaining warnings from fourth AI App Analyzer report (Feb 24, 2026)
 *
 * Run: node migrations/fix-app-analysis-issues-v4.js
 *
 * Fixes:
 *   1. Add remaining updated_at columns (6 tables)
 *   2. Drop duplicate index on share_tokens.token
 *   3. Add composite indexes for attendance performance
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

        console.log('=== Fix App Analysis Issues v4 ===\n');
        let changes = 0;

        // ─── 1. Add remaining updated_at columns ───────────────────
        console.log('--- 1. Remaining updated_at columns ---');
        const tablesNeedingUpdatedAt = [
            'code_quality_metrics',
            'estimate_request_activity',
            'estimate_request_photos',
            'estimate_request_products',
            'painter_attendance',
            'task_updates'
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

        // ─── 2. Drop duplicate index on share_tokens ────────────────
        console.log('\n--- 2. Duplicate index cleanup ---');
        const [stTables] = await pool.query(`
            SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'share_tokens'
        `);
        if (stTables.length > 0) {
            // Check how many unique indexes exist on the token column
            const [tokenIndexes] = await pool.query(`
                SELECT INDEX_NAME, NON_UNIQUE FROM INFORMATION_SCHEMA.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'share_tokens' AND COLUMN_NAME = 'token'
                ORDER BY INDEX_NAME
            `);

            if (tokenIndexes.length > 1) {
                // Multiple indexes on token — drop the auto-generated one (usually named 'token')
                // Keep the explicitly named 'uk_token'
                const duplicateIdx = tokenIndexes.find(i => i.INDEX_NAME !== 'uk_token');
                if (duplicateIdx) {
                    await pool.query(`ALTER TABLE share_tokens DROP INDEX \`${duplicateIdx.INDEX_NAME}\``);
                    console.log(`  ✅ Dropped duplicate index '${duplicateIdx.INDEX_NAME}' on share_tokens.token (kept uk_token)`);
                    changes++;
                } else {
                    console.log(`  ⏭️  No duplicate to drop (all named uk_token)`);
                }
            } else {
                console.log(`  ⏭️  share_tokens.token has only ${tokenIndexes.length} index (no duplicate)`);
            }
        } else {
            console.log(`  ⏭️  Table share_tokens not found`);
        }

        // ─── 3. Composite indexes for performance ───────────────────
        console.log('\n--- 3. Composite indexes for performance ---');
        const compositeIndexes = [
            // prayer_periods: frequently queried by (user_id, status)
            { table: 'prayer_periods', columns: ['user_id', 'status'], name: 'idx_pp_user_status' },
            // outside_work_periods: same pattern
            { table: 'outside_work_periods', columns: ['user_id', 'status'], name: 'idx_owp_user_status' },
            // overtime_requests: queried by (attendance_id, status) and (branch_id, status)
            { table: 'overtime_requests', columns: ['attendance_id', 'status'], name: 'idx_otr_attendance_status' },
            { table: 'overtime_requests', columns: ['branch_id', 'status'], name: 'idx_otr_branch_status' },
            // attendance_permissions: queried by (user_id, request_type, status)
            { table: 'attendance_permissions', columns: ['user_id', 'request_type', 'status'], name: 'idx_ap_user_type_status' },
            // leads: queried by (status, branch_id) and (assigned_to, status)
            { table: 'leads', columns: ['status', 'branch_id'], name: 'idx_leads_status_branch' },
            { table: 'leads', columns: ['assigned_to', 'status'], name: 'idx_leads_assigned_status' },
            // whatsapp_messages: queried by (branch_id, created_at) for chat history
            { table: 'whatsapp_messages', columns: ['branch_id', 'created_at'], name: 'idx_wm_branch_created' },
            // error_logs: queried by (created_at) for recent errors
            { table: 'error_logs', columns: ['created_at'], name: 'idx_el_created_at' },
            // ai_analysis_runs: queried by (analysis_type, created_at)
            { table: 'ai_analysis_runs', columns: ['analysis_type', 'created_at'], name: 'idx_aar_type_created' },
            // notifications: queried by (user_id, is_read, created_at)
            { table: 'notifications', columns: ['user_id', 'is_read', 'created_at'], name: 'idx_notif_user_read_created' }
        ];

        for (const { table, columns, name } of compositeIndexes) {
            const [tables] = await pool.query(`
                SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
            `, [table]);
            if (tables.length === 0) { console.log(`  ⏭️  Table ${table} not found`); continue; }

            // Check all columns exist
            let allExist = true;
            for (const col of columns) {
                const [colCheck] = await pool.query(`
                    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
                `, [table, col]);
                if (colCheck.length === 0) {
                    console.log(`  ⏭️  ${table}.${col} not found, skipping ${name}`);
                    allExist = false;
                    break;
                }
            }
            if (!allExist) continue;

            // Check if an index with same name already exists
            const [existingIdx] = await pool.query(`
                SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
            `, [table, name]);
            if (existingIdx.length > 0) {
                console.log(`  ⏭️  ${name} already exists on ${table}`);
                continue;
            }

            // Check if a covering index already exists on same leading columns
            const [existingCovering] = await pool.query(`
                SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) as cols
                FROM INFORMATION_SCHEMA.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
                GROUP BY INDEX_NAME
                HAVING cols LIKE ?
            `, [table, columns.join(',') + '%']);
            if (existingCovering.length > 0) {
                console.log(`  ⏭️  ${table} already has covering index ${existingCovering[0].INDEX_NAME} (${existingCovering[0].cols})`);
                continue;
            }

            const colList = columns.map(c => `\`${c}\``).join(', ');
            await pool.query(`ALTER TABLE \`${table}\` ADD INDEX \`${name}\` (${colList})`);
            console.log(`  ✅ Added ${name} on ${table}(${columns.join(', ')})`);
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
