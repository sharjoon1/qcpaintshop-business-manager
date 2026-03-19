// migrations/migrate-estimate-enhancements.js
// Adds markup, discount, labor, description columns to estimates + estimate_items tables
const mysql = require('mysql2/promise');
require('dotenv').config();

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'business_manager',
        waitForConnections: true,
        connectionLimit: 5
    });

    const conn = await pool.getConnection();
    console.log('Connected to database');

    try {
        // Helper: check if column exists
        async function columnExists(table, column) {
            const [rows] = await conn.query(
                `SELECT COUNT(*) as cnt FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
                [process.env.DB_NAME || 'business_manager', table, column]
            );
            return rows[0].cnt > 0;
        }

        // Helper: check if index exists
        async function indexExists(table, indexName) {
            const [rows] = await conn.query(
                `SELECT COUNT(*) as cnt FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
                [process.env.DB_NAME || 'business_manager', table, indexName]
            );
            return rows[0].cnt > 0;
        }

        // ========== estimates table ==========
        console.log('\n--- Altering estimates table ---');

        const estimateColumns = [
            { name: 'total_markup', sql: 'DECIMAL(12,2) DEFAULT 0 AFTER grand_total' },
            { name: 'total_discount', sql: 'DECIMAL(12,2) DEFAULT 0 AFTER total_markup' },
            { name: 'total_labor', sql: 'DECIMAL(12,2) DEFAULT 0 AFTER total_discount' },
            { name: 'show_description_only', sql: 'TINYINT DEFAULT 0 AFTER notes' },
            { name: 'admin_notes', sql: 'TEXT AFTER notes' },
            { name: 'branch_id', sql: 'INT NULL AFTER created_by' }
        ];

        for (const col of estimateColumns) {
            if (await columnExists('estimates', col.name)) {
                console.log(`  Column estimates.${col.name} already exists, skipping`);
            } else {
                await conn.query(`ALTER TABLE estimates ADD COLUMN ${col.name} ${col.sql}`);
                console.log(`  Added estimates.${col.name}`);
            }
        }

        // Add branch_id index
        if (!(await indexExists('estimates', 'idx_branch'))) {
            await conn.query('ALTER TABLE estimates ADD INDEX idx_branch (branch_id)');
            console.log('  Added index idx_branch');
        }

        // ========== estimate_items table ==========
        console.log('\n--- Altering estimate_items table ---');

        const itemColumns = [
            { name: 'item_type', sql: "ENUM('product','labor') DEFAULT 'product' AFTER estimate_id" },
            { name: 'zoho_item_id', sql: 'VARCHAR(100) NULL AFTER product_id' },
            { name: 'item_name', sql: 'VARCHAR(255) NULL AFTER zoho_item_id' },
            { name: 'brand', sql: 'VARCHAR(100) NULL AFTER item_name' },
            { name: 'category', sql: 'VARCHAR(100) NULL AFTER brand' },
            { name: 'pack_size', sql: 'VARCHAR(50) NULL AFTER category' },
            { name: 'product_type', sql: "ENUM('unit','area') NULL AFTER pack_size" },
            { name: 'custom_description', sql: 'TEXT NULL AFTER product_type' },
            { name: 'show_description_only', sql: 'TINYINT NULL AFTER custom_description' },
            { name: 'num_coats', sql: 'INT DEFAULT 1 AFTER area' },
            { name: 'base_price', sql: 'DECIMAL(12,2) NULL AFTER num_coats' },
            { name: 'markup_type', sql: "ENUM('price_pct','price_value','total_pct','total_value') NULL AFTER base_price" },
            { name: 'markup_value', sql: 'DECIMAL(12,2) DEFAULT 0 AFTER markup_type' },
            { name: 'markup_amount', sql: 'DECIMAL(12,2) DEFAULT 0 AFTER markup_value' },
            { name: 'price_after_markup', sql: 'DECIMAL(12,2) NULL AFTER markup_amount' },
            { name: 'discount_type', sql: "ENUM('price_pct','price_value','total_pct','total_value') NULL AFTER price_after_markup" },
            { name: 'discount_value', sql: 'DECIMAL(12,2) DEFAULT 0 AFTER discount_type' },
            { name: 'discount_amount', sql: 'DECIMAL(12,2) DEFAULT 0 AFTER discount_value' },
            { name: 'final_price', sql: 'DECIMAL(12,2) NULL AFTER discount_amount' },
            { name: 'labor_description', sql: 'VARCHAR(255) NULL AFTER display_order' },
            { name: 'labor_taxable', sql: 'TINYINT DEFAULT 1 AFTER labor_description' }
        ];

        for (const col of itemColumns) {
            if (await columnExists('estimate_items', col.name)) {
                console.log(`  Column estimate_items.${col.name} already exists, skipping`);
            } else {
                await conn.query(`ALTER TABLE estimate_items ADD COLUMN ${col.name} ${col.sql}`);
                console.log(`  Added estimate_items.${col.name}`);
            }
        }

        // Backfill existing rows: base_price = unit_price, final_price = unit_price
        console.log('\n--- Backfilling existing data ---');
        const [updated] = await conn.query(`
            UPDATE estimate_items
            SET base_price = unit_price,
                final_price = unit_price,
                price_after_markup = unit_price
            WHERE base_price IS NULL AND unit_price IS NOT NULL
        `);
        console.log(`  Backfilled ${updated.affectedRows} existing rows`);

        console.log('\n✅ Migration complete!');
    } catch (err) {
        console.error('Migration error:', err);
        throw err;
    } finally {
        conn.release();
        await pool.end();
    }
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
