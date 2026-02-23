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

        console.log('Connected to database. Running painter system migration...\n');

        // 1. painters - Core painter profile
        console.log('1. Creating painters table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painters (
                id INT AUTO_INCREMENT PRIMARY KEY,
                full_name VARCHAR(255) NOT NULL,
                phone VARCHAR(20) NOT NULL UNIQUE,
                email VARCHAR(255),
                aadhar_number VARCHAR(20),
                pan_number VARCHAR(20),
                address TEXT,
                city VARCHAR(100),
                district VARCHAR(100),
                state VARCHAR(100) DEFAULT 'Tamil Nadu',
                pincode VARCHAR(10),
                experience_years INT DEFAULT 0,
                specialization ENUM('interior','exterior','both','industrial') DEFAULT 'both',
                profile_photo VARCHAR(500),
                referred_by INT DEFAULT NULL,
                referral_code VARCHAR(20) UNIQUE,
                status ENUM('pending','approved','suspended','rejected') DEFAULT 'pending',
                approved_by INT,
                approved_at DATETIME,
                credit_enabled TINYINT(1) DEFAULT 0,
                credit_limit DECIMAL(12,2) DEFAULT 0,
                credit_used DECIMAL(12,2) DEFAULT 0,
                credit_overdue_days INT DEFAULT 0,
                regular_points DECIMAL(12,2) DEFAULT 0,
                annual_points DECIMAL(12,2) DEFAULT 0,
                total_earned_regular DECIMAL(12,2) DEFAULT 0,
                total_earned_annual DECIMAL(12,2) DEFAULT 0,
                total_redeemed_regular DECIMAL(12,2) DEFAULT 0,
                total_redeemed_annual DECIMAL(12,2) DEFAULT 0,
                zoho_contact_id VARCHAR(50),
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_phone (phone),
                INDEX idx_status (status),
                INDEX idx_referral_code (referral_code),
                INDEX idx_referred_by (referred_by)
            )
        `);
        console.log('   ✅ painters table created');

        // 2. painter_sessions - OTP auth
        console.log('2. Creating painter_sessions table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_sessions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                painter_id INT NOT NULL,
                token VARCHAR(255) NOT NULL UNIQUE,
                otp VARCHAR(6),
                otp_expires_at DATETIME,
                expires_at DATETIME NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (painter_id) REFERENCES painters(id) ON DELETE CASCADE,
                INDEX idx_token (token)
            )
        `);
        console.log('   ✅ painter_sessions table created');

        // 3. painter_point_transactions - Ledger (source of truth)
        console.log('3. Creating painter_point_transactions table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_point_transactions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                painter_id INT NOT NULL,
                pool ENUM('regular','annual') NOT NULL,
                type ENUM('earn','redeem','debit','adjustment','expired') NOT NULL,
                amount DECIMAL(12,2) NOT NULL,
                balance_after DECIMAL(12,2) NOT NULL,
                source ENUM('self_billing','customer_billing','referral','attendance','monthly_slab','quarterly_slab','withdrawal','credit_debit','admin_adjustment') NOT NULL,
                reference_id VARCHAR(100),
                reference_type VARCHAR(50),
                description TEXT,
                created_by INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (painter_id) REFERENCES painters(id) ON DELETE CASCADE,
                INDEX idx_painter_pool (painter_id, pool),
                INDEX idx_source (source),
                INDEX idx_created (created_at)
            )
        `);
        console.log('   ✅ painter_point_transactions table created');

        // 4. painter_referrals - Track referral relationships & billing
        console.log('4. Creating painter_referrals table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_referrals (
                id INT AUTO_INCREMENT PRIMARY KEY,
                referrer_id INT NOT NULL,
                referred_id INT NOT NULL,
                status ENUM('pending','approved','active') DEFAULT 'pending',
                total_bills INT DEFAULT 0,
                current_tier_pct DECIMAL(5,2) DEFAULT 0.50,
                total_referral_points DECIMAL(12,2) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (referrer_id) REFERENCES painters(id),
                FOREIGN KEY (referred_id) REFERENCES painters(id),
                UNIQUE KEY idx_pair (referrer_id, referred_id)
            )
        `);
        console.log('   ✅ painter_referrals table created');

        // 5. painter_product_point_rates - Per-product point config
        console.log('5. Creating painter_product_point_rates table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_product_point_rates (
                id INT AUTO_INCREMENT PRIMARY KEY,
                item_id VARCHAR(100) NOT NULL,
                item_name VARCHAR(255),
                regular_points_per_unit DECIMAL(10,2) DEFAULT 0,
                annual_eligible TINYINT(1) DEFAULT 0,
                annual_pct DECIMAL(5,2) DEFAULT 1.00,
                category VARCHAR(100),
                is_active TINYINT(1) DEFAULT 1,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY idx_item (item_id)
            )
        `);
        console.log('   ✅ painter_product_point_rates table created');

        // 6. painter_value_slabs - Monthly/Quarterly purchase volume thresholds
        console.log('6. Creating painter_value_slabs table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_value_slabs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                period_type ENUM('monthly','quarterly') NOT NULL,
                min_amount DECIMAL(12,2) NOT NULL,
                max_amount DECIMAL(12,2),
                bonus_points DECIMAL(12,2) NOT NULL,
                label VARCHAR(100),
                is_active TINYINT(1) DEFAULT 1,
                INDEX idx_period (period_type, is_active)
            )
        `);
        console.log('   ✅ painter_value_slabs table created');

        // 7. painter_withdrawals - Redemption requests
        console.log('7. Creating painter_withdrawals table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_withdrawals (
                id INT AUTO_INCREMENT PRIMARY KEY,
                painter_id INT NOT NULL,
                pool ENUM('regular','annual') NOT NULL,
                amount DECIMAL(12,2) NOT NULL,
                status ENUM('pending','approved','rejected','paid') DEFAULT 'pending',
                payment_method VARCHAR(50),
                payment_reference VARCHAR(255),
                requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                processed_by INT,
                processed_at DATETIME,
                notes TEXT,
                FOREIGN KEY (painter_id) REFERENCES painters(id),
                INDEX idx_painter (painter_id),
                INDEX idx_status (status)
            )
        `);
        console.log('   ✅ painter_withdrawals table created');

        // 8. painter_attendance - Store visits / events
        console.log('8. Creating painter_attendance table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_attendance (
                id INT AUTO_INCREMENT PRIMARY KEY,
                painter_id INT NOT NULL,
                event_type ENUM('store_visit','training','event','demo') DEFAULT 'store_visit',
                branch_id INT,
                points_awarded DECIMAL(10,2) DEFAULT 0,
                check_in_at DATETIME NOT NULL,
                check_out_at DATETIME,
                notes TEXT,
                verified_by INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (painter_id) REFERENCES painters(id),
                INDEX idx_painter_date (painter_id, check_in_at)
            )
        `);
        console.log('   ✅ painter_attendance table created');

        // 9. painter_invoices_processed - Track which Zoho invoices were already processed
        console.log('9. Creating painter_invoices_processed table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_invoices_processed (
                id INT AUTO_INCREMENT PRIMARY KEY,
                painter_id INT NOT NULL,
                invoice_id VARCHAR(100) NOT NULL,
                invoice_number VARCHAR(100),
                invoice_date DATE,
                invoice_total DECIMAL(12,2),
                billing_type ENUM('self','customer') NOT NULL,
                regular_points DECIMAL(12,2) DEFAULT 0,
                annual_points DECIMAL(12,2) DEFAULT 0,
                referral_points DECIMAL(12,2) DEFAULT 0,
                processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY idx_invoice (invoice_id),
                INDEX idx_painter (painter_id)
            )
        `);
        console.log('   ✅ painter_invoices_processed table created');

        // 10. painter_slab_evaluations - Track monthly/quarterly slab evaluations
        console.log('10. Creating painter_slab_evaluations table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_slab_evaluations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                painter_id INT NOT NULL,
                period_type ENUM('monthly','quarterly') NOT NULL,
                period_label VARCHAR(20) NOT NULL,
                period_start DATE NOT NULL,
                period_end DATE NOT NULL,
                total_purchase DECIMAL(12,2) DEFAULT 0,
                slab_id INT,
                points_awarded DECIMAL(12,2) DEFAULT 0,
                evaluated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY idx_eval (painter_id, period_type, period_label),
                INDEX idx_period (period_type, period_label)
            )
        `);
        console.log('   ✅ painter_slab_evaluations table created');

        // 11. Seed painter settings into ai_config
        console.log('\n11. Seeding painter settings...');
        const settings = [
            ['painter_annual_withdrawal_month', '1'],
            ['painter_annual_withdrawal_day', '1'],
            ['painter_credit_overdue_days', '30'],
            ['painter_attendance_points', '5'],
            ['painter_referral_enabled', '1'],
            ['painter_system_enabled', '1']
        ];
        let seeded = 0;
        for (const [key, value] of settings) {
            const [existing] = await pool.query('SELECT id FROM ai_config WHERE config_key = ?', [key]);
            if (existing.length === 0) {
                await pool.query('INSERT INTO ai_config (config_key, config_value) VALUES (?, ?)', [key, value]);
                seeded++;
            }
        }
        console.log(`   ✅ ${seeded} new settings seeded`);

        // 12. Add painter permissions
        console.log('\n12. Checking painter permissions...');
        const permissions = [
            ['painters.view', 'View Painters', 'painters', 'View painter list and details'],
            ['painters.manage', 'Manage Painters', 'painters', 'Approve, edit, and manage painters'],
            ['painters.points', 'Manage Points', 'painters', 'Adjust points, process invoices, manage withdrawals']
        ];
        for (const [key, name, module, desc] of permissions) {
            const [existing] = await pool.query('SELECT id FROM permissions WHERE permission_key = ?', [key]);
            if (existing.length === 0) {
                await pool.query(
                    'INSERT INTO permissions (permission_key, permission_name, module, description) VALUES (?, ?, ?, ?)',
                    [key, name, module, desc]
                );
                console.log(`   ✅ Permission '${key}' added`);
            } else {
                console.log(`   ⏭️ Permission '${key}' already exists`);
            }
        }

        console.log('\n✅ Painter system migration completed successfully!');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate();
