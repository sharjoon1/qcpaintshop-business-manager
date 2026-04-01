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

        console.log('Connected to database. Running vendor management migration...\n');

        // 1. vendors
        console.log('1. Creating vendors table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS vendors (
                id INT AUTO_INCREMENT PRIMARY KEY,
                zoho_contact_id VARCHAR(50) NULL,
                vendor_name VARCHAR(255) NOT NULL,
                contact_person VARCHAR(255),
                phone VARCHAR(20),
                email VARCHAR(100),
                address TEXT,
                gst_number VARCHAR(20),
                payment_terms INT DEFAULT 30,
                status ENUM('active','inactive') DEFAULT 'active',
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_status (status),
                INDEX idx_zoho_contact_id (zoho_contact_id),
                INDEX idx_vendor_name (vendor_name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ vendors table created');

        // 2. vendor_bills
        console.log('2. Creating vendor_bills table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS vendor_bills (
                id INT AUTO_INCREMENT PRIMARY KEY,
                vendor_id INT NOT NULL,
                bill_number VARCHAR(50),
                bill_date DATE,
                due_date DATE,
                subtotal DECIMAL(12,2) DEFAULT 0,
                tax_amount DECIMAL(12,2) DEFAULT 0,
                grand_total DECIMAL(12,2) DEFAULT 0,
                amount_paid DECIMAL(12,2) DEFAULT 0,
                balance_due DECIMAL(12,2) DEFAULT 0,
                payment_status ENUM('unpaid','partial','paid') DEFAULT 'unpaid',
                zoho_status ENUM('pending','pushed','failed') DEFAULT 'pending',
                zoho_bill_id VARCHAR(50) NULL,
                bill_image VARCHAR(500),
                ai_extracted_data JSON,
                ai_verification_status ENUM('pending','verified','mismatch','corrected') DEFAULT 'pending',
                ai_verification_result JSON,
                verified_at TIMESTAMP NULL,
                verified_by INT NULL,
                entered_by INT NOT NULL,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
                INDEX idx_vendor_id (vendor_id),
                INDEX idx_payment_status (payment_status),
                INDEX idx_zoho_status (zoho_status),
                INDEX idx_ai_verification_status (ai_verification_status),
                INDEX idx_bill_date (bill_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ vendor_bills table created');

        // 3. vendor_bill_items
        console.log('3. Creating vendor_bill_items table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS vendor_bill_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                bill_id INT NOT NULL,
                zoho_item_id VARCHAR(50) NULL,
                item_name VARCHAR(255) NOT NULL,
                quantity DECIMAL(10,2) NOT NULL,
                unit_price DECIMAL(10,2) NOT NULL,
                line_total DECIMAL(12,2) NOT NULL,
                ai_matched BOOLEAN DEFAULT FALSE,
                ai_confidence DECIMAL(3,2) NULL,
                FOREIGN KEY (bill_id) REFERENCES vendor_bills(id) ON DELETE CASCADE,
                INDEX idx_bill_id (bill_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ vendor_bill_items table created');

        // 4. vendor_purchase_orders
        console.log('4. Creating vendor_purchase_orders table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS vendor_purchase_orders (
                id INT AUTO_INCREMENT PRIMARY KEY,
                po_number VARCHAR(20) NOT NULL UNIQUE,
                vendor_id INT NOT NULL,
                created_by INT NOT NULL,
                subtotal DECIMAL(12,2) DEFAULT 0,
                tax_amount DECIMAL(12,2) DEFAULT 0,
                grand_total DECIMAL(12,2) DEFAULT 0,
                status ENUM('draft','sent','received','cancelled') DEFAULT 'draft',
                zoho_po_id VARCHAR(50) NULL,
                expected_date DATE,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
                INDEX idx_vendor_id (vendor_id),
                INDEX idx_status (status),
                INDEX idx_created_by (created_by)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ vendor_purchase_orders table created');

        // 5. vendor_po_items
        console.log('5. Creating vendor_po_items table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS vendor_po_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                po_id INT NOT NULL,
                zoho_item_id VARCHAR(50),
                item_name VARCHAR(255) NOT NULL,
                quantity DECIMAL(10,2) NOT NULL,
                unit_price DECIMAL(10,2) NOT NULL,
                line_total DECIMAL(12,2) NOT NULL,
                FOREIGN KEY (po_id) REFERENCES vendor_purchase_orders(id) ON DELETE CASCADE,
                INDEX idx_po_id (po_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ vendor_po_items table created');

        // 6. vendor_payments
        console.log('6. Creating vendor_payments table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS vendor_payments (
                id INT AUTO_INCREMENT PRIMARY KEY,
                vendor_id INT NOT NULL,
                bill_id INT NULL,
                amount DECIMAL(12,2) NOT NULL,
                payment_method ENUM('bank_transfer','cheque','upi','cash') NOT NULL,
                payment_reference VARCHAR(100),
                payment_date DATE NOT NULL,
                paid_by INT NOT NULL,
                zoho_payment_id VARCHAR(50) NULL,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
                FOREIGN KEY (bill_id) REFERENCES vendor_bills(id) ON DELETE SET NULL,
                INDEX idx_vendor_id (vendor_id),
                INDEX idx_bill_id (bill_id),
                INDEX idx_payment_date (payment_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ vendor_payments table created');

        // 7. Permissions
        console.log('\n7. Checking vendor permissions...');
        const permissions = [
            ['vendors', 'view', 'Vendor View', 'View vendors and their bills'],
            ['vendors', 'manage', 'Vendor Manage', 'Create, edit, and manage vendors and bills'],
            ['vendors', 'purchase_orders', 'Vendor Purchase Orders', 'Create and manage purchase orders']
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

        // 8. Config
        console.log('\n8. Seeding vendor config...');
        const config = [
            ['vendor_management_enabled', '1'],
            ['vendor_ai_scan_enabled', '1'],
            ['vendor_po_prefix', 'PO']
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

        console.log('\n✅ Vendor management migration completed successfully!');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate();
