// One-shot smoke test: parse pasted Birla Opus DPL text, match against prod Zoho items.
// Uses the new parseBirlaOpusTabular (inlined here since not yet deployed to prod) +
// existing prod matchWithZohoItems from services/price-list-parser.js.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createPool } = require('./config/database');
const priceListParser = require('./services/price-list-parser');

// ---- inlined from local services/price-list-parser.js (commit cd1f573) ----
function normalizePackSize(s) {
    if (s == null) return '';
    const trimmed = String(s).trim();
    if (!trimmed) return '';
    const m = trimmed.match(/^([\d.]+)\s*(L|ml|kg|gm|g)\s*$/i);
    if (m) {
        const val = m[1];
        const unit = m[2].toLowerCase();
        if (unit === 'l') return `${val}L`;
        return `${val}${unit}`;
    }
    return trimmed;
}

function parseBirlaOpusTabular(text) {
    if (!text || typeof text !== 'string') return [];
    const results = [];
    const lines = text.split('\n');
    let lastProduct = null;
    let lastShade = '';

    for (const rawLine of lines) {
        const line = rawLine.replace(/\s+$/, '');
        if (/^Terms\s+and\s+Conditions/i.test(line.trim())) break;
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^S\.?\s*No\b/i.test(trimmed)) continue;

        let cols = trimmed.split('\t').map(c => c.trim()).filter(c => c.length > 0);
        if (cols.length < 5) {
            cols = trimmed.split(/\s{2,}/).map(c => c.trim()).filter(c => c.length > 0);
        }
        if (cols.length < 5) continue;
        if (!/^\d+$/.test(cols[0])) continue;

        const category = cols[1];
        const productRaw = cols[2];

        let shade, packSize, priceStr;
        if (cols.length >= 6) {
            shade = cols[3];
            packSize = cols[4];
            priceStr = cols[5];
        } else {
            shade = null;
            packSize = cols[3];
            priceStr = cols[4];
        }

        let productName = productRaw;
        let baseCode = '';
        const codeMatch = productRaw.match(/^(.+?)\s*\((\d{6})\)\s*\*?\s*$/);
        if (codeMatch) {
            productName = codeMatch[1].trim();
            baseCode = codeMatch[2];
        }

        if (shade === null) {
            shade = (productName === lastProduct && lastShade) ? lastShade : '';
        } else {
            shade = String(shade).trim();
            if (/^No\s+Base\s*\/\s*Others$/i.test(shade)) shade = '';
        }

        const normalizedPack = normalizePackSize(packSize);
        if (!normalizedPack) continue;

        const priceClean = String(priceStr).replace(/,/g, '').trim();
        if (!/^\d+(\.\d+)?$/.test(priceClean)) continue;
        const dpl = parseFloat(priceClean);
        if (!isFinite(dpl) || dpl <= 0) continue;

        const product = shade ? `${productName} - ${shade}` : productName;
        results.push({ product, packSize: normalizedPack, dpl, category: category || '', brand: 'Birla Opus', baseCode });

        lastProduct = productName;
        lastShade = shade;
    }
    return results;
}
// ---- end inlined ----

const PASTE_CAT_TO_CANON = {
    'INTERIOR LUXURY': 'INTERIOR EMULSION', 'INTERIOR PREMIUM': 'INTERIOR EMULSION',
    'INTERIOR ECONOMY': 'INTERIOR EMULSION',
    'EXTERIOR LUXURY': 'EXTERIOR EMULSION', 'EXTERIOR PREMIUM': 'EXTERIOR EMULSION',
    'EXTERIOR ECONOMY': 'EXTERIOR EMULSION',
    'WATERPROOFING': 'WATERPROOFING',
    'ENAMEL LUXURY': 'ENAMEL', 'ENAMEL PREMIUM': 'ENAMEL', 'ENAMEL ECONOMY': 'ENAMEL',
    'WOOD FINISHES LUXURY': 'WOOD FINISH', 'WOOD FINISHES PREMIUM': 'WOOD FINISH',
    'WOOD FINISHES ECONOMY': 'WOOD FINISH', 'WOOD FINISHES OTHER': 'WOOD FINISH',
};

(async () => {
    const textPath = path.join(__dirname, 'birla-opus-paste-2026-05-10.txt');
    const text = fs.readFileSync(textPath, 'utf8');

    const rawRows = parseBirlaOpusTabular(text);
    console.log(`\n=== PARSE RESULT ===`);
    console.log(`Total parsed rows: ${rawRows.length}`);
    console.log(`Sample first 5:`);
    rawRows.slice(0, 5).forEach((r, i) => console.log(`  ${i+1}.`, r));

    const cleanItems = rawRows.map(r => ({
        product: r.product, packSize: r.packSize, dpl: r.dpl,
        category: PASTE_CAT_TO_CANON[String(r.category || '').toUpperCase().trim()] || r.category || '',
        brand: r.brand, baseCode: r.baseCode,
    }));

    const pool = createPool();
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
    console.log(`\n=== MATCH RESULT ===`);
    console.log(`Auto-matched:  ${matchResult.matched.length}`);
    console.log(`Needs review:  ${matchResult.unmatched.length}`);
    console.log(`Total items:   ${matchResult.matched.length + matchResult.unmatched.length}`);

    console.log(`\n=== TOP 15 AUTO-MATCHED (with Zoho item) ===`);
    const matchedWithZoho = matchResult.matched.filter(m => m.zoho_item_id);
    matchedWithZoho.slice(0, 15).forEach((m, i) => {
        const dplDelta = m.currentDpl ? `${m.currentDpl} → ${m.dpl}` : `(new ${m.dpl})`;
        console.log(`  ${i+1}. [${m.proposed_sku || m.current_sku || '?'}] ${m.product} | ${m.packSize} | DPL ${dplDelta}`);
        if (m.proposed_name) console.log(`       → ${m.proposed_name}`);
    });

    const matchedNoZoho = matchResult.matched.filter(m => !m.zoho_item_id);
    if (matchedNoZoho.length > 0) {
        console.log(`\n=== ${matchedNoZoho.length} ROWS PROCESSED BUT NO ZOHO MATCH ===`);
        matchedNoZoho.slice(0, 5).forEach((m, i) => {
            console.log(`  ${i+1}. ${m.product} | ${m.packSize} | DPL ${m.dpl}`);
        });
    }

    console.log(`\n=== TOP 10 UNMATCHED (needs review) ===`);
    matchResult.unmatched.slice(0, 10).forEach((u, i) => {
        console.log(`  ${i+1}. ${u.product} | ${u.packSize || '?'} | DPL ${u.dpl} | reason: ${u._reject_reason || 'no zoho match'}`);
    });

    console.log(`\n=== SUMMARY ===`);
    console.log(`Matched with Zoho: ${matchedWithZoho.length}`);
    console.log(`Matched no Zoho:   ${matchedNoZoho.length}`);
    console.log(`Unmatched:         ${matchResult.unmatched.length}`);

    await pool.end();
    process.exit(0);
})().catch(e => {
    console.error('SMOKE ERROR:', e.message);
    console.error(e.stack);
    process.exit(1);
});
