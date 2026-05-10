/**
 * Brand DPL Lists Migration
 *
 * Stores one DPL price list per brand. Single-row-per-brand model:
 * update via INSERT ... ON DUPLICATE KEY UPDATE, no history retained.
 *
 * raw_text:    original paste, kept for audit / future re-parse
 * parsed_rows: parseBirlaOpusTabular() result as JSON array,
 *              read directly by matchWithZohoItems on every Match Now click
 */
async function up(pool) {
    const [tables] = await pool.query("SHOW TABLES LIKE 'brand_dpl_lists'");
    if (tables.length) {
        console.log('  brand_dpl_lists already exists, skipping');
        return;
    }

    await pool.query(`
        CREATE TABLE brand_dpl_lists (
            brand           VARCHAR(50)   NOT NULL,
            raw_text        MEDIUMTEXT    NOT NULL,
            parsed_rows     JSON          NOT NULL,
            parsed_count    INT           NOT NULL,
            effective_date  DATE          DEFAULT NULL,
            updated_by      VARCHAR(100)  DEFAULT NULL,
            updated_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (brand)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  Created brand_dpl_lists table');
}

module.exports = { up };
