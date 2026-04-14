/**
 * Reorder Compute Service
 * Pure helpers + DB compute/alerts logic for reorder intelligence.
 *
 * Schema notes (verified Apr 2026):
 * - zoho_reorder_alerts: no triggered_at column; uses created_at (auto-timestamp).
 *   Upsert key: uq_item_loc (zoho_item_id, zoho_location_id) — added via migration.
 * - zoho_sync_log.sync_type ENUM includes 'reorder_compute' (extended via migration 6b).
 * - zoho_sync_log.direction ENUM: 'zoho_to_local' | 'local_to_zoho' | 'bidirectional'.
 *   'internal' is not valid — using 'zoho_to_local' as closest fit for compute runs.
 */

let pool;
function setPool(p) { pool = p; }

function computeReorderLevel(avgDailySales, leadDays, safetyDays) {
    return Math.ceil(avgDailySales * (leadDays + safetyDays));
}

function computeReorderQuantity(avgDailySales) {
    return Math.ceil(avgDailySales * 15);
}

function computeSeverity(currentStock, reorderLevel) {
    if (reorderLevel <= 0) return null;
    const ratio = currentStock / reorderLevel;
    if (ratio > 1) return null;
    if (ratio <= 0.25) return 'critical';
    if (ratio <= 0.50) return 'high';
    if (ratio <= 0.75) return 'medium';
    return 'low';
}

async function getBrandConfig() {
    const [rows] = await pool.query(
        `SELECT brand_name, lead_time_days, safety_days FROM brand_reorder_config WHERE is_active = 1`
    );
    const map = new Map(rows.map(r => [r.brand_name, r]));
    const def = map.get('__default__') || { lead_time_days: 7, safety_days: 5 };
    return { map, def };
}

async function computeAll({ windowDays = 60, minSales = 1 } = {}) {
    if (!pool) throw new Error('pool not set');

    const [syncLog] = await pool.query(
        `INSERT INTO zoho_sync_log (sync_type, direction, status, triggered_by)
         VALUES ('reorder_compute', 'zoho_to_local', 'started', 0)`
    );
    const syncLogId = syncLog.insertId;

    let updated = 0, skippedNoSales = 0, skippedNoLocation = 0, skippedManual = 0;
    let alertStats = { active: 0, resolved: 0 };
    try {
        const [rows] = await pool.query(
            `SELECT bis.local_branch_id, bis.zoho_item_id,
                    SUM(bis.qty_sold) AS total_qty,
                    zim.zoho_brand AS brand,
                    zlm.zoho_location_id
             FROM branch_item_sales bis
             JOIN zoho_items_map zim ON zim.zoho_item_id = bis.zoho_item_id
             LEFT JOIN zoho_locations_map zlm ON zlm.local_branch_id = bis.local_branch_id AND zlm.is_active = 1
             WHERE bis.sale_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
             GROUP BY bis.local_branch_id, bis.zoho_item_id, zim.zoho_brand, zlm.zoho_location_id`,
            [windowDays]
        );

        const { map, def } = await getBrandConfig();

        const [manualRows] = await pool.query(
            `SELECT zoho_item_id, zoho_location_id FROM zoho_reorder_config WHERE source = 'manual'`
        );
        const manualSet = new Set(manualRows.map(m => `${m.zoho_item_id}|${m.zoho_location_id}`));

        for (const r of rows) {
            const avgDaily = Number(r.total_qty) / windowDays;
            if (Number(r.total_qty) < minSales) { skippedNoSales++; continue; }
            if (!r.zoho_location_id) { skippedNoLocation++; continue; }

            if (manualSet.has(`${r.zoho_item_id}|${r.zoho_location_id}`)) { skippedManual++; continue; }

            const cfg = map.get(r.brand) || def;
            const reorderLevel = computeReorderLevel(avgDaily, cfg.lead_time_days, cfg.safety_days);
            const reorderQty = computeReorderQuantity(avgDaily);

            await pool.query(`
                INSERT INTO zoho_reorder_config
                    (zoho_item_id, zoho_location_id, reorder_level, reorder_quantity,
                     source, avg_daily_sales, computed_at, is_active)
                VALUES (?, ?, ?, ?, 'auto', ?, NOW(), 1)
                ON DUPLICATE KEY UPDATE
                    reorder_level = VALUES(reorder_level),
                    reorder_quantity = VALUES(reorder_quantity),
                    source = 'auto',
                    avg_daily_sales = VALUES(avg_daily_sales),
                    computed_at = NOW(),
                    is_active = 1
            `, [r.zoho_item_id, r.zoho_location_id, reorderLevel, reorderQty, avgDaily]);

            updated++;
        }

        alertStats = await refreshAlerts();

        await pool.query(
            `UPDATE zoho_sync_log
             SET status = 'completed', records_synced = ?, completed_at = NOW()
             WHERE id = ?`,
            [updated, syncLogId]
        );

        console.log(`[ReorderCompute] Config: ${updated} updated, ${skippedNoSales} no-sales, ${skippedNoLocation} no-location, ${skippedManual} manual-protected`);
        return { updated, skippedNoSales, skippedNoLocation, skippedManual, alerts: alertStats };
    } catch (e) {
        await pool.query(
            `UPDATE zoho_sync_log
             SET status = 'failed', error_message = ?, completed_at = NOW()
             WHERE id = ?`,
            [e.message, syncLogId]
        );
        throw e;
    }
}

async function refreshAlerts() {
    const [rows] = await pool.query(`
        SELECT rc.zoho_item_id, rc.zoho_location_id, rc.reorder_level,
               COALESCE(ls.stock_on_hand, 0) AS stock
        FROM zoho_reorder_config rc
        LEFT JOIN zoho_location_stock ls
            ON ls.zoho_item_id = rc.zoho_item_id AND ls.zoho_location_id = rc.zoho_location_id
        WHERE rc.is_active = 1
    `);

    let active = 0, resolved = 0;
    for (const r of rows) {
        const severity = computeSeverity(Number(r.stock), Number(r.reorder_level));
        if (severity) {
            // zoho_reorder_alerts columns verified: no triggered_at; created_at auto-set.
            // current_stock has DEFAULT 0.00; reorder_level has DEFAULT 0.00 — both nullable/defaulted.
            // uq_item_loc unique key added via migration to enable ON DUPLICATE KEY UPDATE.
            await pool.query(`
                INSERT INTO zoho_reorder_alerts
                    (zoho_item_id, zoho_location_id, severity, status, current_stock, reorder_level)
                VALUES (?, ?, ?, 'active', ?, ?)
                ON DUPLICATE KEY UPDATE
                    severity = VALUES(severity),
                    status = 'active',
                    current_stock = VALUES(current_stock),
                    reorder_level = VALUES(reorder_level),
                    updated_at = NOW()
            `, [r.zoho_item_id, r.zoho_location_id, severity, Number(r.stock), Number(r.reorder_level)]);
            active++;
        } else {
            const [upd] = await pool.query(`
                UPDATE zoho_reorder_alerts
                SET status = 'resolved', resolved_at = NOW()
                WHERE zoho_item_id = ? AND zoho_location_id = ? AND status = 'active'
            `, [r.zoho_item_id, r.zoho_location_id]);
            if (upd.affectedRows > 0) resolved++;
        }
    }
    return { active, resolved };
}

module.exports = {
    setPool,
    computeReorderLevel,
    computeReorderQuantity,
    computeSeverity,
    computeAll,
    refreshAlerts
};
