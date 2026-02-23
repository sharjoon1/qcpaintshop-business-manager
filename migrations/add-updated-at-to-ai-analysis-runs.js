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

        console.log('Adding updated_at to ai_analysis_runs...\n');

        const [cols] = await pool.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_analysis_runs' AND COLUMN_NAME = 'updated_at'
        `);

        if (cols.length === 0) {
            await pool.query(`
                ALTER TABLE ai_analysis_runs
                ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            `);
            console.log('✅ ai_analysis_runs.updated_at added');

            // Backfill existing rows with created_at value
            await pool.query('UPDATE ai_analysis_runs SET updated_at = created_at WHERE updated_at IS NULL');
            console.log('✅ Backfilled existing rows');
        } else {
            console.log('⏭️ ai_analysis_runs.updated_at already exists');
        }

        console.log('\n✅ Migration completed!');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate();
