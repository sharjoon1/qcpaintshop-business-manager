/**
 * Migration: Expand zoho_items_map with additional Zoho item fields
 * Run: node scripts/migrate-items-expand.js
 *
 * Adds columns for: description, purchase_rate, label_rate, tax_name,
 * tax_percentage, hsn_or_sac, brand, manufacturer, reorder_level,
 * stock_on_hand, category_name, upc, ean, isbn, part_number,
 * cf_product_name, cf_dpl
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 5
    });

    try {
        console.log('Starting zoho_items_map expansion migration...\n');

        // Check table exists
        const [tables] = await pool.query(`SHOW TABLES LIKE 'zoho_items_map'`);
        if (tables.length === 0) {
            console.error('zoho_items_map table does not exist. Run migrate-zoho-tables.js first.');
            process.exit(1);
        }

        // Get existing columns
        const [columns] = await pool.query(`SHOW COLUMNS FROM zoho_items_map`);
        const existingCols = columns.map(c => c.Field);

        const newColumns = [
            { name: 'zoho_description', type: 'TEXT', after: 'zoho_tax_id' },
            { name: 'zoho_purchase_rate', type: 'DECIMAL(12,2)', after: 'zoho_description' },
            { name: 'zoho_label_rate', type: 'DECIMAL(12,2)', after: 'zoho_purchase_rate' },
            { name: 'zoho_tax_name', type: 'VARCHAR(100)', after: 'zoho_label_rate' },
            { name: 'zoho_tax_percentage', type: 'DECIMAL(5,2)', after: 'zoho_tax_name' },
            { name: 'zoho_hsn_or_sac', type: 'VARCHAR(20)', after: 'zoho_tax_percentage' },
            { name: 'zoho_brand', type: 'VARCHAR(100)', after: 'zoho_hsn_or_sac' },
            { name: 'zoho_manufacturer', type: 'VARCHAR(100)', after: 'zoho_brand' },
            { name: 'zoho_reorder_level', type: 'DECIMAL(12,2)', after: 'zoho_manufacturer' },
            { name: 'zoho_stock_on_hand', type: 'DECIMAL(12,2)', after: 'zoho_reorder_level' },
            { name: 'zoho_category_name', type: 'VARCHAR(100)', after: 'zoho_stock_on_hand' },
            { name: 'zoho_upc', type: 'VARCHAR(50)', after: 'zoho_category_name' },
            { name: 'zoho_ean', type: 'VARCHAR(50)', after: 'zoho_upc' },
            { name: 'zoho_isbn', type: 'VARCHAR(50)', after: 'zoho_ean' },
            { name: 'zoho_part_number', type: 'VARCHAR(50)', after: 'zoho_isbn' },
            { name: 'zoho_cf_product_name', type: 'VARCHAR(255)', after: 'zoho_part_number' },
            { name: 'zoho_cf_dpl', type: 'VARCHAR(255)', after: 'zoho_cf_product_name' }
        ];

        let added = 0;
        let skipped = 0;

        for (const col of newColumns) {
            if (existingCols.includes(col.name)) {
                console.log(`   -- ${col.name} already exists, skipping`);
                skipped++;
                continue;
            }

            const sql = `ALTER TABLE zoho_items_map ADD COLUMN ${col.name} ${col.type} NULL AFTER ${col.after}`;
            await pool.query(sql);
            console.log(`   + Added ${col.name} (${col.type})`);
            added++;
        }

        console.log(`\nMigration complete: ${added} columns added, ${skipped} already existed.`);
        console.log('Next: Run a sync to populate the new fields from Zoho.');

    } catch (error) {
        console.error('Migration failed:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

migrate();
