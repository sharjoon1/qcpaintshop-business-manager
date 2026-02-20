/**
 * Migration: WhatsApp Marketing System
 * Creates 5 tables + 2 permissions for campaign management
 *
 * Run: node migrations/migrate-wa-marketing.js
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

    console.log('[WA Marketing Migration] Connected to database');

    // 1. wa_campaigns
    console.log('[1/7] Creating wa_campaigns table...');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS wa_campaigns (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            branch_id INT,
            status ENUM('draft','scheduled','running','paused','completed','cancelled','failed') DEFAULT 'draft',
            message_type ENUM('text','image','document','location','vcard') DEFAULT 'text',
            message_body TEXT,
            media_url VARCHAR(500),
            media_filename VARCHAR(255),
            media_caption TEXT,
            audience_filter JSON,
            scheduled_at DATETIME,
            sending_started_at DATETIME,
            completed_at DATETIME,
            total_leads INT DEFAULT 0,
            sent_count INT DEFAULT 0,
            delivered_count INT DEFAULT 0,
            read_count INT DEFAULT 0,
            failed_count INT DEFAULT 0,
            min_delay_seconds INT DEFAULT 30,
            max_delay_seconds INT DEFAULT 90,
            hourly_limit INT DEFAULT 30,
            daily_limit INT DEFAULT 200,
            warm_up_enabled TINYINT(1) DEFAULT 0,
            created_by INT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_wc_status (status),
            KEY idx_wc_branch (branch_id),
            KEY idx_wc_scheduled (scheduled_at),
            FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    console.log('   ✓ wa_campaigns created');

    // 2. wa_campaign_leads
    console.log('[2/7] Creating wa_campaign_leads table...');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS wa_campaign_leads (
            id INT PRIMARY KEY AUTO_INCREMENT,
            campaign_id INT NOT NULL,
            lead_id INT,
            phone VARCHAR(50) NOT NULL,
            lead_name VARCHAR(255),
            status ENUM('pending','sending','sent','delivered','read','failed','skipped') DEFAULT 'pending',
            resolved_message TEXT,
            sent_at DATETIME,
            delivered_at DATETIME,
            read_at DATETIME,
            failed_at DATETIME,
            error_message TEXT,
            retry_count INT DEFAULT 0,
            send_order INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_wcl_campaign (campaign_id),
            KEY idx_wcl_status (status),
            KEY idx_wcl_order (campaign_id, send_order),
            KEY idx_wcl_lead (lead_id),
            FOREIGN KEY (campaign_id) REFERENCES wa_campaigns(id) ON DELETE CASCADE
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    console.log('   ✓ wa_campaign_leads created');

    // 3. wa_message_templates
    console.log('[3/7] Creating wa_message_templates table...');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS wa_message_templates (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(255) NOT NULL,
            category ENUM('greeting','promotion','followup','announcement','festival','custom') DEFAULT 'custom',
            message_type ENUM('text','image','document','location','vcard') DEFAULT 'text',
            message_body TEXT,
            media_url VARCHAR(500),
            media_caption TEXT,
            variables_used VARCHAR(500),
            usage_count INT DEFAULT 0,
            is_active TINYINT(1) DEFAULT 1,
            created_by INT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_wmt_category (category),
            KEY idx_wmt_active (is_active),
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    console.log('   ✓ wa_message_templates created');

    // 4. wa_sending_stats
    console.log('[4/7] Creating wa_sending_stats table...');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS wa_sending_stats (
            id INT PRIMARY KEY AUTO_INCREMENT,
            branch_id INT,
            stat_date DATE NOT NULL,
            stat_hour TINYINT NOT NULL,
            messages_sent INT DEFAULT 0,
            messages_failed INT DEFAULT 0,
            UNIQUE KEY uk_branch_date_hour (branch_id, stat_date, stat_hour),
            KEY idx_wss_date (stat_date),
            FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    console.log('   ✓ wa_sending_stats created');

    // 5. wa_marketing_settings
    console.log('[5/7] Creating wa_marketing_settings table...');
    await pool.query(`
        CREATE TABLE IF NOT EXISTS wa_marketing_settings (
            \`key\` VARCHAR(100) PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    // Seed default settings
    const defaults = [
        ['min_delay', '30'],
        ['max_delay', '90'],
        ['hourly_limit', '30'],
        ['daily_limit', '200'],
        ['typing_delay_min', '1'],
        ['typing_delay_max', '3'],
        ['seen_delay_min', '2'],
        ['seen_delay_max', '5'],
        ['warmup_day1', '20'],
        ['warmup_day2', '50'],
        ['warmup_day3', '100'],
        ['warmup_day4', '150'],
        ['warmup_day5', '200'],
        ['max_consecutive_failures', '3'],
        ['engine_poll_interval', '30000'],
        ['invisible_markers_enabled', '1']
    ];

    for (const [key, value] of defaults) {
        await pool.query(
            'INSERT INTO wa_marketing_settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = value',
            [key, value]
        );
    }
    console.log('   ✓ wa_marketing_settings created with defaults');

    // 6. Add marketing.view permission
    console.log('[6/7] Adding marketing.view permission...');
    await pool.query(`
        INSERT INTO permissions (module, action, display_name, description)
        VALUES ('marketing', 'view', 'View Marketing', 'View WhatsApp marketing campaigns and analytics')
        ON DUPLICATE KEY UPDATE
            display_name = VALUES(display_name),
            description = VALUES(description)
    `);
    await pool.query(`
        INSERT IGNORE INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
        WHERE r.name = 'admin' AND p.module = 'marketing' AND p.action = 'view'
    `);
    console.log('   ✓ marketing.view permission added');

    // 7. Add marketing.manage permission
    console.log('[7/7] Adding marketing.manage permission...');
    await pool.query(`
        INSERT INTO permissions (module, action, display_name, description)
        VALUES ('marketing', 'manage', 'Manage Marketing', 'Create, edit, and run WhatsApp marketing campaigns')
        ON DUPLICATE KEY UPDATE
            display_name = VALUES(display_name),
            description = VALUES(description)
    `);
    await pool.query(`
        INSERT IGNORE INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
        WHERE r.name = 'admin' AND p.module = 'marketing' AND p.action = 'manage'
    `);
    console.log('   ✓ marketing.manage permission added');

    console.log('\n[WA Marketing Migration] Complete!');
    await pool.end();
    process.exit(0);
}

migrate().catch(err => {
    console.error('[WA Marketing Migration] FAILED:', err.message);
    process.exit(1);
});
