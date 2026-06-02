# Share estimate/PO PDF via phone WhatsApp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Share PDF" option that shares an estimate/PO PDF through the phone's own WhatsApp app (Web Share API), with a download + `wa.me` fallback, across the estimate view, estimates list, purchase-order, and customer view surfaces.

**Architecture:** A self-contained client helper `public/js/share-pdf.js` fetches a PDF blob and calls `navigator.share({files})`, falling back to download + `wa.me`. Staff surfaces reuse the existing `/api/estimates/:id/pdf` endpoint; a new customer-scoped `GET /api/estimates/customer/:id/pdf` reuses the PDFKit `generateEstimatePDF` generator. A shared `getBranding(pool)` is extracted to `services/branding.js`, and phone-ownership matching to `services/phone-match.js`.

**Tech Stack:** Node/Express (CommonJS), mysql2 pool (`setPool` injection), Jest (pure-function/module tests, no supertest), vanilla browser JS, PDFKit (`estimate-pdf-generator.js`).

**Spec:** `docs/superpowers/specs/2026-06-02-share-pdf-phone-whatsapp-design.md`

---

## File Structure

- **New** `services/branding.js` — `async getBranding(pool)` reading branding from `settings`. One responsibility: branding lookup.
- **New** `services/phone-match.js` — `samePhone(a, b)` last-10-digit phone equality. One responsibility: phone identity check.
- **New** `public/js/share-pdf.js` — `window.qcSharePdf(opts)` Web-Share-with-fallback helper. One responsibility: turn a PDF URL into a phone-WhatsApp share.
- **Modify** `routes/share.js` — use `services/branding.js` instead of its private `getBranding`.
- **Modify** `routes/estimates.js` — import the two new services; add `GET /customer/:id/pdf`; refactor existing `GET /customer/:id` to use `samePhone`.
- **Modify** `public/estimate-view.html` — Share-PDF button in action bar + PO actions modal + handlers + script include.
- **Modify** `public/estimates.html` + `public/estimates.js` — Share-PDF action in the actions menu.
- **Modify** `public/customer-estimate-view.html` — Share button + handler + script include.
- **New tests** `tests/unit/branding.test.js`, `tests/unit/phone-match.test.js`, `tests/unit/estimates-customer-pdf-route.test.js`.

---

## Task 1: Extract `getBranding` to `services/branding.js`

**Files:**
- Create: `services/branding.js`
- Test: `tests/unit/branding.test.js`
- Modify: `routes/share.js:19-28` (remove private fn), `routes/share.js` (require + call sites)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/branding.test.js`:

```javascript
const { getBranding } = require('../../services/branding');

describe('getBranding', () => {
    test('maps settings rows into an object', async () => {
        const pool = {
            query: async () => [[
                { setting_key: 'business_name', setting_value: 'Quality Colours' },
                { setting_key: 'business_phone', setting_value: '7418831122' }
            ]]
        };
        const out = await getBranding(pool);
        expect(out.business_name).toBe('Quality Colours');
        expect(out.business_phone).toBe('7418831122');
    });

    test('returns {} when the query throws', async () => {
        const pool = { query: async () => { throw new Error('db down'); } };
        await expect(getBranding(pool)).resolves.toEqual({});
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/branding.test.js`
Expected: FAIL — `Cannot find module '../../services/branding'`.

- [ ] **Step 3: Create `services/branding.js`**

```javascript
/**
 * branding.js — shared business-branding lookup.
 * Reads branding fields from the `settings` table. Depends only on a mysql2 pool.
 */
async function getBranding(pool) {
    try {
        const [settings] = await pool.query(
            "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('business_name','business_logo','business_phone','business_email','business_address','business_gst')"
        );
        const obj = {};
        settings.forEach(s => { obj[s.setting_key] = s.setting_value; });
        return obj;
    } catch {
        return {};
    }
}

module.exports = { getBranding };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/branding.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Use the shared helper in `routes/share.js`**

In `routes/share.js`, delete the private `getBranding` function (the block at lines 19-28 starting `async function getBranding() {` through its closing `}`), and add this require near the top of the file (just after the existing `const ... = require(...)` lines):

```javascript
const { getBranding } = require('../services/branding');
```

Then update the call site inside `GET /public/:token/pdf` — change `const branding = await getBranding();` to:

```javascript
const branding = await getBranding(pool);
```

(There is one call site, at the line `const branding = await getBranding();`.)

- [ ] **Step 6: Verify share.js still loads + tests pass**

Run: `node --check routes/share.js && node -e "require('./routes/share.js'); console.log('share OK')" && npx jest tests/unit/branding.test.js`
Expected: `share OK` and PASS.

- [ ] **Step 7: Commit**

```bash
git add services/branding.js tests/unit/branding.test.js routes/share.js
git commit -m "refactor(branding): extract getBranding to services/branding.js"
```

---

## Task 2: Add `services/phone-match.js` + use it in the existing customer route

**Files:**
- Create: `services/phone-match.js`
- Test: `tests/unit/phone-match.test.js`
- Modify: `routes/estimates.js` (import + refactor `GET /customer/:id` ownership check)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/phone-match.test.js`:

```javascript
const { samePhone } = require('../../services/phone-match');

describe('samePhone', () => {
    test('matches identical 10-digit numbers', () => {
        expect(samePhone('9876543210', '9876543210')).toBe(true);
    });
    test('ignores country code and formatting', () => {
        expect(samePhone('+91 98765 43210', '9876543210')).toBe(true);
        expect(samePhone('919876543210', '9876543210')).toBe(true);
    });
    test('rejects different numbers', () => {
        expect(samePhone('9876543210', '9999999999')).toBe(false);
    });
    test('rejects when either side is empty/short (security default)', () => {
        expect(samePhone('', '9876543210')).toBe(false);
        expect(samePhone(null, null)).toBe(false);
        expect(samePhone('12345', '12345')).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/phone-match.test.js`
Expected: FAIL — `Cannot find module '../../services/phone-match'`.

- [ ] **Step 3: Create `services/phone-match.js`**

```javascript
/**
 * phone-match.js — phone identity check by last-10 digits.
 * Returns true only when both inputs normalise to the SAME full 10-digit number,
 * so empty/partial values never match (secure default for ownership checks).
 */
function normalize(p) {
    return String(p == null ? '' : p).replace(/\D/g, '').slice(-10);
}

function samePhone(a, b) {
    const na = normalize(a);
    const nb = normalize(b);
    return na.length === 10 && na === nb;
}

module.exports = { samePhone, normalize };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/phone-match.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Use `samePhone` in the existing customer route**

In `routes/estimates.js`, add this require near the other requires at the top (after `const { requireCustomerAuth } = require('../middleware/customerAuth');`):

```javascript
const { samePhone } = require('../services/phone-match');
const { getBranding } = require('../services/branding');
```

Then in the existing `router.get('/customer/:id', requireCustomerAuth, ...)` handler, replace this block:

```javascript
        // Ownership check: the estimate's customer phone must match the session phone.
        const norm = (p) => String(p || '').replace(/\D/g, '').slice(-10);
        if (!req.customer || norm(estimate[0].customer_phone) !== norm(req.customer.phone)) {
            return res.status(403).json({ error: 'Not authorized for this estimate' });
        }
```

with:

```javascript
        // Ownership check: the estimate's customer phone must match the session phone.
        if (!req.customer || !samePhone(estimate[0].customer_phone, req.customer.phone)) {
            return res.status(403).json({ error: 'Not authorized for this estimate' });
        }
```

- [ ] **Step 6: Verify estimates.js loads + tests pass**

Run: `node --check routes/estimates.js && node -e "require('./routes/estimates.js'); console.log('estimates OK')" && npx jest tests/unit/phone-match.test.js tests/unit/estimate-search.test.js`
Expected: `estimates OK` and all PASS.

- [ ] **Step 7: Commit**

```bash
git add services/phone-match.js tests/unit/phone-match.test.js routes/estimates.js
git commit -m "refactor(estimates): extract samePhone ownership check to services/phone-match.js"
```

---

## Task 3: Add `GET /api/estimates/customer/:id/pdf`

**Files:**
- Modify: `routes/estimates.js` (add route directly after the existing `GET /customer/:id`)
- Test: `tests/unit/estimates-customer-pdf-route.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/estimates-customer-pdf-route.test.js`:

```javascript
const { router } = require('../../routes/estimates');

describe('customer estimate PDF route', () => {
    test('GET /customer/:id/pdf is registered', () => {
        const layer = router.stack.find(
            l => l.route && l.route.path === '/customer/:id/pdf' && l.route.methods.get
        );
        expect(layer).toBeTruthy();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/estimates-customer-pdf-route.test.js`
Expected: FAIL — `expect(received).toBeTruthy()` received `undefined` (route not yet defined).

- [ ] **Step 3: Add the route**

In `routes/estimates.js`, locate the END of the existing `router.get('/customer/:id', requireCustomerAuth, async (req, res) => { ... });` handler. Immediately after its closing `});`, insert:

```javascript
// ========================================
// GET ESTIMATE PDF FOR AUTHENTICATED CUSTOMER (phone-scoped)
// Reuses the PDFKit generator (same as the public share PDF) so customers can
// fetch/share their own estimate PDF without a staff token.
// ========================================
router.get('/customer/:id/pdf', requireCustomerAuth, async (req, res) => {
    try {
        const [estimates] = await pool.query('SELECT * FROM estimates WHERE id = ?', [req.params.id]);
        if (!estimates.length) return res.status(404).json({ error: 'Estimate not found' });
        const estimate = estimates[0];
        if (!req.customer || !samePhone(estimate.customer_phone, req.customer.phone)) {
            return res.status(403).json({ error: 'Not authorized for this estimate' });
        }

        const [items] = await pool.query(
            `SELECT ei.*, p.name as product_name FROM estimate_items ei
             LEFT JOIN products p ON ei.product_id = p.id
             WHERE ei.estimate_id = ? AND ei.deleted_at IS NULL ORDER BY ei.display_order`,
            [req.params.id]
        );

        const branding = await getBranding(pool);

        let colVis = { show_qty: true, show_mix: true, show_price: true, show_breakdown: true, show_color: true, show_total: true };
        if (estimate.column_visibility) {
            try { colVis = { ...colVis, ...JSON.parse(estimate.column_visibility) }; } catch (e) {}
        }

        const { generateEstimatePDF } = require('./estimate-pdf-generator');
        generateEstimatePDF(res, estimate, items, branding, colVis);
    } catch (err) {
        console.error('Customer estimate PDF error:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to generate PDF' });
    }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/estimates-customer-pdf-route.test.js`
Expected: PASS.

- [ ] **Step 5: Verify module loads + estimate suite**

Run: `node --check routes/estimates.js && node -e "require('./routes/estimates.js'); console.log('estimates OK')" && npx jest tests/unit/estimate-search.test.js tests/unit/estimates-customer-pdf-route.test.js`
Expected: `estimates OK` and PASS.

- [ ] **Step 6: Commit**

```bash
git add routes/estimates.js tests/unit/estimates-customer-pdf-route.test.js
git commit -m "feat(estimates): customer-scoped estimate PDF endpoint"
```

---

## Task 4: Create the client helper `public/js/share-pdf.js`

**Files:**
- Create: `public/js/share-pdf.js`

- [ ] **Step 1: Create the helper**

```javascript
/**
 * share-pdf.js
 * Share a PDF (estimate / PO) via the phone's own WhatsApp using the Web Share API.
 * Falls back to downloading the PDF + opening a wa.me text link when file-share
 * is unsupported (desktop browsers, old WebViews).
 *
 *   qcSharePdf({
 *     pdfUrl,          // string  — URL to fetch the PDF from
 *     headers,         // object  — request headers (e.g. Authorization); optional
 *     filename,        // string  — download/share filename
 *     shareTitle,      // string  — share-sheet title
 *     shareText,       // string  — message body
 *     getFallbackUrl   // async fn -> string (optional; called ONLY on fallback)
 *   })
 */
(function () {
    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }

    function notifyError(msg) {
        if (window.qcToast) { try { window.qcToast(msg, 'error'); return; } catch (e) {} }
        alert(msg);
    }

    window.qcSharePdf = async function (opts) {
        opts = opts || {};
        const filename = opts.filename || 'document.pdf';
        const shareTitle = opts.shareTitle || 'Quality Colours';
        const shareText = opts.shareText || '';

        let blob;
        try {
            const resp = await fetch(opts.pdfUrl, { headers: opts.headers || {} });
            if (!resp.ok) throw new Error('PDF fetch failed: ' + resp.status);
            blob = await resp.blob();
        } catch (e) {
            console.error('qcSharePdf fetch error:', e);
            notifyError('Could not load the PDF. Please try again.');
            return;
        }

        const file = new File([blob], filename, { type: 'application/pdf' });

        if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: shareTitle, text: shareText });
                return;
            } catch (e) {
                if (e && e.name === 'AbortError') return; // user cancelled — do nothing
                console.warn('navigator.share failed, falling back:', e);
            }
        }

        // Fallback: download the PDF and open a wa.me text/link
        downloadBlob(blob, filename);
        let waUrl = null;
        if (typeof opts.getFallbackUrl === 'function') {
            try { waUrl = await opts.getFallbackUrl(); } catch (e) { /* ignore */ }
        }
        if (!waUrl) waUrl = 'https://wa.me/?text=' + encodeURIComponent(shareText);
        window.open(waUrl, '_blank');
    };
})();
```

- [ ] **Step 2: Verify syntax**

Run: `node --check public/js/share-pdf.js && echo "share-pdf OK"`
Expected: `share-pdf OK`.

- [ ] **Step 3: Commit**

```bash
git add public/js/share-pdf.js
git commit -m "feat(share): add qcSharePdf Web-Share helper with wa.me fallback"
```

---

## Task 5: Wire Share-PDF into `estimate-view.html` (estimate + PO)

**Files:**
- Modify: `public/estimate-view.html` (script include, action-bar button, PO modal button, handlers)

- [ ] **Step 1: Add the script include**

After `routes/...` — in `public/estimate-view.html`, after the line `<script src="/js/auth-helper.js"></script>` (line 13), add:

```html
    <script src="/js/share-pdf.js"></script>
```

- [ ] **Step 2: Add the action-bar button**

In `public/estimate-view.html`, replace this block (the WhatsApp + PDF buttons in the action bar):

```html
                <button onclick="shareViaWhatsApp()" class="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 text-sm" title="Share via WhatsApp">
                    📱 WhatsApp
                </button>
                <button onclick="downloadPDF()" class="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 text-sm" title="Download PDF">
                    📄 PDF
                </button>
```

with:

```html
                <button onclick="shareViaWhatsApp()" class="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 text-sm" title="Share via WhatsApp">
                    📱 WhatsApp
                </button>
                <button onclick="sharePdfPhone()" class="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 text-sm" title="Share PDF via phone WhatsApp">
                    📲 Share PDF
                </button>
                <button onclick="downloadPDF()" class="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 text-sm" title="Download PDF">
                    📄 PDF
                </button>
```

- [ ] **Step 3: Add the PO actions-modal button**

In `public/estimate-view.html`, replace this PO-modal button:

```html
                <button onclick="poActionResend()" class="w-full bg-green-600 text-white py-3 rounded-xl text-sm font-semibold hover:bg-green-700 flex items-center justify-center gap-2">
                    📱 Resend via WhatsApp
```

with (add the Share button right before Resend):

```html
                <button onclick="poActionSharePdf()" class="w-full bg-emerald-600 text-white py-3 rounded-xl text-sm font-semibold hover:bg-emerald-700 flex items-center justify-center gap-2">
                    📲 Share PO PDF
                </button>
                <button onclick="poActionResend()" class="w-full bg-green-600 text-white py-3 rounded-xl text-sm font-semibold hover:bg-green-700 flex items-center justify-center gap-2">
                    📱 Resend via WhatsApp
```

- [ ] **Step 4: Add the handler functions**

In `public/estimate-view.html`, immediately AFTER the existing `shareViaWhatsApp()` function (after its closing `}` near line 440), add:

```javascript
        async function sharePdfPhone() {
            const token = localStorage.getItem('auth_token');
            const num = (estimateData && estimateData.estimate_number) ? estimateData.estimate_number : estimateId;
            qcSharePdf({
                pdfUrl: '/api/estimates/' + estimateId + '/pdf',
                headers: { 'Authorization': 'Bearer ' + token },
                filename: 'Estimate-' + num + '.pdf',
                shareTitle: 'Estimate ' + num,
                shareText: 'Estimate ' + num + ' from Quality Colours',
                getFallbackUrl: async function () {
                    try {
                        const r = await apiRequest('/api/share/whatsapp', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ resource_type: 'estimate', resource_id: estimateId })
                        });
                        const res = await r.json();
                        if (res.success && res.data && res.data.whatsapp_url) return res.data.whatsapp_url;
                    } catch (e) { /* ignore */ }
                    return null;
                }
            });
        }

        function poActionSharePdf() {
            closePoActionsModal();
            const po = existingPO;
            if (!po) return;
            const token = localStorage.getItem('auth_token');
            qcSharePdf({
                pdfUrl: '/api/estimates/' + estimateId + '/pdf?po=' + encodeURIComponent(po.po_number) + '&hide_payment=1',
                headers: { 'Authorization': 'Bearer ' + token },
                filename: 'PO-' + po.po_number + '.pdf',
                shareTitle: 'PO ' + po.po_number,
                shareText: 'Purchase Order ' + po.po_number + ' from Quality Colours'
            });
        }
```

- [ ] **Step 5: Verify the inline script still parses**

Run:
```bash
node -e 'const fs=require("fs");const h=fs.readFileSync("public/estimate-view.html","utf8");const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;let m,i=0;while((m=re.exec(h))){i++;new Function(m[1]);}console.log(i+" inline scripts OK");'
```
Expected: `N inline scripts OK` (no syntax error thrown).

- [ ] **Step 6: Commit**

```bash
git add public/estimate-view.html
git commit -m "feat(estimate-view): share estimate/PO PDF via phone WhatsApp"
```

---

## Task 6: Wire Share-PDF into the estimates list (`estimates.html` + `estimates.js`)

**Files:**
- Modify: `public/estimates.html` (script include — already adds `idempotency-fetch.js`; add `share-pdf.js`)
- Modify: `public/estimates.js` (`showActions` array, `handleAction` switch, new `sharePdf` function)

- [ ] **Step 1: Add the script include**

In `public/estimates.html`, replace:

```html
    <script src="/js/idempotency-fetch.js"></script>
    <script src="estimates.js"></script>
```

with:

```html
    <script src="/js/idempotency-fetch.js"></script>
    <script src="/js/share-pdf.js"></script>
    <script src="estimates.js"></script>
```

- [ ] **Step 2: Add the action to the actions menu**

In `public/estimates.js`, in `showActions()`, replace this array entry:

```javascript
        { label: '📄 Download PDF', action: 'downloadPDF' },
```

with:

```javascript
        { label: '📄 Download PDF', action: 'downloadPDF' },
        { label: '📲 Share PDF', action: 'sharePdf' },
```

- [ ] **Step 3: Add the switch case**

In `public/estimates.js`, in `handleAction()`, replace:

```javascript
        case 'downloadPDF':
            downloadPDF(id);
            break;
```

with:

```javascript
        case 'downloadPDF':
            downloadPDF(id);
            break;
        case 'sharePdf':
            sharePdf(id);
            break;
```

- [ ] **Step 4: Add the `sharePdf` function**

In `public/estimates.js`, immediately AFTER the existing `downloadPDF(id)` function (after its closing `}`), add:

```javascript
function sharePdf(id) {
    const token = localStorage.getItem('auth_token');
    const est = allEstimates.find(e => e.id == id);
    const num = est && est.estimate_number ? est.estimate_number : id;
    qcSharePdf({
        pdfUrl: `/api/estimates/${id}/pdf`,
        headers: { 'Authorization': `Bearer ${token}` },
        filename: `Estimate-${num}.pdf`,
        shareTitle: `Estimate ${num}`,
        shareText: `Estimate ${num} from Quality Colours`,
        getFallbackUrl: async function () {
            try {
                const r = await fetch('/api/share/whatsapp', {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ resource_type: 'estimate', resource_id: id })
                });
                const res = await r.json();
                if (res.success && res.data && res.data.whatsapp_url) return res.data.whatsapp_url;
            } catch (e) { /* ignore */ }
            return null;
        }
    });
}
```

- [ ] **Step 5: Verify syntax**

Run: `node --check public/estimates.js && echo "estimates.js OK"`
Expected: `estimates.js OK`.

- [ ] **Step 6: Commit**

```bash
git add public/estimates.html public/estimates.js
git commit -m "feat(estimates-list): share estimate PDF via phone WhatsApp action"
```

---

## Task 7: Wire Share-PDF into `customer-estimate-view.html`

**Files:**
- Modify: `public/customer-estimate-view.html` (script include, Share button, handler)

- [ ] **Step 1: Add the script include**

In `public/customer-estimate-view.html`, the main inline script begins with:

```html
<script>
const params = new URLSearchParams(window.location.search);
```

Insert the include immediately before that `<script>` line:

```html
<script src="/js/share-pdf.js"></script>
<script>
const params = new URLSearchParams(window.location.search);
```

- [ ] **Step 2: Add the Share button next to the PDF button**

In `public/customer-estimate-view.html`, replace:

```html
                <button onclick="downloadCustomerPDF()" class="bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg text-sm font-medium transition">
                    PDF
                </button>
```

with:

```html
                <button onclick="shareCustomerPdf()" class="bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg text-sm font-medium transition">
                    📲 Share
                </button>
                <button onclick="downloadCustomerPDF()" class="bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg text-sm font-medium transition">
                    PDF
                </button>
```

- [ ] **Step 3: Add the handler**

In `public/customer-estimate-view.html`, immediately AFTER the existing `downloadCustomerPDF()` function (after its closing `}`), add:

```javascript
function shareCustomerPdf() {
    const token = localStorage.getItem('customer_token');
    if (!token) { window.location.href = '/customer-login.html'; return; }
    const num = document.getElementById('estNumber').textContent || estimateId;
    qcSharePdf({
        pdfUrl: '/api/estimates/customer/' + estimateId + '/pdf',
        headers: { 'Authorization': 'Bearer ' + token },
        filename: 'Estimate-' + num + '.pdf',
        shareTitle: 'Estimate ' + num,
        shareText: 'Estimate ' + num + ' from Quality Colours'
    });
}
```

- [ ] **Step 4: Verify the inline script parses**

Run:
```bash
node -e 'const fs=require("fs");const h=fs.readFileSync("public/customer-estimate-view.html","utf8");const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;let m,i=0;while((m=re.exec(h))){i++;new Function(m[1]);}console.log(i+" inline scripts OK");'
```
Expected: `N inline scripts OK`.

- [ ] **Step 5: Commit**

```bash
git add public/customer-estimate-view.html
git commit -m "feat(customer-view): share own estimate PDF via phone WhatsApp"
```

---

## Task 8: Rebuild Tailwind CSS + full verification

> **Why:** these pages use the JIT-built `public/css/tailwind.css`. The new buttons use
> `hover:bg-emerald-700` (and similar) which are NOT in the current build (the color safelist
> covers the non-hover `bg-emerald-*` but not `hover:` variants). The content globs include
> `./public/**/*.html` and `./public/**/*.js`, so rebuilding compiles the new classes. The
> regenerated CSS must be committed so `git pull` deploys it (no server-side build).

- [ ] **Step 1: Rebuild the Tailwind CSS and commit it**

Run: `npm run build:css`
Expected: regenerates `public/css/tailwind.css` (minified) with no errors.

Then:
```bash
node -e "const fs=require('fs');const c=fs.readFileSync('public/css/tailwind.css','utf8');console.log('hover:bg-emerald-700 present:', c.includes('hover\\:bg-emerald-700'));"
```
Expected: `hover:bg-emerald-700 present: true`.

```bash
git add public/css/tailwind.css
git commit -m "build(css): rebuild tailwind with share-pdf button utilities"
```

- [ ] **Step 2: Lint/syntax + module loads + full estimate-related tests**

Run:
```bash
node --check routes/estimates.js && node --check routes/share.js && node --check public/estimates.js && node --check public/js/share-pdf.js
node -e "require('./routes/estimates.js'); require('./routes/share.js'); console.log('modules OK')"
npx jest tests/unit/branding.test.js tests/unit/phone-match.test.js tests/unit/estimates-customer-pdf-route.test.js tests/unit/estimate-search.test.js
```
Expected: all `OK` / PASS.

- [ ] **Step 3: Inline-script parse check for all three edited HTML pages**

Run:
```bash
node -e 'const fs=require("fs");for(const f of ["public/estimate-view.html","public/estimates.html","public/customer-estimate-view.html"].filter(x=>x.endsWith(".html"))){const h=fs.readFileSync(f,"utf8");const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;let m,i=0;while((m=re.exec(h))){i++;try{new Function(m[1])}catch(e){console.log(f+" ERROR: "+e.message)}}console.log(f+": "+i+" inline ok");}'
```
Expected: each file reports inline scripts OK, no ERROR lines.

- [ ] **Step 4: Manual test checklist (record results)**

  - Mobile browser/PWA: on estimate view, estimates list, PO modal, customer view → tap Share → OS share sheet shows WhatsApp → forwarding attaches the actual PDF.
  - Desktop: tap Share → PDF downloads AND a `wa.me` tab opens (fallback).
  - Customer view: a logged-in customer shares their own estimate; a different customer's id returns 403 (no PDF).
  - Regression: existing "📱 WhatsApp" text-link button and server-side send (receipt/PO) still work.

- [ ] **Step 5: Final commit (if any cleanup)**

```bash
git add -A
git commit -m "test: verify share-pdf feature wiring" --allow-empty
```

---

## Deployment

After merge to `master`:

```bash
git push origin master
ssh hetzner "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && npm install && pm2 restart business-manager"
```

Then smoke-test: `curl -s -o /dev/null -w "%{http_code}\n" https://act.qcpaintshop.com/api/estimates/customer/1/pdf` → expect **401** (customer auth required), confirming the route is live.
