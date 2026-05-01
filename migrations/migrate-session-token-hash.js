/**
 * Session Token Hashing Migration (audit Task 3 / 2026-05-01).
 *
 * Adds `token_hash` (SHA-256 hex) column to:
 *   - user_sessions   (staff/admin bearer tokens)
 *   - painter_sessions (painter X-Painter-Token)
 *
 * Backfills existing rows so live sessions survive the deploy. The old raw
 * `session_token`/`token` columns are LEFT IN PLACE so a rollback to old
 * code can still authenticate. They can be dropped later once the new
 * code is observed stable.
 *
 * Run: node migrations/migrate-session-token-hash.js
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

        async function addHashColumn(table, rawCol) {
            console.log(`\n[${table}] adding token_hash column...`);
            try {
                await pool.query(
                    `ALTER TABLE ${table} ADD COLUMN token_hash CHAR(64) NULL,
                     ADD INDEX idx_token_hash (token_hash)`
                );
                console.log(`  OK token_hash + index added`);
            } catch (err) {
                if (err.code === 'ER_DUP_FIELDNAME') {
                    console.log(`  SKIP token_hash already exists`);
                } else {
                    throw err;
                }
            }

            console.log(`[${table}] backfilling token_hash from ${rawCol}...`);
            const [result] = await pool.query(
                `UPDATE ${table}
                 SET token_hash = LOWER(SHA2(${rawCol}, 256))
                 WHERE token_hash IS NULL AND ${rawCol} IS NOT NULL`
            );
            console.log(`  OK ${result.affectedRows} rows backfilled`);

            const [verify] = await pool.query(
                `SELECT COUNT(*) AS c FROM ${table}
                 WHERE token_hash IS NULL AND ${rawCol} IS NOT NULL`
            );
            if (verify[0].c > 0) {
                throw new Error(`backfill incomplete on ${table}: ${verify[0].c} rows still missing token_hash`);
            }
            console.log(`  OK no rows missing token_hash`);
        }

        await addHashColumn('user_sessions', 'session_token');
        await addHashColumn('painter_sessions', 'token');

        console.log('\nMigration complete.');
    } catch (err) {
        console.error('\nMigration failed:', err.message);
        process.exit(1);
    } finally {
        if (pool) await pool.end();
    }
}

migrate();
