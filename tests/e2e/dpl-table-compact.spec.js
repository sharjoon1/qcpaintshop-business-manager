// Locks the compact catalog-table layout: the status cell shows small chips that
// flow horizontally instead of stacking into a tall column, so rows stay short
// even for the richest row (pushed + re-push + duplicate badge).
const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('url');
const path = require('path');

const fixtureUrl = pathToFileURL(
    path.join(__dirname, 'fixtures', 'dpl-table-compact.html')
).href;

test('compact table keeps rows short and fits within the panel', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto(fixtureUrl);

    // The White/TF110 row carries the most status content (re-push + ⚠×2 wrong).
    const richRow = page.locator('#b tr', { hasText: 'White' }).first();
    const h = await richRow.evaluate(el => el.getBoundingClientRect().height);
    expect(h).toBeLessThan(90); // was ~250px when chips were crammed into a 66px column

    // No horizontal overflow on the scroll container.
    const wrap = page.locator('.overflow-x-auto');
    const { sw, cw } = await wrap.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    expect(sw).toBeLessThanOrEqual(cw + 1);
});
