#!/usr/bin/env node
/**
 * Database Maintenance Script
 * Cleans up old logs, expired tokens, stale sessions, and optimizes tables.
 *
 * Run manually:   node scripts/db-maintenance.js
 * With dry-run:   node scripts/db-maintenance.js --dry-run
 * Specific task:  node scripts/db-maintenance.js --only=errors,tokens
 *
 * Recommended: run weekly via cron or after deployments.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY = (() => {
    const onlyArg = args.find(a => a.startsWith('--only='));
    return onlyArg ? onlyArg.split('=')[1].split(',') : null;
})();

// Retention periods (days)
const RETENTION = {
    error_logs: 30,
    system_health_checks: 14,
    code_quality_metrics: 30,
    ai_analysis_runs: 60,
    share_tokens_expired: 0,    // immediate (already expired)
    painter_sessions_expired: 0, // immediate
    user_sessions_expired: 0,    // immediate
    notifications_read: 90,
    audit_log: 180
};

function shouldRun(taskName) {
    if (!ONLY) return true;
    return ONLY.includes(taskName);
}

async function main() {
    let pool;
    try {
        pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'business_manager',
            port: process.env.DB_PORT || 3306
        });

        console.log(`\n=== Database Maintenance ${DRY_RUN ? '(DRY RUN)' : ''} ===`);
        console.log(`Started: ${new Date().toISOString()}\n`);
        let totalCleaned = 0;

        // Helper: check table exists
        async function tableExists(table) {
            const [rows] = await pool.query(`
                SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
            `, [table]);
            return rows.length > 0;
        }

        // Helper: count + delete with retention
        async function cleanTable(table, dateCol, days, label, extraWhere = '') {
            if (!await tableExists(table)) {
                console.log(`  ⏭️  ${label}: table ${table} not found`);
                return 0;
            }
            const where = `${dateCol} < DATE_SUB(NOW(), INTERVAL ${days} DAY)${extraWhere ? ' AND ' + extraWhere : ''}`;
            const [countResult] = await pool.query(`SELECT COUNT(*) as cnt FROM \`${table}\` WHERE ${where}`);
            const count = countResult[0].cnt;

            if (count === 0) {
                console.log(`  ✅ ${label}: nothing to clean`);
                return 0;
            }

            if (DRY_RUN) {
                console.log(`  🔍 ${label}: would delete ${count} rows`);
            } else {
                // Delete in batches of 5000 to avoid long locks
                let deleted = 0;
                while (deleted < count) {
                    const [result] = await pool.query(
                        `DELETE FROM \`${table}\` WHERE ${where} LIMIT 5000`
                    );
                    deleted += result.affectedRows;
                    if (result.affectedRows === 0) break;
                }
                console.log(`  🗑️  ${label}: deleted ${deleted} rows`);
                return deleted;
            }
            return count;
        }

        // ─── 1. Error Logs ──────────────────────────────────────────
        if (shouldRun('errors')) {
            console.log('--- Error Logs ---');
            totalCleaned += await cleanTable(
                'error_logs', 'created_at', RETENTION.error_logs,
                `Errors older than ${RETENTION.error_logs} days`
            );
        }

        // ─── 2. System Health Checks ────────────────────────────────
        if (shouldRun('health')) {
            console.log('--- System Health Checks ---');
            totalCleaned += await cleanTable(
                'system_health_checks', 'checked_at', RETENTION.system_health_checks,
                `Health checks older than ${RETENTION.system_health_checks} days`
            );
        }

        // ─── 3. Code Quality Metrics ────────────────────────────────
        if (shouldRun('metrics')) {
            console.log('--- Code Quality Metrics ---');
            totalCleaned += await cleanTable(
                'code_quality_metrics', 'created_at', RETENTION.code_quality_metrics,
                `Metrics older than ${RETENTION.code_quality_metrics} days`
            );
        }

        // ─── 4. Expired Share Tokens ────────────────────────────────
        if (shouldRun('tokens')) {
            console.log('--- Expired Share Tokens ---');
            if (await tableExists('share_tokens')) {
                const [countResult] = await pool.query(
                    `SELECT COUNT(*) as cnt FROM share_tokens WHERE expires_at < NOW() AND is_active = 1`
                );
                const count = countResult[0].cnt;

                if (count === 0) {
                    console.log(`  ✅ Expired tokens: nothing to deactivate`);
                } else if (DRY_RUN) {
                    console.log(`  🔍 Expired tokens: would deactivate ${count}`);
                } else {
                    await pool.query(`UPDATE share_tokens SET is_active = 0 WHERE expires_at < NOW() AND is_active = 1`);
                    console.log(`  🗑️  Expired tokens: deactivated ${count}`);
                    totalCleaned += count;
                }

                // Also clean very old inactive tokens (> 90 days)
                totalCleaned += await cleanTable(
                    'share_tokens', 'created_at', 90,
                    'Inactive tokens older than 90 days',
                    'is_active = 0'
                );
            }
        }

        // ─── 5. Expired Sessions ────────────────────────────────────
        if (shouldRun('sessions')) {
            console.log('--- Expired Sessions ---');

            // Painter sessions
            if (await tableExists('painter_sessions')) {
                const [countResult] = await pool.query(
                    `SELECT COUNT(*) as cnt FROM painter_sessions WHERE expires_at < NOW()`
                );
                const count = countResult[0].cnt;
                if (count > 0) {
                    if (DRY_RUN) {
                        console.log(`  🔍 Expired painter sessions: would delete ${count}`);
                    } else {
                        await pool.query(`DELETE FROM painter_sessions WHERE expires_at < NOW()`);
                        console.log(`  🗑️  Expired painter sessions: deleted ${count}`);
                        totalCleaned += count;
                    }
                } else {
                    console.log(`  ✅ Painter sessions: nothing to clean`);
                }
            }

            // User sessions (older than 30 days)
            totalCleaned += await cleanTable(
                'user_sessions', 'created_at', 30,
                'User sessions older than 30 days'
            );
        }

        // ─── 6. Old AI Analysis Runs ────────────────────────────────
        if (shouldRun('ai')) {
            console.log('--- AI Data Cleanup ---');
            totalCleaned += await cleanTable(
                'ai_analysis_runs', 'created_at', RETENTION.ai_analysis_runs,
                `AI runs older than ${RETENTION.ai_analysis_runs} days`
            );

            // Old AI messages (keep last 60 days of conversations)
            totalCleaned += await cleanTable(
                'ai_messages', 'created_at', 60,
                'AI messages older than 60 days'
            );
        }

        // ─── 7. Old Read Notifications ──────────────────────────────
        if (shouldRun('notifications')) {
            console.log('--- Old Notifications ---');
            totalCleaned += await cleanTable(
                'notifications', 'created_at', RETENTION.notifications_read,
                `Read notifications older than ${RETENTION.notifications_read} days`,
                'is_read = 1'
            );
        }

        // ─── 8. Old Audit Logs ──────────────────────────────────────
        if (shouldRun('audit')) {
            console.log('--- Audit Logs ---');
            totalCleaned += await cleanTable(
                'audit_log', 'created_at', RETENTION.audit_log,
                `Audit logs older than ${RETENTION.audit_log} days`
            );
        }

        // ─── 9. Table Stats ─────────────────────────────────────────
        if (shouldRun('stats')) {
            console.log('\n--- Table Size Report ---');
            const [sizes] = await pool.query(`
                SELECT TABLE_NAME as tbl,
                       TABLE_ROWS as rows_est,
                       ROUND(DATA_LENGTH / 1024 / 1024, 2) as data_mb,
                       ROUND(INDEX_LENGTH / 1024 / 1024, 2) as index_mb
                FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA = DATABASE()
                ORDER BY DATA_LENGTH DESC
                LIMIT 15
            `);
            console.log('  Top 15 tables by size:');
            for (const t of sizes) {
                console.log(`  ${t.tbl.padEnd(35)} ${String(t.rows_est).padStart(8)} rows  ${String(t.data_mb).padStart(8)} MB data  ${String(t.index_mb).padStart(8)} MB idx`);
            }
        }

        console.log(`\n=== Maintenance complete! ${DRY_RUN ? 'Would clean' : 'Cleaned'}: ${totalCleaned} rows ===`);
        console.log(`Finished: ${new Date().toISOString()}\n`);

    } catch (error) {
        console.error('Maintenance failed:', error);
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

main();
