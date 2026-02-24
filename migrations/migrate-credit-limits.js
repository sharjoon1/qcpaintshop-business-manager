/**
 * Migration: Customer Credit Limit Management
 * Adds credit_limit, credit_used columns to customers table
 * Creates customer_credit_history and credit_limit_violations tables
 *
 * Run: node migrations/migrate-credit-limits.js
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

    console.log('Starting credit limit migration...');

    try {
        // 1. Add credit columns to customers table
        console.log('[1/3] Adding credit columns to customers...');
        const [cols] = await pool.query(`SHOW COLUMNS FROM customers LIKE 'credit_limit'`);
        if (cols.length === 0) {
            await pool.query(`ALTER TABLE customers
                ADD COLUMN credit_limit DECIMAL(12,2) DEFAULT 0.00 COMMENT 'Maximum credit allowed',
                ADD COLUMN credit_used DECIMAL(12,2) DEFAULT 0.00 COMMENT 'Currently used credit (outstanding balance)',
                ADD COLUMN credit_limit_updated_at DATETIME DEFAULT NULL,
                ADD COLUMN credit_limit_updated_by INT DEFAULT NULL,
                ADD INDEX idx_credit_limit (credit_limit),
                ADD INDEX idx_credit_used (credit_used)`);
            console.log('  -> Added credit_limit, credit_used, credit_limit_updated_at, credit_limit_updated_by');
        } else {
            console.log('  -> credit_limit column already exists, skipping');
        }

        // 2. Create customer_credit_history table
        console.log('[2/3] Creating customer_credit_history table...');
        await pool.query(`CREATE TABLE IF NOT EXISTS customer_credit_history (
            id INT PRIMARY KEY AUTO_INCREMENT,
            customer_id INT NOT NULL,
            previous_limit DECIMAL(12,2) DEFAULT 0.00,
            new_limit DECIMAL(12,2) NOT NULL,
            changed_by INT NOT NULL,
            reason VARCHAR(500),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_customer (customer_id),
            INDEX idx_date (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
        console.log('  -> customer_credit_history table ready');

        // 3. Create credit_limit_violations table
        console.log('[3/3] Creating credit_limit_violations table...');
        await pool.query(`CREATE TABLE IF NOT EXISTS credit_limit_violations (
            id INT PRIMARY KEY AUTO_INCREMENT,
            customer_id INT NOT NULL,
            invoice_number VARCHAR(100),
            attempted_amount DECIMAL(12,2) NOT NULL,
            credit_limit DECIMAL(12,2) NOT NULL,
            credit_used DECIMAL(12,2) NOT NULL,
            available_credit DECIMAL(12,2) NOT NULL,
            staff_id INT,
            branch_id INT,
            action_taken VARCHAR(50) DEFAULT 'blocked',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_customer (customer_id),
            INDEX idx_date (created_at),
            INDEX idx_staff (staff_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
        console.log('  -> credit_limit_violations table ready');

        // 4. Initial credit_used calculation from existing outstanding invoices
        console.log('\n[Sync] Calculating initial credit_used from outstanding invoices...');
        const [updated] = await pool.query(`
            UPDATE customers c
            LEFT JOIN (
                SELECT local_customer_id, COALESCE(SUM(balance), 0) as outstanding
                FROM zoho_invoices
                WHERE status IN ('sent', 'overdue', 'partially_paid') AND balance > 0
                GROUP BY local_customer_id
            ) inv ON c.id = inv.local_customer_id
            SET c.credit_used = COALESCE(inv.outstanding, 0)
        `);
        console.log(`  -> Updated credit_used for ${updated.affectedRows} customers`);

        console.log('\n=== Credit limit migration completed successfully ===');
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
