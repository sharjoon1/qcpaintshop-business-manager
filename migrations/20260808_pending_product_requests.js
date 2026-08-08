/**
 * Migration: Pending Product Requests — Phase 1 (Products & Inventory)
 * Admin-approval gate before Zoho Item creation.
 * Zoho Items is master; BM local pending table holds staff requests.
 */
exports.up = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pending_product_requests (
      id INT PRIMARY KEY AUTO_INCREMENT,
      requester_user_id INT NOT NULL,
      brand VARCHAR(100) NOT NULL,
      product_name VARCHAR(255) NOT NULL,
      category VARCHAR(100) NOT NULL,
      category_code VARCHAR(10) NOT NULL,
      base_type VARCHAR(100) NULL,
      color VARCHAR(100) NULL,
      pack_size VARCHAR(50) NOT NULL,
      unit VARCHAR(20) NOT NULL DEFAULT 'nos',
      dpl DECIMAL(10,2) NOT NULL,
      purchase_rate DECIMAL(10,2) NULL,
      sales_rate DECIMAL(10,2) NULL,
      hsn_sac VARCHAR(20) NULL,
      zoho_tax_id VARCHAR(100) NULL,
      description TEXT NULL,
      status ENUM('pending','approved','rejected','pushed','failed') NOT NULL DEFAULT 'pending',
      zoho_item_id VARCHAR(100) NULL,
      zoho_response TEXT NULL,
      approved_by INT NULL,
      approved_at DATETIME NULL,
      rejected_reason TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status (status),
      INDEX idx_requester (requester_user_id),
      INDEX idx_brand (brand),
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✓ pending_product_requests created');
};
