/**
 * PURCHASE SUGGESTION SERVICE
 * Implements the three-tier Purchase Order & Reorder Point Suggestion System.
 *
 * Formulas (matching Kai Bot):
 *   Global Reorder Level = (totalSales / days) * 30 * numBranches
 *   Branch Threshold = max(minStock, round(globalReorderLevel * allocationPct / 100))
 *   Suggested Qty = (branchThreshold - currentStock) * multiplier
 *
 * Low-volume fallback: If monthly avg < threshold, use category default * numBranches
 */

const zohoAPI = require('./zoho-api');

let pool;

function setPool(dbPool) {
    pool = dbPool;
}

// ========================================
// CONFIG HELPERS
// ========================================

async function getConfig() {
    const [rows] = await pool.query(`
        SELECT config_key, config_value FROM zoho_config
        WHERE config_key LIKE 'purchase_suggestion_%'
    `);
    const config = {};
    for (const row of rows) {
        config[row.config_key] = row.config_value;
    }
    return {
        enabled: config.purchase_suggestion_enabled !== 'false',
        days: parseInt(config.purchase_suggestion_days) || 90,
        multiplier: parseFloat(config.purchase_suggestion_multiplier) || 1.5,
        lowVolumeThreshold: parseInt(config.purchase_suggestion_low_volume_threshold) || 5,
        branchCount: parseInt(config.purchase_suggestion_branch_count) || 5
    };
}

// ========================================
// DATA ACCESS
// ========================================

async function getBranchAllocations() {
    const [rows] = await pool.query(`
        SELECT id, branch_name, zoho_location_id, allocation_pct, min_stock, is_active, sort_order
        FROM zoho_branch_allocations
        WHERE is_active = 1
        ORDER BY sort_order
    `);
    return rows;
}

async function getCategoryDefaults() {
    const [rows] = await pool.query(`
        SELECT id, category_name, default_reorder_qty, is_active
        FROM zoho_category_defaults
        WHERE is_active = 1
    `);
    const map = {};
    for (const row of rows) {
        map[row.category_name.toLowerCase()] = row.default_reorder_qty;
    }
    return map;
}

async function getCurrentStock() {
    const [rows] = await pool.query(`
        SELECT zoho_item_id, zoho_location_id, item_name, sku, stock_on_hand
        FROM zoho_location_stock
    `);
    // Build a map: { itemId_locationId -> { stock_on_hand, item_name, sku } }
    const map = {};
    for (const row of rows) {
        const key = `${row.zoho_item_id}_${row.zoho_location_id}`;
        map[key] = {
            stock_on_hand: parseFloat(row.stock_on_hand) || 0,
            item_name: row.item_name,
            sku: row.sku
        };
    }
    return map;
}

async function getItemCategories() {
    const [rows] = await pool.query(`
        SELECT zoho_item_id, zoho_item_name, zoho_sku, zoho_category_name
        FROM zoho_items_map
    `);
    const map = {};
    for (const row of rows) {
        map[row.zoho_item_id] = {
            name: row.zoho_item_name,
            sku: row.zoho_sku,
            category: row.zoho_category_name || 'Other'
        };
    }
    return map;
}

// ========================================
// CORE CALCULATION ENGINE
// ========================================

/**
 * Calculate global reorder levels from sales data
 * Formula: (totalSales / days) * 30 * numBranches
 * Low-volume fallback: If monthly avg < threshold, use categoryDefault * numBranches
 */
function calculateGlobalReorderLevels(salesData, categoryDefaults, itemCategories, options) {
    const { days, lowVolumeThreshold, branchCount } = options;
    const levels = {};

    for (const item of salesData) {
        const itemId = item.item_id || item.zoho_item_id;
        if (!itemId) continue;

        const totalSales = parseFloat(item.quantity_sold) || 0;
        const dailyAvg = totalSales / days;
        const monthlyAvg = dailyAvg * 30;

        let globalReorderLevel;
        let usedDefault = false;

        if (monthlyAvg < lowVolumeThreshold) {
            // Low-volume fallback: use category default
            const itemInfo = itemCategories[itemId] || {};
            const category = (itemInfo.category || 'Other').toLowerCase();
            const categoryDefault = categoryDefaults[category] || categoryDefaults['other'] || 10;
            globalReorderLevel = categoryDefault * branchCount;
            usedDefault = true;
        } else {
            // Standard formula: (totalSales / days) * 30 * numBranches
            globalReorderLevel = dailyAvg * 30 * branchCount;
        }

        levels[itemId] = {
            globalReorderLevel: Math.round(globalReorderLevel * 100) / 100,
            dailyAvg: Math.round(dailyAvg * 10000) / 10000,
            totalSales,
            usedDefault,
            itemName: item.item_name || (itemCategories[itemId] || {}).name || '',
            sku: item.sku || (itemCategories[itemId] || {}).sku || '',
            category: (itemCategories[itemId] || {}).category || 'Other'
        };
    }

    return levels;
}

/**
 * Calculate per-branch allocation thresholds
 * Formula: max(minStock, round(globalReorderLevel * allocationPct / 100))
 */
function calculateBranchAllocations(globalLevels, branchAllocations) {
    const results = [];

    for (const [itemId, level] of Object.entries(globalLevels)) {
        for (const branch of branchAllocations) {
            if (!branch.zoho_location_id) continue;

            const branchThreshold = Math.max(
                branch.min_stock,
                Math.round(level.globalReorderLevel * branch.allocation_pct / 100)
            );

            results.push({
                zoho_item_id: itemId,
                zoho_location_id: branch.zoho_location_id,
                branch_name: branch.branch_name,
                branchThreshold,
                globalReorderLevel: level.globalReorderLevel,
                dailyAvg: level.dailyAvg,
                totalSales: level.totalSales,
                usedDefault: level.usedDefault,
                itemName: level.itemName,
                sku: level.sku,
                category: level.category
            });
        }
    }

    return results;
}

/**
 * Generate purchase suggestions by comparing thresholds vs current stock
 * Only creates suggestions where currentStock < branchThreshold
 * Priority: HIGH if stock==0, MEDIUM if stock < globalReorder*0.3, LOW otherwise
 */
function generatePurchaseSuggestions(branchThresholds, currentStockMap, multiplier) {
    const suggestions = [];

    for (const item of branchThresholds) {
        const stockKey = `${item.zoho_item_id}_${item.zoho_location_id}`;
        const stockInfo = currentStockMap[stockKey];
        const currentStock = stockInfo ? stockInfo.stock_on_hand : 0;

        if (currentStock < item.branchThreshold) {
            const deficit = item.branchThreshold - currentStock;
            const suggestedQty = Math.round(deficit * multiplier * 100) / 100;

            let priority = 'LOW';
            if (currentStock === 0) {
                priority = 'HIGH';
            } else if (currentStock < item.globalReorderLevel * 0.3) {
                priority = 'MEDIUM';
            }

            suggestions.push({
                zoho_item_id: item.zoho_item_id,
                item_name: item.itemName || (stockInfo ? stockInfo.item_name : ''),
                sku: item.sku || (stockInfo ? stockInfo.sku : ''),
                category_name: item.category,
                zoho_location_id: item.zoho_location_id,
                branch_name: item.branch_name,
                global_reorder_level: item.globalReorderLevel,
                branch_reorder_threshold: item.branchThreshold,
                current_stock: currentStock,
                suggested_qty: suggestedQty,
                priority,
                total_sales_90d: item.totalSales,
                daily_avg_sales: item.dailyAvg,
                used_category_default: item.usedDefault ? 1 : 0
            });
        }
    }

    // Sort by priority: HIGH first, then MEDIUM, then LOW
    const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return suggestions;
}

// ========================================
// ORCHESTRATION
// ========================================

/**
 * Run full calculation pipeline:
 * 1. Fetch 90-day sales from Zoho
 * 2. Read branch allocations & category defaults from DB
 * 3. Read current stock from zoho_location_stock
 * 4. Calculate global reorder levels
 * 5. Calculate branch allocations
 * 6. Generate suggestions
 * 7. Save to zoho_purchase_suggestions
 */
async function runFullCalculation(triggeredBy) {
    const config = await getConfig();
    if (!config.enabled) {
        throw new Error('Purchase suggestion system is disabled');
    }

    // 1. Calculate date range
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - config.days);

    const formatDate = (d) => d.toISOString().split('T')[0];

    // 2. Fetch sales data from Zoho
    let salesData;
    try {
        const salesReport = await zohoAPI.getSalesByItem(formatDate(fromDate), formatDate(toDate));
        // Zoho returns sales_by_item array in the response
        salesData = salesReport.sales || salesReport.sales_by_item || salesReport || [];
        if (!Array.isArray(salesData)) {
            // If it's wrapped in a response object, try to extract
            if (salesReport.data && Array.isArray(salesReport.data)) {
                salesData = salesReport.data;
            } else if (salesReport.sales_by_item && Array.isArray(salesReport.sales_by_item)) {
                salesData = salesReport.sales_by_item;
            } else {
                salesData = [];
            }
        }
    } catch (err) {
        throw new Error('Failed to fetch sales data from Zoho: ' + err.message);
    }

    if (salesData.length === 0) {
        throw new Error('No sales data returned from Zoho for the last ' + config.days + ' days');
    }

    // 3. Read config data from DB
    const [branchAllocs, categoryDefs, currentStockMap, itemCategories] = await Promise.all([
        getBranchAllocations(),
        getCategoryDefaults(),
        getCurrentStock(),
        getItemCategories()
    ]);

    if (branchAllocs.length === 0) {
        throw new Error('No active branch allocations configured');
    }

    // 4. Calculate global reorder levels
    const globalLevels = calculateGlobalReorderLevels(salesData, categoryDefs, itemCategories, {
        days: config.days,
        lowVolumeThreshold: config.lowVolumeThreshold,
        branchCount: config.branchCount
    });

    // 5. Calculate per-branch thresholds
    const branchThresholds = calculateBranchAllocations(globalLevels, branchAllocs);

    // 6. Generate suggestions
    const suggestions = generatePurchaseSuggestions(branchThresholds, currentStockMap, config.multiplier);

    // 7. Save to database with unique batch ID
    const batchId = 'PS-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);

    if (suggestions.length > 0) {
        const values = suggestions.map(s => [
            batchId, s.zoho_item_id, s.item_name, s.sku, s.category_name,
            s.zoho_location_id, s.branch_name, s.global_reorder_level,
            s.branch_reorder_threshold, s.current_stock, s.suggested_qty,
            s.priority, s.total_sales_90d, s.daily_avg_sales,
            s.used_category_default
        ]);

        await pool.query(`
            INSERT INTO zoho_purchase_suggestions
            (batch_id, zoho_item_id, item_name, sku, category_name,
             zoho_location_id, branch_name, global_reorder_level,
             branch_reorder_threshold, current_stock, suggested_qty,
             priority, total_sales_90d, daily_avg_sales, used_category_default)
            VALUES ?
        `, [values]);
    }

    // Build summary
    const summary = {
        batchId,
        totalItems: Object.keys(globalLevels).length,
        totalSuggestions: suggestions.length,
        highPriority: suggestions.filter(s => s.priority === 'HIGH').length,
        mediumPriority: suggestions.filter(s => s.priority === 'MEDIUM').length,
        lowPriority: suggestions.filter(s => s.priority === 'LOW').length,
        categoryDefaultsUsed: suggestions.filter(s => s.used_category_default).length,
        salesDays: config.days,
        salesDataItems: salesData.length,
        branches: branchAllocs.length,
        calculatedAt: new Date().toISOString()
    };

    return summary;
}

// ========================================
// QUERY HELPERS
// ========================================

async function getLatestBatchId() {
    const [rows] = await pool.query(`
        SELECT batch_id FROM zoho_purchase_suggestions
        ORDER BY created_at DESC LIMIT 1
    `);
    return rows.length > 0 ? rows[0].batch_id : null;
}

async function getSuggestionsByBatch(batchId, filters = {}) {
    let where = 'WHERE ps.batch_id = ?';
    const params = [batchId];

    if (filters.branch) {
        where += ' AND ps.branch_name = ?';
        params.push(filters.branch);
    }
    if (filters.priority) {
        where += ' AND ps.priority = ?';
        params.push(filters.priority);
    }
    if (filters.status) {
        where += ' AND ps.status = ?';
        params.push(filters.status);
    }
    if (filters.search) {
        where += ' AND (ps.item_name LIKE ? OR ps.sku LIKE ?)';
        params.push(`%${filters.search}%`, `%${filters.search}%`);
    }

    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 50;
    const offset = (page - 1) * limit;

    const [rows] = await pool.query(`
        SELECT ps.*
        FROM zoho_purchase_suggestions ps
        ${where}
        ORDER BY FIELD(ps.priority, 'HIGH', 'MEDIUM', 'LOW'), ps.branch_name, ps.item_name
        LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const [countResult] = await pool.query(`
        SELECT COUNT(*) as total FROM zoho_purchase_suggestions ps ${where}
    `, params);

    return {
        suggestions: rows,
        total: countResult[0].total,
        page,
        limit,
        totalPages: Math.ceil(countResult[0].total / limit)
    };
}

async function getSuggestionSummary(batchId) {
    const [rows] = await pool.query(`
        SELECT
            COUNT(*) as total,
            COUNT(CASE WHEN priority = 'HIGH' THEN 1 END) as high_count,
            COUNT(CASE WHEN priority = 'MEDIUM' THEN 1 END) as medium_count,
            COUNT(CASE WHEN priority = 'LOW' THEN 1 END) as low_count,
            COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
            COUNT(CASE WHEN status = 'ordered' THEN 1 END) as ordered_count,
            COUNT(CASE WHEN status = 'dismissed' THEN 1 END) as dismissed_count,
            COUNT(CASE WHEN used_category_default = 1 THEN 1 END) as defaults_used,
            COUNT(DISTINCT branch_name) as branch_count,
            COUNT(DISTINCT zoho_item_id) as unique_items,
            MIN(created_at) as created_at
        FROM zoho_purchase_suggestions
        WHERE batch_id = ?
    `, [batchId]);

    return rows[0];
}

async function getSuggestionHistory(filters = {}) {
    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 20;
    const offset = (page - 1) * limit;

    const [rows] = await pool.query(`
        SELECT
            batch_id,
            COUNT(*) as total_suggestions,
            COUNT(CASE WHEN priority = 'HIGH' THEN 1 END) as high_count,
            COUNT(CASE WHEN priority = 'MEDIUM' THEN 1 END) as medium_count,
            COUNT(CASE WHEN priority = 'LOW' THEN 1 END) as low_count,
            COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
            COUNT(CASE WHEN status = 'ordered' THEN 1 END) as ordered_count,
            COUNT(CASE WHEN status = 'dismissed' THEN 1 END) as dismissed_count,
            COUNT(DISTINCT branch_name) as branch_count,
            COUNT(DISTINCT zoho_item_id) as unique_items,
            MIN(created_at) as created_at
        FROM zoho_purchase_suggestions
        GROUP BY batch_id
        ORDER BY MIN(created_at) DESC
        LIMIT ? OFFSET ?
    `, [limit, offset]);

    const [countResult] = await pool.query(`
        SELECT COUNT(DISTINCT batch_id) as total FROM zoho_purchase_suggestions
    `);

    return {
        batches: rows,
        total: countResult[0].total,
        page,
        limit,
        totalPages: Math.ceil(countResult[0].total / limit)
    };
}

async function dismissSuggestion(id) {
    const [result] = await pool.query(`
        UPDATE zoho_purchase_suggestions SET status = 'dismissed' WHERE id = ? AND status = 'pending'
    `, [id]);
    return result.affectedRows > 0;
}

async function markOrdered(id) {
    const [result] = await pool.query(`
        UPDATE zoho_purchase_suggestions SET status = 'ordered' WHERE id = ? AND status = 'pending'
    `, [id]);
    return result.affectedRows > 0;
}

async function bulkDismiss(ids) {
    if (!ids || ids.length === 0) return 0;
    const [result] = await pool.query(`
        UPDATE zoho_purchase_suggestions SET status = 'dismissed'
        WHERE id IN (?) AND status = 'pending'
    `, [ids]);
    return result.affectedRows;
}

async function bulkMarkOrdered(ids) {
    if (!ids || ids.length === 0) return 0;
    const [result] = await pool.query(`
        UPDATE zoho_purchase_suggestions SET status = 'ordered'
        WHERE id IN (?) AND status = 'pending'
    `, [ids]);
    return result.affectedRows;
}

// ========================================
// BRANCH ALLOCATION MANAGEMENT
// ========================================

async function updateBranchAllocations(allocations) {
    // Validate total = 100%
    const total = allocations.reduce((sum, a) => sum + parseFloat(a.allocation_pct), 0);
    if (Math.abs(total - 100) > 0.1) {
        throw new Error(`Allocation percentages must sum to 100%. Current total: ${total.toFixed(2)}%`);
    }

    for (const alloc of allocations) {
        await pool.query(`
            UPDATE zoho_branch_allocations
            SET allocation_pct = ?, min_stock = ?
            WHERE id = ?
        `, [alloc.allocation_pct, alloc.min_stock || 5, alloc.id]);
    }

    return { updated: allocations.length };
}

// ========================================
// CATEGORY DEFAULTS MANAGEMENT
// ========================================

async function getAllCategoryDefaults() {
    const [rows] = await pool.query(`
        SELECT * FROM zoho_category_defaults ORDER BY category_name
    `);
    return rows;
}

async function updateCategoryDefault(id, data) {
    const [result] = await pool.query(`
        UPDATE zoho_category_defaults
        SET category_name = ?, default_reorder_qty = ?, is_active = ?
        WHERE id = ?
    `, [data.category_name, data.default_reorder_qty, data.is_active !== undefined ? data.is_active : 1, id]);
    return result.affectedRows > 0;
}

async function createCategoryDefault(data) {
    const [result] = await pool.query(`
        INSERT INTO zoho_category_defaults (category_name, default_reorder_qty)
        VALUES (?, ?)
    `, [data.category_name, data.default_reorder_qty || 10]);
    return { id: result.insertId };
}

async function deleteCategoryDefault(id) {
    const [result] = await pool.query(`
        DELETE FROM zoho_category_defaults WHERE id = ?
    `, [id]);
    return result.affectedRows > 0;
}

module.exports = {
    setPool,
    getConfig,
    getBranchAllocations,
    getCategoryDefaults,
    getAllCategoryDefaults,
    calculateGlobalReorderLevels,
    calculateBranchAllocations,
    generatePurchaseSuggestions,
    runFullCalculation,
    getLatestBatchId,
    getSuggestionsByBatch,
    getSuggestionSummary,
    getSuggestionHistory,
    dismissSuggestion,
    markOrdered,
    bulkDismiss,
    bulkMarkOrdered,
    updateBranchAllocations,
    updateCategoryDefault,
    createCategoryDefault,
    deleteCategoryDefault
};
