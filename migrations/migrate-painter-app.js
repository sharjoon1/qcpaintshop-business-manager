/**
 * Migration: Painter App — Offers, FCM, Training, Attendance Columns
 *
 * Creates:
 *   - painter_special_offers (offers system)
 *   - painter_fcm_tokens (push notification tokens)
 *   - painter_notifications (in-app notifications)
 *   - painter_training_categories (training content categories)
 *   - painter_training_content (articles/videos/PDFs)
 *
 * Alters:
 *   - zoho_items_map: adds image_url
 *   - painter_attendance: adds check_in_photo_url, latitude, longitude, distance_from_shop
 *     (branch_id already exists from original migration)
 *
 * Seeds:
 *   - Default training categories (EN + Tamil)
 *   - Config entries in ai_config
 *
 * Run: node migrations/migrate-painter-app.js
 */

const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Helper: run a step with error handling, skip known "already exists" errors
async function runStep(pool, label, sql, params = []) {
    try {
        await pool.query(sql, params);
        console.log(`   OK  ${label}`);
        return 'ok';
    } catch (err) {
        const code = err.code || '';
        if (['ER_DUP_FIELDNAME', 'ER_DUP_ENTRY', 'ER_TABLE_EXISTS_ERROR'].includes(code)) {
            console.log(`   SKIP ${label} (${code})`);
            return 'skip';
        }
        console.error(`   FAIL ${label} — ${err.message}`);
        return 'fail';
    }
}

async function migrate() {
    let pool;
    try {
        pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'business_manager',
            port: process.env.DB_PORT || 3306,
            waitForConnections: true,
            connectionLimit: 5,
            queueLimit: 0
        });

        console.log('Connected to database. Running painter app migration...\n');

        // ── 1. painter_special_offers ──────────────────────────────────────
        console.log('1. Creating painter_special_offers table...');
        await runStep(pool, 'painter_special_offers', `
            CREATE TABLE IF NOT EXISTS painter_special_offers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                title_ta VARCHAR(255) DEFAULT NULL,
                description TEXT,
                description_ta TEXT,
                offer_type ENUM('multiplier','bonus_points','free_product','discount') DEFAULT 'multiplier',
                multiplier_value DECIMAL(4,2) DEFAULT 1.00,
                bonus_points DECIMAL(12,2) DEFAULT 0,
                applies_to ENUM('all','brand','category','product') DEFAULT 'all',
                target_id VARCHAR(100) DEFAULT NULL,
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                is_active TINYINT(1) DEFAULT 1,
                banner_image_url VARCHAR(500) DEFAULT NULL,
                created_by INT DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_active_dates (is_active, start_date, end_date),
                INDEX idx_applies_to (applies_to, target_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // ── 2. painter_fcm_tokens ─────────────────────────────────────────
        console.log('2. Creating painter_fcm_tokens table...');
        await runStep(pool, 'painter_fcm_tokens', `
            CREATE TABLE IF NOT EXISTS painter_fcm_tokens (
                id INT AUTO_INCREMENT PRIMARY KEY,
                painter_id INT NOT NULL,
                fcm_token VARCHAR(500) NOT NULL,
                device_info VARCHAR(255) DEFAULT NULL,
                is_active TINYINT(1) DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY idx_token (fcm_token),
                INDEX idx_painter (painter_id),
                FOREIGN KEY (painter_id) REFERENCES painters(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // ── 3. painter_notifications ──────────────────────────────────────
        console.log('3. Creating painter_notifications table...');
        await runStep(pool, 'painter_notifications', `
            CREATE TABLE IF NOT EXISTS painter_notifications (
                id INT AUTO_INCREMENT PRIMARY KEY,
                painter_id INT NOT NULL,
                type VARCHAR(50) NOT NULL,
                title VARCHAR(255) NOT NULL,
                title_ta VARCHAR(255) DEFAULT NULL,
                body TEXT,
                body_ta TEXT,
                data JSON,
                is_read TINYINT(1) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_painter_read (painter_id, is_read),
                INDEX idx_created (created_at),
                FOREIGN KEY (painter_id) REFERENCES painters(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // ── 4. painter_training_categories ────────────────────────────────
        console.log('4. Creating painter_training_categories table...');
        await runStep(pool, 'painter_training_categories', `
            CREATE TABLE IF NOT EXISTS painter_training_categories (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                name_ta VARCHAR(100) DEFAULT NULL,
                icon VARCHAR(10) DEFAULT '📄',
                sort_order INT DEFAULT 0,
                is_active TINYINT(1) DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // ── 5. painter_training_content ───────────────────────────────────
        console.log('5. Creating painter_training_content table...');
        await runStep(pool, 'painter_training_content', `
            CREATE TABLE IF NOT EXISTS painter_training_content (
                id INT AUTO_INCREMENT PRIMARY KEY,
                category_id INT DEFAULT NULL,
                title VARCHAR(255) NOT NULL,
                title_ta VARCHAR(255) DEFAULT NULL,
                content_type ENUM('article','video','pdf') DEFAULT 'article',
                content_en LONGTEXT,
                content_ta LONGTEXT,
                summary VARCHAR(500) DEFAULT NULL,
                summary_ta VARCHAR(500) DEFAULT NULL,
                youtube_url VARCHAR(500) DEFAULT NULL,
                pdf_url VARCHAR(500) DEFAULT NULL,
                thumbnail_url VARCHAR(500) DEFAULT NULL,
                language ENUM('en','ta','both') DEFAULT 'both',
                is_featured TINYINT(1) DEFAULT 0,
                status ENUM('draft','published','archived') DEFAULT 'draft',
                view_count INT DEFAULT 0,
                created_by INT DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_category (category_id),
                INDEX idx_status (status),
                INDEX idx_featured (is_featured, status),
                FOREIGN KEY (category_id) REFERENCES painter_training_categories(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // ── 6. ALTER zoho_items_map — add image_url ───────────────────────
        console.log('6. Altering zoho_items_map — add image_url...');
        await runStep(pool, 'zoho_items_map.image_url',
            `ALTER TABLE zoho_items_map ADD COLUMN image_url VARCHAR(500) DEFAULT NULL AFTER zoho_category_name`
        );

        // ── 7-10. ALTER painter_attendance — add geo/photo columns ────────
        // NOTE: branch_id already exists from the original painters migration,
        // so we only add the new columns.
        console.log('7. Altering painter_attendance — add check_in_photo_url...');
        await runStep(pool, 'painter_attendance.check_in_photo_url',
            `ALTER TABLE painter_attendance ADD COLUMN check_in_photo_url VARCHAR(500) DEFAULT NULL AFTER check_out_at`
        );

        console.log('8. Altering painter_attendance — add latitude...');
        await runStep(pool, 'painter_attendance.latitude',
            `ALTER TABLE painter_attendance ADD COLUMN latitude DECIMAL(10,8) DEFAULT NULL AFTER check_in_photo_url`
        );

        console.log('9. Altering painter_attendance — add longitude...');
        await runStep(pool, 'painter_attendance.longitude',
            `ALTER TABLE painter_attendance ADD COLUMN longitude DECIMAL(11,8) DEFAULT NULL AFTER latitude`
        );

        console.log('10. Altering painter_attendance — add distance_from_shop...');
        await runStep(pool, 'painter_attendance.distance_from_shop',
            `ALTER TABLE painter_attendance ADD COLUMN distance_from_shop INT DEFAULT NULL AFTER longitude`
        );

        // ── 11. Seed default training categories ─────────────────────────
        console.log('\n11. Seeding default training categories...');
        const categories = [
            { name: 'Products',    name_ta: 'தயாரிப்புகள்',    icon: '🎨', sort_order: 1 },
            { name: 'Techniques',  name_ta: 'நுட்பங்கள்',      icon: '🖌️', sort_order: 2 },
            { name: 'Color Guide', name_ta: 'வண்ண வழிகாட்டி', icon: '🌈', sort_order: 3 },
            { name: 'Videos',      name_ta: 'வீடியோக்கள்',     icon: '🎬', sort_order: 4 },
            { name: 'Safety',      name_ta: 'பாதுகாப்பு',      icon: '⚠️', sort_order: 5 }
        ];
        let catSeeded = 0;
        for (const cat of categories) {
            try {
                const [existing] = await pool.query(
                    'SELECT id FROM painter_training_categories WHERE name = ?', [cat.name]
                );
                if (existing.length === 0) {
                    await pool.query(
                        `INSERT INTO painter_training_categories (name, name_ta, icon, sort_order) VALUES (?, ?, ?, ?)`,
                        [cat.name, cat.name_ta, cat.icon, cat.sort_order]
                    );
                    catSeeded++;
                    console.log(`   OK  Category "${cat.name}" seeded`);
                } else {
                    console.log(`   SKIP Category "${cat.name}" already exists`);
                }
            } catch (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    console.log(`   SKIP Category "${cat.name}" (ER_DUP_ENTRY)`);
                } else {
                    console.error(`   FAIL Category "${cat.name}" — ${err.message}`);
                }
            }
        }
        console.log(`   ${catSeeded} new categories seeded`);

        // ── 12. Seed config entries ──────────────────────────────────────
        console.log('\n12. Seeding config entries in ai_config...');
        const configs = [
            ['painter_attendance_geofence_radius', '100'],
            ['painter_attendance_daily_points', '5'],
            ['painter_attendance_photo_required', 'false'],
            ['painter_training_enabled', 'true'],
            ['painter_offers_enabled', 'true'],
            ['painter_fcm_enabled', 'true'],
            ['painter_attendance_reminder_enabled', 'true']
        ];
        let cfgSeeded = 0;
        for (const [key, value] of configs) {
            try {
                const [existing] = await pool.query(
                    'SELECT config_key FROM ai_config WHERE config_key = ?', [key]
                );
                if (existing.length === 0) {
                    await pool.query(
                        'INSERT INTO ai_config (config_key, config_value) VALUES (?, ?)',
                        [key, value]
                    );
                    cfgSeeded++;
                    console.log(`   OK  Config "${key}" = ${value}`);
                } else {
                    console.log(`   SKIP Config "${key}" already exists`);
                }
            } catch (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    console.log(`   SKIP Config "${key}" (ER_DUP_ENTRY)`);
                } else {
                    console.error(`   FAIL Config "${key}" — ${err.message}`);
                }
            }
        }
        console.log(`   ${cfgSeeded} new config entries seeded`);

        console.log('\n=== Painter app migration completed successfully! ===');

    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate();
