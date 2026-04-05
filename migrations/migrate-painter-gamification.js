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

        console.log('Connected to database. Running painter gamification migration...\n');

        // 1. painter_badges - Badge definitions
        console.log('1. Creating painter_badges table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_badges (
                id INT AUTO_INCREMENT PRIMARY KEY,
                badge_key VARCHAR(50) NOT NULL UNIQUE,
                name_en VARCHAR(100) NOT NULL,
                name_ta VARCHAR(100) NOT NULL,
                description_en VARCHAR(300),
                description_ta VARCHAR(300),
                icon VARCHAR(50),
                unlock_condition VARCHAR(200),
                category VARCHAR(50) DEFAULT 'general',
                sort_order INT DEFAULT 0
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ painter_badges table created');

        // 2. painter_earned_badges - Badges earned by painters
        console.log('2. Creating painter_earned_badges table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_earned_badges (
                id INT AUTO_INCREMENT PRIMARY KEY,
                painter_id INT NOT NULL,
                badge_id INT NOT NULL,
                earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_painter_badge (painter_id, badge_id),
                FOREIGN KEY (painter_id) REFERENCES painters(id),
                FOREIGN KEY (badge_id) REFERENCES painter_badges(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ painter_earned_badges table created');

        // 3. painter_challenges - Challenge definitions
        console.log('3. Creating painter_challenges table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_challenges (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title_en VARCHAR(200) NOT NULL,
                title_ta VARCHAR(200) NOT NULL,
                description_en TEXT,
                description_ta TEXT,
                challenge_type VARCHAR(50),
                target_count INT NOT NULL,
                reward_points INT NOT NULL,
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                is_active TINYINT(1) DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ painter_challenges table created');

        // 4. painter_challenge_progress - Per-painter challenge tracking
        console.log('4. Creating painter_challenge_progress table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_challenge_progress (
                id INT AUTO_INCREMENT PRIMARY KEY,
                painter_id INT NOT NULL,
                challenge_id INT NOT NULL,
                current_count INT DEFAULT 0,
                completed TINYINT(1) DEFAULT 0,
                claimed TINYINT(1) DEFAULT 0,
                completed_at TIMESTAMP NULL,
                claimed_at TIMESTAMP NULL,
                UNIQUE KEY unique_painter_challenge (painter_id, challenge_id),
                FOREIGN KEY (painter_id) REFERENCES painters(id),
                FOREIGN KEY (challenge_id) REFERENCES painter_challenges(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ painter_challenge_progress table created');

        // 5. Seed default badges
        console.log('\n5. Seeding default badges...');
        const [result] = await pool.query(`
            INSERT IGNORE INTO painter_badges (badge_key, name_en, name_ta, description_en, description_ta, icon, unlock_condition, sort_order) VALUES
            ('first_step', 'First Step', 'முதல் அடி', 'Completed first check-in', 'முதல் செக்-இன் முடித்தது', 'footprints', 'checkin_count >= 1', 1),
            ('estimate_pro', 'Estimate Pro', 'மதிப்பீடு நிபுணர்', 'Submitted 10 estimates', '10 மதிப்பீடுகள் சமர்ப்பித்தது', 'clipboard_check', 'estimate_count >= 10', 2),
            ('quotation_master', 'Quotation Master', 'கொட்டேஷன் மாஸ்டர்', 'Sent 5 quotations', '5 கொட்டேஷன்கள் அனுப்பியது', 'file_text', 'quotation_count >= 5', 3),
            ('streak_king', 'Streak King', 'ஸ்ட்ரீக் கிங்', '30-day check-in streak', '30 நாள் தொடர் செக்-இன்', 'flame', 'streak >= 30', 4),
            ('calculator_guru', 'Calculator Guru', 'கால்குலேட்டர் குரு', 'Used calculator 10 times', 'கால்குலேட்டர் 10 முறை பயன்படுத்தியது', 'calculator', 'calc_count >= 10', 5),
            ('referral_star', 'Referral Star', 'ரெபரல் ஸ்டார்', '3 successful referrals', '3 வெற்றிகரமான ரெபரல்கள்', 'users_plus', 'referral_count >= 3', 6),
            ('gallery_artist', 'Gallery Artist', 'கேலரி ஆர்ட்டிஸ்ட்', '5 work photos uploaded', '5 வேலை புகைப்படங்கள் பதிவேற்றம்', 'image', 'gallery_count >= 5', 7),
            ('top_earner', 'Top Earner', 'டாப் ஏர்னர்', 'Earned 50,000+ in a month', 'ஒரு மாதத்தில் ₹50,000+ சம்பாதித்தது', 'trophy', 'monthly_earnings >= 50000', 8),
            ('loyal_painter', 'Loyal Painter', 'விசுவாச பெயிண்டர்', '6 months active', '6 மாதம் செயலில்', 'heart', 'months_active >= 6', 9),
            ('price_scout', 'Price Scout', 'விலை ஸ்கவுட்', '3 price reports submitted', '3 விலை அறிக்கைகள் சமர்ப்பித்தது', 'search_dollar', 'price_report_count >= 3', 10)
        `);
        console.log(`   ✅ ${result.affectedRows} default badges seeded`);

        // 6. Add level and total_lifetime_points columns to painters table
        console.log('\n6. Adding gamification columns to painters table...');
        try {
            await pool.query(`ALTER TABLE painters ADD COLUMN IF NOT EXISTS level VARCHAR(20) DEFAULT 'bronze'`);
            console.log('   ✅ level column added');
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log('   ⏭️ level column already exists');
            } else {
                throw e;
            }
        }
        try {
            await pool.query(`ALTER TABLE painters ADD COLUMN IF NOT EXISTS total_lifetime_points INT DEFAULT 0`);
            console.log('   ✅ total_lifetime_points column added');
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log('   ⏭️ total_lifetime_points column already exists');
            } else {
                throw e;
            }
        }

        console.log('\n✅ Painter gamification migration completed successfully!');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate();
