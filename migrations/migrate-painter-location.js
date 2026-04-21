// migrations/migrate-painter-location.js
async function up(pool) {
    const [tables] = await pool.query("SHOW TABLES LIKE 'painter_location_events'");
    if (!tables.length) {
        await pool.query(`
            CREATE TABLE painter_location_events (
                id          BIGINT AUTO_INCREMENT PRIMARY KEY,
                painter_id  INT NOT NULL,
                latitude    DECIMAL(10,7) NOT NULL,
                longitude   DECIMAL(10,7) NOT NULL,
                accuracy_m  FLOAT,
                recorded_at DATETIME NOT NULL,
                created_at  DATETIME DEFAULT NOW(),
                INDEX idx_painter_time (painter_id, recorded_at),
                FOREIGN KEY (painter_id) REFERENCES painters(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('  Created painter_location_events table');
    } else {
        console.log('  painter_location_events already exists, skipping');
    }
    console.log('[Migration] painter-location complete');
}

module.exports = { up };
