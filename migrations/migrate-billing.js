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

        console.log('Connected to database. Running billing migration...\n');

        // 1. billing_estimates
        console.log('1. Creating billing_estimates table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS billing_estimates (
                id INT AUTO_INCREMENT PRIMARY KEY,
                estimate_number VARCHAR(20) NOT NULL UNIQUE,
                created_by INT NOT NULL,
                branch_id INT NOT NULL,
                customer_type ENUM('customer','painter') NOT NULL,
                customer_id INT NULL,
                painter_id INT NULL,
                customer_name VARCHAR(255) NOT NULL,
                customer_phone VARCHAR(20),
                customer_address TEXT,
                subtotal DECIMAL(12,2) DEFAULT 0,
                discount_amount DECIMAL(12,2) DEFAULT 0,
                grand_total DECIMAL(12,2) DEFAULT 0,
                status ENUM('draft','sent','approved','converted','cancelled') DEFAULT 'draft',
                converted_to_invoice_id INT NULL,
                notes TEXT,
                valid_until DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_status (status),
                INDEX idx_created_by (created_by),
                INDEX idx_branch_id (branch_id),
                INDEX idx_customer_type (customer_type),
                INDEX idx_created_at (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ billing_estimates table created');

        // 2. billing_estimate_items
        console.log('2. Creating billing_estimate_items table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS billing_estimate_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                estimate_id INT NOT NULL,
                zoho_item_id VARCHAR(50),
                item_name VARCHAR(255) NOT NULL,
                pack_size VARCHAR(100),
                quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
                unit_price DECIMAL(10,2) NOT NULL DEFAULT 0,
                line_total DECIMAL(12,2) NOT NULL DEFAULT 0,
                display_order INT DEFAULT 0,
                FOREIGN KEY (estimate_id) REFERENCES billing_estimates(id) ON DELETE CASCADE,
                INDEX idx_estimate_id (estimate_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ billing_estimate_items table created');

        // 3. billing_invoices
        console.log('3. Creating billing_invoices table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS billing_invoices (
                id INT AUTO_INCREMENT PRIMARY KEY,
                invoice_number VARCHAR(20) NOT NULL UNIQUE,
                created_by INT NOT NULL,
                branch_id INT NOT NULL,
                source ENUM('direct','estimate') DEFAULT 'direct',
                estimate_id INT NULL,
                customer_type ENUM('customer','painter') NOT NULL,
                customer_id INT NULL,
                painter_id INT NULL,
                customer_name VARCHAR(255) NOT NULL,
                customer_phone VARCHAR(20),
                customer_address TEXT,
                subtotal DECIMAL(12,2) DEFAULT 0,
                discount_amount DECIMAL(12,2) DEFAULT 0,
                grand_total DECIMAL(12,2) DEFAULT 0,
                amount_paid DECIMAL(12,2) DEFAULT 0,
                balance_due DECIMAL(12,2) DEFAULT 0,
                payment_status ENUM('unpaid','partial','paid') DEFAULT 'unpaid',
                zoho_status ENUM('pending','pushed','failed') DEFAULT 'pending',
                zoho_invoice_id VARCHAR(50) NULL,
                zoho_invoice_number VARCHAR(50) NULL,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_payment_status (payment_status),
                INDEX idx_zoho_status (zoho_status),
                INDEX idx_created_by (created_by),
                INDEX idx_branch_id (branch_id),
                INDEX idx_customer_type (customer_type),
                INDEX idx_created_at (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ billing_invoices table created');

        // 4. billing_invoice_items
        console.log('4. Creating billing_invoice_items table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS billing_invoice_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                invoice_id INT NOT NULL,
                zoho_item_id VARCHAR(50),
                item_name VARCHAR(255) NOT NULL,
                pack_size VARCHAR(100),
                quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
                unit_price DECIMAL(10,2) NOT NULL DEFAULT 0,
                line_total DECIMAL(12,2) NOT NULL DEFAULT 0,
                display_order INT DEFAULT 0,
                FOREIGN KEY (invoice_id) REFERENCES billing_invoices(id) ON DELETE CASCADE,
                INDEX idx_invoice_id (invoice_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ billing_invoice_items table created');

        // 5. billing_payments
        console.log('5. Creating billing_payments table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS billing_payments (
                id INT AUTO_INCREMENT PRIMARY KEY,
                invoice_id INT NOT NULL,
                amount DECIMAL(12,2) NOT NULL,
                payment_method ENUM('cash','upi','bank_transfer','cheque','credit') NOT NULL,
                payment_reference VARCHAR(100),
                received_by INT NOT NULL,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (invoice_id) REFERENCES billing_invoices(id) ON DELETE CASCADE,
                INDEX idx_invoice_id (invoice_id),
                INDEX idx_received_by (received_by),
                INDEX idx_created_at (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ billing_payments table created');

        // 6. Permissions
        console.log('\n6. Checking billing permissions...');
        const permissions = [
            ['billing', 'estimate', 'Billing Estimates', 'Create and manage billing estimates'],
            ['billing', 'invoice', 'Billing Invoices', 'Create and manage billing invoices'],
            ['billing', 'payment', 'Billing Payments', 'Record and manage payments'],
            ['billing', 'zoho_push', 'Billing Zoho Push', 'Push invoices to Zoho Books']
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

        // 7. Config
        console.log('\n7. Seeding billing config...');
        const config = [
            ['billing_enabled', '1'],
            ['billing_estimate_prefix', 'BE'],
            ['billing_invoice_prefix', 'BI'],
            ['billing_gst_inclusive', '1']
        ];
        let seeded = 0;
        for (const [key, value] of config) {
            const [existing] = await pool.query('SELECT config_key FROM ai_config WHERE config_key = ?', [key]);
            if (existing.length === 0) {
                await pool.query('INSERT INTO ai_config (config_key, config_value) VALUES (?, ?)', [key, value]);
                seeded++;
            }
        }
        console.log(`   ✅ ${seeded} new config entries seeded`);

        console.log('\n✅ Billing migration completed successfully!');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate();
