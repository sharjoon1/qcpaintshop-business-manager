/**
 * Reorder Report Service — assembles daily reorder reports per-branch or consolidated.
 * Reads from: zoho_reorder_alerts (active), zoho_items_map, zoho_locations_map,
 *             zoho_reorder_config, zoho_location_stock, branches.
 * Delivery (WhatsApp/FCM/PDF) is added in Task 11.
 */

let pool;
function setPool(p) { pool = p; }

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

function sortReportRows(rows) {
    return [...rows].sort((a, b) => {
        const sa = SEVERITY_RANK[a.severity] || 0;
        const sb = SEVERITY_RANK[b.severity] || 0;
        if (sb !== sa) return sb - sa;
        return (a.days_to_stockout ?? Infinity) - (b.days_to_stockout ?? Infinity);
    });
}

function buildOtherBranchesMap(stockRows, targetBranchId) {
    const map = new Map();
    for (const s of stockRows) {
        if (targetBranchId != null && s.local_branch_id === targetBranchId) continue;
        if (Number(s.stock_on_hand) <= 0) continue;
        if (!map.has(s.zoho_item_id)) map.set(s.zoho_item_id, []);
        map.get(s.zoho_item_id).push({
            branch_id: s.local_branch_id,
            branch_name: s.location_name,
            stock_on_hand: Number(s.stock_on_hand)
        });
    }
    for (const arr of map.values()) arr.sort((a, b) => b.stock_on_hand - a.stock_on_hand);
    return map;
}

async function assembleReport({ branchId = null, date = null } = {}) {
    if (!pool) throw new Error('pool not set');
    const reportDate = date || new Date().toISOString().slice(0, 10);

    let where = `WHERE a.status = 'active'`;
    const params = [];
    if (branchId != null) {
        where += ` AND zlm.local_branch_id = ?`;
        params.push(branchId);
    }

    const [alerts] = await pool.query(`
        SELECT a.zoho_item_id, a.zoho_location_id, a.severity,
               zim.zoho_item_name AS item_name,
               zim.zoho_sku AS sku,
               zim.zoho_brand AS brand,
               zim.zoho_unit AS unit,
               zlm.local_branch_id AS branch_id,
               zlm.location_name AS branch_name,
               rc.reorder_level,
               rc.reorder_quantity,
               rc.avg_daily_sales,
               COALESCE(ls.stock_on_hand, 0) AS current_stock
        FROM zoho_reorder_alerts a
        JOIN zoho_items_map zim ON zim.zoho_item_id = a.zoho_item_id
        JOIN zoho_locations_map zlm ON zlm.zoho_location_id = a.zoho_location_id
        LEFT JOIN zoho_reorder_config rc
            ON rc.zoho_item_id = a.zoho_item_id AND rc.zoho_location_id = a.zoho_location_id
        LEFT JOIN zoho_location_stock ls
            ON ls.zoho_item_id = a.zoho_item_id AND ls.zoho_location_id = a.zoho_location_id
        ${where}
    `, params);

    const itemIds = [...new Set(alerts.map(a => a.zoho_item_id))];
    let stocks = [];
    if (itemIds.length > 0) {
        const [rowsStocks] = await pool.query(`
            SELECT ls.zoho_item_id, zlm.local_branch_id, zlm.location_name,
                   ls.stock_on_hand
            FROM zoho_location_stock ls
            JOIN zoho_locations_map zlm ON zlm.zoho_location_id = ls.zoho_location_id
            WHERE ls.zoho_item_id IN (?) AND ls.stock_on_hand > 0
        `, [itemIds]);
        stocks = rowsStocks;
    }

    const rows = alerts.map(a => {
        const avg = Number(a.avg_daily_sales || 0);
        const daysToStockout = avg > 0 ? Math.floor(Number(a.current_stock) / avg) : null;
        const suggestedQty = Math.max(
            0,
            Number(a.reorder_level || 0) + Number(a.reorder_quantity || 0) - Number(a.current_stock)
        );

        const otherBranchesMap = buildOtherBranchesMap(stocks, a.branch_id);
        const otherBranches = otherBranchesMap.get(a.zoho_item_id) || [];

        return {
            item_name: a.item_name,
            sku: a.sku,
            brand: a.brand,
            unit: a.unit,
            branch_id: a.branch_id,
            branch_name: a.branch_name,
            current_stock: Number(a.current_stock),
            reorder_level: Number(a.reorder_level || 0),
            severity: a.severity,
            avg_daily_sales: avg,
            days_to_stockout: daysToStockout,
            suggested_order_qty: suggestedQty,
            other_branches: otherBranches
        };
    });

    return {
        report_date: reportDate,
        scope: branchId != null ? `branch:${branchId}` : 'consolidated',
        rows: sortReportRows(rows)
    };
}

module.exports = {
    setPool,
    sortReportRows,
    buildOtherBranchesMap,
    assembleReport
};
