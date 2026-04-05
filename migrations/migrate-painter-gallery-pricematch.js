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

        console.log('Connected to database. Running painter gallery & price match migration...\n');

        // 1. painter_price_reports - Competitor price reports from painters
        console.log('1. Creating painter_price_reports table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_price_reports (
                id INT AUTO_INCREMENT PRIMARY KEY,
                painter_id INT NOT NULL,
                zoho_item_id VARCHAR(50),
                product_name VARCHAR(300),
                our_price DECIMAL(10,2),
                reported_price DECIMAL(10,2),
                shop_name VARCHAR(200),
                shop_location VARCHAR(300),
                proof_photo_url VARCHAR(500),
                note TEXT,
                status ENUM('pending','approved','rejected') DEFAULT 'pending',
                admin_response TEXT,
                matched_price DECIMAL(10,2),
                reviewed_by INT,
                reviewed_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (painter_id) REFERENCES painters(id),
                INDEX idx_painter (painter_id),
                INDEX idx_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ painter_price_reports table created');

        // 2. painter_product_requests - Product requests from painters
        console.log('2. Creating painter_product_requests table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_product_requests (
                id INT AUTO_INCREMENT PRIMARY KEY,
                painter_id INT NOT NULL,
                product_name VARCHAR(300) NOT NULL,
                brand VARCHAR(100),
                size_needed VARCHAR(100),
                note TEXT,
                status ENUM('pending','added','rejected') DEFAULT 'pending',
                added_product_id INT,
                reviewed_by INT,
                reviewed_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (painter_id) REFERENCES painters(id),
                INDEX idx_painter (painter_id),
                INDEX idx_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ painter_product_requests table created');

        // 3. painter_gallery - Work photos portfolio
        console.log('3. Creating painter_gallery table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_gallery (
                id INT AUTO_INCREMENT PRIMARY KEY,
                painter_id INT NOT NULL,
                photo_url VARCHAR(500) NOT NULL,
                category ENUM('interior','exterior','texture','waterproofing','other') DEFAULT 'interior',
                description VARCHAR(500),
                is_before TINYINT(1) DEFAULT 0,
                pair_id INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (painter_id) REFERENCES painters(id),
                INDEX idx_painter (painter_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ painter_gallery table created');

        // 4. painter_calculations - Saved paint calculations
        console.log('4. Creating painter_calculations table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_calculations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                painter_id INT NOT NULL,
                calculation_data JSON NOT NULL,
                total_sqft DECIMAL(10,2),
                total_paint_liters DECIMAL(10,2),
                estimated_cost DECIMAL(10,2),
                converted_to VARCHAR(20),
                converted_id INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (painter_id) REFERENCES painters(id),
                INDEX idx_painter (painter_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ painter_calculations table created');

        console.log('\n✅ Painter gallery & price match migration completed successfully!');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate();
