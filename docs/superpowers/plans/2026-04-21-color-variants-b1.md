# Color Variants B1 (Web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add color/shade support to the product catalog so each (product + color + size) combo maps to one Zoho item, with colors auto-extracted from Zoho item names and editable in the product modal.

**Architecture:** Add nullable `color_name` / `color_code` columns to the existing `pack_sizes` table (backward compatible). A new `services/color-extractor.js` handles name→hex extraction. The backend `assign-zoho-item` endpoint and `PUT /api/products/:id` accept optional color fields. The admin modal and Zoho Import assign flow are updated to show/edit colors.

**Tech Stack:** Node.js/Express, MySQL2, Jest, vanilla JS, Tailwind CSS

---

## File Map

| File | What changes |
|---|---|
| `migrations/migrate-pack-sizes-color.js` | New — adds color_name, color_code columns to pack_sizes |
| `services/color-extractor.js` | New — extractColor(itemName) → {colorName, colorCode} or null |
| `tests/unit/color-extractor.test.js` | New — unit tests for color extractor |
| `server.js` (line ~2581) | Update assign-zoho-item INSERT to include color_name, color_code |
| `server.js` (line ~2951) | Update PUT /api/products/:id pack_sizes INSERT to include color_name, color_code |
| `public/admin-products.html` | Add color inputs to edit modal + color pre-fill in Zoho assign flow |

---

### Task 1: DB Migration — add color columns to pack_sizes

**Files:**
- Create: `migrations/migrate-pack-sizes-color.js`

- [ ] **Step 1: Write the migration**

```javascript
// migrations/migrate-pack-sizes-color.js
require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true
    });
    try {
        const [colorNameCol] = await pool.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pack_sizes' AND COLUMN_NAME = 'color_name'
        `);
        if (colorNameCol.length === 0) {
            await pool.query(`ALTER TABLE pack_sizes ADD COLUMN color_name VARCHAR(100) NULL`);
            console.log('✅ Added color_name to pack_sizes');
        } else {
            console.log('⏭️  color_name already exists');
        }

        const [colorCodeCol] = await pool.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pack_sizes' AND COLUMN_NAME = 'color_code'
        `);
        if (colorCodeCol.length === 0) {
            await pool.query(`ALTER TABLE pack_sizes ADD COLUMN color_code VARCHAR(20) NULL`);
            console.log('✅ Added color_code to pack_sizes');
        } else {
            console.log('⏭️  color_code already exists');
        }

        console.log('Migration complete.');
    } finally {
        await pool.end();
        process.exit(0);
    }
}

migrate();
```

- [ ] **Step 2: Run migration locally**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/act.qcpaintshop.com"
node migrations/migrate-pack-sizes-color.js
```
Expected output:
```
✅ Added color_name to pack_sizes
✅ Added color_code to pack_sizes
Migration complete.
```

- [ ] **Step 3: Verify idempotency — run again**

```bash
node migrations/migrate-pack-sizes-color.js
```
Expected output:
```
⏭️  color_name already exists
⏭️  color_code already exists
Migration complete.
```

- [ ] **Step 4: Commit**

```bash
git add migrations/migrate-pack-sizes-color.js
git commit -m "feat(colors): migration — add color_name, color_code to pack_sizes"
```

---

### Task 2: Color Extractor Service

**Files:**
- Create: `services/color-extractor.js`
- Create: `tests/unit/color-extractor.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/unit/color-extractor.test.js
const { extractColor } = require('../../services/color-extractor');

describe('color-extractor', () => {
    test('extracts White from item name', () => {
        expect(extractColor('Ace Exterior White 1L')).toEqual({ colorName: 'White', colorCode: '#FFFFFF' });
    });

    test('extracts Grey case-insensitively', () => {
        expect(extractColor('Bison Guard Grey 4Ltr')).toEqual({ colorName: 'Grey', colorCode: '#9CA3AF' });
    });

    test('returns null when no known color found', () => {
        expect(extractColor('Premium Emulsion 10L')).toBeNull();
    });

    test('matches multi-word color before single word — Off White not White', () => {
        expect(extractColor('Royale Off White 4L')).toEqual({ colorName: 'Off White', colorCode: '#FAF9F6' });
    });

    test('returns null for null input', () => {
        expect(extractColor(null)).toBeNull();
    });

    test('returns null for empty string', () => {
        expect(extractColor('')).toBeNull();
    });

    test('extracts color when SKU prefix present', () => {
        expect(extractColor('AP001 Ace Exterior Ivory 1L')).toEqual({ colorName: 'Ivory', colorCode: '#F5F0E8' });
    });

    test('extracts Sky Blue (multi-word)', () => {
        expect(extractColor('Tractor Emulsion Sky Blue 1L')).toEqual({ colorName: 'Sky Blue', colorCode: '#7DD3FC' });
    });

    test('extracts Terracotta', () => {
        expect(extractColor('Exterior Terracotta 4L')).toEqual({ colorName: 'Terracotta', colorCode: '#C1440E' });
    });

    test('gray is alias for grey same hex', () => {
        const result = extractColor('Waterbase Gray 2L');
        expect(result).not.toBeNull();
        expect(result.colorCode).toBe('#9CA3AF');
    });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/act.qcpaintshop.com"
npx jest tests/unit/color-extractor.test.js --no-coverage
```
Expected: `FAIL` — `Cannot find module '../../services/color-extractor'`

- [ ] **Step 3: Write the service**

```javascript
// services/color-extractor.js
'use strict';

const COLOR_MAP = {
    'off white':   '#FAF9F6',
    'sky blue':    '#7DD3FC',
    'brick red':   '#B22222',
    'off-white':   '#FAF9F6',
    white:         '#FFFFFF',
    ivory:         '#F5F0E8',
    cream:         '#FDE8CC',
    beige:         '#E8D5B0',
    wheat:         '#D4C5A9',
    sand:          '#C8B89A',
    yellow:        '#FCD34D',
    orange:        '#FB923C',
    red:           '#EF4444',
    maroon:        '#7F1D1D',
    pink:          '#F9A8D4',
    peach:         '#FBBF9A',
    brown:         '#92400E',
    chocolate:     '#78350F',
    green:         '#22C55E',
    sage:          '#C8D8C8',
    teal:          '#0D9488',
    blue:          '#3B82F6',
    navy:          '#1E3A5F',
    grey:          '#9CA3AF',
    gray:          '#9CA3AF',
    silver:        '#D1D5DB',
    black:         '#111827',
    lilac:         '#D0C0D8',
    lavender:      '#E0D7F0',
    terracotta:    '#C1440E',
    rust:          '#B7410E',
};

// Multi-word keys sorted before single-word to prevent partial matches
const SORTED_KEYS = Object.keys(COLOR_MAP).sort((a, b) => b.split(' ').length - a.split(' ').length);

function extractColor(itemName) {
    if (!itemName) return null;
    for (const key of SORTED_KEYS) {
        const pattern = new RegExp(`(?:^|\\s)${key.replace(/-/g, '[\\s-]')}(?:\\s|$)`, 'i');
        if (pattern.test(itemName)) {
            const displayName = key.split(/[\s-]+/).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
            return { colorName: displayName, colorCode: COLOR_MAP[key] };
        }
    }
    return null;
}

module.exports = { extractColor, COLOR_MAP };
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest tests/unit/color-extractor.test.js --no-coverage
```
Expected: `PASS` — 10 tests passing

- [ ] **Step 5: Commit**

```bash
git add services/color-extractor.js tests/unit/color-extractor.test.js
git commit -m "feat(colors): color extractor service with unit tests"
```

---

### Task 3: Backend — update assign-zoho-item to accept color

**Files:**
- Modify: `server.js` (~line 2581)

- [ ] **Step 1: Find the assign-zoho-item endpoint**

Open `server.js`. Find the line:
```javascript
app.post('/api/products/assign-zoho-item', requirePermission('products', 'edit'), async (req, res) => {
```
It's around line 2581.

- [ ] **Step 2: Update the destructuring and INSERT**

Find the destructuring line (currently ~line 2584):
```javascript
const { product_id, zoho_item_id, size, unit, price } = req.body;
```

Replace with:
```javascript
const { product_id, zoho_item_id, size, unit, price, color_name, color_code } = req.body;
const colorName = color_name ? String(color_name).trim().substring(0, 100) || null : null;
const colorCode = color_code && /^#[0-9A-Fa-f]{3,8}$/.test(String(color_code)) ? String(color_code) : null;
```

Find the INSERT statement (~line 2622):
```javascript
const [result] = await conn.query(
    'INSERT INTO pack_sizes (product_id, size, unit, base_price, zoho_item_id, is_active) VALUES (?, ?, ?, ?, ?, 1)',
    [product_id, parsedSize, normalizedUnit, parsedPrice, zoho_item_id]
);
```

Replace with:
```javascript
const [result] = await conn.query(
    'INSERT INTO pack_sizes (product_id, size, unit, base_price, zoho_item_id, color_name, color_code, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
    [product_id, parsedSize, normalizedUnit, parsedPrice, zoho_item_id, colorName, colorCode]
);
```

- [ ] **Step 3: Verify syntax**

```bash
node --check server.js && echo "SYNTAX OK"
```
Expected: `SYNTAX OK`

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(colors): assign-zoho-item accepts color_name, color_code"
```

---

### Task 4: Backend — update PUT /api/products/:id to save color

**Files:**
- Modify: `server.js` (~line 2951)

Note: `GET /api/products/:id` needs NO change — it uses `SELECT ps.*` which automatically includes the new columns.

- [ ] **Step 1: Find the PUT pack_sizes INSERT**

In `server.js`, find `app.put('/api/products/:id'`. Inside it, find the INSERT that inserts each pack size (~line 2951):
```javascript
await pool.query(
    'INSERT INTO pack_sizes (product_id, size, unit, base_price, zoho_item_id, is_active) VALUES (?, ?, ?, ?, ?, 1)',
    [req.params.id, pack.size, unit, pack.base_price || pack.price, pack.zoho_item_id || null]
);
```

- [ ] **Step 2: Update the INSERT**

Replace it with:
```javascript
await pool.query(
    'INSERT INTO pack_sizes (product_id, size, unit, base_price, zoho_item_id, color_name, color_code, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
    [req.params.id, pack.size, unit, pack.base_price || pack.price, pack.zoho_item_id || null,
     pack.color_name ? String(pack.color_name).trim().substring(0, 100) || null : null,
     pack.color_code && /^#[0-9A-Fa-f]{3,8}$/.test(String(pack.color_code)) ? String(pack.color_code) : null]
);
```

- [ ] **Step 3: Verify syntax**

```bash
node --check server.js && echo "SYNTAX OK"
```
Expected: `SYNTAX OK`

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(colors): product PUT/:id saves color_name, color_code per pack size"
```

---

### Task 5: Admin UI — color inputs in product edit modal

**Files:**
- Modify: `public/admin-products.html` — `renderPackSizes()` function and `addPackSize()` function

- [ ] **Step 1: Find renderPackSizes()**

Search for `function renderPackSizes()` in `admin-products.html` (around line 832). It maps `packSizes` array to HTML cards.

- [ ] **Step 2: Add color row to each pack size card**

Inside the `packSizes.map((ps, idx) => ...)` template, find the existing Zoho Item row:
```javascript
<div class="flex items-center gap-2">
    <label class="text-xs text-gray-500 whitespace-nowrap">Zoho Item:</label>
    ...
</div>
```

Add a new color row BEFORE the Zoho Item row:
```javascript
<div class="flex items-center gap-2">
    <label class="text-xs text-gray-500 whitespace-nowrap">Color:</label>
    <input type="text"
        value="${escH(ps.color_name || '')}"
        oninput="packSizes[${idx}].color_name = this.value.trim() || null; packSizes[${idx}].color_code = packSizes[${idx}].color_code || null;"
        placeholder="e.g. White (optional)"
        class="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs focus:border-purple-500 focus:outline-none">
    <input type="color"
        value="${ps.color_code || '#ffffff'}"
        oninput="packSizes[${idx}].color_code = this.value"
        style="width:26px;height:26px;padding:1px;border:1px solid #d1d5db;border-radius:50%;cursor:pointer;overflow:hidden;background:none;"
        title="Pick swatch colour">
    <div style="width:14px;height:14px;border-radius:50%;background:${ps.color_code ? escH(ps.color_code) : '#e5e7eb'};border:1px solid #e2e8f0;flex-shrink:0;" id="colorDot_${idx}"></div>
</div>
```

- [ ] **Step 3: Update size label to show color dot when color present**

In the same template, find the size label span:
```javascript
<span class="font-semibold text-gray-700">${ps.size} ${ps.unit || 'L'}</span>
```

Replace with:
```javascript
<span class="font-semibold text-gray-700" style="display:flex;align-items:center;gap:5px;">
    ${ps.color_code ? `<span style="width:12px;height:12px;border-radius:50%;background:${escH(ps.color_code)};border:1px solid #e2e8f0;flex-shrink:0;"></span>` : ''}
    ${ps.size} ${ps.unit || 'L'}${ps.color_name ? ' · ' + escH(ps.color_name) : ''}
</span>
```

- [ ] **Step 4: Update addPackSize() to initialize color fields**

Find `function addPackSize()` (around line 797). Find the `packSizes.push(...)` line. Add `color_name: null, color_code: null` to the pushed object:

Before:
```javascript
packSizes.push({ size: parseFloat(size), unit, price: parseFloat(price), base_price: parseFloat(price) });
```

After:
```javascript
packSizes.push({ size: parseFloat(size), unit, price: parseFloat(price), base_price: parseFloat(price), color_name: null, color_code: null });
```

- [ ] **Step 5: Verify in browser**

Open `http://localhost:3000/admin-products.html`, click Edit on any product.
Expected:
- Each pack size row shows a Color text input + color circle picker
- Entering a color name and picking a hex shows the dot
- Saving the product (clicking Save) submits without error

- [ ] **Step 6: Commit**

```bash
git add public/admin-products.html
git commit -m "feat(colors): color inputs in product edit modal pack sizes"
```

---

### Task 6: Admin UI — Zoho Import assign flow color pre-fill

**Files:**
- Modify: `public/admin-products.html` — JS section

- [ ] **Step 1: Add client-side COLOR_MAP constant**

Find the `// ── Assign-to-existing inline search` comment (around line 2500). Just BEFORE it, add:

```javascript
// ── Client-side color extraction (mirrors services/color-extractor.js) ─────
const CLIENT_COLOR_MAP = {
    'off white': '#FAF9F6', 'sky blue': '#7DD3FC', 'brick red': '#B22222',
    white: '#FFFFFF', ivory: '#F5F0E8', cream: '#FDE8CC', beige: '#E8D5B0',
    wheat: '#D4C5A9', sand: '#C8B89A', yellow: '#FCD34D', orange: '#FB923C',
    red: '#EF4444', maroon: '#7F1D1D', pink: '#F9A8D4', peach: '#FBBF9A',
    brown: '#92400E', chocolate: '#78350F', green: '#22C55E', sage: '#C8D8C8',
    teal: '#0D9488', blue: '#3B82F6', navy: '#1E3A5F', grey: '#9CA3AF',
    gray: '#9CA3AF', silver: '#D1D5DB', black: '#111827', lilac: '#D0C0D8',
    lavender: '#E0D7F0', terracotta: '#C1440E', rust: '#B7410E',
};
const CLIENT_COLOR_KEYS = Object.keys(CLIENT_COLOR_MAP).sort((a, b) => b.split(' ').length - a.split(' ').length);

function extractColorFromItemName(name) {
    if (!name) return null;
    for (const key of CLIENT_COLOR_KEYS) {
        const pattern = new RegExp(`(?:^|\\s)${key.replace(/-/g, '[\\s-]')}(?:\\s|$)`, 'i');
        if (pattern.test(name)) {
            const displayName = key.split(/[\s-]+/).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
            return { colorName: displayName, colorCode: CLIENT_COLOR_MAP[key] };
        }
    }
    return null;
}
```

- [ ] **Step 2: Update confirmAssignZohoItem signature to accept color**

Find `async function confirmAssignZohoItem(zohoItemId, productId, productName, size, unit, price)` (around line 2584).

Replace the entire function with:
```javascript
async function confirmAssignZohoItem(zohoItemId, productId, productName, size, unit, price, colorName, colorCode) {
    closeAssignDropdown();
    const colorLabel = colorName ? ` ${colorName}` : '';
    if (!confirm(`Add ${size}${unit}${colorLabel} @ ₹${price} to "${productName}"?`)) return;

    try {
        const body = { product_id: productId, zoho_item_id: zohoItemId, size, unit, price };
        if (colorName) { body.color_name = colorName; body.color_code = colorCode || null; }

        const res = await fetch('/api/products/assign-zoho-item', {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Failed');

        zohoMappedIds.add(zohoItemId);
        zohoMappedInfo[zohoItemId] = { product_id: productId, product_name: productName };

        await loadZohoItems();
        showToast(`✓ Assigned to "${productName}"`, 'success');
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
}
```

- [ ] **Step 3: Update doAssignSearch to pass color in result onclick**

Find `doAssignSearch` function (around line 2553). Find the results `items.map(p => ...)` block. Find the onclick attribute:
```javascript
onclick="confirmAssignZohoItem('${escH(zohoItemId)}', ${p.id}, '${escH(p.name)}', '${escH(size)}', '${escH(unit)}', ${price})"
```

The `doAssignSearch` function receives `zohoItemId` as a parameter. Update the function signature to also receive the item name for color extraction. Find `doAssignSearch`'s declaration:

```javascript
async function doAssignSearch(zohoItemId, size, unit, price, query) {
```

Replace with:
```javascript
async function doAssignSearch(zohoItemId, itemName, size, unit, price, query) {
    const extracted = extractColorFromItemName(itemName || '');
    const colorName = extracted ? extracted.colorName : null;
    const colorCode = extracted ? extracted.colorCode : null;
```

Then update the result onclick to pass color:
```javascript
onclick="confirmAssignZohoItem('${escH(zohoItemId)}', ${p.id}, '${escH(p.name)}', '${escH(size)}', '${escH(unit)}', ${price}, ${colorName ? `'${escH(colorName)}'` : 'null'}, ${colorCode ? `'${escH(colorCode)}'` : 'null'})"
```

- [ ] **Step 4: Update debounceAssignSearch to pass itemName**

Find `debounceAssignSearch` (around line 2548):
```javascript
function debounceAssignSearch(zohoItemId, size, unit, price, inputEl) {
    clearTimeout(assignSearchTimer);
    assignSearchTimer = setTimeout(() => doAssignSearch(zohoItemId, size, unit, price, inputEl.value.trim()), 280);
}
```

Replace with:
```javascript
function debounceAssignSearch(zohoItemId, itemName, size, unit, price, inputEl) {
    clearTimeout(assignSearchTimer);
    assignSearchTimer = setTimeout(() => doAssignSearch(zohoItemId, itemName, size, unit, price, inputEl.value.trim()), 280);
}
```

- [ ] **Step 5: Update openAssignDropdown to pass itemName**

Find `openAssignDropdown(zohoItemId, size, unit, price, anchorEl)` (around line 2508). 

Update the signature:
```javascript
function openAssignDropdown(zohoItemId, itemName, size, unit, price, anchorEl) {
```

Update the `oninput` attribute inside the dropdown HTML (inside the function):
```javascript
oninput="debounceAssignSearch('${escH(zohoItemId)}', '${escH(itemName||'')}', '${escH(size)}', '${escH(unit)}', ${price}, this)"
```

- [ ] **Step 6: Update all callers of openAssignDropdown**

There are several call sites. Find each `openAssignDropdown(` call and add `itemName` as the second argument (the item's display name).

**Flat view desktop (around line 1348):**
```javascript
openAssignDropdown('${escH(itemId)}','${escH(item.name||item.item_name||'')}','${escH(extractSizeFromName(item.name||item.item_name||''))}','${escH(extractUnitFromName(item.name||item.item_name||''))}',${parseFloat(item.rate)||0},this)
```

**Mobile flat view (around line 1501):**
```javascript
openAssignDropdown('${escH(itemId)}','${escH(item.name||item.item_name||'')}','${escH(extractSizeFromName(item.name||item.item_name||''))}','${escH(extractUnitFromName(item.name||item.item_name||''))}',${parseFloat(item.rate)||0},this)
```

**openGroupAssignDropdown (around line 2637):**
Find the `openAssignDropdown(groupKey, size, unit, price, anchorEl)` call inside `openGroupAssignDropdown`. Update to:
```javascript
openAssignDropdown(groupKey, first.name || first.item_name || '', size, unit, price, anchorEl);
```

- [ ] **Step 7: Smoke test**

Open `http://localhost:3000/admin-products.html?tab=zoho-import`.
Find an unmapped item like "Bison Enamel White 1L". Click "Assign ▾".
Search for a product. Click a result.
Expected confirm dialog: `"Add 1L White @ ₹280 to 'Berger Bison Enamel'?"`

For an item with no color ("Premium Emulsion 10L"):
Expected confirm dialog: `"Add 10L @ ₹850 to 'Product Name'?"` (no color label)

- [ ] **Step 8: Commit**

```bash
git add public/admin-products.html
git commit -m "feat(colors): zoho import assign flow pre-fills color from item name"
```

---

### Task 7: Deploy and verify

- [ ] **Step 1: Push to remote**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/act.qcpaintshop.com"
git push origin master
```

- [ ] **Step 2: Deploy to production**

```bash
ssh hetzner "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && node migrations/migrate-pack-sizes-color.js && pm2 restart business-manager && echo 'DEPLOY OK'"
```
Expected: migration output + `DEPLOY OK`

- [ ] **Step 3: Verify on production**

Open `https://act.qcpaintshop.com/admin-products.html`:
- Edit any product → pack size rows show Color input + swatch picker
- Zoho Import tab → assign an item with a color word in the name → confirm dialog shows the color
- Assign an item without a color → confirm dialog has no color label
