/**
 * Content-contract check for the painter web dashboard attendance (AP) hero.
 *
 * The hero fetches the monthly attendance summary and posts the AP claim. Those
 * calls must hit the real painter routes mounted at /api/painters/me/attendance/*
 * (routes/painters/painter.js). The bare /api/me/attendance/* paths have no mount
 * and 404 silently, which left web painters unable to see or claim AP.
 *
 * DOM-independent content check in plain Node under Jest, matching the
 * lightweight UI-contract convention used by painter-leads-ui.test.js.
 */

const fs = require('fs');
const path = require('path');

const DASHBOARD_PATH = path.join(__dirname, '..', '..', 'public', 'painter-dashboard.html');

describe('painter dashboard attendance hero (UI)', () => {
    let html;

    beforeAll(() => {
        html = fs.readFileSync(DASHBOARD_PATH, 'utf8');
    });

    test('attendance hero calls the real /api/painters/me/attendance/ routes', () => {
        expect(html).toContain('/api/painters/me/attendance/month');
        expect(html).toContain('/api/painters/me/attendance/claim');
    });

    test('no bare /api/me/attendance/ path remains (would 404 silently)', () => {
        expect(html).not.toMatch(/['"`]\/api\/me\/attendance\//);
    });
});
