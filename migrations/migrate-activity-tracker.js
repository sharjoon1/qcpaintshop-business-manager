const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    console.log('Starting activity tracker migration...');

    // 1. staff_activity_sessions
    await pool.query(`
        CREATE TABLE IF NOT EXISTS staff_activity_sessions (
            id INT PRIMARY KEY AUTO_INCREMENT,
            user_id INT NOT NULL,
            branch_id INT NOT NULL,
            activity_type ENUM('marketing','outstanding_followup','material_arrangement','material_receiving','attending_customer','shop_maintenance') NOT NULL,
            started_at DATETIME NOT NULL,
            ended_at DATETIME NULL,
            duration_minutes INT NULL,
            auto_ended TINYINT(1) DEFAULT 0,
            metadata JSON NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_user_started (user_id, started_at),
            INDEX idx_user_ended (user_id, ended_at),
            INDEX idx_branch_started (branch_id, started_at),
            CONSTRAINT fk_activity_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('Created staff_activity_sessions table');

    // 2. staff_idle_alerts
    await pool.query(`
        CREATE TABLE IF NOT EXISTS staff_idle_alerts (
            id INT PRIMARY KEY AUTO_INCREMENT,
            user_id INT NOT NULL,
            idle_started_at DATETIME NOT NULL,
            alert_sent_at DATETIME NOT NULL,
            responded_at DATETIME NULL,
            idle_minutes INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_user_alert (user_id, alert_sent_at),
            CONSTRAINT fk_idle_alerts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('Created staff_idle_alerts table');

    await pool.end();
    console.log('Activity tracker migration complete!');
})().catch(e => {
    console.error('Migration failed:', e.message);
    process.exit(1);
});
