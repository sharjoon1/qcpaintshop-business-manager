/**
 * Migration: Create Zoho Books integration tables
 * Run: node scripts/migrate-zoho-tables.js
 *
 * Tables created:
 *   - zoho_oauth_tokens     (OAuth token storage)
 *   - zoho_invoices          (Invoice cache from Zoho Books)
 *   - zoho_payments          (Payment records)
 *   - zoho_sync_log          (Sync history & status)
 *   - whatsapp_followups     (WhatsApp message queue)
 *   - zoho_financial_reports  (Cached financial reports)
 *   - zoho_customers_map     (Local customer ↔ Zoho customer mapping)
 *   - zoho_items_map         (Local product ↔ Zoho item mapping)
 *   - zoho_config            (Bot configuration stored in DB)
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 5
    });

    try {
        console.log('Starting Zoho Books integration migration...\n');

        // 1. Zoho OAuth tokens
        console.log('1/9 Creating zoho_oauth_tokens...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS zoho_oauth_tokens (
                id INT PRIMARY KEY AUTO_INCREMENT,
                organization_id VARCHAR(50) NOT NULL,
                access_token TEXT NOT NULL,
                refresh_token TEXT NOT NULL,
                token_type VARCHAR(20) DEFAULT 'Zoho-oauthtoken',
                api_domain VARCHAR(100) DEFAULT 'https://www.zohoapis.in',
                expires_at DATETIME NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY idx_org (organization_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ zoho_oauth_tokens created');

        // 2. Zoho customer mapping
        console.log('2/9 Creating zoho_customers_map...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS zoho_customers_map (
                id INT PRIMARY KEY AUTO_INCREMENT,
                local_customer_id INT,
                zoho_contact_id VARCHAR(50) NOT NULL,
                zoho_contact_name VARCHAR(255),
                zoho_email VARCHAR(255),
                zoho_phone VARCHAR(50),
                zoho_gst_no VARCHAR(20),
                zoho_outstanding DECIMAL(12,2) DEFAULT 0,
                zoho_unused_credits DECIMAL(12,2) DEFAULT 0,
                last_synced_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY idx_zoho_contact (zoho_contact_id),
                KEY idx_local_customer (local_customer_id),
                FOREIGN KEY (local_customer_id) REFERENCES customers(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ zoho_customers_map created');

        // 3. Zoho items mapping
        console.log('3/9 Creating zoho_items_map...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS zoho_items_map (
                id INT PRIMARY KEY AUTO_INCREMENT,
                local_product_id INT,
                zoho_item_id VARCHAR(50) NOT NULL,
                zoho_item_name VARCHAR(255),
                zoho_sku VARCHAR(100),
                zoho_rate DECIMAL(12,2),
                zoho_unit VARCHAR(20),
                zoho_tax_id VARCHAR(50),
                last_synced_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY idx_zoho_item (zoho_item_id),
                KEY idx_local_product (local_product_id),
                FOREIGN KEY (local_product_id) REFERENCES products(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ zoho_items_map created');

        // 4. Zoho invoices
        console.log('4/9 Creating zoho_invoices...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS zoho_invoices (
                id INT PRIMARY KEY AUTO_INCREMENT,
                zoho_invoice_id VARCHAR(50) NOT NULL,
                zoho_customer_id VARCHAR(50),
                local_customer_id INT,
                invoice_number VARCHAR(50),
                reference_number VARCHAR(100),
                invoice_date DATE,
                due_date DATE,
                currency_code VARCHAR(10) DEFAULT 'INR',
                sub_total DECIMAL(12,2) DEFAULT 0,
                tax_total DECIMAL(12,2) DEFAULT 0,
                total DECIMAL(12,2) DEFAULT 0,
                balance DECIMAL(12,2) DEFAULT 0,
                status ENUM('draft','sent','overdue','paid','partially_paid','void') DEFAULT 'draft',
                customer_name VARCHAR(255),
                line_items JSON,
                notes TEXT,
                terms TEXT,
                created_time DATETIME,
                last_modified_time DATETIME,
                last_synced_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY idx_zoho_invoice (zoho_invoice_id),
                KEY idx_zoho_customer (zoho_customer_id),
                KEY idx_local_customer (local_customer_id),
                KEY idx_status (status),
                KEY idx_invoice_date (invoice_date),
                KEY idx_due_date (due_date),
                FOREIGN KEY (local_customer_id) REFERENCES customers(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ zoho_invoices created');

        // 5. Zoho payments
        console.log('5/9 Creating zoho_payments...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS zoho_payments (
                id INT PRIMARY KEY AUTO_INCREMENT,
                zoho_payment_id VARCHAR(50) NOT NULL,
                zoho_invoice_id VARCHAR(50),
                zoho_customer_id VARCHAR(50),
                local_customer_id INT,
                payment_number VARCHAR(50),
                payment_date DATE,
                amount DECIMAL(12,2) NOT NULL,
                unused_amount DECIMAL(12,2) DEFAULT 0,
                payment_mode VARCHAR(50),
                reference_number VARCHAR(100),
                description TEXT,
                customer_name VARCHAR(255),
                bank_charges DECIMAL(12,2) DEFAULT 0,
                last_synced_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY idx_zoho_payment (zoho_payment_id),
                KEY idx_zoho_invoice (zoho_invoice_id),
                KEY idx_payment_date (payment_date),
                FOREIGN KEY (local_customer_id) REFERENCES customers(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ zoho_payments created');

        // 6. Sync log
        console.log('6/9 Creating zoho_sync_log...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS zoho_sync_log (
                id INT PRIMARY KEY AUTO_INCREMENT,
                sync_type ENUM('invoices','payments','customers','items','reports','full') NOT NULL,
                direction ENUM('zoho_to_local','local_to_zoho','bidirectional') DEFAULT 'zoho_to_local',
                status ENUM('started','in_progress','completed','failed') DEFAULT 'started',
                records_total INT DEFAULT 0,
                records_synced INT DEFAULT 0,
                records_failed INT DEFAULT 0,
                error_message TEXT,
                triggered_by INT COMMENT 'user_id who triggered, NULL for auto',
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP NULL,
                KEY idx_sync_type (sync_type),
                KEY idx_status (status),
                KEY idx_started (started_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ zoho_sync_log created');

        // 7. WhatsApp followups
        console.log('7/9 Creating whatsapp_followups...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS whatsapp_followups (
                id INT PRIMARY KEY AUTO_INCREMENT,
                customer_id INT,
                zoho_customer_id VARCHAR(50),
                zoho_invoice_id VARCHAR(50),
                customer_name VARCHAR(255),
                phone VARCHAR(20) NOT NULL,
                message_type ENUM('payment_reminder','overdue_notice','thank_you','custom','followup') DEFAULT 'payment_reminder',
                message_body TEXT NOT NULL,
                amount DECIMAL(12,2),
                status ENUM('pending','sent','failed','cancelled') DEFAULT 'pending',
                scheduled_at DATETIME,
                sent_at DATETIME,
                error_message TEXT,
                retry_count INT DEFAULT 0,
                created_by INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                KEY idx_status (status),
                KEY idx_scheduled (scheduled_at),
                KEY idx_phone (phone),
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ whatsapp_followups created');

        // 8. Financial reports cache
        console.log('8/9 Creating zoho_financial_reports...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS zoho_financial_reports (
                id INT PRIMARY KEY AUTO_INCREMENT,
                report_type VARCHAR(50) NOT NULL COMMENT 'profit_loss, balance_sheet, cash_flow, receivables_summary, aging_summary, sales_by_customer, sales_by_item',
                report_period VARCHAR(30) NOT NULL COMMENT 'monthly/quarterly/yearly + date range',
                from_date DATE,
                to_date DATE,
                report_data JSON NOT NULL,
                summary JSON COMMENT 'Key totals for quick dashboard access',
                generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                KEY idx_report_type (report_type),
                KEY idx_period (report_period),
                KEY idx_dates (from_date, to_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ zoho_financial_reports created');

        // 9. Zoho config (replaces .env for bot-specific settings)
        console.log('9/9 Creating zoho_config...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS zoho_config (
                id INT PRIMARY KEY AUTO_INCREMENT,
                config_key VARCHAR(100) NOT NULL,
                config_value TEXT,
                description VARCHAR(255),
                updated_by INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY idx_config_key (config_key),
                FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ zoho_config created');

        // Insert default config values
        console.log('\nInserting default configuration...');
        const defaultConfigs = [
            ['sync_interval_minutes', '30', 'Auto-sync interval in minutes'],
            ['sync_enabled', 'true', 'Enable/disable auto sync'],
            ['whatsapp_enabled', 'false', 'Enable/disable WhatsApp followups'],
            ['whatsapp_api_url', '', 'WhatsApp Business API URL'],
            ['whatsapp_api_key', '', 'WhatsApp Business API key'],
            ['overdue_reminder_days', '7,14,30', 'Days after due date to send reminders'],
            ['daily_report_enabled', 'false', 'Enable daily financial summary'],
            ['daily_report_time', '09:00', 'Time to generate daily report (HH:MM)'],
            ['ai_analysis_enabled', 'false', 'Enable AI-powered analysis'],
            ['last_full_sync', '', 'Timestamp of last full sync']
        ];

        for (const [key, value, desc] of defaultConfigs) {
            await pool.query(`
                INSERT IGNORE INTO zoho_config (config_key, config_value, description)
                VALUES (?, ?, ?)
            `, [key, value, desc]);
        }
        console.log('   ✅ Default config inserted');

        // Add zoho permissions to the permissions system
        console.log('\nAdding Zoho permissions...');
        const zohoPermissions = [
            ['zoho', 'view', 'View Zoho Books Dashboard', 'View Zoho Books data and sync logs'],
            ['zoho', 'sync', 'Sync Data with Zoho', 'Trigger manual sync of invoices, items, customers, stock'],
            ['zoho', 'manage', 'Manage Zoho Settings', 'Manage Zoho configuration, OAuth, scheduler, mappings'],
            ['zoho', 'reports', 'View Zoho Reports', 'View financial and transaction reports from Zoho Books'],
            ['zoho', 'whatsapp', 'WhatsApp Followups', 'Send and manage WhatsApp followup messages'],
            ['zoho', 'invoices', 'Manage Invoices', 'View and manage Zoho Books invoices and payments']
        ];

        // Check if permissions table exists and has the right structure
        const [tables] = await pool.query(`SHOW TABLES LIKE 'permissions'`);
        if (tables.length > 0) {
            for (const [module, action, displayName, desc] of zohoPermissions) {
                await pool.query(`
                    INSERT INTO permissions (module, action, display_name, description)
                    VALUES (?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description)
                `, [module, action, displayName, desc]);
            }
            console.log('   ✅ Zoho permissions added');

            // Auto-assign all zoho permissions to admin role
            const [adminRole] = await pool.query(`SELECT id FROM roles WHERE name = 'admin' LIMIT 1`);
            if (adminRole.length > 0) {
                const [zohoPerms] = await pool.query(`SELECT id FROM permissions WHERE module = 'zoho'`);
                for (const perm of zohoPerms) {
                    await pool.query(`
                        INSERT IGNORE INTO role_permissions (role_id, permission_id)
                        VALUES (?, ?)
                    `, [adminRole[0].id, perm.id]);
                }
                console.log('   ✅ Zoho permissions assigned to admin role');
            }
        } else {
            console.log('   ⚠️ permissions table not found, skipping permission setup');
        }

        console.log('\n✅ Zoho Books integration migration completed successfully!');
        console.log('\nTables created:');
        console.log('   - zoho_oauth_tokens');
        console.log('   - zoho_customers_map');
        console.log('   - zoho_items_map');
        console.log('   - zoho_invoices');
        console.log('   - zoho_payments');
        console.log('   - zoho_sync_log');
        console.log('   - whatsapp_followups');
        console.log('   - zoho_financial_reports');
        console.log('   - zoho_config');
        console.log('\nNext: Add ZOHO_* variables to .env and restart the server.');

    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

migrate();
