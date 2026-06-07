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

test('linked DPL column, shared resolver, and checkbox-driven push', async ({ page }) => {
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
            { zoho_item_id: 'Z1', zoho_name: 'BIRLA OPUS A 4L', zoho_sku: 'WPRC4', category: 'Interior',
              old_dpl: 2050, old_rate: 2660, entry_id: 11, new_dpl: 2180, new_rate: 2830, diff: 130,
              status: 'matched', changed: true, shared_count: 0, proposal: null,
              matched: { entry_id: 11, product_name: 'Pure Elegance', base_name: 'White', dpl_size_label: '3.6L', canonical_sku: 'WPRC4' },
              linked_entries: null },
            { zoho_item_id: 'Z4', zoho_name: 'BIRLA OPUS C 20L', zoho_sku: 'XYZ20', category: 'Exterior',
              old_dpl: 8000, old_rate: 10380, entry_id: null, new_dpl: null, new_rate: null, diff: null,
              status: 'shared', changed: false, shared_count: 2, proposal: null, matched: null,
              linked_entries: [
                { entry_id: 14, product_name: 'C', base_name: 'White',  dpl_size_label: '18L', canonical_sku: 'XYZ20',  current_dpl: 8000 },
                { entry_id: 15, product_name: 'C', base_name: 'Pastel', dpl_size_label: '18L', canonical_sku: 'XYZ20B', current_dpl: 8100 },
              ] },
        ];
        window.zfUnlinked = [];

        const panel = document.getElementById('catalogPanel');
        if (panel) panel.classList.remove('hidden');
        document.getElementById('zohoFirstView').classList.remove('hidden');
        // Simulate loadZohoFirst's default selection (changed rows auto-selected).
        window.zfPushSelected = { 11: true };
        window.renderZohoFirst();

        const tableHtml = document.getElementById('zohoFirstTableBody').innerHTML;
        const sharedText = document.getElementById('zohoFirstTableBody').textContent;
        const pushCountBefore = document.getElementById('zfPushCount').textContent;
        const pushDisabledBefore = document.getElementById('zfPushBtn').disabled;

        // Deselect the only changed row via its checkbox handler.
        window.zfTogglePush(11, false);
        const pushCountAfter = document.getElementById('zfPushCount').textContent;
        const pushDisabledAfter = document.getElementById('zfPushBtn').disabled;

        return {
            hasLinkedProduct: tableHtml.indexOf('Pure Elegance') !== -1,
            hasCategory: tableHtml.indexOf('Interior') !== -1,
            hasDetachBtn: tableHtml.indexOf('Not in Zoho') !== -1,
            sharedSummary: sharedText.indexOf('DPL entries share this item') !== -1,
            sharedCount: document.getElementById('zfShared').textContent,
            unchangedCount: document.getElementById('zfUnchanged').textContent,
            pushCountBefore, pushDisabledBefore,
            pushCountAfter, pushDisabledAfter,
        };
    });

    expect(pageErrors).toEqual([]);
    expect(res.hasLinkedProduct).toBe(true);   // matched row shows the DPL product name
    expect(res.hasCategory).toBe(true);        // category rendered
    expect(res.hasDetachBtn).toBe(true);       // shared row detach button
    expect(res.sharedSummary).toBe(true);      // shared resolver header
    expect(res.sharedCount).toBe('1');         // one shared row
    expect(res.unchangedCount).toBe('0');      // no unchanged matched rows here
    expect(res.pushCountBefore).toBe('1');     // changed row pre-selected
    expect(res.pushDisabledBefore).toBe(false);
    expect(res.pushCountAfter).toBe('0');      // deselected → count 0
    expect(res.pushDisabledAfter).toBe(true);  // → push disabled
});

test('pushed chip, pushable filter, DPL-name search, SKU conflict, re-pick button', async ({ page }) => {
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
            // matched, never pushed, pushable, has linked DPL "Pure Elegance"
            { zoho_item_id: 'Z1', zoho_name: 'BIRLA OPUS A 4L', zoho_sku: 'WPRC4', category: 'Interior',
              old_dpl: 2050, old_rate: 2660, entry_id: 11, new_dpl: 2180, new_rate: 2830, diff: 130,
              status: 'matched', changed: true, shared_count: 0, proposal: null,
              matched: { entry_id: 11, product_name: 'Pure Elegance', base_name: 'White', dpl_size_label: '3.6L', canonical_sku: 'WPRC4' },
              linked_entries: null, pushed_at: null, pushed_job_id: null, pushed_dpl: null, push_changed: false, sku_conflict: 'DUP ITEM' },
            // matched, already pushed, no change → ✅ pushed chip, NOT pushable
            { zoho_item_id: 'Z3', zoho_name: 'BIRLA OPUS B 10L', zoho_sku: 'ADSS10', category: 'Exterior',
              old_dpl: 4100, old_rate: 5322, entry_id: 13, new_dpl: 4100, new_rate: 5322, diff: 0,
              status: 'matched', changed: false, shared_count: 0, proposal: null,
              matched: { entry_id: 13, product_name: 'Weather Coat', base_name: 'Clear', dpl_size_label: '9L', canonical_sku: 'ADSS10' },
              linked_entries: null, pushed_at: '2026-06-01 10:00:00', pushed_job_id: 9, pushed_dpl: 4100, push_changed: false, sku_conflict: null },
        ];
        window.zfUnlinked = [];

        const panel = document.getElementById('catalogPanel');
        if (panel) panel.classList.remove('hidden');
        document.getElementById('zohoFirstView').classList.remove('hidden');
        window.zfPushSelected = { 11: true };
        window.renderZohoFirst();

        const tableHtml = document.getElementById('zohoFirstTableBody').innerHTML;

        // Pushable filter → only Z1 (Z3 is pushed+unchanged, not pushable).
        window.setZohoFilter('pushable');
        const pushableRows = document.querySelectorAll('#zohoFirstTableBody tr').length;
        const pushableFirst = document.querySelectorAll('#zohoFirstTableBody tr')[0];

        // Pushed filter → only Z3.
        window.setZohoFilter('pushed');
        const pushedRows = document.querySelectorAll('#zohoFirstTableBody tr').length;
        const pushedFirst = document.querySelectorAll('#zohoFirstTableBody tr')[0];

        // Search by a linked DPL product name → matches Z1 only.
        window.setZohoFilter('all');
        document.getElementById('zfSearch').value = 'pure elegance';
        window.renderZohoFirst();
        const searchRows = document.querySelectorAll('#zohoFirstTableBody tr').length;
        const searchFirst = document.querySelectorAll('#zohoFirstTableBody tr')[0];

        return {
            hasPushedChip: tableHtml.indexOf('✅ pushed') !== -1,
            hasSkuConflict: tableHtml.indexOf('SKU also used by: DUP ITEM') !== -1,
            hasRepick: tableHtml.indexOf('Re-pick') !== -1,
            pushableRows,
            pushableFirstText: pushableFirst ? pushableFirst.textContent : '',
            pushedRows,
            pushedFirstText: pushedFirst ? pushedFirst.textContent : '',
            searchRows,
            searchFirstText: searchFirst ? searchFirst.textContent : '',
        };
    });

    expect(pageErrors).toEqual([]);
    expect(res.hasPushedChip).toBe(true);                  // Z3 shows ✅ pushed
    expect(res.hasSkuConflict).toBe(true);                 // Z1 SKU conflict ⚠ tooltip
    expect(res.hasRepick).toBe(true);                      // matched rows have 🔄 Re-pick
    expect(res.pushableRows).toBe(1);                      // only Z1 pushable
    expect(res.pushableFirstText).toContain('BIRLA OPUS A 4L');
    expect(res.pushedRows).toBe(1);                        // only Z3 pushed
    expect(res.pushedFirstText).toContain('BIRLA OPUS B 10L');
    expect(res.searchRows).toBe(1);                        // DPL-name search hits Z1
    expect(res.searchFirstText).toContain('BIRLA OPUS A 4L');
});

test('mobile cards carry a per-row push checkbox for pushable rows + a select-all toggle', async ({ page }) => {
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
            // unmatched → no checkbox
            { zoho_item_id: 'Z2', zoho_name: 'BIRLA OPUS A 1L', zoho_sku: 'WPRC1', old_dpl: 620, old_rate: 805,
              entry_id: null, new_dpl: null, new_rate: null, diff: null, status: 'unmatched', changed: false, shared_count: 0 },
            // matched + changed + not pushed → pushable → checkbox
            { zoho_item_id: 'Z1', zoho_name: 'BIRLA OPUS A 4L', zoho_sku: 'WPRC4', old_dpl: 2050, old_rate: 2660,
              entry_id: 11, new_dpl: 2180, new_rate: 2830, diff: 130, status: 'matched', changed: true, shared_count: 0,
              pushed_at: null, push_changed: false },
            // matched, already pushed, no change since → NOT pushable → no checkbox
            { zoho_item_id: 'Z3', zoho_name: 'BIRLA OPUS B 10L', zoho_sku: 'ADSS10', old_dpl: 4100, old_rate: 5322,
              entry_id: 13, new_dpl: 4100, new_rate: 5322, diff: 0, status: 'matched', changed: false, shared_count: 0,
              pushed_at: '2026-06-01 10:00:00', push_changed: false },
        ];
        window.zfUnlinked = [];
        window.zfPushSelected = {};

        const panel = document.getElementById('catalogPanel');
        if (panel) panel.classList.remove('hidden');
        document.getElementById('zohoFirstView').classList.remove('hidden');
        window.renderZohoFirst();

        const cards = document.getElementById('zohoFirstCards');
        const cardChecks = cards.querySelectorAll('input[type="checkbox"]');
        const selectAll = document.getElementById('zfHeadCheckMobile');

        // Toggle the lone card checkbox → push count + button should react.
        let countAfterToggle = null, btnDisabledAfter = null;
        if (cardChecks.length === 1) {
            cardChecks[0].checked = true;
            cardChecks[0].dispatchEvent(new Event('change', { bubbles: true }));
            countAfterToggle = document.getElementById('zfPushCount').textContent;
            btnDisabledAfter = document.getElementById('zfPushBtn').disabled;
        }

        return {
            cardCheckCount: cardChecks.length,
            cardChecksWiredToToggle: cards.innerHTML.indexOf('zfTogglePush(11') !== -1,
            hasSelectAll: !!selectAll,
            countAfterToggle,
            btnDisabledAfter,
        };
    });

    expect(pageErrors).toEqual([]);
    expect(res.cardCheckCount).toBe(1);            // only the pushable row (Z1) gets a card checkbox
    expect(res.cardChecksWiredToToggle).toBe(true); // wired to zfTogglePush(entry_id,…)
    expect(res.hasSelectAll).toBe(true);            // mobile select-all toggle exists
    expect(res.countAfterToggle).toBe('1');         // toggling the card checkbox queues 1
    expect(res.btnDisabledAfter).toBe(false);       // push button enabled after selection
});
