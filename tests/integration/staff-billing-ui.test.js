/**
 * Characterization + contract test for public/staff-billing.html (staff Sales page).
 *
 * Two layers:
 *   1. "existing surface" — locks the page structure that Batch B1b must NOT
 *      disturb (tabs, panels, core functions, brand palette). Written BEFORE
 *      the New Sale tab was added, per CLAUDE.md §6 / orchestration.md
 *      guardrails (characterization before change).
 *   2. (extended in the same batch) "New Sale tab" + print templates contract.
 *
 * DOM-independent on purpose (no jsdom in this repo): plain-Node string
 * checks, mirroring tests/integration/staff-painter-marketing-ui.test.js.
 */

const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', '..', 'public');
const HTML_PATH = path.join(PUB, 'staff-billing.html');

describe('staff-billing page — existing surface (characterization)', () => {
    let html;

    beforeAll(() => {
        html = fs.readFileSync(HTML_PATH, 'utf8');
    });

    test('page exists with Sales title and staff auth gate', () => {
        expect(fs.existsSync(HTML_PATH)).toBe(true);
        expect(html).toContain('<title>Sales — QC Paint Shop</title>');
        expect(html).toContain('checkAuthOrRedirect();');
        expect(html).toContain('/js/auth-helper.js');
    });

    test('original four tabs and panels are intact', () => {
        for (const t of ['Customers', 'Estimates', 'Invoices', 'Payments']) {
            expect(html).toContain(`id="tab${t}"`);
            expect(html).toContain(`id="panel${t}"`);
        }
        for (const t of ['customers', 'estimates', 'invoices', 'payments']) {
            expect(html).toContain(`switchTab('${t}')`);
        }
    });

    test('core billing functions remain declared', () => {
        for (const fn of [
            'function switchTab',
            'function loadStats',
            'function loadEstimates',
            'function loadInvoices',
            'function loadPayments',
            'function viewInvoice',
            'function openPaymentModal',
            'function handlePaymentSubmit',
            'function pushToZoho',
            'function newIdemKey',
            'function formatCurrency',
            'function extractApiError',
            'function esc(',
        ]) {
            expect(html).toContain(fn);
        }
    });

    test('init loads stats on DOMContentLoaded', () => {
        expect(html).toContain("document.addEventListener('DOMContentLoaded'");
        expect(html).toContain('loadStats();');
    });

    test('idempotency helper uses crypto.randomUUID', () => {
        expect(html).toContain('crypto.randomUUID');
    });

    test('mutating billing calls send an Idempotency-Key header', () => {
        expect(html).toContain("'Idempotency-Key': newIdemKey()");
    });

    test('staff brand palette — QC green, no admin purple', () => {
        expect(html).toContain('#1B5E3B');
        expect(html.toLowerCase()).not.toContain('#667eea');
        expect(html.toLowerCase()).not.toContain('#764ba2');
    });

    test('suggestion/product search infra the New Sale tab reuses', () => {
        expect(html).toContain('suggestion-list');
        expect(html).toContain('qc-input');
        expect(html).toContain('/products?search=');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Batch B1b — New Sale tab + print pipeline contract
// ─────────────────────────────────────────────────────────────────────────────
describe('staff-billing page — New Sale tab (B1b)', () => {
    let html;

    beforeAll(() => {
        html = fs.readFileSync(HTML_PATH, 'utf8');
    });

    test('New Sale is the FIRST tab, with its own panel', () => {
        expect(html).toContain('id="tabQuicksale"');
        expect(html).toContain('id="panelQuicksale"');
        expect(html).toContain("switchTab('quicksale')");
        // first in the tab bar (before Customers)
        expect(html.indexOf('id="tabQuicksale"')).toBeLessThan(html.indexOf('id="tabCustomers"'));
        // switchTab knows the new tab
        expect(html).toContain("['quicksale', 'customers', 'estimates', 'invoices', 'payments']");
    });

    test('non-admin lands on quicksale; admins keep Customers', () => {
        expect(html).toContain("if (!creditCanManage()) { switchTab('quicksale'); return; }");
        expect(html).toContain('loadCreditCustomers(1);   // Customers is the first/landing tab');
    });

    test('billing-as header from /my-defaults with amber no-salesperson fallback', () => {
        expect(html).toContain('/my-defaults');
        expect(html).toContain('Salesperson set பண்ணல — bill Zoho-க்கு போகாது');
        expect(html).toContain('id="qsSalespersonSel"');
    });

    test('payment chips: Cash / UPI / Split / Credit with the credit note', () => {
        for (const m of ['cash', 'upi', 'split', 'credit']) {
            expect(html).toContain(`data-mode="${m}"`);
        }
        // owner-specified credit wording (full-credit sale)
        expect(html).toContain('முழு தொகை கடன் — customer credit limit-படி Zoho-க்கு போகும்');
        // credit sale sends payments:[] — never a 'credit' payment row
        expect(html).toContain("if (qsPayMode === 'credit') return [];");
        expect(html).not.toContain("payment_method: 'credit'");
    });

    test('split payment enforces sum ≤ total with 1-paisa tolerance', () => {
        expect(html).toContain('cash + upi > grand + 0.01');
    });

    test('stock badges: in-stock / low / out / grey em-dash for NULL (never 0)', () => {
        expect(html).toContain('In stock:');
        expect(html).toContain('Low:');
        expect(html).toContain('Out of stock');
        expect(html).toContain("raw === null || raw === undefined || raw === ''");
    });

    test('quick-sale POST carries a per-attempt-session Idempotency-Key', () => {
        expect(html).toContain('/quick-sale');
        expect(html).toContain("'Idempotency-Key': qsIdemKey");
        expect(html).toContain('if (!qsIdemKey) qsIdemKey = newIdemKey();');
    });

    test('save button shows in-flight state and opens print_url with autoprint', () => {
        expect(html).toContain("btn.textContent = 'Saving…'");
        expect(html).toContain("'autoprint=1'");
        expect(html).toContain('data.print_url');
    });

    test('zoho outcome toasts: approved / pending-retry / skip', () => {
        expect(html).toContain('approved');
        expect(html).toContain('Saved. Zoho pending — auto retry');
        expect(html).toContain("qcToast(msg, { variant })");
    });

    test('invoice detail modal gains Print Receipt + PDF (token-in-query)', () => {
        expect(html).toContain("/billing-receipt.html?id=${inv.id}");
        expect(html).toContain("/pdf?receipt=1&token=' + encodeURIComponent(token)");
    });
});

describe('print templates (B1b)', () => {
    const RECEIPT_HTML = path.join(PUB, 'billing-receipt.html');
    const INVOICE_HTML = path.join(PUB, 'billing-invoice-print.html');
    const RECEIPT_JS = path.join(PUB, 'js', 'pages', 'billing-receipt.js');
    const INVOICE_JS = path.join(PUB, 'js', 'pages', 'billing-invoice-print.js');
    let receiptHtml, invoiceHtml, receiptJs, invoiceJs;

    beforeAll(() => {
        receiptHtml = fs.readFileSync(RECEIPT_HTML, 'utf8');
        invoiceHtml = fs.readFileSync(INVOICE_HTML, 'utf8');
        receiptJs = fs.readFileSync(RECEIPT_JS, 'utf8');
        invoiceJs = fs.readFileSync(INVOICE_JS, 'utf8');
    });

    test('all four template files exist with their render roots', () => {
        expect(receiptHtml).toContain('id="receiptContent"');
        expect(invoiceHtml).toContain('id="printContent"');
        expect(receiptHtml).toContain('/js/pages/billing-receipt.js');
        expect(invoiceHtml).toContain('/js/pages/billing-invoice-print.js');
    });

    test('strict-CSP-ready: no inline scripts or on*= handlers in templates', () => {
        for (const doc of [receiptHtml, invoiceHtml]) {
            expect(doc).not.toMatch(/<script>[^<]/);          // no inline script bodies
            expect(doc).not.toMatch(/<[^>]+\son[a-z]+\s*=/i); // no inline handlers
        }
    });

    test('owner-locked GST wording: footer present, never "TAX INVOICE"', () => {
        const footer = 'All prices are inclusive of GST. This is not a GST tax invoice';
        expect(receiptHtml).toContain(footer);
        expect(invoiceHtml).toContain(footer);
        expect(invoiceHtml).toContain('issued in Zoho Books');
        for (const doc of [receiptHtml, invoiceHtml, receiptJs, invoiceJs]) {
            expect(doc).not.toContain('TAX INVOICE');
        }
        // no GST%/tax columns in the items tables
        expect(receiptHtml).not.toMatch(/<th[^>]*>\s*GST/i);
        expect(invoiceHtml).not.toMatch(/<th[^>]*>\s*GST/i);
    });

    test('receipt: Zoho invoice line only when pushed + balance-due badge', () => {
        expect(receiptHtml).toContain('id="zohoInvoiceRow"');
        expect(receiptHtml).toMatch(/id="zohoInvoiceRow"[^>]*class="hidden/);
        expect(receiptJs).toContain('inv.zoho_invoice_number');
        expect(receiptJs).toContain('balanceBadge');
    });

    test('receipt: thermal mode — pageRule swap + qs_thermal persistence', () => {
        expect(receiptHtml).toContain('<style id="pageRule">');
        expect(receiptJs).toContain('@page{size:80mm auto;margin:3mm}');
        expect(receiptJs).toContain("localStorage.getItem('qs_thermal')");
        expect(receiptJs).toContain("localStorage.setItem('qs_thermal'");
        expect(receiptHtml).toContain('body.thermal #receiptContent');
    });

    test('both pages auth via Bearer from localStorage OR ?token= (Puppeteer)', () => {
        for (const js of [receiptJs, invoiceJs]) {
            expect(js).toContain("urlParams.get('token')");
            expect(js).toContain("localStorage.getItem('auth_token')");
            expect(js).toContain('/api/billing/invoices/');
            expect(js).toContain("'Authorization': `Bearer ${token}`");
        }
    });

    test('invoice print: SALE BILL title, items with pack_size, payments table', () => {
        expect(invoiceHtml).toContain('SALE BILL');
        expect(invoiceJs).toContain('pack_size');
        expect(invoiceHtml).toContain('id="paymentsBody"');
        expect(invoiceHtml).toContain('id="branchRow"');
    });

    test('money formatter: 2 decimals only when non-integer', () => {
        for (const js of [receiptJs, invoiceJs]) {
            expect(js).toContain('Number.isInteger(n)');
            expect(js).toContain("toLocaleString('en-IN'");
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// B1.1 — owner feedback after testing the quick-sale
// ─────────────────────────────────────────────────────────────────────────────
describe('staff-billing page — B1.1 owner feedback', () => {
    const RECEIPT_JS = path.join(PUB, 'js', 'pages', 'billing-receipt.js');
    const INVOICE_JS = path.join(PUB, 'js', 'pages', 'billing-invoice-print.js');
    let html, receiptJs, invoiceJs;

    beforeAll(() => {
        html = fs.readFileSync(HTML_PATH, 'utf8');
        receiptJs = fs.readFileSync(RECEIPT_JS, 'utf8');
        invoiceJs = fs.readFileSync(INVOICE_JS, 'utf8');
    });

    test('#1 New Sale layout: customer section comes BEFORE products', () => {
        const panel = html.indexOf('id="panelQuicksale"');
        const customer = html.indexOf('name="qs_customer_type"');   // first radio in the customer card
        const products = html.indexOf('id="qsItemSearch"');
        expect(panel).toBeGreaterThan(-1);
        expect(customer).toBeGreaterThan(panel);
        expect(customer).toBeLessThan(products);
    });

    test('#2 tabs are distinct segmented buttons — icon + label, filled active state', () => {
        // every tab carries the shared button class
        expect((html.match(/qc-tab-btn/g) || []).length).toBeGreaterThanOrEqual(5);
        // switchTab flips the same classes (icons inside the button survive)
        expect(html).toContain("'qc-tab-btn tab-active' : 'qc-tab-btn tab-inactive'");
        // each of the five tab buttons contains an inline SVG icon + a label span
        const tabBar = html.slice(html.indexOf('<!-- Tab Bar'), html.indexOf('id="panelQuicksale"'));
        expect((tabBar.match(/<svg /g) || []).length).toBe(5);
        expect((tabBar.match(/<span>/g) || []).length).toBe(5);
        // clear active state: filled QC green, no corporate gold underline
        expect(html).toContain('.qc-tabs .qc-tab-btn.tab-active');
        expect(html).toContain('.qc-tab-btn.tab-active::after { display: none; }');
    });

    test('#3 salesperson is a searchable combo; hidden input keeps the salesperson_id contract', () => {
        expect(html).toContain('id="qsSalespersonSearch"');
        expect(html).toContain('id="qsSalespersonSuggestions"');
        expect(html).toContain('<input type="hidden" id="qsSalespersonSel">');
        expect(html).not.toContain('<select id="qsSalespersonSel"');
        expect(html).toContain('function qsFilterSalespersons');
        // an explicit pick always stamps salesperson_id on the quick-sale body
        expect(html).toContain('body.salesperson_id = sp');
    });

    test('#4 painter picked as customer ⇒ salesperson auto-set (override allowed)', () => {
        expect(html).toContain('id="qsSalespersonAuto"');
        expect(html).toContain('(auto)');
        // auto-set reads the painter row field the /api/painters SELECT * returns
        expect(html).toContain('p.zoho_salesperson_id');
        expect(html).toContain('qsSetSalesperson(qsPainter.zoho_salesperson_id');
        // override affordance + auto cleared when the painter is cleared
        expect(html).toContain('qsShowSalespersonPick');
        expect(html).toContain('function qsClearAutoSalesperson');
    });

    test('#5 credit pre-check: GET /credit-check wired, note element, SAVE gate', () => {
        expect(html).toContain('/credit-check?');
        expect(html).toContain('id="qsCreditCheck"');
        expect(html).toContain('function qsCreditPrecheck');
        // ineligible ⇒ SAVE disabled; pre-check failure never blocks (server gate authoritative)
        expect(html).toContain("disabled = (qsCreditEligible === false)");
        expect(html).toContain('qsCreditEligible = null');
    });

    test('#6 picker rows lead with the description; name drops to small text', () => {
        expect(html).toContain('p.description || p.item_name');
        expect(html).toContain('description: product.description || product.item_name');
    });

    test('#6 line items carry an editable description sent to the API', () => {
        expect(html).toContain("qsUpdateItemText(${idx},'description',this.value)");
        expect(html).toContain("updateItemFieldText(${idx},'description',this.value)");
        expect(html).toContain('description: i.description ? String(i.description) : null');
        // attribute-safe escaping for the prefilled value
        expect(html).toContain('function escAttr');
        expect(html).toContain('escAttr(item.description');
    });

    test('#6 print templates render description ONLY (fallback item_name — never both)', () => {
        for (const js of [receiptJs, invoiceJs]) {
            expect(js).toContain("item.description || item.item_name || 'Item'");
            expect(js).not.toContain("escapeHtml(item.item_name || 'Item')");
        }
    });
});

describe('server wiring (B1b)', () => {
    test('billing-pdf router mounts on /api/billing BEFORE billingRoutes', () => {
        const server = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
        expect(server).toContain("require('./routes/billing-pdf')");
        expect(server).toContain('billingPdfRoutes.setPool(pool);');
        const pdfMount = server.indexOf("app.use('/api/billing', billingPdfRoutes.router);");
        const mainMount = server.indexOf("app.use('/api/billing', billingRoutes.router);");
        expect(pdfMount).toBeGreaterThan(-1);
        expect(mainMount).toBeGreaterThan(-1);
        expect(pdfMount).toBeLessThan(mainMount);
    });
});
