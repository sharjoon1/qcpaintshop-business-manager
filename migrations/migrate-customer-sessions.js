/**
 * Customer Sessions Migration
 *
 * Backs the new customer auth flow that replaces the localStorage-only
 * "customer_logged_in=true" gate.
 *
 * Tokens are stored as SHA-256 hashes (raw token only ever lives in
 * the customer's localStorage + the email/SMS that delivered it).
 * 30-day expiry, soft-revocable via revoked_at.
 */
async function up(pool) {
    const [tables] = await pool.query("SHOW TABLES LIKE 'customer_sessions'");
    if (tables.length) {
        console.log('  customer_sessions already exists, skipping');
        return;
    }

    await pool.query(`
        CREATE TABLE customer_sessions (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            token_hash      CHAR(64) NOT NULL UNIQUE,
            customer_id     INT NULL,
            phone           VARCHAR(20) NOT NULL,
            expires_at      DATETIME NOT NULL,
            revoked_at      DATETIME NULL DEFAULT NULL,
            ip_address      VARCHAR(45) NULL,
            user_agent      VARCHAR(255) NULL,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_phone (phone),
            INDEX idx_expires_at (expires_at),
            INDEX idx_customer_id (customer_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  Created customer_sessions table');
}

module.exports = { up };
