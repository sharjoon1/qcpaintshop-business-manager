require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/database').createPool();

async function migrate() {
    console.log('=== Item Master Migration ===');

    await pool.query(`
        CREATE TABLE IF NOT EXISTS item_naming_rules (
            id INT PRIMARY KEY AUTO_INCREMENT,
            brand VARCHAR(100) NOT NULL,
            category VARCHAR(100) NOT NULL,
            category_code VARCHAR(5) NOT NULL,
            product_name VARCHAR(255) NOT NULL,
            product_short VARCHAR(10) NOT NULL,
            has_base BOOLEAN DEFAULT false,
            has_color BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY unique_brand_product (brand, product_name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('Created table: item_naming_rules');

    await pool.query(`
        CREATE TABLE IF NOT EXISTS dpl_versions (
            id INT PRIMARY KEY AUTO_INCREMENT,
            brand VARCHAR(100) NOT NULL,
            version_label VARCHAR(50),
            effective_date DATE NOT NULL,
            pdf_path VARCHAR(500),
            notebooklm_notebook_id VARCHAR(100),
            total_items INT DEFAULT 0,
            matched_items INT DEFAULT 0,
            status ENUM('draft','active','archived') DEFAULT 'draft',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_brand (brand),
            INDEX idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('Created table: dpl_versions');

    await pool.query(`
        CREATE TABLE IF NOT EXISTS dpl_price_history (
            id INT PRIMARY KEY AUTO_INCREMENT,
            zoho_item_id VARCHAR(100) NOT NULL,
            dpl_version_id INT,
            old_dpl DECIMAL(10,2),
            new_dpl DECIMAL(10,2),
            old_purchase_rate DECIMAL(10,2),
            new_purchase_rate DECIMAL(10,2),
            old_sales_rate DECIMAL(10,2),
            new_sales_rate DECIMAL(10,2),
            changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            changed_by INT,
            FOREIGN KEY (dpl_version_id) REFERENCES dpl_versions(id),
            INDEX idx_item (zoho_item_id),
            INDEX idx_version (dpl_version_id),
            INDEX idx_changed_at (changed_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('Created table: dpl_price_history');

    console.log('=== Item Master Migration Complete ===');
    process.exit(0);
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
