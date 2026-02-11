-- ========================================
-- MIGRATION SCRIPT: Fix Remaining Schema Mismatches
-- Quality Colours Business Manager
-- Date: 2026-02-11
-- ========================================

USE qc_business_manager;

-- ========================================
-- 1. FIX PRODUCTS TABLE
-- product_type ENUM only has ('area_wise','piece','roll','set')
-- but code sends 'unit_wise' - need to add it
-- ========================================

ALTER TABLE products MODIFY COLUMN product_type ENUM('unit_wise','area_wise','piece','roll','set') DEFAULT 'unit_wise';

-- ========================================
-- 2. FIX CUSTOMER_TYPES TABLE
-- Has discount_percentage but code uses default_discount
-- Missing: price_markup, status columns
-- ========================================

DELIMITER //

DROP PROCEDURE IF EXISTS fix_customer_types//

CREATE PROCEDURE fix_customer_types()
BEGIN
    -- Add default_discount if missing
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='qc_business_manager' AND TABLE_NAME='customer_types' AND COLUMN_NAME='default_discount') THEN
        ALTER TABLE customer_types ADD COLUMN default_discount DECIMAL(5,2) DEFAULT 0 AFTER description;
        -- Copy from discount_percentage if it exists
        UPDATE customer_types SET default_discount = discount_percentage WHERE discount_percentage IS NOT NULL;
    END IF;

    -- Add price_markup if missing
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='qc_business_manager' AND TABLE_NAME='customer_types' AND COLUMN_NAME='price_markup') THEN
        ALTER TABLE customer_types ADD COLUMN price_markup DECIMAL(5,2) DEFAULT 0 AFTER default_discount;
    END IF;

    -- Add status if missing
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='qc_business_manager' AND TABLE_NAME='customer_types' AND COLUMN_NAME='status') THEN
        ALTER TABLE customer_types ADD COLUMN status ENUM('active','inactive') DEFAULT 'active';
        UPDATE customer_types SET status = CASE WHEN is_active = 1 THEN 'active' ELSE 'inactive' END;
    END IF;
END//

DELIMITER ;

CALL fix_customer_types();
DROP PROCEDURE IF EXISTS fix_customer_types;

-- ========================================
-- 3. CREATE PACK_SIZES TABLE (if not exists)
-- ========================================

CREATE TABLE IF NOT EXISTS pack_sizes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    product_id INT NOT NULL,
    size DECIMAL(10,2) NOT NULL,
    unit VARCHAR(10) DEFAULT 'L',
    base_price DECIMAL(10,2) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    INDEX idx_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- DONE
-- ========================================
SELECT 'Migration completed successfully!' as message;
