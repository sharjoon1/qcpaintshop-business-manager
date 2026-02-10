const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/permissionMiddleware');

let pool;

// Initialize with database pool
function setPool(dbPool) {
    pool = dbPool;
}

/**
 * Generate unique request number
 * Format: REQ-YYYYMMDD-XXXX
 */
async function generateRequestNumber() {
    const datePrefix = new Date().toISOString().split('T')[0].replace(/-/g, '');
    
    const [lastRequest] = await pool.query(
        'SELECT request_number FROM estimate_requests WHERE request_number LIKE ? ORDER BY id DESC LIMIT 1',
        [`REQ${datePrefix}%`]
    );
    
    let requestNumber;
    if (lastRequest.length > 0) {
        const lastNum = parseInt(lastRequest[0].request_number.slice(-4));
        requestNumber = `REQ${datePrefix}${String(lastNum + 1).padStart(4, '0')}`;
    } else {
        requestNumber = `REQ${datePrefix}0001`;
    }
    
    return requestNumber;
}

/**
 * GET /api/estimate-requests
 * Get all estimate requests (with filters)
 */
router.get('/', requireAuth, async (req, res) => {
    try {
        const { status, priority, assigned_to, search, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT er.*, 
                   u.full_name as assigned_to_name,
                   COUNT(erp.id) as photo_count
            FROM estimate_requests er
            LEFT JOIN users u ON er.assigned_to_user_id = u.id
            LEFT JOIN estimate_request_photos erp ON er.id = erp.request_id
        `;
        
        const conditions = [];
        const params = [];
        
        if (status) {
            conditions.push('er.status = ?');
            params.push(status);
        }
        
        if (priority) {
            conditions.push('er.priority = ?');
            params.push(priority);
        }
        
        if (assigned_to) {
            conditions.push('er.assigned_to_user_id = ?');
            params.push(assigned_to);
        }
        
        if (search) {
            conditions.push('(er.customer_name LIKE ? OR er.phone LIKE ? OR er.request_number LIKE ?)');
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern, searchPattern);
        }
        
        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        
        query += ' GROUP BY er.id ORDER BY er.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const [requests] = await pool.query(query, params);
        
        // Get total count
        let countQuery = 'SELECT COUNT(*) as total FROM estimate_requests er';
        if (conditions.length > 0) {
            countQuery += ' WHERE ' + conditions.join(' AND ');
        }
        const [countResult] = await pool.query(countQuery, params.slice(0, -2));
        
        res.json({
            success: true,
            data: requests,
            pagination: {
                total: countResult[0].total,
                limit: parseInt(limit),
                offset: parseInt(offset)
            }
        });
        
    } catch (error) {
        console.error('Get estimate requests error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/estimate-requests/:id
 * Get single estimate request with full details
 */
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const requestId = req.params.id;
        
        // Get request details
        const [requests] = await pool.query(`
            SELECT er.*, 
                   u.full_name as assigned_to_name,
                   u.email as assigned_to_email
            FROM estimate_requests er
            LEFT JOIN users u ON er.assigned_to_user_id = u.id
            WHERE er.id = ? OR er.request_number = ?
        `, [requestId, requestId]);
        
        if (requests.length === 0) {
            return res.status(404).json({ success: false, error: 'Request not found' });
        }
        
        const request = requests[0];
        
        // Get photos
        const [photos] = await pool.query(
            'SELECT * FROM estimate_request_photos WHERE request_id = ? ORDER BY uploaded_at',
            [request.id]
        );
        
        // Get products (if method is 'product')
        const [products] = await pool.query(
            'SELECT * FROM estimate_request_products WHERE request_id = ? ORDER BY id',
            [request.id]
        );
        
        // Get activity log
        const [activity] = await pool.query(`
            SELECT era.*, u.full_name as user_name
            FROM estimate_request_activity era
            LEFT JOIN users u ON era.user_id = u.id
            WHERE era.request_id = ?
            ORDER BY era.created_at DESC
        `, [request.id]);
        
        res.json({
            success: true,
            data: {
                ...request,
                photos: photos,
                products: products,
                activity: activity
            }
        });
        
    } catch (error) {
        console.error('Get estimate request error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/estimate-requests
 * Create new estimate request (public endpoint)
 * Supports both 'simple' and 'product' methods
 */
router.post('/', async (req, res) => {
    try {
        const {
            customer_name,
            phone,
            email,
            project_type,
            property_type,
            location,
            area_sqft,
            rooms,
            preferred_brand,
            timeline,
            budget_range,
            additional_notes,
            method,
            request_method,
            products,
            products_json
        } = req.body;
        
        // Validation
        if (!customer_name || !phone) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing required fields: customer_name, phone' 
            });
        }
        
        // Method-specific validation
        const requestMethod = request_method || method || 'simple';
        
        if (requestMethod === 'simple') {
            if (!project_type || !location || !area_sqft) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Simple method requires: project_type, location, area_sqft' 
                });
            }
        } else if (requestMethod === 'product' || requestMethod === 'product_available' || requestMethod === 'product_custom') {
            // Product-based requests have different requirements
            if (requestMethod === 'product_available' && !products_json) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Product-based request requires products_json' 
                });
            }
        }
        
        // Validate phone
        if (!/^[6-9]\d{9}$/.test(phone)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid phone number. Must be 10 digits starting with 6-9' 
            });
        }
        
        // Generate request number
        const request_number = await generateRequestNumber();
        
        // Insert request
        const productsJsonData = products_json || (products ? JSON.stringify({ items: products }) : null);
        
        const [result] = await pool.query(`
            INSERT INTO estimate_requests (
                request_number, customer_name, phone, email,
                project_type, property_type, location, area_sqft, rooms,
                preferred_brand, timeline, budget_range, additional_notes, products_json,
                status, priority, source, request_method, ip_address, user_agent
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 'medium', 'website', ?, ?, ?)
        `, [
            request_number, customer_name, phone, email,
            project_type || 'interior', property_type || 'house', location || 'To be confirmed', 
            area_sqft || 0, rooms,
            preferred_brand, timeline, budget_range, additional_notes, productsJsonData,
            requestMethod, req.ip, req.get('user-agent')
        ]);
        
        const requestId = result.insertId;
        
        // Insert products if method is 'product'
        if (requestMethod === 'product' && products) {
            const productList = typeof products === 'string' ? JSON.parse(products) : products;
            
            for (const product of productList) {
                await pool.query(`
                    INSERT INTO estimate_request_products (
                        request_id, product_id, product_name, calculation_type,
                        pack_size, quantity, area_sqft, coats, raw_data
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    requestId,
                    product.product_id,
                    product.product_name,
                    product.type,
                    product.raw_data?.pack_size || null,
                    product.raw_data?.quantity || null,
                    product.raw_data?.sqft || null,
                    product.raw_data?.coats || null,
                    JSON.stringify(product.raw_data)
                ]);
            }
        }
        
        // Log activity
        await pool.query(`
            INSERT INTO estimate_request_activity (request_id, action, notes)
            VALUES (?, 'created', ?)
        `, [requestId, `Request submitted via website (${requestMethod} method)`]);
        
        res.status(201).json({
            success: true,
            message: 'Estimate request submitted successfully',
            request_id: requestId,
            request_number: request_number
        });
        
    } catch (error) {
        console.error('Create estimate request error:', error);
        res.status(500).json({ success: false, error: 'Failed to submit request' });
    }
});

/**
 * PATCH /api/estimate-requests/:id/status
 * Update request status
 */
router.patch('/:id/status', requireAuth, async (req, res) => {
    try {
        const requestId = req.params.id;
        const { status, notes, user_id } = req.body;
        
        if (!status) {
            return res.status(400).json({ success: false, error: 'Status is required' });
        }
        
        // Get current request
        const [current] = await pool.query('SELECT * FROM estimate_requests WHERE id = ?', [requestId]);
        if (current.length === 0) {
            return res.status(404).json({ success: false, error: 'Request not found' });
        }
        
        const oldStatus = current[0].status;
        
        // Update status
        const updates = { status };
        
        if (status === 'contacted') {
            updates.contacted_at = new Date();
        } else if (status === 'quote_sent') {
            updates.quote_sent_at = new Date();
        }
        
        await pool.query('UPDATE estimate_requests SET ? WHERE id = ?', [updates, requestId]);
        
        // Log activity
        await pool.query(`
            INSERT INTO estimate_request_activity (request_id, user_id, action, old_value, new_value, notes)
            VALUES (?, ?, 'status_changed', ?, ?, ?)
        `, [requestId, user_id || null, oldStatus, status, notes || null]);
        
        res.json({ success: true, message: 'Status updated successfully' });
        
    } catch (error) {
        console.error('Update status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PATCH /api/estimate-requests/:id/assign
 * Assign request to staff member
 */
router.patch('/:id/assign', requireAuth, async (req, res) => {
    try {
        const requestId = req.params.id;
        const { assigned_to_user_id, notes, user_id } = req.body;
        
        // Update assignment
        await pool.query(`
            UPDATE estimate_requests 
            SET assigned_to_user_id = ?, assigned_at = ?
            WHERE id = ?
        `, [assigned_to_user_id, new Date(), requestId]);
        
        // Log activity
        await pool.query(`
            INSERT INTO estimate_request_activity (request_id, user_id, action, new_value, notes)
            VALUES (?, ?, 'assigned', ?, ?)
        `, [requestId, user_id || null, assigned_to_user_id, notes || `Assigned to user ${assigned_to_user_id}`]);
        
        res.json({ success: true, message: 'Request assigned successfully' });
        
    } catch (error) {
        console.error('Assign request error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PATCH /api/estimate-requests/:id
 * Update request (general - for converting to estimate)
 */
router.patch('/:id', requireAuth, async (req, res) => {
    try {
        const requestId = req.params.id;
        const { status, estimate_id } = req.body;
        
        const updates = {};
        
        if (status) {
            updates.status = status;
            
            if (status === 'contacted' && !updates.contacted_at) {
                updates.contacted_at = new Date();
            } else if (status === 'quote_sent' && !updates.quote_sent_at) {
                updates.quote_sent_at = new Date();
            }
        }
        
        if (estimate_id) {
            updates.estimate_id = estimate_id;
        }
        
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ success: false, error: 'No updates provided' });
        }
        
        await pool.query('UPDATE estimate_requests SET ? WHERE id = ?', [updates, requestId]);
        
        res.json({ success: true, message: 'Request updated successfully' });
        
    } catch (error) {
        console.error('Update request error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/estimate-requests/:id/notes
 * Add note to request
 */
router.post('/:id/notes', requireAuth, async (req, res) => {
    try {
        const requestId = req.params.id;
        const { notes, user_id } = req.body;
        
        if (!notes) {
            return res.status(400).json({ success: false, error: 'Notes are required' });
        }
        
        // Log activity
        await pool.query(`
            INSERT INTO estimate_request_activity (request_id, user_id, action, notes)
            VALUES (?, ?, 'note_added', ?)
        `, [requestId, user_id || null, notes]);
        
        res.json({ success: true, message: 'Note added successfully' });
        
    } catch (error) {
        console.error('Add note error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/estimate-requests/stats/summary
 * Get dashboard statistics
 */
router.get('/stats/summary', requireAuth, async (req, res) => {
    try {
        const [stats] = await pool.query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_requests,
                SUM(CASE WHEN status = 'contacted' THEN 1 ELSE 0 END) as contacted,
                SUM(CASE WHEN status = 'quote_sent' THEN 1 ELSE 0 END) as quotes_sent,
                SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted,
                SUM(CASE WHEN created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 ELSE 0 END) as last_24h,
                SUM(CASE WHEN created_at > DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as last_7days
            FROM estimate_requests
        `);
        
        res.json({ success: true, data: stats[0] });
        
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = {
    router,
    setPool
};
