/**
 * Migration: Credit Limits on Zoho Customers
 * Moves credit limit management from local `customers` table to `zoho_customers_map`.
 * Uses zoho_outstanding (receivables from Zoho) as the natural "credit used" value.
 *
 * Steps:
 *  1. Add credit_limit columns to zoho_customers_map
 *  2. Add zoho_customer_map_id to customer_credit_history
 *  3. Add zoho_customer_map_id to credit_limit_violations
 *  4. Migrate existing credit limits from customers → zoho_customers_map
 *  5. Backfill zoho_customer_map_id in history/violation records
 *
 * Run: node migrations/migrate-credit-limits-zoho.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'qc_business_manager',
        waitForConnections: true,
        connectionLimit: 5
    });

    console.log('Starting credit limits → Zoho customers migration...\n');

    try {
        // 1. Add credit columns to zoho_customers_map
        console.log('[1/5] Adding credit columns to zoho_customers_map...');
        const [cols1] = await pool.query(`SHOW COLUMNS FROM zoho_customers_map LIKE 'credit_limit'`);
        if (cols1.length === 0) {
            await pool.query(`ALTER TABLE zoho_customers_map
                ADD COLUMN credit_limit DECIMAL(12,2) DEFAULT 0.00,
                ADD COLUMN credit_limit_updated_at DATETIME DEFAULT NULL,
                ADD COLUMN credit_limit_updated_by INT DEFAULT NULL,
                ADD INDEX idx_zcm_credit_limit (credit_limit)`);
            console.log('  -> Added credit_limit, credit_limit_updated_at, credit_limit_updated_by');
        } else {
            console.log('  -> credit_limit column already exists, skipping');
        }

        // 2. Add zoho_customer_map_id to customer_credit_history + fix customer_id default
        console.log('[2/5] Adding zoho_customer_map_id to customer_credit_history...');
        const [cols2] = await pool.query(`SHOW COLUMNS FROM customer_credit_history LIKE 'zoho_customer_map_id'`);
        if (cols2.length === 0) {
            await pool.query(`ALTER TABLE customer_credit_history
                ADD COLUMN zoho_customer_map_id INT DEFAULT NULL AFTER customer_id,
                ADD INDEX idx_cch_zoho (zoho_customer_map_id)`);
            console.log('  -> Added zoho_customer_map_id column');
        } else {
            console.log('  -> zoho_customer_map_id already exists, skipping');
        }
        // Ensure customer_id has a default (inserts now use zoho_customer_map_id only)
        await pool.query(`ALTER TABLE customer_credit_history MODIFY customer_id INT NOT NULL DEFAULT 0`);
        console.log('  -> Ensured customer_id DEFAULT 0');

        // 3. Add zoho_customer_map_id to credit_limit_violations
        console.log('[3/5] Adding zoho_customer_map_id to credit_limit_violations...');
        const [cols3] = await pool.query(`SHOW COLUMNS FROM credit_limit_violations LIKE 'zoho_customer_map_id'`);
        if (cols3.length === 0) {
            await pool.query(`ALTER TABLE credit_limit_violations
                ADD COLUMN zoho_customer_map_id INT DEFAULT NULL AFTER customer_id,
                ADD INDEX idx_clv_zoho (zoho_customer_map_id)`);
            console.log('  -> Added zoho_customer_map_id column');
        } else {
            console.log('  -> zoho_customer_map_id already exists, skipping');
        }

        // 4. Migrate existing credit limits from customers → zoho_customers_map
        console.log('[4/5] Migrating existing credit limits to zoho_customers_map...');
        const [migrated] = await pool.query(`
            UPDATE zoho_customers_map zcm
            INNER JOIN customers c ON zcm.local_customer_id = c.id
            SET zcm.credit_limit = c.credit_limit,
                zcm.credit_limit_updated_at = c.credit_limit_updated_at,
                zcm.credit_limit_updated_by = c.credit_limit_updated_by
            WHERE c.credit_limit > 0
        `);
        console.log(`  -> Migrated credit limits for ${migrated.affectedRows} customers`);

        // 5. Backfill zoho_customer_map_id in existing history/violation records
        console.log('[5/5] Backfilling zoho_customer_map_id in history/violations...');
        const [histUpdated] = await pool.query(`
            UPDATE customer_credit_history h
            INNER JOIN zoho_customers_map zcm ON h.customer_id = zcm.local_customer_id
            SET h.zoho_customer_map_id = zcm.id
            WHERE h.zoho_customer_map_id IS NULL
        `);
        console.log(`  -> Updated ${histUpdated.affectedRows} credit history records`);

        const [violUpdated] = await pool.query(`
            UPDATE credit_limit_violations v
            INNER JOIN zoho_customers_map zcm ON v.customer_id = zcm.local_customer_id
            SET v.zoho_customer_map_id = zcm.id
            WHERE v.zoho_customer_map_id IS NULL
        `);
        console.log(`  -> Updated ${violUpdated.affectedRows} violation records`);

        console.log('\n=== Credit limits Zoho migration completed successfully ===');
    } catch (err) {
        console.error('Migration failed:', err.message);
        throw err;
    } finally {
        await pool.end();
    }
}

migrate().catch(err => {
    console.error(err);
    process.exit(1);
});
