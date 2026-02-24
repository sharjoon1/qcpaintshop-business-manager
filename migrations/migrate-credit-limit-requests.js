/**
 * Migration: Credit Limit Requests table
 * Enables staff-to-admin credit limit request workflow
 */
const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 5
    });

    console.log('=== Credit Limit Requests Migration ===\n');

    try {
        // Create credit_limit_requests table
        console.log('Creating credit_limit_requests table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS credit_limit_requests (
                id INT AUTO_INCREMENT PRIMARY KEY,
                branch_id INT NOT NULL,
                requested_by INT NOT NULL,
                zoho_customer_map_id INT NOT NULL,
                customer_name VARCHAR(255),
                requested_amount DECIMAL(12,2) NOT NULL,
                reason TEXT,
                status ENUM('pending','approved','rejected') DEFAULT 'pending',
                approved_amount DECIMAL(12,2) DEFAULT NULL,
                reviewed_by INT DEFAULT NULL,
                reviewed_at DATETIME DEFAULT NULL,
                review_notes TEXT DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_status (status),
                INDEX idx_branch (branch_id),
                INDEX idx_customer (zoho_customer_map_id),
                INDEX idx_requested_by (requested_by)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('  credit_limit_requests table created');

        // Verify
        const [cols] = await pool.query('DESCRIBE credit_limit_requests');
        console.log(`  Verified: ${cols.length} columns`);

        console.log('\n=== Migration Complete ===');
    } catch (error) {
        console.error('Migration error:', error.message);
    } finally {
        await pool.end();
    }
}

migrate();
