module.exports = {
    up: async (pool) => {
        const [cols] = await pool.query(`SHOW COLUMNS FROM users LIKE 'totp_secret'`);
        if (!cols.length) {
            await pool.query(`ALTER TABLE users ADD COLUMN totp_secret VARCHAR(64) DEFAULT NULL`);
            await pool.query(`ALTER TABLE users ADD COLUMN totp_enabled TINYINT(1) DEFAULT 0`);
            await pool.query(`ALTER TABLE users ADD COLUMN totp_verified_at DATETIME DEFAULT NULL`);
        }
    }
};
