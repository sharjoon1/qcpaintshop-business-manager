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

        console.log('Connected to database. Running painter attendance migration...\n');

        // 1. painter_attendance_checkins
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_attendance_checkins (
                id INT PRIMARY KEY AUTO_INCREMENT,
                painter_id INT NOT NULL,
                branch_id INT NOT NULL,
                checkin_date DATE NOT NULL,
                checkin_at DATETIME NOT NULL,
                latitude DECIMAL(10,8) NOT NULL,
                longitude DECIMAL(11,8) NOT NULL,
                distance_meters INT NOT NULL,
                selfie_path VARCHAR(500) NOT NULL,
                status ENUM('approved','rejected') NOT NULL DEFAULT 'approved',
                rejected_at DATETIME NULL,
                rejected_reason VARCHAR(500) NULL,
                rejected_by INT NULL,
                points_awarded INT NOT NULL DEFAULT 100,
                month_key CHAR(7) GENERATED ALWAYS AS (DATE_FORMAT(checkin_date, '%Y-%m')) VIRTUAL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uk_painter_day (painter_id, checkin_date),
                INDEX idx_month (painter_id, month_key),
                INDEX idx_branch_date (branch_id, checkin_date),
                INDEX idx_status_date (status, checkin_date),
                FOREIGN KEY (painter_id) REFERENCES painters(id) ON DELETE CASCADE,
                FOREIGN KEY (branch_id) REFERENCES branches(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        console.log('✓ painter_attendance_checkins created');

        // 2. painter_attendance_monthly
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_attendance_monthly (
                id INT PRIMARY KEY AUTO_INCREMENT,
                painter_id INT NOT NULL,
                month_key CHAR(7) NOT NULL,
                total_checkins INT NOT NULL DEFAULT 0,
                total_ap_earned INT NOT NULL DEFAULT 0,
                monthly_customer_billed DECIMAL(12,2) NOT NULL DEFAULT 0,
                claim_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
                claimable_ap INT NOT NULL DEFAULT 0,
                ap_claimed INT NOT NULL DEFAULT 0,
                claim_status ENUM('pending','available','claimed','forfeited') NOT NULL DEFAULT 'pending',
                claim_window_opens_at DATETIME NULL,
                claim_window_closes_at DATETIME NULL,
                claimed_at DATETIME NULL,
                forfeited_at DATETIME NULL,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_painter_month (painter_id, month_key),
                INDEX idx_status_month (claim_status, month_key),
                FOREIGN KEY (painter_id) REFERENCES painters(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        console.log('✓ painter_attendance_monthly created');

        // 3. painter_attendance_ledger
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_attendance_ledger (
                id INT PRIMARY KEY AUTO_INCREMENT,
                painter_id INT NOT NULL,
                month_key CHAR(7) NOT NULL,
                checkin_id INT NULL,
                type ENUM('earn','claim','clawback','forfeit') NOT NULL,
                ap_delta INT NOT NULL,
                reason VARCHAR(500) NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                created_by INT NULL,
                INDEX idx_painter_month (painter_id, month_key),
                INDEX idx_type_created (type, created_at),
                FOREIGN KEY (painter_id) REFERENCES painters(id) ON DELETE CASCADE,
                FOREIGN KEY (checkin_id) REFERENCES painter_attendance_checkins(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        console.log('✓ painter_attendance_ledger created');

        // 4. painter_clawback_pending
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_clawback_pending (
                id INT PRIMARY KEY AUTO_INCREMENT,
                painter_id INT NOT NULL,
                amount INT NOT NULL,
                reason VARCHAR(500) NULL,
                source VARCHAR(50) NOT NULL DEFAULT 'attendance',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                settled_at DATETIME NULL,
                settled_ledger_id INT NULL,
                INDEX idx_painter_unsettled (painter_id, settled_at),
                FOREIGN KEY (painter_id) REFERENCES painters(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        console.log('✓ painter_clawback_pending created');

        // 5. ai_config rows
        const configRows = [
            ['painter_attendance_enabled', '1'],
            ['painter_attendance_points_per_day', '100'],
            ['painter_attendance_claim_rupees_per_pct', '1000'],
            ['painter_attendance_claim_max_pct', '100'],
            ['painter_attendance_geofence_meters', '300'],
            ['painter_attendance_claim_window_days', '7'],
            ['painter_attendance_image_retention_days', '8']
        ];
        for (const [k, v] of configRows) {
            await pool.query(
                'INSERT IGNORE INTO ai_config (config_key, config_value) VALUES (?, ?)',
                [k, v]
            );
        }
        console.log(`✓ ${configRows.length} ai_config rows inserted`);

        // 6. Log branches missing GPS
        const [missing] = await pool.query(
            "SELECT id, name FROM branches WHERE status='active' AND (latitude IS NULL OR longitude IS NULL)"
        );
        if (missing.length > 0) {
            console.log(`\n⚠ ${missing.length} active branches missing GPS coordinates:`);
            missing.forEach(b => console.log(`   [${b.id}] ${b.name}`));
            console.log('   Set via admin branch-edit UI before enabling attendance.');
        } else {
            console.log('✓ All active branches have GPS coordinates');
        }

        console.log('\n✅ Migration completed successfully.');
    } catch (err) {
        console.error('❌ Migration failed:', err);
        process.exit(1);
    } finally {
        if (pool) await pool.end();
    }
}

migrate();
