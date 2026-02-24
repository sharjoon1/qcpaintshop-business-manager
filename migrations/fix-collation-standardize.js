/**
 * Standardize all tables to utf8mb4_unicode_ci collation
 *
 * Problem: 79 tables use utf8mb4_unicode_ci, 52 use utf8mb4_general_ci
 * This causes "Illegal mix of collations" errors in UNION queries and JOINs
 *
 * Solution: Convert all utf8mb4_general_ci tables to utf8mb4_unicode_ci
 *
 * Run: node migrations/fix-collation-standardize.js
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
        connectionLimit: 2
    });

    try {
        console.log('=== Collation Standardization Migration ===\n');

        // Find all tables with utf8mb4_general_ci
        const [tables] = await pool.query(
            `SELECT TABLE_NAME FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_COLLATION = 'utf8mb4_general_ci'
             ORDER BY TABLE_NAME`
        );

        console.log(`Found ${tables.length} tables with utf8mb4_general_ci to convert:\n`);
        tables.forEach(t => console.log(`  - ${t.TABLE_NAME}`));
        console.log('');

        let converted = 0;
        let failed = 0;

        for (const table of tables) {
            const name = table.TABLE_NAME;
            try {
                await pool.query(
                    `ALTER TABLE \`${name}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
                );
                console.log(`  ✓ ${name}`);
                converted++;
            } catch (err) {
                console.error(`  ✗ ${name}: ${err.message}`);
                failed++;
            }
        }

        // Also set the database default collation
        const [dbInfo] = await pool.query('SELECT DATABASE() as db');
        await pool.query(
            `ALTER DATABASE \`${dbInfo[0].db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        );
        console.log(`\n  ✓ Database default collation set to utf8mb4_unicode_ci`);

        console.log(`\n=== Results ===`);
        console.log(`Converted: ${converted}`);
        console.log(`Failed: ${failed}`);
        console.log(`Total: ${tables.length}`);

        // Verify
        const [remaining] = await pool.query(
            `SELECT COUNT(*) as cnt FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_COLLATION != 'utf8mb4_unicode_ci'`
        );
        console.log(`\nRemaining non-unicode_ci tables: ${remaining[0].cnt}`);

    } catch (err) {
        console.error('Migration failed:', err.message);
    } finally {
        await pool.end();
    }
}

migrate();
