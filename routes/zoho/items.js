/**
 * ZOHO ROUTES — DPL CATALOG / STOCK / INVENTORY ADJUSTMENTS /
 * ITEMS & BULK UPDATES / PRICE LIST (DPL) PARSING & NAMING
 * Split from routes/zoho.js (A8b) — handlers moved verbatim, original
 * relative order preserved.
 */

const express = require('express');
const router = express.Router();
const { requirePermission, requireAuth } = require('../../middleware/permissionMiddleware');

// Services (initialized via setPool in ./shared)
const zohoAPI = require('../../services/zoho-api');
const aiEngine = require('../../services/ai-engine');
const brandDplService = require('../../services/brand-dpl-service');
const dplCatalogService = require('../../services/dpl-catalog');

const {
    BRAND_DISPLAY_NAMES,
    assertSupportedBrand,
    catalogZohoScopeSql,
    isSyncDebounced,
    getCached,
    setCache,
    clearCache
} = require('./shared');

let pool;
function setPool(dbPool) { pool = dbPool; }

// Maps DPL paste-mode category strings (e.g. "Interior Luxury") to canonical
// category names that matchWithZohoItems / propose-naming expect.
// Shared by /items/brand-dpl/:brand POST + /items/brand-dpl/:brand/match.
const PASTE_CAT_TO_CANON = {
    'INTERIOR LUXURY':       'INTERIOR EMULSION',
    'INTERIOR PREMIUM':      'INTERIOR EMULSION',
    'INTERIOR ECONOMY':      'INTERIOR EMULSION',
    'EXTERIOR LUXURY':       'EXTERIOR EMULSION',
    'EXTERIOR PREMIUM':      'EXTERIOR EMULSION',
    'EXTERIOR ECONOMY':      'EXTERIOR EMULSION',
    'WATERPROOFING':         'WATERPROOFING',
    'ENAMEL LUXURY':         'ENAMEL',
    'ENAMEL PREMIUM':        'ENAMEL',
    'ENAMEL ECONOMY':        'ENAMEL',
    'WOOD FINISHES LUXURY':  'WOOD FINISH',
    'WOOD FINISHES PREMIUM': 'WOOD FINISH',
    'WOOD FINISHES ECONOMY': 'WOOD FINISH',
    'WOOD FINISHES OTHER':   'WOOD FINISH',
    'PAINTING TOOLS':        '',
    'THINNERS':              '',
    'COLORANTS':             'COLORANT',
    'STAINERS':              'COLORANT',
};

// Category names as they appear in the Birla Opus CSV SKU Report (column 1).
// Maps the raw CSV category header to the canonical category string expected by
// matchWithZohoItems / propose-naming. Empty string = skip / no canonical.
const CSV_CAT_TO_CANON = {
    'INTERIOR':       'INTERIOR EMULSION',
    'EXTERIOR':       'EXTERIOR EMULSION',
    'ENAMEL':         'ENAMEL',
    'WOOD FINISHES':  'WOOD FINISH',
    'COLORANTS':      'COLORANT',
    'PAINTING TOOLS': '',
};

// ========================================
// DPL CATALOG (deterministic item-master mediator) — build / read / confirm-link
// ========================================

// Build (or rebuild) the brand catalog from its saved DPL + the active Zoho items.
router.post('/items/dpl-catalog/:brand/build', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = String(req.params.brand || '').toLowerCase();
        if (!assertSupportedBrand(brand, res)) return;

        const parsedRows = await brandDplService.getForMatch(brand);
        if (!parsedRows || !parsedRows.length) {
            return res.status(404).json({ success: false, message: 'No saved DPL for this brand. Save a DPL first.' });
        }

        const [zohoItems] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name AS name, zoho_sku AS sku, zoho_rate AS rate,
                    zoho_cf_dpl AS cf_dpl, zoho_brand AS brand, zoho_category_name AS category,
                    zoho_description AS description
             FROM zoho_items_map WHERE zoho_status = 'active'${catalogZohoScopeSql(brand)}`
        );

        const existingCatalog = await dplCatalogService.getCatalog(brand);
        const entries = dplCatalogService.buildCatalogFromDpl(brand, parsedRows, zohoItems, existingCatalog);
        const updatedBy = req.user ? (req.user.username || String(req.user.id)) : null;
        await dplCatalogService.upsertEntries(entries, updatedBy);
        const removed = await dplCatalogService.deleteOrphans(brand, entries.map(e => e.match_key));
        await dplCatalogService.unlinkMarked(brand);

        const summary = { total: entries.length, confirmed: 0, review: 0, needs_creating: 0, removed };
        entries.forEach(e => { if (e.link_status in summary) summary[e.link_status] += 1; });

        res.json({ success: true, data: summary });
    } catch (err) {
        console.error('DPL catalog build error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Read the brand catalog, enriched with linked Zoho values (old DPL/rate/name/sku/
// description) + a sku_conflict flag (canonical_sku held by a DIFFERENT active item).
router.get('/items/dpl-catalog/:brand', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = String(req.params.brand || '').toLowerCase();
        if (!assertSupportedBrand(brand, res)) return;
        const entries = await dplCatalogService.getCatalog(brand);

        const linkedIds = [...new Set(entries.filter(e => e.zoho_item_id).map(e => String(e.zoho_item_id)))];
        const zById = new Map();
        if (linkedIds.length) {
            const [zrows] = await pool.query(
                `SELECT zoho_item_id, zoho_item_name, zoho_sku, zoho_cf_dpl, zoho_rate, zoho_description
                 FROM zoho_items_map WHERE zoho_item_id IN (${linkedIds.map(() => '?').join(',')})`,
                linkedIds
            );
            zrows.forEach(z => zById.set(String(z.zoho_item_id), z));
        }

        const skus = [...new Set(entries.filter(e => e.canonical_sku).map(e => String(e.canonical_sku).toUpperCase()))];
        const skuHolders = new Map();
        if (skus.length) {
            const [hrows] = await pool.query(
                `SELECT zoho_item_id, zoho_item_name, UPPER(zoho_sku) AS sku
                 FROM zoho_items_map WHERE zoho_status='active' AND UPPER(zoho_sku) IN (${skus.map(() => '?').join(',')})`,
                skus
            );
            hrows.forEach(h => {
                if (!skuHolders.has(h.sku)) skuHolders.set(h.sku, []);
                skuHolders.get(h.sku).push({ id: String(h.zoho_item_id), name: h.zoho_item_name });
            });
        }

        const decorated = entries.map(e => {
            const z = e.zoho_item_id ? zById.get(String(e.zoho_item_id)) : null;
            let sku_conflict = null;
            if (e.canonical_sku) {
                const holders = skuHolders.get(String(e.canonical_sku).toUpperCase()) || [];
                const other = holders.find(h => h.id !== String(e.zoho_item_id));
                if (other) sku_conflict = other.name;
            }
            const push_changed = !!(e.pushed_at != null &&
                (Number(e.pushed_dpl) !== Number(e.current_dpl) || Number(e.pushed_rate) !== Number(e.current_rate)));
            return Object.assign({}, e, {
                old_dpl: z && z.zoho_cf_dpl != null ? z.zoho_cf_dpl : null,
                old_rate: z && z.zoho_rate != null ? z.zoho_rate : null,
                zoho_name: z ? z.zoho_item_name : null,
                zoho_sku: z ? z.zoho_sku : null,
                zoho_description: z ? z.zoho_description : null,
                sku_conflict,
                push_changed,
            });
        });

        res.json({ success: true, data: decorated });
    } catch (err) {
        console.error('DPL catalog get error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Zoho-first reconciliation: ONE ROW PER ACTIVE ZOHO ITEM for the brand, each
// matched to its DPL price via the existing dpl_catalog link. Read-only — attach
// and push reuse the confirm-link / push endpoints below.
router.get('/items/dpl-catalog/:brand/by-zoho', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = String(req.params.brand || '').toLowerCase();
        if (!assertSupportedBrand(brand, res)) return;

        const [zohoItems] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name, zoho_sku, zoho_cf_dpl, zoho_rate, zoho_category_name, dpl_disposition
               FROM zoho_items_map
              WHERE zoho_status = 'active'${catalogZohoScopeSql(brand)}`
        );

        const entries = await dplCatalogService.getCatalog(brand);

        // Decorate with sku_conflict: another ACTIVE Zoho item already holding this
        // entry's canonical SKU (pushing would collide). Mirrors GET …/:brand.
        const skus = [...new Set(entries.filter(e => e.canonical_sku).map(e => String(e.canonical_sku).toUpperCase()))];
        const skuHolders = new Map();
        if (skus.length) {
            const [hrows] = await pool.query(
                `SELECT zoho_item_id, zoho_item_name, UPPER(zoho_sku) AS sku
                 FROM zoho_items_map WHERE zoho_status='active' AND UPPER(zoho_sku) IN (${skus.map(() => '?').join(',')})`,
                skus
            );
            hrows.forEach(h => {
                if (!skuHolders.has(h.sku)) skuHolders.set(h.sku, []);
                skuHolders.get(h.sku).push({ id: String(h.zoho_item_id), name: h.zoho_item_name });
            });
        }
        for (const e of entries) {
            if (!e.canonical_sku) { e.sku_conflict = null; continue; }
            const holders = skuHolders.get(String(e.canonical_sku).toUpperCase()) || [];
            const other = holders.find(h => h.id !== String(e.zoho_item_id));
            e.sku_conflict = other ? other.name : null;
        }

        const view = dplCatalogService.buildZohoFirstView(zohoItems, entries);

        res.json({ success: true, data: view });
    } catch (err) {
        console.error('DPL catalog by-zoho error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Pin a catalog entry to a specific Zoho item (user-confirmed link).
router.post('/items/dpl-catalog/entry/:id/confirm-link', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: 'Invalid entry id' });
        const zohoItemId = req.body && req.body.zoho_item_id;
        if (!zohoItemId) return res.status(400).json({ success: false, message: 'zoho_item_id required' });
        const updatedBy = req.user ? (req.user.username || String(req.user.id)) : null;
        await dplCatalogService.confirmLink(id, String(zohoItemId), updatedBy);
        res.json({ success: true });
    } catch (err) {
        console.error('DPL catalog confirm-link error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Edit user-correctable canonical fields (name / sku / description) on an entry.
router.put('/items/dpl-catalog/entry/:id', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: 'Invalid entry id' });
        const body = req.body || {};
        const fields = {};
        ['canonical_name', 'canonical_sku', 'canonical_description'].forEach(k => {
            if (body[k] !== undefined) fields[k] = body[k];
        });
        const updatedBy = req.user ? (req.user.username || String(req.user.id)) : null;
        const ok = await dplCatalogService.updateCanonicalFields(id, fields, updatedBy);
        if (!ok) return res.status(400).json({ success: false, message: 'No editable fields provided' });
        res.json({ success: true });
    } catch (err) {
        console.error('DPL catalog edit error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Mark/unmark a catalog entry as "not in Zoho (pending creation)".
router.post('/items/dpl-catalog/entry/:id/not-in-zoho', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: 'Invalid entry id' });
        const value = !!(req.body && req.body.value);
        const updatedBy = req.user ? (req.user.username || String(req.user.id)) : null;
        await dplCatalogService.setNotInZoho(id, value, updatedBy);
        res.json({ success: true });
    } catch (err) {
        console.error('DPL catalog not-in-zoho error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Re-key the latest saved DPL onto the pinned catalog → price diff. Persists the
// new current_dpl/current_rate locally (no Zoho write). Returns three buckets.
router.post('/items/dpl-catalog/:brand/apply-prices', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = String(req.params.brand || '').toLowerCase();
        if (!assertSupportedBrand(brand, res)) return;

        const parsedRows = await brandDplService.getForMatch(brand);
        if (!parsedRows || !parsedRows.length) {
            return res.status(404).json({ success: false, message: 'No saved DPL for this brand. Save a DPL first.' });
        }
        const existing = await dplCatalogService.getCatalog(brand);
        if (!existing.length) {
            return res.status(409).json({ success: false, message: 'Catalog is empty. Build the catalog first.' });
        }

        const diff = dplCatalogService.applyDplPrices(brand, parsedRows, existing);
        const updatedBy = req.user ? (req.user.username || String(req.user.id)) : null;
        await dplCatalogService.updateAppliedPrices(diff.updated, updatedBy);

        res.json({ success: true, data: {
            updated: diff.updated,
            new_needs_linking: diff.newNeedsLinking,
            no_dpl_this_time: diff.noDplThisTime.map(e => ({
                match_key: e.match_key, product_name: e.product_name,
                base_name: e.base_name, size_tier: e.size_tier,
            })),
            summary: { updated: diff.updated.length, new: diff.newNeedsLinking.length, untouched: diff.noDplThisTime.length },
        } });
    } catch (err) {
        console.error('DPL catalog apply-prices error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Push selected confirmed catalog entries to Zoho via the bulk-edit job path.
// Body: { ids: [catalogEntryId, ...] }. Only confirmed entries with a zoho_item_id
// and a current_dpl are pushed; the rest are reported as skipped.
router.post('/items/dpl-catalog/:brand/push', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = String(req.params.brand || '').toLowerCase();
        if (!assertSupportedBrand(brand, res)) return;
        const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(n => parseInt(n, 10)).filter(Number.isFinite) : [];
        if (!ids.length) return res.status(400).json({ success: false, message: 'ids array required' });

        const all = await dplCatalogService.getCatalog(brand);
        const byId = new Map(all.map(e => [e.id, e]));
        const chosen = ids.map(id => byId.get(id)).filter(Boolean);

        const hasDpl = e => e.current_dpl != null && Number(e.current_dpl) > 0;
        const pushable = chosen.filter(e => e.link_status === 'confirmed' && e.zoho_item_id && hasDpl(e));
        const skipped = chosen.filter(e => !(e.link_status === 'confirmed' && e.zoho_item_id && hasDpl(e)))
            .map(e => ({ id: e.id, reason: !e.zoho_item_id ? 'not linked' : e.link_status !== 'confirmed' ? 'not confirmed' : 'no DPL price' }));
        if (!pushable.length) {
            return res.status(400).json({ success: false, message: 'No pushable confirmed entries with a DPL price in the selection.', skipped });
        }

        // Exclude entries whose canonical SKU is held by a DIFFERENT active Zoho item.
        // Zoho rejects duplicate SKUs; skip these with a clear reason (so one bad item
        // does not fail the whole batch). The user edits the SKU and re-pushes.
        const conflictSkus = [...new Set(pushable.filter(e => e.canonical_sku).map(e => String(e.canonical_sku).toUpperCase()))];
        const holderBySku = new Map();
        if (conflictSkus.length) {
            const [hrows] = await pool.query(
                `SELECT zoho_item_id, zoho_item_name, UPPER(zoho_sku) AS sku
                 FROM zoho_items_map WHERE zoho_status='active' AND UPPER(zoho_sku) IN (${conflictSkus.map(() => '?').join(',')})`,
                conflictSkus
            );
            hrows.forEach(h => {
                if (!holderBySku.has(h.sku)) holderBySku.set(h.sku, []);
                holderBySku.get(h.sku).push({ id: String(h.zoho_item_id), name: h.zoho_item_name });
            });
        }
        const conflictFree = [];
        for (const e of pushable) {
            const holders = e.canonical_sku ? (holderBySku.get(String(e.canonical_sku).toUpperCase()) || []) : [];
            const other = holders.find(h => h.id !== String(e.zoho_item_id));
            if (other) {
                skipped.push({ id: e.id, reason: `SKU '${e.canonical_sku}' already used by '${other.name}'` });
                continue;
            }
            // Skip entries already pushed with no price change (redundant Zoho write).
            if (e.pushed_at && Number(e.pushed_dpl) === Number(e.current_dpl) && Number(e.pushed_rate) === Number(e.current_rate)) {
                skipped.push({ id: e.id, reason: `already pushed (job #${e.pushed_job_id}), no price change` });
                continue;
            }
            conflictFree.push(e);
        }
        if (!conflictFree.length) {
            return res.status(400).json({ success: false, message: 'Nothing to push — all selected items have SKU conflicts. Edit the SKUs and retry.', skipped });
        }

        // Current Zoho values for diffing + price-history old values.
        const zids = [...new Set(conflictFree.map(e => String(e.zoho_item_id)))];
        const [zrows] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name AS name, zoho_sku AS sku, zoho_description AS description,
                    zoho_category_name AS category, zoho_cf_dpl AS cf_dpl, zoho_purchase_rate AS purchase_rate,
                    zoho_rate AS rate
             FROM zoho_items_map WHERE zoho_item_id IN (${zids.map(() => '?').join(',')})`,
            zids
        );
        const zById = new Map(zrows.map(z => [String(z.zoho_item_id), z]));

        const items = [];
        for (const e of conflictFree) {
            const zc = zById.get(String(e.zoho_item_id)) || {};
            const changes = dplCatalogService.buildPushChanges(e, zc);
            if (!changes) continue;
            items.push({ zoho_item_id: e.zoho_item_id, item_name: zc.name || e.canonical_name || '', changes, _entry: e, _zc: zc });
        }
        if (!items.length) return res.status(400).json({ success: false, message: 'Nothing to push after diffing.', skipped });

        const jobItems = items.map(({ _entry, _zc, ...keep }) => keep);
        const result = await createBulkEditJob(jobItems, req.user);

        // Stamp push state on the pushed entries (best-effort; never fail the push).
        try {
            await dplCatalogService.markPushed(
                items.map(it => ({ id: it._entry.id, dpl: it._entry.current_dpl, rate: it._entry.current_rate })),
                result.job_id
            );
        } catch (stampErr) {
            console.error('DPL catalog push: markPushed failed (non-fatal):', stampErr.message);
        }

        // Log price history (best-effort). The column is `dpl_version_id`.
        for (const it of items) {
            try {
                await pool.query(
                    `INSERT INTO dpl_price_history (zoho_item_id, dpl_version_id, old_dpl, new_dpl, old_purchase_rate, new_purchase_rate, old_sales_rate, new_sales_rate, changed_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        it.zoho_item_id, null,
                        it._zc.cf_dpl || 0, it.changes.cf_dpl,
                        it._zc.purchase_rate || 0, it.changes.purchase_rate,
                        it._zc.rate || 0, it.changes.rate,
                        req.user ? req.user.id : null,
                    ]
                );
            } catch (histErr) {
                console.error('DPL catalog push: price-history log failed (non-fatal):', histErr.message);
            }
        }

        res.json({ success: true, data: { job_id: result.job_id, pushed: result.total_items, skipped } });
    } catch (err) {
        const status = err.httpStatus || 500;
        console.error('DPL catalog push error:', err);
        res.status(status).json(Object.assign({ success: false, message: err.message }, err.code ? { code: err.code } : {}, err.payload || {}));
    }
});

// Edit a single Zoho item's details LOCALLY (zoho_items_map only — no Zoho write).
// Body: { name?, sku?, description?, dpl? }. When dpl is given, the selling rate is
// recomputed server-side. Pushing to Zoho is a separate step (see /push below).
router.put('/items/zoho-item/:id', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const id = String(req.params.id || '');
        if (!id) return res.status(400).json({ success: false, message: 'Invalid item id' });

        const body = req.body || {};
        const sets = [];
        const vals = [];
        if (body.name !== undefined)        { sets.push('zoho_item_name = ?'); vals.push(String(body.name).trim()); }
        if (body.sku !== undefined)         { sets.push('zoho_sku = ?');       vals.push(String(body.sku).trim()); }
        if (body.description !== undefined) { sets.push('zoho_description = ?'); vals.push(String(body.description).trim()); }

        let rate = null;
        if (body.dpl !== undefined) {
            const dpl = parseFloat(body.dpl);
            if (!Number.isFinite(dpl) || dpl < 0 || dpl > 100000) {
                return res.status(400).json({ success: false, message: 'dpl must be a number between 0 and 100000' });
            }
            rate = dplCatalogService.computeZohoRate(dpl);
            sets.push('zoho_cf_dpl = ?'); vals.push(dpl);
            sets.push('zoho_rate = ?');   vals.push(rate);
        }

        if (!sets.length) return res.status(400).json({ success: false, message: 'No editable fields provided' });

        // Confirm the item exists first — a no-op UPDATE returns affectedRows 0 even
        // for an existing row under mysql2's default flags, so we can't rely on it for 404.
        const [exist] = await pool.query('SELECT zoho_item_id FROM zoho_items_map WHERE zoho_item_id = ?', [id]);
        if (!exist.length) return res.status(404).json({ success: false, message: 'Item not found' });

        vals.push(id);
        await pool.query(`UPDATE zoho_items_map SET ${sets.join(', ')} WHERE zoho_item_id = ?`, vals);
        res.json({ success: true, rate });
    } catch (err) {
        console.error('Zoho-item edit error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Push ONE Zoho item's current (locally-edited) name/SKU/description/DPL/rate to the
// live Zoho item, via the same bulk-edit job path the catalog push uses (which also
// guards SKU conflicts and mirrors confirmed values back to zoho_items_map).
router.post('/items/zoho-item/:id/push', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const id = String(req.params.id || '');
        if (!id) return res.status(400).json({ success: false, message: 'Invalid item id' });

        const [rows] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name, zoho_sku, zoho_description, zoho_cf_dpl, zoho_rate
               FROM zoho_items_map WHERE zoho_item_id = ?`, [id]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: 'Item not found' });

        const z = rows[0];
        const dpl = z.zoho_cf_dpl != null ? parseFloat(z.zoho_cf_dpl) : null;
        if (!(dpl > 0)) return res.status(400).json({ success: false, message: 'Set a DPL before pushing' });
        const rate = z.zoho_rate != null ? parseFloat(z.zoho_rate) : dplCatalogService.computeZohoRate(dpl);

        const changes = { cf_dpl: dpl, purchase_rate: dpl, rate };
        if (z.zoho_item_name)        changes.name = String(z.zoho_item_name).trim();
        if (z.zoho_sku)              changes.sku = String(z.zoho_sku).trim();
        if (z.zoho_description != null) changes.description = String(z.zoho_description).trim();

        const result = await createBulkEditJob(
            [{ zoho_item_id: id, item_name: z.zoho_item_name || '', changes }],
            req.user
        );
        res.json({ success: true, job_id: result.job_id });
    } catch (err) {
        // createBulkEditJob throws with an httpStatus on validation / SKU conflict.
        const status = err.httpStatus || 500;
        console.error('Zoho-item push error:', err);
        res.status(status).json(Object.assign(
            { success: false, message: err.message },
            err.code ? { code: err.code } : {},
            err.payload || {}
        ));
    }
});

// Set the DPL triage disposition for one Zoho item: pending (default / reopen),
// done (owner finalized a manual price), or later (deferred). Stored on
// zoho_items_map — the item sync upsert never touches these columns, so it persists.
router.post('/items/zoho-item/:id/disposition', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const id = String(req.params.id || '');
        if (!id) return res.status(400).json({ success: false, message: 'Invalid item id' });

        const disposition = String((req.body || {}).disposition || '').toLowerCase();
        if (!['pending', 'done', 'later'].includes(disposition)) {
            return res.status(400).json({ success: false, message: "disposition must be 'pending', 'done' or 'later'" });
        }

        const [exist] = await pool.query(
            'SELECT zoho_item_id, dpl_disposition FROM zoho_items_map WHERE zoho_item_id = ?', [id]
        );
        if (!exist.length) return res.status(404).json({ success: false, message: 'Item not found' });

        const userId = req.user ? req.user.id : null;
        if (disposition === 'pending') {
            await pool.query(
                `UPDATE zoho_items_map SET dpl_disposition = 'pending', dpl_disposition_at = NULL, dpl_disposition_by = ? WHERE zoho_item_id = ?`,
                [userId, id]
            );
        } else {
            await pool.query(
                `UPDATE zoho_items_map SET dpl_disposition = ?, dpl_disposition_at = NOW(), dpl_disposition_by = ? WHERE zoho_item_id = ?`,
                [disposition, userId, id]
            );
        }

        try {
            const audit = require('../../services/audit-log');
            await audit.record(req, {
                action: 'zoho_item_disposition',
                entity_type: 'zoho_item',
                entity_id: id,
                before: { dpl_disposition: exist[0].dpl_disposition || 'pending' },
                after: { dpl_disposition: disposition }
            });
        } catch (e) {
            console.warn('audit-log record failed:', e.message);
        }

        res.json({ success: true, disposition });
    } catch (err) {
        console.error('Zoho-item disposition error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========================================
// STOCK
// ========================================

/**
 * GET /api/zoho/stock - Stock levels with filters
 */
router.get('/stock', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const result = await zohoAPI.getLocationStockDashboard(req.query);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/stock/filter-options - Distinct brands and categories for filter dropdowns
 */
router.get('/stock/filter-options', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const [brands] = await pool.query(
            `SELECT DISTINCT zoho_brand FROM zoho_items_map WHERE zoho_status = 'active' AND zoho_brand IS NOT NULL AND zoho_brand != '' ORDER BY zoho_brand ASC`
        );
        const [categories] = await pool.query(
            `SELECT DISTINCT zoho_category_name FROM zoho_items_map WHERE zoho_status = 'active' AND zoho_category_name IS NOT NULL AND zoho_category_name != '' ORDER BY zoho_category_name ASC`
        );
        const [brandCatRows] = await pool.query(
            `SELECT DISTINCT zoho_brand AS brand, zoho_category_name AS category FROM zoho_items_map
             WHERE zoho_status = 'active'
               AND zoho_brand IS NOT NULL AND zoho_brand != ''
               AND zoho_category_name IS NOT NULL AND zoho_category_name != ''
             ORDER BY zoho_brand, zoho_category_name`
        );
        const brandCategories = {};
        for (const row of brandCatRows) {
            if (!brandCategories[row.brand]) brandCategories[row.brand] = [];
            brandCategories[row.brand].push(row.category);
        }
        res.json({
            success: true,
            brands: brands.map(r => r.zoho_brand),
            categories: categories.map(r => r.zoho_category_name),
            brandCategories
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/stock/by-location - Stock for a specific location (must be before :itemId)
 */
router.get('/stock/by-location', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { location_id, search, page = 1, limit = 50, sort = 'name_asc', brands, categories, stock_status } = req.query;
        const safeLimit = Math.min(parseInt(limit) || 50, 500);
        if (!location_id) {
            return res.status(400).json({ success: false, message: 'location_id required' });
        }

        let where = "WHERE ls.zoho_location_id = ? AND (zim.zoho_status = 'active' OR zim.zoho_status IS NULL)";
        const params = [location_id];

        if (search) {
            where += ' AND (ls.item_name LIKE ? OR ls.sku LIKE ?)';
            params.push('%' + search + '%', '%' + search + '%');
        }
        if (brands) {
            const brandList = brands.split(',').map(b => b.trim()).filter(Boolean);
            if (brandList.length) {
                where += ` AND zim.zoho_brand IN (${brandList.map(() => '?').join(',')})`;
                params.push(...brandList);
            }
        }
        if (categories) {
            const catList = categories.split(',').map(c => c.trim()).filter(Boolean);
            if (catList.length) {
                where += ` AND zim.zoho_category_name IN (${catList.map(() => '?').join(',')})`;
                params.push(...catList);
            }
        }
        if (stock_status) {
            if (stock_status === 'out_of_stock') where += ' AND ls.stock_on_hand <= 0';
            else if (stock_status === 'low_stock') where += ' AND ls.stock_on_hand > 0 AND ls.stock_on_hand <= 5';
            else if (stock_status === 'in_stock') where += ' AND ls.stock_on_hand > 0';
        }

        // Sort mapping
        const sortMap = {
            name_asc: 'ls.item_name ASC',
            name_desc: 'ls.item_name DESC',
            sku_asc: 'ls.sku ASC',
            sku_desc: 'ls.sku DESC',
            stock_asc: 'ls.stock_on_hand ASC',
            stock_desc: 'ls.stock_on_hand DESC',
            updated_desc: 'ls.last_synced_at DESC',
            updated_asc: 'ls.last_synced_at ASC',
            brand_asc: 'COALESCE(zim.zoho_brand, "zzz") ASC',
            brand_desc: 'COALESCE(zim.zoho_brand, "") DESC',
            category_asc: 'COALESCE(zim.zoho_category_name, "zzz") ASC',
            category_desc: 'COALESCE(zim.zoho_category_name, "") DESC'
        };
        const orderBy = sortMap[sort] || sortMap.name_asc;

        const offset = (Math.max(1, parseInt(page)) - 1) * safeLimit;
        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) as total FROM zoho_location_stock ls LEFT JOIN zoho_items_map zim ON ls.zoho_item_id = zim.zoho_item_id ${where}`, params
        );

        const [rows] = await pool.query(`
            SELECT ls.zoho_item_id as item_id, ls.item_name as name, ls.sku,
                   ls.stock_on_hand, ls.available_stock, ls.committed_stock, ls.available_for_sale,
                   ls.zoho_location_id as location_id, ls.last_synced_at,
                   zim.zoho_brand as brand, zim.zoho_category_name as category
            FROM zoho_location_stock ls
            LEFT JOIN zoho_items_map zim ON ls.zoho_item_id = zim.zoho_item_id
            ${where}
            ORDER BY ${orderBy}
            LIMIT ? OFFSET ?
        `, [...params, safeLimit, offset]);

        res.json({
            success: true,
            data: rows,
            pagination: { total, page: parseInt(page), limit: safeLimit, pages: Math.ceil(total / safeLimit), totalPages: Math.ceil(total / safeLimit) }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/stock/history - Stock change history
 */
router.get('/stock/history', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { item_id, location_id, page = 1, limit = 50 } = req.query;
        const safeLimit = Math.min(parseInt(limit) || 50, 500);
        let where = 'WHERE 1=1';
        const params = [];

        if (item_id) {
            where += ' AND sh.zoho_item_id = ?';
            params.push(item_id);
        }
        if (location_id) {
            where += ' AND sh.zoho_location_id = ?';
            params.push(location_id);
        }

        const offset = (Math.max(1, parseInt(page)) - 1) * safeLimit;
        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) as total FROM zoho_stock_history sh
             LEFT JOIN zoho_locations_map lm ON sh.zoho_location_id = lm.zoho_location_id
             ${where} AND (lm.is_active = 1 OR lm.is_active IS NULL)`, params
        );

        const [rows] = await pool.query(`
            SELECT sh.*, lm.zoho_location_name
            FROM zoho_stock_history sh
            LEFT JOIN zoho_locations_map lm ON sh.zoho_location_id = lm.zoho_location_id
            ${where} AND (lm.is_active = 1 OR lm.is_active IS NULL)
            ORDER BY sh.created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, safeLimit, offset]);

        res.json({
            success: true,
            data: rows,
            pagination: { total, page: parseInt(page), limit: safeLimit, pages: Math.ceil(total / safeLimit), totalPages: Math.ceil(total / safeLimit) }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/stock/:itemId - Single item stock across all locations
 */
router.get('/stock/:itemId', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const [stock] = await pool.query(`
            SELECT ls.*, lm.zoho_location_name, rc.reorder_level
            FROM zoho_location_stock ls
            LEFT JOIN zoho_locations_map lm ON ls.zoho_location_id = lm.zoho_location_id
            LEFT JOIN zoho_reorder_config rc ON ls.zoho_item_id = rc.zoho_item_id AND ls.zoho_location_id = rc.zoho_location_id
            WHERE ls.zoho_item_id = ? AND (lm.is_active = 1 OR lm.is_active IS NULL)
            ORDER BY lm.zoho_location_name
        `, [req.params.itemId]);

        res.json({ success: true, data: stock });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/stock/sync - Trigger stock sync
 */
router.post('/stock/sync', requirePermission('zoho', 'sync'), async (req, res) => {
    try {
        const rateLimiter = require('../../services/zoho-rate-limiter');
        const quotaStatus = rateLimiter.getStatus();

        // Check API quota before starting heavy stock sync
        if (quotaStatus.daily_percentage >= 85) {
            return res.status(429).json({
                success: false,
                message: `API quota at ${quotaStatus.daily_percentage}% (${quotaStatus.daily_used}/${quotaStatus.daily_limit}). Stock sync requires ~300+ API calls. Please wait until tomorrow.`,
                api_usage: { used: quotaStatus.daily_used, limit: quotaStatus.daily_limit, percentage: quotaStatus.daily_percentage }
            });
        }

        const [running] = await pool.query(
            `SELECT id FROM zoho_sync_log WHERE sync_type = 'stock' AND status IN ('started','in_progress') AND started_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE) LIMIT 1`
        );
        if (running.length > 0) {
            return res.status(409).json({ success: false, message: 'Stock sync already in progress' });
        }

        if (!rateLimiter.tryAcquireSyncLock('stockSync')) {
            const lockInfo = rateLimiter.getSyncLockStatus();
            return res.status(409).json({
                success: false,
                message: `Cannot start stock sync: ${lockInfo.operation} is already running`
            });
        }

        zohoAPI.syncLocationStock(req.user.id).catch(err => {
            console.error('[Zoho] Background stock sync failed:', err.message);
        }).finally(() => {
            rateLimiter.releaseSyncLock('stockSync');
        });

        res.json({
            success: true,
            message: 'Stock sync started. Check sync log for progress.',
            api_usage: { used: quotaStatus.daily_used, limit: quotaStatus.daily_limit, percentage: quotaStatus.daily_percentage }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// INVENTORY ADJUSTMENTS
// ========================================

/**
 * POST /api/zoho/inventory-adjustments - Create inventory adjustment in Zoho Books
 * Body: { adjustment_type, date, reason, description, location_id, line_items: [{item_id, quantity_adjusted}] }
 * Note: Zoho API uses location_id (not warehouse_id) for inventory adjustments
 */
router.post('/inventory-adjustments', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const { adjustment_type, date, reason, description, location_id, warehouse_id, line_items } = req.body;
        if (!line_items || !Array.isArray(line_items) || line_items.length === 0) {
            return res.status(400).json({ success: false, message: 'line_items array is required' });
        }
        if (!adjustment_type || !date) {
            return res.status(400).json({ success: false, message: 'adjustment_type and date are required' });
        }

        // Zoho API uses location_id, not warehouse_id - accept either for backward compat
        const zohoLocationId = location_id || warehouse_id;

        // D8 — Branch isolation: non-admins can only adjust stock for their own branch
        const _zRole = (req.user && req.user.role || '').toLowerCase();
        const _zIsAdmin = ['admin','administrator','super_admin'].includes(_zRole);
        if (req.user && !_zIsAdmin && req.user.branch_id && zohoLocationId) {
            const [locRows] = await pool.query(
                `SELECT local_branch_id FROM zoho_locations_map WHERE zoho_location_id = ? LIMIT 1`,
                [zohoLocationId]
            );
            if (locRows.length > 0 && locRows[0].local_branch_id && locRows[0].local_branch_id !== req.user.branch_id) {
                return res.status(403).json({ success: false, message: 'You can only adjust stock for your own branch' });
            }
        }

        const adjustmentData = {
            adjustment_type,
            date,
            reason: reason || '',
            description: description || '',
            line_items: line_items.map(function(li) {
                const item = {
                    item_id: li.item_id,
                    quantity_adjusted: li.quantity_adjusted
                };
                // Each line item needs location_id for multi-warehouse — without it Zoho defaults to primary location
                if (li.location_id || zohoLocationId) {
                    item.location_id = li.location_id || zohoLocationId;
                }
                return item;
            })
        };

        // Add location_id at top level if provided (for multi-warehouse)
        if (zohoLocationId) {
            adjustmentData.location_id = zohoLocationId;
        }

        const result = await zohoAPI.createInventoryAdjustment(adjustmentData);
        clearCache('inv_adjustments_'); // Invalidate cached adjustment lists
        res.json({ success: true, data: result, message: 'Inventory adjustment created' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/inventory-adjustments - List inventory adjustments from Zoho
 * Cached for 5 minutes to avoid redundant API calls
 */
router.get('/inventory-adjustments', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const cacheKey = 'inv_adjustments_' + JSON.stringify(req.query);
        const cached = getCached(cacheKey, 300000); // 5 min cache
        if (cached) {
            return res.json({ success: true, data: cached, cached: true });
        }

        const result = await zohoAPI.getInventoryAdjustments(req.query);
        const data = result.inventory_adjustments || [];
        setCache(cacheKey, data);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/stock/by-location - Get stock levels grouped by item for a specific location
 */
// ========================================
// ITEMS & BULK UPDATES
// ========================================

/**
 * GET /api/zoho/items - List items from cache
 */
router.get('/items', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { search, brand, category, page = 1, limit = 50 } = req.query;
        const safeLimit = Math.min(parseInt(limit) || 50, 500);

        const showInactive = req.query.show_inactive === '1';
        let where = showInactive ? "WHERE 1=1" : "WHERE (zim.zoho_status = 'active' OR zim.zoho_status IS NULL)";
        const params = [];

        if (search) {
            where += ' AND (zim.zoho_item_name LIKE ? OR zim.zoho_sku LIKE ? OR zim.zoho_brand LIKE ? OR zim.zoho_category_name LIKE ? OR zim.zoho_description LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (brand) {
            where += ' AND zim.zoho_brand LIKE ?';
            params.push(`%${brand}%`);
        }
        if (category) {
            where += ' AND zim.zoho_category_name LIKE ?';
            params.push(`%${category}%`);
        }

        const offset = (Math.max(1, parseInt(page)) - 1) * safeLimit;

        const [[{ total }]] = await pool.query(`SELECT COUNT(*) as total FROM zoho_items_map zim ${where}`, params);

        const [items] = await pool.query(`
            SELECT zim.*,
                zim.zoho_item_id as item_id,
                zim.zoho_item_name as name,
                zim.zoho_item_name as item_name,
                zim.zoho_sku as sku,
                zim.zoho_rate as rate,
                zim.zoho_unit as unit,
                zim.zoho_tax_id as tax_id,
                zim.zoho_description as description,
                zim.zoho_purchase_rate as purchase_rate,
                zim.zoho_label_rate as label_rate,
                zim.zoho_tax_name as tax_name,
                zim.zoho_tax_percentage as tax_percentage,
                zim.zoho_hsn_or_sac as hsn_or_sac,
                zim.zoho_brand as brand,
                zim.zoho_manufacturer as manufacturer,
                zim.zoho_reorder_level as reorder_level,
                COALESCE(ls_agg.total_stock, zim.zoho_stock_on_hand, 0) as stock_on_hand,
                zim.zoho_category_name as category_name,
                zim.zoho_upc as upc,
                zim.zoho_ean as ean,
                zim.zoho_isbn as isbn,
                zim.zoho_part_number as part_number,
                zim.zoho_cf_product_name as cf_product_name,
                zim.zoho_cf_dpl as cf_dpl,
                zim.dpl_updated_at as dpl_updated_at,
                zim.zoho_status as status,
                zim.last_synced_at as last_synced
            FROM zoho_items_map zim
            LEFT JOIN (
                SELECT zoho_item_id, SUM(stock_on_hand) as total_stock
                FROM zoho_location_stock
                GROUP BY zoho_item_id
            ) ls_agg ON ls_agg.zoho_item_id = zim.zoho_item_id
            ${where}
            ORDER BY ${(() => {
                const SORT_WHITELIST = ['zoho_item_name','zoho_sku','zoho_brand','zoho_category_name','zoho_rate','zoho_stock_on_hand'];
                const sortCol = SORT_WHITELIST.includes(req.query.sort) ? `zim.${req.query.sort}` : 'zim.zoho_item_name';
                const sortOrder = req.query.order === 'desc' ? 'DESC' : 'ASC';
                return `${sortCol} ${sortOrder}`;
            })()}
            LIMIT ? OFFSET ?
        `, [...params, safeLimit, offset]);

        res.json({
            success: true,
            data: items,
            pagination: { total, page: parseInt(page), limit: safeLimit, pages: Math.ceil(total / safeLimit), totalPages: Math.ceil(total / safeLimit) }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/items - Create a new item in Zoho Books + local DB
 */
router.post('/items', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const { name, rate, sku, brand, category_name, unit, purchase_rate,
                cf_dpl, label_rate, description, hsn_or_sac, tax_percentage,
                manufacturer, reorder_level, status } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'Item name is required' });
        }
        if (rate === undefined || rate === null || rate === '') {
            return res.status(400).json({ success: false, message: 'Rate is required' });
        }

        const zohoPayload = { item_type: 'inventory' };
        if (name)              zohoPayload.name           = name.trim();
        if (rate !== undefined) zohoPayload.rate          = parseFloat(rate) || 0;
        if (sku)               zohoPayload.sku            = sku.trim();
        if (unit)              zohoPayload.unit           = unit;
        if (purchase_rate)     zohoPayload.purchase_rate  = parseFloat(purchase_rate) || 0;
        if (label_rate)        zohoPayload.label_rate     = parseFloat(label_rate) || 0;
        if (description)       zohoPayload.description    = description;
        if (hsn_or_sac)        zohoPayload.hsn_or_sac     = hsn_or_sac;
        if (tax_percentage)    zohoPayload.tax_percentage = parseFloat(tax_percentage) || 0;
        if (manufacturer)      zohoPayload.manufacturer   = manufacturer;
        if (reorder_level)     zohoPayload.reorder_level  = parseInt(reorder_level) || 0;
        if (status)            zohoPayload.status         = status;
        // Zoho Books uses category_name directly
        if (category_name)     zohoPayload.category_name  = category_name;
        // Custom fields
        if (cf_dpl)            zohoPayload.cf_dpl         = parseFloat(cf_dpl) || 0;

        // Create in Zoho
        console.log('[Zoho Items] Creating item in Zoho:', JSON.stringify(zohoPayload));
        const zohoResp = await zohoAPI.createItem(zohoPayload);
        console.log('[Zoho Items] Zoho response code:', zohoResp.code, 'item_id:', zohoResp.item?.item_id);
        const createdItem = zohoResp.item;
        if (!createdItem || !createdItem.item_id) {
            console.error('[Zoho Items] No item_id in Zoho response:', JSON.stringify(zohoResp));
            return res.status(500).json({ success: false, message: 'Zoho did not return item_id' });
        }

        // Insert into local DB
        await pool.query(`
            INSERT INTO zoho_items_map
                (zoho_item_id, zoho_item_name, zoho_sku, zoho_rate, zoho_purchase_rate,
                 zoho_label_rate, zoho_unit, zoho_description, zoho_hsn_or_sac,
                 zoho_tax_percentage, zoho_brand, zoho_category_name, zoho_manufacturer,
                 zoho_reorder_level, zoho_stock_on_hand, zoho_cf_dpl, zoho_status, last_synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NOW())
        `, [
            createdItem.item_id,
            name.trim(),
            sku || createdItem.sku || null,
            parseFloat(rate) || 0,
            parseFloat(purchase_rate) || 0,
            parseFloat(label_rate) || 0,
            unit || null,
            description || null,
            hsn_or_sac || null,
            parseFloat(tax_percentage) || 0,
            brand || null,
            category_name || null,
            manufacturer || null,
            parseInt(reorder_level) || 0,
            parseFloat(cf_dpl) || 0,
            status || 'active'
        ]);

        res.json({ success: true, message: 'Item created successfully', data: { zoho_item_id: createdItem.item_id, name: name.trim() } });
    } catch (error) {
        console.error('[Zoho Items] Create error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/sync/items - Sync items from Zoho (debounced 30s)
 */
router.post('/sync/items', requirePermission('zoho', 'sync'), async (req, res) => {
    try {
        const wait = isSyncDebounced('sync_items');
        if (wait > 0) {
            return res.status(429).json({ success: false, message: `Please wait ${wait}s before syncing items again` });
        }
        const result = await zohoAPI.syncItems(req.user.id);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/items/ai-edit - AI-powered item editing via KAI
 * Sends items + natural language command to AI, returns JSON edits
 */
router.post('/items/ai-edit', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const { command, items, context, history } = req.body;
        if (!command || !command.trim()) {
            return res.status(400).json({ success: false, message: 'command is required' });
        }
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'items array is required' });
        }

        // Build compact item data — minimal fields to stay within WebSocket limits
        const BATCH_SIZE = 300; // Items per AI call (keeps payload under WS frame limit)
        const allCompact = items.map(it => ({
            id: it.zoho_item_id || it.item_id,
            name: it.name || it.item_name,
            sku: it.sku || '',
            rate: parseFloat(it.rate) || 0,
            pr: parseFloat(it.purchase_rate) || 0,
            dpl: parseFloat(it.cf_dpl) || 0,
            brand: it.brand || '',
            desc: it.description || '',
            cat: it.category_name || ''
        }));

        const systemPrompt = `You are KAI, an AI Items Editor for a paint retail business (Quality Colours). You receive inventory items and a user command. Return ONLY valid JSON.

FIELD NAMES IN DATA (shortened): id, name, sku, rate (selling price), pr (purchase_rate), dpl (cf_dpl = Dealer Price List), brand, desc (description), cat (category)
EDITABLE FIELDS in edits: rate, pr, dpl, brand, sku, unit, hsn, tax, cat, desc (use these SHORT names in your edits)
READ-ONLY: id, name

PAINT INDUSTRY PRODUCT KNOWLEDGE (use this to identify products by their abbreviated names):
- "AJAX PAPER" / "ROLL PAPER AJAX" / "ROLL EMERY PAPER" = Sanding Paper / Abrasive Paper (number prefix = grit, e.g. "100 AJAX PAPER" = Sanding Paper 100 Grit)
- "AMBER" colors (Amber Black/Brown/Red/Yellow) = Powder Pigment / Oxide Color
- "STAINER" (Black/Blue/Red/Green/Yellow Stainer) = Liquid Colorant/Tinter
- "DDL FEVICOL" = Wood Adhesive, "ARALDITE" = Epoxy Adhesive, "M-SEAL" = Epoxy Compound
- "BDR" / "BORDER" = Border paint/emulsion for decorative borders
- "BS" prefix (BS01/BS04/BS10/BS20) = Bucket Size (01L/04L/10L/20L) of emulsions
- "AP" prefix = Asian Paints, "APCO" = Apcolite (enamel line), "APEX" = exterior emulsion line
- "DIS" prefix = Distemper, "APTY" = Wall Putty, "CC" prefix = Construction Chemical
- "AF" prefix = Antifouling (marine paint), "BC" prefix = Base Coat (marine/industrial)
- "CST" prefix = Custom shade/color enamel, "CR" prefix = Crack repair product
- "FG" prefix = Floor Guard, "BF" prefix = Marine bottom finish paint
- "CAP WASTE" / "CLOTH WASTE" / "COLOUR WASTE" = Cleaning supplies

RULES:
- Return ONLY JSON: { "edits": [...], "summary": "...", "reply": "..." }
- Each edit: { "id": "<item_id>", "changes": { "<field>": <value> } }. Use SHORT field names (pr, dpl, cat, hsn, tax, desc).
- CRITICAL: Process EVERY matching item. Do NOT skip items. Scan ALL items in the batch.
- Only include changed items. Round numbers to 2 decimals. NEVER change id/name.
- "reply" = conversational message for chat (markdown OK). "summary" = one-line description.
- For % ops: "increase by 5%" = multiply by 1.05. "Set DPL to 80% of rate" = dpl = rate * 0.8.
- If REFERENCE DATA provided (Excel table), match items by name/SKU and apply values from reference.
- If unclear: return empty edits with helpful reply.
- IMPORTANT: Return ONLY the JSON object. No markdown fences, no extra text.`;

        // Field name mapping (short → full)
        const fieldMap = {
            pr: 'purchase_rate', dpl: 'cf_dpl', cat: 'category_name',
            hsn: 'hsn_or_sac', tax: 'tax_percentage', desc: 'description',
            category: 'category_name', tax_pct: 'tax_percentage',
            purchase_rate: 'purchase_rate', cf_dpl: 'cf_dpl', description: 'description'
        };

        // === DETERMINISTIC REFERENCE DATA MATCHING ===
        // If context contains a tab-separated table (pasted from Excel), parse it and do
        // exact name matching instead of sending to AI. This is instant, accurate, and handles
        // thousands of items without batching or timeouts.
        if (context && context.includes('\t')) {
            const lines = context.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            if (lines.length >= 2) {
                // Parse header row to detect columns
                const headerLine = lines[0];
                const headers = headerLine.split('\t').map(h => h.trim().toLowerCase());

                // Map header names to our field names
                const headerFieldMap = {
                    'brand': 'brand', 'brand name': 'brand',
                    'rate': 'rate', 'selling price': 'rate', 'price': 'rate', 'mrp': 'rate',
                    'purchase rate': 'purchase_rate', 'purchase_rate': 'purchase_rate', 'cost': 'purchase_rate', 'cost price': 'purchase_rate',
                    'dpl': 'cf_dpl', 'cf_dpl': 'cf_dpl', 'dealer price': 'cf_dpl',
                    'sku': 'sku',
                    'unit': 'unit',
                    'hsn': 'hsn_or_sac', 'hsn code': 'hsn_or_sac', 'hsn_or_sac': 'hsn_or_sac', 'sac': 'hsn_or_sac',
                    'tax': 'tax_percentage', 'tax %': 'tax_percentage', 'tax_percentage': 'tax_percentage', 'gst': 'tax_percentage',
                    'category': 'category_name', 'category name': 'category_name', 'category_name': 'category_name',
                    'description': 'description'
                };

                // Find which column is the item name (first column or explicit header)
                const nameColIdx = headers.findIndex(h =>
                    h === 'item name' || h === 'name' || h === 'item_name' || h === 'product name' || h === 'product'
                );
                const nameIdx = nameColIdx >= 0 ? nameColIdx : 0; // Default to first column

                // Find value columns (everything except the name column)
                const valueColumns = [];
                for (let i = 0; i < headers.length; i++) {
                    if (i === nameIdx) continue;
                    const fieldName = headerFieldMap[headers[i]];
                    if (fieldName) {
                        valueColumns.push({ colIdx: i, fieldName });
                    }
                }

                // Only use deterministic matching if we found at least one value column
                if (valueColumns.length > 0) {
                    // Build lookup map: normalized item name → { field: value, ... }
                    const lookupMap = new Map();
                    for (let i = 1; i < lines.length; i++) {
                        const cols = lines[i].split('\t');
                        const itemName = (cols[nameIdx] || '').trim();
                        if (!itemName) continue;

                        const values = {};
                        for (const vc of valueColumns) {
                            const val = (cols[vc.colIdx] || '').trim();
                            if (val) {
                                // Keep numeric fields as numbers
                                if (['rate', 'purchase_rate', 'cf_dpl', 'tax_percentage'].includes(vc.fieldName)) {
                                    const num = parseFloat(val);
                                    if (!isNaN(num)) values[vc.fieldName] = num;
                                } else {
                                    values[vc.fieldName] = val;
                                }
                            }
                        }
                        if (Object.keys(values).length > 0) {
                            lookupMap.set(itemName.toUpperCase(), values);
                        }
                    }

                    // Match items by exact name
                    const allEdits = [];
                    let matchCount = 0;
                    let missCount = 0;
                    for (const item of allCompact) {
                        const itemName = (item.name || '').trim().toUpperCase();
                        const match = lookupMap.get(itemName);
                        if (match) {
                            // Only include fields that actually changed
                            const changes = {};
                            for (const [field, newVal] of Object.entries(match)) {
                                const shortField = Object.entries(fieldMap).find(([, v]) => v === field);
                                const currentVal = shortField ? item[shortField[0]] : item[field];
                                if (String(currentVal || '').toUpperCase() !== String(newVal).toUpperCase()) {
                                    changes[field] = newVal;
                                }
                            }
                            if (Object.keys(changes).length > 0) {
                                allEdits.push({ zoho_item_id: item.id, changes });
                                matchCount++;
                            }
                        } else {
                            missCount++;
                        }
                    }

                    const fieldNames = valueColumns.map(vc => vc.fieldName).join(', ');
                    const summary = `Direct match: Updated ${matchCount} items (${fieldNames}). ${missCount} items had no match in reference data. ${lookupMap.size} reference entries used.`;
                    const reply = `**Direct Data Match Complete**\n\n` +
                        `Applied **${fieldNames}** from your reference table (${lookupMap.size} entries) to ${allCompact.length} items.\n\n` +
                        `- **${matchCount}** items updated (exact name match)\n` +
                        `- **${allCompact.length - matchCount - missCount}** items already had correct values\n` +
                        `- **${missCount}** items not found in reference data\n\n` +
                        `*Used deterministic matching — every value applied exactly as provided.*`;

                    return res.json({
                        success: true,
                        edits: allEdits,
                        summary,
                        reply,
                        model: 'deterministic',
                        itemsProcessed: allCompact.length,
                        batchCount: 1
                    });
                }
            }
        }

        // === QUICK STATS HANDLER ===
        // Answer listing/counting questions instantly from loaded items
        const isListQuestion = /\b(how\s+many|list\s+(all|out)|show\s+(all|me)|count|available|what.*categor|what.*brand|which.*categor|which.*brand)\b/i.test(command);
        if (isListQuestion) {
            const brands = {};
            const categories = {};
            allCompact.forEach(it => {
                if (it.brand) brands[it.brand] = (brands[it.brand] || 0) + 1;
                if (it.cat) categories[it.cat] = (categories[it.cat] || 0) + 1;
            });
            const sortedBrands = Object.entries(brands).sort((a, b) => b[1] - a[1]);
            const sortedCats = Object.entries(categories).sort((a, b) => b[1] - a[1]);

            let reply = `**Item Statistics** (${allCompact.length} items loaded)\n\n`;
            if (/brand/i.test(command) || !/categor/i.test(command)) {
                reply += `**Brands (${sortedBrands.length}):**\n`;
                reply += sortedBrands.map(([name, count]) => `- ${name}: ${count} items`).join('\n');
                reply += '\n\n';
            }
            if (/categor/i.test(command) || !/brand/i.test(command)) {
                reply += `**Categories (${sortedCats.length}):**\n`;
                reply += sortedCats.map(([name, count]) => `- ${name}: ${count} items`).join('\n');
            }

            return res.json({
                success: true,
                edits: [],
                summary: `${sortedBrands.length} brands, ${sortedCats.length} categories across ${allCompact.length} items`,
                reply,
                model: 'deterministic',
                itemsProcessed: allCompact.length,
                batchCount: 0
            });
        }

        // === DETERMINISTIC PAINT PRODUCT CATEGORIZER ===
        // When user asks to categorize/classify items, use keyword matching on product names.
        // This is instant, handles all items, and never misses any.
        // Only trigger categorizer for ACTION commands, not questions about categories
        const isCategoryCommand = /\b(categor(ize|ise)|classify|assign\s+categor|set\s+categor|bulk\s+categor|update\s+categor)\b/i.test(command);
        if (isCategoryCommand) {
            function categorizePaintItem(name, desc, brand) {
                const text = `${name || ''} ${desc || ''}`.toUpperCase();
                const b = (brand || '').toUpperCase();

                // --- MARINE / ANTIFOULING ---
                if (/\bANTIFOUL/i.test(text) || /\bMARINE\b/i.test(text) || /\bBASE COAT\b/i.test(text) ||
                    /\bRUST O CAP\b/i.test(text) || /\bPROTECTMASTIC\b/i.test(text) ||
                    b.includes('MARINE') || /\bBF\s/.test(name)) return 'MARINE';

                // --- WALL PUTTY ---
                if (/\bWALL\s*PUTTY\b/.test(text) || /\bWALLCARE.*PUTTY\b/.test(text) ||
                    /\bAPTY\d/.test(text) || /\bSMARTCARE\s*WATERPROOF\s*PUTTY\b/.test(text) ||
                    /\bBIRLA\s*WALLCARE\b/.test(text) || /\bPLASTER\s*COAT\b/.test(text))
                    return b.includes('OPUS') ? 'OPUS WALLCARE&WALLPUTTY'
                         : b.includes('BERGER') ? 'BERGER WALLCARE&WALLPUTTY'
                         : b.includes('MULTI') ? 'MULTI WALLCARE&WALLPUTTY'
                         : /TRUCARE/.test(text) ? (/SUPREMA/.test(text) ? 'TRUCARE WALL PUTTY SUPREMA WHITE- PROJECT' : 'TRUCARE WALL PUTTY WHITE')
                         : /PUTTY.*WHITE|WHITE.*PUTTY/.test(text) ? 'AP TRUCARE ACR WALL PUTTY WHITE'
                         : 'MULTI WALLCARE&WALLPUTTY';

                // --- CONSTRUCTION CHEMICALS / WATERPROOFING ---
                if (/\bCRACK\s*(PASTE|SEAL|POWDER)\b/.test(text) || /\bSEEPGAU?RD\b/.test(text) ||
                    /\bDR\s*FIXIT\b/.test(text) || /\bCMX\b/.test(text) || /\bCRACK\s*MASTER\b/.test(text) ||
                    /\bCC\d/.test(name) || /\bCR\d/.test(name))
                    return /OPUS/.test(text) ? 'CONSTRUCTION CHEMICALS' : /BERGER/.test(text) ? 'CONSTRUCTION CHEMICALS' : 'CONSTRUCTION CHEMICALS';

                if (/\bDAMP\s*PROOF\b/.test(text) || /\bDAMP\s*BLOCK\b/.test(text) || /\bDAMP\s*SHEATH\b/.test(text) ||
                    /\bHYDROLOC\b/.test(text) || /\bWATER\s*PROOF\b/.test(text) || /\bSMART\s*CARE\b/.test(text) ||
                    /\bSMRTCR\b/.test(text)) {
                    if (/DAMP\s*PROOF.*TERACOTA|TERACOTA.*DAMP/.test(text)) return 'AP SMARTCARE DAMP PROOF TERACOTA';
                    if (/DAMP\s*PROOF.*WHITE|WHITE.*DAMP\s*PROOF/.test(text)) return 'AP SMARTCARE DAMP PROOF WHITE';
                    if (/DAMP\s*BLOCK/.test(text)) return /PRIME/.test(text) ? 'SMARTCARE DAMP BLOCK 2K PRIME BLACK' : 'AP SMARTCARE DAMP BLOCK - 2K BLACK';
                    if (/DAMP\s*SHEATH.*EXT/.test(text)) return 'AP SMARTCARE DAMP SHEATH EXTERIOR WHITE';
                    if (/DAMP\s*SHEATH.*INT.*CLASC|CLASC.*INT/.test(text)) return 'AP SMARTCARE DAMP SHEATH INTERIOR CLASC WT';
                    if (/DAMP\s*SHEATH.*INT/.test(text)) return 'AP SMARTCARE DAMP SHEATH INTERIOR WHITE';
                    if (/HYDROLOC/.test(text)) return 'AP SMARTCARE HYDROLOC CLEAR';
                    if (/CRACK\s*SEAL/.test(text)) return 'AP SMARTCARE CRACK SEAL WHITE';
                    if (/REPAIR\s*POLYMER/.test(text)) return 'AP SMART CARE REPAIR POLYMER WHITE';
                    return 'AP SMARTCARE DAMP PROOF WHITE';
                }

                // --- DISTEMPER ---
                if (/\bDIS?TEMB?E?R\b/.test(text) || /\bDIS\d/.test(name) || /\bBISON\s*DIS/.test(text))
                    return /OPUS/.test(text) || b.includes('OPUS') ? 'OPUS DISTEMPAR'
                         : /BERGER/.test(text) || b.includes('BERGER') ? 'BERGER DISTEMPAR'
                         : 'MULTI PDR';

                // --- FLOOR COAT ---
                if (/\bFLOOR\s*(COAT|GUARD)\b/.test(text) || /\bFG\d/.test(name))
                    return /OPUS/.test(text) || b.includes('OPUS') ? 'OPUS FLOOR COAT' : 'FLOOR COAT';

                // --- WOOD PRODUCTS ---
                if (/\bMELA[MY]NE\b/.test(text) || /\bWOOD\s*TECH\b/.test(text) || /\bWOODTECH\b/.test(text) ||
                    /\bVARNISH\b/.test(text) || /\bWOOD\s*STAIN\b/.test(text) || /\bNC\s*SAND/.test(text) ||
                    /\bPU\s*(EX|IN|INT|EXT|PALETTE)\b/.test(text) || /\bLACQUER\b/.test(text) ||
                    /\bFRENCH\s*POLISH\b/.test(text) || /\bWOOD\s*POLISH\b/.test(text) ||
                    /\bSEALER\b/.test(text) || /\bWOOD\s*PRIMER\b/.test(text)) {
                    if (/MELAMYNE.*GLOSSY|GLOSSY.*MELAMYNE/.test(text)) return 'AP WOODTECH MELAMYNE GLOSSY CLEAR';
                    if (/MELAMYNE.*MATT|MATT.*MELAMYNE/.test(text)) return 'AP WOODTECH MELAMYNE MATT CLEAR';
                    if (/MELAMYNE.*SEALER|SEALER.*MELAMYNE/.test(text)) return 'AP WOODTECH MELAMYNE SEALER CLEAR';
                    if (/PU.*EX.*GL/.test(text)) return 'ASNPTS PU EX GL CLEAR';
                    if (/PU.*IN.*SR|PU.*INT.*SEALER/.test(text)) return 'ASNPTS PU IN SR CLEAR';
                    if (/PU.*INT.*GL|PU.*IN.*GL/.test(text)) return 'PU PALETTE TRANSLUCENT APPU INT GLS';
                    if (/WOOD\s*STAIN/.test(text)) return 'WOODTECH WOOD STAIN WALNUT';
                    if (/WOOD\s*PRIMER/.test(text)) return 'ASIAN PAINTS WOOD PRIMER WHITE';
                    if (/OPUS/.test(text) || b.includes('OPUS')) return 'OPUS WOOD POLISH - SEALER, GLASSY, MAT';
                    if (/BERGER/.test(text) || b.includes('BERGER')) return 'BERGER WOOD POLISH - SEALER, GLASSY, MAT';
                    return 'ASIAN PAINT PRODUCTS';
                }

                // --- PRIMER ---
                if (/\bPRIMER\b/.test(text) || /\bPRIMEX\b/.test(text) || /\bPRIMCOAT\b/.test(text) ||
                    /\bPRIME\b/.test(text) && !/PREMIUM/.test(text)) {
                    if (/TRUCARE.*INT|INT.*PRIMER/.test(text) && /ASIAN|AP\b/.test(text)) return 'TRUCARE INTERIOR WALL PRIMER - WT WHITE';
                    if (/TRUCARE.*EXT|EXT.*PRIMER/.test(text)) return /WHITE\s*C/.test(text) ? 'TRUCARE EXTERIOR WALL PRIMER WHITE C' : 'TRUCARE EXTERIOR WALL PRIMER WHITE';
                    if (/EPOXY/.test(text) && /1\s*PACK/.test(text)) return 'TRUCARE 1 PACK EPOXY PRIMER LT GREY';
                    if (/SPARC.*PRIMER|INTERIOR.*PRIMER.*ASIAN/.test(text)) return 'ASIAN PAINTS SPARC INTERIOR PRIMER WHITE';
                    if (/METAL.*PRIMER.*YELLOW|YELLOW.*METAL.*PRIMER|HI\s*PERF/.test(text)) return 'HI PERFORMANCE YELLOW METAL PRIMER YELLOW';
                    if (/OPUS/.test(text) || b.includes('OPUS')) return /METAL|WOOD/.test(text) ? 'OPUS METAL & WOOD PRIMER' : 'OPUS PRIMER';
                    if (/BERGER/.test(text) || b.includes('BERGER')) return /METAL|WOOD/.test(text) ? 'BERGER METAL & WOOD PRIMER' : 'BERGER PRIMER';
                    if (/BIRLA.*OPUS|OPUS.*PRIME/.test(text) || b.includes('PRIME OPUS')) return 'BIRLA OPUS PRIME';
                    if (/NIPPON/.test(text)) return 'ASIAN PAINT PRODUCTS';
                    return 'ASIAN PAINT PRODUCTS';
                }

                // --- ENAMEL ---
                if (/\bENAMEL\b/.test(text) || /\bENML\b/.test(text) || /\bENL\b/.test(text) ||
                    /\bAPCO\s*ADV\b/.test(text) || /\bAPCOLITE\b/.test(text) || /\bAPCO\b/.test(text) ||
                    /\bGLOSS\b/.test(text) && /\bPREMIUM\b/.test(text)) {
                    if (/APCOLITE.*SHYNE|APCOADVSHYNE/.test(text)) {
                        if (/AS11/.test(text)) return 'APCOLITE ADVANCED SHYNE AS11';
                        if (/AS22/.test(text)) return 'APCOLITE ADVANCED SHYNE AS22';
                        if (/PUR\s*WH|PURWH/.test(text)) return 'APCOLITE ADVANCED SHYNE PURWHT';
                        return 'APCOLITE ADVANCED SHYNE PURWHT';
                    }
                    if (/ALL\s*PROTEK/.test(text)) return 'APCOLITE ALL PROTEK PURWHT';
                    if (/BLACK\s*BOARD/.test(text)) return 'ASIAN PAINT PRODUCTS';
                    if (/HAMMER\s*TONE/.test(text)) return 'HAMMER TONE';
                    if (/OPUS/.test(text) || b.includes('OPUS') || b.includes('ENAMEL')) return /OPUS/.test(text) || b.includes('OPUS') ? 'OPUS ENAMEL' : 'BERGER ENAMEL';
                    if (/BERGER/.test(text) || b.includes('BERGER')) return 'BERGER ENAMEL';
                    if (/SPRAY/.test(text)) return 'SPRAY PAINT';
                    return 'AP PREMIUM GLOSS ENAMEL BLACK';
                }

                // --- EMULSION (must come after enamel/primer checks) ---
                // Also match known product lines that ARE emulsions even without "EMULSION" keyword
                const isKnownEmulsionProduct = /\bAPEX\b/.test(text) || /\bROYALE\b/.test(text) ||
                    (/\bTRACTOR\b/.test(text) && !/DISTEMPER/.test(text)) ||
                    (/\bACE\b/.test(text) && !/ENAMEL/.test(text)) ||
                    /\bPREM.*BW\d/.test(text) || /TRACTOREMUL/.test(text) ||
                    /APEXULTIMA/.test(text) || /APACESHYNE/.test(text) ||
                    /APTRACTOREMUL/.test(text);
                if (/\bEMUL(SION|TION)?\b/.test(text) || /\bEML\b/.test(text) || isKnownEmulsionProduct) {
                    // Asian Paints products
                    if (/ROYALE/.test(text)) {
                        if (/SHYNE/.test(text)) {
                            if (/SN10/.test(text)) return 'ROYALE SHYNE SN10';
                            if (/SN21/.test(text)) return 'ROYALE SHYNE SN21';
                            if (/SN3\b/.test(text)) return 'ROYALE SHYNE SN3';
                            if (/RADNT|RADIANT/.test(text)) return 'AP ROYALE SHYNE RADNT WT';
                            return 'AP ROYALE SHYNE RADNT WT';
                        }
                        if (/PLY.*METALLIC|METALLIC/.test(text)) return 'AP ROYALE PLY METALLICS COPPER';
                        if (/GRAND|GRND/.test(text)) return 'AP ROYALE GRAND WHITE';
                        if (/RB1/.test(text)) return 'ROYALE LUXURY EMULSION RB1N';
                        if (/RB2/.test(text)) return 'AP ROYALE RB2';
                        return 'ROYALE LUXURY EMULSION RB1N';
                    }
                    if (/APEX.*ULTIMA|APEXULTIMA/.test(text)) {
                        if (/PROTEK/.test(text)) {
                            if (/UP1\b/.test(text)) return 'APEX ULTIMA PROTEK UP1';
                            if (/UP10/.test(text)) return 'APEX ULTIMA PROTEK UP10';
                            if (/UP20/.test(text)) return 'APEX ULTIMA PROTEK UP20';
                            return 'APEX ULTIMA PROTEK UP1';
                        }
                        if (/HQ16/.test(text)) return 'APEX ULTIMA HQ16';
                        if (/HQ17/.test(text)) return 'APEX ULTIMA HQ17';
                        if (/HQ20/.test(text)) return 'APEX ULTIMA HQ20N';
                        if (/HQ2\b|HQ2N/.test(text)) return 'APEX ULTIMA HQ2N';
                        if (/BR\s*WHITE/.test(text)) return 'AP APEX ULTIMA BR WHITE';
                        return 'APEX ULTIMA HQ17';
                    }
                    if (/APEX.*ADV|APEX\s*ADVANCED/.test(text)) {
                        if (/AV6/.test(text)) return 'APEX ADVANCED AV6';
                        return 'APEX ADVANCED AV6';
                    }
                    if (/APEX.*SUPREMA/.test(text)) return 'APEX SUPREMA CLASSIC WHITE- PROJECT';
                    if (/APEX.*TILE|TILE\s*GUARD/.test(text)) return 'APEX TILE GUARD TG1';
                    if (/\bAPEX\b/.test(text)) {
                        if (/CLASC|CLASSIC/.test(text)) return 'AP APEX CLASC WT';
                        if (/AB11/.test(text)) return 'APEX WP EXT EMULSION AB11';
                        if (/AB12/.test(text)) return 'APEX WP EXT EMULSION AB12';
                        if (/AB15/.test(text)) return 'APEX WP EXT EMULSION AB15';
                        if (/AB17/.test(text)) return 'AP APEX AB17';
                        if (/AB2\b|AB2G/.test(text)) return 'APEX WP EXT EMULSION AB2';
                        if (/AB21/.test(text)) return /AB21G/.test(text) ? 'APEX WP EXT EMULSION AB21G' : 'AP APEX AB21';
                        if (/AB6/.test(text)) return 'APEX WP EXT EMULSION AB6';
                        return 'APEX WP EXT EMULSION AB2';
                    }
                    if (/ACE.*SHYNE|ACESHYNE/.test(text)) {
                        if (/AH10/.test(text)) return 'ACE SHYNE AH10';
                        if (/AH2\b|AH21/.test(text)) return /AH21/.test(text) ? 'ACE SHYNE AH21' : 'ACE SHYNE AH2';
                        return 'ACE SHYNE AH10';
                    }
                    if (/ACE.*ADV/.test(text)) {
                        if (/AE2/.test(text)) return 'ACE ADVANCED AE2';
                        if (/WHITE/.test(text)) return 'AP ACE ADVANCED WHITE';
                        return 'ACE ADVANCED AE2';
                    }
                    if (/ACE.*SPARC/.test(text)) return 'ACE SPARC ADVANCED SUPWHT';
                    if (/\bACE\b.*EXT/.test(text)) {
                        if (/AC17/.test(text)) return 'ACE EXTERIOR EML PT AC17';
                        if (/AC21/.test(text)) return 'ACE EXTERIOR EMULSION AC21G';
                        if (/AC2\b|AC2G/.test(text)) return 'ACE EXTERIOR EMULSION AC2G';
                        if (/AC9/.test(text)) return 'ACE EXTERIOR EMULSION AC9G';
                        return 'ACE EXTERIOR EMULSION AC2G';
                    }
                    if (/TRACTOR.*SHYNE|TRACTORSHYNE/.test(text)) {
                        if (/SH1\b|SH1N/.test(text)) return 'TRACTOR EMULSION SHYNE SH1';
                        if (/SH13/.test(text)) return 'TRACTOR EMULSION SHYNE SH13';
                        return 'TRACTOR EMULSION SHYNE SH1';
                    }
                    if (/TRACTOR.*SPARC/.test(text)) return /SUPWHTA/.test(text) ? 'TRACTOR SPARC SUPWHTA' : 'TRACTOR SPARC SUPWHT';
                    if (/TRACTOR.*SUPREMA/.test(text)) return 'TRACTOR SUPREMA SPRWHITE';
                    if (/TRACTOR.*ADV|TRACTOR.*TA\d/.test(text)) return 'TRACTOR EMULSION ADVANCED TA3';
                    if (/TRACTOR/.test(text) || /\bTE\d/.test(text) || /TRACTOREMUL/.test(text)) {
                        if (/TE1\b|TE\s*1\b/.test(text)) return 'AP TRACTOR EMUL TE1';
                        if (/TE13/.test(text)) return 'TRACTOR EMULSION TE13';
                        if (/TE22/.test(text)) return 'TRACTOR EMULSION TE22N';
                        if (/TE3\b/.test(text)) return 'TRACTOR EMULSION TE3';
                        return 'AP TRACTOR EMUL TE1';
                    }
                    if (/PREM.*EMUL|PREMEMUL/.test(text)) {
                        if (/BW1\b|BW1\//.test(text)) return 'PREMIUM EMULSION BW1';
                        if (/BW11/.test(text)) return 'PREMIUM EMULSION BW11N';
                        if (/BW12/.test(text)) return 'PREMIUM EMULSION BW12';
                        return 'PREMIUM EMULSION BW1';
                    }

                    // Shalimar products
                    if (/SHALIMAR/.test(text) || /HERO\s*PREMIUM/.test(text) || /SILK.*INT|INT.*SILK/.test(text) ||
                        /SHAKTIMAN/.test(text) || /XTRA\s*TOUGH/.test(text) || /NO\s*1\s*SILK/.test(text) ||
                        /SILK\s*ECO/.test(text) || /SILK\s*SIGN/.test(text)) {
                        return 'ASIAN PAINT PRODUCTS';
                    }

                    // Berger products
                    if (/BERGER/.test(text) || b.includes('BERGER') || b.includes('EMULSION BERGER') ||
                        /FLEXO/.test(text) || /SMOOTH\s*EMUL/.test(text) || /LONG\s*LIFE/.test(text) ||
                        /FEASY/.test(text) || /EASY\s*CLEAN/.test(text) || /WALMASTA/.test(text) ||
                        /BISON\s*LITE/.test(text) || /ANTIDUST/.test(text)) return 'BERGER EMULSION';

                    // Crizon products
                    if (/CRIZON|CRIZION/.test(text) || b.includes('CRIZON')) {
                        if (/DIAMONT|GLAZE/.test(text)) return 'ASIAN PAINT PRODUCTS';
                        if (/TUF\s*PRO|TUFPRO/.test(text)) return 'ASIAN PAINT PRODUCTS';
                        if (/FEATHER\s*PRO/.test(text)) return 'ASIAN PAINT PRODUCTS';
                        if (/BDR|BORDER/.test(text)) return 'ASIAN PAINT PRODUCTS';
                        return 'ASIAN PAINT PRODUCTS';
                    }

                    // Opus products
                    if (/OPUS/.test(text) || b.includes('OPUS')) return 'OPUS EMULSION';

                    // Nippon / Astral
                    if (/NIPPON/.test(text)) return 'ASIAN PAINT PRODUCTS';
                    if (/ASTRAL/.test(text)) return 'GEM ASTRAL PAINTS';

                    // Generic/default emulsion
                    return 'ASIAN PAINT PRODUCTS';
                }

                // --- COLORANT / STAINER / TINTER ---
                if (/\bCOLOU?RANT\b/.test(text) || /\bSTAINER\b/.test(text) || /\bTINTER\b/.test(text) ||
                    /\bAMBER\b/.test(text) || /\bCC\b.*\bCOLOU?R/.test(text) || /\bBR\s*COLOURANT/.test(text)) {
                    if (/BERGER/.test(text) || b.includes('BERGER')) return 'BERGER MACHINE COLORANT';
                    if (/OPUS/.test(text) || b.includes('OPUS')) return 'OPUS EMULSION';
                    if (b.includes('MULTI')) return 'MULTI CC';
                    return 'QC STAINER';
                }

                // --- SPRAY PAINT ---
                if (/\bSPRAY\s*PAINT\b/.test(text) || /\bSPRAY\b/.test(text) && /\bPAINT\b/.test(text))
                    return 'SPRAY PAINT';

                // --- HAMMER TONE ---
                if (/\bHAMMER\s*TONE\b/.test(text)) return 'HAMMER TONE';

                // --- ADHESIVE / FEVICOL ---
                if (/\bFEVICOL\b/.test(text) || /\bARALDITE\b/.test(text) || /\bM[\s-]*SEAL\b/.test(text) ||
                    /\bADHESIVE\b/.test(text) || /\bDDL\b/.test(name))
                    return 'ACCESSORIES';

                // --- TOOLS / BRUSHES ---
                if (/\bBRUSH\b/.test(text) || /\bROLLER\b/.test(text) || /\bTAPE\b/.test(text) ||
                    /\bBLADE\b/.test(text) || /\bTRAY\b/.test(text) || /\bMASKING\b/.test(text) ||
                    /\bSPONGE\b/.test(text) || /\bSAND\s*PAPER\b/.test(text) || /\bEMERY\b/.test(text) ||
                    /\bPAPER\b/.test(text) && /\bAJAX\b/.test(text) ||
                    /\bCOMBO\b/.test(text) || /\bSCRAPER\b/.test(text) || /\bPUTTY\s*KNIFE\b/.test(text))
                    return 'TOOLS- BRUSH, ROLLER, BLADE, PAPER';

                // --- ABRASIVE / CUMI ---
                if (/\bCUMI\b/.test(text) || /\bABRASIVE\b/.test(text) || /\bGRIND\b/.test(text) ||
                    /\bSAND\b/.test(text) && /\bDISC\b/.test(text))
                    return 'ACCESSORIES';

                // --- THINNER / SOLVENT ---
                if (/\bTHINNER\b/.test(text) || /\bTURPENTINE\b/.test(text) || /\bSOLVENT\b/.test(text) ||
                    /\bSPIRIT\b/.test(text) || /\bTERMINATOR\b/.test(text))
                    return 'ACCESSORIES';

                // --- TEXTURE / DIATONE ---
                if (/\bTEXTURE\b/.test(text) || /\bDIATONE\b/.test(text) || /\bSTUCCO\b/.test(text))
                    return 'ASIAN PAINT PRODUCTS';

                // --- WASTE / MISC ---
                if (/\bWASTE\b/.test(text) || /\bCLOTH\b/.test(text) && /\bWASTE\b/.test(text) ||
                    /\bCAP\b/.test(text) && /\bWASTE\b/.test(text))
                    return 'ACCESSORIES';

                // --- Brand-based fallback for remaining items ---
                if (b.includes('OPUS') || /OPUS/.test(text)) return 'BIRLA OPUS PRODUCTS';
                if (b.includes('BERGER') || /BERGER/.test(text)) return 'BERGER PAINT PRODUCTS';
                if (b.includes('ADDISONS') || /ADDISONS/.test(text)) return 'QC ADDISONS PRODUCTS';
                if (b.includes('ASTRAL') || /ASTRAL/.test(text)) return 'GEM ASTRAL PAINTS';
                if (b.includes('MULTI')) return 'QC MULTI BRAND';
                if (/ASIAN|AP\s/.test(text) || /^AP/.test(name)) return 'ASIAN PAINT PRODUCTS';
                if (/NIPPON/.test(text)) return 'ASIAN PAINT PRODUCTS';
                if (/CRIZON|CRIZION/.test(text) || b.includes('CRIZON')) return 'ASIAN PAINT PRODUCTS';
                if (/SHALIMAR/.test(text)) return 'ASIAN PAINT PRODUCTS';

                return null; // Truly unrecognizable
            }

            const allEdits = [];
            let categorized = 0;
            let unchanged = 0;
            let unrecognized = 0;
            const categoryCounts = {};

            for (const item of allCompact) {
                const newCat = categorizePaintItem(item.name, item.desc, item.brand);
                if (!newCat) {
                    unrecognized++;
                    continue;
                }
                // Only include if category actually changed
                if ((item.cat || '').toUpperCase() !== newCat.toUpperCase()) {
                    allEdits.push({ zoho_item_id: item.id, changes: { category_name: newCat } });
                    categorized++;
                    categoryCounts[newCat] = (categoryCounts[newCat] || 0) + 1;
                } else {
                    unchanged++;
                }
            }

            // Build summary of categories assigned
            const topCats = Object.entries(categoryCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 15)
                .map(([cat, cnt]) => `  - ${cat}: ${cnt} items`)
                .join('\n');

            const summary = `Categorized ${categorized} items across ${Object.keys(categoryCounts).length} categories. ${unchanged} already correct, ${unrecognized} unrecognized.`;
            const reply = `**Category Assignment Complete**\n\n` +
                `- **${categorized}** items updated with new categories\n` +
                `- **${unchanged}** items already had correct categories\n` +
                `- **${unrecognized}** items could not be categorized (unrecognized names)\n\n` +
                `**Top categories assigned:**\n${topCats}\n\n` +
                `*Deterministic matching — instant, 100% consistent.*`;

            return res.json({
                success: true,
                edits: allEdits,
                summary,
                reply,
                model: 'deterministic',
                itemsProcessed: allCompact.length,
                batchCount: 1
            });
        }

        // === DETERMINISTIC DESCRIPTION UPDATER ===
        // Detect commands about updating descriptions for known product types.
        // Handles product-specific description generation based on item name patterns.
        const isDescCommand = /\bdescription\b/i.test(command);
        if (isDescCommand) {
            const allEdits = [];
            const productTypes = [];

            // --- Sanding Paper / Abrasive Paper ---
            if (/\bsand(ing)?\s*paper\b/i.test(command) || /\bajax\b/i.test(command) || /\bemery\b/i.test(command) || /\babrasive\b/i.test(command)) {
                productTypes.push('Sanding Paper');
                for (const item of allCompact) {
                    const name = (item.name || '').toUpperCase();
                    // Match: "100 AJAX PAPER", "80 ROLL PAPER AJAX 01 METER", "100 ROLL EMERY PAPER 1 MT"
                    if (/AJAX\s*PAPER/.test(name) || /ROLL\s*PAPER\s*AJAX/.test(name) || /EMERY\s*PAPER/.test(name) || /ROLL\s*EMERY/.test(name)) {
                        const gritMatch = name.match(/^(\d+)\s/);
                        const grit = gritMatch ? gritMatch[1] : '';
                        let newDesc;
                        if (/ROLL/.test(name)) {
                            const meterMatch = name.match(/(\d+)\s*M(T|ETER)?/i);
                            const meter = meterMatch ? meterMatch[1] + ' Meter' : '';
                            newDesc = `Sanding Paper ${grit} Grit Roll${meter ? ' ' + meter : ''}`;
                        } else {
                            newDesc = `Sanding Paper ${grit} Grit Sheet`;
                        }
                        if (newDesc && newDesc !== (item.desc || '')) {
                            allEdits.push({ zoho_item_id: item.id, changes: { description: newDesc } });
                        }
                    }
                }
            }

            // --- Stainer / Colorant ---
            if (/\bstainer\b/i.test(command) || /\bcolourant\b/i.test(command) || /\bcolorant\b/i.test(command)) {
                productTypes.push('Stainer/Colorant');
                for (const item of allCompact) {
                    const name = (item.name || '').toUpperCase();
                    if (/STAINER/.test(name)) {
                        const colorMatch = name.match(/^(BLACK|BLUE|RED|GREEN|YELLOW|BROWN|WHITE|ORANGE|VIOLET|MAROON)\s+STAINER/i);
                        const sizeMatch = name.match(/(\d+)\s*ML/i);
                        if (colorMatch) {
                            const color = colorMatch[1].charAt(0) + colorMatch[1].slice(1).toLowerCase();
                            const size = sizeMatch ? sizeMatch[1] + 'ml' : '';
                            const newDesc = `${color} Liquid Stainer${size ? ' ' + size : ''}`;
                            if (newDesc !== (item.desc || '')) {
                                allEdits.push({ zoho_item_id: item.id, changes: { description: newDesc } });
                            }
                        }
                    }
                }
            }

            // --- Amber / Powder Pigment ---
            if (/\bamber\b/i.test(command) || /\bpigment\b/i.test(command) || /\boxide\b/i.test(command)) {
                productTypes.push('Powder Pigment');
                for (const item of allCompact) {
                    const name = (item.name || '').toUpperCase();
                    if (/^AMBER\s/.test(name)) {
                        const colorMatch = name.match(/AMBER\s+(BLACK|BROWN|RED|YELLOW|GREEN|BLUE|WHITE|ORANGE)/i);
                        const sizeMatch = name.match(/(\d+)\s*G/i);
                        if (colorMatch) {
                            const color = colorMatch[1].charAt(0) + colorMatch[1].slice(1).toLowerCase();
                            const size = sizeMatch ? sizeMatch[1] + 'g' : '';
                            const newDesc = `Amber ${color} Powder Pigment${size ? ' ' + size : ''}`;
                            if (newDesc !== (item.desc || '')) {
                                allEdits.push({ zoho_item_id: item.id, changes: { description: newDesc } });
                            }
                        }
                    }
                }
            }

            if (allEdits.length > 0 || productTypes.length > 0) {
                const summary = `Updated descriptions for ${allEdits.length} ${productTypes.join(', ')} items`;
                const reply = `**Description Update Complete**\n\n` +
                    `Updated **${allEdits.length}** item descriptions for: ${productTypes.join(', ')}\n\n` +
                    allEdits.slice(0, 20).map(e => `- ${e.changes.description}`).join('\n') +
                    (allEdits.length > 20 ? `\n- ...and ${allEdits.length - 20} more` : '') +
                    `\n\n*Deterministic — instant, exact values from item names.*`;

                return res.json({
                    success: true,
                    edits: allEdits,
                    summary,
                    reply,
                    model: 'deterministic',
                    itemsProcessed: allCompact.length,
                    batchCount: 1
                });
            }
        }

        // === AI-BASED PROCESSING (fallback for non-reference-data commands) ===
        // Build context section if reference data provided but not tab-separated
        const contextSection = context ? `\nREFERENCE DATA (Excel/table):\n${context.substring(0, 200000)}\n` : '';

        // Split into batches and process in parallel
        const batches = [];
        for (let i = 0; i < allCompact.length; i += BATCH_SIZE) {
            batches.push(allCompact.slice(i, i + BATCH_SIZE));
        }

        const batchPromises = batches.map((batch, bIdx) => {
            let itemOffset = 0;
            for (let i = 0; i < bIdx; i++) itemOffset += batches[i].length;
            const batchLabel = batches.length > 1
                ? `\nBATCH ${bIdx + 1}/${batches.length} (items ${itemOffset + 1}-${itemOffset + batch.length} of ${allCompact.length})`
                : '';

            const userMessage = `COMMAND: ${command.trim()}${contextSection}${batchLabel}
ITEMS (${batch.length}):
${JSON.stringify(batch)}`;

            const messages = [{ role: 'system', content: systemPrompt }];
            if (Array.isArray(history) && history.length > 0) {
                history.slice(-6).forEach(msg => {
                    if (msg.role === 'user' || msg.role === 'assistant') {
                        messages.push({ role: msg.role, content: msg.content });
                    }
                });
            }
            messages.push({ role: 'user', content: userMessage });

            return aiEngine.generateWithFailover(messages, { max_tokens: 16000, temperature: 0.1 })
                .then(result => ({ bIdx, result }))
                .catch(err => ({ bIdx, error: err.message }));
        });

        const batchResults = await Promise.all(batchPromises);

        // Collect results in order
        const allEdits = [];
        const batchSummaries = [];
        let lastReply = '';
        let lastModel = 'unknown';

        for (const br of batchResults) {
            const batchNum = br.bIdx + 1;
            if (br.error) {
                batchSummaries.push(`Batch ${batchNum}: ${br.error}`);
                continue;
            }
            if (!br.result || !br.result.text) {
                batchSummaries.push(`Batch ${batchNum}: empty response`);
                continue;
            }

            lastModel = br.result.model || 'unknown';

            let responseText = br.result.text.trim();
            if (responseText.startsWith('```')) {
                responseText = responseText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
            }

            let parsed;
            try {
                parsed = JSON.parse(responseText);
            } catch (parseErr) {
                const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    try { parsed = JSON.parse(jsonMatch[0]); } catch { parsed = null; }
                }
            }

            if (parsed && Array.isArray(parsed.edits)) {
                const mappedBatchEdits = parsed.edits.map(e => {
                    const changes = {};
                    for (const [k, v] of Object.entries(e.changes || {})) {
                        changes[fieldMap[k] || k] = v;
                    }
                    return { zoho_item_id: e.id, changes };
                });
                allEdits.push(...mappedBatchEdits);
                batchSummaries.push(parsed.summary || `Batch ${batchNum}: ${mappedBatchEdits.length} edits`);
                lastReply = parsed.reply || parsed.summary || '';
            } else {
                batchSummaries.push(`Batch ${batchNum}: failed to parse response`);
            }
        }

        // Build combined response
        const summary = batches.length > 1
            ? `Updated ${allEdits.length} items across ${batches.length} batches (${allCompact.length} total processed)`
            : (batchSummaries[0] || `Processed ${allEdits.length} items`);
        const reply = batches.length > 1
            ? `${lastReply}\n\n**Batch processing complete**: ${allEdits.length} items updated across ${batches.length} batches (${allCompact.length} items scanned).`
            : (lastReply || summary);

        res.json({
            success: true,
            edits: allEdits,
            summary,
            reply,
            model: lastModel,
            itemsProcessed: allCompact.length,
            batchCount: batches.length,
            batchSummaries: batches.length > 1 ? batchSummaries : undefined
        });

    } catch (error) {
        console.error('AI items edit error:', error);
        res.status(500).json({ success: false, message: 'AI processing failed: ' + error.message });
    }
});

/**
 * POST /api/zoho/items/bulk-update - Create bulk update job
 */
router.post('/items/bulk-update', requirePermission('zoho', 'bulk_update'), async (req, res) => {
    try {
        const { filter, update_fields } = req.body;
        if (!filter || !update_fields) {
            return res.status(400).json({ success: false, message: 'filter and update_fields required' });
        }

        const result = await zohoAPI.createBulkUpdateJob(filter, update_fields, req.user.id);
        res.json({ success: true, data: result, message: `Bulk job created with ${result.total_items} items` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Shared core of the per-item bulk edit: validates, enforces SKU uniqueness
// (batch + local-mirror cross-check), creates the bulk job + job items, and
// optimistically updates the local zoho_items_map (SKU excluded — written only
// after Zoho confirms, in the bulk-job worker). Throws an Error tagged with
// { httpStatus, code, payload } for the caller to translate to a response.
async function createBulkEditJob(items, user) {
    if (!items || !Array.isArray(items) || items.length === 0) {
        throw Object.assign(new Error('items array is required'), { httpStatus: 400 });
    }
    for (const item of items) {
        if (!item.zoho_item_id || !item.changes || Object.keys(item.changes).length === 0) {
            throw Object.assign(new Error('Each item must have zoho_item_id and non-empty changes'), { httpStatus: 400 });
        }
    }

    // Reject batches that would push the same SKU to multiple distinct
    // Zoho items — Zoho enforces SKU uniqueness, so the first item wins
    // and the rest fail with "error 1001: SKU already exists", and the
    // partial failure leaves the local mirror in a corrupted state.
    //
    // We also reject when a SKU in the batch is already held by a
    // DIFFERENT active item in our local mirror (the classic
    // OPCL01-WHITE vs OPCL01-ORANGE situation): the only thing that
    // would happen on Zoho is a rejection anyway, and we'd rather the
    // user fix it now than discover it 6 minutes into a 200-item job.
    {
        const skuToItems = new Map();
        for (const it of items) {
            const sku = it.changes && it.changes.sku ? String(it.changes.sku).trim() : '';
            if (!sku) continue;
            const key = sku.toUpperCase();
            if (!skuToItems.has(key)) skuToItems.set(key, []);
            skuToItems.get(key).push({ zoho_item_id: it.zoho_item_id, item_name: it.item_name || '', sku });
        }
        const batchDupes = [];
        for (const [_, list] of skuToItems) { if (list.length > 1) batchDupes.push(list); }
        if (batchDupes.length) {
            throw Object.assign(new Error('Batch contains multiple items being pushed with the same SKU. Zoho enforces SKU uniqueness, so this would fail. Edit the SKUs to make them unique.'),
                { httpStatus: 400, code: 'DUPLICATE_SKUS_IN_BATCH', payload: { duplicates: batchDupes } });
        }
        // Cross-check against the local mirror for SKUs already held by
        // ANOTHER active item that is NOT in this batch.
        const skuList = Array.from(skuToItems.keys());
        if (skuList.length) {
            const [held] = await pool.query(
                `SELECT zoho_item_id, zoho_sku, zoho_item_name
                   FROM zoho_items_map
                  WHERE zoho_status = 'active'
                    AND UPPER(zoho_sku) IN (${skuList.map(() => '?').join(',')})`,
                skuList
            );
            const conflicts = [];
            for (const row of held) {
                const rowSku = String(row.zoho_sku || '').toUpperCase();
                const batchEntries = skuToItems.get(rowSku) || [];
                for (const be of batchEntries) {
                    if (be.zoho_item_id !== row.zoho_item_id) {
                        conflicts.push({
                            batch_item: be,
                            already_held_by: { zoho_item_id: row.zoho_item_id, item_name: row.zoho_item_name }
                        });
                    }
                }
            }
            if (conflicts.length) {
                throw Object.assign(new Error('One or more SKUs in the batch are already held by a different active item in Zoho. Push would fail with "SKU already exists". Edit to use unique SKUs.'),
                    { httpStatus: 400, code: 'SKU_HELD_BY_OTHER_ITEM', payload: { conflicts } });
            }
        }
    }

    // Create bulk job
    const [jobResult] = await pool.query(`
        INSERT INTO zoho_bulk_jobs (job_type, filter_criteria, update_fields, total_items, created_by)
        VALUES ('item_update', ?, ?, ?, ?)
    `, [
        JSON.stringify({ mode: 'per_item_edit', item_count: items.length }),
        JSON.stringify({ mode: 'per_item' }),
        items.length,
        user.id
    ]);
    const jobId = jobResult.insertId;

    // Create individual job items with per-item payloads
    // If item_name is missing, look it up from zoho_items_map
    const itemsWithoutName = items.filter(i => !i.item_name);
    const nameLookup = {};
    if (itemsWithoutName.length > 0) {
        const ids = itemsWithoutName.map(i => i.zoho_item_id);
        const [nameRows] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name FROM zoho_items_map WHERE zoho_item_id IN (${ids.map(() => '?').join(',')})`,
            ids
        );
        nameRows.forEach(r => { nameLookup[r.zoho_item_id] = r.zoho_item_name; });
    }

    for (const item of items) {
        const itemName = item.item_name || nameLookup[item.zoho_item_id] || '';
        await pool.query(`
            INSERT INTO zoho_bulk_job_items (job_id, zoho_item_id, item_name, payload)
            VALUES (?, ?, ?, ?)
        `, [jobId, item.zoho_item_id, itemName, JSON.stringify(item.changes)]);
    }

    // Also update local zoho_items_map so edits persist before Zoho sync.
    // NOTE: `sku` is deliberately excluded here — Zoho enforces SKU
    // uniqueness, so an optimistic local SKU write can leave us with two
    // active items sharing the same SKU when Zoho rejects the second push
    // ("error 1001: SKU already exists"). On the next admin-dpl run, the
    // proposer reads the corrupted SKU and proposes another colliding
    // push. The SKU write now lives in services/zoho-api.js inside the
    // bulk-job worker, fired only after Zoho confirms the row.
    const FIELD_MAP = {
        name: 'zoho_item_name', /* sku intentionally NOT here — see comment above */
        rate: 'zoho_rate',
        purchase_rate: 'zoho_purchase_rate', cf_dpl: 'zoho_cf_dpl',
        label_rate: 'zoho_label_rate',
        unit: 'zoho_unit', hsn_or_sac: 'zoho_hsn_or_sac',
        tax_percentage: 'zoho_tax_percentage', brand: 'zoho_brand',
        category_name: 'zoho_category_name', category: 'zoho_category_name',
        manufacturer: 'zoho_manufacturer',
        reorder_level: 'zoho_reorder_level', description: 'zoho_description',
        cf_product_name: 'zoho_cf_product_name', status: 'zoho_status'
    };
    for (const item of items) {
        const sets = [];
        const vals = [];
        for (const [key, val] of Object.entries(item.changes)) {
            const dbCol = FIELD_MAP[key];
            if (dbCol) {
                sets.push(`${dbCol} = ?`);
                vals.push(val);
            }
        }
        if (Object.prototype.hasOwnProperty.call(item.changes, 'cf_dpl')) {
            sets.push('dpl_updated_at = NOW()');
        }
        if (sets.length > 0) {
            vals.push(item.zoho_item_id);
            await pool.query(`UPDATE zoho_items_map SET ${sets.join(', ')} WHERE zoho_item_id = ?`, vals);
        }
        // Sync rate change → pack_sizes.base_price so admin-products.html stays in sync
        if (Object.prototype.hasOwnProperty.call(item.changes, 'rate')) {
            await pool.query(
                'UPDATE pack_sizes SET base_price = ? WHERE zoho_item_id = ? AND is_active = 1',
                [item.changes.rate, item.zoho_item_id]
            );
        }
    }

    return { job_id: jobId, total_items: items.length };
}

/**
 * POST /api/zoho/items/bulk-edit - Create bulk job with per-item unique payloads
 * Unlike bulk-update (same fields for all items), this accepts individual changes per item.
 */
router.post('/items/bulk-edit', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const result = await createBulkEditJob(req.body.items, req.user);
        res.json({ success: true, data: result, message: `Bulk edit job created with ${result.total_items} items` });
    } catch (error) {
        const status = error.httpStatus || 500;
        res.status(status).json(Object.assign({ success: false, message: error.message }, error.code ? { code: error.code } : {}, error.payload || {}));
    }
});

/**
 * GET /api/zoho/items/bulk-jobs - List bulk jobs
 * NOTE: Must be defined BEFORE /items/:id to avoid :id catching "bulk-jobs"
 */
router.get('/items/bulk-jobs', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const safeLimit = Math.min(parseInt(limit) || 20, 500);

        let where = 'WHERE 1=1';
        const params = [];

        if (status) { where += ' AND bj.status = ?'; params.push(status); }

        const offset = (Math.max(1, parseInt(page)) - 1) * safeLimit;

        const [jobs] = await pool.query(`
            SELECT bj.*, u.full_name as created_by_name
            FROM zoho_bulk_jobs bj
            LEFT JOIN users u ON bj.created_by = u.id
            ${where}
            ORDER BY bj.created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, safeLimit, offset]);

        res.json({ success: true, data: jobs });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/items/bulk-jobs/:id - Job detail with item-level status
 */
router.get('/items/bulk-jobs/:id', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const [jobs] = await pool.query(`
            SELECT bj.*, u.full_name as created_by_name
            FROM zoho_bulk_jobs bj
            LEFT JOIN users u ON bj.created_by = u.id
            WHERE bj.id = ? LIMIT 1
        `, [req.params.id]);

        if (jobs.length === 0) {
            return res.status(404).json({ success: false, message: 'Job not found' });
        }

        const { page = 1, limit = 50, item_status } = req.query;
        const safeLimit = Math.min(parseInt(limit) || 50, 500);
        let itemWhere = 'WHERE bji.job_id = ?';
        const itemParams = [req.params.id];

        if (item_status) { itemWhere += ' AND bji.status = ?'; itemParams.push(item_status); }

        const offset = (Math.max(1, parseInt(page)) - 1) * safeLimit;

        const [items] = await pool.query(`
            SELECT bji.* FROM zoho_bulk_job_items bji
            ${itemWhere}
            ORDER BY bji.id
            LIMIT ? OFFSET ?
        `, [...itemParams, safeLimit, offset]);

        res.json({ success: true, data: { job: jobs[0], items } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/items/bulk-jobs/:id/cancel - Cancel job
 */
router.post('/items/bulk-jobs/:id/cancel', requirePermission('zoho', 'bulk_update'), async (req, res) => {
    try {
        const result = await zohoAPI.cancelBulkJob(parseInt(req.params.id));
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/items/bulk-jobs/:id/retry - Retry failed items
 */
router.post('/items/bulk-jobs/:id/retry', requirePermission('zoho', 'bulk_update'), async (req, res) => {
    try {
        const result = await zohoAPI.retryBulkJob(parseInt(req.params.id));
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/items/:id - Single item detail (fresh from Zoho)
 * NOTE: Must be AFTER all /items/bulk-* routes to avoid catching those paths
 */
router.get('/items/:id', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        // Rate limiting handled centrally in apiGet; pass priority for reserve access
        const zohoData = await zohoAPI.getItem(req.params.id, { caller: 'getItemDetail', priority: 'high' });
        res.json({ success: true, data: zohoData.item || zohoData });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});


/**
 * POST /api/zoho/items/parse-price-list - Parse a brand dealer price list PDF
 * Returns extracted items with product name, pack size, and DPL
 * Optionally matches against existing Zoho items
 */
const { uploadPriceList, uploadPriceCsv } = require('../../config/uploads');
const priceListParser = require('../../services/price-list-parser');
const http = require('http');

router.post('/items/parse-price-list', requirePermission('zoho', 'manage'), uploadPriceList.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'PDF file is required' });
        }

        const result = await priceListParser.parsePriceList(req.file.buffer, req.file.originalname);

        // If requested, match against existing Zoho items
        if (req.body.match !== 'false') {
            const [zohoItems] = await pool.query(
                `SELECT zoho_item_id, zoho_item_name AS name, zoho_sku AS sku, zoho_rate AS rate,
                        zoho_cf_dpl AS cf_dpl, zoho_unit AS unit, zoho_brand AS brand,
                        zoho_category_name AS category, zoho_description AS description
                 FROM zoho_items_map WHERE zoho_status = 'active'`
            );
            const matchResult = priceListParser.matchWithZohoItems(result.items, zohoItems);
            result.matched = matchResult.matched;
            result.unmatched = matchResult.unmatched;
            result.matchedCount = matchResult.matched.length;
            result.unmatchedCount = matchResult.unmatched.length;
        }

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Price list parse error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/items/apply-price-list - Apply parsed price list DPL values to items
 * Accepts array of { zoho_item_id, cf_dpl } to update in zoho_items_map
 */
/**
 * GET /api/zoho/items/normalize-scan?brand=X
 * Scan all items of a brand, infer canonical SKU prefix from name, return proposed renames.
 */
router.get('/items/normalize/scan', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = req.query.brand;
        const category = (req.query.category || '').trim();          // optional filter
        const hasBases = req.query.hasBases === '1' || req.query.hasBases === 'true';
        if (!brand) return res.status(400).json({ success: false, message: 'brand query param is required' });

        const whereParts = [`zoho_status = 'active'`, `zoho_brand = ?`];
        const params = [brand];
        if (category) { whereParts.push('zoho_category_name = ?'); params.push(category); }

        const [rows] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name AS name, zoho_sku AS sku, zoho_brand AS brand,
                    zoho_unit AS unit, zoho_category_name AS category, zoho_cf_product_name AS cf_product_name
             FROM zoho_items_map
             WHERE ${whereParts.join(' AND ')}
             ORDER BY zoho_item_name ASC`,
            params
        );

        const summary = { conformant: 0, needs_rename: 0, cannot_parse: 0 };
        const results = [];

        for (const row of rows) {
            const rawName = String(row.name || '').trim();
            const nameUp = rawName.toUpperCase();
            const skuUp = String(row.sku || '').toUpperCase().trim();
            const brandUp = String(row.brand || '').toUpperCase().trim();

            // 1. What the user sees as prefix: first token of the NAME
            const firstToken = nameUp.split(/\s+/)[0] || '';
            const currentNamePrefix = /^[A-Z0-9]{2,8}$/.test(firstToken) ? firstToken : null;

            // 2. Pack code from trailing pack-size in the name
            let inferPack = null;
            const packMatch = nameUp.match(/\b(\d{1,3}(?:\.\d+)?)\s*(ML|L|LT|LTR|LITRE|LITER|KG|GM?)\s*$/i);
            if (packMatch) {
                inferPack = priceListParser.packSizeToCode(packMatch[1] + packMatch[2]);
            }

            // 3. Base detection — only when hasBases=true (emulsion)
            let inferBase = null;
            if (hasBases) {
                const bMatch = nameUp.match(/\bBASE\s*([1-9])\b|\bB([1-9])\b/);
                if (bMatch) inferBase = bMatch[1] || bMatch[2];
                else if (/\bWHITE\b|\bSUPER\s*WHITE\b|\bDEEP\s*WHITE\b/.test(nameUp)) inferBase = 'W';
            }

            // 4. Derive PRODUCT PREFIX.
            //    The SKU is the source of truth when it matches pattern [A-Z]{2,5}\d{2,6}
            //    (e.g., "CF1301" = CF + base13 + pack01 → full prefix is just "CF1301").
            //    For items with partial SKU we fall back to building abbrev+base+pack.
            let productAbbrev = null;
            let skuDerivedPrefix = null;

            // Match full SKU pattern: letters + digits (digits = base + pack combined)
            const skuFullMatch = skuUp.match(/^([A-Z]{2,5})(\d{2,6})$/);
            if (skuFullMatch) {
                productAbbrev = skuFullMatch[1];
                skuDerivedPrefix = skuUp; // entire SKU becomes the prefix
            } else {
                // Fallback: just take leading letters
                const skuLetters = skuUp.match(/^([A-Z]{2,5})/);
                if (skuLetters) productAbbrev = skuLetters[1];
                if (!productAbbrev) {
                    const nameLetters = firstToken.match(/^([A-Z]{2,5})/);
                    if (nameLetters) productAbbrev = nameLetters[1];
                }
            }

            // Strip noise to isolate the product-name words in the middle
            const brandTokens = new Set(brandUp.split(/\s+/).filter(w => w && w.length >= 2));
            const unitWords = new Set(['L', 'LT', 'LTR', 'ML', 'KG', 'G', 'GM', 'LITRE', 'LITER']);
            let middle = rawName;

            // Strip ALL leading prefix-like tokens (anything with digits) so we strip
            // both "OP01" AND "CF13" from "OP01 CF13 STYLE COLOR FRESH OPUS 01 L"
            const midParts = middle.split(/\s+/);
            while (midParts.length > 0 && /\d/.test(midParts[0]) && midParts[0].length <= 8) {
                midParts.shift();
            }
            middle = midParts.join(' ');

            // Drop trailing pack size
            middle = middle.replace(/\s*\b\d{1,3}(?:\.\d+)?\s*(ML|L|LT|LTR|LITRE|LITER|KG|GM?)\s*$/i, '');
            // Drop base markers when applicable
            if (hasBases) {
                middle = middle.replace(/\bBASE\s*[1-9][0-9]?\b/gi, '');
                middle = middle.replace(/\bB[1-9][0-9]?\b/gi, '');
                middle = middle.replace(/\b(?:SUPER\s*|DEEP\s*)?WHITE\b/gi, '');
            }
            // Drop brand tokens from the middle (incl. partial/short forms like "OPUS" from "BIRLA OPUS")
            for (const bt of brandTokens) {
                middle = middle.replace(new RegExp('\\b' + bt + '\\b', 'gi'), '');
            }
            // Also strip common brand short-forms
            const shortBrands = ['OPUS', 'BIRLA'];
            for (const sb of shortBrands) {
                if (brandUp.includes(sb)) {
                    middle = middle.replace(new RegExp('\\b' + sb + '\\b', 'gi'), '');
                }
            }
            // Drop unit words
            for (const uw of unitWords) {
                middle = middle.replace(new RegExp('\\b' + uw + '\\b', 'gi'), '');
            }
            middle = middle.replace(/\s+/g, ' ').trim();

            // Fallback abbrev from middle words
            if (!productAbbrev && middle) {
                const words = middle.toUpperCase()
                    .replace(/[^A-Z ]/g, ' ')
                    .split(/\s+/)
                    .filter(w => w && w.length >= 2);
                if (words.length >= 1) {
                    productAbbrev = words.slice(0, Math.min(3, words.length))
                        .map(w => w[0]).join('');
                }
            }

            // 5. Build proposed prefix + full name + SKU
            //    Emulsion (has bases):  name = [SKU/product-prefix]    [product words] [BRAND] [PACK]
            //    Non-emulsion:          name = [category-code-prefix]  [product words] [BRAND] [PACK]
            //                           SKU  = product-based (keeps uniqueness per product)
            let status = 'cannot_parse';
            let proposedPrefix = null;
            let proposedName = null;
            let proposedSku = null;

            const displayPack = (packMatch ? packMatch[1] + ' ' + packMatch[2].toUpperCase() : '').trim();

            if (hasBases) {
                // Emulsion path: SKU-based prefix drives the NAME and the SKU.
                const emulsionPrefix = skuDerivedPrefix
                    || (productAbbrev && inferPack
                        ? productAbbrev + (inferBase === 'W' ? '0' : (inferBase || '')) + inferPack
                        : null);
                if (emulsionPrefix) {
                    proposedPrefix = emulsionPrefix;
                    proposedSku = emulsionPrefix;
                    const parts = [proposedPrefix, (middle || '').toUpperCase(), brandUp, displayPack]
                        .filter(Boolean).map(s => s.trim()).filter(Boolean);
                    proposedName = parts.join(' ').replace(/\s+/g, ' ').trim();
                    status = (nameUp === proposedName.toUpperCase() && skuUp === proposedSku)
                        ? 'conformant' : 'needs_rename';
                    if (status === 'conformant') { proposedName = null; proposedSku = null; }
                }
            } else {
                // Non-emulsion path: keep the CATEGORY CODE (currentNamePrefix) at the start of NAME.
                //                    SKU stays product-based (current SKU if well-formed, else abbrev+pack).
                if (currentNamePrefix) {
                    proposedPrefix = currentNamePrefix;

                    // Product-based SKU (unique per product, not per category)
                    proposedSku = skuDerivedPrefix
                        || (productAbbrev && inferPack ? productAbbrev + inferPack : null)
                        || skuUp
                        || null;

                    // Build middle by KEEPING category prefix and stripping only pack + brand + unit words
                    // (we do NOT strip further digit-prefixes because the middle may include a product code).
                    let middle2 = rawName.substring(currentNamePrefix.length).trim();
                    middle2 = middle2.replace(/\s*\b\d{1,3}(?:\.\d+)?\s*(ML|L|LT|LTR|LITRE|LITER|KG|GM?)\s*$/i, '');
                    for (const bt of brandTokens) {
                        middle2 = middle2.replace(new RegExp('\\b' + bt + '\\b', 'gi'), '');
                    }
                    for (const sb of shortBrands) {
                        if (brandUp.includes(sb)) middle2 = middle2.replace(new RegExp('\\b' + sb + '\\b', 'gi'), '');
                    }
                    for (const uw of unitWords) {
                        middle2 = middle2.replace(new RegExp('\\b' + uw + '\\b', 'gi'), '');
                    }
                    middle2 = middle2.replace(/\s+/g, ' ').trim();

                    const parts = [proposedPrefix, middle2.toUpperCase(), brandUp, displayPack]
                        .filter(Boolean).map(s => s.trim()).filter(Boolean);
                    proposedName = parts.join(' ').replace(/\s+/g, ' ').trim();

                    status = (nameUp === proposedName.toUpperCase() && (!proposedSku || skuUp === proposedSku))
                        ? 'conformant' : 'needs_rename';
                    if (status === 'conformant') { proposedName = null; proposedSku = null; }
                }
            }

            summary[status]++;
            results.push({
                zoho_item_id: row.zoho_item_id,
                current_name: row.name,
                current_sku: row.sku,
                current_category: row.category,
                current_name_prefix: currentNamePrefix,
                current_sku_value: row.sku || null,
                product_abbrev: productAbbrev,
                middle_name: middle || null,
                inferred_base: inferBase,
                inferred_pack: inferPack,
                proposed_prefix: proposedPrefix,
                proposed_name: proposedName,
                proposed_sku: proposedSku,
                status
            });
        }

        res.json({
            success: true,
            brand,
            category: category || null,
            has_bases: hasBases,
            total: rows.length,
            summary,
            items: results
        });
    } catch (error) {
        console.error('Normalize scan error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/items/filter-options
 * Returns all distinct brands + categories for dropdown filters on the items-edit page.
 */
router.get('/items/filters/list', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const [brands] = await pool.query(`
            SELECT DISTINCT zoho_brand AS name, COUNT(*) AS n FROM zoho_items_map
            WHERE zoho_status = 'active' AND zoho_brand IS NOT NULL AND zoho_brand <> ''
            GROUP BY zoho_brand ORDER BY zoho_brand
        `);
        const [categories] = await pool.query(`
            SELECT DISTINCT zoho_category_name AS name, COUNT(*) AS n FROM zoho_items_map
            WHERE zoho_status = 'active' AND zoho_category_name IS NOT NULL AND zoho_category_name <> ''
            GROUP BY zoho_category_name ORDER BY zoho_category_name
        `);
        const [brandCatRows] = await pool.query(`
            SELECT DISTINCT zoho_brand AS brand, zoho_category_name AS category FROM zoho_items_map
            WHERE zoho_status = 'active'
              AND zoho_brand IS NOT NULL AND zoho_brand <> ''
              AND zoho_category_name IS NOT NULL AND zoho_category_name <> ''
            ORDER BY zoho_brand, zoho_category_name
        `);
        const brandCategories = {};
        for (const row of brandCatRows) {
            if (!brandCategories[row.brand]) brandCategories[row.brand] = [];
            brandCategories[row.brand].push(row.category);
        }
        res.json({
            success: true,
            brands: brands.map(b => ({ name: b.name, count: b.n })),
            categories: categories.map(c => ({ name: c.name, count: c.n })),
            brandCategories
        });
    } catch (error) {
        console.error('Filter options error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/items/reassign/scan
 * Query params: nameContains, currentBrand, currentCategory (any combo; all optional)
 * Returns items matching the criteria so admin can bulk-fix their brand/category.
 */
router.get('/items/reassign/scan', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const nameContains = (req.query.nameContains || '').trim();
        const currentBrand = (req.query.currentBrand || '').trim();
        const currentCategory = (req.query.currentCategory || '').trim();

        if (!nameContains && !currentBrand && !currentCategory) {
            return res.status(400).json({ success: false, message: 'Provide at least one filter (nameContains / currentBrand / currentCategory)' });
        }

        const whereParts = [`zoho_status = 'active'`];
        const params = [];
        if (nameContains) {
            whereParts.push('(zoho_item_name LIKE ? OR zoho_sku LIKE ?)');
            params.push('%' + nameContains + '%', '%' + nameContains + '%');
        }
        if (currentBrand === '__no_brand__') {
            // Sentinel: match items whose brand is NULL, empty, or whitespace-only.
            // Used by the "(no brand assigned)" option in the Fix Brand modal.
            whereParts.push("(zoho_brand IS NULL OR TRIM(zoho_brand) = '')");
        } else if (currentBrand) {
            whereParts.push('zoho_brand = ?');
            params.push(currentBrand);
        }
        if (currentCategory === '__no_category__') {
            // Sentinel: match items whose category is NULL, empty, or whitespace-only.
            // Used by the "(no category assigned)" option in the Fix Brand modal.
            whereParts.push("(zoho_category_name IS NULL OR TRIM(zoho_category_name) = '')");
        } else if (currentCategory) {
            whereParts.push('zoho_category_name = ?');
            params.push(currentCategory);
        }

        const [rows] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name AS name, zoho_sku AS sku,
                    zoho_brand AS brand, zoho_category_name AS category
             FROM zoho_items_map
             WHERE ${whereParts.join(' AND ')}
             ORDER BY zoho_item_name ASC
             LIMIT 2000`,
            params
        );

        // Also return distinct brands + categories for the dropdowns
        const [brands] = await pool.query(`
            SELECT DISTINCT zoho_brand AS name FROM zoho_items_map
            WHERE zoho_status = 'active' AND zoho_brand IS NOT NULL AND zoho_brand <> ''
            ORDER BY zoho_brand
        `);
        const [categories] = await pool.query(`
            SELECT DISTINCT zoho_category_name AS name FROM zoho_items_map
            WHERE zoho_status = 'active' AND zoho_category_name IS NOT NULL AND zoho_category_name <> ''
            ORDER BY zoho_category_name
        `);

        res.json({
            success: true,
            total: rows.length,
            items: rows,
            brands: brands.map(b => b.name),
            categories: categories.map(c => c.name)
        });
    } catch (error) {
        console.error('Reassign scan error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/items/reassign/apply
 * Body: { items: [{ zoho_item_id, new_brand?, new_category? }, ...] }
 * Creates a bulk job to push brand + category changes to Zoho, updates local DB immediately.
 */
router.post('/items/reassign/apply', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const { items } = req.body;
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'items array required' });
        }
        for (const it of items) {
            if (!it.zoho_item_id) return res.status(400).json({ success: false, message: 'Each item must have zoho_item_id' });
            if (!it.new_brand && !it.new_category) {
                return res.status(400).json({ success: false, message: 'Each item must set new_brand or new_category' });
            }
        }

        const [jobResult] = await pool.query(`
            INSERT INTO zoho_bulk_jobs (job_type, filter_criteria, update_fields, total_items, created_by)
            VALUES ('item_update', ?, ?, ?, ?)
        `, [
            JSON.stringify({ mode: 'brand_category_reassign', item_count: items.length }),
            JSON.stringify({ mode: 'per_item', source: 'reassign' }),
            items.length,
            req.user.id
        ]);
        const jobId = jobResult.insertId;

        // Look up current item names for the bulk_job_items display field
        const ids = items.map(i => i.zoho_item_id);
        const [nameRows] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name FROM zoho_items_map WHERE zoho_item_id IN (${ids.map(() => '?').join(',')})`,
            ids
        );
        const nameLookup = {};
        nameRows.forEach(r => { nameLookup[r.zoho_item_id] = r.zoho_item_name; });

        for (const it of items) {
            const payload = {};
            if (it.new_brand) payload.brand = it.new_brand;
            if (it.new_category) payload.category_name = it.new_category;
            await pool.query(`
                INSERT INTO zoho_bulk_job_items (job_id, zoho_item_id, item_name, payload)
                VALUES (?, ?, ?, ?)
            `, [jobId, it.zoho_item_id, nameLookup[it.zoho_item_id] || '', JSON.stringify(payload)]);

            // Update local DB immediately
            const sets = [];
            const vals = [];
            if (it.new_brand) { sets.push('zoho_brand = ?'); vals.push(it.new_brand); }
            if (it.new_category) { sets.push('zoho_category_name = ?'); vals.push(it.new_category); }
            vals.push(it.zoho_item_id);
            await pool.query(`UPDATE zoho_items_map SET ${sets.join(', ')} WHERE zoho_item_id = ?`, vals);
        }

        res.json({
            success: true,
            data: { job_id: jobId, total_items: items.length },
            message: `Bulk reassign job #${jobId} created with ${items.length} items`
        });
    } catch (error) {
        console.error('Reassign apply error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/items/normalize/meta?brand=X
 * Returns distinct categories for the brand (for the category dropdown).
 */
router.get('/items/normalize/meta', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = req.query.brand;
        if (!brand) return res.status(400).json({ success: false, message: 'brand param required' });
        const [rows] = await pool.query(
            `SELECT zoho_category_name AS category, COUNT(*) AS item_count
             FROM zoho_items_map
             WHERE zoho_status = 'active' AND zoho_brand = ? AND zoho_category_name IS NOT NULL AND zoho_category_name <> ''
             GROUP BY zoho_category_name
             ORDER BY zoho_category_name ASC`,
            [brand]
        );
        // Read saved category codes from ai_config if present
        let saved = {};
        try {
            const [[cfg]] = await pool.query(
                "SELECT config_value FROM ai_config WHERE config_key = 'item_normalize_category_codes'"
            );
            if (cfg?.config_value) saved = JSON.parse(cfg.config_value) || {};
        } catch (_) { /* ignore */ }
        res.json({
            success: true,
            brand,
            categories: rows.map(r => ({
                name: r.category,
                count: r.item_count,
                saved_code: (saved[r.category] && saved[r.category].code) || null,
                saved_has_bases: !!(saved[r.category] && saved[r.category].has_bases)
            }))
        });
    } catch (error) {
        console.error('Normalize meta error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/items/normalize/remember
 * Body: { category, code, has_bases }
 * Persists the chosen code so it's pre-filled next time.
 */
router.post('/items/normalize/remember', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const { category, code, has_bases } = req.body;
        if (!category || !code) return res.status(400).json({ success: false, message: 'category + code required' });
        let saved = {};
        const [[cfg]] = await pool.query(
            "SELECT config_value FROM ai_config WHERE config_key = 'item_normalize_category_codes'"
        );
        if (cfg?.config_value) { try { saved = JSON.parse(cfg.config_value) || {}; } catch (_) { saved = {}; } }
        saved[category] = { code: String(code).toUpperCase(), has_bases: !!has_bases };
        await pool.query(
            `INSERT INTO ai_config (config_key, config_value)
             VALUES ('item_normalize_category_codes', ?)
             ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
            [JSON.stringify(saved)]
        );
        res.json({ success: true, message: 'Saved' });
    } catch (error) {
        console.error('Normalize remember error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/items/normalize-apply
 * Body: { items: [{ zoho_item_id, new_name, new_sku? }, ...] }
 * Updates DB and pushes to Zoho.
 */
router.post('/items/normalize/apply', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const { items } = req.body;
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'items array required' });
        }
        // Validate shape
        for (const it of items) {
            if (!it.zoho_item_id || !it.new_name) {
                return res.status(400).json({ success: false, message: 'Each item must have zoho_item_id and new_name' });
            }
        }

        // Create bulk job so user can track at /admin-zoho-bulk-jobs.html
        const [jobResult] = await pool.query(`
            INSERT INTO zoho_bulk_jobs (job_type, filter_criteria, update_fields, total_items, created_by)
            VALUES ('item_update', ?, ?, ?, ?)
        `, [
            JSON.stringify({ mode: 'normalize_names', item_count: items.length }),
            JSON.stringify({ mode: 'per_item', source: 'normalize' }),
            items.length,
            req.user.id
        ]);
        const jobId = jobResult.insertId;

        // Queue per-item payloads
        for (const it of items) {
            const payload = { name: it.new_name };
            if (it.new_sku) payload.sku = it.new_sku;
            await pool.query(`
                INSERT INTO zoho_bulk_job_items (job_id, zoho_item_id, item_name, payload)
                VALUES (?, ?, ?, ?)
            `, [jobId, it.zoho_item_id, it.new_name, JSON.stringify(payload)]);
        }

        // Update local zoho_items_map immediately so the UI reflects changes
        // while the background worker pushes to Zoho.
        for (const it of items) {
            if (it.new_sku) {
                await pool.query(
                    `UPDATE zoho_items_map SET zoho_item_name = ?, zoho_sku = ? WHERE zoho_item_id = ?`,
                    [it.new_name, it.new_sku, it.zoho_item_id]
                );
            } else {
                await pool.query(
                    `UPDATE zoho_items_map SET zoho_item_name = ? WHERE zoho_item_id = ?`,
                    [it.new_name, it.zoho_item_id]
                );
            }
        }

        res.json({
            success: true,
            data: { job_id: jobId, total_items: items.length },
            message: `Bulk rename job #${jobId} created with ${items.length} items — track progress on the Bulk Jobs page`
        });
    } catch (error) {
        console.error('Normalize apply error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/items/apply-price-list', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const { items } = req.body;
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'items array required' });
        }

        let updated = 0;
        for (const item of items) {
            if (!item.zoho_item_id) continue;
            const sets = ['dpl_updated_at = NOW()'];
            const vals = [];
            if (item.cf_dpl != null)    { sets.push('zoho_cf_dpl = ?');      vals.push(item.cf_dpl); }
            if (item.name)              { sets.push('zoho_item_name = ?');    vals.push(item.name); }
            if (item.sku)               { sets.push('zoho_sku = ?');          vals.push(item.sku); }
            if (item.description != null){ sets.push('zoho_description = ?'); vals.push(item.description); }
            if (item.rate != null)      { sets.push('zoho_rate = ?');         vals.push(item.rate); }
            vals.push(item.zoho_item_id);
            const [result] = await pool.query(
                `UPDATE zoho_items_map SET ${sets.join(', ')} WHERE zoho_item_id = ?`, vals
            );
            if (result.affectedRows > 0) updated++;
        }

        res.json({
            success: true,
            data: { updated, total: items.length },
            message: `Updated ${updated} of ${items.length} items`
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/dpl-match-report', requireAuth, async (req, res) => {
    try {
        const [zohoItems] = await pool.query(
            "SELECT zoho_item_id, zoho_item_name, zoho_sku, zoho_rate, zoho_cf_dpl, " +
            "zoho_purchase_rate, zoho_brand, zoho_category_name, zoho_cf_product_name " +
            "FROM zoho_items_map WHERE zoho_brand IN ('BIRLA OPUS', 'BERGER PAINTS') " +
            "AND zoho_status = 'active' ORDER BY zoho_brand, zoho_item_name"
        );
        const [mappedPacks] = await pool.query(
            "SELECT ps.zoho_item_id, ps.product_id, p.name as product_name " +
            "FROM pack_sizes ps JOIN products p ON p.id = ps.product_id " +
            "WHERE ps.zoho_item_id IS NOT NULL AND ps.zoho_item_id != '' AND ps.is_active = 1"
        );
        const lookup = {};
        for (const mp of mappedPacks) lookup[mp.zoho_item_id] = { product_id: mp.product_id, product_name: mp.product_name };
        const items = [];
        const summary = {};
        for (const zi of zohoItems) {
            const brand = zi.zoho_brand || 'UNKNOWN';
            if (!summary[brand]) summary[brand] = { total: 0, matched: 0, unmatched: 0 };
            summary[brand].total++;
            const m = lookup[zi.zoho_item_id];
            if (m) summary[brand].matched++; else summary[brand].unmatched++;
            items.push({
                zoho_item_id: zi.zoho_item_id, zoho_item_name: zi.zoho_item_name,
                zoho_sku: zi.zoho_sku, zoho_rate: zi.zoho_rate, zoho_cf_dpl: zi.zoho_cf_dpl,
                zoho_purchase_rate: zi.zoho_purchase_rate, zoho_brand: zi.zoho_brand,
                zoho_category: zi.zoho_category_name,
                status: m ? 'matched' : 'unmatched',
                product_name: m ? m.product_name : null,
                product_id: m ? m.product_id : null
            });
        }
        res.json({ success: true, summary, items, generated_at: new Date().toISOString() });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── AI Parse Job Store ────────────────────────────────────────────────────────
// Background jobs for DPL PDF extraction (avoids 100s proxy timeouts).
// Jobs expire after 30 min to prevent memory leaks.
const _aiParseJobs = new Map(); // jobId → { status, data, error, progress, startedAt }
function _aiParseCleanup() {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, job] of _aiParseJobs) {
        if (job.startedAt < cutoff) _aiParseJobs.delete(id);
    }
}

// GET /api/zoho/items/ai-parse-job/:id — poll for job result
router.get('/items/ai-parse-job/:id', requirePermission('zoho', 'manage'), (req, res) => {
    const job = _aiParseJobs.get(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: 'Job not found or expired (30 min limit)' });
    return res.json({ success: true, status: job.status, progress: job.progress, data: job.data || null, error: job.error || null });
});

/**
 * POST /api/zoho/items/ai-parse-price-list
 * Starts a background AI extraction job. Returns { job_id } immediately.
 * Poll GET /items/ai-parse-job/:id for status ("running" | "done" | "error").
 */
router.post('/items/ai-parse-price-list', requirePermission('zoho', 'manage'), uploadPriceList.single('pdf'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'PDF file is required' });
    }

    // Return job_id immediately so the browser doesn't time out
    _aiParseCleanup();
    const crypto = require('crypto');
    const jobId  = crypto.randomBytes(8).toString('hex');
    _aiParseJobs.set(jobId, { status: 'running', progress: 'Reading PDF...', startedAt: Date.now() });
    res.json({ success: true, job_id: jobId });

    // ── Run extraction in background (after response sent) ──────────────────
    const _pdfBuffer   = req.file.buffer;
    const _pdfFilename = req.file.originalname || '';

    setImmediate(async () => {
    try {
        // ── 1. Extract PDF text ────────────────────────────────────────────
        const pdfParse = require('pdf-parse');
        const pdfData  = await pdfParse(_pdfBuffer);
        const fullText = pdfData.text || '';
        const pages    = pdfData.numpages || 0;
        _aiParseJobs.get(jobId).progress = `PDF read (${pages} pages, ${fullText.length} chars). Starting AI extraction...`;

        // ── 2. Detect brand ────────────────────────────────────────────────
        const detectedBrand = priceListParser.detectBrand(fullText, _pdfFilename);

        // ── 3. Helpers ───────────────────────────────────────────────────────
        function parseRawJson(raw) {
            try {
                let t = (raw || '').trim()
                    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
                const a = t.indexOf('['), b = t.lastIndexOf(']');
                if (a !== -1 && b > a) t = t.slice(a, b + 1);
                const arr = JSON.parse(t);
                return Array.isArray(arr) ? arr : [];
            } catch { return []; }
        }

        // Hermes call — single configurable request
        function callHermes(promptText, maxTok = 16000) {
            return new Promise((resolve, reject) => {
                const body = JSON.stringify({
                    model: 'claude-sonnet-4-6',
                    messages: [{ role: 'user', content: promptText }],
                    max_tokens: maxTok,
                    temperature: 0.1
                });
                const options = {
                    hostname: '127.0.0.1', port: 8317,
                    path: '/v1/chat/completions', method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer local',
                        'Content-Length': Buffer.byteLength(body)
                    }
                };
                const req2 = http.request(options, (res2) => {
                    let data = '';
                    res2.on('data', c => { data += c; });
                    res2.on('end', () => {
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.error) return reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
                            resolve(parsed.choices?.[0]?.message?.content || '[]');
                        } catch (e) { reject(new Error('Hermes parse error: ' + e.message)); }
                    });
                });
                req2.on('error', reject);
                req2.setTimeout(240000, () => { req2.destroy(); reject(new Error('hermes timeout')); });
                req2.write(body);
                req2.end();
            });
        }

        // Build the extraction prompt (used for both full-text and per-chunk calls)
        function buildPrompt(textSection, isFullDoc = true) {
            return `Extract EVERY product item from this paint brand Dealer Price List PDF${isFullDoc ? '' : ' section'}.

Return ONLY a JSON array — no markdown, no explanation, nothing else:
[{"p":"PRODUCT NAME","s":"1L","d":189,"c":"EXTERIOR EMULSION"},...]

KEY: p=product name (include variant e.g. "- White", "- Pink"), s=pack size, d=DPL dealer price (NUMBER), c=category

CATEGORY — use the SECTION HEADING from the PDF (the actual paint type, NOT tier like LUXURY/PREMIUM):
• Interior emulsion / distemper / acrylic  → "INTERIOR EMULSION"
• Exterior emulsion / weather coat / shield → "EXTERIOR EMULSION"
• Interior undercoat / primer              → "INTERIOR PRIMER"
• Exterior primer                          → "EXTERIOR PRIMER"
• Wood primer / wood sealer                → "WOOD PRIMER"
• Metal primer / rust guard                → "METAL PRIMER"
• Metal & wood primer                      → "METAL & WOOD PRIMER"
• Putty / wall putty                       → "WALL PUTTY"
• Waterproofing / damp proof               → "WATERPROOFING"
• Wood polish / PU / varnish / lacquer     → "WOOD FINISH"
• Enamel / synthetic enamel                → "ENAMEL"
• Distemper                                → "DISTEMPER"
• Construction chemicals / admixture       → "CONSTRUCTION CHEMICALS"
• Colorant / tint                          → "COLORANT"

PACK SIZES: "1L","4L","9L","10L","18L","20L","500ml","200ml","1Kg","4Kg","20Kg","1No","0.9L"

RULES:
1. Each product × each pack size = ONE separate row (e.g. 1L, 4L, 10L, 20L = 4 rows)
2. d = DPL/dealer/trade price (SMALLER number). NOT MRP/customer price (larger number)
3. Extract ALL product families: ONE, CALISTA, ALLWOOD, SPARKLE, PROTEK, STYLE, ALLGUARD, VEGA, CSWT, ALLOVER, OPUS, etc.
4. Skip: company name lines, column headers ("Base Code / Name..."), page numbers, footnotes
5. If a product has multiple base variants (White, Pastel, Base 1, Base 2) — include all variants as separate rows with their own prices
6. Section headings in the PDF tell you the category — track the current section carefully

PDF TEXT:
${textSection}`;
        }

        // ── 4. Strategy A: Traditional regex parser (Birla Opus format) ──────
        // Fast, deterministic — catches products AI might miss due to unusual formatting.
        // Returns items with _prices arrays; we convert to individual rows.
        const tradDebug = { items: 0, error: null };
        const tradRawItems = [];
        try {
            const parseFn = priceListParser.parseBirlaOpus || (() => []);
            const rawTrad = parseFn(fullText);
            // Map tier-based categories to real paint categories
            const TIER_TO_CAT = {
                LUXURY: 'INTERIOR EMULSION', PREMIUM: 'INTERIOR EMULSION',
                ECONOMY: 'INTERIOR EMULSION', STANDARD: 'INTERIOR EMULSION',
                'ULTRA PREMIUM': 'EXTERIOR EMULSION', SPECIALITY: 'INTERIOR EMULSION',
                DESIGNER: 'INTERIOR EMULSION', UNDERCOATS: 'INTERIOR PRIMER',
                OTHERS: ''
            };
            // Preserve _prices arrays so matchWithZohoItems can do rate-anchored
            // expansion against Zoho catalog rates (price-list-parser.js:1100-1254).
            // Flat items (single dpl + packSize) pass through unchanged.
            for (const item of rawTrad) {
                const cat = TIER_TO_CAT[item.category] || item.category || '';
                if (Array.isArray(item._prices) && item._prices.length > 0) {
                    tradRawItems.push({
                        product:  item.product,
                        _prices:  item._prices.slice(),
                        category: cat,
                        brand:    detectedBrand,
                        baseCode: item.baseCode,
                    });
                } else if (item.dpl) {
                    tradRawItems.push({
                        product:  item.product,
                        packSize: item.packSize || '?',
                        dpl:      item.dpl,
                        category: cat,
                        brand:    detectedBrand,
                    });
                }
            }
            tradDebug.items = tradRawItems.length;
        } catch (e) {
            tradDebug.error = e.message;
        }

        // ── 5. Strategy B: AI extraction — single call if text fits ──────────
        // Claude 200K context; even a 300-page DPL PDF is typically < 150K chars.
        const SINGLE_CALL_MAX = 140000; // chars — safe limit for one Claude call
        const LARGE_CHUNK_SIZE = 70000; // chars per chunk when PDF is too large
        const LARGE_CHUNK_OVERLAP = 3000;

        const aiRawItems = [];
        const extractionDebug = [];

        if (fullText.length <= SINGLE_CALL_MAX) {
            // ── SINGLE FULL-TEXT CALL (preferred) ────────────────────────────
            _aiParseJobs.get(jobId).progress = `Sending full PDF text to AI (${fullText.length} chars, single call)...`;
            try {
                const raw = await callHermes(buildPrompt(fullText, true), 32000);
                const parsed = parseRawJson(raw);
                extractionDebug.push({ method: 'single-full-text', chars: fullText.length, extracted: parsed.length });
                aiRawItems.push(...parsed);
                _aiParseJobs.get(jobId).progress = `AI extracted ${parsed.length} items. Matching with Zoho...`;
            } catch (e) {
                extractionDebug.push({ method: 'single-full-text', error: e.message });
                _aiParseJobs.get(jobId).progress = `AI error: ${e.message}. Using traditional parser...`;
            }
        } else {
            // ── LARGE-CHUNK FALLBACK: 70K chars with 3K overlap ──────────────
            const bigChunks = [];
            for (let i = 0; i < fullText.length; i += LARGE_CHUNK_SIZE - LARGE_CHUNK_OVERLAP) {
                bigChunks.push(fullText.slice(i, i + LARGE_CHUNK_SIZE));
                if (i + LARGE_CHUNK_SIZE >= fullText.length) break;
            }
            for (let i = 0; i < bigChunks.length; i++) {
                _aiParseJobs.get(jobId).progress = `Processing chunk ${i+1}/${bigChunks.length}...`;
                try {
                    const raw = await callHermes(buildPrompt(bigChunks[i], false), 16000);
                    const parsed = parseRawJson(raw);
                    extractionDebug.push({ method: 'large-chunk', chunk: i + 1, total: bigChunks.length, chars: bigChunks[i].length, extracted: parsed.length });
                    aiRawItems.push(...parsed);
                } catch (e) {
                    extractionDebug.push({ method: 'large-chunk', chunk: i + 1, error: e.message });
                }
            }
        }

        // ── 6. Merge: traditional (with _prices) wins for products it covered;
        //          AI flat rows fill gaps for products traditional missed.
        const productKey = (s) => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
        const tradProductSet = new Set();
        for (const it of tradRawItems) {
            const k = productKey(it.product);
            if (k) tradProductSet.add(k);
        }

        // Pool A: every traditional item (both _prices and flat-dpl shapes).
        const mergedItems = tradRawItems.slice();

        // Pool B: AI flat rows for products NOT covered by traditional.
        for (const it of aiRawItems) {
            const k = productKey(it.p || it.product);
            if (!k) continue;
            if (tradProductSet.has(k)) continue;
            mergedItems.push(it);
        }

        // ── 7. Sanitise merged items ─────────────────────────────────────────
        // Fix doubled product names from AI extraction:
        // "One Pure Elegance One Pure Elegance - Mid Tone" → "One Pure Elegance - Mid Tone"
        function fixDoubledName(name) {
            // Pattern: "X X - Y" where X is repeated
            const m = name.match(/^(.+?)\s+\1(\s*-\s*.+)$/i);
            if (m) return (m[1] + m[2]).replace(/\s{2,}/g, ' ').trim();
            return name;
        }

        const cleanItems = [];
        for (const it of mergedItems) {
            if (!it || typeof it !== 'object') continue;
            const product  = fixDoubledName(String(it.p || it.product || '').trim());
            const category = String(it.c || it.category || '').toUpperCase().trim();
            if (!product) continue;

            // Shape 1: _prices array — pass through for rate-anchored expansion.
            if (Array.isArray(it._prices) && it._prices.length > 0) {
                const cleanedPrices = it._prices
                    .map(p => parseFloat(p))
                    .filter(p => isFinite(p) && p > 0);
                if (cleanedPrices.length === 0) continue;
                cleanItems.push({
                    product,
                    _prices:  cleanedPrices,
                    category,
                    brand:    detectedBrand,
                    baseCode: it.baseCode,
                });
                continue;
            }

            // Shape 2: flat row — require explicit packSize + valid dpl.
            const packSize = String(it.s || it.packSize || it.pack || '').trim();
            const dplNum   = parseFloat(it.d != null ? it.d : it.dpl);
            if (!packSize || !isFinite(dplNum) || dplNum <= 0) continue;
            cleanItems.push({ product, packSize, dpl: dplNum, category, brand: detectedBrand });
        }

        // ── 8. Fetch ALL active Zoho items ───────────────────────────────────
        const [zohoItems] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name AS name, zoho_sku AS sku,
                    zoho_rate AS rate, zoho_cf_dpl AS cf_dpl,
                    zoho_brand AS brand, zoho_category_name AS category, zoho_description AS description,
                    dpl_updated_at
             FROM zoho_items_map
             WHERE zoho_status = 'active'
             ORDER BY zoho_item_name ASC`
        );

        // ── 9. Auto-match ────────────────────────────────────────────────────
        // Keep brand so matchWithZohoItems can scope to same-brand Zoho items only
        const cleanItemsForMatch = cleanItems;
        const matchResult = priceListParser.matchWithZohoItems(cleanItemsForMatch, zohoItems);

        // ── 10. Build output ─────────────────────────────────────────────────
        // Source rows from matchResult.matched + unmatched (one entry per resolved
        // PDF row, including expansions of _prices arrays). This replaces the
        // old cleanItems.map approach which assumed every input had an explicit
        // packSize — now invalid because Birla Opus emulsion items use _prices.
        const itemsOut = [];
        for (const m of matchResult.matched) {
            const out = {
                product:  m.product,
                packSize: m.packSize,
                dpl:      m.dpl,
                category: m.category,
            };
            if (m.zoho_item_id) {
                out.auto_match = {
                    zoho_item_id:         m.zoho_item_id,
                    zoho_item_name:       m.zoho_item_name,
                    proposed_name:        m.proposed_name        || null,
                    proposed_sku:         m.proposed_sku         || null,
                    proposed_description: m.proposed_description || null,
                    proposed_rate:        m.proposed_rate        || null,
                    current_sku:          m.current_sku          || null,
                    current_description:  m.current_description  || null,
                    current_rate:         m.currentRate          || null,
                    current_dpl:          m.currentDpl           || null,
                    warning:              m._warning             || null,
                };
            }
            itemsOut.push(out);
        }
        for (const u of matchResult.unmatched) {
            itemsOut.push({
                product:  u.product,
                packSize: u.packSize || '?',
                dpl:      u.dpl,
                category: u.category,
                unmatched_reason: u._reject_reason || null,
            });
        }

        // Filter Zoho items to same brand so client dropdown doesn't show other-brand items.
        // Fallback: check item name for brand keywords when the brand column is empty.
        const pdfBrandNorm = priceListParser.normalizeBrand(detectedBrand || '');
        const sameBrandZoho = pdfBrandNorm ? zohoItems.filter(z => {
            let zb = priceListParser.normalizeBrand(z.brand || '');
            if (!zb) {
                const nm = (z.name || '').toUpperCase();
                zb = (nm.includes('BIRLA') || nm.includes('OPUS')) ? 'BIRLAOPUS'
                   : nm.includes('ASIAN')  ? 'ASIANPAINTS'
                   : nm.includes('BERGER') ? 'BERGERPAINTS'
                   : nm.includes('NIPPON') ? 'NIPPON'
                   : nm.includes('JSW')    ? 'JSW'
                   : '';
            }
            if (!zb) return true; // still unknown brand — keep
            return zb === pdfBrandNorm || zb.includes(pdfBrandNorm) || pdfBrandNorm.includes(zb);
        }) : zohoItems;

        const zohoItemsOut = sameBrandZoho.map(z => ({
            zoho_item_id: z.zoho_item_id,
            name:    z.name,
            sku:     z.sku,
            rate:    parseFloat(z.rate    || 0),
            cf_dpl:  parseFloat(z.cf_dpl  || 0),
            category:    z.category    || '',
            description: z.description || '',
            brand:       z.brand       || '',
            dpl_updated_at: z.dpl_updated_at ? new Date(z.dpl_updated_at).toISOString() : null
        }));

        // ── Store completed result ─────────────────────────────────────────
        _aiParseJobs.set(jobId, {
            status: 'done',
            startedAt: _aiParseJobs.get(jobId)?.startedAt,
            data: {
                brand:          detectedBrand || 'unknown',
                pages,
                // Counts are post-expansion (each _prices array yields multiple itemsOut rows).
                // Reporting cleanItems.length here would under-count because rate-anchored
                // expansion in matchWithZohoItems turns one _prices entry into N matched rows.
                totalExtracted: itemsOut.length,
                autoMatched:    matchResult.matched.length,
                needsReview:    matchResult.unmatched.length,
                items:          itemsOut,
                zohoItems:      zohoItemsOut,
                ai: {
                    provider:      'claude/hermes',
                    model:         'claude-sonnet-4-6',
                    textLength:    fullText.length,
                    method:        fullText.length <= SINGLE_CALL_MAX ? 'single-full-text' : 'large-chunks',
                    aiExtracted:   aiRawItems.length,
                    tradExtracted: tradDebug.items,
                    tradError:     tradDebug.error,
                    extractionDebug
                }
            }
        });
    } catch (error) {
        console.error('AI price list parse error:', error);
        _aiParseJobs.set(jobId, { status: 'error', error: error.message, startedAt: _aiParseJobs.get(jobId)?.startedAt });
    }
    }); // end setImmediate
});

/**
 * GET /api/zoho/items/brand-dpl/:brand
 *
 * Return saved DPL summary for a brand. Drives the Saved Summary Card
 * in admin-dpl.html. ?include=raw also returns raw_text (used when admin
 * clicks "Update DPL" to pre-fill the textarea).
 */
router.get('/items/brand-dpl/:brand', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = String(req.params.brand || '').toLowerCase().trim();
        if (!assertSupportedBrand(brand, res)) return;
        const includeRaw = req.query.include === 'raw';
        const row = await brandDplService.get(brand, { includeRaw });
        if (!row) {
            return res.status(404).json({ success: false, code: 'NO_SAVED_DPL', message: 'No DPL saved for this brand' });
        }
        return res.json({ success: true, data: row });
    } catch (err) {
        console.error('GET brand-dpl error:', err);
        return res.status(500).json({ success: false, message: err.message || 'Server error' });
    }
});

/**
 * POST /api/zoho/items/brand-dpl/:brand
 *
 * Save (or replace) a brand's DPL price list. Optionally runs match in
 * the same call (default true) so the frontend can plug the response
 * into the existing aiData / showAiResults() review UI.
 *
 * Body: { text, effective_date?, match? }
 */
router.post('/items/brand-dpl/:brand', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = String(req.params.brand || '').toLowerCase().trim();
        if (!assertSupportedBrand(brand, res)) return;
        const body = req.body || {};
        const text = String(body.text || '');
        if (!text.trim()) {
            return res.status(400).json({ success: false, message: 'No text provided' });
        }
        if (text.length > 1_000_000) {
            return res.status(413).json({ success: false, message: 'Pasted text is too large. Maximum 1,000,000 characters.' });
        }

        let effectiveDate = new Date().toISOString().slice(0, 10);
        if (body.effective_date) {
            const ed = String(body.effective_date);
            // Shape check + roundtrip equality catches "2026-02-30" (which Date silently rolls to 2026-03-02).
            if (!/^\d{4}-\d{2}-\d{2}$/.test(ed)) {
                return res.status(400).json({ success: false, message: 'effective_date must be YYYY-MM-DD' });
            }
            const parsed = new Date(ed + 'T00:00:00Z');
            if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== ed) {
                return res.status(400).json({ success: false, message: `effective_date "${ed}" is not a real calendar date` });
            }
            effectiveDate = ed;
        }
        const runMatch = body.match !== false;

        const parsedRows = priceListParser.parseBirlaOpusTabular(text);
        if (parsedRows.length === 0) {
            return res.status(400).json({ success: false, message: 'No data rows found in pasted text' });
        }

        const before = await brandDplService.get(brand);

        const updatedBy = req.user && req.user.username ? req.user.username : null;
        const saved = await brandDplService.save({
            brand, rawText: text, parsedRows, effectiveDate, updatedBy,
        });

        try {
            const audit = require('../../services/audit-log');
            await audit.record(req, {
                action: 'brand_dpl.save',
                entity_type: 'brand_dpl_lists',
                entity_id: brand,
                before: before ? { parsed_count: before.parsed_count, effective_date: before.effective_date, updated_at: before.updated_at } : null,
                after: { parsed_count: saved.parsed_count, effective_date: saved.effective_date, updated_at: saved.updated_at },
            });
        } catch (e) {
            console.warn('audit-log record failed:', e.message);
        }

        let match = null;
        if (runMatch) {
            match = await runBrandDplMatch(brand, parsedRows);
        }

        return res.json({ success: true, data: { saved, ...(match ? { match } : {}) } });
    } catch (err) {
        console.error('POST brand-dpl error:', err);
        return res.status(500).json({ success: false, message: err.message || 'Server error' });
    }
});

/**
 * POST /api/zoho/items/brand-dpl/:brand/match
 *
 * Re-match against already-saved DPL — no text in body. Powers the
 * "Match Now" button on the Saved Summary Card.
 */
router.post('/items/brand-dpl/:brand/match', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = String(req.params.brand || '').toLowerCase().trim();
        if (!assertSupportedBrand(brand, res)) return;
        const parsedRows = await brandDplService.getForMatch(brand);
        if (!parsedRows) {
            return res.status(404).json({ success: false, code: 'NO_SAVED_DPL', message: 'No DPL saved for this brand' });
        }
        const match = await runBrandDplMatch(brand, parsedRows);
        return res.json({ success: true, data: match });
    } catch (err) {
        console.error('POST brand-dpl match error:', err);
        return res.status(500).json({ success: false, message: err.message || 'Server error' });
    }
});

/**
 * Internal helper: run matchWithZohoItems against parsed-rows + return the
 * payload shape consumed by admin-dpl.html's showAiResults().
 */
async function runBrandDplMatch(brand, parsedRows) {
    const unmappedCats = new Set();
    const cleanItems = parsedRows.map(r => {
        const rawCat = String(r.category || '').toUpperCase().trim();
        let canonCat = PASTE_CAT_TO_CANON[rawCat];
        if (canonCat === undefined && rawCat) {
            unmappedCats.add(rawCat);
            canonCat = r.category || '';
        }
        const item = {
            product: r.product, packSize: r.packSize, dpl: r.dpl,
            category: canonCat || '',
            brand: r.brand, baseCode: r.baseCode,
        };
        if (r._proposedName)        item._proposedName        = r._proposedName;
        if (r._proposedZohoSku)     item._proposedZohoSku     = r._proposedZohoSku;
        if (r._proposedDescription) item._proposedDescription = r._proposedDescription;
        return item;
    });
    if (unmappedCats.size > 0) {
        console.warn('[brand-dpl] Unmapped categories — pass-through (may mis-match): ' + Array.from(unmappedCats).join(', '));
    }

    const [zohoItems] = await pool.query(
        `SELECT zoho_item_id, zoho_item_name AS name, zoho_sku AS sku,
                zoho_rate AS rate, zoho_cf_dpl AS cf_dpl,
                zoho_brand AS brand, zoho_category_name AS category, zoho_description AS description,
                dpl_updated_at
         FROM zoho_items_map
         WHERE zoho_status = 'active'
         ORDER BY zoho_item_name ASC`
    );

    const matchResult = priceListParser.matchWithZohoItems(cleanItems, zohoItems);

    const itemsOut = [];
    for (const m of matchResult.matched) {
        const out = { product: m.product, packSize: m.packSize, dpl: m.dpl, category: m.category };
        if (m.zoho_item_id) {
            out.auto_match = {
                zoho_item_id:         m.zoho_item_id,
                zoho_item_name:       m.zoho_item_name,
                proposed_name:        m.proposed_name        || null,
                proposed_sku:         m.proposed_sku         || null,
                proposed_description: m.proposed_description || null,
                proposed_rate:        m.proposed_rate        || null,
                current_sku:          m.current_sku          || null,
                current_description:  m.current_description  || null,
                current_rate:         m.currentRate          || null,
                current_dpl:          m.currentDpl           || null,
                warning:              m._warning             || null,
            };
        }
        itemsOut.push(out);
    }
    for (const u of matchResult.unmatched) {
        itemsOut.push({
            product: u.product, packSize: u.packSize || '?', dpl: u.dpl, category: u.category,
            unmatched_reason: u._reject_reason || null,
        });
    }

    const brandNorm = priceListParser.normalizeBrand(BRAND_DISPLAY_NAMES[brand] || brand);
    const sameBrandZoho = zohoItems.filter(z => {
        let zb = priceListParser.normalizeBrand(z.brand || '');
        if (!zb) {
            const nm = (z.name || '').toUpperCase();
            zb = (nm.includes('BIRLA') || nm.includes('OPUS')) ? 'BIRLAOPUS' : '';
        }
        if (!zb) return true;
        return zb === brandNorm || zb.includes(brandNorm) || brandNorm.includes(zb);
    });

    const zohoItemsOut = sameBrandZoho.map(z => ({
        zoho_item_id: z.zoho_item_id,
        name: z.name, sku: z.sku,
        rate: parseFloat(z.rate || 0),
        cf_dpl: parseFloat(z.cf_dpl || 0),
        category: z.category || '', description: z.description || '', brand: z.brand || '',
        dpl_updated_at: z.dpl_updated_at ? new Date(z.dpl_updated_at).toISOString() : null,
    }));

    return {
        brand, pages: 0,
        totalExtracted: itemsOut.length,
        autoMatched: matchResult.matched.length,
        needsReview: matchResult.unmatched.length,
        items: itemsOut,
        zohoItems: zohoItemsOut,
        source: { type: 'stored-dpl', parsed: parsedRows.length },
    };
}

/**
 * POST /api/zoho/items/dpl-parse-csv
 *
 * Upload a Birla Opus SKU Report CSV → parse → save to brand_dpl_lists → match.
 * Returns the same aiData shape as POST /items/brand-dpl/:brand so the frontend
 * can reuse showAiResults() directly.
 *
 * Multipart field: csv (required)
 * Body params:
 *   effective_date  optional YYYY-MM-DD; extracted from filename if absent
 *   match           optional boolean string, default "true"
 */
router.post('/items/dpl-parse-csv', requirePermission('zoho', 'manage'), uploadPriceCsv.single('csv'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No CSV file uploaded' });

        // Derive effective date: filename regex → body param → today
        let effectiveDate = new Date().toISOString().slice(0, 10);
        const fnMatch = (req.file.originalname || '').match(/(\d{1,2})([A-Za-z]{3})(\d{4})/);
        if (fnMatch) {
            const monthMap = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
                               Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
            const mm = monthMap[fnMatch[2]];
            if (mm) {
                const dd = String(fnMatch[1]).padStart(2, '0');
                effectiveDate = `${fnMatch[3]}-${mm}-${dd}`;
            }
        }
        if (req.body && req.body.effective_date) {
            const ed = String(req.body.effective_date);
            if (/^\d{4}-\d{2}-\d{2}$/.test(ed)) effectiveDate = ed;
        }

        const csvString = req.file.buffer.toString('utf8');
        const parsedRows = priceListParser.parseBirlaOpusCsvAuto(req.file.buffer, effectiveDate);
        if (parsedRows.length === 0) {
            return res.status(400).json({ success: false, message: 'No data rows found in CSV — check file format' });
        }

        // Canonicalize CSV categories for match compatibility
        const rowsForMatch = parsedRows.map(r => {
            const rawCat = r.category.toUpperCase();
            const canon = CSV_CAT_TO_CANON[rawCat];
            return canon !== undefined ? { ...r, category: canon } : r;
        });

        const before = await brandDplService.get('birlaopus');
        const updatedBy = req.user && req.user.username ? req.user.username : null;
        const saved = await brandDplService.save({
            brand: 'birlaopus',
            rawText: csvString,
            parsedRows: rowsForMatch,
            effectiveDate,
            updatedBy,
        });

        try {
            const audit = require('../../services/audit-log');
            await audit.record(req, {
                action: 'brand_dpl.save',
                entity_type: 'brand_dpl_lists',
                entity_id: 'birlaopus',
                before: before ? { parsed_count: before.parsed_count, effective_date: before.effective_date } : null,
                after: { parsed_count: saved.parsed_count, effective_date: saved.effective_date },
            });
        } catch (e) {
            console.warn('[dpl-parse-csv] audit-log failed:', e.message);
        }

        let match = null;
        const runMatch = !req.body || String(req.body.match) !== 'false';
        if (runMatch) {
            match = await runBrandDplMatch('birlaopus', rowsForMatch);
        }

        return res.json({
            success: true,
            data: {
                saved,
                parsed_count: parsedRows.length,
                ...(match ? { match } : {}),
            },
        });
    } catch (err) {
        console.error('[dpl-parse-csv] error:', err);
        return res.status(500).json({ success: false, message: err.message || 'Server error' });
    }
});

/**
 * GET /api/zoho/items/propose-naming
 *
 * Auto-Propose Naming — reads existing items from DB (no PDF needed) and
 * applies brand naming rules to generate proposed Name / SKU / Description /
 * Rate. Returns a review list the frontend uses for bulk approve + push.
 *
 * Query params:
 *   brand — currently only 'birlaopus' is fully supported (default)
 *
 * Response: { success, data: { brand, total, withChanges, items: [...] } }
 */
router.get('/items/propose-naming', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brandKey = String(req.query.brand || 'birlaopus').toLowerCase();
        if (brandKey !== 'birlaopus') {
            return res.status(400).json({
                success: false,
                message: 'Only brand=birlaopus is supported at this time'
            });
        }

        const [rows] = await pool.query(`
            SELECT zoho_item_id,
                   zoho_item_name AS name,
                   zoho_sku       AS sku,
                   zoho_rate      AS rate,
                   zoho_cf_dpl    AS cf_dpl,
                   zoho_brand     AS brand,
                   zoho_category_name AS category,
                   zoho_description   AS description
            FROM zoho_items_map
            WHERE zoho_status = 'active'
              AND (zoho_brand IN ('BIRLA OPUS','Birla Opus','BIRLAOPUS')
                   OR UPPER(REPLACE(zoho_brand,' ',''))='BIRLAOPUS')
            ORDER BY zoho_item_name ASC
        `);

        // ─── Helpers (self-contained, mirror price-list-parser semantics) ───
        const BRAND_DISPLAY = 'BIRLA OPUS';

        // Decode pack code suffix (e.g. "04", "20", "50M", "01K") to canonical
        // pack size like "4L", "20L", "500ml", "1Kg". Returns null if unparseable.
        function decodePackCode(pc) {
            if (!pc) return null;
            const s = String(pc).toUpperCase().trim();
            const ml = s.match(/^(\d{1,2})M$/);          // "20M"→200ml, "50M"→500ml
            if (ml) return (parseInt(ml[1], 10) * 10) + 'ml';
            const kg = s.match(/^(\d{1,2})K$/);          // "01K"→1Kg, "20K"→20Kg
            if (kg) return parseInt(kg[1], 10) + 'Kg';
            const lt = s.match(/^(\d{1,3})$/);           // "01"→1L, "20"→20L
            if (lt) return parseInt(lt[1], 10) + 'L';
            return null;
        }

        // Format pack size for the display tail in item names.
        // "1L"→"01 L", "4L"→"04 L", "10L"→"10 L", "500ml"→"500 ML", "1Kg"→"01 KG"
        function formatPackDisplay(packSize) {
            if (!packSize) return null;
            const s = String(packSize).toUpperCase().replace(/\s+/g, '');
            const ml = s.match(/^(\d+(?:\.\d+)?)ML$/);
            if (ml) return ml[1] + ' ML';
            const lt = s.match(/^(\d+(?:\.\d+)?)(L|LT|LTR|LITRE|LITER|LITRES)?$/);
            if (lt) {
                const n = parseFloat(lt[1]);
                const i = Math.floor(n);
                return (i < 10 ? '0' + i : String(i)) + ' L';
            }
            const kg = s.match(/^(\d+(?:\.\d+)?)KG$/);
            if (kg) {
                const n = parseFloat(kg[1]);
                const i = Math.floor(n);
                return (i < 10 ? '0' + i : String(i)) + ' KG';
            }
            return null;
        }

        // Split SKU into letter prefix + numeric/letter suffix.
        // "PFP04"   → { abbrev: "PFP",   packCode: "04"  }
        // "CSTBLK01"→ { abbrev: "CSTBLK",packCode: "01"  }
        // "AWMLS50M"→ { abbrev: "AWMLS", packCode: "50M" }
        // "OPWF01K" → { abbrev: "OPWF",  packCode: "01K" }
        function splitSku(sku) {
            if (!sku) return { abbrev: null, packCode: null };
            const s = String(sku).toUpperCase().trim();
            const m = s.match(/^([A-Z]+)(\d{1,3}[A-Z]?)$/);
            if (!m) return { abbrev: null, packCode: null };
            return { abbrev: m[1], packCode: m[2] };
        }

        // Extract the human product-name portion from an existing item name.
        // Strips: 1) leading SKU token, 2) trailing brand+pack tail.
        // "PFP04 STYLE PRO FRESH PRIMER BIRLA OPUS 04 L" → "STYLE PRO FRESH PRIMER"
        // "OPWF01 ALLWOOD WOOD FILLER OPUS 01 KG"        → "ALLWOOD WOOD FILLER"
        function extractProductName(name, abbrev, packCode) {
            if (!name) return '';
            let n = String(name).toUpperCase().trim().replace(/\s+/g, ' ');

            // 1) Strip leading SKU token (e.g. "PFP04 ")
            if (abbrev && packCode) {
                const skuTok = abbrev + packCode;
                if (n.startsWith(skuTok + ' ')) {
                    n = n.slice(skuTok.length + 1).trim();
                } else if (n.startsWith(skuTok)) {
                    n = n.slice(skuTok.length).trim();
                }
            }

            // 2) Strip trailing brand + pack tail. Try most specific first.
            //    Patterns: " BIRLA OPUS 04 L", " OPUS 04 L", " 04 L", " BIRLA OPUS 500 ML", " 01 KG"
            const tailPatterns = [
                /\s+BIRLA\s+OPUS\s+\d{1,3}\s*(?:L|ML|KG)\s*$/i,
                /\s+OPUS\s+\d{1,3}\s*(?:L|ML|KG)\s*$/i,
                /\s+BIRLA\s+OPUS\s*$/i,
                /\s+OPUS\s*$/i,
                /\s+\d{1,3}\s*(?:L|ML|KG)\s*$/i
            ];
            for (const re of tailPatterns) {
                if (re.test(n)) { n = n.replace(re, '').trim(); break; }
            }

            return n.replace(/\s+/g, ' ').trim();
        }

        // Strip noisy tokens like brand or "BIRLA OPUS" out of a category for
        // the description tail. Birla Opus categories are mostly clean already
        // ("INTERIOR PRIMER", "EXTERIOR EMULSION") so just upper-case + collapse.
        function categoryShort(cat) {
            return String(cat || '').toUpperCase().replace(/\s+/g, ' ').trim();
        }

        let withChanges = 0;
        const items = rows.map(r => {
            const currentName        = r.name        || '';
            const currentSku         = r.sku         || '';
            const currentDescription = r.description || '';
            const currentRate        = r.rate != null ? parseFloat(r.rate) : null;
            const currentDpl         = r.cf_dpl != null ? parseFloat(r.cf_dpl) : null;

            const out = {
                zoho_item_id: r.zoho_item_id,
                current_name: currentName,
                current_sku: currentSku,
                current_description: currentDescription,
                current_rate: currentRate,
                current_dpl: currentDpl,
                proposed_name: null,
                proposed_sku: null,
                proposed_description: null,
                proposed_rate: null,
                has_changes: false,
                skip_reason: null
            };

            if (!currentSku || !currentSku.trim()) {
                out.skip_reason = 'blank SKU';
                return out;
            }

            const { abbrev, packCode } = splitSku(currentSku);
            if (!abbrev || !packCode) {
                out.skip_reason = 'unparseable SKU (no abbrev/packCode split)';
                return out;
            }

            const decodedSize = decodePackCode(packCode);
            if (!decodedSize) {
                out.skip_reason = `pack code "${packCode}" can't be decoded`;
                return out;
            }

            const packFmt = formatPackDisplay(decodedSize);
            if (!packFmt) {
                out.skip_reason = `pack format failed for "${decodedSize}"`;
                return out;
            }

            const productName = extractProductName(currentName, abbrev, packCode);
            if (!productName) {
                out.skip_reason = 'product name extraction yielded empty string';
                return out;
            }

            const proposedSku  = (abbrev + packCode).toUpperCase();
            const proposedName = `${proposedSku} ${productName} ${BRAND_DISPLAY} ${packFmt}`;
            const catShort     = categoryShort(r.category);
            const proposedDesc = `${abbrev} ${catShort} ${BRAND_DISPLAY} ${packFmt}`
                .replace(/\s+/g, ' ').trim();
            const proposedRate = (currentDpl && currentDpl > 0)
                ? Math.ceil(currentDpl * 1.18 * 1.10)
                : null;

            out.proposed_sku  = proposedSku;
            out.proposed_name = proposedName;
            out.proposed_description = proposedDesc;
            out.proposed_rate = proposedRate;

            const nameDiff = proposedName !== currentName.trim();
            const skuDiff  = proposedSku  !== currentSku.trim().toUpperCase();
            const descDiff = proposedDesc !== currentDescription.trim();
            const rateDiff = proposedRate != null && currentRate != null &&
                Math.abs(proposedRate - currentRate) >= 0.01;

            out.has_changes = nameDiff || skuDiff || descDiff || rateDiff;
            if (out.has_changes) withChanges++;

            return out;
        });

        res.json({
            success: true,
            data: {
                brand: brandKey,
                total: items.length,
                withChanges,
                items
            }
        });
    } catch (error) {
        console.error('Auto-propose naming error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});


module.exports = { router, setPool };
