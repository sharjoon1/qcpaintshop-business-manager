/**
 * ADMIN DOCS MODULE ROUTES
 * Serves the internal "Feature Index / Features Log / Design Reference" admin
 * documentation system: the git-tracked feature-index.json + design-screens.json
 * (read from docs/feature-index/) and the painter-app design mockup HTML (read
 * from docs/design/). Admin-only; not linked from any public page.
 *
 * This module has no DB access — setPool() is a no-op kept only so server.js can
 * call it unconditionally, matching the DI pattern every other route module uses
 * (see CLAUDE.md "New route modules must use the existing setPool(pool) DI pattern").
 */

const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { requireAuth, requireRole } = require('../middleware/permissionMiddleware');

function setPool(_dbPool) { /* no-op: this module does not touch the database */ }

// Hardcoded, non-user-derived paths only — no request input ever reaches these.
const FEATURE_INDEX_PATH = path.join(__dirname, '..', 'docs', 'feature-index', 'feature-index.json');
const DESIGN_SCREENS_PATH = path.join(__dirname, '..', 'docs', 'feature-index', 'design-screens.json');
const DESIGN_MOCKUP_PATH = path.join(__dirname, '..', 'docs', 'design', 'painter-app-mockup.html');

/** GET /api/admin-docs/feature-index - feature-index.json + design-screens.json (admin-only) */
router.get('/feature-index', requireAuth, requireRole('admin'), async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try {
        const [featureIndexRaw, designScreensRaw] = await Promise.all([
            fs.readFile(FEATURE_INDEX_PATH, 'utf8'),
            fs.readFile(DESIGN_SCREENS_PATH, 'utf8')
        ]);
        const feature_index = JSON.parse(featureIndexRaw);
        const design_screens = JSON.parse(designScreensRaw);
        res.json({ success: true, feature_index, design_screens });
    } catch (error) {
        console.error('Admin docs feature-index error:', error);
        res.status(500).json({ success: false, message: 'Failed to load feature index' });
    }
});

/** GET /api/admin-docs/design - raw HTML design mockup (admin-only, never publicly reachable) */
router.get('/design', requireAuth, requireRole('admin'), async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Frame-Options', 'DENY');
    try {
        const html = await fs.readFile(DESIGN_MOCKUP_PATH, 'utf8');
        res.type('html').send(html);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return res.status(404).json({ success: false, message: 'Design mockup not found' });
        }
        console.error('Admin docs design mockup error:', error);
        res.status(500).json({ success: false, message: 'Failed to load design mockup' });
    }
});

module.exports = { router, setPool };
