/**
 * Stock Check Assignment System Migration
 *
 * Run: node migrations/migrate-stock-check.js
 *
 * Creates: stock_check_assignments, stock_check_items
 * Admin assigns Zoho products to branch staff for daily physical stock verification.
 */

const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function migrate() {
    let pool;
    try {
        pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'business_manager',
            port: process.env.DB_PORT || 3306
        });

        console.log('Connected to database. Running stock check migration...\n');

        // 1. Create stock_check_assignments table
        console.log('1. Creating stock_check_assignments table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS stock_check_assignments (
                id INT PRIMARY KEY AUTO_INCREMENT,
                branch_id INT NOT NULL,
                staff_id INT NOT NULL,
                check_date DATE NOT NULL,
                status ENUM('pending','submitted','reviewed','adjusted') DEFAULT 'pending',
                show_system_qty TINYINT(1) DEFAULT 0,
                notes TEXT,
                submitted_at DATETIME,
                reviewed_by INT,
                reviewed_at DATETIME,
                adjustment_id VARCHAR(100),
                created_by INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        console.log('   OK');

        // 2. Create stock_check_items table
        console.log('2. Creating stock_check_items table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS stock_check_items (
                id INT PRIMARY KEY AUTO_INCREMENT,
                assignment_id INT NOT NULL,
                zoho_item_id VARCHAR(50) NOT NULL,
                item_name VARCHAR(255),
                item_sku VARCHAR(100),
                system_qty DECIMAL(12,2) DEFAULT 0,
                reported_qty DECIMAL(12,2),
                difference DECIMAL(12,2),
                variance_pct DECIMAL(8,2),
                photo_url VARCHAR(500),
                notes TEXT,
                submitted_at DATETIME,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (assignment_id) REFERENCES stock_check_assignments(id) ON DELETE CASCADE
            )
        `);
        console.log('   OK');

        // 3. Add indexes
        console.log('3. Adding indexes...');
        const indexes = [
            ['idx_sca_branch_date', 'stock_check_assignments', '(branch_id, check_date)'],
            ['idx_sca_staff_date', 'stock_check_assignments', '(staff_id, check_date)'],
            ['idx_sca_status', 'stock_check_assignments', '(status)'],
            ['idx_sci_assignment', 'stock_check_items', '(assignment_id)'],
            ['idx_sci_zoho_item', 'stock_check_items', '(zoho_item_id)']
        ];

        for (const [name, table, cols] of indexes) {
            try {
                await pool.query(`CREATE INDEX ${name} ON ${table} ${cols}`);
                console.log(`   + ${name}`);
            } catch (err) {
                if (err.code === 'ER_DUP_KEYNAME') {
                    console.log(`   SKIP ${name} (already exists)`);
                } else {
                    console.log(`   WARN: ${name} - ${err.message}`);
                }
            }
        }

        // 4. Fix collation to match zoho_location_stock
        console.log('4. Fixing collation on stock_check_items.zoho_item_id...');
        try {
            await pool.query(`ALTER TABLE stock_check_items MODIFY zoho_item_id VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL`);
            console.log('   OK');
        } catch (err) {
            console.log('   SKIP:', err.message);
        }

        // 5. Add zoho_location_id column for per-assignment location selection
        console.log('5. Adding zoho_location_id column to assignments...');
        try {
            await pool.query('ALTER TABLE stock_check_assignments ADD COLUMN zoho_location_id VARCHAR(50) AFTER branch_id');
            console.log('   OK');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME') console.log('   SKIP (already exists)');
            else console.log('   WARN:', err.message);
        }

        // 6. Add permission
        console.log('6. Adding zoho.stock_check permission...');
        const [existingPerm] = await pool.query("SELECT id FROM permissions WHERE module = 'zoho' AND action = 'stock_check'");
        if (existingPerm.length === 0) {
            await pool.query("INSERT INTO permissions (module, action, display_name) VALUES ('zoho', 'stock_check', 'Stock Check Assignments')");
            console.log('   + zoho.stock_check');
        } else {
            console.log('   SKIP (already exists)');
        }

        console.log('\n--- Stock check migration complete! ---');
        console.log('Tables: stock_check_assignments, stock_check_items');
        console.log('Permission: zoho.stock_check');

    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate();
