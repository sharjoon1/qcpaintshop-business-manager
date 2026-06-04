// Smoke: the staff login page renders its core form.
// Runs WITHOUT a server by loading the static HTML via file:// — proves the
// Playwright harness works end-to-end. Heavier flows live in *.flow.spec.js.
const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('url');
const path = require('path');

const loginFileUrl = pathToFileURL(
    path.join(__dirname, '..', '..', 'public', 'login.html')
).href;

test.describe('login page (static render)', () => {
    test('renders username, password and sign-in button', async ({ page }) => {
        await page.goto(loginFileUrl);

        await expect(page.locator('#loginForm')).toBeVisible();
        await expect(page.locator('#username')).toBeVisible();
        await expect(page.locator('#password')).toHaveAttribute('type', 'password');
        await expect(page.locator('#loginBtn')).toBeVisible();
        await expect(page.locator('#btnText')).toHaveText(/sign in/i);
    });
});
