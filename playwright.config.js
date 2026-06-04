// Playwright E2E config — kept separate from Jest (Jest only matches *.test.js).
// E2E specs live in tests/e2e/*.spec.js so the two runners never collide.
//
// We intentionally do NOT auto-start the app server here: server.js boots
// cron schedulers, WhatsApp sessions and Zoho sync, which must not run from a
// casual test invocation. Point the flow tests at an already-running instance:
//   set TEST_BASE_URL=http://localhost:3000
//   set TEST_STAFF_USER=...   set TEST_STAFF_PASS=...
// Flow specs self-skip when these are absent (see tests/e2e/login.flow.spec.js).
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests/e2e',
    testMatch: '**/*.spec.js',
    timeout: 30000,
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: [['list']],
    use: {
        baseURL: process.env.TEST_BASE_URL || undefined,
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
});
