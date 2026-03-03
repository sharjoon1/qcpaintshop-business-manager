/**
 * Migration: Add discount flow columns + new status values to painter_estimates
 * Run: node migrations/migrate-estimate-discount.js
 */
require('dotenv').config();
const { createPool } = require('../config/database');

async function migrate() {
    const pool = createPool();
    try {
        console.log('=== Painter Estimate Discount Flow Migration ===\n');

        // 1. Add discount columns
        console.log('1. Adding discount columns to painter_estimates...');
        const cols = [
            "ADD COLUMN discount_percentage DECIMAL(5,2) DEFAULT NULL AFTER markup_grand_total",
            "ADD COLUMN discount_amount DECIMAL(10,2) DEFAULT NULL AFTER discount_percentage",
            "ADD COLUMN final_grand_total DECIMAL(10,2) DEFAULT NULL AFTER discount_amount",
            "ADD COLUMN discount_requested_at TIMESTAMP NULL AFTER final_grand_total",
            "ADD COLUMN discount_notes TEXT NULL AFTER discount_requested_at",
            "ADD COLUMN discount_approved_by INT NULL AFTER discount_notes",
            "ADD COLUMN discount_approved_at TIMESTAMP NULL AFTER discount_approved_by"
        ];

        for (const col of cols) {
            try {
                await pool.query(`ALTER TABLE painter_estimates ${col}`);
                const name = col.match(/COLUMN (\w+)/)[1];
                console.log(`   Added: ${name}`);
            } catch (e) {
                if (e.code === 'ER_DUP_FIELDNAME') {
                    const name = col.match(/COLUMN (\w+)/)[1];
                    console.log(`   Exists: ${name}`);
                } else throw e;
            }
        }

        // 2. Expand status ENUM to include discount_requested and final_approved
        console.log('\n2. Expanding status ENUM...');
        await pool.query(`
            ALTER TABLE painter_estimates MODIFY COLUMN status
            ENUM('draft','pending_admin','admin_review','approved','sent_to_customer',
                 'discount_requested','final_approved','payment_recorded','pushed_to_zoho',
                 'rejected','cancelled') NOT NULL DEFAULT 'draft'
        `);
        console.log('   Status ENUM expanded with: discount_requested, final_approved');

        console.log('\n=== Migration complete! ===');
    } catch (e) {
        console.error('Migration failed:', e.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

migrate();
