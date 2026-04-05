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

        console.log('Connected to database. Running painter quotations migration...\n');

        // 1. painter_quotations - Core quotation table
        console.log('1. Creating painter_quotations table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_quotations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                painter_id INT NOT NULL,
                quotation_number VARCHAR(20) NOT NULL,
                quotation_type ENUM('labour_salary','labour_sqft','labour_material_sqft','labour_material_itemized') NOT NULL,
                customer_name VARCHAR(200),
                customer_phone VARCHAR(20),
                customer_address TEXT,
                rooms_data JSON,
                labour_rate DECIMAL(10,2),
                labour_rate_type ENUM('daily','monthly','per_sqft') DEFAULT 'per_sqft',
                material_cost_per_sqft DECIMAL(10,2),
                total_sqft DECIMAL(10,2),
                labour_total DECIMAL(10,2),
                material_total DECIMAL(10,2),
                grand_total DECIMAL(10,2),
                terms_conditions TEXT,
                validity_days INT DEFAULT 15,
                language ENUM('ta','en') DEFAULT 'ta',
                status ENUM('draft','sent','accepted','rejected','expired') DEFAULT 'draft',
                pdf_url VARCHAR(500),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (painter_id) REFERENCES painters(id),
                INDEX idx_painter_status (painter_id, status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ painter_quotations table created');

        // 2. painter_quotation_items - Line items for material-itemized quotations
        console.log('2. Creating painter_quotation_items table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_quotation_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                quotation_id INT NOT NULL,
                zoho_item_id VARCHAR(50),
                item_name VARCHAR(300),
                brand VARCHAR(100),
                quantity DECIMAL(10,2),
                unit_price DECIMAL(10,2),
                line_total DECIMAL(10,2),
                display_order INT DEFAULT 0,
                FOREIGN KEY (quotation_id) REFERENCES painter_quotations(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ painter_quotation_items table created');

        console.log('\n✅ Painter quotations migration completed successfully!');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate();
