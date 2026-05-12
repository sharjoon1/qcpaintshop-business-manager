/**
 * Engineer Program — Phase 2: Custom rates table
 *
 * Mirrors painter_custom_rates: per-engineer discount overrides at
 * item / brand / category scope. Admin sets these so each engineer can
 * see their own effective price in the catalog page.
 *
 * Run with:  node migrations/migrate-engineer-rates.js
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

    console.log('Engineer Program migration — Phase 2 (custom rates)\n');

    console.log('1. Creating engineer_custom_rates table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS engineer_custom_rates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        engineer_id INT NOT NULL,
        scope ENUM('item','brand','category') NOT NULL,
        target_id VARCHAR(150) NOT NULL,
        zoho_item_id VARCHAR(50) DEFAULT NULL,
        discount_pct DECIMAL(5,2) NOT NULL DEFAULT 0.00,
        notes VARCHAR(500) DEFAULT NULL,
        created_by INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (engineer_id) REFERENCES engineers(id) ON DELETE CASCADE,
        INDEX idx_engineer (engineer_id),
        INDEX idx_scope (scope),
        INDEX idx_zoho_item (zoho_item_id),
        UNIQUE KEY uq_engineer_scope_target (engineer_id, scope, target_id)
      )
    `);
    console.log('   ✓ engineer_custom_rates');

    try {
      await pool.query(
        "INSERT IGNORE INTO _migrations (filename, status) VALUES ('migrate-engineer-rates.js', 'success')"
      );
    } catch (_) {}

    console.log('\n✓ Engineer Program Phase 2 schema is ready.\n');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    if (pool) await pool.end();
  }
}

migrate();
