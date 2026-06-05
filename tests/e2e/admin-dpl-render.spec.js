// Integration smoke for the REAL admin-dpl.html renderCatalog(): loads the actual
// page, injects sample catalog entries, and asserts the table body renders. Guards
// against the whole-table-blank class of bugs (e.g. a `var` shadowing a row-render
// helper) that simplified fixture tests can't catch.
/* global window, document */ // referenced inside page.evaluate/addInitScript (browser context)
const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('url');
const path = require('path');

const pageUrl = pathToFileURL(
    path.join(__dirname, '..', '..', 'public', 'admin-dpl.html')
).href;

test('renderCatalog populates the table without throwing', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    // Don't let the nav loader / auth redirect interfere with the unit under test.
    await page.route('**/universal-nav-loader.js', r => r.abort());
    await page.addInitScript(() => {
        window.requireAdminOrRedirect = function () {};
        window.getToken = function () { return 'test'; };
    });
    await page.goto(pageUrl).catch(() => {});

    const res = await page.evaluate(() => {
        // A pushed+changed confirmed entry that also collides (richest status cell).
        window.catalogEntries = [
            { id: 1, link_status: 'confirmed', zoho_item_id: 'Z1', current_dpl: 4370, current_rate: 5673, old_dpl: 4070,
              pushed_at: '2026-05-12 23:19', push_changed: true, pushed_dpl: 4070, pushed_job_id: 73,
              product_name: 'One True Flex', base_name: 'White', size_tier: '10L', canonical_sku: 'TF110',
              canonical_name: 'TF110 ONE TRUE FLEX BIRLA OPUS 10 L', zoho_name: 'TF110 ONE TRUE FLEX BIRLA OPUS 10 L',
              link_confidence: 100, sku_base_match: false },
            { id: 2, link_status: 'confirmed', zoho_item_id: 'Z1', current_dpl: 4070,
              product_name: 'One True Flex', base_name: 'Pastel', size_tier: '10L', canonical_sku: 'TF110',
              canonical_name: 'x', zoho_name: 'x', link_confidence: 100, sku_base_match: true },
        ];
        window.catDupInfo = { 1: { count: 2, role: 'wrong' }, 2: { count: 2, role: 'best' } };
        window.catalogFilter = 'all';
        const panel = document.getElementById('catalogPanel');
        if (panel) panel.classList.remove('hidden');
        window.renderCatalog();
        const html = document.getElementById('catalogTableBody').innerHTML;
        return {
            rows: document.querySelectorAll('#catalogTableBody tr').length,
            hasBest: html.indexOf('best') !== -1,
            hasWrong: html.indexOf('wrong') !== -1,
            hasRepush: html.indexOf('re-push') !== -1,
        };
    });

    expect(pageErrors).toEqual([]);
    expect(res.rows).toBe(2);          // both entries rendered (no throw → tbody populated)
    expect(res.hasBest).toBe(true);    // dupChip verdict present
    expect(res.hasWrong).toBe(true);
    expect(res.hasRepush).toBe(true);  // pushedChip present
});
