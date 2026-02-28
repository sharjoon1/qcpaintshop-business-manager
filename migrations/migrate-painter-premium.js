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

        console.log('Starting painter premium features migration...');

        // 1. Create painter_visualization_requests table
        const [tables] = await pool.query(
            "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'painter_visualization_requests'"
        );
        if (tables.length === 0) {
            await pool.query(`
                CREATE TABLE painter_visualization_requests (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    painter_id INT NOT NULL,
                    photo_path VARCHAR(500) NOT NULL,
                    brand VARCHAR(100),
                    color_name VARCHAR(100),
                    color_code VARCHAR(50),
                    color_hex VARCHAR(7),
                    notes TEXT,
                    status ENUM('pending','in_progress','completed','rejected') DEFAULT 'pending',
                    visualization_path VARCHAR(500),
                    admin_notes TEXT,
                    processed_by INT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    completed_at TIMESTAMP NULL,
                    INDEX idx_painter (painter_id),
                    INDEX idx_status (status),
                    FOREIGN KEY (painter_id) REFERENCES painters(id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            console.log('Created painter_visualization_requests table');
        } else {
            console.log('painter_visualization_requests table already exists');
        }

        // 2. Add card_generated_at column to painters (for cache invalidation)
        const [cols] = await pool.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'painters' AND COLUMN_NAME = 'card_generated_at'"
        );
        if (cols.length === 0) {
            await pool.query("ALTER TABLE painters ADD COLUMN card_generated_at TIMESTAMP NULL");
            console.log('Added card_generated_at column to painters');
        } else {
            console.log('card_generated_at column already exists');
        }

        console.log('Migration complete!');
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate().catch(err => { console.error('Migration failed:', err); process.exit(1); });
