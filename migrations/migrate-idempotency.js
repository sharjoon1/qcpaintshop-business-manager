/**
 * Idempotency Records Migration (U17)
 *
 * Allows financial POST endpoints to be safely retried by mobile clients
 * without creating duplicate rows.
 *
 * Client sends an Idempotency-Key header (UUID generated per submit-button
 * click). The server stores the first response keyed by SHA-256 of
 * (scope + key). Subsequent identical-key requests return the stored
 * response verbatim. 24h TTL.
 */
async function up(pool) {
    const [tables] = await pool.query("SHOW TABLES LIKE 'idempotency_records'");
    if (tables.length) {
        console.log('  idempotency_records already exists, skipping');
        return;
    }

    await pool.query(`
        CREATE TABLE idempotency_records (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            key_hash        CHAR(64) NOT NULL UNIQUE,
            scope           VARCHAR(64) NOT NULL,
            user_id         INT NULL,
            actor_type      VARCHAR(16) NULL,
            response_status INT NOT NULL,
            response_body   LONGTEXT NULL,
            request_url     VARCHAR(512) NULL,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at      DATETIME NOT NULL,
            INDEX idx_scope (scope),
            INDEX idx_expires_at (expires_at),
            INDEX idx_user_id (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  Created idempotency_records table');
}

module.exports = { up };
