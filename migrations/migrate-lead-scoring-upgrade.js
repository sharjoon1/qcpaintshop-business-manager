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

        console.log('Connected to database. Running lead scoring upgrade migration...\n');

        // 1. Add lead_score column to leads table
        console.log('1. Adding lead_score columns to leads table...');
        const [cols] = await pool.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'lead_score'
        `);
        if (cols.length === 0) {
            await pool.query(`ALTER TABLE leads ADD COLUMN lead_score INT DEFAULT NULL`);
            await pool.query(`ALTER TABLE leads ADD COLUMN lead_score_updated_at TIMESTAMP NULL`);
            await pool.query(`ALTER TABLE leads ADD INDEX idx_lead_score (lead_score)`);
            console.log('   ✅ lead_score + lead_score_updated_at columns added');
        } else {
            console.log('   ⏭️ lead_score column already exists');
        }

        // 2. Create lead_conversion_predictions table
        console.log('\n2. Creating lead_conversion_predictions table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS lead_conversion_predictions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                lead_id INT NOT NULL,
                conversion_probability DECIMAL(5,2) DEFAULT 0,
                predicted_timeline VARCHAR(100),
                confidence DECIMAL(5,2) DEFAULT 0,
                factors_json JSON,
                ai_explanation TEXT,
                predicted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_lcp_lead (lead_id),
                INDEX idx_lcp_probability (conversion_probability)
            )
        `);
        console.log('   ✅ lead_conversion_predictions table created');

        // 3. Backfill existing scores from ai_lead_scores
        console.log('\n3. Backfilling existing scores to leads table...');
        const [backfillResult] = await pool.query(`
            UPDATE leads l
            JOIN ai_lead_scores als ON l.id = als.lead_id
            SET l.lead_score = als.score, l.lead_score_updated_at = als.scored_at
            WHERE l.lead_score IS NULL
        `);
        console.log(`   ✅ ${backfillResult.affectedRows} leads backfilled with scores`);

        // 4. Seed config settings
        console.log('\n4. Seeding config settings...');
        const settings = [
            ['lead_nurture_enabled', '1'],
            ['lead_prediction_enabled', '1']
        ];
        let seeded = 0;
        for (const [key, value] of settings) {
            const [existing] = await pool.query('SELECT config_key FROM ai_config WHERE config_key = ?', [key]);
            if (existing.length === 0) {
                await pool.query('INSERT INTO ai_config (config_key, config_value) VALUES (?, ?)', [key, value]);
                seeded++;
            }
        }
        console.log(`   ✅ ${seeded} new settings seeded`);

        console.log('\n✅ Lead scoring upgrade migration completed successfully!');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate();
