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

    // Row 1 (White 10L) is the SKU match → best; Row 2 (Pastel) → different product.
    const row1 = page.locator('#b tr', { hasText: 'White' });
    const row2 = page.locator('#b tr', { hasText: 'Pastel' });
    const row3 = page.locator('#b tr', { hasText: 'Clear' });

    await expect(row1).toContainText('✓ best match');
    await expect(row1).toContainText('shared ×2');
    await expect(row2).toContainText('✗ different product');
    await expect(row2).toContainText('shared ×2');
    await expect(row3).not.toContainText('shared'); // no collision on the unique item

    await page.screenshot({ path: 'test-results/dpl-duplicate-badges.png', fullPage: true });
});
