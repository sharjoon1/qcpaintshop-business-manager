/**
 * Migration: Create color_design_requests table
 * Run: node scripts/migrate-design-requests.js
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
        console.log('Starting color design requests migration...\n');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS color_design_requests (
                id INT PRIMARY KEY AUTO_INCREMENT,
                request_number VARCHAR(20) UNIQUE NOT NULL,
                name VARCHAR(100) NOT NULL,
                mobile VARCHAR(15) NOT NULL,
                city VARCHAR(100),
                photo_path VARCHAR(255),
                status ENUM('new','in_progress','completed','rejected') DEFAULT 'new',
                admin_notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_status (status),
                INDEX idx_mobile (mobile),
                INDEX idx_created (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ color_design_requests table created');

        // Verify
        const [cols] = await pool.query('DESCRIBE color_design_requests');
        console.log(`\n📊 Migration complete: ${cols.length} columns created`);
        cols.forEach(c => console.log(`   - ${c.Field} (${c.Type})`));

    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

migrate();
