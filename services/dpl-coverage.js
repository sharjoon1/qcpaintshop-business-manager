/**
 * Coverage helpers for the DPL paste/match flow.
 *
 * The same logic is also inlined inside `public/admin-dpl.html` because the
 * static frontend cannot `require()` Node modules. Both copies must stay
 * in sync — keep them small and obvious.
 */

/**
 * Compute the subset of Zoho items that no DPL row points at.
 *
 * @param {Array<{auto_match?: {zoho_item_id?: string|null}}>} items   DPL rows from the match payload
 * @param {Array<{zoho_item_id: string}>} zohoItems                    Brand-scoped Zoho catalog rows
 * @returns {Array<object>} Subset of zohoItems whose id is not referenced
 *                          by any item's auto_match.zoho_item_id.
 */
function computeZohoUncovered(items, zohoItems) {
    const matchedIds = new Set();
    (items || []).forEach(function(r) {
        if (r && r.auto_match && r.auto_match.zoho_item_id) {
            matchedIds.add(r.auto_match.zoho_item_id);
        }
    });
    return (zohoItems || []).filter(function(z) {
        return !matchedIds.has(z.zoho_item_id);
    });
}

module.exports = { computeZohoUncovered };
