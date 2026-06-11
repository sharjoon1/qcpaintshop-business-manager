/**
 * ZOHO BOOKS INTEGRATION ROUTES
 * Admin panel endpoints for Zoho Books management
 *
 * Endpoints:
 *   GET    /api/zoho/status           - Connection & sync status
 *   GET    /api/zoho/dashboard        - Dashboard stats
 *   GET    /api/zoho/dashboard/drilldown - Drill into stat card metrics
 *   GET    /api/zoho/dashboard/drilldown/export - Export drilldown as CSV
 *   POST   /api/zoho/sync/full        - Trigger full sync
 *   POST   /api/zoho/sync/invoices    - Sync invoices only
 *   POST   /api/zoho/sync/customers   - Sync customers only
 *   POST   /api/zoho/sync/payments    - Sync payments only
 *   GET    /api/zoho/invoices         - List cached invoices
 *   GET    /api/zoho/invoices/:id     - Single invoice detail
 *   GET    /api/zoho/payments         - List cached payments
 *   GET    /api/zoho/payments/:id    - Single payment detail
 *   GET    /api/zoho/customers        - List Zoho customers
 *   GET    /api/zoho/reports/:type    - Financial reports
 *   GET    /api/zoho/sync/log         - Sync history
 *   GET    /api/zoho/config           - Get config
 *   PUT    /api/zoho/config           - Update config
 *   GET    /api/zoho/oauth/url        - Get OAuth setup URL
 *   GET    /api/zoho/oauth/callback   - OAuth callback handler
 *   POST   /api/zoho/oauth/disconnect - Disconnect Zoho
 *   GET    /api/zoho/whatsapp/queue   - WhatsApp queue
 *   POST   /api/zoho/whatsapp/send    - Queue WhatsApp message
 */
/**
 * A8b SPLIT: this directory replaces the former single-file routes/zoho.js.
 * Sub-routers (handlers moved verbatim, grouped by the original section
 * comments):
 *   shared.js           — cross-router module state (LRU cache, sync debounce,
 *                         brand helpers) + service pool wiring
 *   sync-config.js      — status/dashboard, api-usage, sync, config, oauth,
 *                         whatsapp followups, scheduler, locations
 *   invoices-reports.js — invoices, payments, customers, reports, daily
 *                         transactions, expenses, creditnotes, salesorders
 *   items.js            — dpl-catalog, stock, inventory adjustments,
 *                         items & bulk updates, price-list/DPL parsing
 *   reorder.js          — reorder alerts, brand config, purchase suggestions,
 *                         snooze, vendor mapping, create-PO
 * Mount order below is safe: no overlapping route pattern spans two
 * sub-routers (verified with scripts/check-route-shadowing.js).
 */

const express = require('express');
const router = express.Router();

const shared = require('./shared');
const syncConfig = require('./sync-config');
const invoicesReports = require('./invoices-reports');
const items = require('./items');
const reorder = require('./reorder');

router.use(syncConfig.router);
router.use(invoicesReports.router);
router.use(items.router);
router.use(reorder.router);

function setPool(dbPool) {
    syncConfig.setPool(dbPool);
    invoicesReports.setPool(dbPool);
    items.setPool(dbPool);
    reorder.setPool(dbPool);
    shared.setPool(dbPool); // service singletons + permission auto-fix
}

module.exports = {
    router,
    setPool,
    catalogZohoScopeSql: shared.catalogZohoScopeSql
};
