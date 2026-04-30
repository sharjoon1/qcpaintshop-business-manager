/**
 * Password Reset Tokens Migration
 *
 * Replaces the legacy forgot-password flow that overwrote the user's real
 * password with a 4-byte hex temp value emailed in plaintext.
 *
 * The new flow stores a SHA-256 hash of a 32-byte random token, with
 * a 1-hour expiry, single-use, and only mutates users.password_hash
 * after the user submits a new password through the reset form.
 */
async function up(pool) {
    const [tables] = await pool.query("SHOW TABLES LIKE 'password_reset_tokens'");
    if (tables.length) {
        console.log('  password_reset_tokens already exists, skipping');
        return;
    }

    await pool.query(`
        CREATE TABLE password_reset_tokens (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            user_id         INT NOT NULL,
            token_hash      CHAR(64) NOT NULL UNIQUE,
            expires_at      DATETIME NOT NULL,
            used_at         DATETIME NULL DEFAULT NULL,
            requested_ip    VARCHAR(45) NULL,
            requested_ua    VARCHAR(255) NULL,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_user_id (user_id),
            INDEX idx_expires_at (expires_at),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  Created password_reset_tokens table');
}

module.exports = { up };
