// Integration smoke for the REAL admin-dpl.html renderZohoFirst(): loads the actual
// page, injects sample Zoho-first rows, and asserts the table renders with the
// expected status chips, diff, counts and push-button state. Mirrors the harness in
// admin-dpl-render.spec.js.
/* global window, document */
const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('url');
const path = require('path');

const pageUrl = pathToFileURL(
    path.join(__dirname, '..', '..', 'public', 'admin-dpl.html')
).href;

test('renderZohoFirst populates the table, unmatched first', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.route('**/universal-nav-loader.js', r => r.abort());
    await page.addInitScript(() => {
        window.requireAdminOrRedirect = function () {};
        window.getToken = function () { return 'test'; };
    });
    await page.goto(pageUrl).catch(() => {});

    const res = await page.evaluate(() => {
        // zfRows is the already-sorted output of buildZohoFirstView (server sorts).
        window.zfRows = [
            { zoho_item_id: 'Z2', zoho_name: 'BIRLA OPUS A 1L',  zoho_sku: 'WPRC1',  old_dpl: 620,  old_rate: 805,  entry_id: null, new_dpl: null, new_rate: null, diff: null, status: 'unmatched', changed: false, shared_count: 0 },
            { zoho_item_id: 'Z1', zoho_name: 'BIRLA OPUS A 4L',  zoho_sku: 'WPRC4',  old_dpl: 2050, old_rate: 2660, entry_id: 11,   new_dpl: 2180, new_rate: 2830, diff: 130,  status: 'matched',   changed: true,  shared_count: 0 },
            { zoho_item_id: 'Z3', zoho_name: 'BIRLA OPUS B 10L', zoho_sku: 'ADSS10', old_dpl: 4100, old_rate: 5322, entry_id: 13,   new_dpl: 4100, new_rate: 5322, diff: 0,    status: 'matched',   changed: false, shared_count: 0 },
        ];
        window.zfUnlinked = [];

        const panel = document.getElementById('catalogPanel');
        if (panel) panel.classList.remove('hidden');
        document.getElementById('zohoFirstView').classList.remove('hidden');
        window.renderZohoFirst();

        const tbody = document.getElementById('zohoFirstTableBody');
        const rowEls = tbody.querySelectorAll('tr');
        return {
            rows: rowEls.length,
            firstText: rowEls[0] ? rowEls[0].textContent : '',
            firstHasButton: !!(rowEls[0] && rowEls[0].querySelector('button')),
            secondText: rowEls[1] ? rowEls[1].textContent : '',
            unmatched: document.getElementById('zfUnmatched').textContent,
            changed: document.getElementById('zfChanged').textContent,
            pushDisabled: document.getElementById('zfPushBtn').disabled,
        };
    });

    expect(pageErrors).toEqual([]);
    expect(res.rows).toBe(3);
    expect(res.firstText).toContain('BIRLA OPUS A 1L'); // unmatched sorted first
    expect(res.firstHasButton).toBe(true);              // Attach DPL button present
    expect(res.firstText).toContain('Attach DPL');
    expect(res.secondText).toContain('+₹130');          // changed row shows diff
    expect(res.secondText).toContain('changed');
    expect(res.unmatched).toBe('1');
    expect(res.changed).toBe('1');
    expect(res.pushDisabled).toBe(false);               // 1 changed row → push enabled
});
