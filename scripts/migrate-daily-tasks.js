/**
 * Migration: Create daily mandatory task system tables
 * Run: node scripts/migrate-daily-tasks.js
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
        console.log('Starting daily tasks migration...\n');

        // 1. Daily task templates - admin-defined checklist items
        await pool.query(`
            CREATE TABLE IF NOT EXISTS daily_task_templates (
                id INT PRIMARY KEY AUTO_INCREMENT,
                section VARCHAR(50) NOT NULL,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                task_type ENUM('yes_no', 'yes_no_photo', 'yes_no_detail', 'material_received') NOT NULL DEFAULT 'yes_no',
                detail_fields JSON,
                roles JSON,
                photo_required BOOLEAN DEFAULT FALSE,
                sort_order INT DEFAULT 0,
                is_active BOOLEAN DEFAULT TRUE,
                created_by INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_section (section),
                INDEX idx_active (is_active)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('  daily_task_templates table created');

        // 2. Daily task responses - staff answers
        await pool.query(`
            CREATE TABLE IF NOT EXISTS daily_task_responses (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user_id INT NOT NULL,
                task_date DATE NOT NULL,
                template_id INT NOT NULL,
                answer ENUM('yes', 'no') DEFAULT NULL,
                reason TEXT,
                details JSON,
                photos JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_user_date_template (user_id, task_date, template_id),
                INDEX idx_user_date (user_id, task_date),
                INDEX idx_date (task_date),
                FOREIGN KEY (template_id) REFERENCES daily_task_templates(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('  daily_task_responses table created');

        // 3. Daily task materials - sub-entries for material_received type
        await pool.query(`
            CREATE TABLE IF NOT EXISTS daily_task_materials (
                id INT PRIMARY KEY AUTO_INCREMENT,
                response_id INT NOT NULL,
                vendor_name VARCHAR(255) NOT NULL,
                photo_url VARCHAR(500),
                bill_on_zoho BOOLEAN DEFAULT FALSE,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (response_id) REFERENCES daily_task_responses(id) ON DELETE CASCADE,
                INDEX idx_response (response_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('  daily_task_materials table created');

        // 4. Daily task submissions - day completion tracker
        await pool.query(`
            CREATE TABLE IF NOT EXISTS daily_task_submissions (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user_id INT NOT NULL,
                task_date DATE NOT NULL,
                total_tasks INT DEFAULT 0,
                completed_tasks INT DEFAULT 0,
                submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_user_date (user_id, task_date),
                INDEX idx_date (task_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('  daily_task_submissions table created');

        // 5. Seed default templates
        await pool.query(`
            INSERT INTO daily_task_templates (section, title, description, task_type, detail_fields, roles, photo_required, sort_order) VALUES
            ('morning', 'Shop Clean + Racks Filled', 'Is the shop clean and are all racks properly filled?', 'yes_no_photo', NULL, '["staff","manager"]', TRUE, 1),
            ('morning', 'Customer Attended', 'Did you attend to any customers today?', 'yes_no', NULL, '["staff","manager"]', FALSE, 2),
            ('material', 'Any Material Received Today?', 'Record details of any material received from vendors', 'material_received', NULL, '["staff","manager"]', TRUE, 3),
            ('sales', 'Quotation Issued?', 'Did you issue any quotations today?', 'yes_no_detail', '["to_whom","amount"]', '["staff","manager"]', FALSE, 4),
            ('outstanding', 'Outstanding Followed?', 'Did you follow up on any outstanding payments?', 'yes_no_detail', '["who_followed","status"]', '["staff","manager"]', FALSE, 5),
            ('marketing', 'Calls to Painters/Engineers/Leads?', 'Did you make any marketing calls today?', 'yes_no_detail', '["who_called","status"]', '["staff","manager"]', FALSE, 6)
            ON DUPLICATE KEY UPDATE title = VALUES(title)
        `);
        console.log('  Default templates seeded (6 tasks)');

        // Verify
        const [templateCount] = await pool.query('SELECT COUNT(*) as count FROM daily_task_templates');
        console.log(`\nMigration complete:`);
        console.log(`   Templates: ${templateCount[0].count}`);

    } catch (error) {
        console.error('Migration failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

migrate();
