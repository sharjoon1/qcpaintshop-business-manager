/**
 * Engineer Program — Phase 1: Core foundation
 *
 * Creates the engineer identity & session tables that mirror the painter
 * pattern (separate auth, separate table, X-Engineer-Token header), plus
 * the permissions rows so admin RBAC can gate the new admin-engineers page.
 *
 * Run with:  node migrations/migrate-engineers.js
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

    console.log('Engineer Program migration — Phase 1\n');

    // 1. engineers — core profile
    console.log('1. Creating engineers table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS engineers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        phone VARCHAR(20) NOT NULL UNIQUE,
        email VARCHAR(255) DEFAULT NULL,
        company_name VARCHAR(255) DEFAULT NULL,
        designation VARCHAR(100) DEFAULT NULL,
        gst_number VARCHAR(20) DEFAULT NULL,
        pan_number VARCHAR(20) DEFAULT NULL,
        address TEXT DEFAULT NULL,
        city VARCHAR(100) DEFAULT NULL,
        district VARCHAR(100) DEFAULT NULL,
        state VARCHAR(100) DEFAULT 'Tamil Nadu',
        pincode VARCHAR(10) DEFAULT NULL,
        branch_id INT DEFAULT NULL,
        profile_photo VARCHAR(500) DEFAULT NULL,
        status ENUM('pending','approved','suspended','rejected') DEFAULT 'pending',
        credit_enabled TINYINT(1) DEFAULT 0,
        credit_limit DECIMAL(12,2) DEFAULT 0,
        credit_used DECIMAL(12,2) DEFAULT 0,
        total_spend DECIMAL(12,2) DEFAULT 0,
        notes TEXT DEFAULT NULL,
        approved_by INT DEFAULT NULL,
        approved_at DATETIME DEFAULT NULL,
        rejected_reason VARCHAR(500) DEFAULT NULL,
        zoho_contact_id VARCHAR(50) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_phone (phone),
        INDEX idx_status (status),
        INDEX idx_branch (branch_id),
        INDEX idx_company (company_name)
      )
    `);
    console.log('   ✓ engineers');

    // 2. engineer_sessions — OTP + session token
    console.log('2. Creating engineer_sessions table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS engineer_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        engineer_id INT NOT NULL,
        token VARCHAR(255) DEFAULT NULL,
        token_hash VARCHAR(64) DEFAULT NULL,
        otp VARCHAR(6) DEFAULT NULL,
        otp_expires_at DATETIME DEFAULT NULL,
        device_info VARCHAR(255) DEFAULT NULL,
        expires_at DATETIME NOT NULL,
        last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (engineer_id) REFERENCES engineers(id) ON DELETE CASCADE,
        INDEX idx_token_hash (token_hash),
        INDEX idx_engineer (engineer_id),
        INDEX idx_expires (expires_at)
      )
    `);
    console.log('   ✓ engineer_sessions');

    // 3. Permissions — register engineers.* so RBAC can gate the admin page
    console.log('3. Registering engineers.* permissions...');
    const perms = [
      ['engineers.view',   'View engineers list and details'],
      ['engineers.manage', 'Create, approve, edit, suspend engineers and set credit limits']
    ];
    for (const [name, description] of perms) {
      await pool.query(
        'INSERT IGNORE INTO permissions (permission_name, description) VALUES (?, ?)',
        [name, description]
      );
    }
    console.log('   ✓ engineers.view, engineers.manage');

    // 4. Grant new permissions to admin / manager roles if those rows exist
    console.log('4. Granting permissions to admin & manager roles...');
    const [perm_rows] = await pool.query(
      "SELECT id, permission_name FROM permissions WHERE permission_name IN ('engineers.view','engineers.manage')"
    );
    const [role_rows] = await pool.query(
      "SELECT id, role_name FROM roles WHERE role_name IN ('admin','manager')"
    );
    let granted = 0;
    for (const role of role_rows) {
      for (const perm of perm_rows) {
        // managers get view-only; admins get both
        if (role.role_name === 'manager' && perm.permission_name === 'engineers.manage') continue;
        const [res] = await pool.query(
          'INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
          [role.id, perm.id]
        );
        if (res.affectedRows) granted++;
      }
    }
    console.log(`   ✓ ${granted} grant rows added`);

    // 5. Mark this migration in the _migrations log if the table exists
    try {
      await pool.query(
        "INSERT IGNORE INTO _migrations (filename, status) VALUES ('migrate-engineers.js', 'success')"
      );
    } catch (_) { /* table may not exist in older envs */ }

    console.log('\n✓ Engineer Program Phase 1 schema is ready.\n');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    if (pool) await pool.end();
  }
}

migrate();
