/**
 * Audit Log Migration
 *
 * Records every state-changing action on financial entities so that
 * disputes ("who changed this estimate price?", "when was this invoice
 * deleted?") can be answered. Stores before/after JSON snapshots.
 */
async function up(pool) {
    const [tables] = await pool.query("SHOW TABLES LIKE 'audit_log'");
    if (tables.length) {
        console.log('  audit_log already exists, skipping');
        return;
    }

    await pool.query(`
        CREATE TABLE audit_log (
            id              BIGINT AUTO_INCREMENT PRIMARY KEY,
            ts              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            user_id         INT NULL,
            actor_type      VARCHAR(20) NOT NULL DEFAULT 'staff',
            action          VARCHAR(50) NOT NULL,
            entity_type     VARCHAR(50) NOT NULL,
            entity_id       VARCHAR(64) NULL,
            before_json     LONGTEXT NULL,
            after_json      LONGTEXT NULL,
            ip              VARCHAR(45) NULL,
            user_agent      VARCHAR(255) NULL,
            request_url     VARCHAR(500) NULL,
            INDEX idx_ts (ts),
            INDEX idx_entity (entity_type, entity_id),
            INDEX idx_user (user_id, ts),
            INDEX idx_action (action, ts)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  Created audit_log table');
}

module.exports = { up };
