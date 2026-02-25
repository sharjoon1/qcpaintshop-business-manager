/**
 * Migration: Production Health Monitoring
 * Creates production_health_snapshots table for metrics history
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

async function migrate() {
    let pool;
    try {
        pool = mysql.createPool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            port: parseInt(process.env.DB_PORT, 10) || 3306,
            waitForConnections: true,
            connectionLimit: 5,
            queueLimit: 0
        });

        console.log('🔄 Starting Production Monitor migration...\n');

        // 1. Create production_health_snapshots table
        console.log('📋 Creating production_health_snapshots table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS production_health_snapshots (
                id INT AUTO_INCREMENT PRIMARY KEY,
                memory_heap_mb INT DEFAULT 0,
                memory_heap_pct INT DEFAULT 0,
                memory_rss_mb INT DEFAULT 0,
                event_loop_lag_ms INT DEFAULT 0,
                db_pool_used_pct INT DEFAULT 0,
                db_ping_ms INT DEFAULT 0,
                db_queue_length INT DEFAULT 0,
                api_p50_ms INT DEFAULT 0,
                api_p95_ms INT DEFAULT 0,
                api_p99_ms INT DEFAULT 0,
                api_rpm INT DEFAULT 0,
                socket_connections INT DEFAULT 0,
                uptime_seconds INT DEFAULT 0,
                healing_actions_1h INT DEFAULT 0,
                circuit_breaker_state VARCHAR(20) DEFAULT 'closed',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_created_at (created_at),
                INDEX idx_heap_pct (memory_heap_pct),
                INDEX idx_lag (event_loop_lag_ms)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ production_health_snapshots table created');

        // 2. Add production monitor config
        console.log('\n⚙️  Adding production monitor config...');
        const configs = [
            ['production_monitor_enabled', 'true'],
            ['production_alert_whatsapp', 'true'],
            ['production_alert_cooldown_minutes', '60'],
            ['production_memory_warning_pct', '80'],
            ['production_memory_critical_pct', '90']
        ];
        for (const [key, value] of configs) {
            await pool.query(
                `INSERT IGNORE INTO ai_config (config_key, config_value) VALUES (?, ?)`,
                [key, value]
            );
        }
        console.log('   ✅ Config entries added');

        console.log('\n✅ Production Monitor migration completed successfully!');

    } catch (error) {
        console.error('❌ Migration failed:', error);
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate();
