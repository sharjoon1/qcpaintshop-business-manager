/**
 * Per-staff flag for salary visibility.
 *
 * Default 0 = salary details are hidden from staff. Admin can flip to 1
 * on a per-user basis via PUT /api/salary/visibility/:userId so the
 * individual staff member can view their own payslip/config/payments.
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 3
    });

    try {
        console.log('[migrate-salary-visibility] START');

        const [cols] = await pool.query(
            `SELECT COLUMN_NAME FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'users'
               AND column_name = 'salary_visible_to_staff'`
        );

        if (cols.length === 0) {
            await pool.query(
                `ALTER TABLE users
                 ADD COLUMN salary_visible_to_staff TINYINT(1) NOT NULL DEFAULT 0 AFTER status`
            );
            console.log('✓ users.salary_visible_to_staff added (default 0)');
        } else {
            console.log('· users.salary_visible_to_staff already present');
        }

        console.log('[migrate-salary-visibility] DONE');
    } catch (e) {
        console.error('[migrate-salary-visibility] FAIL', e);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    run().then(() => process.exit(process.exitCode || 0));
}

module.exports = { run };
