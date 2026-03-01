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

        console.log('=== Salary Leave Deduction Migration ===\n');

        // 1. Add leave_deduction column after absence_deduction
        const [col1] = await pool.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'monthly_salaries' AND COLUMN_NAME = 'leave_deduction'"
        );
        if (col1.length === 0) {
            await pool.query("ALTER TABLE monthly_salaries ADD COLUMN leave_deduction DECIMAL(10,2) DEFAULT 0 AFTER absence_deduction");
            console.log('Added leave_deduction column to monthly_salaries');
        } else {
            console.log('leave_deduction column already exists');
        }

        // 2. Add paid_sunday_leaves column after total_leaves
        const [col2] = await pool.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'monthly_salaries' AND COLUMN_NAME = 'paid_sunday_leaves'"
        );
        if (col2.length === 0) {
            await pool.query("ALTER TABLE monthly_salaries ADD COLUMN paid_sunday_leaves INT DEFAULT 0 AFTER total_leaves");
            console.log('Added paid_sunday_leaves column to monthly_salaries');
        } else {
            console.log('paid_sunday_leaves column already exists');
        }

        // 3. Add paid_weekday_leaves column after paid_sunday_leaves
        const [col3] = await pool.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'monthly_salaries' AND COLUMN_NAME = 'paid_weekday_leaves'"
        );
        if (col3.length === 0) {
            await pool.query("ALTER TABLE monthly_salaries ADD COLUMN paid_weekday_leaves INT DEFAULT 0 AFTER paid_sunday_leaves");
            console.log('Added paid_weekday_leaves column to monthly_salaries');
        } else {
            console.log('paid_weekday_leaves column already exists');
        }

        // 4. Add excess_leaves column after paid_weekday_leaves
        const [col4] = await pool.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'monthly_salaries' AND COLUMN_NAME = 'excess_leaves'"
        );
        if (col4.length === 0) {
            await pool.query("ALTER TABLE monthly_salaries ADD COLUMN excess_leaves INT DEFAULT 0 AFTER paid_weekday_leaves");
            console.log('Added excess_leaves column to monthly_salaries');
        } else {
            console.log('excess_leaves column already exists');
        }

        // Verify
        const [cols] = await pool.query(
            "SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'monthly_salaries' AND COLUMN_NAME IN ('leave_deduction', 'paid_sunday_leaves', 'paid_weekday_leaves', 'excess_leaves') ORDER BY ORDINAL_POSITION"
        );
        console.log(`\nVerified: ${cols.length}/4 columns present`);
        cols.forEach(c => console.log(`  ${c.COLUMN_NAME} (${c.COLUMN_TYPE}, default: ${c.COLUMN_DEFAULT})`));

        console.log('\n=== Migration Complete ===');
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate().catch(err => { console.error('Migration failed:', err); process.exit(1); });
