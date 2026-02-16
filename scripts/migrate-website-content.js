/**
 * Migration: Create website content management tables
 * Tables: website_services, website_features, website_testimonials, website_gallery
 * Also inserts default data and website-related settings keys
 * Run: node scripts/migrate-website-content.js
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
        console.log('Starting website content migration...\n');

        // 1. website_services
        await pool.query(`
            CREATE TABLE IF NOT EXISTS website_services (
                id INT PRIMARY KEY AUTO_INCREMENT,
                title VARCHAR(255) NOT NULL,
                title_tamil VARCHAR(255),
                description TEXT,
                description_tamil TEXT,
                icon VARCHAR(50) DEFAULT 'paint-brush',
                sort_order INT DEFAULT 0,
                status ENUM('active','inactive') DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ website_services table created');

        // 2. website_features
        await pool.query(`
            CREATE TABLE IF NOT EXISTS website_features (
                id INT PRIMARY KEY AUTO_INCREMENT,
                title VARCHAR(255) NOT NULL,
                title_tamil VARCHAR(255),
                description TEXT,
                description_tamil TEXT,
                icon VARCHAR(50) DEFAULT 'check-circle',
                color VARCHAR(20) DEFAULT 'green',
                sort_order INT DEFAULT 0,
                status ENUM('active','inactive') DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ website_features table created');

        // 3. website_testimonials
        await pool.query(`
            CREATE TABLE IF NOT EXISTS website_testimonials (
                id INT PRIMARY KEY AUTO_INCREMENT,
                customer_name VARCHAR(255) NOT NULL,
                customer_role VARCHAR(100),
                customer_photo VARCHAR(500),
                testimonial_text TEXT NOT NULL,
                testimonial_text_tamil TEXT,
                rating TINYINT DEFAULT 5,
                sort_order INT DEFAULT 0,
                status ENUM('active','inactive') DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ website_testimonials table created');

        // 4. website_gallery
        await pool.query(`
            CREATE TABLE IF NOT EXISTS website_gallery (
                id INT PRIMARY KEY AUTO_INCREMENT,
                image_url VARCHAR(500) NOT NULL,
                caption VARCHAR(255),
                category VARCHAR(50) DEFAULT 'general',
                sort_order INT DEFAULT 0,
                status ENUM('active','inactive') DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ website_gallery table created');

        // 5. Insert default services (skip if already exist)
        const [existingServices] = await pool.query('SELECT COUNT(*) as cnt FROM website_services');
        if (existingServices[0].cnt === 0) {
            await pool.query(`
                INSERT INTO website_services (title, title_tamil, description, description_tamil, icon, sort_order) VALUES
                ('Interior Painting', 'உட்புற வண்ணம்', 'Transform your living spaces with premium interior painting services. Expert color matching and flawless finishes.', 'உயர்தர உட்புற பெயிண்டிங் சேவைகளுடன் உங்கள் வாழ்க்கை இடங்களை மாற்றுங்கள்.', 'home', 1),
                ('Exterior Painting', 'வெளிப்புற வண்ணம்', 'Weather-resistant exterior painting that protects and beautifies your property for years to come.', 'உங்கள் சொத்தை பாதுகாக்கும் மற்றும் அழகுபடுத்தும் வானிலை-எதிர்ப்பு வெளிப்புற பெயிண்டிங்.', 'building', 2),
                ('Texture & Waterproofing', 'டெக்சர் & நீர்புகா', 'Add depth and protection with texture coatings and waterproofing solutions for lasting beauty.', 'நீடித்த அழகுக்கான டெக்சர் பூச்சுகள் மற்றும் நீர்புகா தீர்வுகள்.', 'texture', 3),
                ('Free Color Consultation', 'இலவச நிற ஆலோசனை', 'Get expert advice on the perfect colors for your space. Free consultation at your doorstep.', 'உங்கள் இடத்திற்கு சரியான நிறங்கள் பற்றிய நிபுணர் ஆலோசனை. இலவச ஆலோசனை.', 'lightbulb', 4)
            `);
            console.log('✅ Default services inserted (4 items)');
        } else {
            console.log('⏭️ Services already exist, skipping defaults');
        }

        // 6. Insert default features (skip if already exist)
        const [existingFeatures] = await pool.query('SELECT COUNT(*) as cnt FROM website_features');
        if (existingFeatures[0].cnt === 0) {
            await pool.query(`
                INSERT INTO website_features (title, title_tamil, description, description_tamil, icon, color, sort_order) VALUES
                ('5+ Years Experience', '5+ ஆண்டுகள் அனுபவம்', 'Trusted by hundreds of families across Ramanathapuram district.', 'ராமநாதபுரம் மாவட்டம் முழுவதும் நூற்றுக்கணக்கான குடும்பங்களால் நம்பப்படுகிறது.', 'check-circle', 'green', 1),
                ('Expert Painters', 'திறமையான ஓவியர்கள்', 'Skilled professionals trained in the latest painting techniques.', 'சமீபத்திய பெயிண்டிங் நுட்பங்களில் பயிற்சி பெற்ற திறமையான நிபுணர்கள்.', 'users', 'blue', 2),
                ('Quality Guaranteed', 'தர உத்தரவாதம்', 'We use only premium branded paints with guaranteed quality results.', 'உத்தரவாதமான தரமான முடிவுகளுடன் பிரீமியம் பிராண்ட் பெயிண்ட்களை மட்டுமே பயன்படுத்துகிறோம்.', 'badge-check', 'purple', 3),
                ('Free Home Visit', 'இலவச வீட்டுப் பார்வை', 'Book a free home visit for accurate measurements and estimates.', 'துல்லியமான அளவீடுகள் மற்றும் மதிப்பீடுகளுக்கு இலவச வீட்டுப் பார்வையை பதிவு செய்யுங்கள்.', 'home', 'amber', 4)
            `);
            console.log('✅ Default features inserted (4 items)');
        } else {
            console.log('⏭️ Features already exist, skipping defaults');
        }

        // 7. Insert default testimonials
        const [existingTestimonials] = await pool.query('SELECT COUNT(*) as cnt FROM website_testimonials');
        if (existingTestimonials[0].cnt === 0) {
            await pool.query(`
                INSERT INTO website_testimonials (customer_name, customer_role, testimonial_text, testimonial_text_tamil, rating, sort_order) VALUES
                ('Rajesh Kumar', 'Homeowner', 'Excellent work! Quality Colours transformed our house completely. The team was professional and finished on time.', 'சிறந்த வேலை! குவாலிட்டி கலர்ஸ் எங்கள் வீட்டை முழுமையாக மாற்றியது.', 5, 1),
                ('Priya Lakshmi', 'Interior Designer', 'I recommend Quality Colours to all my clients. Their attention to detail and color accuracy is unmatched.', 'எனது அனைத்து வாடிக்கையாளர்களுக்கும் குவாலிட்டி கலர்ஸை பரிந்துரைக்கிறேன்.', 5, 2),
                ('Mohammed Farook', 'Contractor', 'Best paint shop in Ramanathapuram district. Great prices and genuine products always.', 'ராமநாதபுரம் மாவட்டத்தில் சிறந்த பெயிண்ட் கடை. எப்போதும் சிறந்த விலை.', 5, 3)
            `);
            console.log('✅ Default testimonials inserted (3 items)');
        } else {
            console.log('⏭️ Testimonials already exist, skipping defaults');
        }

        // 8. Insert website settings (skip if already exist)
        const settingsDefaults = [
            ['hero_title', 'Quality Colours'],
            ['hero_title_tamil', 'குவாலிட்டி கலர்ஸ்'],
            ['hero_subtitle', 'Professional Paint Shop'],
            ['hero_subtitle_tamil', 'ராமநாதபுரம் மாவட்டம் முழுவதும்'],
            ['hero_cta1_text', 'Get Free Estimate'],
            ['hero_cta1_link', '/request-estimate.html'],
            ['hero_cta2_text', 'Color Design Request'],
            ['hero_cta2_link', '#design-request'],
            ['about_title', 'About Us'],
            ['about_title_tamil', 'எங்களைப் பற்றி'],
            ['about_description', 'Quality Colours is a leading paint shop serving Ramanathapuram district with premium painting products and professional painting services. With multiple branches and years of experience, we bring color to life in every home and business.'],
            ['about_description_tamil', 'குவாலிட்டி கலர்ஸ் ராமநாதபுரம் மாவட்டத்தில் உயர்தர பெயிண்டிங் பொருட்கள் மற்றும் தொழில்முறை பெயிண்டிங் சேவைகளை வழங்கும் முன்னணி பெயிண்ட் கடை.'],
            ['design_request_response_time', '24 hours'],
            ['footer_tagline', 'Professional paint shop serving Ramanathapuram district with premium products and expert services.'],
            ['footer_tagline_tamil', 'உயர்தர பொருட்கள் மற்றும் நிபுணர் சேவைகளுடன் ராமநாதபுரம் மாவட்டத்தை சேவை செய்யும் தொழில்முறை பெயிண்ட் கடை.'],
            ['social_whatsapp', ''],
            ['social_instagram', ''],
            ['social_facebook', ''],
            ['social_youtube', '']
        ];

        let settingsInserted = 0;
        for (const [key, value] of settingsDefaults) {
            const [existing] = await pool.query('SELECT id FROM settings WHERE setting_key = ?', [key]);
            if (existing.length === 0) {
                await pool.query(
                    'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?)',
                    [key, value]
                );
                settingsInserted++;
            }
        }
        console.log(`✅ Settings: ${settingsInserted} new keys inserted (${settingsDefaults.length - settingsInserted} already existed)`);

        // Verify tables
        console.log('\n📊 Migration Summary:');
        for (const table of ['website_services', 'website_features', 'website_testimonials', 'website_gallery']) {
            const [cols] = await pool.query(`DESCRIBE ${table}`);
            const [count] = await pool.query(`SELECT COUNT(*) as cnt FROM ${table}`);
            console.log(`   ${table}: ${cols.length} columns, ${count[0].cnt} rows`);
        }

        console.log('\n✅ Website content migration complete!');

    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

migrate();
