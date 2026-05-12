/**
 * Backfill zoho_items_map.zoho_cf_dpl from zoho_bulk_job_items payloads.
 *
 * Context: prior to the COALESCE fix in syncItems(), every sync run would
 * overwrite zoho_cf_dpl with NULL because Zoho's GET /items LIST endpoint
 * does not include custom_fields. The dpl_updated_at column survived (it is
 * not touched by the sync), but the cf_dpl value was wiped. As a result the
 * admin-dpl.html "already pushed" detection (which compares cf_dpl with the
 * row's DPL) silently failed for every brand the user had pushed.
 *
 * Source of truth: each successful bulk job item retains its payload
 * containing { cf_dpl, rate, name, sku, description }. Pick the LATEST
 * completed payload per zoho_item_id and restore cf_dpl.
 *
 * Idempotent — safe to re-run.
 *
 * Run with:  node migrations/backfill-zoho-cf-dpl-from-jobs.js
 */
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function backfill() {
  let pool;
  try {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'business_manager',
      port: process.env.DB_PORT || 3306
    });

    console.log('Backfilling zoho_cf_dpl from bulk-job payloads...\n');

    // Latest completed payload per zoho_item_id whose payload mentions cf_dpl.
    const [rows] = await pool.query(`
      SELECT ji1.zoho_item_id, ji1.payload, ji1.processed_at
        FROM zoho_bulk_job_items ji1
        JOIN (
          SELECT zoho_item_id, MAX(id) AS max_id
            FROM zoho_bulk_job_items
           WHERE status = 'completed'
             AND payload LIKE '%"cf_dpl"%'
           GROUP BY zoho_item_id
        ) latest ON latest.max_id = ji1.id
    `);
    console.log(`Found ${rows.length} item(s) with a previously-pushed cf_dpl payload.`);

    let updated = 0;
    let skipped = 0;
    let untouched = 0;

    for (const row of rows) {
      let parsed;
      try { parsed = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload; }
      catch (_) { skipped++; continue; }

      if (parsed.cf_dpl == null) { skipped++; continue; }
      const cfDpl = String(parsed.cf_dpl);

      // Only restore where the column is currently NULL or empty — don't overwrite
      // a value Zoho has already echoed back to us correctly.
      const [result] = await pool.query(
        `UPDATE zoho_items_map
            SET zoho_cf_dpl = ?
          WHERE zoho_item_id = ?
            AND (zoho_cf_dpl IS NULL OR zoho_cf_dpl = '' OR zoho_cf_dpl = '0')`,
        [cfDpl, row.zoho_item_id]
      );
      if (result.affectedRows > 0) updated++;
      else untouched++;
    }

    console.log(`\n  ✓ Restored: ${updated}`);
    console.log(`  · Already set (skipped): ${untouched}`);
    console.log(`  · Skipped (bad payload / no cf_dpl): ${skipped}`);

    // Sanity summary
    const [[summary]] = await pool.query(`
      SELECT
        SUM(zoho_cf_dpl IS NOT NULL AND zoho_cf_dpl <> '' AND zoho_cf_dpl <> '0') AS with_dpl,
        SUM(dpl_updated_at IS NOT NULL) AS stamped,
        COUNT(*) AS total
      FROM zoho_items_map WHERE zoho_status = 'active'
    `);
    console.log(`\nPost-backfill summary (active items):`);
    console.log(`  · with cf_dpl: ${summary.with_dpl}`);
    console.log(`  · with dpl_updated_at stamped: ${summary.stamped}`);
    console.log(`  · total active: ${summary.total}`);
    console.log('\n✓ Backfill complete.\n');
  } catch (err) {
    console.error('Backfill failed:', err);
    process.exit(1);
  } finally {
    if (pool) await pool.end();
  }
}

backfill();
