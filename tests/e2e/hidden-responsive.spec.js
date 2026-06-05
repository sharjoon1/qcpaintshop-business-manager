// Regression test for the global `.hidden { display:none !important }` rule in
// design-system.css overriding Tailwind responsive show utilities.
//
// Bug: `hidden sm:block` stayed display:none on desktop (>=640px) because the
// !important .hidden beat Tailwind's non-important .sm:block. This hid the whole
// admin-dpl.html catalog table on desktop while the mobile card view worked.
/* global getComputedStyle */ // used inside page.$eval (browser context), not Node
const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('url');
const path = require('path');

const fixtureUrl = pathToFileURL(
    path.join(__dirname, 'fixtures', 'hidden-responsive.html')
).href;

function displayOf(page, id) {
    return page.$eval('#' + id, el => getComputedStyle(el).display);
}

test.describe('global .hidden vs Tailwind responsive show utilities', () => {
    test('desktop (>=640px): `hidden sm:block` element is visible (display:block)', async ({ page }) => {
        await page.setViewportSize({ width: 1000, height: 700 });
        await page.goto(fixtureUrl);
        expect(await displayOf(page, 'resp')).toBe('block');   // the bug made this 'none'
        expect(await displayOf(page, 'plain')).toBe('none');   // plain hide still hidden
    });

    test('mobile (<640px): `hidden sm:block` element stays hidden (display:none)', async ({ page }) => {
        await page.setViewportSize({ width: 400, height: 700 });
        await page.goto(fixtureUrl);
        expect(await displayOf(page, 'resp')).toBe('none');
        expect(await displayOf(page, 'plain')).toBe('none');
    });
});
