/**
 * Migration: Anomaly Detection System
 * Creates detected_anomalies table and config entries
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

        console.log('🔄 Starting Anomaly Detection migration...\n');

        // 1. Create detected_anomalies table
        console.log('📋 Creating detected_anomalies table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS detected_anomalies (
                id INT AUTO_INCREMENT PRIMARY KEY,
                anomaly_type ENUM('revenue', 'attendance', 'stock', 'collection', 'api_usage', 'custom') NOT NULL,
                severity ENUM('low', 'medium', 'high', 'critical') NOT NULL DEFAULT 'medium',
                title VARCHAR(255) NOT NULL,
                description TEXT,
                entity_type VARCHAR(100) DEFAULT NULL COMMENT 'e.g. branch, user, item, customer',
                entity_id VARCHAR(100) DEFAULT NULL COMMENT 'ID of the related entity',
                metric_name VARCHAR(150) DEFAULT NULL COMMENT 'e.g. daily_revenue, clock_in_time',
                expected_value DECIMAL(15,2) DEFAULT NULL,
                actual_value DECIMAL(15,2) DEFAULT NULL,
                deviation_pct DECIMAL(8,2) DEFAULT NULL COMMENT 'Percentage deviation from expected',
                z_score DECIMAL(8,4) DEFAULT NULL COMMENT 'Statistical Z-score',
                status ENUM('new', 'acknowledged', 'investigating', 'resolved', 'false_positive') NOT NULL DEFAULT 'new',
                branch_id INT DEFAULT NULL,
                resolved_at DATETIME DEFAULT NULL,
                resolved_by INT DEFAULT NULL,
                resolution_notes TEXT DEFAULT NULL,
                metadata JSON DEFAULT NULL COMMENT 'Additional context data',
                detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_anomaly_type (anomaly_type),
                INDEX idx_severity (severity),
                INDEX idx_status (status),
                INDEX idx_branch_id (branch_id),
                INDEX idx_detected_at (detected_at),
                INDEX idx_type_status (anomaly_type, status),
                INDEX idx_severity_status (severity, status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ detected_anomalies table created');

        // 2. Add anomaly detection config entries to ai_config
        console.log('\n⚙️  Adding anomaly detection config...');
        const configs = [
            ['anomaly_detection_enabled', 'true', 'Enable/disable anomaly detection system'],
            ['anomaly_scan_interval_hours', '6', 'Hours between automated anomaly scans'],
            ['anomaly_revenue_zscore_threshold', '2.0', 'Z-score threshold for revenue anomalies'],
            ['anomaly_attendance_zscore_threshold', '2.5', 'Z-score threshold for attendance anomalies'],
            ['anomaly_stock_deviation_pct', '20', 'Percentage deviation threshold for stock anomalies'],
            ['anomaly_collection_delay_days', '7', 'Days overdue to flag collection anomalies'],
            ['anomaly_auto_resolve_days', '30', 'Auto-resolve unacknowledged anomalies after N days'],
            ['anomaly_max_per_scan', '50', 'Maximum anomalies to create per scan run'],
            ['anomaly_notify_critical', 'true', 'Send notifications for critical anomalies'],
            ['anomaly_last_scan_at', '', 'Timestamp of last anomaly scan']
        ];

        for (const [key, value, desc] of configs) {
            await pool.query(
                `INSERT IGNORE INTO ai_config (config_key, config_value, description) VALUES (?, ?, ?)`,
                [key, value, desc]
            );
        }
        console.log('   ✅ Config entries added');

        console.log('\n✅ Anomaly Detection migration completed successfully!');

    } catch (error) {
        console.error('❌ Migration failed:', error);
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate();
