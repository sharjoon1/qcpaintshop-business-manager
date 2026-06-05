// Verifies the DPL catalog table fits within its container (no horizontal scroll)
// even with worst-case long product names, Zoho names, SKUs and the full set of
// action buttons. Backs the table-layout:fixed + column-width fix in admin-dpl.html.
const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('url');
const path = require('path');

const fixtureUrl = pathToFileURL(
    path.join(__dirname, 'fixtures', 'dpl-catalog-table.html')
).href;

test.describe('DPL catalog table fits within screen', () => {
    test('no horizontal overflow with long content', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto(fixtureUrl);

        const wrap = page.locator('#wrap');
        const { scrollW, clientW } = await wrap.evaluate(el => ({
            scrollW: el.scrollWidth, clientW: el.clientWidth,
        }));
        // table-layout:fixed keeps the table at container width — content wraps
        // instead of widening it, so the scroll container has nothing to scroll.
        expect(scrollW).toBeLessThanOrEqual(clientW + 1);

        // Rows actually rendered (sanity).
        await expect(page.locator('#catalogTableBody tr')).toHaveCount(6);

        await page.screenshot({ path: 'test-results/dpl-catalog-table-fit.png', fullPage: true });
    });
});
