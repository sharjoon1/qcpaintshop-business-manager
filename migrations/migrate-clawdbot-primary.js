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

        console.log('Connected to database. Running Clawdbot primary provider migration...\n');

        const configs = [
            { key: 'gemini_enabled', value: 'false' },
            { key: 'claude_enabled', value: 'false' },
            { key: 'clawdbot_enabled', value: 'true' },
            { key: 'primary_provider', value: 'clawdbot' },
            { key: 'fallback_provider', value: 'clawdbot' },
            { key: 'clawdbot_model', value: 'anthropic/claude-sonnet-4-5' },
            { key: 'max_tokens_per_request', value: '2048' },
            { key: 'chat_max_tokens', value: '2048' }
        ];

        for (const cfg of configs) {
            await pool.query(
                `INSERT INTO ai_config (config_key, config_value)
                 VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
                [cfg.key, cfg.value]
            );
            console.log(`  ✓ ${cfg.key} = ${cfg.value}`);
        }

        console.log('\n✅ Migration complete — Clawdbot is now the sole AI provider.');
        console.log('To re-enable Gemini/Claude later:');
        console.log("  UPDATE ai_config SET config_value = 'true' WHERE config_key = 'gemini_enabled';");
        console.log("  UPDATE ai_config SET config_value = 'true' WHERE config_key = 'claude_enabled';");

    } catch (error) {
        console.error('Migration failed:', error.message);
        process.exit(1);
    } finally {
        if (pool) await pool.end();
    }
}

migrate();
