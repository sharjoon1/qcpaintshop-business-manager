// Full staff login flow against a RUNNING server.
// Requires: TEST_BASE_URL + TEST_STAFF_USER + TEST_STAFF_PASS.
// Self-skips when any is missing so `npx playwright test` stays green locally.
//
// This is a scaffold for the priority flow in E2E-PLAN.md (#1). Selectors are
// taken from public/login.html (#username, #password, #loginBtn, #errorText).
const { test, expect } = require('@playwright/test');

const BASE = process.env.TEST_BASE_URL;
const USER = process.env.TEST_STAFF_USER;
const PASS = process.env.TEST_STAFF_PASS;

test.describe('staff login flow', () => {
    test.skip(!BASE || !USER || !PASS,
        'Set TEST_BASE_URL / TEST_STAFF_USER / TEST_STAFF_PASS to run this flow.');

    test('valid credentials reach the dashboard', async ({ page }) => {
        await page.goto(`${BASE}/login.html`);
        await page.fill('#username', USER);
        await page.fill('#password', PASS);
        await page.click('#loginBtn');

        // Either a dashboard navigation or a 2FA modal for admin/manager accounts.
        await page.waitForLoadState('networkidle');
        const onDashboard = /dashboard|admin-/i.test(page.url());
        const twoFA = await page.locator('#twoFAModal').isVisible().catch(() => false);
        expect(onDashboard || twoFA).toBeTruthy();
    });

    test('invalid password shows an error and stays on login', async ({ page }) => {
        await page.goto(`${BASE}/login.html`);
        await page.fill('#username', USER);
        await page.fill('#password', 'definitely-wrong-password');
        await page.click('#loginBtn');

        await expect(page.locator('#errorText')).toBeVisible();
        expect(page.url()).toContain('login');
    });
});
