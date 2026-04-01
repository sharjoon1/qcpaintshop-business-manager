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

const BILL_EXTRACT_SYSTEM_PROMPT = `You are an expert at reading vendor bills and invoices. Extract all data from the bill image and return ONLY valid JSON with this structure:
{
  "vendor_name": "string",
  "bill_number": "string",
  "bill_date": "YYYY-MM-DD",
  "items": [
    { "name": "string", "quantity": number, "rate": number, "amount": number }
  ],
  "subtotal": number,
  "tax": number,
  "total": number
}
Return ONLY the JSON object. No explanations, no markdown formatting.`;

async function scanBillImage(imagePath) {
    const fileBuffer = fs.readFileSync(imagePath);
    const base64 = fileBuffer.toString('base64');
    const ext = path.extname(imagePath).toLowerCase();
    const mimeType = MIME_TYPES[ext];
    if (!mimeType) {
        throw new Error(`Unsupported image type: ${ext}`);
    }

    const messages = [
        { role: 'system', content: BILL_EXTRACT_SYSTEM_PROMPT },
        { role: 'user', content: `[IMAGE: data:${mimeType};base64,${base64}]\n\nExtract all data from this vendor bill image. Return JSON only.` }
    ];

    const response = await aiEngine.generate(messages, {
        provider: 'clawdbot',
        maxTokens: 4096,
        temperature: 0.1
    });

    // Extract text from response
    const text = typeof response === 'string' ? response : (response.text || response.content || '');

    // Strip markdown code block wrapping if present
    let jsonStr = text.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1].trim();
    }

    try {
        return JSON.parse(jsonStr);
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

    // Load all active Zoho items
    const [zohoItems] = await pool.query(
        `SELECT zoho_item_id, zoho_item_name, zoho_sku AS sku, zoho_brand AS brand, zoho_rate AS rate FROM zoho_items_map WHERE zoho_status = 'active'`
    );

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
            return { ...item, zoho_item_id: historyMap.get(itemName), ai_matched: true, ai_confidence: 0.95 };
        }

        // Priority 2: Exact match on zoho_item_name
        if (exactNameMap.has(itemName)) {
            return { ...item, zoho_item_id: exactNameMap.get(itemName), ai_matched: true, ai_confidence: 0.90 };
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
            return { ...item, zoho_item_id: bestMatch, ai_matched: true, ai_confidence: parseFloat((bestScore * 0.8).toFixed(2)) };
        }

        // No match
        return { ...item, zoho_item_id: null, ai_matched: false, ai_confidence: 0 };
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

        // Compare rate
        const staffRate = parseFloat(staff.rate) || 0;
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
    }

    // Compare total
    const staffTotal = parseFloat(staffItems.reduce((sum, it) => sum + (parseFloat(it.amount) || 0), 0)) || 0;
    const aiTotal = parseFloat(aiExtractedData.total) || 0;
    if (Math.abs(staffTotal - aiTotal) > 1.0) {
        differences.push({
            field: 'total',
            item_name: null,
            expected: aiTotal,
            actual: staffTotal,
            message: `Total mismatch: AI=${aiTotal}, Staff=${staffTotal}`
        });
    }

    return {
        status: differences.length === 0 ? 'verified' : 'mismatch',
        differences
    };
}

module.exports = { setPool, scanBillImage, matchProductsToZoho, verifyBillItems };
