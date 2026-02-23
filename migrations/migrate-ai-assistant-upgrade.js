/**
 * AI Assistant Manager Upgrade Migration
 * - Creates ai_business_context table (cached daily snapshots)
 * - Creates ai_suggestions table (AI improvement recommendations)
 * - Adds context_summary column to ai_messages
 * - Seeds new config defaults (chat_max_tokens, chat_temperature, daily_snapshot_enabled)
 *
 * Run: node migrations/migrate-ai-assistant-upgrade.js
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

        console.log('Connected to database. Running AI Assistant Manager upgrade migration...\n');

        // 1. ai_business_context — cached daily business snapshots
        console.log('1. Creating ai_business_context table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ai_business_context (
                id INT AUTO_INCREMENT PRIMARY KEY,
                context_date DATE NOT NULL,
                context_type ENUM('daily_snapshot','realtime') DEFAULT 'daily_snapshot',
                context_data JSON NOT NULL,
                generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                generation_time_ms INT DEFAULT 0,
                UNIQUE KEY idx_date_type (context_date, context_type)
            )
        `);
        console.log('   OK');

        // 2. ai_suggestions — track AI improvement recommendations
        console.log('2. Creating ai_suggestions table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ai_suggestions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                category ENUM('operations','software','marketing','staffing','inventory','financial','growth','general') DEFAULT 'general',
                suggestion TEXT NOT NULL,
                reasoning TEXT,
                priority ENUM('low','medium','high','critical') DEFAULT 'medium',
                status ENUM('new','acknowledged','in_progress','implemented','dismissed') DEFAULT 'new',
                source ENUM('chat','analysis','proactive') DEFAULT 'proactive',
                conversation_id INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_status (status),
                INDEX idx_category (category),
                FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE SET NULL
            )
        `);
        console.log('   OK');

        // 3. ALTER ai_messages — add context_summary column
        console.log('3. Adding context_summary column to ai_messages...');
        try {
            const [cols] = await pool.query(`
                SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_messages' AND COLUMN_NAME = 'context_summary'
            `);
            if (cols.length === 0) {
                await pool.query(`ALTER TABLE ai_messages ADD COLUMN context_summary VARCHAR(500) DEFAULT NULL AFTER model`);
                console.log('   OK - column added');
            } else {
                console.log('   SKIP - column already exists');
            }
        } catch (e) {
            console.log('   WARN:', e.message);
        }

        // 4. Seed new config defaults
        console.log('4. Seeding new config defaults...');
        const defaults = [
            ['chat_max_tokens', '8192'],
            ['chat_temperature', '0.5'],
            ['daily_snapshot_enabled', '1']
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

        console.log('\n AI Assistant Manager upgrade migration completed successfully!');

    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate();
