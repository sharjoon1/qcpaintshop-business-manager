// migrations/migrate-painter-lead-incentive.js
require('dotenv').config();
const { createPool } = require('../config/database');

async function run() {
    const pool = createPool();
    try {
        await pool.query(`
            ALTER TABLE staff_incentives
            MODIFY COLUMN source ENUM('auto_estimate','manual_request','admin_added','painter_convert')
            DEFAULT 'admin_added'
        `);
        console.log('✓ staff_incentives.source ENUM updated — painter_convert added');
    } finally {
        await pool.end();
    }
}
run().catch(err => { console.error(err); process.exit(1); });
