const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function columnExists(pool, table, column) {
    const [rows] = await pool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
    );
    return rows.length > 0;
}

async function tableExists(pool, table) {
    const [rows] = await pool.query(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [table]
    );
    return rows.length > 0;
}

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

        console.log('Reorder Intelligence migration starting...\n');

        // 1. branch_item_sales
        if (!(await tableExists(pool, 'branch_item_sales'))) {
            await pool.query(`
                CREATE TABLE branch_item_sales (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    local_branch_id INT NOT NULL,
                    zoho_item_id VARCHAR(50) NOT NULL,
                    sale_date DATE NOT NULL,
                    qty_sold DECIMAL(12,2) NOT NULL DEFAULT 0,
                    revenue DECIMAL(12,2) NOT NULL DEFAULT 0,
                    invoice_count INT NOT NULL DEFAULT 0,
                    synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY uq_bis (local_branch_id, zoho_item_id, sale_date),
                    KEY idx_item_date (zoho_item_id, sale_date),
                    KEY idx_branch_date (local_branch_id, sale_date)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            console.log('✅ branch_item_sales created');
        } else {
            console.log('⏭️  branch_item_sales exists');
        }

        // 2. brand_reorder_config + __default__ seed
        if (!(await tableExists(pool, 'brand_reorder_config'))) {
            await pool.query(`
                CREATE TABLE brand_reorder_config (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    brand_name VARCHAR(100) NOT NULL,
                    lead_time_days INT NOT NULL DEFAULT 7,
                    safety_days INT NOT NULL DEFAULT 5,
                    is_active TINYINT(1) NOT NULL DEFAULT 1,
                    updated_by INT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY uq_brand (brand_name)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            await pool.query(
                `INSERT INTO brand_reorder_config (brand_name, lead_time_days, safety_days)
                 VALUES ('__default__', 7, 5)`
            );
            console.log('✅ brand_reorder_config created + __default__ seeded');
        } else {
            console.log('⏭️  brand_reorder_config exists');
        }

        // 3. invoice_line_sync_cursor
        if (!(await tableExists(pool, 'invoice_line_sync_cursor'))) {
            await pool.query(`
                CREATE TABLE invoice_line_sync_cursor (
                    invoice_id VARCHAR(50) PRIMARY KEY,
                    synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    line_count INT
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            console.log('✅ invoice_line_sync_cursor created');
        } else {
            console.log('⏭️  invoice_line_sync_cursor exists');
        }

        // 4. reorder_report_log
        if (!(await tableExists(pool, 'reorder_report_log'))) {
            await pool.query(`
                CREATE TABLE reorder_report_log (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    report_date DATE NOT NULL,
                    scope VARCHAR(50) NOT NULL,
                    items_count INT NOT NULL,
                    delivery_status JSON,
                    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    KEY idx_date_scope (report_date, scope)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            console.log('✅ reorder_report_log created');
        } else {
            console.log('⏭️  reorder_report_log exists');
        }

        // 5. ALTER zoho_reorder_config — add 3 columns if missing
        if (await tableExists(pool, 'zoho_reorder_config')) {
            if (!(await columnExists(pool, 'zoho_reorder_config', 'source'))) {
                await pool.query(
                    `ALTER TABLE zoho_reorder_config ADD COLUMN source ENUM('manual','auto') NOT NULL DEFAULT 'manual'`
                );
                console.log('✅ zoho_reorder_config.source added');
            } else {
                console.log('⏭️  zoho_reorder_config.source exists');
            }

            if (!(await columnExists(pool, 'zoho_reorder_config', 'avg_daily_sales'))) {
                await pool.query(
                    `ALTER TABLE zoho_reorder_config ADD COLUMN avg_daily_sales DECIMAL(10,3) NULL`
                );
                console.log('✅ zoho_reorder_config.avg_daily_sales added');
            } else {
                console.log('⏭️  zoho_reorder_config.avg_daily_sales exists');
            }

            if (!(await columnExists(pool, 'zoho_reorder_config', 'computed_at'))) {
                await pool.query(
                    `ALTER TABLE zoho_reorder_config ADD COLUMN computed_at TIMESTAMP NULL`
                );
                console.log('✅ zoho_reorder_config.computed_at added');
            } else {
                console.log('⏭️  zoho_reorder_config.computed_at exists');
            }
        } else {
            console.warn('⚠️  zoho_reorder_config does not exist — run zoho reorder migration first');
        }

        // 6a. Ensure zoho_reorder_alerts has (item, location) unique key so upserts work
        if (await tableExists(pool, 'zoho_reorder_alerts')) {
            const [idx] = await pool.query(
                `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'zoho_reorder_alerts' AND INDEX_NAME = 'uq_item_loc'`
            );
            if (idx.length === 0) {
                await pool.query(`ALTER TABLE zoho_reorder_alerts ADD UNIQUE KEY uq_item_loc (zoho_item_id, zoho_location_id)`);
                console.log('✅ zoho_reorder_alerts.uq_item_loc added');
            } else {
                console.log('⏭️  zoho_reorder_alerts.uq_item_loc exists');
            }
        }

        // 6b. Ensure zoho_sync_log.sync_type ENUM includes 'reorder_compute'
        if (await tableExists(pool, 'zoho_sync_log')) {
            const [enumRows] = await pool.query(
                `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'zoho_sync_log' AND COLUMN_NAME = 'sync_type'`
            );
            if (enumRows.length > 0 && !enumRows[0].COLUMN_TYPE.includes('reorder_compute')) {
                // Insert current enum values plus 'reorder_compute'
                const currentType = enumRows[0].COLUMN_TYPE; // e.g. enum('a','b',...)
                const newType = currentType.replace(/\)$/, ",'reorder_compute')");
                await pool.query(`ALTER TABLE zoho_sync_log MODIFY COLUMN sync_type ${newType} NOT NULL`);
                console.log('✅ zoho_sync_log.sync_type ENUM extended with reorder_compute');
            } else {
                console.log('⏭️  zoho_sync_log.sync_type already has reorder_compute (or table missing)');
            }
        }

        // 7. Seed ai_config keys (INSERT IGNORE — non-destructive)
        const configKeys = [
            ['reorder_sales_window_days',        '60'],
            ['reorder_min_sales_for_auto',        '1'],
            ['reorder_invoice_sync_time',         '02:00'],
            ['reorder_compute_time',              '02:30'],
            ['reorder_report_time',               '07:00'],
            ['reorder_report_recipients',         '[]'],
            ['reorder_report_whatsapp_enabled',   '0'],
            ['reorder_report_fcm_enabled',        '0'],
            ['reorder_report_pdf_enabled',        '1']
        ];
        for (const [k, v] of configKeys) {
            await pool.query(
                `INSERT IGNORE INTO ai_config (config_key, config_value) VALUES (?, ?)`,
                [k, v]
            );
        }
        console.log(`✅ ${configKeys.length} ai_config keys seeded (INSERT IGNORE — existing preserved)`);

        console.log('\n✅ Migration completed!');
    } catch (error) {
        console.error('Migration failed:', error);
        process.exitCode = 1;
    } finally {
        try { if (pool) await pool.end(); } catch (e) { console.error('pool.end failed:', e); }
        process.exit(process.exitCode || 0);
    }
}

migrate();
