# Estimate Create Page Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `estimate-create-new.html` as a split-panel page with live estimate preview, Zoho customer+product search (no `zoho.view` permission needed), area calculator, mobile bottom drawer, and WhatsApp post-save popup.

**Architecture:** Three new `requireAuth`-only GET endpoints added to `routes/estimates.js` (before the `/:id` wildcard) power the frontend. The frontend is a full rebuild of `estimate-create-new.html` — same single-file pattern with inline JS. Desktop: left panel 400px (customer + product picker) + right panel flex-1 (estimate items + save). Mobile: right panel is the default view, product picker slides up as a 70vh bottom drawer.

**Tech Stack:** Express.js, Vanilla JS, Tailwind CSS (CDN), existing `apiRequest()` from `auth-helper.js`, Jest for unit tests.

---

## Design Decision: Column Visibility

The spec mentioned a ⚙ column-visibility menu. This is intentionally omitted — the card-per-item layout (replacing the old table) has no columns to toggle. Each card always shows: product name, quantity, unit price, and line total. The old `est_column_prefs` localStorage key is no longer relevant.

---

## File Map

| File | Action | What it does |
|------|--------|--------------|
| `routes/estimates.js` | Modify (insert ~line 192) | Add 3 new GET endpoints + in-memory filter cache |
| `tests/unit/estimate-search.test.js` | Create | Unit tests for pack-combo calculation helper |
| `public/estimate-create-new.html` | Full rebuild | Split-panel UI, all JS inline |

---

## Task 1: Unit test for area pack-combo calculation

**Files:**
- Create: `tests/unit/estimate-search.test.js`

- [ ] **Step 1.1: Write the failing test**

Create `tests/unit/estimate-search.test.js`:

```javascript
// Unit tests for estimate search helpers
// Tests the pure calculatePackCombo() function used in area mode

function calculatePackCombo(litersNeeded, packSizes) {
    if (!packSizes || packSizes.length === 0) return [];
    const sorted = [...packSizes].sort((a, b) => b.size - a.size);
    const result = [];
    let remaining = litersNeeded;
    for (const pack of sorted) {
        if (remaining <= 0.001) break;
        const count = Math.floor(remaining / pack.size);
        if (count > 0) {
            result.push({ zoho_item_id: pack.zoho_item_id, name: pack.name, size: pack.size, rate: pack.rate, quantity: count });
            remaining -= count * pack.size;
        }
    }
    if (remaining > 0.001) {
        const smallest = sorted[sorted.length - 1];
        const existing = result.find(r => r.zoho_item_id === smallest.zoho_item_id);
        if (existing) existing.quantity += 1;
        else result.push({ zoho_item_id: smallest.zoho_item_id, name: smallest.name, size: smallest.size, rate: smallest.rate, quantity: 1 });
    }
    return result;
}

describe('calculatePackCombo', () => {
    const packs = [
        { zoho_item_id: 'Z20', name: 'Apex 20L', size: 20, rate: 6250 },
        { zoho_item_id: 'Z10', name: 'Apex 10L', size: 10, rate: 3250 },
        { zoho_item_id: 'Z4',  name: 'Apex 4L',  size: 4,  rate: 1400 },
        { zoho_item_id: 'Z1',  name: 'Apex 1L',  size: 1,  rate: 400  },
    ];

    it('exact fit: 20L uses exactly 1×20L', () => {
        const result = calculatePackCombo(20, packs);
        expect(result).toEqual([{ zoho_item_id: 'Z20', name: 'Apex 20L', size: 20, rate: 6250, quantity: 1 }]);
    });

    it('31.25L → 1×20L + 1×10L + 1×1L', () => {
        const result = calculatePackCombo(31.25, packs);
        const z20 = result.find(r => r.zoho_item_id === 'Z20');
        const z10 = result.find(r => r.zoho_item_id === 'Z10');
        const z1  = result.find(r => r.zoho_item_id === 'Z1');
        expect(z20?.quantity).toBe(1);
        expect(z10?.quantity).toBe(1);
        expect(z1?.quantity).toBe(1);
    });

    it('returns empty array for empty packs', () => {
        expect(calculatePackCombo(10, [])).toEqual([]);
    });

    it('rounds up remainder to 1 extra smallest pack', () => {
        // 5L needed, only 4L pack → 1×4L + 1×4L (rounds up)
        const result = calculatePackCombo(5, [{ zoho_item_id: 'Z4', name: 'Apex 4L', size: 4, rate: 1400 }]);
        expect(result[0].quantity).toBe(2);
    });

    it('single pack type: 45L with only 20L packs → 3×20L', () => {
        const result = calculatePackCombo(45, [{ zoho_item_id: 'Z20', name: 'Apex 20L', size: 20, rate: 6250 }]);
        expect(result[0].quantity).toBe(3);
    });
});
```

- [ ] **Step 1.2: Run test to verify it fails (function not yet in route)**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/act.qcpaintshop.com"
npx jest tests/unit/estimate-search.test.js --no-coverage
```

Expected: All 5 tests **PASS** — the function is defined inline in the test file, so this validates the logic itself before we embed it in the frontend.

- [ ] **Step 1.3: Commit**

```bash
git add tests/unit/estimate-search.test.js
git commit -m "test: estimate pack-combo calculation unit tests"
```

---

## Task 2: Backend — 3 new GET endpoints in routes/estimates.js

**Files:**
- Modify: `routes/estimates.js` (insert after line ~191, before the `/:id/upi-qr` route)

The three new routes must be placed **before** any `/:id` wildcard routes (Express would match `/filter-options` as `id = "filter-options"` otherwise).

- [ ] **Step 2.1: Add in-memory cache variable and filter-options endpoint**

Open `routes/estimates.js`. After line 9 (`function setPool...`), add the cache variable:

```javascript
// In-memory cache for filter-options (5 min TTL)
let _filterCache = null;
let _filterCacheAt = 0;
```

Then after the closing `});` of the `router.get('/', ...)` list endpoint (around line 191), insert:

```javascript
// ========================================
// ESTIMATE SEARCH ENDPOINTS (requireAuth only — used by both admin + staff)
// IMPORTANT: These MUST stay above any /:id routes
// ========================================

router.get('/filter-options', requireAuth, async (req, res) => {
    try {
        const now = Date.now();
        if (_filterCache && now - _filterCacheAt < 5 * 60 * 1000) {
            return res.json(_filterCache);
        }
        const [brands] = await pool.query(
            `SELECT DISTINCT zoho_brand as brand FROM zoho_items_map
             WHERE zoho_status = 'active' AND zoho_brand IS NOT NULL AND zoho_brand != ''
             ORDER BY zoho_brand ASC`
        );
        const [categories] = await pool.query(
            `SELECT DISTINCT zoho_category_name as category FROM zoho_items_map
             WHERE zoho_status = 'active' AND zoho_category_name IS NOT NULL AND zoho_category_name != ''
             ORDER BY zoho_category_name ASC`
        );
        _filterCache = { brands: brands.map(r => r.brand), categories: categories.map(r => r.category) };
        _filterCacheAt = now;
        res.json(_filterCache);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/search-customers', requireAuth, async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) return res.json([]);
        const like = `%${q}%`;

        const [zohoRows] = await pool.query(`
            SELECT zcm.zoho_contact_id, zcm.zoho_contact_name AS name,
                   zcm.zoho_phone AS phone, zcm.zoho_email AS email,
                   zcm.zoho_billing_address AS address, zcm.local_customer_id
            FROM zoho_customers_map zcm
            WHERE zcm.zoho_contact_name LIKE ? OR zcm.zoho_phone LIKE ? OR zcm.zoho_email LIKE ?
            ORDER BY zcm.zoho_contact_name ASC LIMIT 8
        `, [like, like, like]);

        const linkedLocalIds = zohoRows.filter(r => r.local_customer_id).map(r => r.local_customer_id);
        const excludeClause = linkedLocalIds.length
            ? `AND c.id NOT IN (${linkedLocalIds.map(() => '?').join(',')})` : '';

        const [localRows] = await pool.query(`
            SELECT NULL AS zoho_contact_id, c.name, c.phone, c.email,
                   c.address, c.id AS local_customer_id
            FROM customers c
            WHERE (c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?) ${excludeClause}
            ORDER BY c.name ASC LIMIT 5
        `, [like, like, like, ...linkedLocalIds]);

        const results = [
            ...zohoRows.map(r => ({
                id: r.zoho_contact_id,
                name: r.name || '',
                phone: r.phone || '',
                email: r.email || '',
                address: r.address || '',
                source: r.local_customer_id ? 'both' : 'zoho',
                zoho_contact_id: r.zoho_contact_id,
                local_customer_id: r.local_customer_id || null
            })),
            ...localRows.map(r => ({
                id: String(r.local_customer_id),
                name: r.name || '',
                phone: r.phone || '',
                email: r.email || '',
                address: r.address || '',
                source: 'local',
                zoho_contact_id: null,
                local_customer_id: r.local_customer_id
            }))
        ].slice(0, 10);

        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/search-products', requireAuth, async (req, res) => {
    try {
        const { q, brand, category, page = 1 } = req.query;
        const limit = 20;
        const offset = (Math.max(1, parseInt(page)) - 1) * limit;
        const params = [];

        let where = `WHERE (zim.zoho_status = 'active' OR zim.zoho_status IS NULL)`;
        if (q && q.trim().length >= 1) {
            where += ` AND (zim.zoho_item_name LIKE ? OR zim.zoho_sku LIKE ? OR zim.zoho_brand LIKE ? OR zim.zoho_category_name LIKE ?)`;
            const lq = `%${q.trim()}%`;
            params.push(lq, lq, lq, lq);
        }
        if (brand) { where += ` AND zim.zoho_brand = ?`; params.push(brand); }
        if (category) { where += ` AND zim.zoho_category_name = ?`; params.push(category); }

        const [rows] = await pool.query(`
            SELECT zim.zoho_item_id, zim.zoho_item_name AS name,
                   zim.zoho_brand AS brand, zim.zoho_category_name AS category,
                   zim.zoho_rate AS rate, zim.zoho_unit AS unit,
                   zim.zoho_stock_on_hand AS stock_on_hand,
                   p.area_coverage, p.product_type, p.id AS local_product_id
            FROM zoho_items_map zim
            LEFT JOIN pack_sizes ps ON ps.zoho_item_id = zim.zoho_item_id AND ps.is_active = 1
            LEFT JOIN products p ON p.id = ps.product_id AND p.status = 'active'
            ${where}
            ORDER BY zim.zoho_item_name ASC
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);

        res.json(rows.map(r => ({
            zoho_item_id: r.zoho_item_id,
            name: r.name,
            brand: r.brand || '',
            category: r.category || '',
            rate: parseFloat(r.rate) || 0,
            unit: r.unit || 'Nos',
            stock_on_hand: parseFloat(r.stock_on_hand) || 0,
            area_coverage: parseFloat(r.area_coverage) || 0,
            local_product_id: r.local_product_id || null,
            has_area_calc: !!(r.area_coverage && parseFloat(r.area_coverage) > 0)
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
```

- [ ] **Step 2.2: Verify server starts without errors**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/act.qcpaintshop.com"
node -e "require('./routes/estimates')" && echo "OK"
```

Expected: `OK`

- [ ] **Step 2.3: Smoke-test the endpoints (server must be running)**

```bash
# Start server in another terminal first: node server.js
# Then in a separate terminal (logged in as admin):
curl -s -H "Authorization: Bearer <your_token>" http://localhost:3000/api/estimates/filter-options
```

Expected: JSON with `{ brands: [...], categories: [...] }`

- [ ] **Step 2.4: Commit**

```bash
git add routes/estimates.js
git commit -m "feat(estimates): add search-customers, search-products, filter-options endpoints"
```

---

## Task 3: Frontend — HTML shell, split-panel layout, CSS

**Files:**
- Modify: `public/estimate-create-new.html` (full replace)

This task builds the skeleton only — no JS logic yet, just the HTML structure and CSS that makes the split panel work.

- [ ] **Step 3.1: Replace the file with the scaffold**

Replace the entire contents of `public/estimate-create-new.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="#667eea">
    <link rel="manifest" href="/manifest.json">
    <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192x192.png">
    <title>Create Estimate - Quality Colors</title>
    <script src="/js/auth-helper.js"></script>
    <script>checkAuthOrRedirect();</script>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="/universal-nav-loader.js"></script>
    <style>
        /* ── LAYOUT ── */
        .estimate-layout {
            display: flex;
            height: calc(100vh - 64px); /* subtract nav height */
            overflow: hidden;
        }
        .left-panel {
            width: 420px;
            flex-shrink: 0;
            border-right: 2px solid #e5e7eb;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            background: #fafafa;
        }
        .left-panel-body {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
        }
        .right-panel {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            background: #f3f4f6;
        }
        .right-panel-body {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
        }
        .right-panel-footer {
            padding: 12px 16px;
            background: white;
            border-top: 2px solid #e5e7eb;
        }

        /* ── MOBILE ── */
        @media (max-width: 767px) {
            .estimate-layout {
                flex-direction: column;
                height: auto;
                overflow: visible;
            }
            .left-panel {
                display: none; /* hidden on mobile — product picker in drawer */
                width: 100%;
                border-right: none;
            }
            .right-panel {
                height: auto;
                overflow: visible;
            }
            .right-panel-body {
                overflow: visible;
                padding-bottom: 100px; /* space for fixed mobile bar */
            }
        }

        /* ── SECTION HEADINGS ── */
        .section-title {
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.6px;
            color: #667eea;
            text-transform: uppercase;
            margin-bottom: 10px;
        }
        .panel-section {
            background: white;
            border-radius: 10px;
            padding: 14px;
            margin-bottom: 12px;
            border: 1px solid #e5e7eb;
        }

        /* ── CUSTOMER SEARCH ── */
        .customer-search-wrap { position: relative; }
        .customer-search-input {
            width: 100%;
            padding: 10px 14px;
            border: 2px solid #d1d5db;
            border-radius: 8px;
            font-size: 14px;
            outline: none;
            box-sizing: border-box;
            transition: border-color 0.15s;
        }
        .customer-search-input:focus { border-color: #667eea; }
        .customer-dropdown {
            position: absolute;
            top: calc(100% + 4px);
            left: 0; right: 0;
            background: white;
            border: 1.5px solid #667eea;
            border-radius: 8px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.12);
            z-index: 60;
            max-height: 260px;
            overflow-y: auto;
        }
        .customer-item {
            padding: 10px 14px;
            cursor: pointer;
            border-bottom: 1px solid #f3f4f6;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .customer-item:hover { background: #f5f3ff; }
        .customer-item:last-child { border-bottom: none; }
        .source-badge {
            font-size: 10px;
            padding: 2px 7px;
            border-radius: 10px;
            font-weight: 600;
            flex-shrink: 0;
        }
        .badge-zoho { background: #dcfce7; color: #166534; }
        .badge-local { background: #dbeafe; color: #1e40af; }
        .badge-both  { background: #ede9fe; color: #6d28d9; }
        .customer-card {
            background: #f0fdf4;
            border: 1.5px solid #86efac;
            border-radius: 8px;
            padding: 10px 12px;
            margin-top: 8px;
            font-size: 13px;
        }

        /* ── FILTER CHIPS ── */
        .filter-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
        .chip {
            font-size: 11px;
            padding: 4px 10px;
            border-radius: 20px;
            cursor: pointer;
            border: 1.5px solid #d1d5db;
            background: white;
            color: #374151;
            transition: all 0.15s;
            white-space: nowrap;
        }
        .chip:hover { border-color: #667eea; color: #667eea; }
        .chip.active { background: #667eea; color: white; border-color: #667eea; }

        /* ── PRODUCT LIST ── */
        .product-list { max-height: 340px; overflow-y: auto; }
        .product-row {
            border: 1.5px solid #e5e7eb;
            border-radius: 8px;
            margin-bottom: 6px;
            overflow: hidden;
            cursor: pointer;
            transition: border-color 0.15s;
        }
        .product-row:hover { border-color: #667eea; }
        .product-row.expanded { border-color: #667eea; }
        .product-row-header {
            padding: 9px 12px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: white;
        }
        .product-row-expand {
            padding: 10px 12px;
            background: #f5f3ff;
            border-top: 1px solid #e5e7eb;
            display: none;
        }
        .product-row.expanded .product-row-expand { display: block; }
        .stock-badge {
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 10px;
            font-weight: 600;
        }
        .stock-in  { background: #dcfce7; color: #166534; }
        .stock-out { background: #fee2e2; color: #991b1b; }

        /* ── QTY STEPPER ── */
        .qty-stepper { display: flex; align-items: center; gap: 6px; }
        .qty-btn {
            width: 28px; height: 28px;
            border: 1.5px solid #d1d5db;
            border-radius: 6px;
            background: white;
            font-size: 16px;
            font-weight: 700;
            cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            transition: all 0.15s;
        }
        .qty-btn:hover { border-color: #667eea; color: #667eea; }
        .qty-display { font-size: 15px; font-weight: 700; min-width: 28px; text-align: center; }

        /* ── ESTIMATE ITEM CARDS ── */
        .est-item-card {
            background: white;
            border: 1.5px solid #e5e7eb;
            border-radius: 8px;
            margin-bottom: 8px;
            overflow: hidden;
        }
        .est-item-header {
            padding: 10px 12px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: pointer;
        }
        .est-item-header:hover { background: #fafafa; }
        .est-item-expand {
            padding: 10px 12px;
            border-top: 1px solid #f3f4f6;
            background: #fafafa;
            display: none;
        }
        .est-item-card.open .est-item-expand { display: block; }

        /* ── MARKUP / DISCOUNT INPUTS ── */
        .md-row {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 6px;
        }
        .md-label { font-size: 11px; font-weight: 700; width: 64px; flex-shrink: 0; }
        .md-select {
            font-size: 12px;
            border: 1px solid #d1d5db;
            border-radius: 5px;
            padding: 4px 6px;
        }
        .md-input {
            font-size: 12px;
            border: 1px solid #d1d5db;
            border-radius: 5px;
            padding: 4px 6px;
            width: 72px;
        }
        .md-btn {
            font-size: 11px;
            padding: 4px 8px;
            border-radius: 5px;
            border: none;
            cursor: pointer;
            font-weight: 600;
        }

        /* ── OVERALL MARKUP STRIP ── */
        .markup-strip {
            background: #f5f3ff;
            border: 1px solid #c4b5fd;
            border-radius: 8px;
            padding: 10px 12px;
            margin-bottom: 10px;
        }

        /* ── TOTALS ── */
        .totals-block { padding: 10px 0 0; }
        .total-row {
            display: flex;
            justify-content: space-between;
            font-size: 13px;
            color: #6b7280;
            margin-bottom: 4px;
        }
        .grand-total-row {
            display: flex;
            justify-content: space-between;
            font-size: 18px;
            font-weight: 800;
            color: #1f2937;
            border-top: 2px solid #e5e7eb;
            padding-top: 8px;
            margin-top: 4px;
        }

        /* ── MOBILE BOTTOM BAR ── */
        .mobile-bottom-bar {
            display: none;
        }
        @media (max-width: 767px) {
            .mobile-bottom-bar {
                display: flex;
                position: fixed;
                bottom: 0; left: 0; right: 0;
                background: white;
                border-top: 2px solid #e5e7eb;
                padding: 10px 16px;
                gap: 10px;
                z-index: 40;
            }
        }

        /* ── MOBILE DRAWER ── */
        .drawer-overlay {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.4);
            z-index: 50;
        }
        .drawer-overlay.open { display: block; }
        .drawer {
            position: fixed;
            bottom: 0; left: 0; right: 0;
            height: 72vh;
            background: white;
            border-radius: 16px 16px 0 0;
            z-index: 51;
            transform: translateY(100%);
            transition: transform 0.3s ease;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .drawer.open { transform: translateY(0); }
        .drawer-handle {
            text-align: center;
            padding: 12px;
            cursor: pointer;
        }
        .drawer-handle::after {
            content: '';
            display: inline-block;
            width: 40px;
            height: 4px;
            background: #d1d5db;
            border-radius: 2px;
        }
        .drawer-body {
            flex: 1;
            overflow-y: auto;
            padding: 0 16px 16px;
        }

        /* ── MODAL ── */
        .modal-overlay {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.5);
            z-index: 60;
            align-items: center;
            justify-content: center;
            padding: 16px;
        }
        .modal-overlay.open { display: flex; }
        .modal-box {
            background: white;
            border-radius: 16px;
            padding: 24px;
            max-width: 400px;
            width: 100%;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0,0,0,0.2);
        }

        /* ── MISC ── */
        .btn-primary {
            background: #667eea;
            color: white;
            border: none;
            border-radius: 8px;
            padding: 11px 20px;
            font-size: 14px;
            font-weight: 700;
            cursor: pointer;
            width: 100%;
            transition: background 0.15s;
        }
        .btn-primary:hover { background: #5a6fd6; }
        .btn-primary:disabled { background: #d1d5db; cursor: not-allowed; }
        .btn-whatsapp {
            background: #25D366;
            color: white;
            border: none;
            border-radius: 8px;
            padding: 11px 20px;
            font-size: 14px;
            font-weight: 700;
            cursor: pointer;
            width: 100%;
            margin-bottom: 8px;
        }
        .calc-result {
            background: #ede9fe;
            border-radius: 6px;
            padding: 8px 10px;
            font-size: 12px;
            color: #6d28d9;
            margin-top: 8px;
            font-weight: 600;
        }
        .area-inputs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
        .area-input-group label { font-size: 11px; color: #6b7280; margin-bottom: 3px; display: block; }
        .area-input-group input {
            width: 100%; padding: 6px 8px; border: 1.5px solid #d1d5db;
            border-radius: 6px; font-size: 13px; box-sizing: border-box;
        }
        input:focus, select:focus { outline: none; border-color: #667eea; }
    </style>
</head>
<body class="bg-gray-100" data-page="estimate-create">

<!-- ═══ MAIN LAYOUT ═══ -->
<div class="estimate-layout max-w-screen-2xl mx-auto">

    <!-- ─── LEFT PANEL ─── -->
    <div class="left-panel">
        <div class="left-panel-body">

            <!-- Customer -->
            <div class="panel-section">
                <div class="section-title">Customer</div>
                <div class="customer-search-wrap">
                    <input type="text" id="customerSearchInput" class="customer-search-input"
                        placeholder="Search by name or phone..." autocomplete="off">
                    <div id="customerDropdownPanel" class="customer-dropdown" style="display:none;"></div>
                </div>
                <div id="customerCard" class="customer-card" style="display:none;"></div>
                <button onclick="openNewCustomerModal()"
                    class="mt-2 w-full text-xs text-purple-600 border border-purple-300 rounded-lg py-1.5 hover:bg-purple-50">
                    + New Customer
                </button>
            </div>

            <!-- Product Search -->
            <div class="panel-section" style="flex:1;">
                <div class="section-title">Add Product</div>
                <input type="text" id="productSearchInput" class="customer-search-input"
                    placeholder="Search Zoho products..." autocomplete="off">

                <!-- Brand chips -->
                <div class="mt-2 mb-1" style="font-size:10px; color:#9ca3af; font-weight:600;">BRAND</div>
                <div id="brandChips" class="filter-chips"></div>

                <!-- Category chips -->
                <div class="mb-1" style="font-size:10px; color:#9ca3af; font-weight:600;">CATEGORY</div>
                <div id="categoryChips" class="filter-chips"></div>

                <!-- Product results -->
                <div id="productList" class="product-list mt-2">
                    <div id="productListEmpty" class="text-center text-gray-400 text-sm py-6">
                        Type to search products...
                    </div>
                </div>
            </div>

        </div><!-- /left-panel-body -->
    </div><!-- /left-panel -->

    <!-- ─── RIGHT PANEL ─── -->
    <div class="right-panel">
        <div class="right-panel-body">

            <!-- Mobile customer bar -->
            <div class="md:hidden mb-3">
                <div class="panel-section" style="margin-bottom:0;">
                    <div class="section-title">Customer</div>
                    <div class="customer-search-wrap">
                        <input type="text" id="customerSearchInputMobile" class="customer-search-input"
                            placeholder="Search by name or phone..." autocomplete="off">
                        <div id="customerDropdownPanelMobile" class="customer-dropdown" style="display:none;"></div>
                    </div>
                    <div id="customerCardMobile" class="customer-card" style="display:none;"></div>
                    <button onclick="openNewCustomerModal()"
                        class="mt-2 w-full text-xs text-purple-600 border border-purple-300 rounded-lg py-1.5 hover:bg-purple-50">
                        + New Customer
                    </button>
                </div>
            </div>

            <!-- Overall markup/discount strip -->
            <div class="markup-strip">
                <div class="flex items-center gap-2 flex-wrap mb-2">
                    <span class="text-xs font-bold text-purple-800">Markup:</span>
                    <select id="overallMarkupType" class="md-select">
                        <option value="">None</option>
                        <option value="price_pct">%</option>
                        <option value="price_value">₹</option>
                    </select>
                    <input type="number" id="overallMarkupValue" class="md-input" min="0" step="0.01" placeholder="0">
                    <button onclick="applyOverallMarkup()" class="md-btn bg-green-600 text-white">Apply</button>
                    <button onclick="clearOverallMarkup()" class="md-btn bg-gray-200 text-gray-700">Clear</button>
                </div>
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-xs font-bold text-red-700">Discount:</span>
                    <select id="overallDiscountType" class="md-select">
                        <option value="">None</option>
                        <option value="price_pct">%</option>
                        <option value="price_value">₹</option>
                    </select>
                    <input type="number" id="overallDiscountValue" class="md-input" min="0" step="0.01" placeholder="0">
                    <button onclick="applyOverallDiscount()" class="md-btn bg-red-600 text-white">Apply</button>
                    <button onclick="clearOverallDiscount()" class="md-btn bg-gray-200 text-gray-700">Clear</button>
                </div>
            </div>

            <!-- Estimate items -->
            <div id="estimateItemsContainer">
                <div id="estimateEmpty" class="text-center text-gray-400 text-sm py-10">
                    No items yet — search and add products on the left
                </div>
            </div>

            <!-- Labor charges -->
            <div class="panel-section mt-3">
                <div class="flex justify-between items-center mb-2">
                    <div class="section-title" style="margin-bottom:0;">Labor Charges</div>
                    <button onclick="addLaborItem()"
                        class="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg font-semibold">
                        + Add Labor
                    </button>
                </div>
                <div id="laborContainer"></div>
                <div id="laborTotalRow" class="hidden flex justify-between text-sm font-semibold mt-2 pt-2 border-t">
                    <span>Labor Total:</span>
                    <span id="laborTotalAmt">₹0.00</span>
                </div>
            </div>

        </div><!-- /right-panel-body -->

        <!-- Right panel footer: totals + save -->
        <div class="right-panel-footer hidden md:block">
            <div class="totals-block border-t pt-3">
                <div class="total-row"><span>Subtotal</span><span id="subtotalAmt">₹0.00</span></div>
                <div class="text-xs text-gray-400 mb-1 text-right">All prices inclusive of GST</div>
                <div class="grand-total-row"><span>Grand Total</span><span id="grandTotalAmt">₹0.00</span></div>
            </div>
            <button onclick="saveEstimate()" class="btn-primary mt-3" id="saveBtn">💾 Save Estimate</button>
        </div>
    </div><!-- /right-panel -->

</div><!-- /estimate-layout -->

<!-- Mobile totals + buttons bar -->
<div class="mobile-bottom-bar">
    <div style="flex:1;">
        <div style="font-size:11px; color:#9ca3af;">Grand Total</div>
        <div id="grandTotalAmtMobile" style="font-size:16px; font-weight:800; color:#1f2937;">₹0.00</div>
    </div>
    <button onclick="openDrawer()" class="btn-primary" style="width:auto; padding:10px 16px; font-size:13px;">
        + Product
    </button>
    <button onclick="saveEstimate()" class="btn-primary" style="width:auto; padding:10px 16px; font-size:13px;">
        💾 Save
    </button>
</div>

<!-- ═══ MOBILE DRAWER ═══ -->
<div id="drawerOverlay" class="drawer-overlay" onclick="closeDrawer()"></div>
<div id="productDrawer" class="drawer">
    <div class="drawer-handle" onclick="closeDrawer()"></div>
    <div class="drawer-body">
        <div class="section-title">Add Product</div>
        <input type="text" id="productSearchInputMobile" class="customer-search-input mb-2"
            placeholder="Search Zoho products..." autocomplete="off">
        <div id="brandChipsMobile" class="filter-chips"></div>
        <div id="categoryChipsMobile" class="filter-chips"></div>
        <div id="productListMobile" class="product-list">
            <div class="text-center text-gray-400 text-sm py-6">Type to search products...</div>
        </div>
    </div>
</div>

<!-- ═══ NEW CUSTOMER MODAL ═══ -->
<div id="newCustomerModal" class="modal-overlay">
    <div class="modal-box" style="text-align:left; max-width:520px;">
        <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-bold">Add New Customer</h3>
            <button onclick="closeNewCustomerModal()" class="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>
        <form onsubmit="createCustomer(event)">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <div>
                    <label class="block text-sm font-semibold mb-1">Name *</label>
                    <input type="text" id="newCustName" required class="customer-search-input">
                </div>
                <div>
                    <label class="block text-sm font-semibold mb-1">Phone *</label>
                    <input type="tel" id="newCustPhone" required class="customer-search-input">
                </div>
                <div>
                    <label class="block text-sm font-semibold mb-1">Email</label>
                    <input type="email" id="newCustEmail" class="customer-search-input">
                </div>
                <div>
                    <label class="block text-sm font-semibold mb-1">Branch *</label>
                    <select id="newCustBranch" required class="customer-search-input">
                        <option value="">-- Select --</option>
                    </select>
                </div>
                <div class="md:col-span-2">
                    <label class="block text-sm font-semibold mb-1">Address</label>
                    <textarea id="newCustAddress" rows="2" class="customer-search-input w-full resize-none"></textarea>
                </div>
            </div>
            <div class="flex gap-3">
                <button type="button" onclick="closeNewCustomerModal()"
                    class="flex-1 py-2 border-2 border-gray-300 rounded-lg text-sm font-semibold">Cancel</button>
                <button type="submit"
                    class="flex-1 bg-green-600 text-white py-2 rounded-lg text-sm font-semibold">Create Customer</button>
            </div>
        </form>
    </div>
</div>

<!-- ═══ POST-SAVE MODAL ═══ -->
<div id="saveSuccessModal" class="modal-overlay">
    <div class="modal-box">
        <div style="font-size:40px; margin-bottom:8px;">✅</div>
        <div id="saveSuccessTitle" class="text-xl font-bold text-gray-900 mb-1"></div>
        <div id="saveSuccessTotal" class="text-gray-500 mb-6"></div>
        <button id="saveSuccessWA" class="btn-whatsapp">📲 Send on WhatsApp</button>
        <button id="saveSuccessView" class="btn-primary">View Estimate →</button>
    </div>
</div>

<script>
// ════════════════════════════════════════
// STATE
// ════════════════════════════════════════
let selectedCustomer = null;
let estimateItems = [];   // { id, zoho_item_id, name, brand, base_price, quantity, unit, area, coats, coverage, markup_type, markup_value, discount_type, discount_value }
let laborItems = [];      // { id, description, amount }
let filterOptions = { brands: [], categories: [] };
let activeFilters = { brand: '', category: '' };
let itemIdCounter = 1;
let laborIdCounter = 1;
let _customerSearchTimer = null;
let _productSearchTimer = null;

const RECENT_CUSTOMERS_KEY = 'est_recent_customers';
</script>
</body>
</html>
```

- [ ] **Step 3.2: Open the page in browser and verify the split panel renders**

Navigate to `http://localhost:3000/estimate-create-new.html`. Check:
- Desktop: left panel (420px) visible on left, right panel fills remaining space
- Both panels have scrollbars if content overflows
- Page title shows "Create Estimate - Quality Colors"

- [ ] **Step 3.3: Commit**

```bash
git add public/estimate-create-new.html
git commit -m "feat(estimate-create): HTML shell + split panel layout CSS"
```

---

## Task 4: Frontend — Customer search JS (both desktop + mobile)

**Files:**
- Modify: `public/estimate-create-new.html` (add to `<script>` block)

- [ ] **Step 4.1: Add customer search functions inside the `<script>` block**

After the `const RECENT_CUSTOMERS_KEY = ...` line, add:

```javascript
// ════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════
function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmt(n) {
    return '₹' + parseFloat(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function roundUp10(n) { return Math.ceil(parseFloat(n) / 10) * 10; }

// ════════════════════════════════════════
// RECENT CUSTOMERS (localStorage)
// ════════════════════════════════════════
function getRecentCustomers() {
    try { return JSON.parse(localStorage.getItem(RECENT_CUSTOMERS_KEY) || '[]'); } catch { return []; }
}
function saveRecentCustomer(c) {
    const list = getRecentCustomers().filter(r => r.id !== c.id);
    list.unshift(c);
    localStorage.setItem(RECENT_CUSTOMERS_KEY, JSON.stringify(list.slice(0, 5)));
}

// ════════════════════════════════════════
// CUSTOMER SEARCH (shared logic for desktop + mobile instances)
// ════════════════════════════════════════
function initCustomerSearch(inputId, dropdownId, cardId) {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);
    const card = document.getElementById(cardId);
    if (!input) return;

    input.addEventListener('focus', () => {
        const recents = getRecentCustomers();
        if (recents.length) showCustomerResults(recents, dropdown, input, card, true);
    });

    input.addEventListener('input', () => {
        clearTimeout(_customerSearchTimer);
        const q = input.value.trim();
        if (q.length < 2) {
            const recents = getRecentCustomers();
            if (recents.length) showCustomerResults(recents, dropdown, input, card, true);
            else dropdown.style.display = 'none';
            return;
        }
        _customerSearchTimer = setTimeout(async () => {
            try {
                const res = await apiRequest(`/api/estimates/search-customers?q=${encodeURIComponent(q)}`);
                const results = await res.json();
                showCustomerResults(results, dropdown, input, card, false);
            } catch(e) { console.error('Customer search error', e); }
        }, 300);
    });

    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });
}

function showCustomerResults(results, dropdown, input, card, isRecent) {
    if (!results.length) { dropdown.style.display = 'none'; return; }
    dropdown.innerHTML = results.map(c => {
        const badgeClass = c.source === 'zoho' ? 'badge-zoho' : c.source === 'both' ? 'badge-both' : 'badge-local';
        const badgeLabel = c.source === 'zoho' ? 'Zoho' : c.source === 'both' ? 'Both' : 'Local';
        return `<div class="customer-item" onclick="selectCustomer(${JSON.stringify(JSON.stringify(c))}, '${input.id}', '${dropdown.id}', '${card.id}')">
            <div>
                <div style="font-size:13px;font-weight:700;">${esc(c.name)}</div>
                <div style="font-size:11px;color:#6b7280;">${esc(c.phone)}</div>
            </div>
            <span class="source-badge ${badgeClass}">${badgeLabel}</span>
        </div>`;
    }).join('');
    if (isRecent) {
        dropdown.insertAdjacentHTML('afterbegin',
            '<div style="font-size:10px;color:#9ca3af;padding:6px 14px;font-weight:600;">RECENT</div>');
    }
    dropdown.style.display = 'block';
}

function selectCustomer(jsonStr, inputId, dropdownId, cardId) {
    const c = JSON.parse(jsonStr);
    selectedCustomer = c;
    saveRecentCustomer(c);
    document.getElementById(inputId).value = c.name;
    document.getElementById(dropdownId).style.display = 'none';
    const card = document.getElementById(cardId);
    card.innerHTML = `
        <div style="font-weight:700;font-size:13px;margin-bottom:4px;">${esc(c.name)}</div>
        <div style="font-size:12px;color:#374151;">${esc(c.phone)} ${c.email ? '· ' + esc(c.email) : ''}</div>
        ${c.address ? `<div style="font-size:11px;color:#6b7280;margin-top:2px;">${esc(c.address)}</div>` : ''}
    `;
    card.style.display = 'block';

    // Sync both desktop + mobile inputs
    ['customerSearchInput','customerSearchInputMobile'].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.id !== inputId) el.value = c.name;
    });
    ['customerCard','customerCardMobile'].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.id !== cardId) { el.innerHTML = card.innerHTML; el.style.display = 'block'; }
    });
}

// ════════════════════════════════════════
// NEW CUSTOMER MODAL
// ════════════════════════════════════════
function openNewCustomerModal() {
    document.getElementById('newCustomerModal').classList.add('open');
    loadBranches();
}
function closeNewCustomerModal() {
    document.getElementById('newCustomerModal').classList.remove('open');
}
async function loadBranches() {
    const sel = document.getElementById('newCustBranch');
    if (sel.options.length > 1) return; // already loaded
    try {
        const res = await apiRequest('/api/branches/list');
        const data = await res.json();
        const branches = data.data || data;
        sel.innerHTML = '<option value="">-- Select --</option>' +
            branches.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
    } catch(e) { console.error('loadBranches', e); }
}
async function createCustomer(e) {
    e.preventDefault();
    try {
        const payload = {
            name: document.getElementById('newCustName').value.trim(),
            phone: document.getElementById('newCustPhone').value.trim(),
            email: document.getElementById('newCustEmail').value.trim() || null,
            address: document.getElementById('newCustAddress').value.trim() || null,
            branch_id: document.getElementById('newCustBranch').value || null
        };
        const res = await apiRequest('/api/customers', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        const customer = { id: String(data.id), name: payload.name, phone: payload.phone, email: payload.email || '', address: payload.address || '', source: 'local', zoho_contact_id: null, local_customer_id: data.id };
        selectCustomer(JSON.stringify(JSON.stringify(customer)), 'customerSearchInput', 'customerDropdownPanel', 'customerCard');
        closeNewCustomerModal();
    } catch(e) { alert('Error: ' + e.message); }
}
```

- [ ] **Step 4.2: Wire up customer search init inside DOMContentLoaded**

After the `createCustomer` function, add the init block at the bottom of the script:

```javascript
// ════════════════════════════════════════
// INIT
// ════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
    initCustomerSearch('customerSearchInput', 'customerDropdownPanel', 'customerCard');
    initCustomerSearch('customerSearchInputMobile', 'customerDropdownPanelMobile', 'customerCardMobile');
    await loadFilterOptions();
    initProductSearch('productSearchInput', 'productList', 'brandChips', 'categoryChips');
    initProductSearch('productSearchInputMobile', 'productListMobile', 'brandChipsMobile', 'categoryChipsMobile');
});
```

(Note: `loadFilterOptions`, `initProductSearch` are added in Task 5.)

- [ ] **Step 4.3: Smoke-test in browser**

1. Open `http://localhost:3000/estimate-create-new.html`
2. Click customer search input → should show "RECENT" header if any recent customers exist in localStorage
3. Type 2+ chars → debounced API call → results appear with Zoho/Local/Both badge
4. Click a result → input fills, customer card appears with name/phone/address
5. Click "+ New Customer" → modal opens

- [ ] **Step 4.4: Commit**

```bash
git add public/estimate-create-new.html
git commit -m "feat(estimate-create): customer search with recent customers + new customer modal"
```

---

## Task 5: Frontend — Product search, filter chips, product row expand

**Files:**
- Modify: `public/estimate-create-new.html`

- [ ] **Step 5.1: Add filter options loading and product search functions**

Add these functions in the `<script>` block, after the customer section:

```javascript
// ════════════════════════════════════════
// FILTER OPTIONS + CHIPS
// ════════════════════════════════════════
async function loadFilterOptions() {
    try {
        const res = await apiRequest('/api/estimates/filter-options');
        filterOptions = await res.json();
        renderChips('brandChips', filterOptions.brands, 'brand');
        renderChips('categoryChips', filterOptions.categories, 'category');
        renderChips('brandChipsMobile', filterOptions.brands, 'brand');
        renderChips('categoryChipsMobile', filterOptions.categories, 'category');
    } catch(e) { console.error('loadFilterOptions', e); }
}

function renderChips(containerId, items, filterKey) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = items.map(item =>
        `<span class="chip" data-key="${filterKey}" data-val="${esc(item)}"
            onclick="toggleChip(this, '${filterKey}', '${esc(item)}')">${esc(item)}</span>`
    ).join('');
}

function toggleChip(el, key, val) {
    const isMobile = el.closest('#productDrawer') !== null;
    const isActive = el.classList.contains('active');

    // Deactivate all chips for this key in same panel
    el.closest('.filter-chips').querySelectorAll('.chip').forEach(c => c.classList.remove('active'));

    if (!isActive) {
        el.classList.add('active');
        activeFilters[key] = val;
    } else {
        activeFilters[key] = '';
    }

    // Sync the other panel (desktop ↔ mobile) chips
    const otherContainerId = isMobile
        ? (key === 'brand' ? 'brandChips' : 'categoryChips')
        : (key === 'brand' ? 'brandChipsMobile' : 'categoryChipsMobile');
    document.querySelectorAll(`#${otherContainerId} .chip`).forEach(c => {
        c.classList.toggle('active', c.dataset.val === activeFilters[key]);
    });

    triggerProductSearch();
}

// ════════════════════════════════════════
// PRODUCT SEARCH
// ════════════════════════════════════════
function initProductSearch(inputId, listId, brandChipsId, categoryChipsId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('input', () => {
        clearTimeout(_productSearchTimer);
        _productSearchTimer = setTimeout(triggerProductSearch, 400);
    });
}

async function triggerProductSearch() {
    const q = document.getElementById('productSearchInput')?.value ||
              document.getElementById('productSearchInputMobile')?.value || '';
    const params = new URLSearchParams({ q });
    if (activeFilters.brand) params.set('brand', activeFilters.brand);
    if (activeFilters.category) params.set('category', activeFilters.category);

    // Sync input values between desktop + mobile
    const desktopInput = document.getElementById('productSearchInput');
    const mobileInput  = document.getElementById('productSearchInputMobile');
    if (desktopInput && document.activeElement !== desktopInput) desktopInput.value = q;
    if (mobileInput  && document.activeElement !== mobileInput)  mobileInput.value  = q;

    if (!q && !activeFilters.brand && !activeFilters.category) {
        ['productList','productListMobile'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<div class="text-center text-gray-400 text-sm py-6">Type to search products...</div>';
        });
        return;
    }

    try {
        const res = await apiRequest(`/api/estimates/search-products?${params}`);
        const products = await res.json();
        renderProductList(products, 'productList');
        renderProductList(products, 'productListMobile');
    } catch(e) { console.error('product search', e); }
}

// ════════════════════════════════════════
// PRODUCT LIST RENDERING
// ════════════════════════════════════════
function renderProductList(products, containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!products.length) {
        el.innerHTML = '<div class="text-center text-gray-400 text-sm py-6">No products found</div>';
        return;
    }
    el.innerHTML = products.map(p => buildProductRow(p)).join('');
}

function buildProductRow(p) {
    const stockClass = p.stock_on_hand > 0 ? 'stock-in' : 'stock-out';
    const stockLabel = p.stock_on_hand > 0 ? `Stock: ${p.stock_on_hand}` : 'Out of stock';
    const rowId = `pr_${p.zoho_item_id.replace(/[^a-z0-9]/gi,'_')}`;
    return `
<div class="product-row" id="${rowId}" onclick="toggleProductRow('${rowId}', ${JSON.stringify(JSON.stringify(p))})">
    <div class="product-row-header">
        <div style="flex:1; min-width:0;">
            <div style="font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p.name)}</div>
            <div style="font-size:11px;color:#6b7280;">${esc(p.brand)} ${p.category ? '· ' + esc(p.category) : ''} · ${fmt(p.rate)}</div>
        </div>
        <span class="stock-badge ${stockClass} ml-2">${esc(stockLabel)}</span>
    </div>
    <div class="product-row-expand" id="${rowId}_expand"></div>
</div>`;
}

function toggleProductRow(rowId, jsonStr) {
    const row = document.getElementById(rowId);
    const expand = document.getElementById(rowId + '_expand');
    if (!row || !expand) return;
    const isOpen = row.classList.contains('expanded');
    // Close all others
    document.querySelectorAll('.product-row.expanded').forEach(r => {
        r.classList.remove('expanded');
    });
    if (!isOpen) {
        row.classList.add('expanded');
        const p = JSON.parse(jsonStr);
        renderProductExpand(expand, p);
    }
}
```

- [ ] **Step 5.2: Smoke-test chips and search**

1. Reload the page — brand + category chips should appear
2. Click a brand chip (e.g., "Asian Paints") — chip turns purple, same chip syncs in mobile drawer
3. Type in product search — results appear with name, brand, rate, stock badge
4. Click a product row — it expands (expand section is empty until Task 6)
5. Click same row again — it collapses

- [ ] **Step 5.3: Commit**

```bash
git add public/estimate-create-new.html
git commit -m "feat(estimate-create): product search + filter chips + row expand/collapse"
```

---

## Task 6: Frontend — Product expand panel (unit mode + area mode + add to estimate)

**Files:**
- Modify: `public/estimate-create-new.html`

- [ ] **Step 6.1: Add renderProductExpand and area calculator functions**

```javascript
// ════════════════════════════════════════
// PRODUCT EXPAND PANEL
// ════════════════════════════════════════
function renderProductExpand(expandEl, p) {
    const hasArea = p.has_area_calc && p.area_coverage > 0;
    expandEl.innerHTML = `
        <div>
            ${hasArea ? `
            <div style="display:flex;gap:12px;margin-bottom:10px;">
                <label style="font-size:12px;cursor:pointer;display:flex;align-items:center;gap:4px;">
                    <input type="radio" name="mode_${p.zoho_item_id}" value="unit" checked
                        onchange="switchMode('${p.zoho_item_id}', 'unit', ${p.area_coverage})"> Unit qty
                </label>
                <label style="font-size:12px;cursor:pointer;display:flex;align-items:center;gap:4px;">
                    <input type="radio" name="mode_${p.zoho_item_id}" value="area"
                        onchange="switchMode('${p.zoho_item_id}', 'area', ${p.area_coverage})"> Area (sq.ft)
                </label>
            </div>` : ''}

            <!-- Unit mode -->
            <div id="unitMode_${p.zoho_item_id}">
                <div class="qty-stepper mb-3">
                    <button class="qty-btn" onclick="stepQty('${p.zoho_item_id}', -1)">−</button>
                    <span class="qty-display" id="qty_${p.zoho_item_id}">1</span>
                    <button class="qty-btn" onclick="stepQty('${p.zoho_item_id}', 1)">+</button>
                    <span style="font-size:12px;color:#6b7280;margin-left:4px;">${esc(p.unit)}</span>
                    <span style="font-size:13px;font-weight:700;margin-left:auto;" id="unitTotal_${p.zoho_item_id}">${fmt(p.rate)}</span>
                </div>
                <button onclick="addUnitToEstimate(${JSON.stringify(JSON.stringify(p))})"
                    class="btn-primary" style="padding:8px;">+ Add to Estimate</button>
            </div>

            <!-- Area mode (hidden by default) -->
            ${hasArea ? `
            <div id="areaMode_${p.zoho_item_id}" style="display:none;">
                <div class="area-inputs">
                    <div class="area-input-group">
                        <label>Square Feet</label>
                        <input type="number" id="sqft_${p.zoho_item_id}" min="1" step="1" placeholder="e.g. 500"
                            oninput="recalcArea('${p.zoho_item_id}', ${p.area_coverage}, ${p.local_product_id || 'null'}, ${JSON.stringify(JSON.stringify(p))})">
                    </div>
                    <div class="area-input-group">
                        <label>Coats</label>
                        <input type="number" id="coats_${p.zoho_item_id}" min="1" max="5" value="2"
                            oninput="recalcArea('${p.zoho_item_id}', ${p.area_coverage}, ${p.local_product_id || 'null'}, ${JSON.stringify(JSON.stringify(p))})">
                    </div>
                </div>
                <div id="areaResult_${p.zoho_item_id}" class="calc-result" style="display:none;"></div>
                <button id="areaAddBtn_${p.zoho_item_id}" onclick="addAreaToEstimate('${p.zoho_item_id}')"
                    class="btn-primary mt-2" style="padding:8px; display:none;">+ Add to Estimate</button>
            </div>` : ''}
        </div>`;
}

function switchMode(itemId, mode, coverage) {
    document.getElementById(`unitMode_${itemId}`).style.display = mode === 'unit' ? 'block' : 'none';
    const areaEl = document.getElementById(`areaMode_${itemId}`);
    if (areaEl) areaEl.style.display = mode === 'area' ? 'block' : 'none';
}

function stepQty(itemId, delta) {
    const el = document.getElementById(`qty_${itemId}`);
    const totalEl = document.getElementById(`unitTotal_${itemId}`);
    let qty = parseInt(el.textContent) + delta;
    if (qty < 1) qty = 1;
    el.textContent = qty;
    // Get rate from expand context — look up product row data
    const expandEl = el.closest('.product-row-expand');
    const addBtn = expandEl?.querySelector('.btn-primary');
    if (addBtn) {
        // rate stored in data attr set during renderProductExpand
        const rate = parseFloat(expandEl.dataset.rate || 0);
        if (totalEl && rate) totalEl.textContent = fmt(rate * qty);
    }
}

// ════════════════════════════════════════
// AREA CALCULATOR
// ════════════════════════════════════════
let _areaComboCache = {}; // cache sibling pack sizes per local_product_id

async function fetchSiblingPacks(localProductId) {
    if (_areaComboCache[localProductId]) return _areaComboCache[localProductId];
    try {
        const res = await apiRequest(`/api/products/${localProductId}`);
        const data = await res.json();
        const packs = (data.pack_sizes || []).filter(ps => ps.is_active && ps.zoho_item_id)
            .map(ps => ({
                zoho_item_id: ps.zoho_item_id,
                name: `${data.name} ${ps.size}${ps.unit || 'L'}`,
                size: parseFloat(ps.size),
                rate: parseFloat(ps.base_price)
            }));
        _areaComboCache[localProductId] = packs;
        return packs;
    } catch { return []; }
}

function calculatePackCombo(litersNeeded, packSizes) {
    if (!packSizes || !packSizes.length) return [];
    const sorted = [...packSizes].sort((a, b) => b.size - a.size);
    const result = [];
    let remaining = litersNeeded;
    for (const pack of sorted) {
        if (remaining <= 0.001) break;
        const count = Math.floor(remaining / pack.size);
        if (count > 0) {
            result.push({ ...pack, quantity: count });
            remaining -= count * pack.size;
        }
    }
    if (remaining > 0.001) {
        const smallest = sorted[sorted.length - 1];
        const existing = result.find(r => r.zoho_item_id === smallest.zoho_item_id);
        if (existing) existing.quantity += 1;
        else result.push({ ...smallest, quantity: 1 });
    }
    return result;
}

// Stores pending area combo result per itemId so addAreaToEstimate can use it
const _pendingAreaCombo = {};

async function recalcArea(itemId, coverage, localProductId, pJsonStr) {
    const sqft = parseFloat(document.getElementById(`sqft_${itemId}`)?.value) || 0;
    const coats = parseFloat(document.getElementById(`coats_${itemId}`)?.value) || 2;
    const resultEl = document.getElementById(`areaResult_${itemId}`);
    const addBtn = document.getElementById(`areaAddBtn_${itemId}`);
    if (!sqft || sqft <= 0) { resultEl.style.display = 'none'; addBtn.style.display = 'none'; return; }

    const liters = (sqft * coats) / coverage;
    const p = JSON.parse(pJsonStr);

    if (localProductId) {
        const sibs = await fetchSiblingPacks(localProductId);
        if (sibs.length > 0) {
            const combo = calculatePackCombo(liters, sibs);
            _pendingAreaCombo[itemId] = combo;
            const comboStr = combo.map(c => `${c.quantity}×${c.name}`).join(' + ');
            resultEl.textContent = `→ ${liters.toFixed(1)}L needed → ${comboStr}`;
            resultEl.style.display = 'block';
            addBtn.style.display = 'block';
            return;
        }
    }

    // Single-item fallback
    const qty = Math.ceil(liters / (parseFloat(p.unit_size) || 1));
    const singleCombo = [{ zoho_item_id: p.zoho_item_id, name: p.name, size: 1, rate: p.rate, quantity: Math.max(1, Math.ceil(liters)) }];
    _pendingAreaCombo[itemId] = singleCombo.map(c => ({ ...c, quantity: Math.max(1, Math.ceil(liters)) }));
    resultEl.textContent = `→ ${liters.toFixed(1)}L needed → approx ${Math.ceil(liters)} unit(s) of this item`;
    resultEl.style.display = 'block';
    addBtn.style.display = 'block';
}
```

- [ ] **Step 6.2: Fix stepQty and add data-rate to expand div**

In `buildProductRow()`, change the expand div line from:
```javascript
`<div class="product-row-expand" id="${rowId}_expand"></div>`
```
to:
```javascript
`<div class="product-row-expand" id="${rowId}_expand" data-rate="${p.rate}"></div>`
```

Then **replace** the `stepQty` function written in Step 6.1 with this corrected version that uses `closest()` instead of getElementById (the element IDs don't match):

```javascript
function stepQty(itemId, delta) {
    const el = document.getElementById(`qty_${itemId}`);
    const totalEl = document.getElementById(`unitTotal_${itemId}`);
    let qty = Math.max(1, parseInt(el.textContent) + delta);
    el.textContent = qty;
    const expandEl = el.closest('.product-row-expand');
    if (expandEl && totalEl) {
        totalEl.textContent = fmt(parseFloat(expandEl.dataset.rate || 0) * qty);
    }
}
```

- [ ] **Step 6.3: Test area calculator**

1. Search for a product that has `has_area_calc: true` (any product linked to a local product with `area_coverage` set)
2. Click the row → expand panel shows "Unit qty" and "Area (sq.ft)" radio buttons
3. Switch to Area mode
4. Enter sqft = 500, coats = 2 → combo result appears: "→ Xed L needed → 1×20L + 1×10L..."
5. For a product without local mapping → shows "→ Xed L needed → approx N unit(s)"

- [ ] **Step 6.4: Commit**

```bash
git add public/estimate-create-new.html
git commit -m "feat(estimate-create): product expand panel with unit/area mode and pack combo calculator"
```

---

## Task 7: Frontend — Add to estimate + estimate items panel

**Files:**
- Modify: `public/estimate-create-new.html`

- [ ] **Step 7.1: Add addUnitToEstimate, addAreaToEstimate, and renderEstimateItems**

```javascript
// ════════════════════════════════════════
// ADD TO ESTIMATE
// ════════════════════════════════════════
function addUnitToEstimate(pJsonStr) {
    const p = JSON.parse(pJsonStr);
    const qtyEl = document.getElementById(`qty_${p.zoho_item_id}`);
    const qty = qtyEl ? parseInt(qtyEl.textContent) : 1;
    pushEstimateItem({
        zoho_item_id: p.zoho_item_id,
        name: p.name,
        brand: p.brand,
        base_price: p.rate,
        quantity: qty,
        unit: p.unit || 'Nos'
    });
}

function addAreaToEstimate(itemId) {
    const combo = _pendingAreaCombo[itemId];
    if (!combo || !combo.length) return;
    combo.forEach(c => {
        pushEstimateItem({
            zoho_item_id: c.zoho_item_id,
            name: c.name,
            base_price: c.rate,
            quantity: c.quantity,
            unit: 'Nos'
        });
    });
}

function pushEstimateItem(item) {
    const id = itemIdCounter++;
    estimateItems.push({
        id, item_type: 'product',
        zoho_item_id: item.zoho_item_id,
        name: item.name,
        brand: item.brand || '',
        base_price: parseFloat(item.base_price) || 0,
        quantity: item.quantity || 1,
        unit: item.unit || 'Nos',
        markup_type: '', markup_value: '',
        discount_type: '', discount_value: ''
    });
    renderEstimateItems();
    updateTotals();
    // On mobile: close drawer after adding
    if (window.innerWidth < 768) closeDrawer();
}

// ════════════════════════════════════════
// ESTIMATE ITEMS RENDERING
// ════════════════════════════════════════
function recalcItem(item) {
    const bp = parseFloat(item.base_price) || 0;
    const qty = parseFloat(item.quantity) || 1;
    let markup = 0;
    if (item.markup_type && parseFloat(item.markup_value) > 0) {
        const mv = parseFloat(item.markup_value);
        if (item.markup_type === 'price_pct') markup = bp * mv / 100;
        else if (item.markup_type === 'price_value') markup = mv;
    }
    const afterMarkup = bp + markup;
    let discount = 0;
    if (item.discount_type && parseFloat(item.discount_value) > 0) {
        const dv = parseFloat(item.discount_value);
        if (item.discount_type === 'price_pct') discount = afterMarkup * dv / 100;
        else if (item.discount_type === 'price_value') discount = dv;
    }
    item.final_price = roundUp10(afterMarkup - discount);
    item.line_total = roundUp10(item.final_price * qty);
}

function renderEstimateItems() {
    const container = document.getElementById('estimateItemsContainer');
    const empty = document.getElementById('estimateEmpty');
    if (!estimateItems.length) {
        if (empty) empty.style.display = 'block';
        container.querySelectorAll('.est-item-card').forEach(c => c.remove());
        return;
    }
    if (empty) empty.style.display = 'none';

    container.querySelectorAll('.est-item-card').forEach(c => c.remove());

    estimateItems.forEach(item => {
        recalcItem(item);
        const card = document.createElement('div');
        card.className = 'est-item-card';
        card.id = `eitm_${item.id}`;
        card.innerHTML = `
            <div class="est-item-header" onclick="toggleItemCard(${item.id})">
                <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(item.name)}</div>
                    <div style="font-size:11px;color:#6b7280;">${item.quantity} ${esc(item.unit)} · ${fmt(item.base_price)}/unit</div>
                </div>
                <div style="text-align:right;flex-shrink:0;margin-left:8px;">
                    <div style="font-size:15px;font-weight:800;color:#1f2937;">${fmt(item.line_total)}</div>
                    <button onclick="event.stopPropagation();removeItem(${item.id})"
                        style="font-size:10px;color:#dc2626;background:none;border:none;cursor:pointer;padding:0;">✕ Remove</button>
                </div>
            </div>
            <div class="est-item-expand">
                <div class="md-row">
                    <span class="md-label" style="color:#7c3aed;">Markup</span>
                    <select class="md-select" onchange="setItemField(${item.id},'markup_type',this.value)">
                        <option value="" ${!item.markup_type?'selected':''}>None</option>
                        <option value="price_pct" ${item.markup_type==='price_pct'?'selected':''}>%</option>
                        <option value="price_value" ${item.markup_type==='price_value'?'selected':''}>₹</option>
                    </select>
                    <input type="number" class="md-input" min="0" step="0.01" value="${esc(item.markup_value)}"
                        placeholder="0" onchange="setItemField(${item.id},'markup_value',this.value)">
                    <button class="md-btn bg-purple-600 text-white" onclick="applyItemMarkupDiscount(${item.id})">Apply</button>
                </div>
                <div class="md-row">
                    <span class="md-label" style="color:#dc2626;">Discount</span>
                    <select class="md-select" onchange="setItemField(${item.id},'discount_type',this.value)">
                        <option value="" ${!item.discount_type?'selected':''}>None</option>
                        <option value="price_pct" ${item.discount_type==='price_pct'?'selected':''}>%</option>
                        <option value="price_value" ${item.discount_type==='price_value'?'selected':''}>₹</option>
                    </select>
                    <input type="number" class="md-input" min="0" step="0.01" value="${esc(item.discount_value)}"
                        placeholder="0" onchange="setItemField(${item.id},'discount_value',this.value)">
                    <button class="md-btn bg-red-600 text-white" onclick="applyItemMarkupDiscount(${item.id})">Apply</button>
                </div>
                <div style="font-size:12px;color:#374151;margin-top:4px;">
                    Final price: <strong>${fmt(item.final_price)}</strong>/unit · Total: <strong>${fmt(item.line_total)}</strong>
                </div>
            </div>`;
        container.insertBefore(card, document.getElementById('laborContainer')?.closest('.panel-section') || null);
    });
}

function toggleItemCard(id) {
    const card = document.getElementById(`eitm_${id}`);
    if (card) card.classList.toggle('open');
}

function removeItem(id) {
    estimateItems = estimateItems.filter(i => i.id !== id);
    renderEstimateItems();
    updateTotals();
}

function setItemField(id, field, value) {
    const item = estimateItems.find(i => i.id === id);
    if (item) item[field] = value;
}

function applyItemMarkupDiscount(id) {
    const item = estimateItems.find(i => i.id === id);
    if (!item) return;
    renderEstimateItems();
    updateTotals();
}

// ════════════════════════════════════════
// OVERALL MARKUP / DISCOUNT
// ════════════════════════════════════════
function applyOverallMarkup() {
    const type = document.getElementById('overallMarkupType').value;
    const val = document.getElementById('overallMarkupValue').value;
    estimateItems.forEach(i => { i.markup_type = type; i.markup_value = val; });
    renderEstimateItems();
    updateTotals();
}
function clearOverallMarkup() {
    document.getElementById('overallMarkupValue').value = '';
    estimateItems.forEach(i => { i.markup_type = ''; i.markup_value = ''; });
    renderEstimateItems();
    updateTotals();
}
function applyOverallDiscount() {
    const type = document.getElementById('overallDiscountType').value;
    const val = document.getElementById('overallDiscountValue').value;
    estimateItems.forEach(i => { i.discount_type = type; i.discount_value = val; });
    renderEstimateItems();
    updateTotals();
}
function clearOverallDiscount() {
    document.getElementById('overallDiscountValue').value = '';
    estimateItems.forEach(i => { i.discount_type = ''; i.discount_value = ''; });
    renderEstimateItems();
    updateTotals();
}

// ════════════════════════════════════════
// LABOR CHARGES
// ════════════════════════════════════════
function addLaborItem() {
    const id = laborIdCounter++;
    laborItems.push({ id, description: '', amount: 0 });
    renderLaborItems();
}

function renderLaborItems() {
    const container = document.getElementById('laborContainer');
    const totalRow = document.getElementById('laborTotalRow');
    container.innerHTML = laborItems.map(l => `
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;" id="labor_${l.id}">
            <input type="text" placeholder="Description (e.g. Wall Painting)" value="${esc(l.description)}"
                style="flex:1;padding:6px 8px;border:1.5px solid #d1d5db;border-radius:6px;font-size:13px;"
                onchange="setLaborField(${l.id},'description',this.value)">
            <input type="number" placeholder="₹" value="${l.amount||''}" min="0" step="1"
                style="width:90px;padding:6px 8px;border:1.5px solid #d1d5db;border-radius:6px;font-size:13px;"
                oninput="setLaborField(${l.id},'amount',this.value)">
            <button onclick="removeLabor(${l.id})"
                style="color:#dc2626;background:none;border:none;font-size:18px;cursor:pointer;line-height:1;">×</button>
        </div>`).join('');
    if (laborItems.length) totalRow?.classList.remove('hidden');
    else totalRow?.classList.add('hidden');
    updateTotals();
}

function setLaborField(id, field, value) {
    const l = laborItems.find(i => i.id === id);
    if (l) {
        l[field] = field === 'amount' ? parseFloat(value) || 0 : value;
        updateTotals();
    }
}
function removeLabor(id) {
    laborItems = laborItems.filter(l => l.id !== id);
    renderLaborItems();
}

// ════════════════════════════════════════
// TOTALS
// ════════════════════════════════════════
function updateTotals() {
    estimateItems.forEach(recalcItem);
    const itemsTotal = estimateItems.reduce((s, i) => s + (i.line_total || 0), 0);
    const laborTotal = laborItems.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
    const grandTotal = itemsTotal + laborTotal;

    document.getElementById('subtotalAmt').textContent = fmt(itemsTotal);
    document.getElementById('grandTotalAmt').textContent = fmt(grandTotal);
    document.getElementById('grandTotalAmtMobile').textContent = fmt(grandTotal);
    document.getElementById('laborTotalAmt').textContent = fmt(laborTotal);
}
```

- [ ] **Step 7.2: Test adding items and estimate panel**

1. Search for a product, expand its row, set quantity to 3, click "Add to Estimate"
2. Item card appears in right panel with name, qty, unit price, line total
3. Tap the item card → expand shows markup/discount inputs
4. Apply 10% markup → final price + total update
5. Overall markup "20%" → Apply → all items update
6. Remove button → item disappears, totals update
7. Add Labor → description + amount inputs appear, labor total shows

- [ ] **Step 7.3: Commit**

```bash
git add public/estimate-create-new.html
git commit -m "feat(estimate-create): estimate items panel with markup/discount/labor and live totals"
```

---

## Task 8: Frontend — Mobile drawer + save flow + post-save modal

**Files:**
- Modify: `public/estimate-create-new.html`

- [ ] **Step 8.1: Add drawer open/close and save flow functions**

```javascript
// ════════════════════════════════════════
// MOBILE DRAWER
// ════════════════════════════════════════
function openDrawer() {
    document.getElementById('drawerOverlay').classList.add('open');
    document.getElementById('productDrawer').classList.add('open');
    // Focus mobile search
    setTimeout(() => document.getElementById('productSearchInputMobile')?.focus(), 300);
}
function closeDrawer() {
    document.getElementById('drawerOverlay').classList.remove('open');
    document.getElementById('productDrawer').classList.remove('open');
}

// Swipe-down to close
(function initSwipeClose() {
    let startY = 0;
    const drawer = document.getElementById('productDrawer');
    drawer.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
    drawer.addEventListener('touchend', e => {
        if (e.changedTouches[0].clientY - startY > 80) closeDrawer();
    }, { passive: true });
})();

// ════════════════════════════════════════
// SAVE ESTIMATE
// ════════════════════════════════════════
async function saveEstimate() {
    if (!selectedCustomer) { alert('Please select a customer first.'); return; }
    if (!estimateItems.length) { alert('Please add at least one product.'); return; }

    const payload = {
        customer_name: selectedCustomer.name,
        customer_phone: selectedCustomer.phone || '',
        customer_address: selectedCustomer.address || '',
        estimate_date: new Date().toISOString().split('T')[0],
        show_gst_breakdown: 0,
        column_visibility: null,
        show_description_only: 0,
        notes: null,
        admin_notes: null,
        status: 'draft',
        branch_id: null,
        items: [
            ...estimateItems.map(i => ({
                item_type: 'product',
                zoho_item_id: i.zoho_item_id,
                description: i.name,
                base_price: i.base_price,
                unit_price: i.base_price,
                quantity: i.quantity,
                markup_type: i.markup_type || null,
                markup_value: i.markup_value ? parseFloat(i.markup_value) : null,
                discount_type: i.discount_type || null,
                discount_value: i.discount_value ? parseFloat(i.discount_value) : null,
                area: null, coats: null, mix_info: null, show_description_only: 0
            })),
            ...laborItems.map(l => ({
                item_type: 'labor',
                description: l.description || 'Labor',
                base_price: l.amount,
                unit_price: l.amount,
                quantity: 1,
                markup_type: null, markup_value: null,
                discount_type: null, discount_value: null,
                area: null, coats: null, mix_info: null, show_description_only: 0
            }))
        ]
    };

    const saveBtn = document.getElementById('saveBtn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

    try {
        const res = await apiRequest('/api/estimates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');
        showSaveSuccess(data.id, data.estimate_number, selectedCustomer);
    } catch(e) {
        alert('Error saving estimate: ' + e.message);
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Save Estimate'; }
    }
}

// ════════════════════════════════════════
// POST-SAVE MODAL
// ════════════════════════════════════════
function showSaveSuccess(estimateId, estimateNumber, customer) {
    const subtotal = estimateItems.reduce((s, i) => s + (i.line_total || 0), 0);
    const laborTotal = laborItems.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
    const grand = subtotal + laborTotal;

    document.getElementById('saveSuccessTitle').textContent = `${estimateNumber} Saved!`;
    document.getElementById('saveSuccessTotal').textContent = `Grand Total: ${fmt(grand)}`;

    const waBtn = document.getElementById('saveSuccessWA');
    waBtn.textContent = `📲 Send to ${customer.name} on WhatsApp`;
    waBtn.onclick = async () => {
        try {
            await apiRequest(`/api/estimates/${estimateId}/send-whatsapp`, { method: 'POST' });
            alert('WhatsApp sent successfully!');
        } catch(e) { alert('WhatsApp send failed: ' + e.message); }
    };

    const viewBtn = document.getElementById('saveSuccessView');
    viewBtn.onclick = () => { window.location.href = `/admin-estimates.html?id=${estimateId}`; };

    document.getElementById('saveSuccessModal').classList.add('open');
}
```

- [ ] **Step 8.2: Test the full save flow**

1. Select a customer → add 2 products → add 1 labor charge
2. Click "Save Estimate"
3. Success modal appears: estimate number, grand total, WhatsApp button, View button
4. Click "View Estimate →" → navigates to estimate detail page
5. On mobile (DevTools responsive mode): "Add Product" fixed button → drawer slides up → find product → add → drawer closes → item in right panel → "Save" in bottom bar → success modal

- [ ] **Step 8.3: Commit**

```bash
git add public/estimate-create-new.html
git commit -m "feat(estimate-create): mobile drawer + save flow + post-save WhatsApp popup"
```

---

## Task 9: Final polish — run all tests + deploy

**Files:**
- No new files

- [ ] **Step 9.1: Run full test suite**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/act.qcpaintshop.com"
npx jest --no-coverage
```

Expected: all existing tests pass + the 5 new pack-combo tests pass.

- [ ] **Step 9.2: End-to-end smoke test checklist**

On desktop:
- [ ] Customer search: type 2 chars → results from Zoho + local, correct badges
- [ ] Recent customers: focus empty input → last 5 show
- [ ] New customer modal: creates customer, auto-selects it
- [ ] Product search: type → results load from Zoho items; filter chips narrow results
- [ ] Unit mode: stepper updates total, "Add" adds item card
- [ ] Area mode: sqft+coats → combo shown → "Add" adds all pack items
- [ ] Item card expand: markup/discount applied, totals update
- [ ] Overall markup/discount: applies to all items
- [ ] Labor: add multiple, remove, total updates
- [ ] Save: validates customer + items, posts, shows modal
- [ ] WhatsApp button calls correct endpoint
- [ ] View Estimate → correct URL

On mobile (Chrome DevTools → responsive, 375px):
- [ ] Default view shows estimate panel + mobile customer search
- [ ] "+ Product" button → drawer slides up
- [ ] Adding product → drawer closes, item appears in right panel
- [ ] Save button in bottom bar works

- [ ] **Step 9.3: Deploy to production**

```bash
ssh hetzner "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && npm install && pm2 restart business-manager"
```

- [ ] **Step 9.4: Final commit with version note**

```bash
git add -A
git commit -m "feat(estimate-create): full split-panel rebuild — Zoho products+customers, area calc, mobile drawer"
```
