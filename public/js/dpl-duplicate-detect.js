/**
 * DPL catalog — detect when one Zoho item is confirmed against more than one
 * catalog entry, and flag which entry is the real (SKU-matching) owner.
 *
 * Pure + side-effect free so it runs in the browser (window.computeDuplicateInfo)
 * and under jest (require). See tests/unit/dpl-duplicate-detect.test.js.
 *
 * Returns a plain object keyed by entry id, for COLLISION entries only:
 *   { [entryId]: { count, role } }
 *   - count: how many confirmed entries share that Zoho item (>= 2)
 *   - role:  'best'      — its product_code matches the shared Zoho SKU (unique)
 *            'wrong'     — a different product wrongly linked to the same item
 *            'ambiguous' — no single SKU match in the group (user must decide)
 * Non-collision entries are absent from the result.
 */
(function (global) {
    function norm(s) { return String(s == null ? '' : s).toUpperCase().trim(); }

    // Does this entry's DPL product code correspond to the linked Zoho SKU?
    function skuMatches(productCode, zohoSku) {
        var pc = norm(productCode);
        var sku = norm(zohoSku);
        if (!pc || !sku) return false;
        return pc === sku || (pc.length >= 3 && sku.indexOf(pc) === 0);
    }

    function computeDuplicateInfo(entries) {
        var groups = {}; // zoho_item_id -> [entry]
        (entries || []).forEach(function (e) {
            if (!e || e.link_status !== 'confirmed' || !e.zoho_item_id) return;
            var key = String(e.zoho_item_id);
            (groups[key] || (groups[key] = [])).push(e);
        });

        var result = {};
        Object.keys(groups).forEach(function (key) {
            var group = groups[key];
            if (group.length < 2) return; // not a collision

            var matches = group.filter(function (e) { return skuMatches(e.product_code, e.zoho_sku); });
            var best = matches.length === 1 ? matches[0] : null;

            group.forEach(function (e) {
                var role = best ? (e === best ? 'best' : 'wrong') : 'ambiguous';
                result[e.id] = { count: group.length, role: role };
            });
        });
        return result;
    }

    var api = { computeDuplicateInfo: computeDuplicateInfo };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else { global.computeDuplicateInfo = computeDuplicateInfo; }
})(typeof window !== 'undefined' ? window : this);
