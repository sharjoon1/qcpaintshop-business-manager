/**
 * dpl-catalog.js — per-brand DPL catalog: the mediator between a brand's
 * Dealer Price List and Zoho items. Deterministic, self-contained matching
 * (slug-containment + size-tier), plus a thin DB layer (setPool injection).
 */
const { computeProposedFields } = require('./price-list-parser');

let pool;
function setPool(p) { pool = p; }

// ── Pure helpers ────────────────────────────────────────────────

function slug(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Collapse a pack-size label to its canonical TIER (the round size Zoho stores).
// 900ml/0.9L → 1L, 3.6L → 4L, 9L → 10L, 18L → 20L. 200ml is its own tier.
// Unknown units (kg, etc.) are returned verbatim so nothing is silently dropped.
function normalizeSizeTier(label) {
    const s = String(label == null ? '' : label).replace(/\s+/g, '').toLowerCase();
    const ml = s.match(/^(\d+(?:\.\d+)?)ml$/);
    if (ml) {
        const v = parseFloat(ml[1]);
        if (v >= 800 && v <= 1050) return '1L';
        return Math.round(v) + 'ml';
    }
    const lt = s.match(/^(\d+(?:\.\d+)?)(l|lt|ltr|litres?|liters?)$/);
    if (lt) {
        const n = parseFloat(lt[1]);
        // Tier ranges target the documented Birla round sizes + their off-sizes
        // (1L↔0.9L, 4L↔3.6L, 10L↔9L, 20L↔18L). Sizes outside these (e.g. 3.0L, 2L,
        // 5L, 15L) intentionally stay verbatim — they are distinct packs.
        if (n >= 0.8 && n <= 1.05) return '1L';
        if (n > 3.0 && n < 4.5) return '4L';
        if (n > 8.0 && n < 11.0) return '10L';
        if (n > 16.0 && n <= 20.0) return '20L';
        return n + 'L';
    }
    return String(label == null ? '' : label).trim();
}

// Pull the pack size out of a Zoho item's name/SKU. Requires a digit
// IMMEDIATELY followed by a unit, and takes the LAST such match, so a leading
// category code like "EP01" is never mistaken for a size.
function extractSizeFromZohoName(name, sku) {
    const text = String(name || '') + ' ' + String(sku || '');
    const re = /\b(\d+(?:\.\d+)?)\s*(ml|ltr|lt|l)\b/gi;
    let m, last = null;
    while ((m = re.exec(text))) last = m;
    if (!last) return '';
    return last[2].toLowerCase() === 'ml' ? (last[1] + 'ml') : (last[1] + 'L');
}

function buildMatchKey({ brand, product_code, product_name, base_name, size_tier }) {
    const code = (product_code && String(product_code).trim())
        ? String(product_code).trim().toLowerCase()
        : slug(product_name);
    return [slug(brand), code, slug(base_name), slug(size_tier)].join('|');
}

// Tokenize a string into lowercase alphanumeric word tokens.
function tokenize(s) {
    return String(s == null ? '' : s).toLowerCase().match(/[a-z0-9]+/g) || [];
}

// True when every needle token is present as a WHOLE token in the set.
// Whole-token (not substring) matching: 'base 2' does NOT match 'base 20'.
function hasAllTokens(tokenSet, needleTokens) {
    return needleTokens.length > 0 && needleTokens.every(t => tokenSet.has(t));
}

// Build a token-set + size-tier probe for a Zoho item.
function zohoProbe(zi) {
    const name = zi.name || zi.zoho_item_name || '';
    const sku = zi.sku || zi.zoho_sku || '';
    return {
        zi,
        tokens: new Set(tokenize(name + ' ' + sku)),
        sizeTier: normalizeSizeTier(extractSizeFromZohoName(name, sku)),
    };
}

// Link one catalog entry to exactly one Zoho item — DETERMINISTIC, whole-token, no fuzzy abbrev.
//   S1 exact canonical SKU (100)
//   S2 all product tokens + all base tokens present in the Zoho name AND size-tier equal (90, confirmed)
//   S3 all product tokens present + size-tier equal, base ignored (70, review)
//   else needs_creating.
// NOTE: entry.size_tier MUST already be a canonical tier (use normalizeSizeTier before calling).
// Size is compared by TIER, so a DPL 900ml entry (tier 1L) links to a Zoho 1L item.
function linkEntryToZoho(entry, zohoItems) {
    const items = zohoItems || [];

    // S1
    if (entry.canonical_sku) {
        const want = String(entry.canonical_sku).toUpperCase();
        const hit = items.find(z => String(z.sku || z.zoho_sku || '').toUpperCase() === want);
        if (hit) return { zoho_item_id: hit.zoho_item_id, link_status: 'confirmed', link_confidence: 100, link_reason: 'exact-sku' };
    }

    const eProd = tokenize(entry.product_name);
    const eBase = tokenize(entry.base_name);
    const eTier = entry.size_tier;
    const probes = items.map(zohoProbe);

    const prodTierMatch = p => hasAllTokens(p.tokens, eProd) && p.sizeTier === eTier;

    // S2: product + base + tier
    const s2 = probes.filter(p => prodTierMatch(p) && (eBase.length === 0 ? true : hasAllTokens(p.tokens, eBase)));
    if (s2.length === 1) return { zoho_item_id: s2[0].zi.zoho_item_id, link_status: 'confirmed', link_confidence: 90, link_reason: 'product+base+tier' };
    if (s2.length > 1) return { zoho_item_id: null, link_status: 'review', link_confidence: 60, link_reason: 'ambiguous-product+base+tier' };

    // S3: product + tier (any base) — softer, needs review
    const s3 = probes.filter(prodTierMatch);
    if (s3.length === 1) return { zoho_item_id: s3[0].zi.zoho_item_id, link_status: 'review', link_confidence: 70, link_reason: 'product+tier-only' };
    if (s3.length > 1) return { zoho_item_id: null, link_status: 'review', link_confidence: 50, link_reason: 'ambiguous-product+tier' };

    return { zoho_item_id: null, link_status: 'needs_creating', link_confidence: 0, link_reason: 'no-match' };
}

// Split the tabular parser's merged "Name - Shade" product field.
function splitProductBase(product) {
    const s = String(product || '');
    const idx = s.lastIndexOf(' - ');
    if (idx === -1) return { product_name: s.trim(), base_name: '' };
    return { product_name: s.slice(0, idx).trim(), base_name: s.slice(idx + 3).trim() };
}

function buildCatalogFromDpl(brand, parsedRows, zohoItems) {
    const out = [];
    for (const row of (parsedRows || [])) {
        const { product_name, base_name } = splitProductBase(row.product);
        const size_tier = normalizeSizeTier(row.packSize);
        const dpl = parseFloat(row.dpl) || 0;
        const entry = {
            brand,
            category: row.category || null,
            product_code: row.baseCode || '',
            product_name,
            base_name,
            size_tier,
            dpl_size_label: row.packSize || null,
            current_dpl: dpl || null,
            current_rate: dpl > 0 ? Math.ceil(dpl * 1.18 * 1.10) : null,
            zoho_item_id: null,
            canonical_name: null,
            canonical_sku: null,
            canonical_description: null,
            link_status: 'needs_creating',
            link_confidence: 0,
            link_reason: 'no-match',
        };
        entry.match_key = buildMatchKey(entry);

        Object.assign(entry, linkEntryToZoho(entry, zohoItems));

        // Canonical name/sku/desc for LINKED entries (reuse the proven Birla proposer).
        if (entry.zoho_item_id) {
            const zi = (zohoItems || []).find(z => z.zoho_item_id === entry.zoho_item_id);
            if (zi) {
                const pf = computeProposedFields(
                    { product: row.product, packSize: row.packSize, dpl, category: row.category },
                    { sku: zi.sku || zi.zoho_sku || '', description: zi.description || '', category: zi.category || zi.zoho_category_name || '' },
                    'birlaopus'
                );
                entry.canonical_name = pf.proposed_name || null;
                entry.canonical_sku = pf.proposed_sku || null;
                entry.canonical_description = pf.proposed_description || null;
            }
        }
        out.push(entry);
    }
    return out;
}

// Re-key incoming DPL rows to the existing catalog and compute the price delta.
// No fuzzy matching — entries are already pinned. Returns three buckets.
function applyDplPrices(brand, parsedRows, existingCatalog) {
    const byKey = new Map((existingCatalog || []).map(e => [e.match_key, e]));
    const seen = new Set();
    const updated = [];
    const newNeedsLinking = [];

    for (const row of (parsedRows || [])) {
        const { product_name, base_name } = splitProductBase(row.product);
        const size_tier = normalizeSizeTier(row.packSize);
        const match_key = buildMatchKey({ brand, product_code: row.baseCode || '', product_name, base_name, size_tier });
        const dpl = parseFloat(row.dpl) || 0;
        const new_rate = dpl > 0 ? Math.ceil(dpl * 1.18 * 1.10) : null;

        const existing = byKey.get(match_key);
        if (existing) {
            seen.add(match_key);
            updated.push({
                id: existing.id, match_key, zoho_item_id: existing.zoho_item_id,
                old_dpl: existing.current_dpl != null ? parseFloat(existing.current_dpl) : null,
                new_dpl: dpl, new_rate,
            });
        } else {
            newNeedsLinking.push({ match_key, product_name, base_name, size_tier, dpl_size_label: row.packSize, new_dpl: dpl, new_rate });
        }
    }

    const noDplThisTime = (existingCatalog || []).filter(e => !seen.has(e.match_key));
    return { updated, newNeedsLinking, noDplThisTime };
}

// ── DB layer ────────────────────────────────────────────────────

const _COLS = [
    'brand', 'match_key', 'category', 'product_code', 'product_name', 'base_name',
    'size_tier', 'dpl_size_label', 'zoho_item_id', 'canonical_name', 'canonical_sku',
    'canonical_description', 'current_dpl', 'current_rate', 'link_status',
    'link_confidence', 'link_reason', 'updated_by',
];

async function upsertEntries(entries, updatedBy) {
    for (const e of (entries || [])) {
        const row = { ...e, updated_by: updatedBy || null };
        const values = _COLS.map(c => (row[c] === undefined ? null : row[c]));
        const placeholders = _COLS.map(() => '?').join(', ');
        // On conflict (same match_key) update everything except the identity columns.
        const updates = _COLS.filter(c => c !== 'brand' && c !== 'match_key')
            .map(c => `${c} = VALUES(${c})`).join(', ');
        await pool.query(
            `INSERT INTO dpl_catalog (${_COLS.join(', ')}) VALUES (${placeholders})
             ON DUPLICATE KEY UPDATE ${updates}`,
            values
        );
    }
}

async function getCatalog(brand) {
    const [rows] = await pool.query(
        `SELECT * FROM dpl_catalog WHERE brand = ? ORDER BY category, product_name, base_name, size_tier`,
        [brand]
    );
    return rows;
}

async function confirmLink(id, zohoItemId, updatedBy) {
    await pool.query(
        `UPDATE dpl_catalog SET zoho_item_id = ?, link_status = 'confirmed', link_confidence = 100,
            link_reason = 'user-confirmed', updated_by = ? WHERE id = ?`,
        [zohoItemId, updatedBy || null, id]
    );
}

module.exports = {
    setPool, slug, normalizeSizeTier, extractSizeFromZohoName, buildMatchKey,
    linkEntryToZoho, buildCatalogFromDpl, applyDplPrices,
    upsertEntries, getCatalog, confirmLink,
};
