# Price List Generator v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the Customer Price List Generator with individual product selection (category accordion + search), negative markup %, a Category column in the PDF, and proper ₹ symbol rendering via Noto Sans font.

**Architecture:** groupRowsForPdf returns a flat `items[]` instead of `categories[]`; generatePriceListPdf renders a 5-column table with no category sub-bands; a new GET /items endpoint feeds the 2-step accordion UI; POST /generate accepts an explicit `items[]` payload instead of brand+category filters.

**Tech Stack:** Node.js, Express, PDFKit v0.17.2, Noto Sans TTF (Google Fonts), vanilla JS, Tailwind CSS

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `assets/fonts/NotoSans-Regular.ttf` | Create | Embedded font for ₹ symbol |
| `assets/fonts/NotoSans-Bold.ttf` | Create | Embedded bold font for headers |
| `services/price-list-pdf-generator.js` | Modify | Font registration, flat groupRowsForPdf, 5-column table |
| `tests/unit/price-list-pdf-generator.test.js` | Modify | Update groupRowsForPdf tests + smoke test to flat format |
| `routes/price-list.js` | Modify | Add GET /items, rewrite POST /generate |
| `public/admin-price-list-generator.html` | Modify | 2-step UI with accordion + search |

---

### Task 1: Update `groupRowsForPdf` to flat shape + download fonts

**Files:**
- Modify: `services/price-list-pdf-generator.js`
- Modify: `tests/unit/price-list-pdf-generator.test.js`
- Create: `assets/fonts/NotoSans-Regular.ttf`
- Create: `assets/fonts/NotoSans-Bold.ttf`

- [ ] **Step 1: Write the failing tests for new groupRowsForPdf shape**

Open `tests/unit/price-list-pdf-generator.test.js`. Replace the entire `describe('groupRowsForPdf', ...)` block with:

```js
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

    test('returns flat items array (no categories)', () => {
        const result = groupRowsForPdf(rows, 'Birla Opus');
        expect(Array.isArray(result.items)).toBe(true);
        expect(result.items).toHaveLength(3);
        expect(result).not.toHaveProperty('categories');
    });

    test('items sorted: category asc, then productName, then packSize', () => {
        const result = groupRowsForPdf(rows, 'Birla Opus');
        expect(result.items[0].category).toBe('Exterior');
        expect(result.items[1].category).toBe('Interior');
        expect(result.items[2].category).toBe('Interior');
        expect(result.items[1].packSize).toBe('1L');
        expect(result.items[2].packSize).toBe('4L');
    });

    test('item shape: productName, category, colourName, packSize, finalPrice', () => {
        const result = groupRowsForPdf(rows, 'Birla Opus');
        const item = result.items[1]; // Interior 1L
        expect(item).toMatchObject({
            productName: 'One Pure Elegance',
            category:    'Interior',
            colourName:  'White',
            packSize:    '1L',
            finalPrice:  649,
        });
    });

    test('rows without category default to "Other"', () => {
        const r = groupRowsForPdf([{ product: 'X', packSize: '1L', finalPrice: 100 }], 'Brand');
        expect(r.items[0].category).toBe('Other');
    });

    test('handles empty rows array', () => {
        const result = groupRowsForPdf([], 'Brand');
        expect(result.items).toHaveLength(0);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest tests/unit/price-list-pdf-generator.test.js --no-coverage
```

Expected: `groupRowsForPdf` tests fail (result has `categories` not `items`). `computeFinalPrice` tests still pass.

- [ ] **Step 3: Rewrite `groupRowsForPdf` in the service**

Open `services/price-list-pdf-generator.js`. Replace the entire `groupRowsForPdf` function:

```js
function groupRowsForPdf(rows, brandLabel) {
    const items = rows.map(row => ({
        productName: row.product || '',
        category:    (row.category || 'Other').trim(),
        colourName:  row.colourName || '',
        packSize:    row.packSize || '',
        finalPrice:  row.finalPrice || 0,
    }));
    items.sort((a, b) => {
        const c = a.category.localeCompare(b.category);
        if (c !== 0) return c;
        const n = a.productName.localeCompare(b.productName);
        return n !== 0 ? n : a.packSize.localeCompare(b.packSize);
    });
    return { brandLabel, items };
}
```

- [ ] **Step 4: Run tests to verify groupRowsForPdf tests pass**

```bash
npx jest tests/unit/price-list-pdf-generator.test.js --no-coverage
```

Expected: all `computeFinalPrice` + `groupRowsForPdf` tests pass. The `generatePriceListPdf` smoke test may still pass because it uses hardcoded groups (not calling groupRowsForPdf). Confirm total pass count.

- [ ] **Step 5: Download Noto Sans font files**

Run in PowerShell from the project root:

```powershell
New-Item -ItemType Directory -Force assets/fonts
Invoke-WebRequest -Uri "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf" -OutFile "assets/fonts/NotoSans-Regular.ttf"
Invoke-WebRequest -Uri "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf" -OutFile "assets/fonts/NotoSans-Bold.ttf"
```

Verify both files exist and are > 200KB:

```powershell
Get-Item assets/fonts/NotoSans-Regular.ttf, assets/fonts/NotoSans-Bold.ttf | Select-Object Name, Length
```

- [ ] **Step 6: Commit**

```bash
git add services/price-list-pdf-generator.js tests/unit/price-list-pdf-generator.test.js assets/fonts/NotoSans-Regular.ttf assets/fonts/NotoSans-Bold.ttf
git commit -m "feat(price-list): flat groupRowsForPdf shape + Noto Sans font files"
```

---

### Task 2: Rewrite `generatePriceListPdf` — Noto Sans + 5-column flat table

**Files:**
- Modify: `services/price-list-pdf-generator.js`
- Modify: `tests/unit/price-list-pdf-generator.test.js`

- [ ] **Step 1: Update the smoke test to use the new flat items shape**

In `tests/unit/price-list-pdf-generator.test.js`, replace the `describe('generatePriceListPdf', ...)` block:

```js
describe('generatePriceListPdf', () => {
    test('returns a Buffer starting with PDF magic bytes', async () => {
        const { generatePriceListPdf } = require('../../services/price-list-pdf-generator');
        const groups = [{
            brandLabel: 'Test Brand',
            items: [
                { productName: 'Test Product', category: 'Interior', colourName: 'White', packSize: '1L', finalPrice: 649 },
                { productName: 'Test Product', category: 'Interior', colourName: 'White', packSize: '4L', finalPrice: 2245 },
                { productName: 'Ext Paint',    category: 'Exterior', colourName: 'Base',  packSize: '10L', finalPrice: 3500 },
            ],
        }];
        const buffer = await generatePriceListPdf(groups, {
            customerName: 'Test Customer',
            markupPercent: 10,
            effectiveDate: '2026-05-21',
        });
        expect(Buffer.isBuffer(buffer)).toBe(true);
        expect(buffer.length).toBeGreaterThan(100);
        expect(buffer.slice(0, 4).toString('ascii')).toBe('%PDF');
    }, 15000);
});
```

- [ ] **Step 2: Run tests to verify smoke test fails**

```bash
npx jest tests/unit/price-list-pdf-generator.test.js --no-coverage
```

Expected: smoke test passes if the old generator still works with the new flat shape (the generator crashes or produces nothing because it iterates `group.categories` which is now undefined). Confirm it fails or crashes.

- [ ] **Step 3: Rewrite `generatePriceListPdf` with Noto Sans + 5-column layout**

Open `services/price-list-pdf-generator.js`. Replace the entire file with:

```js
const PDFDocument = require('pdfkit');
const path = require('path');

const BRAND_GREEN   = '#1B5E3B';
const COMPANY_NAME  = 'Quality Colours';
const COMPANY_DETAIL = 'Quality Colours, Chennai  |  +91 74188 31122';

const FONT_REGULAR = path.join(__dirname, '../assets/fonts/NotoSans-Regular.ttf');
const FONT_BOLD    = path.join(__dirname, '../assets/fonts/NotoSans-Bold.ttf');

function computeFinalPrice(dpl, markupPercent) {
    const d = parseFloat(dpl);
    const m = parseFloat(markupPercent);
    if (!isFinite(d) || !isFinite(m)) return 0;
    return Math.ceil(d * (1 + m / 100) * 1.18);
}

function groupRowsForPdf(rows, brandLabel) {
    const items = rows.map(row => ({
        productName: row.product || '',
        category:    (row.category || 'Other').trim(),
        colourName:  row.colourName || '',
        packSize:    row.packSize || '',
        finalPrice:  row.finalPrice || 0,
    }));
    items.sort((a, b) => {
        const c = a.category.localeCompare(b.category);
        if (c !== 0) return c;
        const n = a.productName.localeCompare(b.productName);
        return n !== 0 ? n : a.packSize.localeCompare(b.packSize);
    });
    return { brandLabel, items };
}

function formatDisplayDate(isoDate) {
    if (!isoDate) return '';
    const d = new Date(isoDate + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatINR(num) {
    return '₹ ' + Math.round(parseFloat(num) || 0).toLocaleString('en-IN');
}

function generatePriceListPdf(brandGroups, { customerName, markupPercent, effectiveDate }) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });

        doc.registerFont('Regular', FONT_REGULAR);
        doc.registerFont('Bold',    FONT_BOLD);

        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const MARGIN        = 40;
        const PAGE_W        = doc.page.width - 2 * MARGIN;
        const PAGE_H        = doc.page.height;
        const FOOTER_RESERVE = 45;
        const ROW_H         = 18;

        const COL_PRODUCT  = 206;
        const COL_CATEGORY =  77;
        const COL_COLOUR   =  88;
        const COL_SIZE     =  62;
        const COL_PRICE    =  77;

        const markupSign  = markupPercent >= 0 ? '+' : '';
        const displayDate = formatDisplayDate(effectiveDate || new Date().toISOString().slice(0, 10));

        function drawPageHeader() {
            const y = MARGIN;
            doc.fontSize(18).fillColor(BRAND_GREEN).font('Bold')
               .text(COMPANY_NAME, MARGIN, y, { lineBreak: false });
            doc.fontSize(9).fillColor('#6b7280').font('Regular')
               .text('Price List', MARGIN, y + 24, { lineBreak: false });
            doc.fontSize(7.5).fillColor('#9ca3af').font('Regular')
               .text(COMPANY_DETAIL, MARGIN, y + 6, { width: PAGE_W, align: 'right', lineBreak: false });
            doc.moveTo(MARGIN, y + 38).lineTo(MARGIN + PAGE_W, y + 38)
               .strokeColor('#d1d5db').lineWidth(0.5).stroke();
            return y + 50;
        }

        function drawTableHeader(y) {
            doc.rect(MARGIN, y, PAGE_W, 16).fill('#1f2937');
            doc.fontSize(7.5).fillColor('#ffffff').font('Bold');
            let x = MARGIN + 4;
            doc.text('PRODUCT',  x, y + 4, { width: COL_PRODUCT  - 8, lineBreak: false }); x += COL_PRODUCT;
            doc.text('CATEGORY', x + 4, y + 4, { width: COL_CATEGORY - 8, lineBreak: false }); x += COL_CATEGORY;
            doc.text('COLOUR',   x + 4, y + 4, { width: COL_COLOUR   - 8, lineBreak: false }); x += COL_COLOUR;
            doc.text('SIZE',     x + 4, y + 4, { width: COL_SIZE     - 8, lineBreak: false }); x += COL_SIZE;
            doc.text('PRICE',    x,     y + 4, { width: COL_PRICE    - 4, align: 'right', lineBreak: false });
            return y + 16;
        }

        let y = drawPageHeader();

        doc.fontSize(11).fillColor('#1f2937').font('Bold')
           .text('Prepared for: ' + customerName, MARGIN, y + 10, { lineBreak: false });
        doc.fontSize(8.5).fillColor('#6b7280').font('Regular')
           .text('Date: ' + displayDate + '     Markup: ' + markupSign + markupPercent + '%     Prices inclusive of 18% GST',
                 MARGIN, y + 26, { lineBreak: false });
        doc.moveTo(MARGIN, y + 42).lineTo(MARGIN + PAGE_W, y + 42)
           .strokeColor('#e5e7eb').lineWidth(0.5).stroke();
        y += 52;

        for (const group of brandGroups) {
            if (y > PAGE_H - FOOTER_RESERVE - 100) {
                doc.addPage();
                y = drawPageHeader();
            }

            doc.rect(MARGIN, y, PAGE_W, 22).fill('#f0fdf4');
            doc.moveTo(MARGIN, y).lineTo(MARGIN + PAGE_W, y).strokeColor('#a7f3d0').lineWidth(1).stroke();
            doc.fontSize(12).fillColor(BRAND_GREEN).font('Bold')
               .text(group.brandLabel.toUpperCase(), MARGIN + 8, y + 5, { width: PAGE_W - 16, lineBreak: false });
            doc.moveTo(MARGIN, y + 22).lineTo(MARGIN + PAGE_W, y + 22).strokeColor('#a7f3d0').lineWidth(0.5).stroke();
            y += 26;

            if (y > PAGE_H - FOOTER_RESERVE - 40) {
                doc.addPage();
                y = drawPageHeader();
            }
            y = drawTableHeader(y);

            for (let i = 0; i < group.items.length; i++) {
                if (y + ROW_H > PAGE_H - FOOTER_RESERVE) {
                    doc.addPage();
                    y = drawPageHeader();
                    y = drawTableHeader(y);
                }
                const item = group.items[i];
                if (i % 2 === 1) {
                    doc.rect(MARGIN, y, PAGE_W, ROW_H).fill('#f9fafb');
                }
                doc.fontSize(9).fillColor('#374151').font('Regular');
                let x = MARGIN + 4;
                doc.text(item.productName,           x,     y + 4, { width: COL_PRODUCT  - 8, lineBreak: false }); x += COL_PRODUCT;
                doc.text(item.category,              x + 4, y + 4, { width: COL_CATEGORY - 8, lineBreak: false }); x += COL_CATEGORY;
                doc.text(item.colourName || '-',     x + 4, y + 4, { width: COL_COLOUR   - 8, lineBreak: false }); x += COL_COLOUR;
                doc.text(item.packSize,              x + 4, y + 4, { width: COL_SIZE     - 8, lineBreak: false }); x += COL_SIZE;
                doc.fontSize(9).fillColor('#059669').font('Bold')
                   .text(formatINR(item.finalPrice), x,     y + 4, { width: COL_PRICE    - 4, align: 'right', lineBreak: false });
                doc.moveTo(MARGIN, y + ROW_H).lineTo(MARGIN + PAGE_W, y + ROW_H).strokeColor('#f1f5f9').lineWidth(0.3).stroke();
                y += ROW_H;
            }
            y += 10;
        }

        const totalPages = doc.bufferedPageRange().count;
        for (let i = 0; i < totalPages; i++) {
            doc.switchToPage(i);
            const fy = PAGE_H - 30;
            doc.moveTo(MARGIN, fy - 10).lineTo(MARGIN + PAGE_W, fy - 10).strokeColor('#d1d5db').lineWidth(0.5).stroke();
            doc.fontSize(7.5).fillColor('#9ca3af').font('Regular');
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

- [ ] **Step 4: Run all tests**

```bash
npx jest tests/unit/price-list-pdf-generator.test.js --no-coverage
```

Expected: all tests pass — 7 computeFinalPrice + 6 groupRowsForPdf + 1 smoke test = 14 tests passing.

- [ ] **Step 5: Commit**

```bash
git add services/price-list-pdf-generator.js tests/unit/price-list-pdf-generator.test.js
git commit -m "feat(price-list): Noto Sans font + 5-column flat PDF table (v2)"
```

---

### Task 3: Add `GET /items` + rewrite `POST /generate`

**Files:**
- Modify: `routes/price-list.js`

- [ ] **Step 1: Add GET /items endpoint**

Open `routes/price-list.js`. After the `GET /brands` route (line 68) and before `POST /generate`, insert the following route:

```js
// ─── GET /items ───────────────────────────────────────────────────────────────
router.get('/items', perm, async (req, res) => {
    try {
        const raw = typeof req.query.brands === 'string' ? req.query.brands : '';
        const requested = raw.split(',').map(b => b.trim().toLowerCase()).filter(Boolean);

        const VALID_BRANDS = Object.keys(BRAND_LABELS);
        const validated = requested.filter(b => VALID_BRANDS.includes(b)).slice(0, 6);
        if (validated.length === 0) {
            return res.status(400).json({ success: false, message: 'No valid brands supplied' });
        }

        const data = [];
        for (const brand of validated) {
            const [rows] = await pool.query(
                'SELECT parsed_rows FROM brand_dpl_lists WHERE brand = ? AND parsed_rows IS NOT NULL AND parsed_count > 0',
                [brand]
            );
            if (!rows.length || !rows[0].parsed_rows) continue;

            let parsedRows;
            try {
                parsedRows = typeof rows[0].parsed_rows === 'string'
                    ? JSON.parse(rows[0].parsed_rows) : rows[0].parsed_rows;
            } catch (e) { continue; }

            for (const r of parsedRows) {
                data.push({
                    brand,
                    brandLabel: BRAND_LABELS[brand],
                    category:   (r.category || 'Other').trim(),
                    product:    r.product || '',
                    colourName: r.colourName || '',
                    packSize:   r.packSize || '',
                    dpl:        parseFloat(r.dpl) || 0,
                });
            }
        }

        data.sort((a, b) => {
            const br = a.brand.localeCompare(b.brand);
            if (br !== 0) return br;
            const ca = a.category.localeCompare(b.category);
            if (ca !== 0) return ca;
            const pr = a.product.localeCompare(b.product);
            return pr !== 0 ? pr : a.packSize.localeCompare(b.packSize);
        });

        res.json({ success: true, data });
    } catch (err) {
        console.error('[price-list] GET /items:', err);
        res.status(500).json({ success: false, message: 'Failed to load items' });
    }
});
```

- [ ] **Step 2: Rewrite `POST /generate`**

Replace the entire `POST /generate` route (from `router.post('/generate', perm, async (req, res) => {` through the closing `});`) with:

```js
// ─── POST /generate ───────────────────────────────────────────────────────────
router.post('/generate', perm, async (req, res) => {
    try {
        let { customer_name, whatsapp_number, markup_percent, effective_date, items } = req.body;

        if (!customer_name || typeof customer_name !== 'string' || !customer_name.trim()) {
            return res.status(400).json({ success: false, message: 'customer_name is required' });
        }
        customer_name = customer_name.trim().slice(0, 100);
        const safeName = customer_name.replace(/[^a-zA-Z0-9\-_]/g, '_');

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'items must be a non-empty array' });
        }
        if (items.length > 500) {
            return res.status(400).json({ success: false, message: 'Too many items (max 500)' });
        }

        const markupPct = parseFloat(markup_percent);
        if (isNaN(markupPct) || markupPct < -99 || markupPct > 200) {
            return res.status(400).json({ success: false, message: 'markup_percent must be between -99 and 200' });
        }

        const VALID_BRANDS = Object.keys(BRAND_LABELS);
        for (const item of items) {
            if (!item.brand || !VALID_BRANDS.includes(item.brand)) {
                return res.status(400).json({ success: false, message: 'Invalid brand in items' });
            }
            if (typeof item.dpl !== 'number' || item.dpl < 0) {
                return res.status(400).json({ success: false, message: 'items[].dpl must be a number >= 0' });
            }
        }

        let waNumber = null;
        if (whatsapp_number) {
            const digits = String(whatsapp_number).replace(/\D/g, '');
            const normalized = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits;
            if (normalized.length === 10) waNumber = normalized;
        }

        const withPrice = items.map(item => ({
            product:    item.product || '',
            category:   item.category || 'Other',
            colourName: item.colourName || '',
            packSize:   item.packSize || '',
            finalPrice: computeFinalPrice(item.dpl, markupPct),
        }));

        const brandMap = new Map();
        for (let i = 0; i < items.length; i++) {
            const brand = items[i].brand;
            const label = items[i].brandLabel || BRAND_LABELS[brand] || brand;
            if (!brandMap.has(brand)) brandMap.set(brand, { label, rows: [] });
            brandMap.get(brand).rows.push(withPrice[i]);
        }

        const brandGroups = [];
        for (const [, { label, rows }] of brandMap) {
            brandGroups.push(groupRowsForPdf(rows, label));
        }

        const pdfBuffer = await generatePriceListPdf(brandGroups, {
            customerName: customer_name,
            markupPercent: markupPct,
            effectiveDate: effective_date || new Date().toISOString().slice(0, 10),
        });

        if (waNumber) {
            let tmpPath = null;
            try {
                const tmpDir = path.join(os.tmpdir(), 'qc-price-lists');
                fs.mkdirSync(tmpDir, { recursive: true });
                tmpPath = path.join(tmpDir, `PL-${safeName}-${Date.now()}.pdf`);
                fs.writeFileSync(tmpPath, pdfBuffer);

                const markupSign = markupPct >= 0 ? '+' : '';
                const caption = `Hi! Please find your price list attached.\nCustomer: ${customer_name}\nDate: ${effective_date || new Date().toISOString().slice(0, 10)}\nMarkup: ${markupSign}${markupPct}%`;
                const mediaOpts = { type: 'document', mediaPath: tmpPath, caption, filename: `PriceList-${safeName}.pdf` };
                const source = { source: 'price_list', sent_by: req.user?.id };

                const ADMIN_BRANCH = -1;
                const GENERAL_ID   =  0;
                let sent = false;
                try { sent = await sessionManager.sendMedia(ADMIN_BRANCH, waNumber, mediaOpts, source); } catch (e) { /* fallback */ }
                if (!sent) {
                    try { sent = await sessionManager.sendMedia(GENERAL_ID, waNumber, mediaOpts, source); } catch (e) { /* ignore */ }
                }
            } catch (e) {
                console.warn('[price-list] WhatsApp send failed:', e.message);
            } finally {
                if (tmpPath) try { fs.unlinkSync(tmpPath); } catch (_) {}
            }
        }

        const dateStr = (effective_date || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="PriceList-${safeName}-${dateStr}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        res.end(pdfBuffer);

    } catch (err) {
        console.error('[price-list] POST /generate:', err);
        res.status(500).json({ success: false, message: 'Failed to generate price list' });
    }
});
```

- [ ] **Step 3: Run all tests**

```bash
npx jest tests/unit/price-list-pdf-generator.test.js --no-coverage
```

Expected: 14 tests pass (route changes have no unit tests — integration tested via browser in Task 4).

- [ ] **Step 4: Commit**

```bash
git add routes/price-list.js
git commit -m "feat(price-list): GET /items endpoint + POST /generate accepts items[] (v2)"
```

---

### Task 4: Rewrite `admin-price-list-generator.html` — 2-step UI

**Files:**
- Modify: `public/admin-price-list-generator.html`

- [ ] **Step 1: Read the current file to understand its structure**

Read `public/admin-price-list-generator.html` (first 60 lines) to find the `<head>` tag, auth guard, and layout class names used.

- [ ] **Step 2: Replace the full HTML file**

Write the complete file `public/admin-price-list-generator.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Price List Generator | QC Paint Shop</title>
    <link rel="stylesheet" href="/css/tailwind.css">
    <link rel="stylesheet" href="/css/design-system.css">
    <script src="/js/auth-helper.js"></script>
    <style>
        .accordion-body { display: none; }
        .accordion-body.open { display: block; }
        .item-row.hidden { display: none; }
    </style>
</head>
<body class="bg-gray-50 min-h-screen">
<div id="app" class="max-w-4xl mx-auto px-4 py-6">

    <div class="flex items-center gap-3 mb-6">
        <a href="/admin-dpl.html" class="text-gray-500 hover:text-gray-700 text-sm">← DPL</a>
        <h1 class="text-2xl font-bold text-gray-900">Price List Generator</h1>
    </div>

    <!-- Step 1: Config -->
    <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6" id="step1">
        <h2 class="text-base font-semibold text-gray-700 mb-4">Step 1 — Configure</h2>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Customer Name <span class="text-red-500">*</span></label>
                <input id="customerName" type="text" maxlength="100" placeholder="e.g. Raj Constructions"
                       class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
            </div>
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">WhatsApp Number</label>
                <div class="flex">
                    <span class="inline-flex items-center px-3 border border-r-0 border-gray-300 rounded-l-lg bg-gray-50 text-gray-500 text-sm">+91</span>
                    <input id="waNumber" type="tel" maxlength="10" placeholder="10-digit mobile"
                           class="flex-1 border border-gray-300 rounded-r-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                </div>
            </div>
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Markup % <span class="text-red-500">*</span></label>
                <div class="flex items-center gap-3">
                    <input id="markupPct" type="number" min="-99" max="200" value="10"
                           class="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                           oninput="updateMarkupPreview()">
                    <span id="markupPreview" class="text-sm text-gray-500">DPL ₹500 → Final ₹649</span>
                </div>
            </div>
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Effective Date</label>
                <input id="effectiveDate" type="date"
                       class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
            </div>
        </div>

        <div class="mt-4">
            <label class="block text-sm font-medium text-gray-700 mb-2">Select Brands <span class="text-red-500">*</span></label>
            <div id="brandCheckboxes" class="flex flex-wrap gap-3 text-sm text-gray-600">
                <span class="text-gray-400 text-xs">Loading brands…</span>
            </div>
        </div>

        <div class="mt-5">
            <button id="loadBtn" onclick="loadItems()"
                    class="bg-green-700 hover:bg-green-800 text-white font-medium text-sm px-5 py-2.5 rounded-lg transition-colors">
                Load Products →
            </button>
            <span id="loadError" class="ml-3 text-red-500 text-sm hidden"></span>
        </div>
    </div>

    <!-- Step 2: Product selection -->
    <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6 hidden" id="step2">
        <h2 class="text-base font-semibold text-gray-700 mb-4">Step 2 — Select Products</h2>

        <div class="flex flex-col sm:flex-row gap-3 mb-4">
            <input id="searchBox" type="text" placeholder="🔍 Search products…" oninput="filterItems(this.value)"
                   class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
            <div class="flex gap-2">
                <button onclick="selectAllItems(true)"  class="text-xs px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Select All</button>
                <button onclick="selectAllItems(false)" class="text-xs px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Clear All</button>
            </div>
        </div>

        <div id="accordion" class="space-y-2"></div>

        <div class="mt-4 pt-4 border-t border-gray-100 text-sm text-gray-600" id="selectionFooter">
            <span id="selectionCount">0 items selected</span>
        </div>
    </div>

    <!-- Action buttons (always visible once step 2 shown) -->
    <div class="flex gap-3 hidden" id="actionRow">
        <button id="downloadBtn" onclick="generatePriceList('download')" disabled
                class="flex-1 sm:flex-none bg-green-700 hover:bg-green-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-sm px-6 py-2.5 rounded-lg transition-colors">
            ⬇ Download PDF
        </button>
        <button id="waBtn" onclick="generatePriceList('whatsapp')" disabled
                class="flex-1 sm:flex-none bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-sm px-6 py-2.5 rounded-lg transition-colors">
            📱 Send on WhatsApp
        </button>
    </div>

</div>

<script>
var allItems    = [];
var selectedIds = new Set();

function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function itemId(item) {
    return item.brand + '|' + item.product + '|' + item.colourName + '|' + item.packSize;
}

// ── Markup preview ─────────────────────────────────────────────────────────────
function updateMarkupPreview() {
    const m   = parseFloat(document.getElementById('markupPct').value);
    const dpl = 500;
    if (!isFinite(m)) { document.getElementById('markupPreview').textContent = ''; return; }
    const final = Math.ceil(dpl * (1 + m / 100) * 1.18);
    document.getElementById('markupPreview').textContent = 'DPL ₹' + dpl + ' → Final ₹' + final.toLocaleString('en-IN');
}

// ── Load brands on page init ────────────────────────────────────────────────────
async function loadBrands() {
    try {
        const r = await fetch('/api/price-list/brands', { headers: authHeaders() });
        const d = await r.json();
        const container = document.getElementById('brandCheckboxes');
        if (!d.success || !d.data.length) {
            container.innerHTML = '<span class="text-red-500 text-xs">No DPL data found. Please upload DPL files first.</span>';
            return;
        }
        container.innerHTML = d.data.map(b =>
            `<label class="flex items-center gap-2 cursor-pointer">
               <input type="checkbox" value="${esc(b.brand)}" class="brand-cb rounded" checked>
               <span>${esc(b.label)}</span>
               <span class="text-gray-400 text-xs">(${b.item_count})</span>
             </label>`
        ).join('');
    } catch (e) {
        document.getElementById('brandCheckboxes').innerHTML = '<span class="text-red-500 text-xs">Failed to load brands.</span>';
    }
}

// ── Load items (Step 2 trigger) ─────────────────────────────────────────────────
async function loadItems() {
    const errEl = document.getElementById('loadError');
    errEl.classList.add('hidden');

    const name = document.getElementById('customerName').value.trim();
    if (!name) { errEl.textContent = 'Customer name is required.'; errEl.classList.remove('hidden'); return; }

    const brands = [...document.querySelectorAll('.brand-cb:checked')].map(c => c.value);
    if (!brands.length) { errEl.textContent = 'Select at least one brand.'; errEl.classList.remove('hidden'); return; }

    const markup = parseFloat(document.getElementById('markupPct').value);
    if (!isFinite(markup) || markup < -99 || markup > 200) {
        errEl.textContent = 'Markup must be between -99 and 200.'; errEl.classList.remove('hidden'); return;
    }

    document.getElementById('loadBtn').disabled = true;
    document.getElementById('loadBtn').textContent = 'Loading…';

    try {
        const r = await fetch('/api/price-list/items?brands=' + encodeURIComponent(brands.join(',')), { headers: authHeaders() });
        const d = await r.json();
        if (!d.success) throw new Error(d.message || 'Failed');
        allItems = d.data;
        selectedIds = new Set(allItems.map(itemId));
        renderAccordion(allItems);
        document.getElementById('step2').classList.remove('hidden');
        document.getElementById('actionRow').classList.remove('hidden');
        refreshSelectionCount();
    } catch (e) {
        errEl.textContent = e.message; errEl.classList.remove('hidden');
    } finally {
        document.getElementById('loadBtn').disabled = false;
        document.getElementById('loadBtn').textContent = 'Load Products →';
    }
}

// ── Accordion render ────────────────────────────────────────────────────────────
function renderAccordion(items) {
    const catMap = new Map();
    items.forEach((item, idx) => {
        const cat = item.brand + '||' + item.category;
        if (!catMap.has(cat)) catMap.set(cat, { brand: item.brand, brandLabel: item.brandLabel, category: item.category, indices: [] });
        catMap.get(cat).indices.push(idx);
    });

    let html = '';
    for (const [key, { brandLabel, category, indices }] of catMap) {
        const catLabel = esc(brandLabel) + ' — ' + esc(category);
        const safeKey  = esc(key);
        html += `<div class="border border-gray-200 rounded-lg overflow-hidden">
          <div class="flex items-center justify-between bg-gray-50 px-4 py-3 cursor-pointer select-none"
               onclick="toggleAccordion('${safeKey}')">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-gray-800">${catLabel}</span>
              <span class="text-xs text-gray-400 cat-count" data-cat="${safeKey}">(${indices.length} / ${indices.length})</span>
            </div>
            <div class="flex items-center gap-2">
              <button class="text-xs px-2 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50"
                      onclick="event.stopPropagation(); toggleCategory('${safeKey}', true)">All</button>
              <button class="text-xs px-2 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50"
                      onclick="event.stopPropagation(); toggleCategory('${safeKey}', false)">None</button>
              <span class="text-gray-400 text-xs accordion-chevron" data-cat="${safeKey}">▼</span>
            </div>
          </div>
          <div class="accordion-body open" data-cat="${safeKey}">
            <div class="divide-y divide-gray-100">`;

        for (const idx of indices) {
            const item = items[idx];
            const id   = itemId(item);
            const checked = selectedIds.has(id) ? 'checked' : '';
            html += `<label class="item-row flex items-center gap-3 px-4 py-2 hover:bg-gray-50 cursor-pointer"
                           data-idx="${idx}" data-cat="${safeKey}">
               <input type="checkbox" class="item-cb rounded" data-idx="${idx}" ${checked}
                      onchange="onItemCheck(this)">
               <span class="flex-1 text-sm text-gray-700">${esc(item.product)}</span>
               <span class="text-xs text-gray-500 w-24 text-right">${esc(item.colourName || '—')}</span>
               <span class="text-xs text-gray-500 w-12 text-right">${esc(item.packSize)}</span>
               <span class="text-xs text-gray-400 w-20 text-right">DPL ₹${Number(item.dpl).toLocaleString('en-IN')}</span>
             </label>`;
        }

        html += `</div></div></div>`;
    }
    document.getElementById('accordion').innerHTML = html;
}

function toggleAccordion(cat) {
    const body    = document.querySelector(`.accordion-body[data-cat="${CSS.escape(cat)}"]`);
    const chevron = document.querySelector(`.accordion-chevron[data-cat="${CSS.escape(cat)}"]`);
    if (!body) return;
    body.classList.toggle('open');
    if (chevron) chevron.textContent = body.classList.contains('open') ? '▼' : '▶';
}

function toggleCategory(cat, checked) {
    document.querySelectorAll(`.item-cb`).forEach(cb => {
        const row = cb.closest('.item-row');
        if (row && row.dataset.cat === cat) {
            cb.checked = checked;
            const idx  = parseInt(cb.dataset.idx, 10);
            const item = allItems[idx];
            if (item) {
                if (checked) selectedIds.add(itemId(item));
                else         selectedIds.delete(itemId(item));
            }
        }
    });
    updateCatCount(cat);
    refreshSelectionCount();
}

function selectAllItems(checked) {
    document.querySelectorAll('.item-cb').forEach(cb => {
        if (!cb.closest('.item-row').classList.contains('hidden')) {
            cb.checked = checked;
            const item = allItems[parseInt(cb.dataset.idx, 10)];
            if (item) {
                if (checked) selectedIds.add(itemId(item));
                else         selectedIds.delete(itemId(item));
            }
        }
    });
    document.querySelectorAll('.accordion-body[data-cat]').forEach(b => {
        updateCatCount(b.dataset.cat);
    });
    refreshSelectionCount();
}

function onItemCheck(cb) {
    const item = allItems[parseInt(cb.dataset.idx, 10)];
    if (!item) return;
    if (cb.checked) selectedIds.add(itemId(item));
    else            selectedIds.delete(itemId(item));
    const row = cb.closest('.item-row');
    if (row) updateCatCount(row.dataset.cat);
    refreshSelectionCount();
}

function updateCatCount(cat) {
    const rows    = document.querySelectorAll(`.item-row[data-cat="${CSS.escape(cat)}"]`);
    const checked = [...rows].filter(r => r.querySelector('.item-cb')?.checked && !r.classList.contains('hidden')).length;
    const total   = [...rows].filter(r => !r.classList.contains('hidden')).length;
    const el      = document.querySelector(`.cat-count[data-cat="${CSS.escape(cat)}"]`);
    if (el) el.textContent = `(${checked} / ${total})`;
}

function filterItems(query) {
    const q = query.toLowerCase().trim();
    document.querySelectorAll('.item-row').forEach(row => {
        const idx  = parseInt(row.dataset.idx, 10);
        const item = allItems[idx];
        const match = !q ||
            (item.product   || '').toLowerCase().includes(q) ||
            (item.colourName || '').toLowerCase().includes(q);
        row.classList.toggle('hidden', !match);
    });
    document.querySelectorAll('.accordion-body[data-cat]').forEach(b => {
        updateCatCount(b.dataset.cat);
    });
}

function refreshSelectionCount() {
    const count = selectedIds.size;
    document.getElementById('selectionCount').textContent = count + ' item' + (count === 1 ? '' : 's') + ' selected';
    document.getElementById('downloadBtn').disabled = count === 0;
    updateWaBtn();
}

function updateWaBtn() {
    const wa   = document.getElementById('waNumber').value.replace(/\D/g, '');
    const ok   = wa.length === 10 && selectedIds.size > 0;
    document.getElementById('waBtn').disabled = !ok;
}

// ── Generate PDF ────────────────────────────────────────────────────────────────
async function generatePriceList(mode) {
    const customerName = document.getElementById('customerName').value.trim();
    const waNumber     = document.getElementById('waNumber').value.replace(/\D/g, '');
    const markupPct    = parseFloat(document.getElementById('markupPct').value);
    const effectiveDate = document.getElementById('effectiveDate').value ||
                          new Date().toISOString().slice(0, 10);

    const selectedItems = allItems
        .filter(item => selectedIds.has(itemId(item)))
        .map(item => ({
            brand:      item.brand,
            brandLabel: item.brandLabel,
            category:   item.category,
            product:    item.product,
            colourName: item.colourName,
            packSize:   item.packSize,
            dpl:        item.dpl,
        }));

    if (!selectedItems.length) return;

    const btn = mode === 'download' ? document.getElementById('downloadBtn') : document.getElementById('waBtn');
    btn.disabled = true;
    btn.textContent = mode === 'download' ? '⬇ Generating…' : '📱 Sending…';

    try {
        const payload = {
            customer_name:    customerName,
            markup_percent:   markupPct,
            effective_date:   effectiveDate,
            items:            selectedItems,
        };
        if (mode === 'whatsapp') payload.whatsapp_number = waNumber;

        const r = await fetch('/api/price-list/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify(payload),
        });

        if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            throw new Error(d.message || ('HTTP ' + r.status));
        }

        if (mode === 'download') {
            const blob = await r.blob();
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            const date = effectiveDate.replace(/-/g, '');
            a.download = 'PriceList-' + customerName.replace(/[^a-zA-Z0-9]/g, '_') + '-' + date + '.pdf';
            a.click();
            URL.revokeObjectURL(url);
        } else {
            alert('Price list sent on WhatsApp!');
        }
    } catch (e) {
        alert('Error: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = mode === 'download' ? '⬇ Download PDF' : '📱 Send on WhatsApp';
        refreshSelectionCount();
    }
}

function authHeaders() {
    const token = localStorage.getItem('auth_token');
    return token ? { 'Authorization': 'Bearer ' + token } : {};
}

// ── Init ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('effectiveDate').value = new Date().toISOString().slice(0, 10);
    updateMarkupPreview();
    loadBrands();
    document.getElementById('waNumber').addEventListener('input', updateWaBtn);
});
</script>
</body>
</html>
```

- [ ] **Step 3: Start the dev server and test in browser**

```powershell
# Start dev server (or confirm it's running)
node server.js
```

Open `http://localhost:3000/admin-price-list-generator.html` (or whichever port the server uses).

Verify:
1. Brands load as checkboxes
2. Markup preview updates live (positive: `DPL ₹500 → Final ₹649`, negative -10%: `DPL ₹500 → Final ₹531`)
3. "Load Products →" button fetches items and shows accordion
4. Search box filters items live
5. Category [All] / [None] buttons work
6. Global [Select All] / [Clear All] work
7. Download PDF button enabled only when ≥1 item selected
8. WhatsApp button enabled only when ≥1 item + 10-digit number
9. PDF downloads successfully and opens without errors
10. ₹ symbol renders correctly in PDF (not as broken glyph)
11. Category column appears in PDF table
12. Negative markup in PDF shows correct discounted prices (e.g. -10% on ₹500 DPL → ₹531)

- [ ] **Step 4: Run all tests**

```bash
npx jest tests/unit/price-list-pdf-generator.test.js --no-coverage
```

Expected: 14 tests pass.

- [ ] **Step 5: Commit**

```bash
git add public/admin-price-list-generator.html
git commit -m "feat(price-list): 2-step UI with category accordion + search (v2)"
```
