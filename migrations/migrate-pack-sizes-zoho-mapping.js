const pool = require('../config/database');

async function migrate() {
    console.log('Starting pack_sizes Zoho mapping migration...');

    const [cols] = await pool.query(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pack_sizes' AND COLUMN_NAME = 'zoho_item_id'"
    );

    if (cols.length === 0) {
        await pool.query("ALTER TABLE pack_sizes ADD COLUMN zoho_item_id VARCHAR(100) NULL AFTER base_price");
        await pool.query("ALTER TABLE pack_sizes ADD INDEX idx_zoho_item (zoho_item_id)");
        console.log('Added zoho_item_id column to pack_sizes');
    } else {
        console.log('zoho_item_id column already exists');
    }

    console.log('Migration complete!');
    process.exit(0);
}

migrate().catch(err => { console.error('Migration failed:', err); process.exit(1); });
