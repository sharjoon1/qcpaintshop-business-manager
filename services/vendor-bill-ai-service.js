/**
 * Vendor Bill AI Service
 * Scans bill images via KAI (Clawdbot), extracts items,
 * matches to Zoho products, verifies staff entries.
 */

const fs = require('fs');
const path = require('path');
const aiEngine = require('./ai-engine');

let pool;
function setPool(p) { pool = p; }

// ─── MIME type lookup ──────────────────────────────────────────

const MIME_TYPES = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp'
};

// ─── scanBillImage ─────────────────────────────────────────────

const BILL_EXTRACT_SYSTEM_PROMPT = `You are an expert at reading Indian GST vendor bills/invoices. The pages of ONE bill may be supplied as multiple images — combine them into a single result. Return ONLY valid JSON:
{
  "vendor_name": "string",
  "bill_number": "string",
  "bill_date": "YYYY-MM-DD",
  "items": [
    { "name": "string", "hsn_or_sac": "string or null", "quantity": number, "rate": number, "amount": number }
  ],
  "subtotal": number,
  "discount": number,
  "tax": number,
  "total": number
}
CRITICAL — quantity is the NUMBER OF PACKS / UNITS / PIECES billed (the count in the NOP / "Qty" / "Pcs" column), NOT the total volume. If a line shows BOTH a pack count (e.g. NOP 5, each 20 Lt) AND a total volume (e.g. 100 Lt), use the PACK COUNT (5). "rate" is the price PER PACK/UNIT, so quantity × rate must equal the line "amount" — if they don't, re-read the columns until they reconcile.
"discount" is the SUM of ALL discounts on the bill (payment/special/other discounts), as one positive number applied to the bill total before tax; use 0 when there is none.
"tax" is the total GST (CGST+SGST+IGST). "subtotal" is the gross value before discount; "total" is the final invoice amount.
hsn_or_sac is the HSN/SAC printed on the line (4-8 digits); null when absent.
Return ONLY the JSON object. No explanations, no markdown.`;

/**
 * Deterministic fix for the "quantity is total volume, not pack count" trap
 * (Berger etc. print both NOP and a litre total): when a line's rate is the
 * per-pack price, amount/rate is the true pack count. If quantity×rate doesn't
 * reconcile to amount but amount/rate rounds to a clean integer, use that.
 * Also coerces the bill-level discount/tax/total to numbers.
 */
function normalizeScan(data) {
    if (!data || typeof data !== 'object') return data;
    const n = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
    if (Array.isArray(data.items)) {
        for (const it of data.items) {
            const qty = n(it.quantity), rate = n(it.rate), amount = n(it.amount);
            if (rate > 0 && amount > 0 && Math.abs(qty * rate - amount) > 1) {
                const derived = amount / rate;
                const rounded = Math.round(derived);
                if (rounded > 0 && Math.abs(derived - rounded) < 0.02) {
                    it.quantity = rounded; // pack count
                }
            }
        }
    }
    data.discount = n(data.discount);
    data.tax = n(data.tax);
    data.total = n(data.total);
    data.subtotal = n(data.subtotal);

    // Deterministic discount recovery (owner symptom 2026-06-12: "GST applied
    // but discount didn't"). Indian bills often print the discount in an odd
    // spot the model misses, yet subtotal/tax/total are read reliably. The
    // discount is applied BEFORE tax, so taxable = total − tax and
    // discount = subtotal − taxable. If the AI returned no discount but the
    // printed numbers imply one, recover it (rounded, sanity-bounded).
    if (!(data.discount > 0) && data.subtotal > 0 && data.total > 0 && data.tax >= 0) {
        const taxable = data.total - data.tax;
        const implied = Math.round((data.subtotal - taxable) * 100) / 100;
        // Only trust a positive discount strictly smaller than the subtotal and
        // larger than a rupee (ignore sub-rupee rounding drift / tax-inclusive
        // bills where subtotal already equals taxable).
        if (implied > 1 && implied < data.subtotal) {
            data.discount = implied;
        }
    }
    return data;
}

/**
 * Scan one or more bill images (pages) into a single extraction. Accepts a
 * single path (string) or an array of paths — multiple images go to the model
 * as multiple inline parts so a multi-page bill is read as one.
 */
async function scanBillImage(imagePaths) {
    const paths = Array.isArray(imagePaths) ? imagePaths : [imagePaths];
    if (!paths.length) throw new Error('No bill image provided');

    const imageTokens = paths.map(p => {
        const ext = path.extname(p).toLowerCase();
        const mimeType = MIME_TYPES[ext];
        if (!mimeType) throw new Error(`Unsupported image type: ${ext}`);
        const base64 = fs.readFileSync(p).toString('base64');
        return `[IMAGE: data:${mimeType};base64,${base64}]`;
    }).join('\n');

    const pageNote = paths.length > 1 ? ` These ${paths.length} images are pages of ONE bill — combine them.` : '';
    const messages = [
        { role: 'system', content: BILL_EXTRACT_SYSTEM_PROMPT },
        { role: 'user', content: `${imageTokens}\n\nExtract all data from this vendor bill.${pageNote} Return JSON only.` }
    ];

    // Gemini first — it's the reliable provider (multimodal; buildGeminiPayload
    // turns the [IMAGE: ...] convention into an inline_data vision part). The
    // clawdbot (KAI) gateway is the legacy primary; kept as a fallback for when
    // it's restored, but it's currently down on prod.
    let response;
    try {
        response = await aiEngine.generate(messages, {
            provider: 'gemini',
            maxTokens: 4096,
            temperature: 0.1
        });
    } catch (gemErr) {
        console.warn('[VendorBillAI] gemini scan failed, trying clawdbot:', gemErr.message);
        response = await aiEngine.generate(messages, {
            provider: 'clawdbot',
            maxTokens: 4096,
            temperature: 0.1
        });
    }

    // Extract text from response
    const text = typeof response === 'string' ? response : (response.text || response.content || '');

    // Strip markdown code block wrapping if present
    let jsonStr = text.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1].trim();
    }

    try {
        return normalizeScan(JSON.parse(jsonStr));
    } catch (err) {
        throw new Error(`Failed to parse AI response as JSON: ${err.message}\nResponse: ${text.substring(0, 500)}`);
    }
}

// ─── matchProductsToZoho ───────────────────────────────────────

/**
 * Simple word-overlap similarity between two strings.
 * Returns a score between 0 and 1.
 */
function wordOverlapScore(a, b) {
    const wordsA = a.toLowerCase().split(/\s+/).filter(Boolean);
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
    if (wordsA.length === 0) return 0;
    let matches = 0;
    for (const w of wordsA) {
        if (wordsB.has(w)) matches++;
    }
    return matches / Math.max(wordsA.length, wordsB.size);
}

async function matchProductsToZoho(extractedItems, vendorId) {
    if (!extractedItems || extractedItems.length === 0) return [];

    // Load all active Zoho items (incl. HSN so each matched line carries the
    // catalog HSN — the owner's gate compares it against the bill's printed HSN)
    const [zohoItems] = await pool.query(
        `SELECT zoho_item_id, zoho_item_name, zoho_sku AS sku, zoho_brand AS brand, zoho_rate AS rate,
                zoho_hsn_or_sac AS hsn_or_sac
         FROM zoho_items_map WHERE zoho_status = 'active'`
    );
    const hsnById = new Map(zohoItems.map(z => [z.zoho_item_id, z.hsn_or_sac || null]));
    const withHsn = (item, zohoItemId, fields) => ({
        ...item,
        zoho_item_id: zohoItemId,
        // HSN preference: the catalog's HSN for the matched item; else what the
        // AI read off the bill. The submit gate requires one of them.
        hsn_or_sac: (zohoItemId && hsnById.get(zohoItemId)) || item.hsn_or_sac || null,
        zoho_hsn: zohoItemId ? (hsnById.get(zohoItemId) || null) : null,
        ...fields,
    });

    // Load vendor history if vendorId provided
    let vendorHistory = [];
    if (vendorId) {
        const [rows] = await pool.query(
            `SELECT vbi.item_name, vbi.zoho_item_id, COUNT(*) as usage_count
             FROM vendor_bill_items vbi
             JOIN vendor_bills vb ON vbi.bill_id = vb.id
             WHERE vb.vendor_id = ? AND vbi.zoho_item_id IS NOT NULL
             GROUP BY vbi.item_name, vbi.zoho_item_id
             ORDER BY usage_count DESC`,
            [vendorId]
        );
        vendorHistory = rows;
    }

    // Build lookup maps
    const historyMap = new Map();
    for (const h of vendorHistory) {
        const key = h.item_name.toLowerCase().trim();
        if (!historyMap.has(key)) {
            historyMap.set(key, h.zoho_item_id);
        }
    }

    const exactNameMap = new Map();
    for (const z of zohoItems) {
        exactNameMap.set(z.zoho_item_name.toLowerCase().trim(), z.zoho_item_id);
    }

    return extractedItems.map(item => {
        const itemName = (item.name || '').toLowerCase().trim();

        // Priority 1: Vendor history exact match
        if (historyMap.has(itemName)) {
            return withHsn(item, historyMap.get(itemName), { ai_matched: true, ai_confidence: 0.95 });
        }

        // Priority 2: Exact match on zoho_item_name
        if (exactNameMap.has(itemName)) {
            return withHsn(item, exactNameMap.get(itemName), { ai_matched: true, ai_confidence: 0.90 });
        }

        // Priority 3: Fuzzy match (contains or word overlap >= 0.5)
        let bestMatch = null;
        let bestScore = 0;

        for (const z of zohoItems) {
            const zohoName = z.zoho_item_name.toLowerCase().trim();

            // Contains check
            if (zohoName.includes(itemName) || itemName.includes(zohoName)) {
                const score = 0.7;
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = z.zoho_item_id;
                }
                continue;
            }

            // Word overlap
            const overlap = wordOverlapScore(itemName, zohoName);
            if (overlap >= 0.5 && overlap > bestScore) {
                bestScore = overlap;
                bestMatch = z.zoho_item_id;
            }
        }

        if (bestMatch) {
            return withHsn(item, bestMatch, { ai_matched: true, ai_confidence: parseFloat((bestScore * 0.8).toFixed(2)) });
        }

        // No match
        return withHsn(item, null, { ai_matched: false, ai_confidence: 0 });
    });
}

// ─── verifyBillItems ───────────────────────────────────────────

function verifyBillItems(staffItems, aiExtractedData) {
    if (!aiExtractedData || !aiExtractedData.items || aiExtractedData.items.length === 0) {
        return { status: 'verified', differences: [] };
    }

    const differences = [];
    const aiItems = aiExtractedData.items;

    // Compare item count
    if (staffItems.length !== aiItems.length) {
        differences.push({
            field: 'item_count',
            item_name: null,
            expected: aiItems.length,
            actual: staffItems.length,
            message: `Item count mismatch: AI found ${aiItems.length} items, staff entered ${staffItems.length}`
        });
    }

    // Compare each item by position
    const compareLen = Math.min(staffItems.length, aiItems.length);
    for (let i = 0; i < compareLen; i++) {
        const staff = staffItems[i];
        const ai = aiItems[i];
        const itemName = ai.name || staff.item_name || `Item ${i + 1}`;

        // Compare quantity
        const staffQty = parseFloat(staff.quantity) || 0;
        const aiQty = parseFloat(ai.quantity) || 0;
        if (Math.abs(staffQty - aiQty) > 0.01) {
            differences.push({
                field: 'quantity',
                item_name: itemName,
                expected: aiQty,
                actual: staffQty,
                message: `Quantity mismatch for "${itemName}": AI=${aiQty}, Staff=${staffQty}`
            });
        }

        // Compare rate. The verify endpoint feeds raw vendor_bill_items rows
        // whose cost column is unit_price (owner vocabulary 2026-06-12:
        // unit price = DPL cost; "rate" = sales price = DPL + 18% GST + 10%
        // margin). A vendor bill's printed line price IS the cost, so the
        // AI-extracted ai.rate compares against unit_price on DB rows;
        // staff.rate is kept for AI-shaped callers.
        const staffRate = parseFloat(staff.rate != null ? staff.rate : staff.unit_price) || 0;
        const aiRate = parseFloat(ai.rate) || 0;
        if (Math.abs(staffRate - aiRate) > 0.01) {
            differences.push({
                field: 'rate',
                item_name: itemName,
                expected: aiRate,
                actual: staffRate,
                message: `Rate mismatch for "${itemName}": AI=${aiRate}, Staff=${staffRate}`
            });
        }

        // Compare HSN (PO→bill conversion flow 2026-06-12): only when BOTH
        // sides carry one — a missing HSN on either side is not a mismatch
        // (the submit/push HSN gate handles absence separately).
        const staffHsn = (staff.hsn_or_sac || '').toString().trim();
        const aiHsn = (ai.hsn_or_sac || '').toString().trim();
        if (staffHsn && aiHsn && staffHsn !== aiHsn) {
            differences.push({
                field: 'hsn',
                item_name: itemName,
                expected: aiHsn,
                actual: staffHsn,
                message: `HSN mismatch for "${itemName}": AI=${aiHsn}, Staff=${staffHsn}`
            });
        }
    }

    // Compare SUBTOTAL (pre-tax), NOT the printed grand total. Σ(line_total) is
    // the bill's PRE-tax subtotal (line_total = qty × unit_price = ex-GST cost);
    // aiExtractedData.total is the POST-tax printed grand total. Comparing those
    // two is apples-to-oranges — on any GST/discount bill they differ by
    // (tax − discount), so it false-flagged a 'total' mismatch on EVERY real
    // bill and left it permanently un-pushable. Compare like-for-like against
    // the AI's own pre-tax subtotal (normalizeScan populates it; derive it from
    // total − tax + discount when the scan didn't return an explicit subtotal).
    // DB rows (vendor_bill_items) carry line_total, not amount — keep that fallback.
    const staffSubtotal = parseFloat(staffItems.reduce((sum, it) => sum + (parseFloat(it.amount != null ? it.amount : it.line_total) || 0), 0)) || 0;
    const aiSubtotal = parseFloat(aiExtractedData.subtotal) > 0
        ? parseFloat(aiExtractedData.subtotal)
        : (parseFloat(aiExtractedData.total) || 0) - (parseFloat(aiExtractedData.tax) || 0) + (parseFloat(aiExtractedData.discount) || 0);
    if (aiSubtotal > 0 && Math.abs(staffSubtotal - aiSubtotal) > 1.0) {
        differences.push({
            field: 'subtotal',
            item_name: null,
            expected: aiSubtotal,
            actual: staffSubtotal,
            message: `Subtotal mismatch: AI=${aiSubtotal}, Staff=${staffSubtotal}`
        });
    }

    return {
        status: differences.length === 0 ? 'verified' : 'mismatch',
        differences
    };
}

// ─── buildReconciliation ───────────────────────────────────────
// Pairs each saved bill line with the AI-read line at the same position and
// flags per-field differences + what each line still needs (a Zoho match, an
// HSN), plus AI lines that have no bill counterpart. This is the data model
// the reconciliation UI renders so staff can fix every difference inline.
function buildReconciliation(billItems, aiExtractedData) {
    const aiItems = (aiExtractedData && Array.isArray(aiExtractedData.items)) ? aiExtractedData.items : [];
    const num = v => parseFloat(v) || 0;
    const hsnOf = o => (o && (o.hsn_or_sac || '')).toString().trim();

    const lines = (billItems || []).map((bill, i) => {
        const ai = aiItems[i] || null;
        const billRate = num(bill.unit_price != null ? bill.unit_price : bill.rate);
        const aiRate = ai ? num(ai.rate) : null;
        const billQty = num(bill.quantity);
        const aiQty = ai ? num(ai.quantity) : null;
        const billHsn = hsnOf(bill);
        const aiHsn = ai ? hsnOf(ai) : '';
        return {
            index: i,
            bill: {
                item_name: bill.item_name,
                quantity: billQty,
                unit_price: billRate,
                hsn_or_sac: billHsn,
                zoho_item_id: bill.zoho_item_id || null,
                ai_matched: !!bill.ai_matched,
                ai_confidence: num(bill.ai_confidence),
            },
            ai: ai ? { name: ai.name || '', quantity: aiQty, rate: aiRate, hsn_or_sac: aiHsn } : null,
            diffs: {
                quantity: ai != null && Math.abs(billQty - aiQty) > 0.01,
                rate: ai != null && Math.abs(billRate - aiRate) > 0.01,
                hsn: !!(billHsn && aiHsn && billHsn !== aiHsn),
            },
            needs_match: !bill.zoho_item_id,
            needs_hsn: !billHsn,
        };
    });

    // AI lines beyond the bill's line count — staff can add them
    const aiExtra = aiItems.slice(billItems ? billItems.length : 0).map(ai => ({
        name: ai.name || '',
        quantity: num(ai.quantity),
        rate: num(ai.rate),
        hsn_or_sac: hsnOf(ai),
    }));

    const summary = {
        quantity: lines.filter(l => l.diffs.quantity).length,
        rate: lines.filter(l => l.diffs.rate).length,
        hsn: lines.filter(l => l.diffs.hsn).length,
        needs_match: lines.filter(l => l.needs_match).length,
        needs_hsn: lines.filter(l => l.needs_hsn).length,
        count_diff: aiItems.length !== (billItems ? billItems.length : 0),
        ai_item_count: aiItems.length,
        bill_item_count: billItems ? billItems.length : 0,
    };

    return { lines, ai_extra: aiExtra, summary };
}

module.exports = { setPool, scanBillImage, matchProductsToZoho, verifyBillItems, buildReconciliation, normalizeScan };
