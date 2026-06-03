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

// ── SKU reconstruction (the real Birla Zoho match key) ───────────
// Real Zoho Birla item NAMES carry no base/shade; the base is encoded in the
// SKU as {ProductShort}{Base}{SizeCode}: PE9901 = One Pure Elegance White 1L
// (PE+99+01), PE101 = Pastel/Base1 (PE+1+01). The DPL `baseCode` field
// ("PE White", "PE 1") encodes ProductShort+Base and equals the Zoho SKU minus
// its size-code — that is the deterministic match (validated on real data:
// 245 clean matches, 0 ambiguous).

// Per-tier Zoho SKU size-code suffix.
const SIZE_CODE = { '1L': '01', '4L': '04', '10L': '10', '20L': '20' };

// Colour-word → Zoho base segment (numeric bases pass through; words need a map).
// Extend as new special bases surface; unmapped ones fall to review.
const BASE_WORD_CODE = { white: '99' };

// DPL baseCode ("PE White" / "PE 1") → SKU stem ("pe99" / "pe1").
function dplBaseStem(baseCode) {
    const bc = String(baseCode == null ? '' : baseCode).trim().toLowerCase();
    if (!bc) return '';
    const m = bc.match(/^([a-z]+)\s+(.+)$/);
    if (!m) return bc.replace(/[^a-z0-9]+/g, '');
    let base = m[2].replace(/\s+/g, '');
    base = BASE_WORD_CODE[base] || base;
    return m[1] + base.replace(/[^a-z0-9]+/g, '');
}

// Zoho item → { stem, tier } when its SKU ends with the expected size-code for
// its tier (a cleanly structured Birla SKU); else null.
function zohoSkuStem(zi) {
    const name = zi.name || zi.zoho_item_name || '';
    const sku = String(zi.sku || zi.zoho_sku || '').toLowerCase();
    const tier = normalizeSizeTier(extractSizeFromZohoName(name, sku));
    const sc = SIZE_CODE[tier];
    if (!sc || !sku.endsWith(sc)) return null;
    return { stem: sku.slice(0, -sc.length), tier };
}

// Tokenize a string into lowercase alphanumeric word tokens (for the name fallback).
function tokenize(s) {
    return String(s == null ? '' : s).toLowerCase().match(/[a-z0-9]+/g) || [];
}
function hasAllTokens(tokenSet, needleTokens) {
    return needleTokens.length > 0 && needleTokens.every(t => tokenSet.has(t));
}

// Link one catalog entry to exactly one Zoho item.
//   S0 exact canonical SKU (100, confirmed) — re-match of a pinned entry
//   S1 SKU reconstruction: dplBaseStem(base_code) + size-code == Zoho SKU stem (95, confirmed)
//   S2 name product-token + tier fallback (≤70, REVIEW only — names lack base, can't confirm)
//   else needs_creating.
// NOTE: entry.size_tier MUST already be a canonical tier. Size is matched by TIER,
// so a DPL off-size base (e.g. White 3.6L → tier 4L) links to the Zoho 4L SKU.
function linkEntryToZoho(entry, zohoItems) {
    const items = zohoItems || [];

    // S0: exact canonical SKU
    if (entry.canonical_sku) {
        const want = String(entry.canonical_sku).toUpperCase();
        const hit = items.find(z => String(z.sku || z.zoho_sku || '').toUpperCase() === want);
        if (hit) return { zoho_item_id: hit.zoho_item_id, link_status: 'confirmed', link_confidence: 100, link_reason: 'exact-sku' };
    }

    // S1: SKU reconstruction (PRIMARY — deterministic)
    const stem = dplBaseStem(entry.base_code);
    if (stem && SIZE_CODE[entry.size_tier]) {
        const hits = items.filter(z => {
            const s = zohoSkuStem(z);
            return s && s.stem === stem && s.tier === entry.size_tier;
        });
        if (hits.length === 1) return { zoho_item_id: hits[0].zoho_item_id, link_status: 'confirmed', link_confidence: 95, link_reason: 'sku-reconstruct' };
        if (hits.length > 1) return { zoho_item_id: null, link_status: 'review', link_confidence: 55, link_reason: 'ambiguous-sku' };
    }

    // S2: name product+tier fallback → REVIEW (names carry no base; cannot confirm a base)
    const eProd = tokenize(entry.product_name);
    if (eProd.length) {
        const probes = items.map(z => {
            const name = z.name || z.zoho_item_name || '';
            const sku = z.sku || z.zoho_sku || '';
            return { zi: z, tokens: new Set(tokenize(name + ' ' + sku)), tier: normalizeSizeTier(extractSizeFromZohoName(name, sku)) };
        });
        const s2 = probes.filter(p => hasAllTokens(p.tokens, eProd) && p.tier === entry.size_tier);
        if (s2.length === 1) return { zoho_item_id: s2[0].zi.zoho_item_id, link_status: 'review', link_confidence: 70, link_reason: 'product+tier-only' };
        if (s2.length > 1) return { zoho_item_id: null, link_status: 'review', link_confidence: 50, link_reason: 'ambiguous-product+tier' };
    }

    return { zoho_item_id: null, link_status: 'needs_creating', link_confidence: 0, link_reason: 'no-match' };
}

// Split the tabular parser's merged "Name - Shade" product field.
function splitProductBase(product) {
    const s = String(product || '');
    const idx = s.lastIndexOf(' - ');
    if (idx === -1) return { product_name: s.trim(), base_name: '' };
    return { product_name: s.slice(0, idx).trim(), base_name: s.slice(idx + 3).trim() };
}

// Normalize a parsed DPL row into the consistent fields the catalog uses.
// Prefers the CSV-parser shape (productCode/colourCode/colourName/baseCode);
// falls back to the tabular shape (baseCode = 6-digit code, product = "Name - Shade").
function normalizeRow(row) {
    const split = splitProductBase(row.product);
    const dpl = parseFloat(row.dpl) || 0;
    return {
        product_code: String(row.productCode || row.baseCode || '').trim(),
        product_name: row.productName || split.product_name,
        base_name: row.colourName || split.base_name,
        base_code: row.baseCode || '',          // "PE White" — SKU-stem source (CSV shape)
        size_tier: normalizeSizeTier(row.packSize),
        dpl_size_label: row.packSize || null,
        dpl,
        category: row.category || null,
    };
}

function buildCatalogFromDpl(brand, parsedRows, zohoItems) {
    const out = [];
    for (const row of (parsedRows || [])) {
        const n = normalizeRow(row);
        const entry = {
            brand,
            category: n.category,
            product_code: n.product_code,
            product_name: n.product_name,
            base_name: n.base_name,
            base_code: n.base_code,
            size_tier: n.size_tier,
            dpl_size_label: n.dpl_size_label,
            current_dpl: n.dpl || null,
            current_rate: n.dpl > 0 ? Math.ceil(n.dpl * 1.18 * 1.10) : null,
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
                    { product: row.product, packSize: row.packSize, dpl: n.dpl, category: n.category },
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
        const n = normalizeRow(row);
        const match_key = buildMatchKey({ brand, product_code: n.product_code, product_name: n.product_name, base_name: n.base_name, size_tier: n.size_tier });
        const new_rate = n.dpl > 0 ? Math.ceil(n.dpl * 1.18 * 1.10) : null;

        const existing = byKey.get(match_key);
        if (existing) {
            seen.add(match_key);
            updated.push({
                id: existing.id, match_key, zoho_item_id: existing.zoho_item_id,
                link_status: existing.link_status,
                product_name: existing.product_name, base_name: existing.base_name,
                size_tier: existing.size_tier, dpl_size_label: existing.dpl_size_label,
                canonical_name: existing.canonical_name, canonical_sku: existing.canonical_sku,
                canonical_description: existing.canonical_description,
                old_dpl: existing.current_dpl != null ? parseFloat(existing.current_dpl) : null,
                old_rate: existing.current_rate != null ? parseFloat(existing.current_rate) : null,
                new_dpl: n.dpl, new_rate,
            });
        } else {
            newNeedsLinking.push({ match_key, product_name: n.product_name, base_name: n.base_name, size_tier: n.size_tier, dpl_size_label: n.dpl_size_label, new_dpl: n.dpl, new_rate });
        }
    }

    const noDplThisTime = (existingCatalog || []).filter(e => !seen.has(e.match_key));
    return { updated, newNeedsLinking, noDplThisTime };
}

// Build the per-item `changes` payload for a bulk-edit push from a confirmed
// catalog entry. Prices are always pushed; name/sku/description/category are
// pushed ONLY when the canonical value is non-empty AND differs from the
// current Zoho value (avoids needless writes + SKU-collision churn).
// Returns null when the entry has no DPL to push.
function buildPushChanges(entry, zohoCurrent) {
    const dpl = entry.current_dpl != null ? parseFloat(entry.current_dpl) : null;
    if (!(dpl > 0)) return null;
    const rate = entry.current_rate != null ? parseFloat(entry.current_rate) : Math.ceil(dpl * 1.18 * 1.10);
    const changes = { cf_dpl: dpl, purchase_rate: dpl, rate };
    const z = zohoCurrent || {};
    const diff = (canon, current) => {
        const c = (canon == null ? '' : String(canon)).trim();
        return c && c !== String(current == null ? '' : current).trim();
    };
    if (diff(entry.canonical_name, z.name)) changes.name = String(entry.canonical_name).trim();
    if (diff(entry.canonical_sku, z.sku)) changes.sku = String(entry.canonical_sku).trim();
    if (diff(entry.canonical_description, z.description)) changes.description = String(entry.canonical_description).trim();
    if (diff(entry.category, z.category)) changes.category = String(entry.category || '').trim();
    return changes;
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

// Update user-editable canonical fields on an entry. Only keys present in `fields`
// are written (undefined keys untouched); a provided value is trimmed; '' clears it.
// Returns false (no query) when nothing was provided.
async function updateCanonicalFields(id, fields, updatedBy) {
    const editable = ['canonical_name', 'canonical_sku', 'canonical_description'];
    const sets = [];
    const vals = [];
    for (const key of editable) {
        if (fields && fields[key] !== undefined) {
            sets.push(`${key} = ?`);
            vals.push(fields[key] === null ? null : String(fields[key]).trim());
        }
    }
    if (!sets.length) return false;
    sets.push('updated_by = ?');
    vals.push(updatedBy || null);
    vals.push(id);
    await pool.query(`UPDATE dpl_catalog SET ${sets.join(', ')} WHERE id = ?`, vals);
    return true;
}

// Persist freshly-applied DPL prices onto matched catalog rows (local only).
async function updateAppliedPrices(rows, updatedBy) {
    for (const r of (rows || [])) {
        await pool.query(
            `UPDATE dpl_catalog SET current_dpl = ?, current_rate = ?, updated_by = ? WHERE id = ?`,
            [r.new_dpl, r.new_rate, updatedBy || null, r.id]
        );
    }
}

module.exports = {
    setPool, slug, normalizeSizeTier, extractSizeFromZohoName, buildMatchKey,
    dplBaseStem, zohoSkuStem, linkEntryToZoho, buildCatalogFromDpl, applyDplPrices,
    buildPushChanges, upsertEntries, getCatalog, confirmLink, updateAppliedPrices, updateCanonicalFields,
};
