/**
 * Migration: WhatsApp Contact Groups
 * Creates 2 tables + 2 permissions for contact group management
 *
 * Run: node migrations/migrate-wa-contact-groups.js
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

    console.log('[WA Contact Groups Migration] Connected to database');

    // 1. wa_contact_groups
    console.log('[1/4] Creating wa_contact_groups table...');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS wa_contact_groups (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            description VARCHAR(500),
            color VARCHAR(7) DEFAULT '#6366F1',
            member_count INT DEFAULT 0,
            created_by INT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by) REFERENCES users(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('   ✓ wa_contact_groups created');

    // 2. wa_contact_group_members
    console.log('[2/4] Creating wa_contact_group_members table...');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS wa_contact_group_members (
            id INT AUTO_INCREMENT PRIMARY KEY,
            group_id INT NOT NULL,
            phone VARCHAR(50) NOT NULL,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_group_phone (group_id, phone),
            FOREIGN KEY (group_id) REFERENCES wa_contact_groups(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('   ✓ wa_contact_group_members created');

    // 3. Add whatsapp.contacts permission (view)
    console.log('[3/4] Adding whatsapp.contacts permission...');
    await pool.query(`
        INSERT INTO permissions (module, action, display_name, description)
        VALUES ('whatsapp', 'contacts', 'Manage WhatsApp Contacts', 'View and manage WhatsApp contacts and groups')
        ON DUPLICATE KEY UPDATE
            display_name = VALUES(display_name),
            description = VALUES(description)
    `);
    await pool.query(`
        INSERT IGNORE INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
        WHERE r.name = 'admin' AND p.module = 'whatsapp' AND p.action = 'contacts'
    `);
    console.log('   ✓ whatsapp.contacts permission added');

    // 4. Add whatsapp.contacts_manage permission
    console.log('[4/4] Adding whatsapp.contacts_manage permission...');
    await pool.query(`
        INSERT INTO permissions (module, action, display_name, description)
        VALUES ('whatsapp', 'contacts_manage', 'Manage WhatsApp Contact Groups', 'Create, edit, and delete contact groups')
        ON DUPLICATE KEY UPDATE
            display_name = VALUES(display_name),
            description = VALUES(description)
    `);
    await pool.query(`
        INSERT IGNORE INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
        WHERE r.name = 'admin' AND p.module = 'whatsapp' AND p.action = 'contacts_manage'
    `);
    console.log('   ✓ whatsapp.contacts_manage permission added');

    console.log('\n[WA Contact Groups Migration] Complete!');
    await pool.end();
    process.exit(0);
}

migrate().catch(err => {
    console.error('[WA Contact Groups Migration] FAILED:', err.message);
    process.exit(1);
});
