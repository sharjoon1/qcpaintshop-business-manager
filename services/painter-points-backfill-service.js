/**
 * painter-points-backfill-service.js
 *
 * Backfills painter loyalty points from historical Zoho invoices.
 * Supports two attribution types:
 *   - direct_billing:  invoice where painter is the customer (zoho_customer_id match)
 *   - salesperson:     invoice where painter is the salesperson (zoho_salesperson_id match)
 *
 * Idempotent: uses INSERT IGNORE into painter_invoices_processed to prevent double-awarding.
 */

const pointsEngine = require('./painter-points-engine');

async function _loadRates(pool) {
    const [rows] = await pool.query(
        `SELECT config_key, config_value FROM ai_config WHERE config_key IN
            ('painter_self_billing_annual_rate','painter_customer_billing_regular_rate','painter_customer_billing_annual_rate')`
    );
    const map = Object.fromEntries(rows.map(r => [r.config_key, parseFloat(r.config_value)]));
    return {
        selfAnnual: map.painter_self_billing_annual_rate ?? 0.005,
        custRegular: map.painter_customer_billing_regular_rate ?? 0.005,
        custAnnual: map.painter_customer_billing_annual_rate ?? 0.005
    };
}

async function backfillPainter(painterId, fromDate, ctx = {}) {
    const pool = ctx.pool;
    if (!pool) throw new Error('backfillPainter: pool missing');
    const rates = ctx.rates || await _loadRates(pool);

    const [pRows] = await pool.query(`SELECT * FROM painters WHERE id = ? LIMIT 1`, [painterId]);
    if (!pRows.length) return { skipped: 'not_found' };
    const painter = pRows[0];
    if (!painter.activated_at) return { skipped: 'not_activated' };

    const result = {
        painter_id: painterId,
        direct_points_awarded: 0,
        salesperson_points_awarded: 0,
        invoices_processed: 0
    };

    // Direct billing: painter is the customer
    if (painter.zoho_customer_id) {
        const [direct] = await pool.query(
            `SELECT zi.zoho_invoice_id, zi.invoice_number, zi.invoice_date, zi.total
             FROM zoho_invoices zi
             WHERE zi.zoho_customer_id = ?
               AND zi.invoice_date >= ?
               AND zi.status NOT IN ('void','draft')
               AND NOT EXISTS (
                   SELECT 1 FROM painter_invoices_processed pip
                   WHERE pip.painter_id = ? AND pip.zoho_invoice_id = zi.zoho_invoice_id
                     AND pip.attribution_type='direct_billing'
               )`,
            [painter.zoho_customer_id, fromDate, painterId]
        );
        for (const inv of direct) {
            const annualPts = Math.round(Number(inv.total || 0) * rates.selfAnnual);
            if (annualPts > 0) {
                await pointsEngine.addPoints(
                    painterId, 'annual', annualPts, 'invoice_backfill',
                    `ZINV-${inv.zoho_invoice_id}-direct`, 'zoho_invoice',
                    `Backfill direct billing (invoice ${inv.invoice_date})`, null
                );
            }
            await pool.query(
                `INSERT IGNORE INTO painter_invoices_processed
                    (painter_id, invoice_id, invoice_number, invoice_date, invoice_total, billing_type,
                     regular_points, annual_points, attribution_type, zoho_invoice_id, source_invoice_date)
                 VALUES (?, ?, ?, ?, ?, 'self', 0, ?, 'direct_billing', ?, ?)`,
                [painterId, `ZINV-${inv.zoho_invoice_id}-direct`, inv.invoice_number,
                 inv.invoice_date, inv.total, annualPts, inv.zoho_invoice_id, inv.invoice_date]
            );
            result.direct_points_awarded += annualPts;
            result.invoices_processed++;
        }
    }

    // Salesperson billing: painter is the salesperson on the invoice
    if (painter.zoho_salesperson_id) {
        const [sp] = await pool.query(
            `SELECT zoho_invoice_id, invoice_number, invoice_date, total FROM zoho_invoices WHERE zoho_salesperson_id = ?
               AND invoice_date >= ?
               AND status NOT IN ('void','draft')
               AND NOT EXISTS (
                   SELECT 1 FROM painter_invoices_processed pip
                   WHERE pip.painter_id = ? AND pip.zoho_invoice_id = zoho_invoices.zoho_invoice_id
                     AND pip.attribution_type='salesperson'
               )`,
            [painter.zoho_salesperson_id, fromDate, painterId]
        );
        for (const inv of sp) {
            const regularPts = Math.round(Number(inv.total || 0) * rates.custRegular);
            const annualPts = Math.round(Number(inv.total || 0) * rates.custAnnual);
            if (regularPts > 0) {
                await pointsEngine.addPoints(
                    painterId, 'regular', regularPts, 'invoice_backfill',
                    `ZINV-${inv.zoho_invoice_id}-salesperson-r`, 'zoho_invoice',
                    `Backfill salesperson regular (invoice ${inv.invoice_date})`, null
                );
            }
            if (annualPts > 0) {
                await pointsEngine.addPoints(
                    painterId, 'annual', annualPts, 'invoice_backfill',
                    `ZINV-${inv.zoho_invoice_id}-salesperson-a`, 'zoho_invoice',
                    `Backfill salesperson annual (invoice ${inv.invoice_date})`, null
                );
            }
            await pool.query(
                `INSERT IGNORE INTO painter_invoices_processed
                    (painter_id, invoice_id, invoice_number, invoice_date, invoice_total, billing_type,
                     regular_points, annual_points, attribution_type, zoho_invoice_id, source_invoice_date)
                 VALUES (?, ?, ?, ?, ?, 'customer', ?, ?, 'salesperson', ?, ?)`,
                [painterId, `ZINV-${inv.zoho_invoice_id}-salesperson`, inv.invoice_number,
                 inv.invoice_date, inv.total, regularPts, annualPts, inv.zoho_invoice_id, inv.invoice_date]
            );
            result.salesperson_points_awarded += (regularPts + annualPts);
            result.invoices_processed++;
        }
    }

    return result;
}

async function previewBackfill({ pool, fromDate, painterIds = null }) {
    let where = `WHERE activated_at IS NOT NULL`;
    const params = [];
    if (painterIds && painterIds.length) {
        where += ` AND id IN (${painterIds.map(() => '?').join(',')})`;
        params.push(...painterIds);
    }
    const [painters] = await pool.query(`SELECT id, zoho_customer_id, zoho_salesperson_id FROM painters ${where}`, params);
    let totalInvoices = 0, totalEstimatedPoints = 0;
    const rates = await _loadRates(pool);
    for (const p of painters) {
        if (p.zoho_customer_id) {
            const [d] = await pool.query(
                `SELECT COUNT(*) AS c, COALESCE(SUM(total), 0) AS total FROM zoho_invoices
                 WHERE zoho_customer_id = ? AND invoice_date >= ? AND status NOT IN ('void','draft')`,
                [p.zoho_customer_id, fromDate]
            );
            totalInvoices += d[0].c;
            totalEstimatedPoints += Math.round(Number(d[0].total) * rates.selfAnnual);
        }
        if (p.zoho_salesperson_id) {
            const [s] = await pool.query(
                `SELECT COUNT(*) AS c, COALESCE(SUM(total), 0) AS total FROM zoho_invoices
                 WHERE zoho_salesperson_id = ? AND invoice_date >= ? AND status NOT IN ('void','draft')`,
                [p.zoho_salesperson_id, fromDate]
            );
            totalInvoices += s[0].c;
            totalEstimatedPoints += Math.round(Number(s[0].total) * (rates.custRegular + rates.custAnnual));
        }
    }
    return { painter_count: painters.length, invoices: totalInvoices, estimated_points: totalEstimatedPoints };
}

async function runBulkBackfill({ pool, fromDate, painterIds = null }) {
    const rates = await _loadRates(pool);
    let where = `WHERE activated_at IS NOT NULL`;
    const params = [];
    if (painterIds && painterIds.length) {
        where += ` AND id IN (${painterIds.map(() => '?').join(',')})`;
        params.push(...painterIds);
    }
    const [painters] = await pool.query(`SELECT id FROM painters ${where}`, params);
    const summary = { total_painters: painters.length, total_points: 0, total_invoices: 0 };
    for (const p of painters) {
        const r = await backfillPainter(p.id, fromDate, { pool, rates });
        summary.total_points += (r.direct_points_awarded || 0) + (r.salesperson_points_awarded || 0);
        summary.total_invoices += (r.invoices_processed || 0);
    }
    return summary;
}

async function runDailyIncremental({ pool }) {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return runBulkBackfill({ pool, fromDate: yesterday });
}

module.exports = {
    backfillPainter,
    previewBackfill,
    runBulkBackfill,
    runDailyIncremental,
    _loadRates
};
