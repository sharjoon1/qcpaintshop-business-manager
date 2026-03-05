/**
 * Migration: Staff Notice Board / Activity Feed
 * Run: node migrations/migrate-notice-board.js
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    console.log('Starting notice board migration...');

    // 1. Staff activity feed table
    await pool.query(`
        CREATE TABLE IF NOT EXISTS staff_activity_feed (
            id INT PRIMARY KEY AUTO_INCREMENT,
            user_id INT NOT NULL,
            branch_id INT NULL,
            activity_type VARCHAR(50) NOT NULL,
            title VARCHAR(255) NOT NULL,
            description TEXT NULL,
            icon VARCHAR(10) DEFAULT NULL,
            color VARCHAR(20) DEFAULT '#667eea',
            visible_to ENUM('all','branch','admin') DEFAULT 'all',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_branch_date (branch_id, created_at),
            INDEX idx_type (activity_type),
            INDEX idx_created (created_at),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('Created staff_activity_feed table');

    // 2. Admin notices table
    await pool.query(`
        CREATE TABLE IF NOT EXISTS admin_notices (
            id INT PRIMARY KEY AUTO_INCREMENT,
            posted_by INT NOT NULL,
            title VARCHAR(255) NOT NULL,
            message TEXT NOT NULL,
            priority ENUM('normal','important','urgent') DEFAULT 'normal',
            target ENUM('all','branch') DEFAULT 'all',
            target_branch_id INT NULL,
            is_active TINYINT(1) DEFAULT 1,
            expires_at DATETIME NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_active (is_active, created_at),
            FOREIGN KEY (posted_by) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('Created admin_notices table');

    await pool.end();
    console.log('Migration complete!');
})().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
