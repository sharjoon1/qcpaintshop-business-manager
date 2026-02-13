/**
 * Migration: Create Purchase Suggestion tables
 * Run: node scripts/migrate-purchase-suggestions.js
 *
 * Tables created:
 *   - zoho_category_defaults     (Fallback reorder levels for low-volume items)
 *   - zoho_branch_allocations    (Branch distribution percentages)
 *   - zoho_purchase_suggestions  (Generated purchase suggestions)
 *
 * Also:
 *   - New config keys in zoho_config
 *   - New permission: zoho.purchase_suggestions
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
        console.log('Starting Purchase Suggestion migration...\n');

        // 1. Category Defaults
        console.log('1/3 Creating zoho_category_defaults...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS zoho_category_defaults (
                id INT PRIMARY KEY AUTO_INCREMENT,
                category_name VARCHAR(100) NOT NULL UNIQUE,
                default_reorder_qty INT NOT NULL DEFAULT 10,
                is_active TINYINT(1) DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ zoho_category_defaults created');

        // Seed category defaults
        console.log('   Seeding category defaults...');
        const categoryDefaults = [
            ['Emulsion', 20],
            ['Enamel', 15],
            ['Primer', 15],
            ['Putty', 25],
            ['Distemper', 20],
            ['Wood Finish', 10],
            ['Thinner', 15],
            ['Waterproofing', 10],
            ['Adhesive', 10],
            ['Stainer', 8],
            ['Texture', 10],
            ['Metal Finish', 8],
            ['Floor Coating', 8],
            ['Spray Paint', 10],
            ['Other', 10]
        ];
        for (const [name, qty] of categoryDefaults) {
            await pool.query(`
                INSERT IGNORE INTO zoho_category_defaults (category_name, default_reorder_qty)
                VALUES (?, ?)
            `, [name, qty]);
        }
        console.log('   ✅ Seeded ' + categoryDefaults.length + ' category defaults');

        // 2. Branch Allocations
        console.log('2/3 Creating zoho_branch_allocations...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS zoho_branch_allocations (
                id INT PRIMARY KEY AUTO_INCREMENT,
                branch_name VARCHAR(100) NOT NULL,
                zoho_location_id VARCHAR(50),
                allocation_pct DECIMAL(5,2) NOT NULL,
                min_stock INT NOT NULL DEFAULT 5,
                is_active TINYINT(1) DEFAULT 1,
                sort_order INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY idx_branch (branch_name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ zoho_branch_allocations created');

        // Seed branch allocations
        console.log('   Seeding branch allocations...');
        const branchAllocations = [
            ['QC-PAMBAN', 27.30, 5, 1],
            ['QC-PARAMAKUDI', 24.00, 5, 2],
            ['QC-RAMESWARAM', 21.10, 5, 3],
            ['Head Office', 15.30, 5, 4],
            ['QC-THANGACHIMADAM', 12.40, 5, 5]
        ];
        for (const [name, pct, minStock, sortOrder] of branchAllocations) {
            await pool.query(`
                INSERT IGNORE INTO zoho_branch_allocations (branch_name, allocation_pct, min_stock, sort_order)
                VALUES (?, ?, ?, ?)
            `, [name, pct, minStock, sortOrder]);
        }
        console.log('   ✅ Seeded ' + branchAllocations.length + ' branch allocations');

        // Auto-link zoho_location_id from zoho_locations_map
        console.log('   Linking branch allocations to Zoho locations...');
        let linked = 0;
        try {
            const [locations] = await pool.query(`SELECT zoho_location_id, zoho_location_name FROM zoho_locations_map WHERE is_active = 1`);
            for (const loc of locations) {
                const [result] = await pool.query(`
                    UPDATE zoho_branch_allocations
                    SET zoho_location_id = ?
                    WHERE branch_name = ? AND zoho_location_id IS NULL
                `, [loc.zoho_location_id, loc.zoho_location_name]);
                if (result.affectedRows > 0) linked++;
            }
            console.log('   ✅ Linked ' + linked + ' branches to Zoho locations');
        } catch (e) {
            console.log('   ⚠️ Could not auto-link locations (zoho_locations_map may not exist yet). Link manually later.');
        }

        // 3. Purchase Suggestions
        console.log('3/3 Creating zoho_purchase_suggestions...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS zoho_purchase_suggestions (
                id INT PRIMARY KEY AUTO_INCREMENT,
                batch_id VARCHAR(50) NOT NULL,
                zoho_item_id VARCHAR(50) NOT NULL,
                item_name VARCHAR(255),
                sku VARCHAR(100),
                category_name VARCHAR(100),
                zoho_location_id VARCHAR(50),
                branch_name VARCHAR(100),
                global_reorder_level DECIMAL(12,2),
                branch_reorder_threshold DECIMAL(12,2),
                current_stock DECIMAL(12,2),
                suggested_qty DECIMAL(12,2),
                priority ENUM('HIGH','MEDIUM','LOW') DEFAULT 'LOW',
                total_sales_90d DECIMAL(12,2) DEFAULT 0,
                daily_avg_sales DECIMAL(12,4) DEFAULT 0,
                used_category_default TINYINT(1) DEFAULT 0,
                status ENUM('pending','ordered','dismissed') DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                KEY idx_batch (batch_id),
                KEY idx_item (zoho_item_id),
                KEY idx_location (zoho_location_id),
                KEY idx_priority (priority),
                KEY idx_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ zoho_purchase_suggestions created');

        // Add config keys
        console.log('\nInserting purchase suggestion config keys...');
        const configKeys = [
            ['purchase_suggestion_enabled', 'true', 'Enable/disable purchase suggestion system'],
            ['purchase_suggestion_days', '90', 'Number of days of sales data to analyze'],
            ['purchase_suggestion_multiplier', '1.5', 'Multiplier for suggested purchase quantity'],
            ['purchase_suggestion_low_volume_threshold', '5', 'Monthly units threshold for low-volume fallback'],
            ['purchase_suggestion_branch_count', '5', 'Number of branches for reorder calculation']
        ];
        for (const [key, value, desc] of configKeys) {
            await pool.query(`
                INSERT IGNORE INTO zoho_config (config_key, config_value, description)
                VALUES (?, ?, ?)
            `, [key, value, desc]);
        }
        console.log('   ✅ Config keys inserted');

        // Add permission
        console.log('\nAdding purchase_suggestions permission...');
        const [tables] = await pool.query(`SHOW TABLES LIKE 'permissions'`);
        if (tables.length > 0) {
            await pool.query(`
                INSERT INTO permissions (module, action, display_name, description)
                VALUES ('zoho', 'purchase_suggestions', 'Purchase Suggestions', 'Generate and manage purchase order suggestions')
                ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), description = VALUES(description)
            `);

            // Auto-assign to admin role
            const [adminRole] = await pool.query(`SELECT id FROM roles WHERE name = 'admin' LIMIT 1`);
            if (adminRole.length > 0) {
                const [perm] = await pool.query(`SELECT id FROM permissions WHERE module = 'zoho' AND action = 'purchase_suggestions' LIMIT 1`);
                if (perm.length > 0) {
                    await pool.query(`
                        INSERT IGNORE INTO role_permissions (role_id, permission_id)
                        VALUES (?, ?)
                    `, [adminRole[0].id, perm[0].id]);
                }
            }
            console.log('   ✅ Permission added and assigned to admin role');
        }

        console.log('\n✅ Purchase Suggestion migration completed successfully!');
        console.log('\nTables created:');
        console.log('   - zoho_category_defaults');
        console.log('   - zoho_branch_allocations');
        console.log('   - zoho_purchase_suggestions');
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
