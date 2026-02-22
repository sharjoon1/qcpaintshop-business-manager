/**
 * AI System Migration
 * Creates 6 tables: ai_conversations, ai_messages, ai_analysis_runs, ai_insights, ai_lead_scores, ai_config
 * Seeds default configuration values
 *
 * Run: node migrations/migrate-ai-tables.js
 */

const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function migrate() {
    let pool;
    try {
        pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'business_manager',
            port: process.env.DB_PORT || 3306
        });

        console.log('Connected to database. Running AI system migration...\n');

        // 1. ai_conversations
        console.log('1. Creating ai_conversations table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ai_conversations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                title VARCHAR(255) DEFAULT 'New Chat',
                model_provider ENUM('gemini','claude') DEFAULT 'gemini',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_user (user_id)
            )
        `);
        console.log('   OK');

        // 2. ai_messages
        console.log('2. Creating ai_messages table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ai_messages (
                id INT AUTO_INCREMENT PRIMARY KEY,
                conversation_id INT NOT NULL,
                role ENUM('user','assistant','system') NOT NULL,
                content TEXT NOT NULL,
                tokens_used INT DEFAULT 0,
                model VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_conv (conversation_id),
                FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
            )
        `);
        console.log('   OK');

        // 3. ai_analysis_runs
        console.log('3. Creating ai_analysis_runs table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ai_analysis_runs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                analysis_type ENUM('zoho_daily','zoho_weekly','staff_daily','staff_weekly','lead_scoring','marketing_tips') NOT NULL,
                status ENUM('running','completed','failed') DEFAULT 'running',
                summary TEXT,
                full_response LONGTEXT,
                data_snapshot JSON,
                model_provider VARCHAR(50),
                tokens_used INT DEFAULT 0,
                duration_ms INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_type_date (analysis_type, created_at)
            )
        `);
        console.log('   OK');

        // 4. ai_insights
        console.log('4. Creating ai_insights table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ai_insights (
                id INT AUTO_INCREMENT PRIMARY KEY,
                analysis_run_id INT,
                category ENUM('revenue','collections','overdue','staff','leads','marketing','general') NOT NULL,
                severity ENUM('info','warning','critical') DEFAULT 'info',
                title VARCHAR(255) NOT NULL,
                description TEXT,
                action_recommended TEXT,
                is_read TINYINT(1) DEFAULT 0,
                is_dismissed TINYINT(1) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_category (category),
                INDEX idx_unread (is_read, is_dismissed),
                FOREIGN KEY (analysis_run_id) REFERENCES ai_analysis_runs(id) ON DELETE SET NULL
            )
        `);
        console.log('   OK');

        // 5. ai_lead_scores
        console.log('5. Creating ai_lead_scores table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ai_lead_scores (
                id INT AUTO_INCREMENT PRIMARY KEY,
                lead_id INT NOT NULL,
                score INT DEFAULT 0,
                score_breakdown JSON,
                ai_recommendation TEXT,
                suggested_assignee INT,
                next_action VARCHAR(255),
                next_action_date DATE,
                scored_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_lead (lead_id),
                INDEX idx_score (score DESC)
            )
        `);
        console.log('   OK');

        // 6. ai_config
        console.log('6. Creating ai_config table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ai_config (
                config_key VARCHAR(100) PRIMARY KEY,
                config_value TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        console.log('   OK');

        // 7. Seed default config
        console.log('7. Seeding default AI config...');
        const defaults = [
            ['primary_provider', 'gemini'],
            ['fallback_provider', 'claude'],
            ['zoho_daily_enabled', '1'],
            ['zoho_daily_time', '21:00'],
            ['staff_daily_enabled', '1'],
            ['staff_daily_time', '22:30'],
            ['lead_scoring_enabled', '1'],
            ['lead_scoring_interval', '6'],
            ['marketing_weekly_enabled', '1'],
            ['marketing_weekly_day', '1'],
            ['whatsapp_reports_enabled', '1'],
            ['whatsapp_report_recipients', ''],
            ['max_tokens_per_request', '4096'],
            ['temperature', '0.3']
        ];

        let seeded = 0;
        for (const [key, value] of defaults) {
            const [existing] = await pool.query('SELECT config_key FROM ai_config WHERE config_key = ?', [key]);
            if (existing.length === 0) {
                await pool.query('INSERT INTO ai_config (config_key, config_value) VALUES (?, ?)', [key, value]);
                seeded++;
            }
        }
        console.log(`   OK - ${seeded} new defaults seeded (${defaults.length - seeded} already existed)`);

        // 8. Add system.ai permission if not exists
        console.log('8. Checking system.ai permission...');
        try {
            const [perms] = await pool.query("SELECT id FROM permissions WHERE permission_key = 'system.ai'");
            if (perms.length === 0) {
                await pool.query(`
                    INSERT INTO permissions (permission_key, permission_name, module, description)
                    VALUES ('system.ai', 'AI Dashboard', 'system', 'Access AI chat, insights, and configuration')
                `);
                console.log('   OK - permission created');
            } else {
                console.log('   SKIP - already exists');
            }
        } catch (e) {
            console.log('   SKIP - permissions table may not have expected structure:', e.message);
        }

        console.log('\n✅ AI system migration completed successfully!');

    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate();
