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

        console.log('Connected to database. Running error prevention migration...\n');

        // 1. error_logs table
        console.log('1. Creating error_logs table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS error_logs (
                id INT PRIMARY KEY AUTO_INCREMENT,
                error_type ENUM('database', 'api', 'frontend', 'validation', 'authentication', 'authorization', 'integration') NOT NULL,
                error_code VARCHAR(50),
                error_message TEXT NOT NULL,
                stack_trace TEXT,
                request_url VARCHAR(500),
                request_method VARCHAR(10),
                request_body JSON,
                user_id INT,
                session_id VARCHAR(100),
                ip_address VARCHAR(45),
                user_agent TEXT,
                severity ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
                status ENUM('new', 'investigating', 'resolved', 'ignored') DEFAULT 'new',
                resolution_notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                resolved_at TIMESTAMP NULL,
                INDEX idx_error_type (error_type),
                INDEX idx_severity (severity),
                INDEX idx_status (status),
                INDEX idx_created_at (created_at)
            )
        `);
        console.log('   ✅ error_logs table created');

        // 2. system_health_checks table
        console.log('\n2. Creating system_health_checks table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS system_health_checks (
                id INT PRIMARY KEY AUTO_INCREMENT,
                check_type ENUM('database', 'api_endpoints', 'file_system', 'memory', 'disk_space', 'external_services') NOT NULL,
                status ENUM('healthy', 'warning', 'critical') NOT NULL,
                details JSON,
                response_time_ms INT,
                checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_check_type (check_type),
                INDEX idx_status (status),
                INDEX idx_checked_at (checked_at)
            )
        `);
        console.log('   ✅ system_health_checks table created');

        // 3. code_quality_metrics table
        console.log('\n3. Creating code_quality_metrics table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS code_quality_metrics (
                id INT PRIMARY KEY AUTO_INCREMENT,
                file_path VARCHAR(500) NOT NULL,
                function_name VARCHAR(100),
                complexity_score INT,
                lines_of_code INT,
                test_coverage DECIMAL(5,2),
                last_modified TIMESTAMP,
                issues JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_file_path (file_path),
                INDEX idx_complexity (complexity_score)
            )
        `);
        console.log('   ✅ code_quality_metrics table created');

        // 4. Add columns to existing tables
        console.log('\n4. Adding error prevention columns to existing tables...');

        const alterations = [
            { table: 'users', column: 'last_validation_check', sql: 'ALTER TABLE users ADD COLUMN last_validation_check TIMESTAMP NULL' },
            { table: 'branches', column: 'data_integrity_score', sql: 'ALTER TABLE branches ADD COLUMN data_integrity_score DECIMAL(3,2) DEFAULT 1.00' },
            { table: 'leads', column: 'validation_errors', sql: 'ALTER TABLE leads ADD COLUMN validation_errors JSON NULL' },
            { table: 'painters', column: 'profile_completeness', sql: 'ALTER TABLE painters ADD COLUMN profile_completeness DECIMAL(3,2) DEFAULT 0.00' }
        ];

        for (const alt of alterations) {
            const [cols] = await pool.query(`
                SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
            `, [alt.table, alt.column]);
            if (cols.length === 0) {
                try {
                    await pool.query(alt.sql);
                    console.log(`   ✅ ${alt.table}.${alt.column} added`);
                } catch (e) {
                    console.log(`   ⚠️ ${alt.table}.${alt.column} skipped: ${e.message}`);
                }
            } else {
                console.log(`   ⏭️ ${alt.table}.${alt.column} already exists`);
            }
        }

        // 5. Seed config settings
        console.log('\n5. Seeding config settings...');
        const settings = [
            ['error_logging_enabled', '1'],
            ['health_check_interval_ms', '300000'],
            ['error_alert_threshold_critical', '1'],
            ['error_alert_threshold_high', '5'],
            ['auto_health_check_enabled', '1']
        ];
        let seeded = 0;
        for (const [key, value] of settings) {
            const [existing] = await pool.query('SELECT config_key FROM ai_config WHERE config_key = ?', [key]);
            if (existing.length === 0) {
                await pool.query('INSERT INTO ai_config (config_key, config_value) VALUES (?, ?)', [key, value]);
                seeded++;
            }
        }
        console.log(`   ✅ ${seeded} new settings seeded`);

        // 6. Add system.health permission
        console.log('\n6. Checking system.health permission...');
        const [existingPerm] = await pool.query('SELECT id FROM permissions WHERE module = ? AND action = ?', ['system', 'health']);
        if (existingPerm.length === 0) {
            await pool.query(
                'INSERT INTO permissions (module, action, display_name, description) VALUES (?, ?, ?, ?)',
                ['system', 'health', 'System Health', 'View system health dashboard and error logs']
            );
            console.log('   ✅ Permission system.health added');
        } else {
            console.log('   ⏭️ Permission system.health already exists');
        }

        console.log('\n✅ Error prevention migration completed successfully!');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate();
