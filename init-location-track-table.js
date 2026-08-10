// One-off: create the location_tracks table for the live location tracker.
// Uses the app's own DB pool (config/database) — no credentials in this script.
const { createPool } = require('./config/database');

(async () => {
    const pool = createPool();
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS location_tracks (
                id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                code         VARCHAR(32)  NOT NULL,
                lat          DECIMAL(10,7) NOT NULL,
                lng          DECIMAL(10,7) NOT NULL,
                accuracy     FLOAT        NULL,
                speed        FLOAT        NULL,
                heading      FLOAT        NULL,
                battery      INT          NULL,
                is_charging  TINYINT(1)   NULL,
                device       VARCHAR(255) NULL,
                ip           VARCHAR(45)  NULL,
                captured_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                KEY idx_code_time (code, captured_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        console.log('location_tracks table ready ✔');
    } catch (err) {
        console.error('CREATE TABLE failed:', err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();
