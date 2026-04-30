/**
 * requireCustomerAuth — gate /api/customer/me/* endpoints by a
 * server-persisted customer session token (Bearer header).
 *
 * On success, populates req.customer = { id, phone }.
 */
const customerAuth = require('../services/customer-auth');

async function requireCustomerAuth(req, res, next) {
    try {
        const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
        if (!token) {
            return res.status(401).json({ success: false, message: 'Customer authentication required' });
        }
        const session = await customerAuth.resolveSession(token);
        if (!session) {
            return res.status(401).json({ success: false, message: 'Invalid or expired customer session' });
        }
        req.customer = { id: session.customer_id, phone: session.phone };
        req.customerToken = token;
        next();
    } catch (err) {
        console.error('requireCustomerAuth error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = { requireCustomerAuth };
