/**
 * Migration: Staff Daily Work - AI Tamil Task Generator
 * Creates staff_daily_ai_tasks table for Clawdbot-generated personalized tasks
 */

async function up(pool) {
    console.log('[Migration] Creating staff_daily_ai_tasks table...');

    await pool.query(`
        CREATE TABLE IF NOT EXISTS staff_daily_ai_tasks (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            task_date DATE NOT NULL,
            tasks_json JSON NOT NULL COMMENT 'Array of {title, description, category, priority, completed}',
            summary TEXT COMMENT 'Tamil summary from Clawdbot',
            lead_context JSON COMMENT 'Snapshot of leads/outstanding data used for generation',
            generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_count INT DEFAULT 0,
            total_count INT DEFAULT 0,
            INDEX idx_user_date (user_id, task_date),
            UNIQUE KEY uq_user_date (user_id, task_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Config keys for the feature (ai_config may not exist in dev)
    try {
        const configs = [
            ['staff_daily_tasks_enabled', '1'],
            ['staff_daily_tasks_time', '09:00'],
            ['staff_daily_tasks_language', 'tamil']
        ];

        for (const [key, value] of configs) {
            await pool.query(
                `INSERT IGNORE INTO ai_config (config_key, config_value) VALUES (?, ?)`,
                [key, value]
            );
        }
    } catch (e) {
        console.log('[Migration] ai_config insert skipped (table may not exist):', e.message);
    }

    console.log('[Migration] staff_daily_ai_tasks table created successfully');
}

module.exports = { up };
