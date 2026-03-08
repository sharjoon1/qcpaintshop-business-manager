/**
 * Migration: Add branch/location columns to zoho_invoices
 * Enables per-branch invoice filtering for staff collections page.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    console.log('Starting invoice branch migration...');

    // Add columns
    const columns = [
        { name: 'zoho_location_id', sql: 'ALTER TABLE zoho_invoices ADD COLUMN zoho_location_id VARCHAR(50) NULL AFTER customer_name' },
        { name: 'local_branch_id', sql: 'ALTER TABLE zoho_invoices ADD COLUMN local_branch_id INT NULL AFTER zoho_location_id' }
    ];

    for (const col of columns) {
        try {
            await pool.query(col.sql);
            console.log(`Added ${col.name} column`);
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log(`${col.name} column already exists`);
            } else {
                throw e;
            }
        }
    }

    // Add index for branch filtering
    try {
        await pool.query('ALTER TABLE zoho_invoices ADD INDEX idx_local_branch_id (local_branch_id)');
        console.log('Added index on local_branch_id');
    } catch (e) {
        if (e.code === 'ER_DUP_KEYNAME') {
            console.log('Index already exists');
        } else {
            throw e;
        }
    }

    console.log('Invoice branch migration complete!');
    await pool.end();
}

migrate().catch(e => { console.error('Migration failed:', e); process.exit(1); });
