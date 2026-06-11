/**
 * GST Reports — monthly auditor/filing + internal analysis reports.
 *
 * Four reports (admin-gst-reports.html):
 *   /filing          — ACTUAL sales for GST filing: B2B (customers with a
 *                      GSTIN, invoice-wise) + B2C summary + HSN summary.
 *                      Always reflects every non-void invoice at its real
 *                      value — never filtered by the gst_purchase flag.
 *   /cost-analysis   — INTERNAL ONLY: the month's item-wise sales restated at
 *                      purchase price (DPL → zoho_purchase_rate →
 *                      last_purchase_rate). Items flagged gst_purchase=0 are
 *                      split out. Clearly labeled NOT FOR GST FILING.
 *   /commission-expense — painter commission actually paid out in the month
 *                      (approved/paid withdrawals) — a deductible expense.
 *   /profitability   — month summary: actual sales − cost basis − commission
 *                      − staff salary = indicative net.
 *
 * Sales lines come from branch_item_sales (the reorder-intelligence invoice
 * line sync; zoho_invoices.line_items is never populated by the header sync).
 */
const express = require('express');
const router = express.Router();
const { requirePermission } = require('../middleware/permissionMiddleware');
const zohoAPI = require('../services/zoho-api');

let pool;
function setPool(p) { pool = p; }

// ── pure helpers (exported for tests) ───────────────────────────────────────

/** 'YYYY-MM' → ['YYYY-MM-01', 'YYYY-MM-<lastday>'] (throws on bad input). */
function monthRange(month) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
    if (!m) throw new Error('month must be YYYY-MM');
    const year = parseInt(m[1], 10);
    const mon = parseInt(m[2], 10);
    if (mon < 1 || mon > 12) throw new Error('month must be YYYY-MM');
    const lastDay = new Date(year, mon, 0).getDate();
    return [`${m[1]}-${m[2]}-01`, `${m[1]}-${m[2]}-${String(lastDay).padStart(2, '0')}`];
}

/** GSTIN present (after trimming) → B2B. */
function isB2B(gstin) {
    return !!(gstin && String(gstin).trim() !== '');
}

/**
 * Auditor's invoice-number range for the month: first/last by the numeric
 * part of the invoice number (falls back to lexical when non-numeric).
 */
function invoiceNumberRange(numbers) {
    const list = (numbers || []).filter(n => n != null && String(n).trim() !== '');
    if (!list.length) return { first: null, last: null, count: 0 };
    const numeric = list.map(n => {
        const m = String(n).match(/(\d+)\s*$/);
        return { n, key: m ? parseInt(m[1], 10) : null };
    });
    if (numeric.every(x => x.key != null)) {
        numeric.sort((a, b) => a.key - b.key);
    } else {
        numeric.sort((a, b) => String(a.n).localeCompare(String(b.n)));
    }
    return { first: numeric[0].n, last: numeric[numeric.length - 1].n, count: list.length };
}

/**
 * Purchase-cost rate for an item row. Preference: DPL custom field (when it
 * parses to a positive number) → zoho_purchase_rate → last_purchase_rate.
 * Returns { rate, source } or { rate: null, source: 'none' }.
 */
function resolveCostRate(item) {
    const dpl = parseFloat(item.zoho_cf_dpl);
    if (Number.isFinite(dpl) && dpl > 0) return { rate: dpl, source: 'dpl' };
    const pr = parseFloat(item.zoho_purchase_rate);
    if (Number.isFinite(pr) && pr > 0) return { rate: pr, source: 'purchase_rate' };
    const lpr = parseFloat(item.last_purchase_rate);
    if (Number.isFinite(lpr) && lpr > 0) return { rate: lpr, source: 'last_purchase_rate' };
    return { rate: null, source: 'none' };
}

const r2 = n => Math.round(n * 100) / 100;

const GST_RATE = 0.18; // paints/putty are uniformly 18% (the §6 DPL formula's 1.18)

/**
 * Zoho's invoice LIST sync stores only `total` (sub_total/tax_total arrive as
 * 0 on every row — verified 0/15,527 on prod). When that happens, derive the
 * split from the GST-inclusive total at the uniform 18% rate and say so.
 * Returns { taxable, gst, derived }.
 */
function deriveTax(total, subTotal, taxTotal) {
    const tot = parseFloat(total) || 0;
    const sub = parseFloat(subTotal) || 0;
    const tax = parseFloat(taxTotal) || 0;
    if (sub > 0 || tax > 0) return { taxable: r2(sub), gst: r2(tax), derived: false };
    const taxable = r2(tot / (1 + GST_RATE));
    return { taxable, gst: r2(tot - taxable), derived: true };
}

// ── GST FILING (actual sales) ────────────────────────────────────────────────

router.get('/filing', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const [from, to] = monthRange(req.query.month);
        const params = [from, to];
        let branchSql = '';
        if (req.query.branch_id) { branchSql = ' AND zi.local_branch_id = ?'; params.push(req.query.branch_id); }

        const [invoices] = await pool.query(
            `SELECT zi.invoice_number, zi.invoice_date, zi.customer_name, zi.status,
                    zi.sub_total, zi.tax_total, zi.total,
                    TRIM(COALESCE(zcm.zoho_gst_no, '')) AS gstin
             FROM zoho_invoices zi
             LEFT JOIN zoho_customers_map zcm ON zcm.zoho_contact_id = zi.zoho_customer_id
             WHERE zi.invoice_date BETWEEN ? AND ? AND zi.status <> 'void'${branchSql}
             ORDER BY zi.invoice_date, zi.invoice_number`,
            params
        );

        const b2b = [];
        const b2c = { invoice_count: 0, sub_total: 0, tax_total: 0, total: 0 };
        let anyDerived = false;
        for (const inv of invoices) {
            const t = deriveTax(inv.total, inv.sub_total, inv.tax_total);
            anyDerived = anyDerived || t.derived;
            inv.sub_total = t.taxable;
            inv.tax_total = t.gst;
            inv.tax_derived = t.derived;
            if (isB2B(inv.gstin)) {
                b2b.push(inv);
            } else {
                b2c.invoice_count++;
                b2c.sub_total += t.taxable;
                b2c.tax_total += t.gst;
                b2c.total += parseFloat(inv.total) || 0;
            }
        }
        b2c.sub_total = r2(b2c.sub_total); b2c.tax_total = r2(b2c.tax_total); b2c.total = r2(b2c.total);

        // HSN summary from synced invoice lines (revenue = pre-tax line total)
        const hsnParams = [from, to];
        let hsnBranchSql = '';
        if (req.query.branch_id) { hsnBranchSql = ' AND bis.local_branch_id = ?'; hsnParams.push(req.query.branch_id); }
        const [hsn] = await pool.query(
            `SELECT COALESCE(NULLIF(zim.zoho_hsn_or_sac, ''), '(no HSN)') AS hsn,
                    MAX(zim.zoho_tax_percentage) AS tax_pct,
                    SUM(bis.qty_sold) AS qty,
                    SUM(bis.revenue) AS taxable_value
             FROM branch_item_sales bis
             LEFT JOIN zoho_items_map zim ON zim.zoho_item_id = bis.zoho_item_id
             WHERE bis.sale_date BETWEEN ? AND ?${hsnBranchSql}
             GROUP BY COALESCE(NULLIF(zim.zoho_hsn_or_sac, ''), '(no HSN)')
             ORDER BY taxable_value DESC`,
            hsnParams
        );

        const totals = {
            invoice_count: invoices.length,
            b2b_count: b2b.length,
            sub_total: r2(invoices.reduce((s, i) => s + (parseFloat(i.sub_total) || 0), 0)),
            tax_total: r2(invoices.reduce((s, i) => s + (parseFloat(i.tax_total) || 0), 0)),
            total: r2(invoices.reduce((s, i) => s + (parseFloat(i.total) || 0), 0)),
        };

        res.json({
            success: true, month: req.query.month, totals, b2b, b2c, hsn,
            invoice_range: invoiceNumberRange(invoices.map(i => i.invoice_number)),
            tax_note: anyDerived
                ? 'Taxable/GST split derived from the GST-inclusive total at a uniform 18% (Zoho line-level tax is not synced). Cross-check totals against Zoho Books’ own GSTR-1 before filing.'
                : null,
        });
    } catch (err) {
        console.error('GST filing report error:', err);
        res.status(400).json({ success: false, message: err.message });
    }
});

// ── B2B ITEM-LEVEL DETAIL (HSN-wise, for GSTR-1 invoice annexure) ───────────
// Per-invoice line items live only in Zoho (the header sync never stores
// them) — fetched on demand via the Zoho API and cached into
// zoho_invoices.line_items, so each invoice costs one API call ever.

router.get('/b2b-items', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const [from, to] = monthRange(req.query.month);
        const params = [from, to];
        let customerSql = '';
        if (req.query.customer) { customerSql = ' AND zi.customer_name = ?'; params.push(req.query.customer); }

        const [invoices] = await pool.query(
            `SELECT zi.zoho_invoice_id, zi.invoice_number, zi.invoice_date, zi.customer_name,
                    zi.total, zi.line_items, TRIM(COALESCE(zcm.zoho_gst_no, '')) AS gstin
             FROM zoho_invoices zi
             JOIN zoho_customers_map zcm ON zcm.zoho_contact_id = zi.zoho_customer_id
             WHERE zi.invoice_date BETWEEN ? AND ? AND zi.status <> 'void'
               AND TRIM(COALESCE(zcm.zoho_gst_no, '')) <> ''${customerSql}
             ORDER BY zi.invoice_date, zi.invoice_number
             LIMIT 300`,
            params
        );

        const out = [];
        let fetchedFromZoho = 0;
        for (const inv of invoices) {
            let lines = null;
            if (inv.line_items) {
                try { lines = JSON.parse(inv.line_items); } catch (e) { lines = null; }
            }
            if (!lines) {
                try {
                    const resp = await zohoAPI.getInvoice(inv.zoho_invoice_id, { caller: 'gst-b2b-items', priority: 'high' });
                    lines = (resp && resp.invoice && resp.invoice.line_items) || [];
                    fetchedFromZoho++;
                    await pool.query('UPDATE zoho_invoices SET line_items = ? WHERE zoho_invoice_id = ?',
                        [JSON.stringify(lines), inv.zoho_invoice_id]);
                } catch (e) {
                    out.push({
                        invoice_number: inv.invoice_number, invoice_date: inv.invoice_date,
                        customer_name: inv.customer_name, gstin: inv.gstin, total: inv.total,
                        items: [], fetch_error: 'Zoho fetch failed: ' + e.message,
                    });
                    continue;
                }
            }
            out.push({
                invoice_number: inv.invoice_number, invoice_date: inv.invoice_date,
                customer_name: inv.customer_name, gstin: inv.gstin, total: inv.total,
                items: (lines || []).map(li => ({
                    name: li.name || li.description || '',
                    hsn: li.hsn_or_sac || '',
                    quantity: parseFloat(li.quantity) || 0,
                    rate: parseFloat(li.rate) || 0,
                    item_total: parseFloat(li.item_total) || 0,
                })),
            });
        }

        // HSN fallback from the items map for lines Zoho returned without one
        const missing = new Set();
        for (const inv of out) for (const it of inv.items) if (!it.hsn && it.name) missing.add(it.name);
        if (missing.size) {
            const [hsnRows] = await pool.query(
                `SELECT zoho_item_name, zoho_hsn_or_sac FROM zoho_items_map
                 WHERE zoho_item_name IN (?) AND COALESCE(zoho_hsn_or_sac, '') <> ''`,
                [[...missing]]
            );
            const hsnByName = Object.fromEntries(hsnRows.map(r => [r.zoho_item_name, r.zoho_hsn_or_sac]));
            for (const inv of out) for (const it of inv.items) if (!it.hsn) it.hsn = hsnByName[it.name] || '';
        }

        res.json({ success: true, month: req.query.month, invoices: out, fetched_from_zoho: fetchedFromZoho });
    } catch (err) {
        console.error('GST b2b-items error:', err);
        res.status(400).json({ success: false, message: err.message });
    }
});

// ── INTERNAL COST ANALYSIS (not for filing) ─────────────────────────────────

router.get('/cost-analysis', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const [from, to] = monthRange(req.query.month);
        const params = [from, to];
        let branchSql = '';
        if (req.query.branch_id) { branchSql = ' AND bis.local_branch_id = ?'; params.push(req.query.branch_id); }

        const [rows] = await pool.query(
            `SELECT bis.zoho_item_id,
                    COALESCE(zim.zoho_item_name, bis.zoho_item_id) AS item_name,
                    zim.zoho_sku, zim.zoho_hsn_or_sac,
                    COALESCE(zim.gst_purchase, 1) AS gst_purchase,
                    zim.zoho_cf_dpl, zim.zoho_purchase_rate, zim.last_purchase_rate,
                    SUM(bis.qty_sold) AS qty,
                    SUM(bis.revenue) AS actual_revenue
             FROM branch_item_sales bis
             LEFT JOIN zoho_items_map zim ON zim.zoho_item_id = bis.zoho_item_id
             WHERE bis.sale_date BETWEEN ? AND ?${branchSql}
             GROUP BY bis.zoho_item_id
             ORDER BY actual_revenue DESC`,
            params
        );

        const included = [];
        const excluded_non_gst = [];
        const no_cost_data = [];
        const summary = { actual_revenue: 0, cost_value: 0, qty: 0 };

        for (const row of rows) {
            const { rate, source } = resolveCostRate(row);
            const qty = parseFloat(row.qty) || 0;
            const item = {
                zoho_item_id: row.zoho_item_id,
                item_name: row.item_name,
                sku: row.zoho_sku,
                hsn: row.zoho_hsn_or_sac,
                qty,
                actual_revenue: r2(parseFloat(row.actual_revenue) || 0),
                cost_rate: rate,
                cost_source: source,
                cost_value: rate != null ? r2(qty * rate) : null,
            };
            if (Number(row.gst_purchase) === 0) {
                excluded_non_gst.push(item);
            } else if (rate == null) {
                no_cost_data.push(item);
            } else {
                included.push(item);
                summary.actual_revenue = r2(summary.actual_revenue + item.actual_revenue);
                summary.cost_value = r2(summary.cost_value + item.cost_value);
                summary.qty += qty;
            }
        }
        summary.gross_margin = r2(summary.actual_revenue - summary.cost_value);

        res.json({
            success: true,
            month: req.query.month,
            disclaimer: 'INTERNAL COST ANALYSIS — NOT FOR GST FILING. GST is filed on actual sale values (see the Filing tab).',
            summary, included, excluded_non_gst, no_cost_data,
        });
    } catch (err) {
        console.error('GST cost-analysis error:', err);
        res.status(400).json({ success: false, message: err.message });
    }
});

// ── per-item gst_purchase flag management ───────────────────────────────────

router.get('/item-flags', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const search = `%${req.query.search || ''}%`;
        const [items] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name, zoho_sku, zoho_brand,
                    COALESCE(gst_purchase, 1) AS gst_purchase
             FROM zoho_items_map
             WHERE zoho_status = 'active' AND (zoho_item_name LIKE ? OR zoho_sku LIKE ?)
             ORDER BY (COALESCE(gst_purchase,1) = 0) DESC, zoho_item_name
             LIMIT 200`,
            [search, search]
        );
        res.json({ success: true, items });
    } catch (err) {
        console.error('GST item-flags error:', err);
        res.status(500).json({ success: false, message: 'Failed to load items' });
    }
});

router.put('/item-flags/:zohoItemId', requirePermission('zoho', 'edit'), async (req, res) => {
    try {
        const flag = req.body.gst_purchase ? 1 : 0;
        const [r] = await pool.query(
            'UPDATE zoho_items_map SET gst_purchase = ? WHERE zoho_item_id = ?',
            [flag, req.params.zohoItemId]
        );
        if (!r.affectedRows) return res.status(404).json({ success: false, message: 'Item not found' });
        res.json({ success: true, gst_purchase: flag });
    } catch (err) {
        console.error('GST item-flag update error:', err);
        res.status(500).json({ success: false, message: 'Failed to update flag' });
    }
});

// ── PAINTER COMMISSION EXPENSE ──────────────────────────────────────────────

router.get('/commission-expense', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const [from, to] = monthRange(req.query.month);
        const [rows] = await pool.query(
            `SELECT pw.id, pw.painter_id, p.full_name, p.phone, pw.pool AS point_pool,
                    pw.amount, pw.status, pw.processed_at, pw.payment_reference
             FROM painter_withdrawals pw
             JOIN painters p ON p.id = pw.painter_id
             WHERE pw.status IN ('approved', 'paid')
               AND pw.processed_at >= ? AND pw.processed_at < DATE_ADD(?, INTERVAL 1 DAY)
             ORDER BY pw.processed_at`,
            [from, to]
        );
        const total = r2(rows.reduce((s, w) => s + (parseFloat(w.amount) || 0), 0));
        res.json({
            success: true, month: req.query.month, total, withdrawals: rows,
            note: 'Commission actually paid out (approved/paid withdrawals) — the deductible expense basis.',
        });
    } catch (err) {
        console.error('GST commission report error:', err);
        res.status(400).json({ success: false, message: err.message });
    }
});

// ── PROFITABILITY SUMMARY ───────────────────────────────────────────────────

router.get('/profitability', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const [from, to] = monthRange(req.query.month);

        const [[salesRaw]] = await pool.query(
            `SELECT COALESCE(SUM(sub_total), 0) AS taxable, COALESCE(SUM(tax_total), 0) AS gst,
                    COALESCE(SUM(total), 0) AS total, COUNT(*) AS invoices
             FROM zoho_invoices WHERE invoice_date BETWEEN ? AND ? AND status <> 'void'`,
            [from, to]
        );
        const salesTax = deriveTax(salesRaw.total, salesRaw.taxable, salesRaw.gst);
        const sales = { invoices: salesRaw.invoices, taxable: salesTax.taxable, gst: salesTax.gst, total: r2(parseFloat(salesRaw.total)) };

        // True COGS: every sold item at cost, regardless of the gst_purchase flag
        const [costRows] = await pool.query(
            `SELECT zim.zoho_cf_dpl, zim.zoho_purchase_rate, zim.last_purchase_rate,
                    SUM(bis.qty_sold) AS qty
             FROM branch_item_sales bis
             LEFT JOIN zoho_items_map zim ON zim.zoho_item_id = bis.zoho_item_id
             WHERE bis.sale_date BETWEEN ? AND ?
             GROUP BY bis.zoho_item_id`,
            [from, to]
        );
        let cogs = 0, uncosted = 0;
        for (const row of costRows) {
            const { rate } = resolveCostRate(row);
            if (rate == null) { uncosted++; continue; }
            cogs += (parseFloat(row.qty) || 0) * rate;
        }

        const [[commission]] = await pool.query(
            `SELECT COALESCE(SUM(amount), 0) AS total FROM painter_withdrawals
             WHERE status IN ('approved', 'paid') AND processed_at >= ? AND processed_at < DATE_ADD(?, INTERVAL 1 DAY)`,
            [from, to]
        );
        const [[salary]] = await pool.query(
            `SELECT COALESCE(SUM(gross_salary), 0) AS total FROM monthly_salaries WHERE salary_month = ?`,
            [req.query.month]
        );

        const cogsR = r2(cogs);
        const grossMargin = r2(sales.taxable - cogsR);
        const commissionTotal = r2(parseFloat(commission.total));
        const salaryTotal = r2(parseFloat(salary.total));

        res.json({
            success: true, month: req.query.month,
            sales,
            cogs: cogsR, uncosted_items: uncosted,
            gross_margin: grossMargin,
            painter_commission: commissionTotal,
            staff_salary: salaryTotal,
            indicative_net: r2(grossMargin - commissionTotal - salaryTotal),
            note: 'Indicative only — rent and other expenses are outside this system; your auditor finalizes the P&L.'
                + (salesTax.derived ? ' Taxable derived from totals at a uniform 18% GST.' : ''),
        });
    } catch (err) {
        console.error('GST profitability error:', err);
        res.status(400).json({ success: false, message: err.message });
    }
});

module.exports = { router, setPool, monthRange, isB2B, resolveCostRate, deriveTax, invoiceNumberRange };
