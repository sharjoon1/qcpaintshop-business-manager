/**
 * Migration: WhatsApp Instant Messages Table
 * Tracks individual instant messages sent to leads (outside of campaigns)
 *
 * Run: node migrations/migrate-wa-instant-messages.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mysql = require('mysql2/promise');

async function migrate() {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 5
    });

    console.log('[WA Instant Messages Migration] Connected to database');

    // 1. wa_instant_messages table
    console.log('[1/1] Creating wa_instant_messages table...');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS wa_instant_messages (
            id INT PRIMARY KEY AUTO_INCREMENT,
            batch_id VARCHAR(50) NOT NULL,
            lead_id INT,
            lead_name VARCHAR(255),
            phone VARCHAR(50) NOT NULL,
            message_template TEXT,
            message_content TEXT,
            media_url VARCHAR(500),
            media_type ENUM('image','document') DEFAULT NULL,
            media_caption TEXT,
            branch_id INT,
            status ENUM('pending','sending','sent','delivered','read','failed') DEFAULT 'pending',
            error_message TEXT,
            sent_at DATETIME,
            delivered_at DATETIME,
            read_at DATETIME,
            created_by INT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            KEY idx_wim_batch (batch_id),
            KEY idx_wim_status (status),
            KEY idx_wim_lead (lead_id),
            KEY idx_wim_created (created_at),
            KEY idx_wim_created_by (created_by),
            FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    console.log('   ✓ wa_instant_messages created');

    console.log('\n[WA Instant Messages Migration] Complete!');
    await pool.end();
    process.exit(0);
}

migrate().catch(err => {
    console.error('[WA Instant Messages Migration] FAILED:', err.message);
    process.exit(1);
});
