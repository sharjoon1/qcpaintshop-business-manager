/**
 * Painter Estimate Sequence Migration (W04)
 *
 * Creates a per-day sequence table so generateEstimateNumber() can be atomic.
 * Replaces the old SELECT-then-INSERT pattern that allowed concurrent requests
 * to assign duplicate PE numbers.
 *
 * Run: node migrations/migrate-painter-estimate-sequence.js
 */

const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

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

        console.log('Creating painter_estimate_sequence table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS painter_estimate_sequence (
                date_prefix VARCHAR(12) NOT NULL PRIMARY KEY,
                last_seq INT UNSIGNED NOT NULL DEFAULT 0,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        console.log('  OK painter_estimate_sequence created');

        // Backfill today's row from existing painter_estimates so the next number
        // continues the existing sequence instead of restarting at 0001.
        console.log('Backfilling today\'s sequence from existing estimates...');
        const now = new Date();
        const todayPrefix = `PE${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        const [rows] = await pool.query(
            "SELECT estimate_number FROM painter_estimates WHERE estimate_number LIKE ? ORDER BY id DESC LIMIT 1",
            [todayPrefix + '%']
        );
        if (rows.length) {
            const lastSeq = parseInt(rows[0].estimate_number.substring(todayPrefix.length)) || 0;
            await pool.query(
                `INSERT INTO painter_estimate_sequence (date_prefix, last_seq) VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE last_seq = GREATEST(last_seq, VALUES(last_seq))`,
                [todayPrefix, lastSeq]
            );
            console.log(`  OK backfilled ${todayPrefix} -> last_seq=${lastSeq}`);
        } else {
            console.log('  SKIP no estimates for today, sequence starts fresh');
        }

        console.log('\nMigration complete.');
    } catch (err) {
        console.error('Migration failed:', err.message);
        process.exit(1);
    } finally {
        if (pool) await pool.end();
    }
}

migrate();
