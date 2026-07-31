/**
 * ONE-TIME: Asian Paints vendor-item consolidation (46 stock-holding items).
 *
 * Asian Paints pushes items straight into the owner's Zoho Books org. Those
 * vendor-owned items are category-locked — the owner cannot fix their category.
 * For the 46 that still hold stock we:
 *
 *   1. create a new, owner-editable item (same name, sku = "<old_sku>-OWN",
 *      brand ASIAN PAINTS, the approved category_name, rate/purchase_rate/
 *      description/hsn copied from the old item),
 *   2. mirror it into zoho_items_map (same INSERT shape as
 *      routes/zoho/items.js POST /items),
 *   3. move the stock across per location with the PROVEN paired-adjustment
 *      pattern from routes/stock-migration.js:112-148 — increase the NEW item,
 *      decrease the OLD item, both at the SAME location_id,
 *   4. only then markItemInactive() the old vendor item and set the local
 *      mirror's zoho_status='inactive',
 *   5. record the outcome in zoho_item_consolidation_log (audit + resume).
 *
 * Safety:
 *   - DRY-RUN IS THE DEFAULT. Nothing is read-modified and no Zoho call is made
 *     unless --apply is passed explicitly.
 *   - Never deactivate before the stock adjustments have returned OK.
 *   - Resumable: rows already status='completed' are skipped. An item whose log
 *     row already carries a new_item_id but is NOT completed is NEVER retried
 *     automatically (retrying would create a duplicate Zoho item and/or
 *     double-adjust stock) — it is flagged for manual review instead.
 *   - One item's failure never aborts the batch.
 *
 * Usage:
 *   node scripts/consolidate-asian-items.js                       # dry-run (default)
 *   node scripts/consolidate-asian-items.js --dry-run             # same
 *   node scripts/consolidate-asian-items.js --only=2032688000000687828 --apply
 *   node scripts/consolidate-asian-items.js --limit=10 --apply
 *   node scripts/consolidate-asian-items.js --apply               # all 46
 *
 * NOTE: --apply writes to live Zoho Books and real inventory. Run the dry-run
 * first, then the 1-item pilot, then batches of 10 (see the approved plan).
 */

const BRAND = 'ASIAN PAINTS';
const SKU_SUFFIX = '-OWN';

/**
 * The 46 stock-holding vendor items to consolidate.
 * category_assigned values come from the owner-accepted category table and
 * reuse the EXISTING taxonomy already present in zoho_items_map.
 */
const ITEMS = [
    { old_item_id: '2032688000000687828', old_sku: '00519288237', category_assigned: 'EXTERIOR EMULSION' },
    { old_item_id: '2032688000000667099', old_sku: '00519607214', category_assigned: 'EXTERIOR EMULSION' },
    { old_item_id: '2032688000000667151', old_sku: '00519608210', category_assigned: 'EXTERIOR EMULSION' },
    { old_item_id: '2032688000000667320', old_sku: '00519602243', category_assigned: 'EXTERIOR EMULSION' },
    { old_item_id: '2032688000000667307', old_sku: '00519602214', category_assigned: 'EXTERIOR EMULSION' },
    { old_item_id: '2032688000000677290', old_sku: '5759B164329', category_assigned: 'EXTERIOR EMULSION' },
    { old_item_id: '2032688000000677264', old_sku: '5759B164243', category_assigned: 'EXTERIOR EMULSION' },
    { old_item_id: '2032688000000677251', old_sku: '5759B164214', category_assigned: 'EXTERIOR EMULSION' },
    { old_item_id: '2032688000000675013', old_sku: '5759B138210', category_assigned: 'EXTERIOR EMULSION' },
    { old_item_id: '2032688000000713924', old_sku: '00010N45210', category_assigned: 'ENAMEL' },
    { old_item_id: '2032688000000681972', old_sku: '00010514210', category_assigned: 'ENAMEL' },
    { old_item_id: '2032688000000681218', old_sku: '00010324210', category_assigned: 'ENAMEL' },
    { old_item_id: '2032688000000664202', old_sku: '00129188313', category_assigned: 'EXTERIOR EMULSION' },
    { old_item_id: '2032688000000664176', old_sku: '00129188214', category_assigned: 'EXTERIOR EMULSION' },
    { old_item_id: '2032688000000664241', old_sku: '00129189214', category_assigned: 'EXTERIOR EMULSION' },
    { old_item_id: '2032688000000730787', old_sku: '00129220329', category_assigned: 'EXTERIOR EMULSION' },
    { old_item_id: '2032688000000664384', old_sku: '00129220243', category_assigned: 'EXTERIOR EMULSION' },
    { old_item_id: '2032688000000683454', old_sku: '00129220313', category_assigned: 'EXTERIOR EMULSION' },
    { old_item_id: '2032688000000664618', old_sku: '00129097210', category_assigned: 'EXTERIOR EMULSION' },
    { old_item_id: '2032688000000664644', old_sku: '00129097310', category_assigned: 'EXTERIOR EMULSION' },
    { old_item_id: '2032688000000664631', old_sku: '00129097240', category_assigned: 'EXTERIOR EMULSION' },
    { old_item_id: '2032688000000664852', old_sku: '0012W106310', category_assigned: 'EXTERIOR EMULSION' },
    { old_item_id: '2032688000000683376', old_sku: '00120959320', category_assigned: 'EXTERIOR EMULSION' },
    { old_item_id: '2032688000000669807', old_sku: '00689224243', category_assigned: 'EXTERIOR EMULSION' },
    { old_item_id: '2032688000000669820', old_sku: '00689224313', category_assigned: 'EXTERIOR EMULSION' },
    { old_item_id: '2032688000000669794', old_sku: '00689224214', category_assigned: 'EXTERIOR EMULSION' },
    { old_item_id: '2032688000000669023', old_sku: '00119185241', category_assigned: 'PREMIUM EMULSION BW1' },
    { old_item_id: '2032688000000675845', old_sku: '0011B155329', category_assigned: 'PREMIUM EMULSION BW1' },
    { old_item_id: '2032688000000673124', old_sku: '00579231236', category_assigned: 'INTERIOR EMULSION' },
    { old_item_id: '2032688000000673111', old_sku: '00579231212', category_assigned: 'INTERIOR EMULSION' },
    { old_item_id: '2032688000000729121', old_sku: '17900000210', category_assigned: 'WOOD POLISH - SEALER, GLOSSY, MAT' },
    { old_item_id: '2032688000000729030', old_sku: '17880000210', category_assigned: 'WOOD POLISH - SEALER, GLOSSY, MAT' },
    { old_item_id: '2032688000000679385', old_sku: '21040000210', category_assigned: 'WOOD POLISH - SEALER, GLOSSY, MAT' },
    { old_item_id: '2032688000000674673', old_sku: '0068B134243', category_assigned: 'EXTERIOR EMULSION' },
    { old_item_id: '2032688000000674530', old_sku: '0068B132210', category_assigned: 'EXTERIOR EMULSION' },
    { old_item_id: '2032688000000686632', old_sku: '00500121210', category_assigned: 'ENAMEL' },
    { old_item_id: '2032688000000674229', old_sku: '0038RW21242', category_assigned: 'ENAMEL' },
    { old_item_id: '2032688000000674333', old_sku: '0038B128241', category_assigned: 'ENAMEL' },
    { old_item_id: '2032688000000668789', old_sku: '00249644210', category_assigned: 'EXTERIOR EMULSION' },
    { old_item_id: '2032688000000675897', old_sku: '0057B154242', category_assigned: 'INTERIOR EMULSION' },
    { old_item_id: '2032688000000675884', old_sku: '0057B154213', category_assigned: 'INTERIOR EMULSION' },
    { old_item_id: '2032688000000672500', old_sku: '00299668310', category_assigned: 'INTERIOR EMULSION' },
    { old_item_id: '2032688000000672487', old_sku: '00299668240', category_assigned: 'INTERIOR EMULSION' },
    { old_item_id: '2032688000000703873', old_sku: '56770908210', category_assigned: 'CONSTRUCTION CHEMICALS' },
    { old_item_id: '2032688000000675117', old_sku: '00463510212', category_assigned: 'INTERIOR EMULSION' },
    { old_item_id: '2032688000000673956', old_sku: '10909612214', category_assigned: 'EXTERIOR EMULSION' }
];

// ── pure helpers (unit-tested) ───────────────────────────────────────────────

/** UTC calendar date, same form routes/stock-migration.js uses for adjustments. */
function today() {
    return new Date().toISOString().split('T')[0];
}

function newSkuFor(oldSku) {
    return `${oldSku}${SKU_SUFFIX}`;
}

/**
 * Build the Zoho createItem payload for the replacement item.
 * Same field shape as the proven POST /api/zoho/items route (item_type
 * 'inventory', only non-empty keys sent). Name is NOT changed in this pass.
 */
function buildNewItemPayload(oldItem, entry) {
    const payload = { item_type: 'inventory' };
    payload.name = (oldItem.zoho_item_name || '').trim();
    payload.sku = newSkuFor(entry.old_sku);
    payload.brand = BRAND;
    payload.category_name = entry.category_assigned;

    if (oldItem.zoho_rate !== null && oldItem.zoho_rate !== undefined) {
        payload.rate = parseFloat(oldItem.zoho_rate) || 0;
    }
    if (oldItem.zoho_purchase_rate) payload.purchase_rate = parseFloat(oldItem.zoho_purchase_rate) || 0;
    if (oldItem.zoho_unit)          payload.unit          = oldItem.zoho_unit;
    if (oldItem.zoho_description)   payload.description   = oldItem.zoho_description;
    if (oldItem.zoho_hsn_or_sac)    payload.hsn_or_sac    = oldItem.zoho_hsn_or_sac;
    if (oldItem.zoho_tax_percentage) payload.tax_percentage = parseFloat(oldItem.zoho_tax_percentage) || 0;

    return payload;
}

/**
 * Paired quantity adjustments for ONE location — the exact shape proven in
 * routes/stock-migration.js:112-148, except the two calls differ by item_id
 * (new vs old) instead of by location_id: both sides act on the SAME location.
 */
function buildAdjustmentPair({ newItemId, oldItemId, locationId, quantity, oldSku, date }) {
    const qty = Math.abs(parseFloat(quantity));
    const when = date || today();
    const label = String(oldSku || '').substring(0, 30);
    const description = `Asian Paints vendor-item consolidation ${oldItemId} -> ${newItemId}`;

    return {
        increase: {
            date: when,
            reason: `Consolidation IN: ${label}`.substring(0, 50),
            description,
            adjustment_type: 'quantity',
            location_id: locationId,
            line_items: [{ item_id: newItemId, location_id: locationId, quantity_adjusted: qty }]
        },
        decrease: {
            date: when,
            reason: `Consolidation OUT: ${label}`.substring(0, 50),
            description,
            adjustment_type: 'quantity',
            location_id: locationId,
            line_items: [{ item_id: oldItemId, location_id: locationId, quantity_adjusted: -qty }]
        }
    };
}

/** Parse argv into options. Dry-run is the default; --apply must be explicit. */
function parseArgs(argv) {
    const apply = argv.includes('--apply');
    let limit = null;
    let only = null;
    for (const arg of argv) {
        const m = /^--limit=(\d+)$/.exec(arg);
        if (m) limit = parseInt(m[1], 10);
        const o = /^--only=(.+)$/.exec(arg);
        if (o) only = o[1].split(',').map(s => s.trim()).filter(Boolean);
    }
    return { apply, dryRun: !apply, limit, only };
}

function selectItems(items, { only, limit }) {
    let list = items;
    if (only && only.length) list = list.filter(i => only.includes(i.old_item_id));
    if (limit) list = list.slice(0, limit);
    return list;
}

// ── db helpers ───────────────────────────────────────────────────────────────

async function getOldItem(pool, oldItemId) {
    const [rows] = await pool.query(
        `SELECT zoho_item_id, zoho_item_name, zoho_sku, zoho_rate, zoho_purchase_rate,
                zoho_label_rate, zoho_unit, zoho_description, zoho_hsn_or_sac,
                zoho_tax_percentage, zoho_brand, zoho_category_name, zoho_manufacturer,
                zoho_reorder_level, zoho_cf_dpl, zoho_status
           FROM zoho_items_map
          WHERE zoho_item_id = ?
          LIMIT 1`,
        [oldItemId]
    );
    return rows[0] || null;
}

/** Per-location stock for the old item, from the locally synced mirror. */
async function getLocationStock(pool, oldItemId) {
    const [rows] = await pool.query(
        `SELECT zoho_location_id, stock_on_hand
           FROM zoho_location_stock
          WHERE zoho_item_id = ? AND stock_on_hand > 0
          ORDER BY zoho_location_id`,
        [oldItemId]
    );
    return rows.map(r => ({
        location_id: r.zoho_location_id,
        quantity: parseFloat(r.stock_on_hand)
    }));
}

async function getLogRow(pool, oldItemId) {
    const [rows] = await pool.query(
        `SELECT old_item_id, new_item_id, status FROM zoho_item_consolidation_log
          WHERE old_item_id = ? LIMIT 1`,
        [oldItemId]
    );
    return rows[0] || null;
}

async function upsertLog(pool, row) {
    await pool.query(
        `INSERT INTO zoho_item_consolidation_log
             (old_item_id, new_item_id, old_sku, new_sku, category_assigned,
              stock_migrated_json, status, error_message, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
             new_item_id         = VALUES(new_item_id),
             old_sku             = VALUES(old_sku),
             new_sku             = VALUES(new_sku),
             category_assigned   = VALUES(category_assigned),
             stock_migrated_json = VALUES(stock_migrated_json),
             status              = VALUES(status),
             error_message       = VALUES(error_message),
             completed_at        = VALUES(completed_at)`,
        [
            row.old_item_id,
            row.new_item_id || null,
            row.old_sku || null,
            row.new_sku || null,
            row.category_assigned || null,
            row.stock_migrated_json ? JSON.stringify(row.stock_migrated_json) : null,
            row.status,
            row.error_message || null,
            row.status === 'completed' ? new Date() : null
        ]
    );
}

/** Local mirror INSERT — same column list/shape as routes/zoho/items.js:1026-1050. */
async function mirrorNewItem(pool, newItemId, payload, oldItem) {
    await pool.query(`
        INSERT INTO zoho_items_map
            (zoho_item_id, zoho_item_name, zoho_sku, zoho_rate, zoho_purchase_rate,
             zoho_label_rate, zoho_unit, zoho_description, zoho_hsn_or_sac,
             zoho_tax_percentage, zoho_brand, zoho_category_name, zoho_manufacturer,
             zoho_reorder_level, zoho_stock_on_hand, zoho_cf_dpl, zoho_status, last_synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NOW())
    `, [
        newItemId,
        payload.name,
        payload.sku,
        parseFloat(payload.rate) || 0,
        parseFloat(payload.purchase_rate) || 0,
        parseFloat(oldItem.zoho_label_rate) || 0,
        payload.unit || null,
        payload.description || null,
        payload.hsn_or_sac || null,
        parseFloat(payload.tax_percentage) || 0,
        BRAND,
        payload.category_name || null,
        oldItem.zoho_manufacturer || null,
        parseInt(oldItem.zoho_reorder_level) || 0,
        parseFloat(oldItem.zoho_cf_dpl) || 0,
        'active'
    ]);
}

// ── per-item worker ──────────────────────────────────────────────────────────

/**
 * Consolidate ONE item.
 * @returns {Promise<{old_item_id, status, reason?, new_item_id?, plan?, error?}>}
 *          status: 'skipped' | 'planned' | 'completed' | 'failed' | 'needs_review'
 */
async function consolidateItem({ pool, zohoAPI, entry, apply, log = console }) {
    const tag = `[${entry.old_item_id} ${entry.old_sku}]`;

    // (1) resumability — never redo a completed item, never auto-retry a
    //     half-done one (a retry would duplicate the Zoho item / stock).
    const existing = await getLogRow(pool, entry.old_item_id);
    if (existing && existing.status === 'completed') {
        log.log(`${tag} SKIP — already completed (new_item_id=${existing.new_item_id})`);
        return { old_item_id: entry.old_item_id, status: 'skipped', reason: 'already completed' };
    }
    if (existing && existing.new_item_id) {
        log.warn(`${tag} NEEDS MANUAL REVIEW — log row has new_item_id=${existing.new_item_id} but status=${existing.status}. Not retried automatically.`);
        return { old_item_id: entry.old_item_id, status: 'needs_review', reason: 'partial run detected', new_item_id: existing.new_item_id };
    }

    const oldItem = await getOldItem(pool, entry.old_item_id);
    if (!oldItem) {
        const msg = 'old item not found in zoho_items_map';
        log.error(`${tag} FAIL — ${msg}`);
        if (apply) {
            await upsertLog(pool, {
                old_item_id: entry.old_item_id, old_sku: entry.old_sku,
                new_sku: newSkuFor(entry.old_sku), category_assigned: entry.category_assigned,
                status: 'failed', error_message: msg
            });
        }
        return { old_item_id: entry.old_item_id, status: 'failed', error: msg };
    }

    const payload = buildNewItemPayload(oldItem, entry);
    const locations = await getLocationStock(pool, entry.old_item_id);
    const totalQty = locations.reduce((s, l) => s + l.quantity, 0);

    // (2) dry-run: print the plan only. No Zoho calls, no DB writes at all.
    if (!apply) {
        log.log(`${tag} PLAN "${oldItem.zoho_item_name}"`);
        log.log(`${tag}   new item payload: ${JSON.stringify(payload)}`);
        log.log(`${tag}   category: ${oldItem.zoho_category_name || '(none)'} -> ${entry.category_assigned}`);
        if (locations.length === 0) {
            log.log(`${tag}   stock: NONE in zoho_location_stock — no adjustments would be made`);
        } else {
            for (const loc of locations) {
                log.log(`${tag}   stock: location ${loc.location_id} qty ${loc.quantity} — +${loc.quantity} on NEW, -${loc.quantity} on OLD`);
            }
            log.log(`${tag}   total qty to move: ${totalQty} across ${locations.length} location(s)`);
        }
        log.log(`${tag}   then: markItemInactive(${entry.old_item_id})`);
        return {
            old_item_id: entry.old_item_id,
            status: 'planned',
            plan: { payload, locations, total_quantity: totalQty }
        };
    }

    // (3) apply
    const migrated = [];
    let newItemId = null;
    try {
        log.log(`${tag} creating replacement item "${payload.name}" sku=${payload.sku} category=${payload.category_name}`);
        const resp = await zohoAPI.createItem(payload);
        newItemId = resp && resp.item ? resp.item.item_id : null;
        if (!newItemId) {
            throw new Error(`Zoho did not return item_id: ${JSON.stringify(resp)}`);
        }
        log.log(`${tag} created new_item_id=${newItemId}`);

        await mirrorNewItem(pool, newItemId, payload, oldItem);
        log.log(`${tag} mirrored into zoho_items_map`);

        const date = today();
        for (const loc of locations) {
            const { increase, decrease } = buildAdjustmentPair({
                newItemId,
                oldItemId: entry.old_item_id,
                locationId: loc.location_id,
                quantity: loc.quantity,
                oldSku: entry.old_sku,
                date
            });

            log.log(`${tag} location ${loc.location_id}: +${loc.quantity} on NEW ${newItemId}`);
            const inRes = await zohoAPI.createInventoryAdjustment(increase);
            const inId = inRes?.inventory_adjustment?.inventory_adjustment_id || 'unknown';

            log.log(`${tag} location ${loc.location_id}: -${loc.quantity} on OLD ${entry.old_item_id}`);
            const outRes = await zohoAPI.createInventoryAdjustment(decrease);
            const outId = outRes?.inventory_adjustment?.inventory_adjustment_id || 'unknown';

            migrated.push({
                location_id: loc.location_id,
                quantity: loc.quantity,
                increase_adjustment_id: inId,
                decrease_adjustment_id: outId
            });
            log.log(`${tag} location ${loc.location_id}: adjustments ok (in=${inId}, out=${outId})`);
        }

        // Stock confirmed moved (Zoho accepted both adjustments) — only NOW deactivate.
        // zoho_location_stock is NOT re-checked here: it only refreshes on the next
        // sync, so it would still show the pre-adjustment quantity.
        await zohoAPI.markItemInactive(entry.old_item_id);
        log.log(`${tag} old item marked inactive in Zoho`);

        await pool.query(
            `UPDATE zoho_items_map SET zoho_status = 'inactive' WHERE zoho_item_id = ?`,
            [entry.old_item_id]
        );

        await upsertLog(pool, {
            old_item_id: entry.old_item_id,
            new_item_id: newItemId,
            old_sku: entry.old_sku,
            new_sku: payload.sku,
            category_assigned: entry.category_assigned,
            stock_migrated_json: migrated,
            status: 'completed'
        });
        log.log(`${tag} DONE — ${migrated.length} location(s), ${totalQty} units moved`);

        return { old_item_id: entry.old_item_id, status: 'completed', new_item_id: newItemId, migrated };
    } catch (err) {
        log.error(`${tag} FAILED — ${err.message}`);
        try {
            await upsertLog(pool, {
                old_item_id: entry.old_item_id,
                new_item_id: newItemId,
                old_sku: entry.old_sku,
                new_sku: payload.sku,
                category_assigned: entry.category_assigned,
                stock_migrated_json: migrated.length ? migrated : null,
                status: 'failed',
                error_message: String(err.message).substring(0, 1000)
            });
        } catch (logErr) {
            log.error(`${tag} could not write failure log: ${logErr.message}`);
        }
        return { old_item_id: entry.old_item_id, status: 'failed', new_item_id: newItemId, error: err.message };
    }
}

// ── runner ───────────────────────────────────────────────────────────────────

async function run({ pool, zohoAPI, apply = false, items = ITEMS, log = console }) {
    log.log(`\n=== Asian Paints vendor-item consolidation — ${apply ? 'APPLY (writes to Zoho)' : 'DRY-RUN (no writes)'} ===`);
    log.log(`Items in this run: ${items.length}\n`);

    const results = [];
    for (let i = 0; i < items.length; i++) {
        const entry = items[i];
        log.log(`--- (${i + 1}/${items.length}) ${entry.old_sku} -> ${entry.category_assigned}`);
        // A single item's failure must never abort the batch.
        const res = await consolidateItem({ pool, zohoAPI, entry, apply, log });
        results.push(res);
    }

    const count = s => results.filter(r => r.status === s).length;
    log.log(`\n=== Summary (${apply ? 'APPLY' : 'DRY-RUN'}) ===`);
    log.log(`  planned:      ${count('planned')}`);
    log.log(`  completed:    ${count('completed')}`);
    log.log(`  skipped:      ${count('skipped')}`);
    log.log(`  needs_review: ${count('needs_review')}`);
    log.log(`  failed:       ${count('failed')}`);
    for (const r of results.filter(r => r.status === 'failed')) {
        log.log(`    FAILED ${r.old_item_id}: ${r.error}`);
    }
    if (!apply) log.log('\nDry-run only — nothing was written. Re-run with --apply to execute.');

    return results;
}

module.exports = {
    ITEMS,
    BRAND,
    SKU_SUFFIX,
    newSkuFor,
    buildNewItemPayload,
    buildAdjustmentPair,
    parseArgs,
    selectItems,
    consolidateItem,
    run
};

if (require.main === module) {
    (async () => {
        require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
        const opts = parseArgs(process.argv.slice(2));
        const { createPool } = require('../config/database');
        const zohoAPI = require('../services/zoho-api');
        const pool = createPool();
        zohoAPI.setPool(pool);

        const items = selectItems(ITEMS, opts);
        if (items.length === 0) {
            console.error('No items selected — check --only/--limit.');
            await pool.end();
            process.exit(1);
        }

        let failures = 0;
        try {
            const results = await run({ pool, zohoAPI, apply: opts.apply, items });
            failures = results.filter(r => r.status === 'failed').length;
        } catch (err) {
            console.error('Consolidation run error:', err.message);
            failures = 1;
        } finally {
            await pool.end();
        }
        process.exit(failures > 0 ? 1 : 0);
    })();
}
