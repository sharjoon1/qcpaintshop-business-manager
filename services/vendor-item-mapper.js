/**
 * Vendor ↔ Item mapping service.
 *
 * Flow:
 *   1. scanFromZohoBills({ monthsBack }) — pulls bills from Zoho Books for the
 *      window, walks line_items, and aggregates into `item_vendor_map` keyed
 *      by (zoho_item_id, vendor_id). Local `vendors` table is created/updated
 *      on demand from Zoho contact_id.
 *   2. inferPrimaries() — for each item in the map, promotes the most-frequent
 *      vendor (bill_count desc, tiebreak by last_bill_date desc) to
 *      `is_primary = 1` and mirrors it onto zoho_items_map.preferred_vendor_id.
 *   3. pushPreferredVendorToZoho(zohoItemId) — PUT /items/{id} with
 *      `vendor_id` so Zoho's item master reflects the preferred vendor.
 */

const zohoAPI = require('./zoho-api');

let pool;
function setPool(p) { pool = p; }

async function ensureLocalVendor(zohoContactId, contactName, gstNo) {
    if (!zohoContactId) return null;
    const [existing] = await pool.query(
        `SELECT id FROM vendors WHERE zoho_contact_id = ? LIMIT 1`,
        [String(zohoContactId)]
    );
    if (existing.length) return existing[0].id;

    const [ins] = await pool.query(
        `INSERT INTO vendors (zoho_contact_id, vendor_name, gst_number, status)
         VALUES (?, ?, ?, 'active')`,
        [String(zohoContactId), contactName || 'Unknown Vendor', gstNo || null]
    );
    return ins.insertId;
}

/**
 * Fetch bills from Zoho between the last `monthsBack` months and aggregate
 * into item_vendor_map. Does NOT automatically flip is_primary — caller
 * should invoke inferPrimaries() afterwards.
 */
async function scanFromZohoBills({ monthsBack = 6, triggeredBy = null } = {}) {
    if (!pool) throw new Error('pool not set');
    monthsBack = Math.max(1, Math.min(24, parseInt(monthsBack, 10) || 6));

    const [runIns] = await pool.query(
        `INSERT INTO vendor_mapping_scans (months_back, status, triggered_by)
         VALUES (?, 'running', ?)`,
        [monthsBack, triggeredBy]
    );
    const scanId = runIns.insertId;

    try {
        const fromDate = new Date();
        fromDate.setMonth(fromDate.getMonth() - monthsBack);
        const fromStr = fromDate.toISOString().slice(0, 10);

        // Reset auto rows only — preserve any manual overrides
        await pool.query(
            `UPDATE item_vendor_map SET bill_count = 0, total_qty = 0
             WHERE source = 'auto'`
        );

        let page = 1;
        let billsFetched = 0;
        let itemLinesProcessed = 0;
        const perPage = 200;
        const itemTouch = new Set();

        while (true) {
            // Zoho rejects comma-separated status values; date_start alone
            // is enough — we want every bill in the window regardless of
            // payment state for vendor inference. (Matches getBillsByLocation
            // pattern at zoho-api.js:1834.)
            const resp = await zohoAPI.getBills({
                page,
                per_page: perPage,
                date_start: fromStr
            });
            const bills = resp?.bills || [];
            if (bills.length === 0) break;
            billsFetched += bills.length;

            for (const b of bills) {
                // Fetch detail for line_items (list endpoint returns summary only)
                let detail;
                try {
                    detail = await zohoAPI.getBill(b.bill_id);
                } catch (e) {
                    console.warn('[vendor-mapper] failed to fetch bill', b.bill_id, e.message);
                    continue;
                }
                const bill = detail?.bill || detail;
                const contactId = bill?.vendor_id || b.vendor_id;
                const contactName = bill?.vendor_name || b.vendor_name;
                if (!contactId) continue;

                const localVendorId = await ensureLocalVendor(contactId, contactName, bill?.gst_no);
                if (!localVendorId) continue;

                const lineItems = Array.isArray(bill?.line_items) ? bill.line_items : [];
                const billDate = bill?.date || b.date;

                for (const li of lineItems) {
                    const itemId = li.item_id;
                    if (!itemId) continue;
                    const qty = Number(li.quantity) || 0;
                    const rate = Number(li.rate) || 0;

                    await pool.query(
                        `INSERT INTO item_vendor_map
                            (zoho_item_id, vendor_id, bill_count, total_qty,
                             last_bill_date, last_bill_rate, first_bill_date, source)
                         VALUES (?, ?, 1, ?, ?, ?, ?, 'auto')
                         ON DUPLICATE KEY UPDATE
                            bill_count = bill_count + 1,
                            total_qty = total_qty + VALUES(total_qty),
                            last_bill_date = IF(VALUES(last_bill_date) >= last_bill_date OR last_bill_date IS NULL,
                                                VALUES(last_bill_date), last_bill_date),
                            last_bill_rate = IF(VALUES(last_bill_date) >= last_bill_date OR last_bill_date IS NULL,
                                                VALUES(last_bill_rate), last_bill_rate),
                            first_bill_date = IF(first_bill_date IS NULL OR VALUES(first_bill_date) < first_bill_date,
                                                 VALUES(first_bill_date), first_bill_date),
                            source = IF(source = 'manual', source, 'auto')`,
                        [String(itemId), localVendorId, qty, billDate, rate, billDate]
                    );
                    itemTouch.add(String(itemId));
                    itemLinesProcessed++;
                }
            }

            if (bills.length < perPage) break;
            page++;
            if (page > 50) {
                console.warn('[vendor-mapper] pagination cap (50 pages) reached');
                break;
            }
        }

        // Drop stale auto rows with 0 bills (item no longer purchased from that vendor)
        await pool.query(
            `DELETE FROM item_vendor_map WHERE source = 'auto' AND bill_count = 0`
        );

        await pool.query(
            `UPDATE vendor_mapping_scans
             SET status = 'completed', completed_at = NOW(),
                 bills_fetched = ?, items_mapped = ?
             WHERE id = ?`,
            [billsFetched, itemTouch.size, scanId]
        );

        return { scanId, billsFetched, itemsMapped: itemTouch.size, itemLinesProcessed };
    } catch (e) {
        await pool.query(
            `UPDATE vendor_mapping_scans
             SET status = 'failed', completed_at = NOW(), error_message = ?
             WHERE id = ?`,
            [e.message, scanId]
        );
        throw e;
    }
}

/**
 * For every item in item_vendor_map, flip is_primary = 1 on the highest
 * bill_count row (tiebreak = most recent bill), and mirror onto
 * zoho_items_map.preferred_vendor_id + last_purchase_rate.
 *
 * Rows with source = 'manual' are NEVER demoted — user overrides win.
 */
async function inferPrimaries() {
    if (!pool) throw new Error('pool not set');

    // Reset auto primary flags (manual preserved)
    await pool.query(
        `UPDATE item_vendor_map SET is_primary = 0 WHERE source = 'auto'`
    );

    // Items that already have a manual primary — skip
    const [manualPrimaries] = await pool.query(
        `SELECT zoho_item_id FROM item_vendor_map
         WHERE is_primary = 1 AND source = 'manual'`
    );
    const manualSet = new Set(manualPrimaries.map(r => r.zoho_item_id));

    // Pick top vendor per item for the rest
    const [candidates] = await pool.query(`
        SELECT ivm.zoho_item_id, ivm.vendor_id, ivm.last_bill_rate, ivm.bill_count
        FROM item_vendor_map ivm
        JOIN (
            SELECT zoho_item_id, MAX(bill_count) AS max_count
            FROM item_vendor_map
            GROUP BY zoho_item_id
        ) m ON m.zoho_item_id = ivm.zoho_item_id AND m.max_count = ivm.bill_count
        ORDER BY ivm.zoho_item_id, ivm.last_bill_date DESC
    `);

    // Deduplicate: first row per item (ordered by most-recent bill date)
    const picked = new Map();
    for (const c of candidates) {
        if (manualSet.has(c.zoho_item_id)) continue;
        if (!picked.has(c.zoho_item_id)) picked.set(c.zoho_item_id, c);
    }

    let mirrored = 0;
    for (const [itemId, c] of picked.entries()) {
        await pool.query(
            `UPDATE item_vendor_map SET is_primary = 1
             WHERE zoho_item_id = ? AND vendor_id = ? AND source = 'auto'`,
            [itemId, c.vendor_id]
        );
        await pool.query(
            `UPDATE zoho_items_map
             SET preferred_vendor_id = ?, last_purchase_rate = ?
             WHERE zoho_item_id = ?`,
            [c.vendor_id, c.last_bill_rate || null, itemId]
        );
        mirrored++;
    }

    // Also mirror manual primaries onto zoho_items_map (in case they were set directly)
    const [manualRows] = await pool.query(
        `SELECT zoho_item_id, vendor_id, last_bill_rate FROM item_vendor_map
         WHERE is_primary = 1 AND source = 'manual'`
    );
    for (const r of manualRows) {
        await pool.query(
            `UPDATE zoho_items_map
             SET preferred_vendor_id = ?, last_purchase_rate = COALESCE(?, last_purchase_rate)
             WHERE zoho_item_id = ?`,
            [r.vendor_id, r.last_bill_rate, r.zoho_item_id]
        );
    }

    return { itemsPrimaried: mirrored, manualHonoured: manualRows.length };
}

/**
 * Push the preferred vendor to Zoho for one item.
 * Sends { vendor_id, vendor_name } so Zoho's item master stamps the preferred vendor.
 */
async function pushPreferredVendorToZoho(zohoItemId) {
    if (!pool) throw new Error('pool not set');
    const [rows] = await pool.query(`
        SELECT v.zoho_contact_id, v.vendor_name, zim.preferred_vendor_id
        FROM zoho_items_map zim
        LEFT JOIN vendors v ON v.id = zim.preferred_vendor_id
        WHERE zim.zoho_item_id = ?
        LIMIT 1
    `, [zohoItemId]);
    if (!rows.length) throw new Error('Item not found');
    const r = rows[0];
    if (!r.preferred_vendor_id) throw new Error('No preferred vendor mapped for this item');
    if (!r.zoho_contact_id) throw new Error('Vendor has no zoho_contact_id — sync vendors to Zoho first');

    await zohoAPI.updateItem(zohoItemId, {
        vendor_id: String(r.zoho_contact_id),
        vendor_name: r.vendor_name || undefined
    });

    await pool.query(
        `UPDATE zoho_items_map SET vendor_pushed_at = NOW() WHERE zoho_item_id = ?`,
        [zohoItemId]
    );
    await pool.query(
        `UPDATE item_vendor_map SET pushed_to_zoho = 1, pushed_at = NOW()
         WHERE zoho_item_id = ? AND vendor_id = ? AND is_primary = 1`,
        [zohoItemId, r.preferred_vendor_id]
    );

    return { zoho_item_id: zohoItemId, zoho_vendor_id: r.zoho_contact_id };
}

async function pushAll({ onlyUnpushed = true } = {}) {
    const where = onlyUnpushed ? 'AND (zim.vendor_pushed_at IS NULL OR zim.vendor_pushed_at < ivm.updated_at)' : '';
    const [items] = await pool.query(`
        SELECT DISTINCT zim.zoho_item_id
        FROM zoho_items_map zim
        JOIN item_vendor_map ivm ON ivm.zoho_item_id = zim.zoho_item_id AND ivm.is_primary = 1
        WHERE zim.preferred_vendor_id IS NOT NULL
          ${where}
    `);

    let pushed = 0;
    const errors = [];
    for (const it of items) {
        try {
            await pushPreferredVendorToZoho(it.zoho_item_id);
            pushed++;
        } catch (e) {
            errors.push({ zoho_item_id: it.zoho_item_id, error: e.message });
        }
    }
    return { total: items.length, pushed, errors };
}

/**
 * Manual override: flag a specific (item, vendor) pair as the primary mapping.
 */
async function setManualPrimary(zohoItemId, vendorId) {
    if (!pool) throw new Error('pool not set');
    const [vRows] = await pool.query(`SELECT id FROM vendors WHERE id = ?`, [vendorId]);
    if (!vRows.length) throw new Error('Vendor not found');

    await pool.query(
        `UPDATE item_vendor_map SET is_primary = 0 WHERE zoho_item_id = ?`,
        [zohoItemId]
    );
    await pool.query(
        `INSERT INTO item_vendor_map (zoho_item_id, vendor_id, is_primary, source, bill_count)
         VALUES (?, ?, 1, 'manual', 0)
         ON DUPLICATE KEY UPDATE is_primary = 1, source = 'manual'`,
        [zohoItemId, vendorId]
    );
    await pool.query(
        `UPDATE zoho_items_map SET preferred_vendor_id = ? WHERE zoho_item_id = ?`,
        [vendorId, zohoItemId]
    );
    return { zoho_item_id: zohoItemId, vendor_id: vendorId };
}

module.exports = {
    setPool,
    scanFromZohoBills,
    inferPrimaries,
    pushPreferredVendorToZoho,
    pushAll,
    setManualPrimary
};
