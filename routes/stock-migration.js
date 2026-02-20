/**
 * Stock Migration Routes
 * Bulk transfer stock from Warehouse locations to Business locations
 * One-time migration tool
 */

const express = require('express');
const router = express.Router();
const { requirePermission } = require('../middleware/permissionMiddleware');

let pool;
function setPool(p) { pool = p; }

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
 * Transfer stock from warehouse to business location for one branch
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

        const transferData = {
            from_warehouse_id: from_location_id,
            to_warehouse_id: to_location_id,
            date: new Date().toISOString().split('T')[0],
            line_items: transferItems.map(item => ({
                item_id: item.item_id,
                name: item.name || '',
                quantity_transfer: parseFloat(item.stock || item.quantity)
            }))
        };

        console.log(`[Stock Migration] Transferring ${transferItems.length} items for branch ${branch_name || branch_id}`);

        const result = await zohoAPI.createTransferOrder(transferData);

        console.log(`[Stock Migration] Transfer order created: ${result.transfer_order?.transfer_order_id || 'unknown'}`);

        res.json({
            success: true,
            message: `Transfer order created for ${branch_name || 'branch'}`,
            transfer_order_id: result.transfer_order?.transfer_order_id,
            transfer_order_number: result.transfer_order?.transfer_order_number,
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
                const transferData = {
                    from_warehouse_id: branch.warehouse_location_id,
                    to_warehouse_id: branch.business_location_id,
                    date: new Date().toISOString().split('T')[0],
                    line_items: transferItems.map(item => ({
                        item_id: item.item_id,
                        name: item.name || '',
                        quantity_transfer: parseFloat(item.stock || item.quantity)
                    }))
                };

                console.log(`[Stock Migration] Transferring ${transferItems.length} items for ${branch.branch_name}`);
                const result = await zohoAPI.createTransferOrder(transferData);

                results.push({
                    branch_id: branch.branch_id,
                    branch_name: branch.branch_name,
                    success: true,
                    transfer_order_id: result.transfer_order?.transfer_order_id,
                    items_transferred: transferItems.length,
                    message: 'Transfer order created'
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

module.exports = { router, setPool };
