/**
 * Quick-sale backend foundations (B1a).
 *
 * Additive-only and information_schema-guarded (dev MySQL vs prod MariaDB —
 * deliberately NO "IF NOT EXISTS" clauses) so the migration is safe to re-run.
 * Pattern: migrations/20260712_payment_zoho_sync.js.
 *
 *   users.zoho_salesperson_id        — the staff member's own Zoho salesperson
 *                                      (quick-sale push default).
 *   billing_invoices.zoho_push_error — last auto/manual push failure message
 *                                      (NULLed on a later successful push).
 *   billing_invoices.zoho_push_attempted_at — when that failure was stamped;
 *                                      the 15-min retry cron keys on it.
 *
 * ai_config defaults (INSERT-if-absent — never clobbers an operator's value):
 *   billing_auto_push_on_save     '1'  auto-push a quick sale to Zoho on save
 *   billing_staff_push_finalizes  '1'  a staff push finalizes (approves) in
 *                                      Zoho instead of only submitting
 *   billing_default_salesperson_id ''  org-wide fallback salesperson id
 */

async function columnExists(pool, table, column) {
    const [rows] = await pool.query(
        `SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
    );
    return rows.length > 0;
}

async function tableExists(pool, table) {
    const [rows] = await pool.query(
        `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [table]
    );
    return rows.length > 0;
}

async function addColumn(pool, table, column, ddl) {
    if (!(await columnExists(pool, table, column))) {
        await pool.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
        console.log(`  ✓ ${table}.${column} added`);
    }
}

exports.up = async function up(pool) {
    // ── users: the pushing staff member's own Zoho salesperson ──
    if (await tableExists(pool, 'users')) {
        await addColumn(pool, 'users', 'zoho_salesperson_id',
            'zoho_salesperson_id VARCHAR(50) NULL');
        console.log('  ✓ users quick-sale column ensured');
    } else {
        console.log('  [skip] users not present in this DB');
    }

    // ── billing_invoices: failed-push stamp for the retry cron ──
    if (await tableExists(pool, 'billing_invoices')) {
        await addColumn(pool, 'billing_invoices', 'zoho_push_error',
            'zoho_push_error VARCHAR(255) NULL');
        await addColumn(pool, 'billing_invoices', 'zoho_push_attempted_at',
            'zoho_push_attempted_at DATETIME NULL');
        console.log('  ✓ billing_invoices push-retry columns ensured');
    } else {
        console.log('  [skip] billing_invoices not present in this DB');
    }

    // ── ai_config defaults (seed only when absent) ──
    if (await tableExists(pool, 'ai_config')) {
        const defaults = [
            ['billing_auto_push_on_save', '1'],
            ['billing_staff_push_finalizes', '1'],
            ['billing_default_salesperson_id', ''],
        ];
        for (const [key, value] of defaults) {
            const [existing] = await pool.query(
                'SELECT config_key FROM ai_config WHERE config_key = ?', [key]
            );
            if (existing.length === 0) {
                await pool.query(
                    'INSERT INTO ai_config (config_key, config_value) VALUES (?, ?)',
                    [key, value]
                );
                console.log(`  ✓ ai_config ${key} = '${value}' seeded`);
            }
        }
        console.log('  ✓ ai_config quick-sale defaults ensured');
    } else {
        console.log('  [skip] ai_config not present in this DB');
    }

    console.log('  ✓ billing quick-sale foundations ensured');
};

// Direct-run support for prod (the pre-2026-04-30 _migrations gap):
//   node migrations/20260812_billing_quick_sale.js
//   then: INSERT IGNORE INTO _migrations (name) VALUES ('20260812_billing_quick_sale.js');
if (require.main === module) {
    (async () => {
        require('dotenv').config();
        const { createPool } = require('../config/database');
        const pool = createPool();
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
