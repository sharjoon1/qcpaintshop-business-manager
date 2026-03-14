/**
 * Painter Retention Migration
 * - painter_daily_checkins table
 * - painter_levels config table (seeded)
 * - painters table new columns
 * - painter_point_transactions source ENUM expansion
 * - ai_config keys
 */
async function up(pool) {
    // 1. painter_daily_checkins
    const [tables1] = await pool.query("SHOW TABLES LIKE 'painter_daily_checkins'");
    if (!tables1.length) {
        await pool.query(`
            CREATE TABLE painter_daily_checkins (
                painter_id      INT NOT NULL,
                checkin_date    DATE NOT NULL,
                streak_count    INT NOT NULL DEFAULT 1,
                bonus_awarded   DECIMAL(10,2) DEFAULT 0,
                created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (painter_id, checkin_date),
                FOREIGN KEY (painter_id) REFERENCES painters(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('  Created painter_daily_checkins table');
    }

    // 2. painter_levels
    const [tables2] = await pool.query("SHOW TABLES LIKE 'painter_levels'");
    if (!tables2.length) {
        await pool.query(`
            CREATE TABLE painter_levels (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                level_name      VARCHAR(20) NOT NULL UNIQUE,
                min_points      INT NOT NULL,
                multiplier      DECIMAL(3,2) NOT NULL DEFAULT 1.00,
                badge_color     VARCHAR(7) NOT NULL,
                sort_order      INT NOT NULL DEFAULT 0
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await pool.query(`
            INSERT INTO painter_levels (level_name, min_points, multiplier, badge_color, sort_order) VALUES
            ('bronze',  0,      1.00, '#CD7F32', 1),
            ('silver',  5000,   1.20, '#9CA3AF', 2),
            ('gold',    25000,  1.50, '#D4A24E', 3),
            ('diamond', 100000, 2.00, '#3B82F6', 4)
        `);
        console.log('  Created painter_levels table with seed data');
    }

    // 3. painters table columns
    const colsToAdd = [
        { col: 'current_level',    def: "VARCHAR(20) DEFAULT 'bronze'" },
        { col: 'current_streak',   def: "INT DEFAULT 0" },
        { col: 'last_checkin_date', def: "DATE NULL" },
        { col: 'longest_streak',   def: "INT DEFAULT 0" },
        { col: 'last_briefing_at', def: "TIMESTAMP NULL" }
    ];
    for (const { col, def } of colsToAdd) {
        const [cols] = await pool.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'painters' AND COLUMN_NAME = ?",
            [col]
        );
        if (!cols.length) {
            await pool.query(`ALTER TABLE painters ADD COLUMN ${col} ${def}`);
            console.log(`  Added painters.${col}`);
        }
    }

    // 4. Expand painter_point_transactions source ENUM
    try {
        await pool.query(`
            ALTER TABLE painter_point_transactions MODIFY source
                ENUM('self_billing','customer_billing','referral','attendance','monthly_slab',
                     'quarterly_slab','withdrawal','credit_debit','admin_adjustment',
                     'streak_bonus','daily_bonus') NOT NULL
        `);
        console.log('  Updated painter_point_transactions source ENUM');
    } catch (e) {
        if (!e.message.includes('Duplicate')) console.log('  ENUM update skipped:', e.message);
    }

    // 5. ai_config keys
    const configKeys = [
        { key: 'painter_daily_bonus_product_id', val: '' },
        { key: 'painter_daily_bonus_multiplier', val: '2' },
        { key: 'painter_daily_bonus_cap', val: '500' },
        { key: 'painter_streak_reminder_enabled', val: '1' }
    ];
    for (const { key, val } of configKeys) {
        const [existing] = await pool.query('SELECT config_key FROM ai_config WHERE config_key = ?', [key]);
        if (!existing.length) {
            await pool.query('INSERT INTO ai_config (config_key, config_value) VALUES (?, ?)', [key, val]);
            console.log(`  Inserted ai_config: ${key}`);
        }
    }

    // 6. Backfill current_level for existing painters based on lifetime points
    await pool.query(`
        UPDATE painters p
        SET current_level = (
            SELECT pl.level_name
            FROM painter_levels pl
            WHERE (p.total_earned_regular + p.total_earned_annual) >= pl.min_points
            ORDER BY pl.min_points DESC
            LIMIT 1
        )
        WHERE current_level = 'bronze' OR current_level IS NULL
    `);
    console.log('  Backfilled painter levels');

    console.log('[Migration] Painter retention migration complete');
}

module.exports = { up };
