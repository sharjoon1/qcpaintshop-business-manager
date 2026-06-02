/**
 * DPL Catalog Migration
 *
 * dpl_catalog mediates between a brand's DPL price list and Zoho items.
 * One row per canonical (brand, product, base, size_tier), identified by
 * match_key (the single UNIQUE index — avoids NULL/empty composite-key pitfalls).
 * Size is stored as a canonical TIER (200ml/1L/4L/10L/20L); the DPL's actual
 * label is kept in dpl_size_label. A confirmed zoho_item_id is the pinned
 * push target for future DPL updates.
 */
async function up(pool) {
    const [tables] = await pool.query("SHOW TABLES LIKE 'dpl_catalog'");
    if (tables.length) {
        console.log('  dpl_catalog already exists, skipping');
        return;
    }

    await pool.query(`
        CREATE TABLE dpl_catalog (
            id                     INT           NOT NULL AUTO_INCREMENT,
            brand                  VARCHAR(40)   NOT NULL,
            match_key              VARCHAR(255)  NOT NULL,
            category               VARCHAR(120)  DEFAULT NULL,
            product_code           VARCHAR(20)   DEFAULT NULL,
            product_name           VARCHAR(160)  NOT NULL,
            base_name              VARCHAR(80)   DEFAULT NULL,
            size_tier              VARCHAR(12)   NOT NULL,
            dpl_size_label         VARCHAR(20)   DEFAULT NULL,
            zoho_item_id           VARCHAR(40)   DEFAULT NULL,
            canonical_name         VARCHAR(255)  DEFAULT NULL,
            canonical_sku          VARCHAR(64)   DEFAULT NULL,
            canonical_description  VARCHAR(255)  DEFAULT NULL,
            current_dpl            DECIMAL(12,2) DEFAULT NULL,
            current_rate           DECIMAL(12,2) DEFAULT NULL,
            link_status            ENUM('confirmed','review','needs_creating') NOT NULL DEFAULT 'review',
            link_confidence        TINYINT       DEFAULT NULL,
            link_reason            VARCHAR(120)  DEFAULT NULL,
            updated_by             VARCHAR(100)  DEFAULT NULL,
            created_at             TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
            updated_at             TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uniq_match_key (match_key),
            KEY idx_brand (brand),
            KEY idx_zoho_item (zoho_item_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  Created dpl_catalog table');
}

module.exports = { up };
