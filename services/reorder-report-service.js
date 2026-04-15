/**
 * Reorder Report Service — assembles daily reorder reports per-branch or consolidated.
 * Reads from: zoho_reorder_alerts (active), zoho_items_map, zoho_locations_map,
 *             zoho_reorder_config, zoho_location_stock, branches.
 * Delivery (WhatsApp/FCM/PDF) is added in Task 11.
 */

let pool;
function setPool(p) { pool = p; }

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1, suggested: 0 };

function computeSuggestedLevel(avgDaily, leadDays, safetyDays) {
    return Math.ceil(avgDaily * (leadDays + safetyDays));
}
function computeSuggestedQty(avgDaily) {
    return Math.ceil(avgDaily * 15);
}
function severityForRatio(currentStock, reorderLevel) {
    if (reorderLevel <= 0) return null;
    const ratio = currentStock / reorderLevel;
    if (ratio > 1) return null;
    if (ratio <= 0.25) return 'critical';
    if (ratio <= 0.50) return 'high';
    if (ratio <= 0.75) return 'medium';
    return 'low';
}

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
               zlm.zoho_location_name AS branch_name,
               rc.reorder_level,
               rc.reorder_quantity,
               rc.avg_daily_sales,
               COALESCE(ls.stock_on_hand, 0) AS current_stock
        FROM zoho_reorder_alerts a
        JOIN zoho_items_map zim ON zim.zoho_item_id = a.zoho_item_id
        JOIN zoho_locations_map zlm ON zlm.zoho_location_id = a.zoho_location_id AND zlm.is_active = 1
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
            SELECT ls.zoho_item_id, zlm.local_branch_id, zlm.zoho_location_name AS location_name,
                   ls.stock_on_hand
            FROM zoho_location_stock ls
            JOIN zoho_locations_map zlm ON zlm.zoho_location_id = ls.zoho_location_id AND zlm.is_active = 1
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
            zoho_item_id: a.zoho_item_id,
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

    // --- ALSO include suggested items: recent sales but no active alert row yet ---
    // Pulls items from branch_item_sales with velocity > 0 that are NOT already in alerts,
    // computes suggested reorder_level from brand config, includes only if stock <= suggested.
    const existingKeys = new Set(alerts.map(a => `${a.branch_id}|${a.zoho_item_id}`));

    let suggestWhere = `WHERE bis.sale_date >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)`;
    const suggestParams = [];
    if (branchId != null) {
        suggestWhere += ` AND bis.local_branch_id = ?`;
        suggestParams.push(branchId);
    }

    const [suggestRows] = await pool.query(`
        SELECT bis.local_branch_id AS branch_id,
               bis.zoho_item_id,
               SUM(bis.qty_sold) AS total_qty,
               zim.zoho_item_name AS item_name,
               zim.zoho_sku AS sku,
               zim.zoho_brand AS brand,
               zim.zoho_unit AS unit,
               zlm.zoho_location_id,
               zlm.zoho_location_name AS branch_name,
               COALESCE(ls.stock_on_hand, 0) AS current_stock
        FROM branch_item_sales bis
        JOIN zoho_items_map zim ON zim.zoho_item_id = bis.zoho_item_id
        LEFT JOIN zoho_locations_map zlm ON zlm.local_branch_id = bis.local_branch_id AND zlm.is_active = 1
        LEFT JOIN zoho_location_stock ls ON ls.zoho_item_id = bis.zoho_item_id AND ls.zoho_location_id = zlm.zoho_location_id
        ${suggestWhere}
        GROUP BY bis.local_branch_id, bis.zoho_item_id, zim.zoho_item_name, zim.zoho_sku,
                 zim.zoho_brand, zim.zoho_unit, zlm.zoho_location_id, zlm.zoho_location_name, ls.stock_on_hand
    `, suggestParams);

    // Preload brand configs for fast lookup
    const [brandCfgs] = await pool.query(`SELECT brand_name, lead_time_days, safety_days FROM brand_reorder_config WHERE is_active = 1`);
    const brandMap = new Map(brandCfgs.map(b => [b.brand_name, b]));
    const defCfg = brandMap.get('__default__') || { lead_time_days: 7, safety_days: 5 };

    // Additional stock rows for other-branches lookup (may include items not yet in alerts)
    const allItemIds = [...new Set([...alerts.map(a => a.zoho_item_id), ...suggestRows.map(s => s.zoho_item_id)])];
    let allStocks = stocks;
    if (allItemIds.length > itemIds.length && allItemIds.length > 0) {
        const [extraStocks] = await pool.query(`
            SELECT ls.zoho_item_id, zlm.local_branch_id, zlm.zoho_location_name AS location_name,
                   ls.stock_on_hand
            FROM zoho_location_stock ls
            JOIN zoho_locations_map zlm ON zlm.zoho_location_id = ls.zoho_location_id AND zlm.is_active = 1
            WHERE ls.zoho_item_id IN (?) AND ls.stock_on_hand > 0
        `, [allItemIds]);
        allStocks = extraStocks;
    }

    // Velocity map: 60-day sales per (item × branch), used to attach avg/day to other-branches chips
    const velocityMap = new Map();  // key: `${itemId}|${branchId}` → avgPerDay
    if (allItemIds.length > 0) {
        const [velRows] = await pool.query(`
            SELECT zoho_item_id, local_branch_id, SUM(qty_sold) AS total_qty
            FROM branch_item_sales
            WHERE zoho_item_id IN (?)
              AND sale_date >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)
            GROUP BY zoho_item_id, local_branch_id
        `, [allItemIds]);
        for (const v of velRows) {
            velocityMap.set(`${v.zoho_item_id}|${v.local_branch_id}`, Number(v.total_qty) / 60);
        }
    }
    const attachVelocity = (itemId, branches) => branches.map(b => ({
        ...b,
        avg_daily_sales: velocityMap.get(`${itemId}|${b.branch_id}`) || 0
    }));

    const suggestedRows = [];
    for (const s of suggestRows) {
        const key = `${s.branch_id}|${s.zoho_item_id}`;
        if (existingKeys.has(key)) continue;  // already covered by alerts
        const avg = Number(s.total_qty) / 60;
        if (avg <= 0) continue;
        const cfg = brandMap.get(s.brand) || defCfg;
        const suggestedLevel = computeSuggestedLevel(avg, cfg.lead_time_days, cfg.safety_days);
        const stock = Number(s.current_stock);
        const severity = severityForRatio(stock, suggestedLevel);
        if (!severity) continue;  // stock above suggested — no need to reorder
        const orderQty = Math.max(0, suggestedLevel + computeSuggestedQty(avg) - stock);
        const daysToStockout = Math.floor(stock / avg);

        const otherBranchesMap = buildOtherBranchesMap(allStocks, s.branch_id);
        const otherBranches = otherBranchesMap.get(s.zoho_item_id) || [];

        suggestedRows.push({
            zoho_item_id: s.zoho_item_id,
            item_name: s.item_name,
            sku: s.sku,
            brand: s.brand,
            unit: s.unit,
            branch_id: s.branch_id,
            branch_name: s.branch_name,
            current_stock: stock,
            reorder_level: suggestedLevel,
            severity,
            avg_daily_sales: avg,
            days_to_stockout: daysToStockout,
            suggested_order_qty: orderQty,
            other_branches: otherBranches,
            is_suggested: true
        });
    }

    const allRows = [...rows, ...suggestedRows];

    // Enrich each row's other_branches entries with avg/day looked up from velocityMap
    for (const row of allRows) {
        row.other_branches = attachVelocity(row.zoho_item_id, row.other_branches || []);
    }

    return {
        report_date: reportDate,
        scope: branchId != null ? `branch:${branchId}` : 'consolidated',
        rows: sortReportRows(allRows)
    };
}

module.exports = {
    setPool,
    sortReportRows,
    buildOtherBranchesMap,
    assembleReport
};

// ========================================
// TASK 11: Delivery (WhatsApp + FCM + PDF)
// ========================================

const path = require('path');
const fs = require('fs');

async function getConfigMap(keys) {
    const [rows] = await pool.query(
        `SELECT config_key, config_value FROM ai_config WHERE config_key IN (?)`,
        [keys]
    );
    const map = {};
    rows.forEach(r => { map[r.config_key] = r.config_value; });
    return map;
}

async function getRecipientsForScope(scope) {
    if (scope.startsWith('branch:')) {
        const branchId = parseInt(scope.split(':')[1], 10);
        const [rows] = await pool.query(
            `SELECT u.id AS user_id, u.full_name, u.phone
             FROM branches b
             JOIN users u ON u.id = b.manager_user_id
             WHERE b.id = ? AND u.status = 'active'`,
            [branchId]
        );
        return rows;
    }
    const cfg = await getConfigMap(['reorder_report_recipients']);
    let userIds = [];
    try { userIds = JSON.parse(cfg.reorder_report_recipients || '[]'); } catch (e) { userIds = []; }
    if (!Array.isArray(userIds) || userIds.length === 0) return [];
    const [rows] = await pool.query(
        `SELECT id AS user_id, full_name, phone FROM users WHERE id IN (?) AND status = 'active'`,
        [userIds]
    );
    return rows;
}

async function deliverReport(report, { force = false } = {}) {
    const [existing] = await pool.query(
        `SELECT id FROM reorder_report_log WHERE report_date = ? AND scope = ?`,
        [report.report_date, report.scope]
    );
    if (existing.length > 0 && !force) {
        return { skipped: true, reason: 'Already sent today' };
    }

    const deliveryStatus = { dashboard: 1, pdf: null, whatsapp: null, fcm: null };
    const cfg = await getConfigMap([
        'reorder_report_whatsapp_enabled',
        'reorder_report_fcm_enabled',
        'reorder_report_pdf_enabled'
    ]);

    let pdfPath = null;
    if (cfg.reorder_report_pdf_enabled === '1' && report.rows.length > 0) {
        const uploadsDir = path.join(__dirname, '..', 'uploads', 'reorder-reports');
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
        const safeScope = report.scope.replace(':', '-');
        pdfPath = path.join(uploadsDir, `reorder-${report.report_date}-${safeScope}.pdf`);
        try {
            const { generateReorderPdf } = require('./reorder-report-pdf-generator');
            await generateReorderPdf(report, pdfPath);
            deliveryStatus.pdf = path.basename(pdfPath);
        } catch (e) {
            deliveryStatus.pdf = 'failed:' + e.message;
            pdfPath = null;
        }
    }

    const recipients = await getRecipientsForScope(report.scope);
    const criticalCount = report.rows.filter(r => r.severity === 'critical').length;
    const summary = report.rows.length === 0
        ? `No reorder needed (${report.report_date})`
        : `Reorder Alert — ${report.rows.length} items need reorder (${criticalCount} critical)`;

    // WhatsApp via whatsapp-session-manager
    // sendMessage(branchId, phone, message) — general session branchId=0
    // sendMedia(branchId, phone, options) — for PDF attachments
    if (cfg.reorder_report_whatsapp_enabled === '1' && recipients.length > 0) {
        try {
            const waManager = require('./whatsapp-session-manager');
            for (const r of recipients) {
                if (!r.phone) continue;
                if (typeof waManager.sendMessage === 'function') {
                    await waManager.sendMessage(0, r.phone, summary).catch(e => console.error('[ReorderWA]', e.message));
                    if (pdfPath && typeof waManager.sendMedia === 'function') {
                        await waManager.sendMedia(0, r.phone, {
                            type: 'document',
                            path: pdfPath,
                            caption: 'Reorder Report'
                        }).catch(e => console.error('[ReorderWA-PDF]', e.message));
                    }
                } else {
                    console.warn('[ReorderReport] whatsapp-session-manager sendMessage not found — skipped WA for', r.phone);
                }
            }
            deliveryStatus.whatsapp = 'sent';
        } catch (e) {
            deliveryStatus.whatsapp = 'failed:' + e.message;
        }
    }

    // FCM via notification-service.send(userId, {...})
    if (cfg.reorder_report_fcm_enabled === '1' && recipients.length > 0) {
        try {
            const notificationService = require('./notification-service');
            for (const r of recipients) {
                await notificationService.send(r.user_id, {
                    type: 'reorder_report',
                    title: `Reorder Report (${report.scope})`,
                    body: summary,
                    data: { scope: report.scope, date: report.report_date },
                    ttlSeconds: 86400
                }).catch(e => console.error('[ReorderFCM]', e.message));
            }
            deliveryStatus.fcm = 'sent';
        } catch (e) {
            deliveryStatus.fcm = 'failed:' + e.message;
        }
    }

    if (existing.length > 0 && force) {
        await pool.query(
            `UPDATE reorder_report_log SET delivery_status = ?, generated_at = NOW(), items_count = ? WHERE id = ?`,
            [JSON.stringify(deliveryStatus), report.rows.length, existing[0].id]
        );
    } else {
        await pool.query(
            `INSERT INTO reorder_report_log (report_date, scope, items_count, delivery_status)
             VALUES (?, ?, ?, ?)`,
            [report.report_date, report.scope, report.rows.length, JSON.stringify(deliveryStatus)]
        );
    }

    return { delivered: true, deliveryStatus, pdfPath };
}

async function runDailyReport({ force = false } = {}) {
    const [branches] = await pool.query(`
        SELECT DISTINCT zlm.local_branch_id AS branch_id
        FROM zoho_reorder_alerts a
        JOIN zoho_locations_map zlm ON zlm.zoho_location_id = a.zoho_location_id
        WHERE a.status = 'active' AND zlm.local_branch_id IS NOT NULL
    `);

    const results = [];
    for (const b of branches) {
        const rep = await assembleReport({ branchId: b.branch_id });
        const r = await deliverReport(rep, { force });
        results.push({ scope: rep.scope, ...r });
    }

    const consolidated = await assembleReport({});
    const cr = await deliverReport(consolidated, { force });
    results.push({ scope: consolidated.scope, ...cr });

    return { branches: branches.length, results };
}

module.exports.deliverReport = deliverReport;
module.exports.runDailyReport = runDailyReport;
module.exports.getRecipientsForScope = getRecipientsForScope;
