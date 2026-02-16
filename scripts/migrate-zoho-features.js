/**
 * Migration: Create Zoho Books Feature Enhancement tables
 * Run: node scripts/migrate-zoho-features.js
 *
 * Tables created:
 *   - zoho_bulk_jobs            (Bulk update job tracking)
 *   - zoho_bulk_job_items       (Individual items within a bulk job)
 *   - zoho_locations_map        (Branch <-> Zoho location mapping)
 *   - zoho_location_stock       (Per-item per-location stock cache)
 *   - zoho_stock_history        (Stock movement audit trail)
 *   - zoho_daily_transactions   (Daily summary per location)
 *   - zoho_daily_transaction_details (Individual transaction line items)
 *   - zoho_reorder_config       (Per-item per-location reorder thresholds)
 *   - zoho_reorder_alerts       (Active alerts with severity tracking)
 *
 * Also:
 *   - ALTER branches: add zoho_location_id
 *   - New config keys in zoho_config
 *   - New permissions
 *   - ALTER zoho_sync_log: expand sync_type enum
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
        console.log('Starting Zoho Features Enhancement migration...\n');

        // 1. Bulk Jobs
        console.log('1/9 Creating zoho_bulk_jobs...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS zoho_bulk_jobs (
                id INT PRIMARY KEY AUTO_INCREMENT,
                job_type ENUM('item_update','price_update','stock_adjustment') NOT NULL DEFAULT 'item_update',
                status ENUM('pending','processing','completed','failed','cancelled') DEFAULT 'pending',
                total_items INT DEFAULT 0,
                processed_items INT DEFAULT 0,
                failed_items INT DEFAULT 0,
                skipped_items INT DEFAULT 0,
                filter_criteria JSON COMMENT 'Filters used to select items',
                update_fields JSON COMMENT 'Fields and values being updated',
                error_message TEXT,
                created_by INT,
                started_at DATETIME,
                completed_at DATETIME,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                KEY idx_status (status),
                KEY idx_created_by (created_by),
                KEY idx_created_at (created_at),
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ zoho_bulk_jobs created');

        // 2. Bulk Job Items
        console.log('2/9 Creating zoho_bulk_job_items...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS zoho_bulk_job_items (
                id INT PRIMARY KEY AUTO_INCREMENT,
                job_id INT NOT NULL,
                zoho_item_id VARCHAR(50) NOT NULL,
                item_name VARCHAR(255),
                payload JSON COMMENT 'Data to send to Zoho API',
                status ENUM('pending','processing','completed','failed','skipped') DEFAULT 'pending',
                attempts INT DEFAULT 0,
                error_message TEXT,
                response_data JSON,
                processed_at DATETIME,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                KEY idx_job_id (job_id),
                KEY idx_status (status),
                KEY idx_zoho_item (zoho_item_id),
                FOREIGN KEY (job_id) REFERENCES zoho_bulk_jobs(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ zoho_bulk_job_items created');

        // 3. Locations Map
        console.log('3/9 Creating zoho_locations_map...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS zoho_locations_map (
                id INT PRIMARY KEY AUTO_INCREMENT,
                zoho_location_id VARCHAR(50) NOT NULL,
                zoho_location_name VARCHAR(255),
                local_branch_id INT,
                is_primary TINYINT(1) DEFAULT 0,
                is_active TINYINT(1) DEFAULT 1,
                address TEXT,
                last_synced_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY idx_zoho_location (zoho_location_id),
                KEY idx_branch (local_branch_id),
                FOREIGN KEY (local_branch_id) REFERENCES branches(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ zoho_locations_map created');

        // 4. Location Stock
        console.log('4/9 Creating zoho_location_stock...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS zoho_location_stock (
                id INT PRIMARY KEY AUTO_INCREMENT,
                zoho_item_id VARCHAR(50) NOT NULL,
                zoho_location_id VARCHAR(50) NOT NULL,
                item_name VARCHAR(255),
                sku VARCHAR(100),
                stock_on_hand DECIMAL(12,2) DEFAULT 0,
                available_stock DECIMAL(12,2) DEFAULT 0,
                committed_stock DECIMAL(12,2) DEFAULT 0,
                available_for_sale DECIMAL(12,2) DEFAULT 0,
                last_synced_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY idx_item_location (zoho_item_id, zoho_location_id),
                KEY idx_location (zoho_location_id),
                KEY idx_item (zoho_item_id),
                KEY idx_low_stock (stock_on_hand)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ zoho_location_stock created');

        // 5. Stock History
        console.log('5/9 Creating zoho_stock_history...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS zoho_stock_history (
                id INT PRIMARY KEY AUTO_INCREMENT,
                zoho_item_id VARCHAR(50) NOT NULL,
                zoho_location_id VARCHAR(50) NOT NULL,
                item_name VARCHAR(255),
                previous_stock DECIMAL(12,2) DEFAULT 0,
                new_stock DECIMAL(12,2) DEFAULT 0,
                change_amount DECIMAL(12,2) DEFAULT 0,
                source VARCHAR(50) COMMENT 'sync, adjustment, transfer, sale, purchase',
                reference_id VARCHAR(100) COMMENT 'Invoice/PO/SO ID',
                reference_type VARCHAR(50),
                notes TEXT,
                recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                KEY idx_item (zoho_item_id),
                KEY idx_location (zoho_location_id),
                KEY idx_recorded (recorded_at),
                KEY idx_item_location (zoho_item_id, zoho_location_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ zoho_stock_history created');

        // 6. Daily Transactions
        console.log('6/9 Creating zoho_daily_transactions...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS zoho_daily_transactions (
                id INT PRIMARY KEY AUTO_INCREMENT,
                transaction_date DATE NOT NULL,
                zoho_location_id VARCHAR(50),
                location_name VARCHAR(255),
                invoice_count INT DEFAULT 0,
                invoice_amount DECIMAL(14,2) DEFAULT 0,
                bill_count INT DEFAULT 0,
                bill_amount DECIMAL(14,2) DEFAULT 0,
                sales_order_count INT DEFAULT 0,
                sales_order_amount DECIMAL(14,2) DEFAULT 0,
                purchase_order_count INT DEFAULT 0,
                purchase_order_amount DECIMAL(14,2) DEFAULT 0,
                payment_received_count INT DEFAULT 0,
                payment_received_amount DECIMAL(14,2) DEFAULT 0,
                payment_made_count INT DEFAULT 0,
                payment_made_amount DECIMAL(14,2) DEFAULT 0,
                generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY idx_date_location (transaction_date, zoho_location_id),
                KEY idx_date (transaction_date),
                KEY idx_location (zoho_location_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ zoho_daily_transactions created');

        // 7. Daily Transaction Details
        console.log('7/9 Creating zoho_daily_transaction_details...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS zoho_daily_transaction_details (
                id INT PRIMARY KEY AUTO_INCREMENT,
                daily_transaction_id INT NOT NULL,
                transaction_type ENUM('invoice','bill','sales_order','purchase_order','payment_received','payment_made') NOT NULL,
                zoho_transaction_id VARCHAR(50) NOT NULL,
                transaction_number VARCHAR(100),
                transaction_date DATE,
                contact_name VARCHAR(255),
                amount DECIMAL(14,2) DEFAULT 0,
                status VARCHAR(50),
                zoho_location_id VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                KEY idx_daily (daily_transaction_id),
                KEY idx_type (transaction_type),
                KEY idx_date (transaction_date),
                FOREIGN KEY (daily_transaction_id) REFERENCES zoho_daily_transactions(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ zoho_daily_transaction_details created');

        // 8. Reorder Config
        console.log('8/9 Creating zoho_reorder_config...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS zoho_reorder_config (
                id INT PRIMARY KEY AUTO_INCREMENT,
                zoho_item_id VARCHAR(50) NOT NULL,
                zoho_location_id VARCHAR(50) NOT NULL,
                item_name VARCHAR(255),
                location_name VARCHAR(255),
                reorder_level DECIMAL(12,2) NOT NULL DEFAULT 0,
                reorder_quantity DECIMAL(12,2) DEFAULT 0,
                max_stock DECIMAL(12,2) DEFAULT 0,
                is_active TINYINT(1) DEFAULT 1,
                alert_frequency ENUM('immediate','daily','weekly') DEFAULT 'daily',
                created_by INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY idx_item_location (zoho_item_id, zoho_location_id),
                KEY idx_item (zoho_item_id),
                KEY idx_location (zoho_location_id),
                KEY idx_active (is_active),
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ zoho_reorder_config created');

        // 9. Reorder Alerts
        console.log('9/9 Creating zoho_reorder_alerts...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS zoho_reorder_alerts (
                id INT PRIMARY KEY AUTO_INCREMENT,
                zoho_item_id VARCHAR(50) NOT NULL,
                zoho_location_id VARCHAR(50) NOT NULL,
                reorder_config_id INT,
                item_name VARCHAR(255),
                location_name VARCHAR(255),
                current_stock DECIMAL(12,2) DEFAULT 0,
                reorder_level DECIMAL(12,2) DEFAULT 0,
                reorder_quantity DECIMAL(12,2) DEFAULT 0,
                severity ENUM('critical','high','medium','low') DEFAULT 'low',
                status ENUM('active','acknowledged','resolved','auto_resolved') DEFAULT 'active',
                acknowledged_by INT,
                acknowledged_at DATETIME,
                resolved_by INT,
                resolved_at DATETIME,
                resolution_notes TEXT,
                whatsapp_sent TINYINT(1) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                KEY idx_item (zoho_item_id),
                KEY idx_location (zoho_location_id),
                KEY idx_severity (severity),
                KEY idx_status (status),
                KEY idx_active_alerts (status, severity),
                FOREIGN KEY (reorder_config_id) REFERENCES zoho_reorder_config(id) ON DELETE SET NULL,
                FOREIGN KEY (acknowledged_by) REFERENCES users(id) ON DELETE SET NULL,
                FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ zoho_reorder_alerts created');

        // ALTER branches table
        console.log('\nAltering branches table...');
        try {
            const [cols] = await pool.query(`SHOW COLUMNS FROM branches LIKE 'zoho_location_id'`);
            if (cols.length === 0) {
                await pool.query(`ALTER TABLE branches ADD COLUMN zoho_location_id VARCHAR(50) NULL`);
                console.log('   ✅ Added zoho_location_id to branches');
            } else {
                console.log('   ⏭️ zoho_location_id already exists in branches');
            }
        } catch (e) {
            console.log('   ⚠️ Could not alter branches table:', e.message);
        }

        // Expand zoho_sync_log sync_type enum
        console.log('\nUpdating zoho_sync_log sync_type enum...');
        try {
            await pool.query(`
                ALTER TABLE zoho_sync_log MODIFY COLUMN sync_type
                ENUM('invoices','payments','customers','items','reports','full','quick','locations','stock','transactions','reorder') NOT NULL
            `);
            console.log('   ✅ zoho_sync_log sync_type expanded');
        } catch (e) {
            console.log('   ⚠️ Could not alter zoho_sync_log:', e.message);
        }

        // Insert new config keys
        console.log('\nInserting new configuration keys...');
        const newConfigs = [
            ['stock_sync_enabled', 'true', 'Enable/disable stock sync'],
            ['stock_sync_interval_hours', '2', 'Stock sync interval in hours'],
            ['reorder_alerts_enabled', 'true', 'Enable/disable reorder alerts'],
            ['reorder_whatsapp_alert', 'false', 'Send WhatsApp for critical reorder alerts'],
            ['reorder_alert_recipients', '', 'Comma-separated user IDs for alert notifications'],
            ['bulk_job_batch_size', '50', 'Number of items per bulk job batch'],
            ['bulk_job_delay_ms', '700', 'Delay between bulk API calls in ms']
        ];

        for (const [key, value, desc] of newConfigs) {
            await pool.query(`
                INSERT IGNORE INTO zoho_config (config_key, config_value, description)
                VALUES (?, ?, ?)
            `, [key, value, desc]);
        }
        console.log('   ✅ New config keys inserted');

        // Add new permissions
        console.log('\nAdding new Zoho permissions...');
        const newPermissions = [
            ['zoho', 'items', 'Manage Items', 'View, edit and manage Zoho Books items'],
            ['zoho', 'stock', 'Manage Stock', 'View stock levels and create stock adjustments'],
            ['zoho', 'locations', 'Manage Locations', 'View and manage warehouse/location mappings'],
            ['zoho', 'reorder', 'Manage Reorder Alerts', 'Configure reorder levels, view and action alerts'],
            ['zoho', 'bulk_update', 'Bulk Operations', 'Execute bulk item updates and price changes']
        ];

        const [tables] = await pool.query(`SHOW TABLES LIKE 'permissions'`);
        if (tables.length > 0) {
            for (const [module, action, displayName, desc] of newPermissions) {
                await pool.query(`
                    INSERT INTO permissions (module, action, display_name, description)
                    VALUES (?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description)
                `, [module, action, displayName, desc]);
            }
            console.log('   ✅ New permissions added');

            // Auto-assign to admin role
            const [adminRole] = await pool.query(`SELECT id FROM roles WHERE name = 'admin' LIMIT 1`);
            if (adminRole.length > 0) {
                const [zohoPerms] = await pool.query(`SELECT id FROM permissions WHERE module = 'zoho' AND action IN ('items','stock','locations','reorder','bulk_update')`);
                for (const perm of zohoPerms) {
                    await pool.query(`
                        INSERT IGNORE INTO role_permissions (role_id, permission_id)
                        VALUES (?, ?)
                    `, [adminRole[0].id, perm.id]);
                }
                console.log('   ✅ New permissions assigned to admin role');
            }
        }

        console.log('\n✅ Zoho Features Enhancement migration completed successfully!');
        console.log('\nTables created:');
        console.log('   - zoho_bulk_jobs');
        console.log('   - zoho_bulk_job_items');
        console.log('   - zoho_locations_map');
        console.log('   - zoho_location_stock');
        console.log('   - zoho_stock_history');
        console.log('   - zoho_daily_transactions');
        console.log('   - zoho_daily_transaction_details');
        console.log('   - zoho_reorder_config');
        console.log('   - zoho_reorder_alerts');
        console.log('\nNext: Restart the server to load new features.');

    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

migrate();
