// Adds 'saved_direct' status to painter_estimates.status enum.
//
// saved_direct = painter created a customer estimate with own markup but has
// NOT yet sent it to admin for approval. This is the painter's personal record
// of what they quoted a customer. After the customer confirms offline, painter
// can convert it to pending_admin (self-billing or customer-billing path) via
// POST /me/estimates/:id/submit-to-admin.
//
// Idempotent: reads current enum values, adds saved_direct only if missing.

require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        connectionLimit: 2,
    });

    try {
        const [[row]] = await pool.query(
            `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'painter_estimates' AND COLUMN_NAME = 'status'`
        );

        if (!row) {
            console.error('❌ painter_estimates.status column not found');
            process.exitCode = 1;
            return;
        }

        if (row.COLUMN_TYPE.includes("'saved_direct'")) {
            console.log('  ✓ saved_direct already present in status enum');
            return;
        }

        // Current enum is:
        //   enum('draft','pending_admin','admin_review','approved','sent_to_customer',
        //        'discount_requested','final_approved','payment_submitted','payment_recorded',
        //        'pushed_to_zoho','rejected','cancelled')
        // Add 'saved_direct' right after 'draft'.
        await pool.query(`
            ALTER TABLE painter_estimates
            MODIFY COLUMN status ENUM(
                'draft',
                'saved_direct',
                'pending_admin',
                'admin_review',
                'approved',
                'sent_to_customer',
                'discount_requested',
                'final_approved',
                'payment_submitted',
                'payment_recorded',
                'pushed_to_zoho',
                'rejected',
                'cancelled'
            ) DEFAULT 'draft'
        `);
        console.log('  + added saved_direct to painter_estimates.status enum');

        console.log('\n✅ migrate-painter-saved-direct completed');
    } catch (e) {
        console.error('❌ migration failed:', e.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();
