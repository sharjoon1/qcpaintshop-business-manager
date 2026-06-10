# Customer Price List Generator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new admin page that generates a branded PDF price list from saved brand DPL data, applies GST + custom markup, personalises with a customer name, and supports download + WhatsApp send.

**Architecture:** New `services/price-list-pdf-generator.js` (PDFKit layout + pure formula/grouping helpers), `routes/price-list.js` (GET /brands, POST /generate), and `public/admin-price-list-generator.html` (form UI). Route is mounted at `/api/price-list` in server.js, and linked in the Zoho subnav. WhatsApp send uses the existing `whatsapp-session-manager.sendMedia` with a temp file, mirroring the estimate-PDF WhatsApp pattern.

**Tech Stack:** Node.js/Express, PDFKit (v0.17.2, already installed), whatsapp-web.js (already installed), Jest (tests), vanilla JS (frontend)

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `services/price-list-pdf-generator.js` | Create | `computeFinalPrice`, `groupRowsForPdf`, `generatePriceListPdf` |
| `tests/unit/price-list-pdf-generator.test.js` | Create | Unit tests for formula + grouping helpers + smoke test |
| `routes/price-list.js` | Create | `GET /brands`, `POST /generate` |
| `tests/unit/price-list-route.test.js` | Create | Route smoke tests |
| `server.js` | Modify | require + setPool + app.use |
| `public/components/zoho-subnav.html` | Modify | Add "Price List" nav entry |
| `public/admin-price-list-generator.html` | Create | Full UI page |

---

### Task 1: Service helpers — `computeFinalPrice` + `groupRowsForPdf` (TDD)

**Files:**
- Create: `services/price-list-pdf-generator.js`
- Create: `tests/unit/price-list-pdf-generator.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/price-list-pdf-generator.test.js` with this content:

```js
const { computeFinalPrice, groupRowsForPdf } = require('../../services/price-list-pdf-generator');

describe('computeFinalPrice', () => {
    test('DPL 100, markup 10% → 130', () => {
        // 100 * 1.10 * 1.18 = 129.8 → ceil = 130
        expect(computeFinalPrice(100, 10)).toBe(130);
    });
    test('DPL 500, markup 10% → 649', () => {
        // 500 * 1.10 * 1.18 = 649.0 → ceil = 649
        expect(computeFinalPrice(500, 10)).toBe(649);
    });
    test('DPL 1200, markup 15% → 1628', () => {
        // 1200 * 1.15 * 1.18 = 1627.2 → ceil = 1628
        expect(computeFinalPrice(1200, 15)).toBe(1628);
    });
    test('DPL 250, markup 0% → 295', () => {
        // 250 * 1.00 * 1.18 = 295 → ceil = 295
        expect(computeFinalPrice(250, 0)).toBe(295);
    });
    test('handles string inputs', () => {
        expect(computeFinalPrice('500', '10')).toBe(649);
    });
    test('handles zero DPL', () => {
        expect(computeFinalPrice(0, 10)).toBe(0);
    });
});

describe('groupRowsForPdf', () => {
    const rows = [
        { product: 'One Pure Elegance', packSize: '4L', category: 'Interior', colourName: 'White', finalPrice: 2245 },
        { product: 'One Pure Elegance', packSize: '1L', category: 'Interior', colourName: 'White', finalPrice: 649 },
        { product: 'Exterior Plus', packSize: '10L', category: 'Exterior', colourName: 'Tintable', finalPrice: 1800 },
    ];

    test('returns brandLabel in result', () => {
        const result = groupRowsForPdf(rows, 'Birla Opus');
        expect(result.brandLabel).toBe('Birla Opus');
    });

    test('groups rows into categories array', () => {
        const result = groupRowsForPdf(rows, 'Birla Opus');
        expect(result.categories).toHaveLength(2);
    });

    test('categories sorted alphabetically', () => {
        const result = groupRowsForPdf(rows, 'Birla Opus');
        expect(result.categories[0].label).toBe('Exterior');
        expect(result.categories[1].label).toBe('Interior');
    });

    test('items within category sorted by productName then packSize', () => {
        const result = groupRowsForPdf(rows, 'Birla Opus');
        const interior = result.categories.find(c => c.label === 'Interior');
        expect(interior.items[0].packSize).toBe('1L');
        expect(interior.items[1].packSize).toBe('4L');
    });

    test('item shape: productName, colourName, packSize, finalPrice', () => {
        const result = groupRowsForPdf(rows, 'Birla Opus');
        const item = result.categories[1].items[0]; // Interior, 1L
        expect(item).toMatchObject({
            productName: 'One Pure Elegance',
            colourName: 'White',
            packSize: '1L',
            finalPrice: 649,
        });
    });

    test('rows without category default to "Other"', () => {
        const r = groupRowsForPdf([{ product: 'X', packSize: '1L', finalPrice: 100 }], 'Brand');
        expect(r.categories[0].label).toBe('Other');
    });

    test('handles empty rows array', () => {
        const result = groupRowsForPdf([], 'Brand');
        expect(result.categories).toHaveLength(0);
    });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

```
npx jest tests/unit/price-list-pdf-generator.test.js --no-coverage
```

Expected: `Cannot find module '../../services/price-list-pdf-generator'`

- [ ] **Step 3: Create `services/price-list-pdf-generator.js` with the helpers**

```js
const PDFDocument = require('pdfkit');

// ─── Constants ──────────────────────────────────────────────────────────────
const BRAND_GREEN = '#1B5E3B';
const COMPANY_NAME = 'Quality Colours';
const COMPANY_DETAIL = 'Quality Colours, Chennai  |  +91 74188 31122';

// ─── Pure helpers (exported for testing) ────────────────────────────────────

/**
 * Final customer price: DPL × (1 + markup%) × 1.18 GST, ceiled to whole rupee.
 */
function computeFinalPrice(dpl, markupPercent) {
    return Math.ceil(parseFloat(dpl) * (1 + parseFloat(markupPercent) / 100) * 1.18);
}

/**
 * Group flat DPL rows (each already carrying a pre-computed `finalPrice`) by category.
 * Input row shape: { product, packSize, category?, colourName?, finalPrice }
 * Returns: { brandLabel, categories: [{ label, items: [{ productName, colourName, packSize, finalPrice }] }] }
 * Categories and items within each category are sorted alphabetically.
 */
function groupRowsForPdf(rows, brandLabel) {
    const catMap = new Map();
    for (const row of rows) {
        const cat = (row.category || 'Other').trim();
        if (!catMap.has(cat)) catMap.set(cat, []);
        catMap.get(cat).push({
            productName: row.product || '',
            colourName: row.colourName || '',
            packSize: row.packSize || '',
            finalPrice: row.finalPrice || 0,
        });
    }
    const categories = [];
    for (const [label, items] of catMap) {
        items.sort((a, b) => {
            const n = (a.productName || '').localeCompare(b.productName || '');
            return n !== 0 ? n : (a.packSize || '').localeCompare(b.packSize || '');
        });
        categories.push({ label, items });
    }
    categories.sort((a, b) => a.label.localeCompare(b.label));
    return { brandLabel, categories };
}

// ─── Formatting helpers (internal) ──────────────────────────────────────────

function formatDisplayDate(isoDate) {
    if (!isoDate) return '';
    // Append time to avoid UTC midnight shifting the date in local TZ
    const d = new Date(isoDate + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatINR(num) {
    return '₹ ' + Math.round(parseFloat(num) || 0).toLocaleString('en-IN');
}

// ─── PDF generator ──────────────────────────────────────────────────────────
// (added in next task)

module.exports = { computeFinalPrice, groupRowsForPdf };
```

- [ ] **Step 4: Run tests — expect all PASS**

```
npx jest tests/unit/price-list-pdf-generator.test.js --no-coverage
```

Expected: 13 tests passing.

- [ ] **Step 5: Commit**

```
git add services/price-list-pdf-generator.js tests/unit/price-list-pdf-generator.test.js
git commit -m "feat(price-list): computeFinalPrice + groupRowsForPdf helpers with tests"
```

---

### Task 2: PDF generation function — `generatePriceListPdf`

**Files:**
- Modify: `services/price-list-pdf-generator.js` (add function + export)
- Modify: `tests/unit/price-list-pdf-generator.test.js` (add smoke test)

- [ ] **Step 1: Add the smoke test to the existing test file**

Append at the end of `tests/unit/price-list-pdf-generator.test.js`:

```js
describe('generatePriceListPdf', () => {
    test('returns a Buffer starting with PDF magic bytes', async () => {
        const { generatePriceListPdf } = require('../../services/price-list-pdf-generator');
        const groups = [{
            brandLabel: 'Test Brand',
            categories: [{
                label: 'Interior',
                items: [
                    { productName: 'Test Product', colourName: 'White', packSize: '1L', finalPrice: 649 },
                    { productName: 'Test Product', colourName: 'White', packSize: '4L', finalPrice: 2245 },
                ],
            }],
        }];
        const buffer = await generatePriceListPdf(groups, {
            customerName: 'Test Customer',
            markupPercent: 10,
            effectiveDate: '2026-05-21',
        });
        expect(Buffer.isBuffer(buffer)).toBe(true);
        expect(buffer.length).toBeGreaterThan(100);
        expect(buffer.slice(0, 4).toString('ascii')).toBe('%PDF');
    }, 10000); // 10s timeout — PDF generation can be slow in test
});
```

- [ ] **Step 2: Run — expect FAIL (generatePriceListPdf not exported)**

```
npx jest tests/unit/price-list-pdf-generator.test.js --no-coverage
```

Expected: `TypeError: generatePriceListPdf is not a function`

- [ ] **Step 3: Add `generatePriceListPdf` to the service and update exports**

Replace the comment `// ─── PDF generator ──` section and the `module.exports` line at the bottom of `services/price-list-pdf-generator.js` with:

```js
// ─── PDF generator ──────────────────────────────────────────────────────────

/**
 * Generate a price list PDF for the given brand groups.
 *
 * @param {Array} brandGroups  Array of { brandLabel, categories: [{ label, items: [{productName, colourName, packSize, finalPrice}] }] }
 * @param {object} opts
 * @param {string} opts.customerName
 * @param {number} opts.markupPercent
 * @param {string} opts.effectiveDate  ISO date string "YYYY-MM-DD"
 * @returns {Promise<Buffer>}
 */
function generatePriceListPdf(brandGroups, { customerName, markupPercent, effectiveDate }) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });

        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const MARGIN = 40;
        const PAGE_W = 515;          // 595 - 2×40
        const PAGE_H = 841.89;
        const FOOTER_RESERVE = 45;   // bottom space kept clear for footer
        const ROW_H = 18;

        // Column widths (must total PAGE_W = 515)
        const COL_PRODUCT = 283;     // 55%
        const COL_COLOUR  = 103;     // 20%
        const COL_SIZE    =  52;     // 10%
        const COL_PRICE   =  77;     // 15%

        const displayDate = formatDisplayDate(effectiveDate || new Date().toISOString().slice(0, 10));

        // ── Header (drawn once per page) ──────────────────────────────────
        function drawPageHeader() {
            const y = MARGIN;
            // Company name
            doc.fontSize(18).fillColor(BRAND_GREEN).font('Helvetica-Bold')
               .text(COMPANY_NAME, MARGIN, y, { lineBreak: false });
            // "Price List" label
            doc.fontSize(9).fillColor('#6b7280').font('Helvetica')
               .text('Price List', MARGIN, y + 24, { lineBreak: false });
            // Company detail — right-aligned
            doc.fontSize(7.5).fillColor('#9ca3af').font('Helvetica')
               .text(COMPANY_DETAIL, MARGIN, y + 6, { width: PAGE_W, align: 'right', lineBreak: false });
            // Divider
            doc.moveTo(MARGIN, y + 38).lineTo(MARGIN + PAGE_W, y + 38)
               .strokeColor('#d1d5db').lineWidth(0.5).stroke();
            return y + 50;
        }

        // ── Table column header row ────────────────────────────────────────
        function drawTableHeader(y) {
            doc.rect(MARGIN, y, PAGE_W, 16).fill('#1f2937');
            doc.fontSize(7.5).fillColor('#ffffff').font('Helvetica-Bold');
            doc.text('PRODUCT',   MARGIN + 4,                                      y + 4, { width: COL_PRODUCT - 8, lineBreak: false });
            doc.text('COLOUR',    MARGIN + COL_PRODUCT + 4,                        y + 4, { width: COL_COLOUR  - 8, lineBreak: false });
            doc.text('SIZE',      MARGIN + COL_PRODUCT + COL_COLOUR + 4,           y + 4, { width: COL_SIZE    - 8, lineBreak: false });
            doc.text('PRICE',     MARGIN + COL_PRODUCT + COL_COLOUR + COL_SIZE,    y + 4, { width: COL_PRICE   - 4, align: 'right', lineBreak: false });
            return y + 16;
        }

        // ── Page 1 header + customer block ────────────────────────────────
        let y = drawPageHeader();

        doc.fontSize(11).fillColor('#1f2937').font('Helvetica-Bold')
           .text('Prepared for: ' + customerName, MARGIN, y + 10, { lineBreak: false });
        doc.fontSize(8.5).fillColor('#6b7280').font('Helvetica')
           .text('Date: ' + displayDate + '     Markup: +' + markupPercent + '%     Prices inclusive of 18% GST',
                 MARGIN, y + 26, { lineBreak: false });
        doc.moveTo(MARGIN, y + 42).lineTo(MARGIN + PAGE_W, y + 42)
           .strokeColor('#e5e7eb').lineWidth(0.5).stroke();
        y += 52;

        // ── Brand sections ────────────────────────────────────────────────
        for (const group of brandGroups) {
            // Brand header needs at least 100pt remaining, otherwise new page
            if (y > PAGE_H - FOOTER_RESERVE - 100) {
                doc.addPage();
                y = drawPageHeader();
            }

            // Brand band (full-width green strip)
            doc.rect(MARGIN, y, PAGE_W, 22).fill('#f0fdf4');
            doc.moveTo(MARGIN, y).lineTo(MARGIN + PAGE_W, y).strokeColor('#a7f3d0').lineWidth(1).stroke();
            doc.fontSize(12).fillColor(BRAND_GREEN).font('Helvetica-Bold')
               .text(group.brandLabel.toUpperCase(), MARGIN + 8, y + 5, { width: PAGE_W - 16, lineBreak: false });
            doc.moveTo(MARGIN, y + 22).lineTo(MARGIN + PAGE_W, y + 22).strokeColor('#a7f3d0').lineWidth(0.5).stroke();
            y += 26;

            for (const cat of group.categories) {
                // Category sub-header — needs at least 60pt remaining
                if (y > PAGE_H - FOOTER_RESERVE - 60) {
                    doc.addPage();
                    y = drawPageHeader();
                }

                doc.rect(MARGIN, y, PAGE_W, 18).fill('#f9fafb');
                doc.fontSize(10).fillColor('#374151').font('Helvetica-Bold')
                   .text(cat.label, MARGIN + 12, y + 4, { width: PAGE_W - 16, lineBreak: false });
                doc.moveTo(MARGIN, y + 18).lineTo(MARGIN + PAGE_W, y + 18).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
                y += 22;

                // Table column header
                if (y > PAGE_H - FOOTER_RESERVE - 40) {
                    doc.addPage();
                    y = drawPageHeader();
                }
                y = drawTableHeader(y);

                // Item rows
                for (let i = 0; i < cat.items.length; i++) {
                    if (y + ROW_H > PAGE_H - FOOTER_RESERVE) {
                        doc.addPage();
                        y = drawPageHeader();
                        y = drawTableHeader(y);
                    }
                    const item = cat.items[i];
                    // Alternating row background
                    if (i % 2 === 1) {
                        doc.rect(MARGIN, y, PAGE_W, ROW_H).fill('#f9fafb');
                    }
                    doc.fontSize(9).fillColor('#374151').font('Helvetica');
                    doc.text(item.productName,  MARGIN + 4,                                   y + 4, { width: COL_PRODUCT - 8, lineBreak: false });
                    doc.text(item.colourName || '-', MARGIN + COL_PRODUCT + 4,                y + 4, { width: COL_COLOUR  - 8, lineBreak: false });
                    doc.text(item.packSize,     MARGIN + COL_PRODUCT + COL_COLOUR + 4,        y + 4, { width: COL_SIZE    - 8, lineBreak: false });
                    doc.fontSize(9).fillColor('#059669').font('Helvetica-Bold')
                       .text(formatINR(item.finalPrice),
                             MARGIN + COL_PRODUCT + COL_COLOUR + COL_SIZE,                   y + 4,
                             { width: COL_PRICE - 4, align: 'right', lineBreak: false });
                    // Row separator
                    doc.moveTo(MARGIN, y + ROW_H).lineTo(MARGIN + PAGE_W, y + ROW_H).strokeColor('#f1f5f9').lineWidth(0.3).stroke();
                    y += ROW_H;
                }
                y += 8; // spacing after category table
            }
            y += 10; // spacing between brand sections
        }

        // ── Footer on every page (bufferPages mode) ───────────────────────
        const totalPages = doc.bufferedPageRange().count;
        for (let i = 0; i < totalPages; i++) {
            doc.switchToPage(i);
            const fy = PAGE_H - 30;
            doc.moveTo(MARGIN, fy - 10).lineTo(MARGIN + PAGE_W, fy - 10).strokeColor('#d1d5db').lineWidth(0.5).stroke();
            doc.fontSize(7.5).fillColor('#9ca3af').font('Helvetica');
            doc.text('Prices inclusive of 18% GST  |  Valid as of ' + displayDate,
                     MARGIN, fy - 4, { width: 320, lineBreak: false });
            doc.text('Page ' + (i + 1) + ' of ' + totalPages,
                     MARGIN, fy - 4, { width: PAGE_W, align: 'right', lineBreak: false });
        }

        doc.flushPages();
        doc.end();
    });
}

module.exports = { computeFinalPrice, groupRowsForPdf, generatePriceListPdf };
```

- [ ] **Step 4: Run all PDF generator tests — expect PASS**

```
npx jest tests/unit/price-list-pdf-generator.test.js --no-coverage
```

Expected: 14 tests passing (13 from Task 1 + 1 smoke test).

- [ ] **Step 5: Commit**

```
git add services/price-list-pdf-generator.js tests/unit/price-list-pdf-generator.test.js
git commit -m "feat(price-list): generatePriceListPdf — PDFKit layout with page headers, footers, brand/category grouping"
```

---

### Task 3: Route file — `GET /brands` + `POST /generate`

**Files:**
- Create: `routes/price-list.js`
- Create: `tests/unit/price-list-route.test.js`

- [ ] **Step 1: Write the failing smoke test**

Create `tests/unit/price-list-route.test.js`:

```js
describe('price-list route module', () => {
    test('exports router and setPool', () => {
        const mod = require('../../routes/price-list');
        expect(typeof mod.router).toBe('object');
        expect(typeof mod.setPool).toBe('function');
    });

    test('setPool stores pool without throwing', () => {
        const mod = require('../../routes/price-list');
        expect(() => mod.setPool({ query: jest.fn() })).not.toThrow();
    });
});
```

- [ ] **Step 2: Run — expect FAIL (module not found)**

```
npx jest tests/unit/price-list-route.test.js --no-coverage
```

Expected: `Cannot find module '../../routes/price-list'`

- [ ] **Step 3: Create `routes/price-list.js`**

```js
const express = require('express');
const router = express.Router();
const { requirePermission } = require('../middleware/permissionMiddleware');
const { computeFinalPrice, groupRowsForPdf, generatePriceListPdf } = require('../services/price-list-pdf-generator');
const fs = require('fs');
const path = require('path');
const os = require('os');

let pool;
function setPool(p) { pool = p; }

const BRAND_LABELS = {
    birlaopus: 'Birla Opus',
    asian:     'Asian Paints',
    berger:    'Berger Paints',
    gem:       'Gem Paints',
    jsw:       'JSW Paints',
    nippon:    'Nippon Paint',
};

const perm = requirePermission('zoho', 'manage');

// ─── GET /brands ─────────────────────────────────────────────────────────────
// Returns brands that have saved DPL data, including available categories.
router.get('/brands', perm, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT brand, parsed_count, effective_date, parsed_rows
             FROM brand_dpl_lists
             WHERE parsed_rows IS NOT NULL
             ORDER BY brand`
        );

        const data = rows
            .map(row => {
                let parsedRows = [];
                try {
                    parsedRows = typeof row.parsed_rows === 'string'
                        ? JSON.parse(row.parsed_rows)
                        : (row.parsed_rows || []);
                } catch (e) { /* leave empty */ }

                const categories = [...new Set(
                    parsedRows.map(r => r.category).filter(Boolean)
                )].sort();

                const effDate = row.effective_date
                    ? (typeof row.effective_date === 'string'
                        ? row.effective_date
                        : new Date(row.effective_date).toISOString().slice(0, 10))
                    : null;

                return {
                    brand: row.brand,
                    label: BRAND_LABELS[row.brand] || row.brand,
                    effective_date: effDate,
                    item_count: row.parsed_count || 0,
                    categories,
                };
            })
            .filter(b => b.item_count > 0);

        res.json({ success: true, data });
    } catch (err) {
        console.error('[price-list] GET /brands:', err.message);
        res.status(500).json({ success: false, message: 'Failed to load brands' });
    }
});

// ─── POST /generate ───────────────────────────────────────────────────────────
// Generates a PDF price list; optionally sends via WhatsApp if whatsapp_number provided.
// Always returns the PDF buffer as a download.
router.post('/generate', perm, async (req, res) => {
    try {
        let { customer_name, whatsapp_number, brands, categories, markup_percent, effective_date } = req.body;

        // ── Validation ────────────────────────────────────────────────────
        if (!customer_name || typeof customer_name !== 'string' || !customer_name.trim()) {
            return res.status(400).json({ success: false, message: 'customer_name is required' });
        }
        customer_name = customer_name.trim().slice(0, 100);

        if (!Array.isArray(brands) || brands.length === 0) {
            return res.status(400).json({ success: false, message: 'brands must be a non-empty array' });
        }

        const markupPct = parseFloat(markup_percent);
        if (isNaN(markupPct) || markupPct < 0 || markupPct > 200) {
            return res.status(400).json({ success: false, message: 'markup_percent must be between 0 and 200' });
        }

        // Normalize categories filter (lowercase for case-insensitive match)
        const filterCats = Array.isArray(categories)
            ? categories.map(c => (c || '').toLowerCase().trim()).filter(Boolean)
            : [];

        // Normalize WhatsApp number: keep only digits, remove +91 prefix, must be 10 digits
        let waNumber = null;
        if (whatsapp_number) {
            const digits = String(whatsapp_number).replace(/\D/g, '');
            const normalized = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits;
            if (normalized.length === 10) waNumber = normalized;
        }

        // ── Fetch, filter, group each brand ──────────────────────────────
        const brandGroups = [];
        for (const brand of brands) {
            const [rows] = await pool.query(
                'SELECT parsed_rows FROM brand_dpl_lists WHERE brand = ?', [brand]
            );
            if (!rows.length || !rows[0].parsed_rows) continue;

            let parsedRows;
            try {
                parsedRows = typeof rows[0].parsed_rows === 'string'
                    ? JSON.parse(rows[0].parsed_rows) : rows[0].parsed_rows;
            } catch (e) { continue; }

            const filtered = filterCats.length > 0
                ? parsedRows.filter(r => filterCats.includes((r.category || '').toLowerCase().trim()))
                : parsedRows;

            if (!filtered.length) continue;

            const withPrice = filtered.map(r => ({
                ...r,
                finalPrice: computeFinalPrice(r.dpl, markupPct),
            }));

            brandGroups.push(groupRowsForPdf(withPrice, BRAND_LABELS[brand] || brand));
        }

        if (brandGroups.length === 0) {
            return res.status(400).json({ success: false, message: 'No DPL data found for selected brands' });
        }
        const totalItems = brandGroups.reduce(
            (sum, g) => sum + g.categories.reduce((s, c) => s + c.items.length, 0), 0
        );
        if (totalItems === 0) {
            return res.status(400).json({ success: false, message: 'No items match selected categories' });
        }

        // ── Generate PDF ──────────────────────────────────────────────────
        const pdfBuffer = await generatePriceListPdf(brandGroups, {
            customerName: customer_name,
            markupPercent: markupPct,
            effectiveDate: effective_date || new Date().toISOString().slice(0, 10),
        });

        // ── WhatsApp send (non-blocking on failure) ───────────────────────
        if (waNumber) {
            try {
                const sessionManager = require('../services/whatsapp-session-manager');
                const tmpDir = path.join(os.tmpdir(), 'qc-price-lists');
                fs.mkdirSync(tmpDir, { recursive: true });
                const safeName = customer_name.replace(/[^a-zA-Z0-9\-_]/g, '_');
                const tmpPath = path.join(tmpDir, `PL-${safeName}-${Date.now()}.pdf`);
                fs.writeFileSync(tmpPath, pdfBuffer);

                const caption = `Hi! Please find your price list attached.\nCustomer: ${customer_name}\nDate: ${effective_date || new Date().toISOString().slice(0, 10)}\nMarkup: +${markupPct}%`;
                const mediaOpts = { type: 'document', mediaPath: tmpPath, caption, filename: `PriceList-${safeName}.pdf` };
                const source = { source: 'price_list', sent_by: req.user?.id };

                const ADMIN_BRANCH = -1;
                const GENERAL_ID   =  0;
                let sent = false;
                try { sent = await sessionManager.sendMedia(ADMIN_BRANCH, waNumber, mediaOpts, source); } catch (e) { /* fallback below */ }
                if (!sent) {
                    try { sent = await sessionManager.sendMedia(GENERAL_ID, waNumber, mediaOpts, source); } catch (e) { /* ignore */ }
                }
                try { fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }
            } catch (e) {
                console.warn('[price-list] WhatsApp send failed:', e.message);
            }
        }

        // ── Return PDF ────────────────────────────────────────────────────
        const safeName = customer_name.replace(/[^a-zA-Z0-9\-_]/g, '_');
        const dateStr  = (effective_date || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="PriceList-${safeName}-${dateStr}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        res.end(pdfBuffer);

    } catch (err) {
        console.error('[price-list] POST /generate:', err.message);
        res.status(500).json({ success: false, message: 'Failed to generate price list' });
    }
});

module.exports = { router, setPool };
```

- [ ] **Step 4: Run tests — expect PASS**

```
npx jest tests/unit/price-list-route.test.js --no-coverage
```

Expected: 2 tests passing.

- [ ] **Step 5: Commit**

```
git add routes/price-list.js tests/unit/price-list-route.test.js
git commit -m "feat(price-list): GET /brands + POST /generate route"
```

---

### Task 4: Wire up server.js + add nav entry

**Files:**
- Modify: `server.js`
- Modify: `public/components/zoho-subnav.html`

- [ ] **Step 1: Add require to `server.js`**

Find the line `const twoFARoutes = require('./routes/auth-2fa');` (around line 101) and add **after** it:

```js
const priceListRoutes = require('./routes/price-list');
```

- [ ] **Step 2: Add setPool call to `server.js`**

Find the line `twoFARoutes.setPool(pool);` (around line 332) and add **after** it:

```js
priceListRoutes.setPool(pool);
```

- [ ] **Step 3: Add app.use to `server.js`**

Find the line `app.use('/api/2fa', twoFARoutes);` (around line 403) and add **after** it:

```js
app.use('/api/price-list', priceListRoutes.router);
```

- [ ] **Step 4: Add nav entry to `public/components/zoho-subnav.html`**

Find the line:
```js
        { page: 'zoho-dpl', label: 'DPL Import', href: '/admin-dpl.html', icon: '<path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3-3m0 0l3 3m-3-3v12"/>' },
```

Add **immediately after** it:

```js
        { page: 'zoho-price-list', label: 'Price List', href: '/admin-price-list-generator.html', icon: '<path d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2zM10 8.5a.5.5 0 11-1 0 .5.5 0 011 0zm5 5a.5.5 0 11-1 0 .5.5 0 011 0z"/>' },
```

- [ ] **Step 5: Verify server starts without errors**

```
node -e "require('./routes/price-list'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 6: Commit**

```
git add server.js public/components/zoho-subnav.html
git commit -m "feat(price-list): mount route + add Zoho subnav entry"
```

---

### Task 5: Admin UI — `public/admin-price-list-generator.html`

**Files:**
- Create: `public/admin-price-list-generator.html`

- [ ] **Step 1: Create the HTML file**

Create `public/admin-price-list-generator.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="#667eea">
    <link rel="manifest" href="/manifest.json">
    <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192x192.png">
    <title>Price List Generator - Quality Colours Manager</title>
    <link rel="stylesheet" href="/css/tailwind.css">
    <link rel="stylesheet" href="/css/design-system.css">
    <link rel="stylesheet" href="/css/zoho-common.css">
    <script src="/universal-nav-loader.js"></script>
    <script src="/js/auth-helper.js"></script>
    <script>requireAdminOrRedirect();</script>
    <style>
        body { background: #f9fafb; }
        .spinner { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .toast { position: fixed; bottom: 20px; right: 20px; z-index: 9999; padding: 10px 20px;
                 border-radius: 8px; font-size: 0.8rem; font-weight: 500; opacity: 0;
                 transition: opacity 0.3s; pointer-events: none; }
        .toast.show { opacity: 1; pointer-events: auto; }
        .toast-success { background: #10b981; color: white; }
        .toast-error   { background: #ef4444; color: white; }
    </style>
</head>
<body data-page="zoho-price-list" class="bg-gray-50">

<div id="toast" class="toast"></div>

<!-- Loading overlay -->
<div id="loadingOverlay" class="fixed inset-0 bg-black bg-opacity-50 z-50 hidden items-center justify-center">
    <div class="bg-white rounded-xl p-6 flex flex-col items-center gap-3 shadow-xl">
        <svg class="spinner w-8 h-8 text-indigo-500" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span class="text-sm font-medium text-gray-700">Generating price list…</span>
        <span class="text-xs text-gray-400">This may take a few seconds for large lists</span>
    </div>
</div>

<div class="container mx-auto p-4 md:p-6 max-w-2xl">

    <!-- Page Header -->
    <div class="mb-5">
        <h2 class="text-xl md:text-2xl font-bold text-gray-800">Price List Generator</h2>
        <p class="text-xs text-gray-500 mt-1">Generate a branded PDF price list from saved brand DPL data</p>
    </div>

    <!-- Form Card -->
    <div class="bg-white rounded-xl shadow-sm p-5 md:p-6 space-y-5">

        <!-- Customer Name -->
        <div>
            <label class="block text-xs font-semibold text-gray-700 mb-1">
                Customer Name <span class="text-red-500">*</span>
            </label>
            <input type="text" id="customerName" placeholder="e.g. Raj Constructions"
                class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400">
        </div>

        <!-- WhatsApp Number -->
        <div>
            <label class="block text-xs font-semibold text-gray-700 mb-1">
                WhatsApp Number
                <span class="text-gray-400 font-normal">(optional — include to send via WhatsApp)</span>
            </label>
            <div class="flex">
                <span class="inline-flex items-center px-3 py-2 border border-r-0 border-gray-300
                             rounded-l-lg bg-gray-50 text-sm text-gray-600 select-none">+91</span>
                <input type="tel" id="waNumber" placeholder="9876543210" maxlength="10"
                    class="flex-1 border border-gray-300 rounded-r-lg px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
                    oninput="updateWaBtn()">
            </div>
        </div>

        <!-- Brand Selection -->
        <div>
            <label class="block text-xs font-semibold text-gray-700 mb-2">
                Select Brands <span class="text-red-500">*</span>
            </label>
            <div id="brandsContainer" class="flex flex-col gap-2 text-sm text-gray-500">
                <span class="text-xs text-gray-400">Loading brands…</span>
            </div>
        </div>

        <!-- Category Filter (shown after brands are selected) -->
        <div id="categoriesSection" style="display:none">
            <label class="block text-xs font-semibold text-gray-700 mb-2">Categories</label>
            <div id="categoriesContainer" class="flex flex-wrap gap-2"></div>
            <div class="mt-1.5 text-[10px] text-gray-400">All categories selected by default. Uncheck to exclude.</div>
        </div>

        <!-- Markup % -->
        <div>
            <label class="block text-xs font-semibold text-gray-700 mb-1">
                Markup % <span class="text-red-500">*</span>
            </label>
            <div class="flex items-center gap-3">
                <input type="number" id="markupPct" value="10" min="0" max="200" step="0.5"
                    class="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    oninput="updateMarkupPreview()">
                <span class="text-xs text-gray-500">%</span>
                <span id="markupPreview" class="text-xs text-emerald-600 font-medium">
                    DPL ₹500 → Final ₹649
                </span>
            </div>
        </div>

        <!-- Effective Date -->
        <div>
            <label class="block text-xs font-semibold text-gray-700 mb-1">Effective Date</label>
            <input type="date" id="effectiveDate"
                class="border border-gray-300 rounded-lg px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-indigo-300">
        </div>

        <!-- Action Buttons -->
        <div class="flex flex-col sm:flex-row gap-2 pt-1">
            <button onclick="generatePriceList('download')"
                class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600
                       hover:bg-indigo-700 active:bg-indigo-800 text-white text-sm font-semibold
                       rounded-lg transition">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0
                           01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                </svg>
                Download PDF
            </button>
            <button id="waSendBtn" onclick="generatePriceList('whatsapp')" disabled
                class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600
                       hover:bg-emerald-700 active:bg-emerald-800 disabled:bg-gray-300
                       disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0
                           01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8
                           9-8s9 3.582 9 8z"/>
                </svg>
                Send on WhatsApp
            </button>
        </div>

    </div><!-- /Form Card -->

</div><!-- /container -->

<script>
    var brandsData = [];

    function getToken() {
        return localStorage.getItem('auth_token') || '';
    }

    function showToast(msg, type) {
        var t = document.getElementById('toast');
        t.textContent = msg;
        t.className = 'toast show toast-' + (type || 'success');
        setTimeout(function() { t.className = 'toast'; }, 3500);
    }

    function setLoading(on) {
        var ov = document.getElementById('loadingOverlay');
        ov.classList.toggle('hidden', !on);
        ov.classList.toggle('flex', on);
    }

    function updateWaBtn() {
        var val = document.getElementById('waNumber').value.replace(/\D/g, '');
        document.getElementById('waSendBtn').disabled = (val.length !== 10);
    }

    function updateMarkupPreview() {
        var pct = parseFloat(document.getElementById('markupPct').value) || 0;
        var finalPrice = Math.ceil(500 * (1 + pct / 100) * 1.18);
        document.getElementById('markupPreview').textContent =
            'DPL ₹500 → Final ₹' + finalPrice.toLocaleString('en-IN');
    }

    function refreshCategories() {
        var checked = Array.from(document.querySelectorAll('.brand-cb:checked')).map(function(cb) { return cb.value; });
        var cats = new Set();
        brandsData.filter(function(b) { return checked.indexOf(b.brand) !== -1; })
                  .forEach(function(b) { (b.categories || []).forEach(function(c) { cats.add(c); }); });

        var section = document.getElementById('categoriesSection');
        var container = document.getElementById('categoriesContainer');

        if (cats.size === 0) { section.style.display = 'none'; return; }
        section.style.display = '';

        var sorted = Array.from(cats).sort();
        container.innerHTML = sorted.map(function(c) {
            return '<label class="flex items-center gap-1.5 cursor-pointer bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-indigo-50 hover:border-indigo-300 transition">'
                + '<input type="checkbox" class="cat-cb accent-indigo-600" value="' + c + '" checked>'
                + '<span class="text-xs text-gray-700">' + c + '</span>'
                + '</label>';
        }).join('');
    }

    async function loadBrands() {
        try {
            var resp = await fetch('/api/price-list/brands', {
                headers: { 'Authorization': 'Bearer ' + getToken() }
            });
            var body = await resp.json();
            if (!body.success) throw new Error(body.message || 'Failed to load brands');
            brandsData = body.data || [];

            var container = document.getElementById('brandsContainer');
            if (!brandsData.length) {
                container.innerHTML = '<p class="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-lg p-3">'
                    + 'No brands with saved DPL data found. '
                    + '<a href="/admin-dpl.html" class="text-amber-700 underline">Upload DPL data first</a>.'
                    + '</p>';
                return;
            }

            container.innerHTML = brandsData.map(function(b) {
                var updated = b.effective_date ? 'Updated ' + b.effective_date : 'No date';
                return '<label class="flex items-center gap-3 cursor-pointer p-3 border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-indigo-200 transition">'
                    + '<input type="checkbox" class="brand-cb accent-indigo-600 w-4 h-4 shrink-0" value="' + b.brand + '" onchange="refreshCategories()">'
                    + '<div>'
                    + '<div class="text-sm font-semibold text-gray-800">' + b.label + '</div>'
                    + '<div class="text-[10px] text-gray-400">' + b.item_count + ' items · ' + updated + '</div>'
                    + '</div>'
                    + '</label>';
            }).join('');

        } catch (e) {
            document.getElementById('brandsContainer').innerHTML =
                '<p class="text-xs text-red-500">Failed to load brands: ' + e.message + '</p>';
        }
    }

    async function generatePriceList(mode) {
        var customerName = document.getElementById('customerName').value.trim();
        if (!customerName) { showToast('Customer name is required', 'error'); return; }

        var selectedBrands = Array.from(document.querySelectorAll('.brand-cb:checked')).map(function(cb) { return cb.value; });
        if (!selectedBrands.length) { showToast('Select at least one brand', 'error'); return; }

        var markupPct = parseFloat(document.getElementById('markupPct').value);
        if (isNaN(markupPct) || markupPct < 0 || markupPct > 200) {
            showToast('Markup % must be between 0 and 200', 'error'); return;
        }

        var selectedCats = Array.from(document.querySelectorAll('.cat-cb:checked')).map(function(cb) { return cb.value; });
        var effectiveDate = document.getElementById('effectiveDate').value;
        var waNumber = document.getElementById('waNumber').value.replace(/\D/g, '');

        var payload = {
            customer_name: customerName,
            brands: selectedBrands,
            categories: selectedCats,
            markup_percent: markupPct,
            effective_date: effectiveDate,
        };
        if (mode === 'whatsapp' && waNumber.length === 10) {
            payload.whatsapp_number = waNumber;
        }

        setLoading(true);
        try {
            var resp = await fetch('/api/price-list/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + getToken(),
                },
                body: JSON.stringify(payload),
            });

            if (!resp.ok) {
                var ct = resp.headers.get('Content-Type') || '';
                if (ct.includes('application/json')) {
                    var errBody = await resp.json();
                    throw new Error(errBody.message || 'Generation failed');
                }
                throw new Error('HTTP ' + resp.status);
            }

            // Trigger download
            var blob = await resp.blob();
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            var safeName = customerName.replace(/[^a-zA-Z0-9 \-_]/g, '').replace(/ /g, '_');
            a.href = url;
            a.download = 'PriceList-' + safeName + '.pdf';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            var msg = mode === 'whatsapp'
                ? 'PDF downloaded & sent to +91 ' + waNumber
                : 'Price list downloaded';
            showToast(msg, 'success');

        } catch (e) {
            showToast('Error: ' + e.message, 'error');
        } finally {
            setLoading(false);
        }
    }

    // ── Init ──
    document.getElementById('effectiveDate').value = new Date().toISOString().slice(0, 10);
    updateMarkupPreview();
    loadBrands();
</script>

</body>
</html>
```

- [ ] **Step 2: Verify the page loads in the browser**

Start server: `pm2 restart business-manager` (or `node server.js` locally)

Open: `http://localhost:3000/admin-price-list-generator.html`

Check:
- Page loads without JS errors in console
- "Price List Generator" heading visible
- Brands load from API (or "No brands" message if none saved)
- Markup preview updates when % changes
- WhatsApp button disabled until 10-digit number entered
- Zoho subnav shows "Price List" link, highlighted when on this page

- [ ] **Step 3: End-to-end test (manual)**

Prerequisites: at least one brand must have saved DPL data in `brand_dpl_lists` (upload via admin-dpl.html first if needed).

1. Open the page
2. Enter `Test Customer` as customer name
3. Check a brand checkbox → categories appear
4. Set markup 10%
5. Click "Download PDF" → PDF downloads
6. Open PDF: verify header shows "QUALITY COLOURS", customer name "Test Customer", brand section headers, product rows with prices, footer with page numbers

- [ ] **Step 4: Commit**

```
git add public/admin-price-list-generator.html
git commit -m "feat(price-list): admin price list generator UI — brands, categories, markup, download + WhatsApp"
```

---

## Run Full Test Suite

After all tasks, verify nothing is broken:

```
npx jest --no-coverage
```

Expected: all existing tests pass + new tests in `tests/unit/price-list-pdf-generator.test.js` and `tests/unit/price-list-route.test.js`.
