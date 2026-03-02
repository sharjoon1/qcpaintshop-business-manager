/**
 * Lead Auto-Assign Migration
 * Adds config keys for daily auto-assignment of unassigned leads to branch staff
 *
 * Run: node migrations/migrate-lead-auto-assign.js
 *
 * All operations are idempotent — safe to run multiple times.
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

        console.log('=== Lead Auto-Assign Migration ===\n');

        const configs = [
            { key: 'lead_auto_assign_enabled', value: '1' },
            { key: 'lead_auto_assign_leads_per_staff', value: '10' },
            { key: 'lead_auto_assign_time', value: '08:00' }
        ];

        for (const { key, value } of configs) {
            const [existing] = await pool.query(
                'SELECT config_key FROM ai_config WHERE config_key = ?',
                [key]
            );
            if (existing.length === 0) {
                await pool.query(
                    'INSERT INTO ai_config (config_key, config_value) VALUES (?, ?)',
                    [key, value]
                );
                console.log(`  + Added config: ${key} = ${value}`);
            } else {
                console.log(`  ~ Config already exists: ${key}`);
            }
        }

        console.log('\n=== Migration Complete ===');
        await pool.end();
    } catch (error) {
        console.error('Migration failed:', error.message);
        if (pool) await pool.end();
        process.exit(1);
    }
}

migrate();
