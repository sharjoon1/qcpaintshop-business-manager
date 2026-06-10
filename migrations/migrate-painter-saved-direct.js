// Adds 'saved_direct' status to painter_estimates.status enum.
//
// saved_direct = painter created a customer estimate with own markup but has
// NOT yet sent it to admin for approval. This is the painter's personal record
// of what they quoted a customer. After the customer confirms offline, painter
// can convert it to pending_admin (self-billing or customer-billing path) via
// POST /me/estimates/:id/submit-to-admin.
//
// Idempotent: reads current enum values, adds saved_direct only if missing.
//
// Normalized to exports.up(pool) (D2, 2026-06-11) — requiring this file no longer runs it.

exports.up = async function up(pool) {
    const [[row]] = await pool.query(
        `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'painter_estimates' AND COLUMN_NAME = 'status'`
    );

    if (!row) {
        console.error('❌ painter_estimates.status column not found');
        throw new Error('painter_estimates.status column not found');
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
};

// Direct-run support (legacy usage: node migrations/migrate-painter-saved-direct.js)
if (require.main === module) {
    (async () => {
        require('dotenv').config();
        const mysql = require('mysql2/promise');
        const pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'business_manager',
            port: parseInt(process.env.DB_PORT, 10) || 3306
        });
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
