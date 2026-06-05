// Visual + behavioural check of the duplicate-link badges using the REAL
// public/js/dpl-duplicate-detect.js module. Captures a preview screenshot.
const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('url');
const path = require('path');

const fixtureUrl = pathToFileURL(
    path.join(__dirname, 'fixtures', 'dpl-duplicate-badges.html')
).href;

test('duplicate badges render best vs different-product for a shared Zoho item', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 360 });
    await page.goto(fixtureUrl);

    // TF110 = base code 1 = PASTEL. So Pastel is the best match; White (WT) is wrong.
    const white = page.locator('#b tr', { hasText: 'White' });
    const pastel = page.locator('#b tr', { hasText: 'Pastel' });
    const clear = page.locator('#b tr', { hasText: 'Clear' });

    await expect(pastel).toContainText('✓ best match');
    await expect(pastel).toContainText('shared ×2');
    await expect(white).toContainText('✗ different product');
    await expect(white).toContainText('shared ×2');
    await expect(clear).not.toContainText('shared'); // no collision on the unique item

    await page.screenshot({ path: 'test-results/dpl-duplicate-badges.png', fullPage: true });
});
