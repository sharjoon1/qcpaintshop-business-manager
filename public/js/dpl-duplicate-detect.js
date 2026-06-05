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

            // Best = the single entry whose base+size matches the Zoho item's SKU.
            // sku_base_match is computed on the server (Birla base-code aware:
            // white=WT, pastel=1, mid=2, clear=99, yellow=5, red=6).
            var matches = group.filter(function (e) { return e.sku_base_match === true; });
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
