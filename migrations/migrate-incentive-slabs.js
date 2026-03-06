/**
 * Migration: Incentive Slab System + Re-engagement
 * - Creates incentive_slabs table for amount-based incentive tiers
 * - Adds estimate_id, estimate_amount, source, invoice_reference columns to staff_incentives
 * - Adds re_engaged_at, re_engage_count columns to leads
 * - Adds new ai_config keys for slab + re-engagement settings
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

        console.log('=== Incentive Slab System + Re-engagement Migration ===\n');

        // 1. Create incentive_slabs table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS incentive_slabs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                min_amount DECIMAL(12,2) NOT NULL,
                max_amount DECIMAL(12,2) NOT NULL,
                incentive_amount DECIMAL(10,2) NOT NULL,
                is_active TINYINT(1) DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_active_range (is_active, min_amount, max_amount)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('Created incentive_slabs table');

        // Insert default slabs
        const [existingSlabs] = await pool.query('SELECT COUNT(*) as cnt FROM incentive_slabs');
        if (existingSlabs[0].cnt === 0) {
            await pool.query(`
                INSERT INTO incentive_slabs (min_amount, max_amount, incentive_amount) VALUES
                (10000, 30000, 200),
                (30001, 60000, 400),
                (60001, 999999, 600)
            `);
            console.log('Inserted default incentive slabs');
        } else {
            console.log('Incentive slabs already exist, skipping defaults');
        }

        // 2. Add new columns to staff_incentives
        const columnsToAdd = [
            { name: 'estimate_id', sql: "ADD COLUMN estimate_id INT NULL AFTER customer_id" },
            { name: 'estimate_amount', sql: "ADD COLUMN estimate_amount DECIMAL(12,2) NULL AFTER estimate_id" },
            { name: 'source', sql: "ADD COLUMN source ENUM('auto_estimate','manual_request','admin_added') DEFAULT 'admin_added' AFTER estimate_amount" },
            { name: 'invoice_reference', sql: "ADD COLUMN invoice_reference VARCHAR(100) NULL AFTER source" }
        ];

        for (const col of columnsToAdd) {
            const [exists] = await pool.query(
                "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_incentives' AND COLUMN_NAME = ?",
                [col.name]
            );
            if (exists.length === 0) {
                await pool.query(`ALTER TABLE staff_incentives ${col.sql}`);
                console.log(`Added column: staff_incentives.${col.name}`);
            } else {
                console.log(`Column staff_incentives.${col.name} already exists`);
            }
        }

        // 3. Add re-engagement columns to leads
        const leadColumns = [
            { name: 're_engaged_at', sql: "ADD COLUMN re_engaged_at DATETIME NULL" },
            { name: 're_engage_count', sql: "ADD COLUMN re_engage_count INT DEFAULT 0" }
        ];

        for (const col of leadColumns) {
            const [exists] = await pool.query(
                "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leads' AND COLUMN_NAME = ?",
                [col.name]
            );
            if (exists.length === 0) {
                await pool.query(`ALTER TABLE leads ${col.sql}`);
                console.log(`Added column: leads.${col.name}`);
            } else {
                console.log(`Column leads.${col.name} already exists`);
            }
        }

        // 4. Add ai_config keys
        const configKeys = [
            ['incentive_slab_enabled', 'true'],
            ['incentive_reengagement_days', '90']
        ];

        for (const [key, value] of configKeys) {
            const [existing] = await pool.query(
                'SELECT config_key FROM ai_config WHERE config_key = ?', [key]
            );
            if (existing.length === 0) {
                await pool.query(
                    'INSERT INTO ai_config (config_key, config_value) VALUES (?, ?)',
                    [key, value]
                );
                console.log(`Added config: ${key} = ${value}`);
            } else {
                console.log(`Config ${key} already exists`);
            }
        }

        // 5. Verify
        console.log('\n--- Verification ---');
        const [slabs] = await pool.query('SELECT * FROM incentive_slabs ORDER BY min_amount');
        console.log(`Incentive slabs: ${slabs.length} rows`);
        slabs.forEach(s => console.log(`  ${s.min_amount}-${s.max_amount} => ₹${s.incentive_amount} (active: ${s.is_active})`));

        const [siCols] = await pool.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_incentives' AND COLUMN_NAME IN ('estimate_id','estimate_amount','source','invoice_reference')"
        );
        console.log(`staff_incentives new columns: ${siCols.map(c => c.COLUMN_NAME).join(', ')}`);

        const [leadCols] = await pool.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leads' AND COLUMN_NAME IN ('re_engaged_at','re_engage_count')"
        );
        console.log(`leads new columns: ${leadCols.map(c => c.COLUMN_NAME).join(', ')}`);

        console.log('\n=== Migration Complete ===');
    } catch (err) {
        console.error('Migration error:', err);
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate();
