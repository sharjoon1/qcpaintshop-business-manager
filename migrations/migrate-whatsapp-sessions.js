/**
 * Migration: WhatsApp Sessions + Branch Filtering for Collections
 * Creates whatsapp_sessions table, adds branch_id columns to existing tables,
 * adds zoho.whatsapp_sessions permission
 *
 * Run: node migrations/migrate-whatsapp-sessions.js
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

    console.log('[WhatsApp Sessions Migration] Connected to database');

    // 1. Create whatsapp_sessions table
    console.log('[1/6] Creating whatsapp_sessions table...');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS whatsapp_sessions (
            id INT PRIMARY KEY AUTO_INCREMENT,
            branch_id INT NOT NULL,
            session_name VARCHAR(100),
            status ENUM('disconnected','qr_pending','connecting','connected','failed') DEFAULT 'disconnected',
            phone_number VARCHAR(20),
            connected_at DATETIME,
            disconnected_at DATETIME,
            last_error TEXT,
            created_by INT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY idx_ws_branch (branch_id),
            FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    console.log('   ✓ whatsapp_sessions created');

    // 2. Add branch_id to zoho_customers_map
    console.log('[2/6] Adding branch_id to zoho_customers_map...');
    try {
        await pool.query(`ALTER TABLE zoho_customers_map ADD COLUMN branch_id INT NULL`);
        await pool.query(`ALTER TABLE zoho_customers_map ADD INDEX idx_zcm_branch (branch_id)`);
        console.log('   ✓ zoho_customers_map.branch_id added');
    } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') {
            console.log('   ⊘ zoho_customers_map.branch_id already exists');
        } else throw e;
    }

    // 3. Add branch_id to whatsapp_followups
    console.log('[3/6] Adding branch_id to whatsapp_followups...');
    try {
        await pool.query(`ALTER TABLE whatsapp_followups ADD COLUMN branch_id INT NULL`);
        await pool.query(`ALTER TABLE whatsapp_followups ADD INDEX idx_wf_branch (branch_id)`);
        console.log('   ✓ whatsapp_followups.branch_id added');
    } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') {
            console.log('   ⊘ whatsapp_followups.branch_id already exists');
        } else throw e;
    }

    // 4. Add branch_id to collection_reminders
    console.log('[4/6] Adding branch_id to collection_reminders...');
    try {
        await pool.query(`ALTER TABLE collection_reminders ADD COLUMN branch_id INT NULL`);
        await pool.query(`ALTER TABLE collection_reminders ADD INDEX idx_cr_branch (branch_id)`);
        console.log('   ✓ collection_reminders.branch_id added');
    } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') {
            console.log('   ⊘ collection_reminders.branch_id already exists');
        } else throw e;
    }

    // 5. Add branch_id to payment_promises
    console.log('[5/6] Adding branch_id to payment_promises...');
    try {
        await pool.query(`ALTER TABLE payment_promises ADD COLUMN branch_id INT NULL`);
        await pool.query(`ALTER TABLE payment_promises ADD INDEX idx_pp_branch (branch_id)`);
        console.log('   ✓ payment_promises.branch_id added');
    } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') {
            console.log('   ⊘ payment_promises.branch_id already exists');
        } else throw e;
    }

    // 6. Add zoho.whatsapp_sessions permission
    console.log('[6/6] Adding zoho.whatsapp_sessions permission...');
    await pool.query(`
        INSERT INTO permissions (module, action, display_name, description)
        VALUES ('zoho', 'whatsapp_sessions', 'Manage WhatsApp Sessions', 'Connect and manage per-branch WhatsApp sessions for messaging')
        ON DUPLICATE KEY UPDATE
            display_name = VALUES(display_name),
            description = VALUES(description)
    `);

    // Auto-assign to admin role
    await pool.query(`
        INSERT IGNORE INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
        WHERE r.name = 'admin' AND p.module = 'zoho' AND p.action = 'whatsapp_sessions'
    `);
    console.log('   ✓ zoho.whatsapp_sessions permission added and assigned to admin');

    console.log('\n[WhatsApp Sessions Migration] Complete!');
    await pool.end();
    process.exit(0);
}

migrate().catch(err => {
    console.error('[WhatsApp Sessions Migration] FAILED:', err.message);
    process.exit(1);
});
