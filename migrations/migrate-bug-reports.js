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

        console.log('Connected to database. Running bug reports migration...\n');

        // 1. Enhance error_logs table with deduplication & analysis columns
        console.log('1. Enhancing error_logs table...');
        const errorLogColumns = [
            { column: 'frequency_count', sql: 'ALTER TABLE error_logs ADD COLUMN frequency_count INT DEFAULT 1' },
            { column: 'error_hash', sql: 'ALTER TABLE error_logs ADD COLUMN error_hash VARCHAR(64) NULL' },
            { column: 'file_path', sql: 'ALTER TABLE error_logs ADD COLUMN file_path VARCHAR(500) NULL' },
            { column: 'line_number', sql: 'ALTER TABLE error_logs ADD COLUMN line_number INT NULL' },
            { column: 'function_name', sql: 'ALTER TABLE error_logs ADD COLUMN function_name VARCHAR(200) NULL' },
            { column: 'branch_id', sql: 'ALTER TABLE error_logs ADD COLUMN branch_id INT NULL' },
            { column: 'last_occurrence', sql: 'ALTER TABLE error_logs ADD COLUMN last_occurrence TIMESTAMP NULL' }
        ];

        for (const col of errorLogColumns) {
            const [cols] = await pool.query(`
                SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'error_logs' AND COLUMN_NAME = ?
            `, [col.column]);
            if (cols.length === 0) {
                try {
                    await pool.query(col.sql);
                    console.log(`   ✅ error_logs.${col.column} added`);
                } catch (e) {
                    console.log(`   ⚠️ error_logs.${col.column} skipped: ${e.message}`);
                }
            } else {
                console.log(`   ⏭️ error_logs.${col.column} already exists`);
            }
        }

        // Add index on error_hash for dedup lookups
        try {
            const [indexes] = await pool.query(`
                SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'error_logs' AND INDEX_NAME = 'idx_error_hash'
            `);
            if (indexes.length === 0) {
                await pool.query('ALTER TABLE error_logs ADD INDEX idx_error_hash (error_hash)');
                console.log('   ✅ idx_error_hash index added');
            }
        } catch (e) {
            console.log(`   ⚠️ idx_error_hash index skipped: ${e.message}`);
        }

        // 2. Create bug_reports table
        console.log('\n2. Creating bug_reports table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS bug_reports (
                id INT PRIMARY KEY AUTO_INCREMENT,
                title VARCHAR(500) NOT NULL,
                description TEXT,
                steps_to_reproduce TEXT,
                expected_behavior TEXT,
                actual_behavior TEXT,
                module VARCHAR(100),
                priority ENUM('critical', 'high', 'medium', 'low') DEFAULT 'medium',
                status ENUM('open', 'investigating', 'in_progress', 'fixed', 'closed', 'wont_fix') DEFAULT 'open',
                reported_by INT,
                assigned_to INT,
                related_error_id INT,
                error_hash VARCHAR(64),
                environment VARCHAR(50) DEFAULT 'production',
                browser_info VARCHAR(500),
                resolution_notes TEXT,
                fix_commit VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                resolved_at TIMESTAMP NULL,
                INDEX idx_bug_status (status),
                INDEX idx_bug_priority (priority),
                INDEX idx_bug_module (module),
                INDEX idx_bug_assigned (assigned_to),
                INDEX idx_bug_error_hash (error_hash),
                INDEX idx_bug_created (created_at)
            )
        `);
        console.log('   ✅ bug_reports table created');

        // 3. Create fix_suggestions table
        console.log('\n3. Creating fix_suggestions table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS fix_suggestions (
                id INT PRIMARY KEY AUTO_INCREMENT,
                error_id INT,
                bug_report_id INT,
                error_hash VARCHAR(64),
                suggestion_type ENUM('code_fix', 'config_change', 'data_fix', 'infrastructure', 'monitoring') DEFAULT 'code_fix',
                title VARCHAR(500) NOT NULL,
                description TEXT,
                suggested_fix TEXT,
                file_path VARCHAR(500),
                confidence DECIMAL(5,2) DEFAULT 0,
                complexity ENUM('trivial', 'simple', 'moderate', 'complex') DEFAULT 'moderate',
                ai_generated TINYINT(1) DEFAULT 0,
                status ENUM('pending', 'approved', 'applied', 'rejected') DEFAULT 'pending',
                applied_by INT,
                applied_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_fix_error (error_id),
                INDEX idx_fix_bug (bug_report_id),
                INDEX idx_fix_hash (error_hash),
                INDEX idx_fix_status (status),
                INDEX idx_fix_confidence (confidence)
            )
        `);
        console.log('   ✅ fix_suggestions table created');

        // 4. Seed config settings
        console.log('\n4. Seeding config settings...');
        const settings = [
            ['bug_tracking_enabled', '1'],
            ['auto_fix_suggestions', '1'],
            ['error_dedup_window_hours', '24'],
            ['fix_suggestion_confidence_threshold', '60']
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

        // 5. Add system.bugs permission
        console.log('\n5. Checking system.bugs permission...');
        const [existingPerm] = await pool.query('SELECT id FROM permissions WHERE module = ? AND action = ?', ['system', 'bugs']);
        if (existingPerm.length === 0) {
            await pool.query(
                'INSERT INTO permissions (module, action, display_name, description) VALUES (?, ?, ?, ?)',
                ['system', 'bugs', 'Bug Reports', 'Manage bug reports and fix suggestions']
            );
            console.log('   ✅ Permission system.bugs added');
        } else {
            console.log('   ⏭️ Permission system.bugs already exists');
        }

        console.log('\n✅ Bug reports migration completed successfully!');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate();
