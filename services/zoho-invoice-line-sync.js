/**
 * Zoho Invoice Line Sync Service
 * Pulls Zoho invoice line items and aggregates them into branch_item_sales.
 * Part of the Reorder Intelligence feature (Task 4).
 */

const zohoAPI = require('./zoho-api');

let pool;
function setPool(p) { pool = p; }

function toIsoDate(d) {
    return d.toISOString().slice(0, 10);
}

function addDays(date, days) {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
}

/**
 * Pure helper — compute sync window.
 * @param {string|null} lastSaleDate - ISO date string or null
 * @param {Date} now
 * @returns {{ from: string, to: string }}
 */
function computeSyncWindow(lastSaleDate, now = new Date()) {
    const yesterday = addDays(now, -1);
    if (!lastSaleDate) {
        return { from: toIsoDate(addDays(now, -90)), to: toIsoDate(yesterday) };
    }
    const from = addDays(new Date(lastSaleDate), -1);
    return { from: toIsoDate(from), to: toIsoDate(yesterday) };
}

/**
 * Pure helper — aggregate invoice line items by (branch × item × date).
 * @param {Array} invoices
 * @returns {Array}
 */
function aggregateLineItems(invoices) {
    const key = (b, i, d) => `${b}|${i}|${d}`;
    const map = new Map();
    for (const inv of invoices) {
        const seenItems = new Set();
        for (const li of (inv.line_items || [])) {
            const k = key(inv.local_branch_id, li.item_id, inv.invoice_date);
            if (!map.has(k)) {
                map.set(k, {
                    local_branch_id: inv.local_branch_id,
                    zoho_item_id: li.item_id,
                    sale_date: inv.invoice_date,
                    qty_sold: 0, revenue: 0, invoice_count: 0
                });
            }
            const agg = map.get(k);
            agg.qty_sold += Number(li.quantity || 0);
            agg.revenue += Number(li.item_total || 0);
            if (!seenItems.has(li.item_id)) {
                agg.invoice_count += 1;
                seenItems.add(li.item_id);
            }
        }
    }
    return Array.from(map.values());
}

/**
 * Returns the ISO date string of MAX(sale_date) from branch_item_sales, or null if empty.
 */
async function getLastSyncedDate() {
    const [rows] = await pool.query(`SELECT MAX(sale_date) AS last FROM branch_item_sales`);
    return rows[0]?.last ? toIsoDate(new Date(rows[0].last)) : null;
}

async function fetchUnsyncedInvoices(window) {
    const [rows] = await pool.query(
        `SELECT zi.invoice_id, zi.invoice_date, zi.local_branch_id
         FROM zoho_invoices zi
         LEFT JOIN invoice_line_sync_cursor c ON c.invoice_id = zi.invoice_id
         WHERE zi.invoice_date BETWEEN ? AND ?
           AND zi.local_branch_id IS NOT NULL
           AND c.invoice_id IS NULL
         ORDER BY zi.invoice_date ASC, zi.invoice_id ASC`,
        [window.from, window.to]
    );
    return rows;
}

async function upsertAggregates(aggs) {
    if (aggs.length === 0) return;
    const values = aggs.map(a => [a.local_branch_id, a.zoho_item_id, a.sale_date, a.qty_sold, a.revenue, a.invoice_count]);
    await pool.query(
        `INSERT INTO branch_item_sales
         (local_branch_id, zoho_item_id, sale_date, qty_sold, revenue, invoice_count)
         VALUES ?
         ON DUPLICATE KEY UPDATE
           qty_sold = qty_sold + VALUES(qty_sold),
           revenue = revenue + VALUES(revenue),
           invoice_count = invoice_count + VALUES(invoice_count)`,
        [values]
    );
}

async function markCursor(invoiceId, lineCount) {
    await pool.query(
        `INSERT IGNORE INTO invoice_line_sync_cursor (invoice_id, line_count) VALUES (?, ?)`,
        [invoiceId, lineCount]
    );
}

function isRateLimitError(err) {
    const m = (err?.message || '').toLowerCase();
    return m.includes('rate limit') || m.includes('error 45') || m.includes('error 57') || m.includes('quota');
}

/**
 * Main sync job — resumable with cursor. Batch size 50.
 * @param {{ emitProgress?: Function }} options
 * @returns {{ synced, failed, total, window, pausedOnRateLimit? }}
 */
async function syncInvoiceLines({ emitProgress } = {}) {
    if (!pool) throw new Error('pool not set');

    const lastDate = await getLastSyncedDate();
    const window = computeSyncWindow(lastDate);
    const invoices = await fetchUnsyncedInvoices(window);

    console.log(`[InvoiceLineSync] Window ${window.from}..${window.to} — ${invoices.length} unsynced invoices`);
    if (invoices.length === 0) return { synced: 0, total: 0, window };

    let synced = 0, failed = 0;
    const BATCH = 50;

    for (let i = 0; i < invoices.length; i += BATCH) {
        const slice = invoices.slice(i, i + BATCH);
        const fetched = [];
        const pendingCursor = [];  // {invoice_id, line_count}

        let hitRateLimit = false;
        for (const inv of slice) {
            try {
                const resp = await zohoAPI.getInvoice(inv.invoice_id);
                const full = resp?.invoice || resp;
                const lineItems = full?.line_items || [];
                fetched.push({
                    invoice_id: inv.invoice_id,
                    invoice_date: toIsoDate(new Date(inv.invoice_date)),
                    local_branch_id: inv.local_branch_id,
                    line_items: lineItems
                });
                pendingCursor.push({ invoice_id: inv.invoice_id, line_count: lineItems.length });
            } catch (e) {
                failed++;
                console.error(`[InvoiceLineSync] ${inv.invoice_id}: ${e.message}`);
                if (isRateLimitError(e)) {
                    console.warn('[InvoiceLineSync] Rate limit hit, stopping batch for resume next run');
                    hitRateLimit = true;
                    break;
                }
            }
        }

        // Flush: upsert first, THEN mark cursors. If upsert fails, cursors stay unmarked → next run retries these invoices.
        try {
            await upsertAggregates(aggregateLineItems(fetched));
            for (const c of pendingCursor) {
                await markCursor(c.invoice_id, c.line_count);
                synced++;
            }
        } catch (e) {
            console.error(`[InvoiceLineSync] Batch upsert failed, cursors NOT marked; will retry next run: ${e.message}`);
            // Don't mark cursors. Let next run re-fetch and retry this batch.
            throw e;  // surface the failure; caller (cron) will log and retry
        }

        if (hitRateLimit) {
            return { synced, failed, total: invoices.length, window, pausedOnRateLimit: true };
        }

        if (emitProgress) emitProgress({ synced, failed, total: invoices.length });
        console.log(`[InvoiceLineSync] Progress ${synced}/${invoices.length}`);
    }

    console.log(`[InvoiceLineSync] Done. Synced ${synced}, failed ${failed}`);
    return { synced, failed, total: invoices.length, window };
}

module.exports = {
    setPool,
    computeSyncWindow,
    aggregateLineItems,
    getLastSyncedDate,
    syncInvoiceLines
};
