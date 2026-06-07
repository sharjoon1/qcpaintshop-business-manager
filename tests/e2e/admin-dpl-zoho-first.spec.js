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
        // loadZohoFirst() auto-selects changed rows for push; renderZohoFirst() alone
        // doesn't, so simulate that loaded state here (Z1 is the one changed row).
        window.zfPushSelected = { 11: true };

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

test('proposal Accept button, filter narrows rows, and cards populate', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.route('**/universal-nav-loader.js', r => r.abort());
    await page.addInitScript(() => {
        window.requireAdminOrRedirect = function () {};
        window.getToken = function () { return 'test'; };
    });
    await page.goto(pageUrl).catch(() => {});

    const res = await page.evaluate(() => {
        window.zfRows = [
            { zoho_item_id: 'Z2', zoho_name: 'BIRLA OPUS A 1L', zoho_sku: 'WPRC1', old_dpl: 620, old_rate: 805, entry_id: null, new_dpl: null, new_rate: null, diff: null, status: 'unmatched', changed: false, shared_count: 0,
              proposal: { entry_id: 99, product_name: 'A', base_name: 'White', dpl_size_label: '0.9L', current_dpl: 700, confidence: 'high', reason: 'exact-sku' } },
            { zoho_item_id: 'Z1', zoho_name: 'BIRLA OPUS A 4L', zoho_sku: 'WPRC4', old_dpl: 2050, old_rate: 2660, entry_id: 11, new_dpl: 2180, new_rate: 2830, diff: 130, status: 'matched', changed: true, shared_count: 0, proposal: null },
        ];
        window.zfUnlinked = [];

        const panel = document.getElementById('catalogPanel');
        if (panel) panel.classList.remove('hidden');
        document.getElementById('zohoFirstView').classList.remove('hidden');
        window.renderZohoFirst();

        const beforeRows = document.querySelectorAll('#zohoFirstTableBody tr').length;
        const cardCount = document.querySelectorAll('#zohoFirstCards > div').length;
        const tableHtml = document.getElementById('zohoFirstTableBody').innerHTML;

        // Apply the "Changed" filter — should drop the unmatched row.
        window.setZohoFilter('changed');
        const afterRows = document.querySelectorAll('#zohoFirstTableBody tr').length;
        const afterFirst = document.querySelectorAll('#zohoFirstTableBody tr')[0];

        return {
            beforeRows,
            cardCount,
            hasAccept: tableHtml.indexOf('Accept') !== -1,
            hasProposedDpl: tableHtml.indexOf('Proposed') !== -1,
            afterRows,
            afterFirstText: afterFirst ? afterFirst.textContent : '',
        };
    });

    expect(pageErrors).toEqual([]);
    expect(res.beforeRows).toBe(2);          // both rows under "All"
    expect(res.cardCount).toBe(2);           // mobile cards populated
    expect(res.hasAccept).toBe(true);        // proposal Accept button rendered
    expect(res.hasProposedDpl).toBe(true);   // proposal details rendered
    expect(res.afterRows).toBe(1);           // "Changed" filter → only the changed row
    expect(res.afterFirstText).toContain('BIRLA OPUS A 4L');
});

test('Edit sheet opens prefilled, rate preview computes, Push button present', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.route('**/universal-nav-loader.js', r => r.abort());
    await page.addInitScript(() => {
        window.requireAdminOrRedirect = function () {};
        window.getToken = function () { return 'test'; };
    });
    await page.goto(pageUrl).catch(() => {});

    const res = await page.evaluate(() => {
        window.zfRows = [
            { zoho_item_id: 'Z1', zoho_name: 'BIRLA OPUS A 4L', zoho_sku: 'WPRC4', category: 'Interior', old_dpl: 2050, old_rate: 2660, entry_id: 11, new_dpl: 2180, new_rate: 2830, diff: 130, status: 'matched', changed: true, shared_count: 0, proposal: null },
        ];
        window.zfUnlinked = [];

        const panel = document.getElementById('catalogPanel');
        if (panel) panel.classList.remove('hidden');
        document.getElementById('zohoFirstView').classList.remove('hidden');
        window.renderZohoFirst();

        const tableHtml = document.getElementById('zohoFirstTableBody').innerHTML;

        // Open the edit sheet for Z1.
        window.openZfEdit('Z1');
        const modalShown = document.getElementById('zfEditModal').style.display === 'flex';
        const nameVal = document.getElementById('zfEditName').value;
        const skuVal = document.getElementById('zfEditSku').value;
        const dplVal = document.getElementById('zfEditDpl').value;
        const ratePrefill = document.getElementById('zfEditRatePreview').textContent;

        // Change DPL → rate preview recomputes (ceil(500*1.18*1.10)=649).
        document.getElementById('zfEditDpl').value = '500';
        window.updateZfRatePreview();
        const rateAfter = document.getElementById('zfEditRatePreview').textContent;

        return {
            hasEditBtn: tableHtml.indexOf('Edit') !== -1,
            hasPushBtn: tableHtml.indexOf('Push') !== -1,
            modalShown, nameVal, skuVal, dplVal, ratePrefill, rateAfter,
        };
    });

    expect(pageErrors).toEqual([]);
    expect(res.hasEditBtn).toBe(true);            // ✏ Edit rendered on the row
    expect(res.hasPushBtn).toBe(true);            // ⬆ Push rendered on the row
    expect(res.modalShown).toBe(true);            // edit sheet opened
    expect(res.nameVal).toBe('BIRLA OPUS A 4L');  // prefilled from the row
    expect(res.skuVal).toBe('WPRC4');
    expect(res.dplVal).toBe('2050');              // old_dpl prefilled
    expect(res.ratePrefill).toContain('2,661');   // ceil(2050*1.18*1.10)=2661 (en-IN locale)
    expect(res.rateAfter).toContain('649');       // ceil(500*1.18*1.10)=649 after DPL→500
});
