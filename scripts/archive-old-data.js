/**
 * Data Archival Script
 * Moves records older than a cutoff (default 2 years) to _archive tables.
 *
 * Usage:
 *   node scripts/archive-old-data.js              # dry-run (default)
 *   node scripts/archive-old-data.js --execute     # actually archive
 *   node scripts/archive-old-data.js --months 18   # custom cutoff (18 months)
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const TABLES = [
    {
        source: 'zoho_invoices',
        dateColumn: 'invoice_date',
        description: 'Zoho invoices'
    },
    {
        source: 'zoho_payments',
        dateColumn: 'payment_date',
        description: 'Zoho payments'
    },
    {
        source: 'zoho_stock_history',
        dateColumn: 'recorded_at',
        description: 'Stock change history'
    }
];

const args = process.argv.slice(2);
const dryRun = !args.includes('--execute');
const monthsIdx = args.indexOf('--months');
const cutoffMonths = monthsIdx !== -1 ? parseInt(args[monthsIdx + 1]) : 24;

async function run() {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    console.log('=== Data Archival ===');
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'EXECUTE'}`);
    console.log(`Cutoff: ${cutoffMonths} months ago`);
    console.log('');

    let totalArchived = 0;

    for (const table of TABLES) {
        const archiveTable = table.source + '_archive';

        // Ensure archive table exists (clone structure from source)
        try {
            await pool.query(`CREATE TABLE IF NOT EXISTS \`${archiveTable}\` LIKE \`${table.source}\``);
        } catch (err) {
            console.error(`Failed to create ${archiveTable}:`, err.message);
            continue;
        }

        // Count records to archive
        const [countRows] = await pool.query(
            `SELECT COUNT(*) as cnt FROM \`${table.source}\` WHERE \`${table.dateColumn}\` < DATE_SUB(CURDATE(), INTERVAL ? MONTH)`,
            [cutoffMonths]
        );
        const count = countRows[0].cnt;

        const [totalRows] = await pool.query(`SELECT COUNT(*) as cnt FROM \`${table.source}\``);

        console.log(`${table.description} (${table.source}):`);
        console.log(`  Total rows: ${totalRows[0].cnt}`);
        console.log(`  To archive: ${count}`);
        console.log(`  Remaining:  ${totalRows[0].cnt - count}`);

        if (count === 0) {
            console.log('  → Nothing to archive\n');
            continue;
        }

        if (dryRun) {
            console.log('  → Skipped (dry run)\n');
            continue;
        }

        // Archive in batches of 1000
        const batchSize = 1000;
        let archived = 0;

        while (archived < count) {
            const conn = await pool.getConnection();
            try {
                await conn.beginTransaction();

                // Insert into archive
                const [inserted] = await conn.query(
                    `INSERT INTO \`${archiveTable}\` SELECT * FROM \`${table.source}\` WHERE \`${table.dateColumn}\` < DATE_SUB(CURDATE(), INTERVAL ? MONTH) LIMIT ?`,
                    [cutoffMonths, batchSize]
                );

                if (inserted.affectedRows === 0) break;

                // Delete from source (use subquery to match exact IDs just inserted)
                await conn.query(
                    `DELETE FROM \`${table.source}\` WHERE id IN (SELECT id FROM \`${archiveTable}\` WHERE id IN (SELECT id FROM \`${table.source}\` WHERE \`${table.dateColumn}\` < DATE_SUB(CURDATE(), INTERVAL ? MONTH) LIMIT ?))`,
                    [cutoffMonths, batchSize]
                );

                await conn.commit();
                archived += inserted.affectedRows;
                process.stdout.write(`  → Archived ${archived}/${count}\r`);
            } catch (err) {
                await conn.rollback();
                console.error(`\n  Error archiving ${table.source}:`, err.message);
                break;
            } finally {
                conn.release();
            }
        }

        console.log(`  → Archived ${archived} rows\n`);
        totalArchived += archived;
    }

    console.log(`=== Done: ${totalArchived} total rows archived ===`);
    await pool.end();
}

run().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
