require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createPool } = require('../config/database');
const pool = createPool();

async function migrate() {
    console.log('=== zoho_invoices salesperson columns ===');
    const alters = [
        "ADD COLUMN IF NOT EXISTS zoho_salesperson_id VARCHAR(50) NULL AFTER zoho_location_id",
        "ADD COLUMN IF NOT EXISTS zoho_salesperson_name VARCHAR(255) NULL AFTER zoho_salesperson_id",
        "ADD INDEX IF NOT EXISTS idx_salesperson (zoho_salesperson_id)"
    ];
    for (const clause of alters) {
        try {
            await pool.query(`ALTER TABLE zoho_invoices ${clause}`);
            console.log('  OK:', clause);
        } catch (e) {
            if (!/Duplicate|exists/i.test(e.message)) throw e;
            console.log('  skip (already applied):', clause);
        }
    }
    console.log('Done.');
    await pool.end();
}
migrate().catch(err => { console.error(err); process.exit(1); });
