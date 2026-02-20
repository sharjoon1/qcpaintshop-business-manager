/**
 * Migration: Collections System
 * Creates collection_reminders and payment_promises tables
 * Adds zoho.collections permission
 *
 * Run: node migrations/migrate-collections.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mysql = require('mysql2/promise');

async function migrate() {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 5
    });

    console.log('[Collections Migration] Connected to database');

    // 1. Create collection_reminders table
    console.log('[1/3] Creating collection_reminders table...');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS collection_reminders (
            id INT PRIMARY KEY AUTO_INCREMENT,
            zoho_invoice_id VARCHAR(50) NOT NULL,
            zoho_customer_id VARCHAR(50) NOT NULL,
            customer_name VARCHAR(255),
            phone VARCHAR(50),
            reminder_type ENUM('whatsapp','call','visit','email') DEFAULT 'whatsapp',
            message_content TEXT,
            whatsapp_queue_id INT,
            status ENUM('sent','delivered','read','failed','pending') DEFAULT 'pending',
            sent_at DATETIME,
            sent_by INT,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            KEY idx_cr_customer (zoho_customer_id),
            KEY idx_cr_invoice (zoho_invoice_id),
            FOREIGN KEY (sent_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `);
    console.log('   ✓ collection_reminders created');

    // 2. Create payment_promises table
    console.log('[2/3] Creating payment_promises table...');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS payment_promises (
            id INT PRIMARY KEY AUTO_INCREMENT,
            zoho_invoice_id VARCHAR(50),
            zoho_customer_id VARCHAR(50) NOT NULL,
            customer_name VARCHAR(255),
            promise_date DATE NOT NULL,
            promise_amount DECIMAL(12,2) NOT NULL,
            status ENUM('pending','kept','broken','partial') DEFAULT 'pending',
            actual_payment_date DATE,
            actual_amount DECIMAL(12,2),
            notes TEXT,
            follow_up_date DATE,
            created_by INT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_pp_customer (zoho_customer_id),
            KEY idx_pp_status (status),
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )
    `);
    console.log('   ✓ payment_promises created');

    // 3. Add zoho.collections permission
    console.log('[3/3] Adding zoho.collections permission...');
    await pool.query(`
        INSERT INTO permissions (module, action, display_name, description)
        VALUES ('zoho', 'collections', 'Manage Collections', 'View and manage outstanding invoice collections and payment tracking')
        ON DUPLICATE KEY UPDATE
            display_name = VALUES(display_name),
            description = VALUES(description)
    `);

    // Auto-assign to admin role
    await pool.query(`
        INSERT IGNORE INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
        WHERE r.name = 'admin' AND p.module = 'zoho' AND p.action = 'collections'
    `);
    console.log('   ✓ zoho.collections permission added and assigned to admin');

    console.log('\n[Collections Migration] Complete!');
    await pool.end();
    process.exit(0);
}

migrate().catch(err => {
    console.error('[Collections Migration] FAILED:', err.message);
    process.exit(1);
});
