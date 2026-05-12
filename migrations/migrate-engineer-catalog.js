/**
 * Engineer Program — Phase 3: Global default rates + catalogue visibility
 *
 * Adds two admin-managed tables:
 *   - engineer_default_rates    : "all engineers get X% off [scope]"
 *   - engineer_hidden_items     : Zoho items hidden from the engineer catalogue
 *
 * Per-engineer overrides (engineer_custom_rates) continue to take priority
 * over default rates. Default rates are the fallback applied when no
 * per-engineer rule matches.
 *
 * Run with: node migrations/migrate-engineer-catalog.js
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

    console.log('Engineer Program migration — Phase 3 (catalogue + default rates)\n');

    console.log('1. Creating engineer_default_rates table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS engineer_default_rates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        scope ENUM('item','brand','category') NOT NULL,
        target_id VARCHAR(150) NOT NULL,
        zoho_item_id VARCHAR(50) DEFAULT NULL,
        discount_pct DECIMAL(5,2) NOT NULL DEFAULT 0.00,
        notes VARCHAR(500) DEFAULT NULL,
        created_by INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_scope (scope),
        INDEX idx_zoho_item (zoho_item_id),
        UNIQUE KEY uq_scope_target (scope, target_id)
      )
    `);
    console.log('   ✓ engineer_default_rates');

    console.log('2. Creating engineer_hidden_items table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS engineer_hidden_items (
        zoho_item_id VARCHAR(50) NOT NULL PRIMARY KEY,
        reason VARCHAR(500) DEFAULT NULL,
        created_by INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✓ engineer_hidden_items');

    try {
      await pool.query(
        "INSERT IGNORE INTO _migrations (filename, status) VALUES ('migrate-engineer-catalog.js', 'success')"
      );
    } catch (_) {}

    console.log('\n✓ Engineer Program Phase 3 schema is ready.\n');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    if (pool) await pool.end();
  }
}

migrate();
