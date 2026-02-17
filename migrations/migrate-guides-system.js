/**
 * Guides/Documentation System Migration
 *
 * Run: node migrations/migrate-guides-system.js
 *
 * Creates: guide_categories, guides, guide_versions, guide_views, guide_favorites
 * Seeds: Default categories + imports existing Tamil attendance guide
 */

const mysql = require('mysql2/promise');
const fs = require('fs').promises;
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

        console.log('Connected to database. Running guides system migration...\n');

        // 1. Create guide_categories table
        console.log('1. Creating guide_categories table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS guide_categories (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(100) NOT NULL,
                name_ta VARCHAR(100),
                icon VARCHAR(50) DEFAULT '📄',
                sort_order INT DEFAULT 0,
                status ENUM('active','inactive') DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('   OK');

        // 2. Create guides table
        console.log('2. Creating guides table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS guides (
                id INT PRIMARY KEY AUTO_INCREMENT,
                category_id INT,
                title VARCHAR(255) NOT NULL,
                title_ta VARCHAR(255),
                slug VARCHAR(255),
                content_en LONGTEXT,
                content_ta LONGTEXT,
                summary VARCHAR(500),
                summary_ta VARCHAR(500),
                language ENUM('en','ta','both') DEFAULT 'both',
                content_type ENUM('rich_text','full_html') DEFAULT 'rich_text',
                status ENUM('draft','published','archived') DEFAULT 'draft',
                visible_to_staff TINYINT(1) DEFAULT 1,
                author_id INT,
                version INT DEFAULT 1,
                view_count INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (category_id) REFERENCES guide_categories(id) ON DELETE SET NULL,
                UNIQUE KEY unique_slug (slug)
            )
        `);
        console.log('   OK');

        // 3. Create guide_versions table
        console.log('3. Creating guide_versions table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS guide_versions (
                id INT PRIMARY KEY AUTO_INCREMENT,
                guide_id INT NOT NULL,
                version INT NOT NULL,
                title VARCHAR(255),
                title_ta VARCHAR(255),
                content_en LONGTEXT,
                content_ta LONGTEXT,
                changed_by INT,
                change_summary VARCHAR(500),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (guide_id) REFERENCES guides(id) ON DELETE CASCADE
            )
        `);
        console.log('   OK');

        // 4. Create guide_views table
        console.log('4. Creating guide_views table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS guide_views (
                id INT PRIMARY KEY AUTO_INCREMENT,
                guide_id INT NOT NULL,
                user_id INT NOT NULL,
                viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (guide_id) REFERENCES guides(id) ON DELETE CASCADE
            )
        `);
        console.log('   OK');

        // 5. Create guide_favorites table
        console.log('5. Creating guide_favorites table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS guide_favorites (
                id INT PRIMARY KEY AUTO_INCREMENT,
                guide_id INT NOT NULL,
                user_id INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_fav (guide_id, user_id),
                FOREIGN KEY (guide_id) REFERENCES guides(id) ON DELETE CASCADE
            )
        `);
        console.log('   OK');

        // 6. Seed default categories
        console.log('6. Seeding default categories...');
        const categories = [
            ['Attendance', 'வருகைப்பதிவு', '⏰', 1],
            ['Salary', 'சம்பளம்', '💰', 2],
            ['Tasks & Work', 'பணிகள்', '📋', 3],
            ['App Guide', 'ஆப் வழிகாட்டி', '📱', 4],
            ['Policies', 'கொள்கைகள்', '📜', 5],
            ['General', 'பொது', '📄', 6]
        ];

        for (const [name, name_ta, icon, sort_order] of categories) {
            const [existing] = await pool.query('SELECT id FROM guide_categories WHERE name = ?', [name]);
            if (existing.length === 0) {
                await pool.query(
                    'INSERT INTO guide_categories (name, name_ta, icon, sort_order) VALUES (?, ?, ?, ?)',
                    [name, name_ta, icon, sort_order]
                );
                console.log(`   + ${name} (${name_ta})`);
            } else {
                console.log(`   SKIP ${name} (already exists)`);
            }
        }

        // 7. Import existing Tamil attendance guide
        console.log('7. Importing existing Tamil attendance guide...');
        const [existingGuide] = await pool.query("SELECT id FROM guides WHERE slug = 'attendance-system-guide'");
        if (existingGuide.length === 0) {
            // Read the existing HTML file
            const guidePath = path.join(__dirname, '..', 'public', 'docs', 'attendance-guide-tamil.html');
            let guideContent = '';
            try {
                guideContent = await fs.readFile(guidePath, 'utf-8');
                console.log(`   Read ${guideContent.length} bytes from attendance-guide-tamil.html`);
            } catch (err) {
                console.log('   WARN: Could not read attendance-guide-tamil.html, creating without content');
            }

            // Get the Attendance category ID
            const [attCat] = await pool.query("SELECT id FROM guide_categories WHERE name = 'Attendance'");
            const categoryId = attCat.length > 0 ? attCat[0].id : null;

            // Get first admin user
            const [adminUser] = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
            const authorId = adminUser.length > 0 ? adminUser[0].id : null;

            await pool.query(
                `INSERT INTO guides (category_id, title, title_ta, slug, content_ta, summary,
                 summary_ta, language, content_type, status, visible_to_staff, author_id, version)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'ta', 'full_html', 'published', 1, ?, 1)`,
                [
                    categoryId,
                    'Staff Attendance System - Complete Guide',
                    'ஊழியர் வருகைப்பதிவு அமைப்பு - முழு வழிகாட்டி',
                    'attendance-system-guide',
                    guideContent,
                    'Complete guide covering clock-in/out, breaks, geo-fencing, permissions, salary calculation',
                    'வருகைப்பதிவு, இடைவேளை, இருப்பிட கண்காணிப்பு, அனுமதி, சம்பள கணக்கீடு பற்றிய முழு வழிகாட்டி',
                    authorId
                ]
            );
            console.log('   OK - Tamil attendance guide imported');
        } else {
            console.log('   SKIP - attendance guide already exists');
        }

        // Add index for performance
        console.log('8. Adding indexes...');
        try {
            await pool.query('CREATE INDEX idx_guide_views_guide ON guide_views(guide_id)');
            await pool.query('CREATE INDEX idx_guide_views_user ON guide_views(user_id)');
            await pool.query('CREATE INDEX idx_guides_status ON guides(status, visible_to_staff)');
        } catch (err) {
            if (err.code === 'ER_DUP_KEYNAME') {
                console.log('   SKIP - indexes already exist');
            } else {
                console.log('   WARN:', err.message);
            }
        }

        console.log('\n--- Guides system migration complete! ---');
        console.log('Tables: guide_categories, guides, guide_versions, guide_views, guide_favorites');
        console.log('Categories: Attendance, Salary, Tasks & Work, App Guide, Policies, General');

    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate();
