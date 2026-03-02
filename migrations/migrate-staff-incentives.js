/**
 * Migration: Staff Incentive System
 * - Creates staff_incentives table to track lead conversion incentives
 * - Adds incentive_amount column to monthly_salaries
 * - Updates gross_salary and net_salary GENERATED columns to include incentive
 * - Adds incentive config keys to ai_config
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

        console.log('=== Staff Incentive System Migration ===\n');

        // 1. Create staff_incentives table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS staff_incentives (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                lead_id INT NULL,
                customer_id INT NULL,
                lead_type ENUM('customer', 'painter', 'engineer') NOT NULL,
                incentive_month VARCHAR(7) NOT NULL COMMENT 'YYYY-MM format',
                amount DECIMAL(10,2) NOT NULL DEFAULT 0,
                status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
                notes TEXT NULL,
                approved_by INT NULL,
                approved_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_user_month (user_id, incentive_month),
                INDEX idx_lead (lead_id),
                INDEX idx_status (status),
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (lead_id) REFERENCES leads(id),
                FOREIGN KEY (approved_by) REFERENCES users(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('Created staff_incentives table');

        // 2. Add incentive_amount column to monthly_salaries (before gross_salary)
        const [col1] = await pool.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'monthly_salaries' AND COLUMN_NAME = 'incentive_amount'"
        );
        if (col1.length === 0) {
            await pool.query("ALTER TABLE monthly_salaries ADD COLUMN incentive_amount DECIMAL(10,2) DEFAULT 0 AFTER total_allowances");
            console.log('Added incentive_amount column to monthly_salaries');
        } else {
            console.log('incentive_amount column already exists');
        }

        // 3. Update gross_salary GENERATED column to include incentive_amount
        try {
            await pool.query(`
                ALTER TABLE monthly_salaries
                MODIFY COLUMN gross_salary DECIMAL(10,2) GENERATED ALWAYS AS (
                    standard_hours_pay + sunday_hours_pay + overtime_pay + total_allowances + incentive_amount
                ) STORED
            `);
            console.log('Updated gross_salary formula to include incentive_amount');
        } catch (err) {
            console.log('gross_salary update skipped (may already include incentive):', err.message);
        }

        // 4. Update net_salary GENERATED column to include incentive_amount
        try {
            await pool.query(`
                ALTER TABLE monthly_salaries
                MODIFY COLUMN net_salary DECIMAL(10,2) GENERATED ALWAYS AS (
                    standard_hours_pay + sunday_hours_pay + overtime_pay + total_allowances + incentive_amount - total_deductions
                ) STORED
            `);
            console.log('Updated net_salary formula to include incentive_amount');
        } catch (err) {
            console.log('net_salary update skipped (may already include incentive):', err.message);
        }

        // 5. Add incentive config keys
        const configKeys = [
            ['incentive_enabled', 'true'],
            ['incentive_per_conversion', '500'],
            ['incentive_auto_approve', 'false']
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

        // Verify
        const [cols] = await pool.query(
            "SELECT COLUMN_NAME, COLUMN_TYPE, GENERATION_EXPRESSION FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'monthly_salaries' AND COLUMN_NAME IN ('incentive_amount', 'gross_salary', 'net_salary') ORDER BY ORDINAL_POSITION"
        );
        console.log('\nVerification:');
        cols.forEach(c => console.log(`  ${c.COLUMN_NAME} (${c.COLUMN_TYPE}) ${c.GENERATION_EXPRESSION ? '= ' + c.GENERATION_EXPRESSION : ''}`));

        const [tbl] = await pool.query("SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_incentives'");
        console.log(`  staff_incentives table: ${tbl[0].cnt > 0 ? 'EXISTS' : 'MISSING'}`);

        console.log('\n=== Migration Complete ===');
    } catch (err) {
        console.error('Migration error:', err);
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate();
