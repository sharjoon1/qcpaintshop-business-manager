/**
 * Migration: Phase 3 Sales & Estimates — Zoho push fields
 * Adds Zoho estimate sync columns to estimates table.
 * Estimates remains BM master; Zoho is read-only draft mirror after admin approve.
 */
exports.up = async (pool) => {
  const cols = [
    ["zoho_estimate_id", "VARCHAR(100) NULL"],
    ["zoho_contact_id", "VARCHAR(100) NULL"],
    ["zoho_status", "ENUM('not_pushed','draft','sent','accepted','declined','invoiced') NOT NULL DEFAULT 'not_pushed'"],
    ["zoho_response", "TEXT NULL"],
    ["pushed_at", "DATETIME NULL"],
    ["discount_amount", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["transport_charge", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["labour_charge", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
  ];
  for (const [name, ddl] of cols) {
    const [exists] = await pool.query(
      `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'estimates' AND COLUMN_NAME = ?`,
      [name]
    );
    if (!exists.length) {
      await pool.query(`ALTER TABLE estimates ADD COLUMN ${name} ${ddl}`);
      console.log(`✓ estimates.${name} added`);
    } else {
      console.log(`· estimates.${name} already exists`);
    }
  }
};
