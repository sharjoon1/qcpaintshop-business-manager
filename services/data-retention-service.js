/**
 * Data Retention Service - daily 03:30 IST purge of stale rows.
 *
 * Audit-driven cleanup so logs/notifications don't grow unbounded:
 *   audit_records      → 90 days
 *   error_logs         → 90 days (resolved only)
 *   staff_activity_feed→ 30 days
 *   notifications      → 60 days (read only)
 *   otp_verifications  → 7 days
 *
 * Failures on individual tables are logged but do not abort the run, so a
 * missing table or schema drift doesn't take the whole purge offline.
 */

const cron = require('node-cron');

const { isClusterPrimary } = require('./cluster-guard');
let pool = null;
let registry = null;
let job = null;

const RETENTION_QUERIES = [
    {
        label: 'audit_records (90d)',
        sql: "DELETE FROM audit_records WHERE ts < DATE_SUB(NOW(), INTERVAL 90 DAY)"
    },
    {
        label: 'error_logs resolved (90d)',
        sql: "DELETE FROM error_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY) AND status = 'resolved'"
    },
    {
        label: 'staff_activity_feed (30d)',
        sql: "DELETE FROM staff_activity_feed WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)"
    },
    {
        label: 'notifications read (60d)',
        sql: "DELETE FROM notifications WHERE created_at < DATE_SUB(NOW(), INTERVAL 60 DAY) AND is_read = 1"
    },
    {
        label: 'otp_verifications (7d)',
        sql: "DELETE FROM otp_verifications WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)"
    }
];

function setPool(p) { pool = p; }
function setAutomationRegistry(r) { registry = r; }

async function runRetentionPurge() {
    if (!pool) {
        console.error('[DataRetention] pool not set, skipping');
        return;
    }
    if (registry) registry.markRunning('data-retention-purge');

    let totalDeleted = 0;
    const summary = [];

    for (const q of RETENTION_QUERIES) {
        try {
            const [result] = await pool.query(q.sql);
            const n = result.affectedRows || 0;
            totalDeleted += n;
            summary.push(`${q.label}: ${n}`);
        } catch (err) {
            // Table may not exist on a given install — log and continue.
            summary.push(`${q.label}: SKIP (${err.code || err.message})`);
        }
    }

    console.log(`[DataRetention] purge complete — ${totalDeleted} rows. ${summary.join(' | ')}`);
    if (registry) registry.markCompleted('data-retention-purge', { recordsProcessed: totalDeleted, details: summary.join(' | ') });
}

function start() {

    if (!isClusterPrimary()) {
        console.log('[data-retention] skipping cron registration — not PM2 cluster primary');
        return;
    }
    if (registry) {
        registry.register('data-retention-purge', {
            name: 'Data Retention Purge',
            service: 'data-retention',
            schedule: '30 3 * * * (IST)',
            description: 'Daily 03:30 IST purge of stale audit_records, error_logs, staff_activity_feed, notifications, otp_verifications'
        });
    }
    job = cron.schedule('30 3 * * *', runRetentionPurge, { timezone: 'Asia/Kolkata' });
    console.log('[DataRetention] cron registered: daily 03:30 IST');
}

function stop() {
    if (job) { job.stop(); job = null; }
}

module.exports = { setPool, setAutomationRegistry, start, stop, runRetentionPurge };
