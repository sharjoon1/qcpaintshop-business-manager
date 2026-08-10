/**
 * Catalog base-key extraction for painter catalog products.
 *
 * In Zoho Books, every product variant (base × pack size) is a separate item.
 * Emulsion families ship multiple tint bases (Birla: CS1/CS2/CS5/CS99/CSWT,
 * Berger: N/N1/N2/P1/PO/Y/WT, Shalimar: MATT/SILK/VELVET/...). The painter
 * catalog must show ONE main base per product (with all its pack sizes), so we
 * derive a stable `baseKey` per item from its SKU / normalized item name.
 *
 * Rules are brand-aware (the dash-separated name layout differs per brand) with
 * a safe generic fallback: baseKey === null means "no base grouping" and the
 * catalog keeps showing every pack size (current behaviour).
 *
 * Expected item-name shape (AI-normalized, Aug 2026):
 *   "CS101 - STYLE COLOR SMART - INTERIOR EMULSION - Birla Opus - 01 L"
 *   "BS01  - N ANTIDUST EMULSION   - INTERIOR EMULSION - Berger Paints - 01 L"
 *   "ACCENT - HERO PREMIUM INT EMULSION - INTERIOR EMULSION - Shalimar - 04L"
 */

'use strict';

const BASE_TOKEN_RE = /^(N1|N2|P1|PO|WT|Y|N)\s*/i; // Berger base prefixes

/**
 * Split an AI-normalized dashed item name into segments.
 * @param {string} name
 * @returns {string[]|null}
 */
function splitDashed(name) {
    if (!name || name.indexOf(' - ') === -1) return null;
    const parts = name.split(' - ').map((p) => p.trim()).filter(Boolean);
    return parts.length ? parts : null;
}

/**
 * Extract the trailing pack size ("01 L", "04L", "500 ML", "20 KG") from a name.
 * @param {string} name
 * @returns {string|null}
 */
function extractSizeLabel(name) {
    const m = String(name || '').match(/(\d+(?:\.\d+)?)\s*(L|LT|LTR|LITRE|LITRES|LITER|LITERS|KG|KGS|GM|G|GRAMS|ML|M|PC|PCS|PIECES|NOS)\b/i);
    return m ? `${m[1]} ${m[2]}` : null;
}

/**
 * Birla Opus SKU -> base key.
 *   CS101  -> CS1   (series CS + base 1 + size 01)
 *   CSWT01 -> CSWT  (white base)
 *   CSS101 -> CSS1
 *   CF1301 -> CF13  (series CF + base 13 + size 01)
 *   NS9901 -> NS99
 * @param {string} code
 * @returns {string|null}
 */
function birlaBaseFromCode(code) {
    if (!code) return null;
    const m = String(code).toUpperCase().match(/^([A-Z]+)(\d{0,3})(WT)?(\d{2})$/);
    if (!m) return null;
    const letters = m[1];
    const digits = m[2] || '';
    const wt = m[3] || '';
    return (letters + wt + digits) || null;
}

/**
 * Berger base from the second name segment (e.g. "N ANTIDUST EMULSION" -> N).
 * @param {string} seg2
 * @returns {{base: string|null, series: string}}
 */
function bergerBaseFromSegment(seg2) {
    const s = String(seg2 || '').trim();
    const m = s.match(BASE_TOKEN_RE);
    if (m) {
        return { base: m[1].toUpperCase(), series: s.slice(m[0].length).trim() };
    }
    return { base: null, series: s };
}

/**
 * Parse an item into { series, baseKey }.
 * @param {string} itemName  zoho_items_map.zoho_item_name
 * @param {string} [sku]     zoho_items_map.sku (may be empty)
 * @param {string} [brand]   zoho_items_map.zoho_brand
 * @returns {{series: string|null, baseKey: string|null}}
 */
function parseBase(itemName, sku, brand) {
    const name = String(itemName || '').trim();
    if (!name) return { series: null, baseKey: null };

    const parts = splitDashed(name);
    const b = String(brand || '').trim().toUpperCase();
    const code = String(sku || '').trim().toUpperCase();

    // ── Birla Opus: "CS101 - STYLE COLOR SMART - INTERIOR EMULSION - Birla Opus - 01 L"
    if (b.indexOf('BIRLA') !== -1) {
        if (parts && parts.length >= 2) {
            const series = parts[1];
            const baseKey = birlaBaseFromCode(code || parts[0]);
            return { series, baseKey };
        }
        return { series: null, baseKey: null };
    }

    // ── Berger Paints: "BS01 - N ANTIDUST EMULSION - INTERIOR EMULSION - Berger Paints - 01 L"
    if (b.indexOf('BERGER') !== -1) {
        if (parts && parts.length >= 2) {
            const { base, series } = bergerBaseFromSegment(parts[1]);
            return { series, baseKey: base };
        }
        return { series: null, baseKey: null };
    }

    // ── Shalimar: "ACCENT - HERO PREMIUM INT EMULSION - INTERIOR EMULSION - Shalimar Paints - 04L"
    if (b.indexOf('SHALIMAR') !== -1) {
        if (parts && parts.length >= 2) {
            return { series: parts[0], baseKey: parts[1] };
        }
        return { series: null, baseKey: null };
    }

    // ── Asian Paints: "AP - ACE EXT EML AC17 3.6 LT -OWN - EXTERIOR EMULSION - Asian Paints - Nos"
    //    Segment 2 embeds the size ("ACE EXT EML AC17 3.6 LT -OWN") and the final
    //    unit is "Nos" — strip the trailing " <size> -OWN" so the series is the
    //    product name and the size comes from the embedded token.
    if (b.indexOf('ASIAN') !== -1) {
        if (parts && parts.length >= 2) {
            let series = parts[1] || null;
            if (series) {
                series = String(series)
                    .replace(/\s*-?\s*OWN\s*$/i, '')
                    .replace(/\s+\d+(?:\.\d+)?\s*(L|LT|LTR|LITRE|LITRES|KG|KGS|ML|GM|G)\b/i, '')
                    .trim();
            }
            return { series, baseKey: null };
        }
        return { series: null, baseKey: null };
    }

    // ── Generic fallback (enamels / stainers / colours / tools): no base grouping
    if (parts && parts.length >= 2) {
        return { series: parts.length >= 3 ? parts[1] : parts[0], baseKey: null };
    }
    return { series: null, baseKey: null };
}

// Product-ish keywords used to gate series confidence for brands whose names are
// inconsistently normalized (Generic, Crizon, Addisons, ...). A series must
// contain one of these to be auto-imported; everything else is left for a
// manual/curated pass (avoids junk products like "BR", "IV", "RD", "PO").
const PRODUCT_KEYWORD = new RegExp(
    'EMUL|PRIM|ENAM|PUTTY|STAIN|COLOUR|COLORANT|THINN|SEAL|POLISH|WATER|DISTEM|PAINT|' +
    'LACQ|VARN|ADHES|TOOLS|BRUSH|ROLL|PAPER|CEMENT|MELAM|CLEAN|CRACK|RUST|GLAZE|COAT|' +
    'MARINE|ANTIFOUL|EPOXY|COAL|BITU|TAR|DAMP|REPAIR|FLEX|SMOOTH|BISON|GLOW|LITE|FEASY|' +
    'ANTIDUST|WALMASTA|RANGOLI|ACCENT|ELEGANCE|STAR|BRIGHT|LOOK|LIFE|VISION|CLEAR|WASH|' +
    'HIDE|EVER|FLOOR|SHADE|TERRA|MELAMINE|GLOSSY|MATT|SILK|VELVET|PEARL|SHAKTIMAN|TOUGH|' +
    'PLASTER|SANDING|WOOD|STEEL|ALUMINIUM|COPPER|BRASS|HAMMER|TEXTURE|DUAL|PREMIUM|SIGN|' +
    'ECO|SHINE|MASTER|TILE|WALL|FILLER|GROUT|REMOVER|WASTE|STICK|KIT|TAPE|' +
    'ACE|APEX|ROYALE|TRACTOR|SHYNE|APCO|ULTIMA|PROTEK|ENL|ADV|CLASC|SANDSTN|SHEATHIN|' +
    'TESHYNE|CRTX|PLYMR|AC17|AC21G|AC2G|AC9G|AH10|AH2|AB11|AB12|AB17|AB2|AB6|HQ17|' +
    'HQ20N|HQ2N|AS11|AS22|SN3|SN21|UP20|AV6|' +
    'BLADE|TRAY|STENCIL|HANDLE|POWDER|KAVY|GERMAN|ORDINARY|SURYA|VANAVIL|ROBIN|OXIDE|' +
    'CHALK|CLOTH|COLOUR|PLASTIC|MASKING|TERMINATOR|FEVICOL|ARALDITE|POP|MAHALASA|' +
    'BITUCOAT|HEAT|GAURD|GUARD|KRACK|MULTI|BRUSH',
    'i'
);

/**
 * Confidence gate for auto-importing an item's series.
 * Birla / Berger / Shalimar names are validated patterns → always confident.
 * Other brands need a product-ish keyword in the series (≥3 chars) so we never
 * create junk products named after base codes or colour words.
 * @param {string|null} series
 * @param {string} [brand]
 * @returns {boolean}
 */
function isSeriesConfident(series, brand) {
    const s = String(series || '').trim();
    if (!s) return false;
    const b = String(brand || '').toUpperCase();
    const validatedBrand = b.indexOf('BIRLA') !== -1 || b.indexOf('BERGER') !== -1 || b.indexOf('SHALIMAR') !== -1;
    if (validatedBrand) {
        // The Aug-2026 AI name normalization stripped the series word from some
        // items, leaving only the tint-base code as segment 2 ("FLXBR01L - BR -
        // INTERIOR EMULSION - ..."). A bare base code is NOT a series — require a
        // multi-word name or a product-ish keyword so we never create junk
        // products named "BR", "IV", "RD", "W1", "CS6", "ECM1", ...
        if (s.length < 3) return false;
        if (s.indexOf(' ') !== -1) return true;
        return PRODUCT_KEYWORD.test(s);
    }
    if (s.length < 3) return false;
    return PRODUCT_KEYWORD.test(s);
}

/**
 * Choose the default main base for a product from its pack base keys.
 * Prefers the base with the most pack sizes, then WT / lowest-numbered base.
 * @param {Array<string|null>} baseKeys
 * @returns {string|null}
 */
function pickMainBase(baseKeys) {
    const counts = new Map();
    for (const k of baseKeys) {
        if (!k) continue;
        counts.set(k, (counts.get(k) || 0) + 1);
    }
    if (counts.size === 0) return null;
    const entries = [...counts.entries()];
    entries.sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];          // most packs first
        const aWT = /WT$/i.test(a[0]) ? 0 : 1;
        const bWT = /WT$/i.test(b[0]) ? 0 : 1;
        if (aWT !== bWT) return aWT - bWT;               // WT preferred
        const aN = parseInt(a[0].replace(/\D/g, ''), 10) || 999;
        const bN = parseInt(b[0].replace(/\D/g, ''), 10) || 999;
        return aN - bN;                                  // lowest base number
    });
    return entries[0][0];
}

module.exports = { parseBase, pickMainBase, splitDashed, extractSizeLabel, birlaBaseFromCode, bergerBaseFromSegment, isSeriesConfident, PRODUCT_KEYWORD };
