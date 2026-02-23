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

        console.log('Connected to database. Running painter estimates migration...\n');

        // 1. painter_estimates - Core estimate table
        console.log('1. Creating painter_estimates table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_estimates (
                id INT AUTO_INCREMENT PRIMARY KEY,
                estimate_number VARCHAR(20) NOT NULL UNIQUE,
                painter_id INT NOT NULL,
                billing_type ENUM('self','customer') NOT NULL,
                customer_name VARCHAR(255),
                customer_phone VARCHAR(20),
                customer_address TEXT,
                subtotal DECIMAL(12,2) DEFAULT 0,
                gst_amount DECIMAL(12,2) DEFAULT 0,
                grand_total DECIMAL(12,2) DEFAULT 0,
                markup_subtotal DECIMAL(12,2) DEFAULT 0,
                markup_gst_amount DECIMAL(12,2) DEFAULT 0,
                markup_grand_total DECIMAL(12,2) DEFAULT 0,
                status ENUM('draft','pending_admin','admin_review','approved','sent_to_customer','payment_recorded','pushed_to_zoho','rejected','cancelled') DEFAULT 'draft',
                payment_method VARCHAR(50),
                payment_reference VARCHAR(255),
                payment_amount DECIMAL(12,2) DEFAULT 0,
                payment_recorded_by INT,
                payment_recorded_at DATETIME,
                zoho_invoice_id VARCHAR(100),
                zoho_invoice_number VARCHAR(100),
                zoho_contact_id VARCHAR(100),
                points_awarded DECIMAL(12,2) DEFAULT 0,
                regular_points_awarded DECIMAL(12,2) DEFAULT 0,
                annual_points_awarded DECIMAL(12,2) DEFAULT 0,
                share_token VARCHAR(64),
                share_token_expires_at DATETIME,
                notes TEXT,
                admin_notes TEXT,
                created_by_painter INT NOT NULL,
                reviewed_by INT,
                reviewed_at DATETIME,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (painter_id) REFERENCES painters(id) ON DELETE CASCADE,
                INDEX idx_painter (painter_id),
                INDEX idx_status (status),
                INDEX idx_billing_type (billing_type),
                INDEX idx_estimate_number (estimate_number),
                INDEX idx_share_token (share_token)
            )
        `);
        console.log('   ✅ painter_estimates table created');

        // 2. painter_estimate_items - Line items
        console.log('2. Creating painter_estimate_items table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_estimate_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                estimate_id INT NOT NULL,
                zoho_item_id VARCHAR(100) NOT NULL,
                item_name VARCHAR(255) NOT NULL,
                brand VARCHAR(100),
                category VARCHAR(100),
                quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
                unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
                line_total DECIMAL(12,2) NOT NULL DEFAULT 0,
                markup_unit_price DECIMAL(12,2) DEFAULT 0,
                markup_line_total DECIMAL(12,2) DEFAULT 0,
                display_order INT DEFAULT 0,
                FOREIGN KEY (estimate_id) REFERENCES painter_estimates(id) ON DELETE CASCADE,
                INDEX idx_estimate (estimate_id)
            )
        `);
        console.log('   ✅ painter_estimate_items table created');

        // 3. Seed estimate settings
        console.log('\n3. Seeding estimate settings...');
        const settings = [
            ['painter_estimate_gst_pct', '18'],
            ['painter_estimate_enabled', '1']
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

        // 4. Add estimate permissions
        console.log('\n4. Checking estimate permissions...');
        const permissions = [
            ['painters', 'estimates', 'Manage Estimates', 'Review, approve, and manage painter estimates']
        ];
        for (const [module, action, displayName, desc] of permissions) {
            const [existing] = await pool.query('SELECT id FROM permissions WHERE module = ? AND action = ?', [module, action]);
            if (existing.length === 0) {
                await pool.query(
                    'INSERT INTO permissions (module, action, display_name, description) VALUES (?, ?, ?, ?)',
                    [module, action, displayName, desc]
                );
                console.log(`   ✅ Permission '${module}.${action}' added`);
            } else {
                console.log(`   ⏭️ Permission '${module}.${action}' already exists`);
            }
        }

        console.log('\n✅ Painter estimates migration completed successfully!');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate();
