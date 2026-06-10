// painter_custom_rates — individual painter overrides on pricing + regular points.
//
// Scope:
//   - 'item'     → applies to a single SKU (zoho_item_id required)
//   - 'brand'    → applies to every SKU in that brand (target_id = brand name)
//   - 'category' → applies to every SKU in that category (target_id = category name)
//
// Fields:
//   - discount_pct: % off the painter's normal zoho_rate (0 = no discount)
//   - bonus_regular_points: added on top of the painter's base regular_points_per_unit
//
// At least one of discount_pct / bonus_regular_points must be > 0 for the row to matter.
// Item-level overrides win over brand/category (applied in this priority: item > brand > category).
//
// Idempotent.
// Normalized to exports.up(pool) (D2, 2026-06-11) — requiring this file no longer runs it.

exports.up = async function up(pool) {
    await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_custom_rates (
                id INT AUTO_INCREMENT PRIMARY KEY,
                painter_id INT NOT NULL,
                scope ENUM('item','brand','category') NOT NULL,
                target_id VARCHAR(150) NOT NULL,
                zoho_item_id VARCHAR(50) NULL,
                discount_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
                bonus_regular_points DECIMAL(10,2) NOT NULL DEFAULT 0,
                notes VARCHAR(500) NULL,
                created_by INT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_painter_scope_target (painter_id, scope, target_id),
                INDEX idx_painter (painter_id),
                INDEX idx_scope_target (scope, target_id),
                INDEX idx_zoho_item (zoho_item_id),
                FOREIGN KEY (painter_id) REFERENCES painters(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

    console.log('  ✓ painter_custom_rates table ready');
};

// Direct-run support (legacy usage: node migrations/migrate-painter-custom-rates.js)
if (require.main === module) {
    (async () => {
        require('dotenv').config();
        const mysql = require('mysql2/promise');
        const pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'business_manager',
            port: parseInt(process.env.DB_PORT, 10) || 3306
        });
        try {
            await exports.up(pool);
            console.log('Done.');
            process.exit(0);
        } catch (err) {
            console.error('Migration failed:', err.message);
            process.exit(1);
        }
    })();
}
