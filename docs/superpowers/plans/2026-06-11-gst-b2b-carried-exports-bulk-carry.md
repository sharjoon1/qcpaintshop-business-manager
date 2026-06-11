# GST B2B Carried-Forward Exports + Bulk Carry-Forward Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three carried-forward-inclusive B2B CSV exports (overall, customer-wise, customer-invoice+HSN) and a bulk carry-forward action (checkboxes + date/amount range filter) to the GST Reports page.

**Architecture:** Backend gets one pure exported helper (`planBulkCarry`) that classifies requested invoices into valid/skipped, a new `POST /carry-forward/bulk` route that uses it plus a single bulk upsert, and optional range filters on `GET /missed-b2b`. Frontend adds an Export menu wired to three client-side `csvDownload()` builders over already-cached data, and a bulk-select UI in the Missed-invoice panel.

**Tech Stack:** Express 5, `mysql2/promise`, Jest (pure-function unit tests), vanilla JS + inline-styled static HTML.

---

## File Structure

- `routes/gst-reports.js` — add `planBulkCarry()` pure helper (exported for tests), extend `GET /missed-b2b` with `from_date`/`to_date`/`min_amount`, add `POST /carry-forward/bulk`.
- `tests/unit/gst-reports.test.js` — add a `describe('planBulkCarry')` block.
- `public/admin-gst-reports.html` — Export menu + 3 export builders; Missed-panel filters, checkboxes, bulk carry button.

---

## Task 1: `planBulkCarry` pure helper (TDD)

**Files:**
- Modify: `routes/gst-reports.js` (add helper near other pure helpers ~line 79; add to `module.exports` at the bottom ~line 616)
- Test: `tests/unit/gst-reports.test.js`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/gst-reports.test.js`. First update the require line (line 9) to also import `planBulkCarry`:

```js
const { monthRange, isB2B, resolveCostRate, deriveTax, invoiceNumberRange, planBulkCarry } = require('../../routes/gst-reports');
```

Then append this block at the end of the file:

```js
describe('planBulkCarry (bulk carry-forward classifier)', () => {
    const rows = [
        { zoho_invoice_id: 'A', invoice_number: 'QCIN-1', invoice_date: '2026-03-15' },
        { zoho_invoice_id: 'B', invoice_number: 'QCIN-2', invoice_date: new Date('2026-04-20T00:00:00Z') },
        { zoho_invoice_id: 'C', invoice_number: 'QCIN-3', invoice_date: '2026-06-02' }, // same month as filed → skip
    ];

    it('keeps earlier-month invoices and reports their original month', () => {
        const r = planBulkCarry(['A', 'B'], rows, '2026-06');
        expect(r.valid).toEqual([
            { zoho_invoice_id: 'A', original_month: '2026-03', invoice_number: 'QCIN-1' },
            { zoho_invoice_id: 'B', original_month: '2026-04', invoice_number: 'QCIN-2' },
        ]);
        expect(r.skipped).toEqual([]);
    });

    it('skips not-found ids and same-or-later-month invoices with a reason', () => {
        const r = planBulkCarry(['A', 'C', 'Z'], rows, '2026-06');
        expect(r.valid.map(v => v.zoho_invoice_id)).toEqual(['A']);
        expect(r.skipped).toEqual([
            { id: 'C', reason: 'not_earlier' },
            { id: 'Z', reason: 'not_found' },
        ]);
    });

    it('rejects a malformed filed_in_month', () => {
        expect(() => planBulkCarry(['A'], rows, '2026-13')).toThrow();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/gst-reports.test.js`
Expected: FAIL — `planBulkCarry is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `routes/gst-reports.js`, add after `invoiceNumberRange` (after line 79, before `resolveCostRate`):

```js
/**
 * Classify a bulk carry-forward request. Mirrors the single /carry-forward
 * rule: an invoice may only move to a LATER month than its own. Pure — the
 * route does the DB fetch + upsert.
 * @param requestedIds  string[] of zoho_invoice_id the user selected
 * @param invoiceRows   [{ zoho_invoice_id, invoice_number, invoice_date }] from DB
 * @param filedInMonth  'YYYY-MM'
 * Returns { valid: [{ zoho_invoice_id, original_month, invoice_number }],
 *           skipped: [{ id, reason: 'not_found' | 'not_earlier' }] }
 */
function planBulkCarry(requestedIds, invoiceRows, filedInMonth) {
    monthRange(filedInMonth); // validates 'YYYY-MM' format (throws on bad input)
    const byId = new Map((invoiceRows || []).map(r => [String(r.zoho_invoice_id), r]));
    const valid = [];
    const skipped = [];
    for (const id of (requestedIds || [])) {
        const inv = byId.get(String(id));
        if (!inv) { skipped.push({ id, reason: 'not_found' }); continue; }
        const originalMonth = inv.invoice_date instanceof Date
            ? inv.invoice_date.toISOString().slice(0, 7)
            : String(inv.invoice_date).slice(0, 7);
        if (originalMonth >= filedInMonth) { skipped.push({ id, reason: 'not_earlier' }); continue; }
        valid.push({ zoho_invoice_id: id, original_month: originalMonth, invoice_number: inv.invoice_number });
    }
    return { valid, skipped };
}
```

Then add `planBulkCarry` to the exports. Change the last line (line 616) from:

```js
module.exports = { router, setPool, monthRange, isB2B, resolveCostRate, deriveTax, invoiceNumberRange };
```

to:

```js
module.exports = { router, setPool, monthRange, isB2B, resolveCostRate, deriveTax, invoiceNumberRange, planBulkCarry };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/gst-reports.test.js`
Expected: PASS (all `planBulkCarry` cases green, existing cases still green).

- [ ] **Step 5: Commit**

```bash
git add routes/gst-reports.js tests/unit/gst-reports.test.js
git commit -m "feat(gst): planBulkCarry helper for bulk carry-forward classification"
```

---

## Task 2: `POST /carry-forward/bulk` route

**Files:**
- Modify: `routes/gst-reports.js` (insert after the single `POST /carry-forward` handler, after line 288)

- [ ] **Step 1: Add the route**

Insert immediately after the single `router.post('/carry-forward', …)` handler closes (after line 288, before the `DELETE` handler):

```js
router.post('/carry-forward/bulk', requirePermission('zoho', 'edit'), async (req, res) => {
    try {
        const { filed_in_month, note } = req.body;
        const ids = Array.isArray(req.body.zoho_invoice_ids) ? req.body.zoho_invoice_ids : [];
        if (!ids.length) {
            return res.status(400).json({ success: false, message: 'No invoices selected' });
        }
        const [rows] = await pool.query(
            'SELECT zoho_invoice_id, invoice_number, invoice_date FROM zoho_invoices WHERE zoho_invoice_id IN (?)',
            [ids]
        );
        const { valid, skipped } = planBulkCarry(ids, rows, filed_in_month);
        if (valid.length) {
            const values = valid.map(v => [v.zoho_invoice_id, v.original_month, filed_in_month, note || null, req.user.id]);
            await pool.query(
                `INSERT INTO gst_filing_adjustments (zoho_invoice_id, original_month, filed_in_month, note, created_by)
                 VALUES ?
                 ON DUPLICATE KEY UPDATE filed_in_month = VALUES(filed_in_month), note = VALUES(note), created_by = VALUES(created_by)`,
                [values]
            );
        }
        res.json({ success: true, carried: valid.length, skipped });
    } catch (err) {
        console.error('GST carry-forward bulk error:', err);
        res.status(400).json({ success: false, message: err.message });
    }
});
```

- [ ] **Step 2: Verify the suite still passes**

Run: `npm test -- tests/unit/gst-reports.test.js`
Expected: PASS (route addition does not affect pure-function tests; confirms no syntax error in the module).

- [ ] **Step 3: Sanity-check the module loads**

Run: `node -e "require('./routes/gst-reports.js'); console.log('ok')"`
Expected: prints `ok` (no syntax/parse error).

- [ ] **Step 4: Commit**

```bash
git add routes/gst-reports.js
git commit -m "feat(gst): POST /carry-forward/bulk — carry many missed invoices at once"
```

---

## Task 3: Range filters on `GET /missed-b2b`

**Files:**
- Modify: `routes/gst-reports.js` (the `GET /missed-b2b` handler, lines 236-260)

- [ ] **Step 1: Replace the handler body with filtered query**

Replace the handler (lines 236-260) with:

```js
router.get('/missed-b2b', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const [from] = monthRange(req.query.month); // candidates must precede this month
        const search = `%${req.query.search || ''}%`;
        const params = [from, from, search, search];
        let extra = '';
        if (req.query.from_date) { extra += ' AND zi.invoice_date >= ?'; params.push(req.query.from_date); }
        if (req.query.to_date) { extra += ' AND zi.invoice_date <= ?'; params.push(req.query.to_date); }
        const minAmount = parseFloat(req.query.min_amount);
        if (Number.isFinite(minAmount)) { extra += ' AND zi.total >= ?'; params.push(minAmount); }
        const [rows] = await pool.query(
            `SELECT zi.zoho_invoice_id, zi.invoice_number, zi.invoice_date, zi.customer_name,
                    zi.total, TRIM(zcm.zoho_gst_no) AS gstin
             FROM zoho_invoices zi
             JOIN zoho_customers_map zcm ON zcm.zoho_contact_id = zi.zoho_customer_id
             LEFT JOIN gst_filing_adjustments adj ON adj.zoho_invoice_id = zi.zoho_invoice_id
             WHERE zi.invoice_date < ? AND zi.invoice_date >= DATE_SUB(?, INTERVAL 6 MONTH)
               AND zi.status <> 'void'
               AND TRIM(COALESCE(zcm.zoho_gst_no, '')) <> ''
               AND adj.zoho_invoice_id IS NULL
               AND (zi.invoice_number LIKE ? OR zi.customer_name LIKE ?)${extra}
             ORDER BY zi.invoice_date DESC
             LIMIT 500`,
            params
        );
        res.json({ success: true, candidates: rows });
    } catch (err) {
        console.error('GST missed-b2b error:', err);
        res.status(400).json({ success: false, message: err.message });
    }
});
```

Changes vs original: builds a `params` array, appends optional `from_date`/`to_date`/`min_amount` clauses (all parameterized), and raises `LIMIT 100` → `LIMIT 500`.

- [ ] **Step 2: Verify suite + module load**

Run: `npm test -- tests/unit/gst-reports.test.js && node -e "require('./routes/gst-reports.js'); console.log('ok')"`
Expected: tests PASS and prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add routes/gst-reports.js
git commit -m "feat(gst): missed-b2b date/amount range filters + higher limit for bulk carry"
```

---

## Task 4: Export menu + Overall export (frontend)

**Files:**
- Modify: `public/admin-gst-reports.html`

- [ ] **Step 1: Replace the Invoices CSV button with an Export menu**

At line 169, replace:

```html
            <button class="btn" onclick="exportB2B()">⬇ Invoices CSV</button>
```

with:

```html
            <select onchange="runB2BExport(this.value); this.selectedIndex=0" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px">
                <option value="">⬇ Export ▾</option>
                <option value="overall">Overall (full list)</option>
                <option value="customerwise">Customer-wise (grouped)</option>
                <option value="hsn">Customer invoice-wise + HSN</option>
            </select>
```

- [ ] **Step 2: Replace the old `exportB2B` function with the menu dispatcher, merge helper, and Overall builder**

Replace the whole `exportB2B` function (lines 206-212):

```js
function exportB2B() {
    const d = cache.filing;
    const suffix = b2bCustomerFilter ? '-' + b2bCustomerFilter.replace(/[^\w]+/g, '_').slice(0, 30) : '';
    csvDownload(`gst-filing-b2b-${d.month}${suffix}.csv`,
        ['Invoice Date', 'Invoice Number', 'Customer', 'GSTIN', 'Taxable Value', 'GST', 'Total'],
        filteredB2B().map(i => [String(i.invoice_date).slice(0, 10), i.invoice_number, i.customer_name, i.gstin, i.sub_total, i.tax_total, i.total]));
}
```

with:

```js
function runB2BExport(kind) {
    if (kind === 'overall') exportB2BOverall();
    else if (kind === 'customerwise') exportB2BCustomerwise();
    else if (kind === 'hsn') exportB2BCustomerHSN();
}

// Natural-month B2B + carried-forward B2B, each tagged with carried_from.
function b2bMerged() {
    const d = cache.filing;
    const natural = (d.b2b || []).map(i => ({ ...i, carried_from: '' }));
    const carried = (d.carried || []).map(i => ({ ...i, carried_from: i.original_month }));
    return [...natural, ...carried];
}

const B2B_EXPORT_HEAD = ['Carried From', 'Invoice Date', 'Invoice Number', 'Customer', 'GSTIN', 'Taxable', 'GST', 'Total'];
const b2bRow = i => [i.carried_from, String(i.invoice_date).slice(0, 10), i.invoice_number, i.customer_name, i.gstin, i.sub_total, i.tax_total, i.total];

function exportB2BOverall() {
    const d = cache.filing;
    const rows = b2bMerged();
    const t = rows.reduce((a, i) => ({ s: a.s + (+i.sub_total || 0), g: a.g + (+i.tax_total || 0), t: a.t + (+i.total || 0) }), { s: 0, g: 0, t: 0 });
    csvDownload(`gst-filing-b2b-overall-${d.month}.csv`, B2B_EXPORT_HEAD,
        [...rows.map(b2bRow), ['', '', '', '', 'TOTAL', t.s, t.g, t.t]]);
}
```

- [ ] **Step 3: Manually verify Overall export in the browser**

Run: `npm start`, open `http://localhost:3000/admin-gst-reports.html`, pick a month that has carried-forward invoices, choose **Export ▾ → Overall (full list)**.
Expected: a `gst-filing-b2b-overall-<month>.csv` downloads; carried-forward rows show their original month in the `Carried From` column; final row is a `TOTAL` line.

- [ ] **Step 4: Commit**

```bash
git add public/admin-gst-reports.html
git commit -m "feat(gst): B2B Export menu + Overall export incl. carried-forward"
```

---

## Task 5: Customer-wise export (frontend)

**Files:**
- Modify: `public/admin-gst-reports.html`

- [ ] **Step 1: Add the customer-wise builder**

Insert after `exportB2BOverall` (from Task 4):

```js
function exportB2BCustomerwise() {
    const d = cache.filing;
    const rows = b2bMerged().slice().sort((a, b) =>
        (a.customer_name || '').localeCompare(b.customer_name || '') ||
        String(a.invoice_date).localeCompare(String(b.invoice_date)));
    const out = [];
    let cur = null, sub = { s: 0, g: 0, t: 0 };
    const grand = { s: 0, g: 0, t: 0 };
    const flushSub = () => { if (cur !== null) out.push(['', '', '', cur + ' — subtotal', '', sub.s, sub.g, sub.t]); };
    for (const i of rows) {
        if (i.customer_name !== cur) { flushSub(); cur = i.customer_name; sub = { s: 0, g: 0, t: 0 }; }
        out.push(b2bRow(i));
        sub.s += +i.sub_total || 0; sub.g += +i.tax_total || 0; sub.t += +i.total || 0;
        grand.s += +i.sub_total || 0; grand.g += +i.tax_total || 0; grand.t += +i.total || 0;
    }
    flushSub();
    out.push(['', '', '', 'GRAND TOTAL', '', grand.s, grand.g, grand.t]);
    csvDownload(`gst-filing-b2b-customerwise-${d.month}.csv`, B2B_EXPORT_HEAD, out);
}
```

- [ ] **Step 2: Manually verify in the browser**

Run: `npm start`, open the page, choose **Export ▾ → Customer-wise (grouped)**.
Expected: `gst-filing-b2b-customerwise-<month>.csv` downloads; invoices grouped by customer, each group followed by a `… — subtotal` row, a `GRAND TOTAL` row at the end; carried rows included with their `Carried From` month.

- [ ] **Step 3: Commit**

```bash
git add public/admin-gst-reports.html
git commit -m "feat(gst): B2B customer-wise grouped export incl. carried-forward"
```

---

## Task 6: Customer invoice-wise + HSN export (frontend)

**Files:**
- Modify: `public/admin-gst-reports.html`

- [ ] **Step 1: Add the HSN builder (fetches item-level data unfiltered)**

Insert after `exportB2BCustomerwise` (from Task 5):

```js
async function exportB2BCustomerHSN() {
    const month = document.getElementById('month').value;
    const box = document.getElementById('b2bItems');
    box.innerHTML = '<div class="muted" style="padding:14px">Item-wise + HSN ஏற்றுகிறது… (முதல்முறை Zoho-ல இருந்து வரும் — நிமிடம் ஆகலாம்)</div>';
    let d;
    try {
        d = await api('/api/gst-reports/b2b-items?month=' + month); // no customer filter → all customers
    } catch (e) { box.innerHTML = '<div class="banner-warn">' + escHtml(e.message) + '</div>'; return; }
    box.innerHTML = '';
    const invs = (d.invoices || []).slice().sort((a, b) =>
        (a.customer_name || '').localeCompare(b.customer_name || '') ||
        String(a.invoice_date).localeCompare(String(b.invoice_date)));
    const rows = [];
    for (const inv of invs) for (const it of (inv.items || [])) {
        rows.push([inv.carried_from || '', inv.customer_name, inv.gstin, String(inv.invoice_date).slice(0, 10),
            inv.invoice_number, it.name, it.hsn, it.quantity, it.rate, it.item_total]);
    }
    csvDownload(`gst-filing-b2b-customer-invoice-hsn-${d.month}.csv`,
        ['Carried From', 'Customer', 'GSTIN', 'Invoice Date', 'Invoice Number', 'Item', 'HSN', 'Qty', 'Rate', 'Amount'],
        rows);
}
```

- [ ] **Step 2: Manually verify in the browser**

Run: `npm start`, open the page, choose **Export ▾ → Customer invoice-wise + HSN**.
Expected: a loading note appears in the B2B-items area, then `gst-filing-b2b-customer-invoice-hsn-<month>.csv` downloads; rows ordered customer → invoice → item, with HSN per line and carried invoices flagged in `Carried From`.

- [ ] **Step 3: Commit**

```bash
git add public/admin-gst-reports.html
git commit -m "feat(gst): B2B customer-invoice-wise + HSN export incl. carried-forward"
```

---

## Task 7: Bulk carry-forward UI (Missed-invoice panel)

**Files:**
- Modify: `public/admin-gst-reports.html` (`toggleMissedPanel` lines 248-259, `renderMissed` lines 264-272; add helpers)

- [ ] **Step 1: Add filter inputs + bulk controls to the panel**

Replace the `p.innerHTML = …` block inside `toggleMissedPanel` (lines 252-257):

```js
    p.innerHTML = `
        <div style="background:#fffbeb;border:1px solid #f59e0b;border-radius:10px;padding:12px;margin-bottom:12px">
            <div style="font-weight:700;margin-bottom:8px">முந்தைய மாதங்களில் filing-ல் விடுபட்ட B2B invoice-ஐ இந்த மாதக் கணக்கில் சேர்க்க</div>
            <input class="searchbox" id="missedSearch" placeholder="Invoice # / customer search…" oninput="debounceMissed()">
            <div id="missedList" class="muted">கடந்த 6 மாத B2B invoices (carry ஆகாதவை) தேடுங்க…</div>
        </div>`;
```

with:

```js
    const month = document.getElementById('month').value;
    p.innerHTML = `
        <div style="background:#fffbeb;border:1px solid #f59e0b;border-radius:10px;padding:12px;margin-bottom:12px">
            <div style="font-weight:700;margin-bottom:8px">முந்தைய மாதங்களில் filing-ல் விடுபட்ட B2B invoice-ஐ இந்த மாதக் கணக்கில் சேர்க்க</div>
            <input class="searchbox" id="missedSearch" placeholder="Invoice # / customer search…" oninput="debounceMissed()">
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">
                <label style="font-size:12px">From <input type="date" id="missedFrom" onchange="renderMissed(missedSearchVal())"></label>
                <label style="font-size:12px">To <input type="date" id="missedTo" onchange="renderMissed(missedSearchVal())"></label>
                <label style="font-size:12px">Min ₹ <input type="number" id="missedMin" style="width:90px" onchange="renderMissed(missedSearchVal())"></label>
            </div>
            <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
                <label style="font-size:13px"><input type="checkbox" id="missedSelectAll" onchange="toggleSelectAllMissed(this.checked)"> Select all</label>
                <button class="btn" onclick="carrySelected()">Carry selected to ${escHtml(month)}</button>
            </div>
            <div id="missedList" class="muted">கடந்த 6 மாத B2B invoices (carry ஆகாதவை) தேடுங்க…</div>
        </div>`;
```

- [ ] **Step 2: Rewrite `renderMissed` to send filters and render checkboxes**

Replace `renderMissed` (lines 264-272):

```js
async function renderMissed(search) {
    const month = document.getElementById('month').value;
    const fd = (document.getElementById('missedFrom') || {}).value || '';
    const td = (document.getElementById('missedTo') || {}).value || '';
    const ma = (document.getElementById('missedMin') || {}).value || '';
    const q = '/api/gst-reports/missed-b2b?month=' + month + '&search=' + encodeURIComponent(search)
        + (fd ? '&from_date=' + fd : '') + (td ? '&to_date=' + td : '') + (ma ? '&min_amount=' + encodeURIComponent(ma) : '');
    const d = await api(q);
    const sa = document.getElementById('missedSelectAll'); if (sa) sa.checked = false;
    document.getElementById('missedList').innerHTML = d.candidates.length ? `
        <div class="tbl-scroll"><table class="m-cards"><thead><tr><th></th><th>Date</th><th>Invoice #</th><th>Customer</th><th>GSTIN</th><th class="num">Total</th><th></th></tr></thead><tbody>
        ${d.candidates.map(c => `<tr><td><input type="checkbox" class="missedChk" value="${escAttr(c.zoho_invoice_id)}"></td><td data-l="Date">${escHtml(String(c.invoice_date).slice(0, 10))}</td><td data-l="Invoice #"><b>${escHtml(c.invoice_number)}</b></td><td data-l="Customer">${escHtml(c.customer_name)}</td><td data-l="GSTIN">${escHtml(c.gstin)}</td><td class="num" data-l="Total">${fmtINR(c.total)}</td>
            <td><button class="btn" onclick="addCarry('${escJS(c.zoho_invoice_id)}')">Include in ${escHtml(month)}</button></td></tr>`).join('')}
        </tbody></table></div>` : '<div class="muted">Match இல்லை (carry ஆனவை இங்கு வராது)</div>';
}

function missedSearchVal() { return (document.getElementById('missedSearch') || {}).value || ''; }
function toggleSelectAllMissed(on) { document.querySelectorAll('.missedChk').forEach(c => { c.checked = on; }); }

async function carrySelected() {
    const month = document.getElementById('month').value;
    const ids = [...document.querySelectorAll('.missedChk:checked')].map(c => c.value);
    if (!ids.length) { alert('Invoice தேர்ந்தெடுக்கவில்லை'); return; }
    const res = await fetch('/api/gst-reports/carry-forward/bulk', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ zoho_invoice_ids: ids, filed_in_month: month }),
    });
    const d = await res.json();
    if (!d.success) { alert(d.message || 'Failed'); return; }
    alert(`${d.carried} invoice(s) carried to ${month}` + (d.skipped && d.skipped.length ? `, ${d.skipped.length} skipped` : ''));
    loadActive();
}
```

Note: `escAttr`, `escJS`, `escHtml`, `fmtINR`, `api`, `token`, `loadActive`, `debounceMissed` all already exist in this file.

- [ ] **Step 3: Manually verify in the browser**

Run: `npm start`, open the page, click **➕ Missed invoice**. Set a From/To date and/or Min ₹, confirm the list filters. Tick **Select all** (or individual rows), click **Carry selected to <month>**.
Expected: an alert reports how many were carried (and any skipped); the panel reloads via `loadActive()` and the carried invoices now appear in the "⤵ Carried forward into <month>" section.

- [ ] **Step 4: Commit**

```bash
git add public/admin-gst-reports.html
git commit -m "feat(gst): bulk carry-forward — checkboxes + date/amount filters + Carry selected"
```

---

## Task 8: Full suite + lint green

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`
Expected: all tests PASS (the new `planBulkCarry` block plus the existing suite).

- [ ] **Step 2: Lint the changed files**

Run: `npm run lint`
Expected: no new errors in `routes/gst-reports.js` or `public/admin-gst-reports.html`. Fix any introduced.

- [ ] **Step 3: Final commit if lint produced fixes**

```bash
git add -A
git commit -m "chore(gst): lint fixes for carried-forward exports + bulk carry"
```

---

## Self-Review

**Spec coverage:**
- A1 Overall export → Task 4 ✓
- A2 Customer-wise export → Task 5 ✓
- A3 Customer invoice-wise + HSN → Task 6 ✓
- B1 `/missed-b2b` range filters → Task 3 ✓; `POST /carry-forward/bulk` → Task 2 ✓ (helper Task 1)
- B2 Missed-panel filters + checkboxes + bulk button → Task 7 ✓
- C Do-not-change (filing/cost boundary, later-month rule, deriveTax) → preserved; `planBulkCarry` reuses the exact later-month rule; exports read filing actuals only ✓
- Tests → Task 1 (helper) + Task 8 (full suite) ✓

**Type consistency:** `planBulkCarry(requestedIds, invoiceRows, filedInMonth)` returns `{ valid:[{zoho_invoice_id, original_month, invoice_number}], skipped:[{id, reason}] }` — consumed identically in Task 2 (`valid.map`, `carried: valid.length`, `skipped`). Frontend `b2bMerged()`/`b2bRow`/`B2B_EXPORT_HEAD` defined in Task 4 and reused in Task 5. `missedSearchVal`/`toggleSelectAllMissed`/`carrySelected` defined in Task 7 and referenced by the panel HTML in Task 7. No mismatches.

**Placeholder scan:** none — every code step is complete.
