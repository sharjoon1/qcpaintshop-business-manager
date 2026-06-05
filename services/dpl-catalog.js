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

// Colour word → possible Zoho SKU base codes. NOTE: on Birla Opus 99 = CLEAR, NOT
// White — Clear matches via its numeric base ("PE 99" → "pe99") with no rule. White
// is encoded as WT/WHT in SKUs (e.g. PBSWT04). Numeric/unmapped bases pass through.
const BASE_WORD_CODE = { white: ['wt', 'wht'] };

// Birla Opus base WORD → SKU base-code candidate(s). Used by skuBaseMatch to decide
// which of several entries sharing one Zoho item is the real owner.
//   white=WT  pastel=1  mid=2  clear=99  yellow=5  red=6
const BASE_NAME_CODE = {
    white: ['wt', 'wht'],
    pastel: ['1'],
    mid: ['2'],
    clear: ['99'],
    yellow: ['5'],
    red: ['6'],
};

// DPL productCode → exact Zoho SKU, for product families the name/SKU-stem linkers
// can't match (Birla water colorants: Zoho names lack the colour word and the DPL
// base abbreviations don't map to the Zoho suffix). Verified against prod. Solvent
// colorants (970025+) have no OPCL items and are intentionally absent.
const PRODUCT_CODE_SKU = {
    '970001': 'OPCLWT', '970002': 'OPCLBL', '970003': 'OPCLBLU', '970004': 'OPCLOR',
    '970005': 'OPCLMG', '970006': 'OPCLGR', '970007': 'OPCLVI', '970008': 'OPCLINY',
    '970009': 'OPCLINR', '970010': 'OPCLRO', '970011': 'OPCLYO', '970012': 'OPCLEXY',
    '970013': 'OPCLEXR', '970014': 'OPCLEXHR', '970015': 'OPCLEXHDY', '970016': 'OPCLSWT',
};

// DPL baseCode ("PE White" / "PBS White" / "PE 1" / "PE 99") → candidate Zoho SKU
// stems. A colour word expands to its possible codes; numeric/other bases pass through.
function dplBaseStems(baseCode) {
    const bc = String(baseCode == null ? "" : baseCode).trim().toLowerCase();
    if (!bc) return [];
    const m = bc.match(/^([a-z]+)\s+(.+)$/);
    if (!m) return [bc.replace(/[^a-z0-9]+/g, '')];
    const prefix = m[1];
    const baseRaw = m[2].replace(/\s+/g, '');
    const codes = BASE_WORD_CODE[baseRaw] || [baseRaw];
    return codes.map(c => prefix + String(c).replace(/[^a-z0-9]+/g, ""));
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

// Map a base NAME ("White", "Pastel Base") to its candidate SKU base-codes.
function birlaBaseCodes(baseName) {
    const b = String(baseName == null ? '' : baseName).toLowerCase();
    if (!b) return null;
    // Longest key first so a compound base name still resolves to the right word.
    const keys = Object.keys(BASE_NAME_CODE).sort((a, c) => c.length - a.length);
    for (const k of keys) { if (b.indexOf(k) !== -1) return BASE_NAME_CODE[k]; }
    return null;
}

// A base code must sit at the END of the stem, immediately after the (alphabetic)
// product prefix — so a numeric code like '1' doesn't spuriously match the tail of
// a longer number.
function stemEndsWithCode(stem, code) {
    const c = String(code).toLowerCase();
    if (!c || !stem.endsWith(c)) return false;
    const i = stem.length - c.length;
    return i === 0 || /[a-z]/.test(stem[i - 1]);
}

// Does a linked entry's base + size match the SKU of the Zoho item it points to?
// true / false, or null when undeterminable (unknown base, or the Zoho SKU is not a
// cleanly structured Birla SKU). The duplicate-link UI uses this to pick which entry
// among several sharing one Zoho item is the real owner (e.g. TF110 = pastel, not white).
function skuBaseMatch(entry) {
    const e = entry || {};
    const codes = birlaBaseCodes(e.base_name);
    if (!codes) return null;
    const info = zohoSkuStem({ sku: e.zoho_sku, name: e.zoho_name });
    if (!info) return null;
    if (e.size_tier && info.tier !== e.size_tier) return false;
    return codes.some(c => stemEndsWithCode(info.stem, c));
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
//   S1 SKU reconstruction: dplBaseStems(base_code) + size-code == Zoho SKU stems (95, confirmed)
//   S2 name product-token + tier fallback (≤70, REVIEW only — names lack base, can't confirm)
//   else needs_creating.
// NOTE: entry.size_tier MUST already be a canonical tier. Size is matched by TIER,
// so a DPL off-size base (e.g. White 3.6L → tier 4L) links to the Zoho 4L SKU.
function linkEntryToZoho(entry, zohoItems) {
    const items = zohoItems || [];

    // SM: explicit productCode→SKU map (curated families the other strategies can't
    // match — e.g. colorants). Exact SKU + tier-checked, so a different-size entry
    // won't grab the only (1L) mapped item.
    const mapSku = entry.product_code && PRODUCT_CODE_SKU[String(entry.product_code).trim()];
    if (mapSku) {
        const want = String(mapSku).toUpperCase();
        const hit = items.find(z => {
            const sku = String(z.sku || z.zoho_sku || '').toUpperCase();
            if (sku !== want) return false;
            const tier = normalizeSizeTier(extractSizeFromZohoName(z.name || z.zoho_item_name || '', sku));
            return tier === entry.size_tier;
        });
        if (hit) return { zoho_item_id: hit.zoho_item_id, link_status: 'confirmed', link_confidence: 95, link_reason: 'colorant-map' };
    }

    // S0: exact canonical SKU
    if (entry.canonical_sku) {
        const want = String(entry.canonical_sku).toUpperCase();
        const hit = items.find(z => String(z.sku || z.zoho_sku || '').toUpperCase() === want);
        if (hit) return { zoho_item_id: hit.zoho_item_id, link_status: 'confirmed', link_confidence: 100, link_reason: 'exact-sku' };
    }

    // S1: SKU reconstruction (PRIMARY — deterministic). A colour word yields several
    // candidate stems (e.g. White → wt/wht); a unique hit across them confirms.
    const stems = dplBaseStems(entry.base_code);
    if (stems.length && SIZE_CODE[entry.size_tier]) {
        const hits = items.filter(z => {
            const s = zohoSkuStem(z);
            return s && stems.includes(s.stem) && s.tier === entry.size_tier;
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

// `existingCatalog` (optional) lets a rebuild PRESERVE user decisions the fresh linker
// can't re-derive: a manually-confirmed link, or one that was already pushed to Zoho.
// Without this the ON DUPLICATE KEY upsert clobbers a confirmed entry back to 'review'.
function buildCatalogFromDpl(brand, parsedRows, zohoItems, existingCatalog) {
    const existingByKey = new Map((existingCatalog || []).map(e => [e.match_key, e]));
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

        // Preserve a prior user decision the linker can't reproduce: an explicit confirm
        // (link_reason='user-confirmed') OR an entry that was already pushed to Zoho
        // (pushed_at set ⇒ it must have been confirmed). Carry over the link + the user's
        // canonical values so a rebuild never silently reverts it to 'review'.
        const prev = existingByKey.get(entry.match_key);
        if (prev && prev.zoho_item_id && (prev.link_reason === 'user-confirmed' || prev.pushed_at != null)) {
            entry.zoho_item_id = prev.zoho_item_id;
            entry.link_status = 'confirmed';
            entry.link_confidence = 100;
            entry.link_reason = 'user-confirmed';
            entry.canonical_name = prev.canonical_name != null ? prev.canonical_name : entry.canonical_name;
            entry.canonical_sku = prev.canonical_sku != null ? prev.canonical_sku : entry.canonical_sku;
            entry.canonical_description = prev.canonical_description != null ? prev.canonical_description : entry.canonical_description;
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

// Delete catalog rows for a brand whose match_key is NOT in the freshly-built set
// (self-cleaning rebuild — removes products no longer in the DPL). Empty keepKeys
// is a no-op so a failed/empty build can never wipe the table.
async function deleteOrphans(brand, keepKeys) {
    if (!keepKeys || !keepKeys.length) return 0;
    const [r] = await pool.query(
        `DELETE FROM dpl_catalog WHERE brand = ? AND match_key NOT IN (${keepKeys.map(() => '?').join(', ')})`,
        [brand, ...keepKeys]
    );
    return r.affectedRows || 0;
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
    // LEFT JOIN the live Zoho item so each linked entry carries the real SKU/name.
    // zoho_sku powers the duplicate-link best-match check; zoho_name lets the UI
    // show the current Zoho name. Both are null for unlinked entries.
    const [rows] = await pool.query(
        `SELECT d.*, z.zoho_sku AS zoho_sku, z.zoho_item_name AS zoho_name
           FROM dpl_catalog d
           LEFT JOIN zoho_items_map z ON z.zoho_item_id = d.zoho_item_id
          WHERE d.brand = ?
          ORDER BY d.category, d.product_name, d.base_name, d.size_tier`,
        [brand]
    );
    // Per-entry: does this linked entry's base+size match its Zoho item's SKU?
    // Drives the duplicate-link "best match" verdict in the UI. Birla-only for now.
    const isBirla = /birla/i.test(String(brand || ''));
    for (const r of rows) {
        r.sku_base_match = (isBirla && r.zoho_item_id) ? skuBaseMatch(r) : null;
    }
    return rows;
}

// Recompute canonical name/sku/description for an entry from its CURRENTLY linked
// Zoho item (re-runs the Birla proposer). proposed_sku = the linked item's own SKU,
// so canonical_sku tracks the link and push never renames it. Fields may be null.
function reconcileCanonical(entry, zohoItem) {
    const e = entry || {};
    const z = zohoItem || {};
    const product = e.base_name ? `${e.product_name || ''} - ${e.base_name}` : (e.product_name || '');
    const pf = computeProposedFields(
        { product, packSize: e.dpl_size_label || e.size_tier || '', dpl: parseFloat(e.current_dpl) || 0, category: e.category || '' },
        { sku: z.zoho_sku || z.sku || '', description: z.zoho_description || z.description || '', category: z.zoho_category_name || z.category || '' },
        'birlaopus'
    );
    return {
        canonical_name: pf.proposed_name || null,
        canonical_sku: pf.proposed_sku || null,
        canonical_description: pf.proposed_description || null,
    };
}

async function confirmLink(id, zohoItemId, updatedBy) {
    // Recompute the canonical fields against the newly linked item so the SKU/name
    // never drift from a previous link (the cause of duplicate-SKU push failures).
    const [erows] = await pool.query('SELECT * FROM dpl_catalog WHERE id = ?', [id]);
    const [zrows] = await pool.query(
        'SELECT zoho_sku, zoho_description, zoho_category_name FROM zoho_items_map WHERE zoho_item_id = ?',
        [zohoItemId]
    );
    if (erows.length && zrows.length) {
        const c = reconcileCanonical(erows[0], zrows[0]);
        await pool.query(
            `UPDATE dpl_catalog SET zoho_item_id = ?, link_status = 'confirmed', link_confidence = 100,
                link_reason = 'user-confirmed', canonical_name = ?, canonical_sku = ?, canonical_description = ?,
                not_in_zoho = 0, updated_by = ? WHERE id = ?`,
            [zohoItemId, c.canonical_name, c.canonical_sku, c.canonical_description, updatedBy || null, id]
        );
        return;
    }
    // Fallback: entry or Zoho item not found — original link-only update.
    await pool.query(
        `UPDATE dpl_catalog SET zoho_item_id = ?, link_status = 'confirmed', link_confidence = 100,
            link_reason = 'user-confirmed', not_in_zoho = 0, updated_by = ? WHERE id = ?`,
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

// Stamp the push state on entries that were just pushed (job created). These columns
// are NOT in _COLS, so a later rebuild preserves them.
async function markPushed(rows, jobId) {
    for (const r of (rows || [])) {
        await pool.query(
            `UPDATE dpl_catalog SET pushed_at = NOW(), pushed_job_id = ?, pushed_dpl = ?, pushed_rate = ? WHERE id = ?`,
            [jobId, r.dpl != null ? r.dpl : null, r.rate != null ? r.rate : null, r.id]
        );
    }
}

// Mark/unmark an entry as "not in Zoho (pending creation)". Marking REJECTS the
// (often wrong) auto-link: it unlinks and clears the canonical fields so the entry
// moves to the Pending filter. Kept out of _COLS so the flag survives rebuilds.
async function setNotInZoho(id, value, updatedBy) {
    if (value) {
        await pool.query(
            `UPDATE dpl_catalog SET not_in_zoho = 1, zoho_item_id = NULL, link_status = 'needs_creating',
                link_confidence = 0, link_reason = 'marked-not-in-zoho',
                canonical_name = NULL, canonical_sku = NULL, canonical_description = NULL,
                updated_by = ? WHERE id = ?`,
            [updatedBy || null, id]
        );
    } else {
        await pool.query(
            `UPDATE dpl_catalog SET not_in_zoho = 0, updated_by = ? WHERE id = ?`,
            [updatedBy || null, id]
        );
    }
}

// After a rebuild, re-unlink any entries the user marked not-in-Zoho (the linker would
// otherwise re-attach the wrong item). Keeps marked items in Pending across rebuilds.
async function unlinkMarked(brand) {
    const [r] = await pool.query(
        `UPDATE dpl_catalog SET zoho_item_id = NULL, link_status = 'needs_creating', link_confidence = 0,
            link_reason = 'marked-not-in-zoho', canonical_name = NULL, canonical_sku = NULL, canonical_description = NULL
         WHERE brand = ? AND not_in_zoho = 1 AND zoho_item_id IS NOT NULL`,
        [brand]
    );
    return r.affectedRows || 0;
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
    dplBaseStems, zohoSkuStem, skuBaseMatch, linkEntryToZoho, buildCatalogFromDpl, applyDplPrices,
    buildPushChanges, upsertEntries, deleteOrphans, unlinkMarked, getCatalog, reconcileCanonical, confirmLink,
    updateAppliedPrices, updateCanonicalFields, markPushed, setNotInZoho,
};
