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

// Build a (productMatch, baseMatch, sizeTier) probe for a Zoho item.
function zohoProbe(zi) {
    const name = zi.name || zi.zoho_item_name || '';
    const sku = zi.sku || zi.zoho_sku || '';
    return {
        zi,
        nameSlug: slug(name + ' ' + sku),
        sizeTier: normalizeSizeTier(extractSizeFromZohoName(name, sku)),
    };
}

// Link one catalog entry to exactly one Zoho item — DETERMINISTIC, no fuzzy abbrev.
//   S1 exact canonical SKU (100)
//   S2 product-name + base contained in the Zoho name AND size-tier equal (90, confirmed)
//   S3 product-name contained + size-tier equal, base ignored (70, review)
//   else needs_creating.
// Size is always compared by TIER, so a DPL 900ml entry (tier 1L) links to a Zoho 1L item.
function linkEntryToZoho(entry, zohoItems) {
    const items = zohoItems || [];

    // S1
    if (entry.canonical_sku) {
        const want = String(entry.canonical_sku).toUpperCase();
        const hit = items.find(z => String(z.sku || z.zoho_sku || '').toUpperCase() === want);
        if (hit) return { zoho_item_id: hit.zoho_item_id, link_status: 'confirmed', link_confidence: 100, link_reason: 'exact-sku' };
    }

    const eProd = slug(entry.product_name);
    const eBase = slug(entry.base_name);
    const eTier = entry.size_tier;
    const probes = items.map(zohoProbe);

    // S2: product + base + tier
    const s2 = probes.filter(p =>
        eProd && p.nameSlug.includes(eProd) && p.sizeTier === eTier &&
        (eBase === '' ? true : p.nameSlug.includes(eBase))
    );
    if (s2.length === 1) return { zoho_item_id: s2[0].zi.zoho_item_id, link_status: 'confirmed', link_confidence: 90, link_reason: 'product+base+tier' };
    if (s2.length > 1) return { zoho_item_id: null, link_status: 'review', link_confidence: 60, link_reason: 'ambiguous-product+base+tier' };

    // S3: product + tier (any base) — softer, needs review
    const s3 = probes.filter(p => eProd && p.nameSlug.includes(eProd) && p.sizeTier === eTier);
    if (s3.length === 1) return { zoho_item_id: s3[0].zi.zoho_item_id, link_status: 'review', link_confidence: 70, link_reason: 'product+tier-only' };
    if (s3.length > 1) return { zoho_item_id: null, link_status: 'review', link_confidence: 50, link_reason: 'ambiguous-product+tier' };

    return { zoho_item_id: null, link_status: 'needs_creating', link_confidence: 0, link_reason: 'no-match' };
}

module.exports = { setPool, slug, normalizeSizeTier, extractSizeFromZohoName, buildMatchKey, linkEntryToZoho };
