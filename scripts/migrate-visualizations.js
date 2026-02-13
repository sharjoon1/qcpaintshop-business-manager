/**
 * Migration: Create design_visualizations table
 * Run: node scripts/migrate-visualizations.js
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
        console.log('Starting design visualizations migration...\n');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS design_visualizations (
                id INT PRIMARY KEY AUTO_INCREMENT,
                design_request_id INT NOT NULL,
                brand VARCHAR(50) NOT NULL,
                color_code VARCHAR(20) NOT NULL,
                color_name VARCHAR(100) NOT NULL,
                color_hex VARCHAR(7) NOT NULL,
                visualization_path VARCHAR(255) NOT NULL,
                created_by INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_design_request (design_request_id),
                INDEX idx_brand_color (brand, color_code),
                FOREIGN KEY (design_request_id) REFERENCES color_design_requests(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('design_visualizations table created');

        const [cols] = await pool.query('DESCRIBE design_visualizations');
        console.log(`\nMigration complete: ${cols.length} columns created`);
        cols.forEach(c => console.log(`   - ${c.Field} (${c.Type})`));

    } catch (error) {
        console.error('Migration failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

migrate();
