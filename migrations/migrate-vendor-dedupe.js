/**
 * Dedupe the `vendors` table by `zoho_contact_id`.
 *
 * Root cause: `routes/vendors.js::POST /sync-zoho` uses ON DUPLICATE KEY UPDATE
 * on zoho_contact_id, but the column had no UNIQUE index (only a regular idx),
 * so every sync re-inserted the same contact. Some zoho_contact_ids have
 * 5 duplicate rows.
 *
 * Strategy:
 *   1. For each zoho_contact_id with multiple rows, keep the lowest vendors.id
 *      (the "survivor"). Re-point every FK reference to the survivor.
 *   2. Delete the loser rows.
 *   3. Add UNIQUE KEY on zoho_contact_id so future syncs can't re-dupe.
 *
 * Idempotent.
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 3,
        multipleStatements: true
    });

    try {
        console.log('[migrate-vendor-dedupe] START');

        // Step 1: Find dup groups
        const [groups] = await pool.query(`
            SELECT zoho_contact_id, MIN(id) AS survivor_id, COUNT(*) AS cnt
            FROM vendors
            WHERE zoho_contact_id IS NOT NULL AND zoho_contact_id <> ''
            GROUP BY zoho_contact_id
            HAVING COUNT(*) > 1
        `);

        if (groups.length === 0) {
            console.log('· no duplicates by zoho_contact_id');
        } else {
            console.log(`· ${groups.length} zoho_contact_id groups with duplicates`);

            // Tables that reference vendors.id — confirmed by explorer earlier
            const fkTables = [
                { table: 'vendor_bills',             column: 'vendor_id' },
                { table: 'vendor_purchase_orders',   column: 'vendor_id' },
                { table: 'vendor_payments',          column: 'vendor_id' },
                { table: 'item_vendor_map',          column: 'vendor_id' },
                { table: 'zoho_items_map',           column: 'preferred_vendor_id' }
            ];

            let totalRepointed = 0;
            let totalDeleted = 0;
            for (const g of groups) {
                const survivorId = g.survivor_id;
                // Losers = all other rows with same zoho_contact_id
                const [losers] = await pool.query(
                    `SELECT id FROM vendors WHERE zoho_contact_id = ? AND id <> ?`,
                    [g.zoho_contact_id, survivorId]
                );
                const loserIds = losers.map(r => r.id);
                if (loserIds.length === 0) continue;

                // Re-point FKs from losers → survivor
                for (const { table, column } of fkTables) {
                    try {
                        // Use a fresh IN list per batch (mysql2 handles ? with arrays)
                        const [u] = await pool.query(
                            `UPDATE ${table} SET ${column} = ? WHERE ${column} IN (?)`,
                            [survivorId, loserIds]
                        );
                        if (u.affectedRows > 0) {
                            totalRepointed += u.affectedRows;
                        }
                    } catch (e) {
                        // item_vendor_map has PK (zoho_item_id, vendor_id) — repointing can
                        // collide with an existing survivor row. Handle that case by
                        // merging loser aggregates into survivor row, then DELETE loser.
                        if (table === 'item_vendor_map' && /Duplicate entry/i.test(e.message)) {
                            // Merge: for each (zoho_item_id, loser vendor_id) that would
                            // collide, fold bill_count/total_qty into the survivor row.
                            const [collide] = await pool.query(`
                                SELECT l.zoho_item_id, l.bill_count AS l_count, l.total_qty AS l_qty,
                                       l.last_bill_date AS l_date, l.last_bill_rate AS l_rate,
                                       l.source AS l_source
                                FROM item_vendor_map l
                                WHERE l.vendor_id IN (?)
                                  AND EXISTS (SELECT 1 FROM item_vendor_map s
                                              WHERE s.zoho_item_id = l.zoho_item_id AND s.vendor_id = ?)
                            `, [loserIds, survivorId]);
                            for (const c of collide) {
                                await pool.query(`
                                    UPDATE item_vendor_map
                                    SET bill_count = bill_count + ?,
                                        total_qty  = total_qty + ?,
                                        last_bill_date = IFNULL(GREATEST(last_bill_date, ?), last_bill_date),
                                        last_bill_rate = CASE WHEN ? >= IFNULL(last_bill_date,'1900-01-01') THEN ? ELSE last_bill_rate END,
                                        source = IF(source='manual' OR ?='manual','manual','auto')
                                    WHERE zoho_item_id = ? AND vendor_id = ?
                                `, [c.l_count, c.l_qty, c.l_date, c.l_date, c.l_rate, c.l_source, c.zoho_item_id, survivorId]);
                            }
                            // Delete loser rows (merged + non-colliding that still need repoint)
                            await pool.query(
                                `DELETE FROM item_vendor_map WHERE vendor_id IN (?) AND zoho_item_id IN (
                                    SELECT zoho_item_id FROM (
                                        SELECT zoho_item_id FROM item_vendor_map
                                        WHERE vendor_id IN (?)
                                          AND EXISTS (SELECT 1 FROM item_vendor_map s
                                                      WHERE s.zoho_item_id = item_vendor_map.zoho_item_id AND s.vendor_id = ?)
                                    ) x
                                )`,
                                [loserIds, loserIds, survivorId]
                            );
                            // Now re-point remaining (non-colliding) loser rows to survivor
                            const [u2] = await pool.query(
                                `UPDATE item_vendor_map SET vendor_id = ? WHERE vendor_id IN (?)`,
                                [survivorId, loserIds]
                            );
                            totalRepointed += u2.affectedRows;
                        } else {
                            throw e;
                        }
                    }
                }

                // Delete the duplicate vendor rows
                const [d] = await pool.query(
                    `DELETE FROM vendors WHERE id IN (?)`, [loserIds]
                );
                totalDeleted += d.affectedRows;
            }

            console.log(`· repointed ${totalRepointed} FK rows`);
            console.log(`· deleted ${totalDeleted} duplicate vendor rows`);
        }

        // Step 2: drop the old non-unique idx_zoho_contact_id and add UNIQUE
        const [idx] = await pool.query(
            `SELECT INDEX_NAME, NON_UNIQUE FROM information_schema.statistics
             WHERE table_schema = DATABASE() AND table_name = 'vendors'
               AND column_name = 'zoho_contact_id'`
        );
        const hasUnique = idx.some(r => r.NON_UNIQUE === 0);
        if (hasUnique) {
            console.log('· vendors.zoho_contact_id already has a UNIQUE index');
        } else {
            // Drop non-unique first if it exists
            for (const r of idx) {
                if (r.NON_UNIQUE === 1 && r.INDEX_NAME !== 'PRIMARY') {
                    try {
                        await pool.query(`ALTER TABLE vendors DROP INDEX \`${r.INDEX_NAME}\``);
                        console.log(`  dropped non-unique index ${r.INDEX_NAME}`);
                    } catch (e) { /* ignore */ }
                }
            }
            await pool.query(
                `ALTER TABLE vendors ADD UNIQUE KEY uq_zoho_contact_id (zoho_contact_id)`
            );
            console.log('✓ vendors.zoho_contact_id → UNIQUE');
        }

        const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM vendors`);
        const [[{ distinct_ids }]] = await pool.query(
            `SELECT COUNT(DISTINCT zoho_contact_id) AS distinct_ids FROM vendors WHERE zoho_contact_id IS NOT NULL`
        );
        console.log(`· vendors now: ${total} rows, ${distinct_ids} distinct zoho_contact_ids`);

        console.log('[migrate-vendor-dedupe] DONE');
    } catch (e) {
        console.error('[migrate-vendor-dedupe] FAIL', e);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    run().then(() => process.exit(process.exitCode || 0));
}

module.exports = { run };
