/**
 * Stock Migration Routes
 * Bulk transfer stock from Warehouse locations to Business locations
 * Uses paired inventory adjustments (decrease warehouse + increase business)
 * since Transfer Orders require Zoho Inventory OAuth scope we don't have.
 */

const express = require('express');
const router = express.Router();
const { requirePermission } = require('../middleware/permissionMiddleware');

let pool;
function setPool(p) { pool = p; }

/**
 * POST /sync-stock
 * Sync location stock from Zoho to get fresh data
 */
router.post('/sync-stock', requirePermission('zoho', 'manage'), async (req, res) => {
    // Return immediately, sync runs in background (takes 1-2 min for ~1800 items)
    const zohoAPI = require('../services/zoho-api');
    console.log('[Stock Migration] Starting background stock sync...');
    res.json({ success: true, message: 'Stock sync started. Please wait 1-2 minutes, then click Refresh.' });

    try {
        await zohoAPI.syncLocationStock(req.user?.id || null);
        console.log('[Stock Migration] Background stock sync complete');
    } catch (error) {
        console.error('[Stock Migration] Background stock sync error:', error.message);
    }
});

/**
 * GET /warehouse-stock
 * Returns stock in all warehouse locations grouped by branch
 */
router.get('/warehouse-stock', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        // Get all warehouse + business location pairs grouped by branch
        const [locations] = await pool.query(`
            SELECT
                wh.local_branch_id as branch_id,
                b.name as branch_name,
                wh.zoho_location_id as warehouse_location_id,
                wh.zoho_location_name as warehouse_location_name,
                biz.zoho_location_id as business_location_id,
                biz.zoho_location_name as business_location_name
            FROM zoho_locations_map wh
            JOIN zoho_locations_map biz ON wh.local_branch_id = biz.local_branch_id
                AND biz.zoho_location_name NOT LIKE '%(Warehouse)%' AND biz.is_active = 1
            JOIN branches b ON wh.local_branch_id = b.id
            WHERE wh.zoho_location_name LIKE '%(Warehouse)%' AND wh.is_active = 1
            ORDER BY b.name
        `);

        // For each warehouse location, get stock items
        const branches = [];
        for (const loc of locations) {
            const [items] = await pool.query(`
                SELECT zoho_item_id as item_id, item_name as name, sku,
                       CAST(stock_on_hand AS DECIMAL(10,2)) as stock
                FROM zoho_location_stock
                WHERE zoho_location_id = ? AND stock_on_hand > 0
                ORDER BY item_name
            `, [loc.warehouse_location_id]);

            const totalQuantity = items.reduce((sum, i) => sum + parseFloat(i.stock), 0);

            branches.push({
                branch_id: loc.branch_id,
                branch_name: loc.branch_name,
                warehouse_location_id: loc.warehouse_location_id,
                warehouse_location_name: loc.warehouse_location_name,
                business_location_id: loc.business_location_id,
                business_location_name: loc.business_location_name,
                items: items,
                total_items: items.length,
                total_quantity: totalQuantity
            });
        }

        res.json({ success: true, branches });
    } catch (error) {
        console.error('Get warehouse stock error:', error);
        res.status(500).json({ success: false, message: 'Failed to get warehouse stock: ' + error.message });
    }
});

/**
 * POST /transfer
 * Transfer stock from warehouse to business location for one branch.
 * Uses two inventory adjustments: decrease at warehouse, increase at business.
 */
router.post('/transfer', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const { branch_id, branch_name, from_location_id, to_location_id, items } = req.body;

        if (!from_location_id || !to_location_id || !items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        // Filter out zero-stock items
        const transferItems = items.filter(i => parseFloat(i.stock || i.quantity) > 0);
        if (transferItems.length === 0) {
            return res.json({ success: true, message: 'No items with stock to transfer', skipped: true });
        }

        const zohoAPI = require('../services/zoho-api');
        const today = new Date().toISOString().split('T')[0];
        const label = (branch_name || 'Branch').substring(0, 30);

        // Step 1: Increase stock at business location
        const increaseData = {
            date: today,
            reason: `Migration IN: ${label}`.substring(0, 50),
            description: `Stock migration from warehouse to business location for ${branch_name}`,
            adjustment_type: 'quantity',
            location_id: to_location_id,
            line_items: transferItems.map(item => ({
                item_id: item.item_id,
                location_id: to_location_id,
                quantity_adjusted: parseFloat(item.stock || item.quantity)
            }))
        };

        console.log(`[Stock Migration] Step 1: Increasing at ${to_location_id} for ${branch_name} (${transferItems.length} items)`);
        const increaseResult = await zohoAPI.createInventoryAdjustment(increaseData);
        const increaseId = increaseResult?.inventory_adjustment?.inventory_adjustment_id || 'unknown';
        console.log(`[Stock Migration] Increase adjustment created: ${increaseId}, location in response: ${increaseResult?.inventory_adjustment?.location_id}`);

        // Step 2: Decrease stock at warehouse location
        const decreaseData = {
            date: today,
            reason: `Migration OUT: ${label}`.substring(0, 50),
            description: `Stock migration from warehouse to business location for ${branch_name}`,
            adjustment_type: 'quantity',
            location_id: from_location_id,
            line_items: transferItems.map(item => ({
                item_id: item.item_id,
                location_id: from_location_id,
                quantity_adjusted: -Math.abs(parseFloat(item.stock || item.quantity))
            }))
        };

        console.log(`[Stock Migration] Step 2: Decreasing at ${from_location_id} (warehouse) for ${branch_name}`);
        const decreaseResult = await zohoAPI.createInventoryAdjustment(decreaseData);
        const decreaseId = decreaseResult?.inventory_adjustment?.inventory_adjustment_id || 'unknown';
        console.log(`[Stock Migration] Decrease adjustment created: ${decreaseId}, location in response: ${decreaseResult?.inventory_adjustment?.location_id}`);

        res.json({
            success: true,
            message: `Stock transferred for ${branch_name}`,
            increase_adjustment_id: increaseId,
            decrease_adjustment_id: decreaseId,
            items_transferred: transferItems.length
        });
    } catch (error) {
        console.error('Transfer error:', error);
        res.status(500).json({ success: false, message: 'Transfer failed: ' + error.message });
    }
});

/**
 * POST /transfer-all
 * Transfer all branches in sequence
 */
router.post('/transfer-all', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const { branches } = req.body;

        if (!branches || branches.length === 0) {
            return res.status(400).json({ success: false, message: 'No branches provided' });
        }

        const zohoAPI = require('../services/zoho-api');
        const results = [];
        const today = new Date().toISOString().split('T')[0];

        for (const branch of branches) {
            const transferItems = (branch.items || []).filter(i => parseFloat(i.stock || i.quantity) > 0);

            if (transferItems.length === 0) {
                results.push({
                    branch_id: branch.branch_id,
                    branch_name: branch.branch_name,
                    success: true,
                    skipped: true,
                    message: 'No items with stock'
                });
                continue;
            }

            try {
                const label = (branch.branch_name || 'Branch').substring(0, 30);

                // Step 1: Increase at business
                const increaseData = {
                    date: today,
                    reason: `Migration IN: ${label}`.substring(0, 50),
                    description: `Stock migration from warehouse to business for ${branch.branch_name}`,
                    adjustment_type: 'quantity',
                    location_id: branch.business_location_id,
                    line_items: transferItems.map(item => ({
                        item_id: item.item_id,
                        location_id: branch.business_location_id,
                        quantity_adjusted: parseFloat(item.stock || item.quantity)
                    }))
                };

                console.log(`[Stock Migration] Increasing at ${branch.business_location_id} for ${branch.branch_name} (${transferItems.length} items)`);
                await zohoAPI.createInventoryAdjustment(increaseData);

                // Step 2: Decrease at warehouse
                const decreaseData = {
                    date: today,
                    reason: `Migration OUT: ${label}`.substring(0, 50),
                    description: `Stock migration from warehouse to business for ${branch.branch_name}`,
                    adjustment_type: 'quantity',
                    location_id: branch.warehouse_location_id,
                    line_items: transferItems.map(item => ({
                        item_id: item.item_id,
                        location_id: branch.warehouse_location_id,
                        quantity_adjusted: -Math.abs(parseFloat(item.stock || item.quantity))
                    }))
                };

                console.log(`[Stock Migration] Decreasing at ${branch.warehouse_location_id} (warehouse) for ${branch.branch_name}`);
                await zohoAPI.createInventoryAdjustment(decreaseData);

                results.push({
                    branch_id: branch.branch_id,
                    branch_name: branch.branch_name,
                    success: true,
                    items_transferred: transferItems.length,
                    message: 'Stock transferred'
                });
            } catch (err) {
                console.error(`[Stock Migration] Failed for ${branch.branch_name}:`, err.message);
                results.push({
                    branch_id: branch.branch_id,
                    branch_name: branch.branch_name,
                    success: false,
                    message: err.message
                });
            }
        }

        const successCount = results.filter(r => r.success && !r.skipped).length;
        const failCount = results.filter(r => !r.success).length;
        const skippedCount = results.filter(r => r.skipped).length;

        res.json({
            success: true,
            message: `Completed: ${successCount} transferred, ${failCount} failed, ${skippedCount} skipped`,
            results,
            summary: { transferred: successCount, failed: failCount, skipped: skippedCount }
        });
    } catch (error) {
        console.error('Transfer all error:', error);
        res.status(500).json({ success: false, message: 'Transfer all failed: ' + error.message });
    }
});

/**
 * POST /disable-warehouses
 * Disable all warehouse locations in zoho_locations_map
 */
router.post('/disable-warehouses', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const [result] = await pool.query(`
            UPDATE zoho_locations_map SET is_active = 0
            WHERE zoho_location_name LIKE '%(Warehouse)%' AND is_active = 1
        `);

        console.log(`[Stock Migration] Disabled ${result.affectedRows} warehouse locations`);

        res.json({
            success: true,
            message: `Disabled ${result.affectedRows} warehouse location(s)`,
            disabled_count: result.affectedRows
        });
    } catch (error) {
        console.error('Disable warehouses error:', error);
        res.status(500).json({ success: false, message: 'Failed to disable warehouses: ' + error.message });
    }
});

/**
 * DELETE /adjustment/:id
 * Delete an inventory adjustment from Zoho (for cleaning up bad adjustments)
 */
router.delete('/adjustment/:id', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const zohoAPI = require('../services/zoho-api');
        const orgId = process.env.ZOHO_ORGANIZATION_ID;
        const { apiDelete } = require('../services/zoho-api');

        // Use the raw apiDelete from zoho-api internals
        const https = require('https');
        const zohoOAuth = require('../services/zoho-oauth');
        const token = await zohoOAuth.getAccessToken();
        const url = `https://www.zohoapis.in/books/v3/inventoryadjustments/${req.params.id}?organization_id=${orgId}`;

        const result = await new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const options = {
                hostname: urlObj.hostname,
                path: urlObj.pathname + urlObj.search,
                method: 'DELETE',
                headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
            };
            const r = https.request(options, (resp) => {
                let data = '';
                resp.on('data', c => data += c);
                resp.on('end', () => resolve(JSON.parse(data)));
            });
            r.on('error', reject);
            r.end();
        });

        console.log(`[Stock Migration] Delete adjustment ${req.params.id}:`, result.message);
        res.json({ success: result.code === 0, message: result.message });
    } catch (error) {
        console.error('Delete adjustment error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = { router, setPool };
