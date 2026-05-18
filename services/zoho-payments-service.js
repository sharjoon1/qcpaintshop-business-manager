const https = require('https');

const BASE = 'https://payments.zoho.in/api/v1';
const TOKEN_URL = 'https://accounts.zoho.in/oauth/v2/token';

let _cachedToken = null;

function _token() {
    return _cachedToken || process.env.ZOHO_PAYMENTS_ACCESS_TOKEN;
}

async function _refreshToken() {
    const params = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: process.env.ZOHO_PAYMENTS_CLIENT_ID,
        client_secret: process.env.ZOHO_PAYMENTS_CLIENT_SECRET,
        refresh_token: process.env.ZOHO_PAYMENTS_REFRESH_TOKEN
    });
    return new Promise((resolve, reject) => {
        const url = `${TOKEN_URL}?${params}`;
        const u = new URL(url);
        const opts = { hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Length': 0 } };
        const req = https.request(opts, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try {
                    const body = JSON.parse(d);
                    if (body.access_token) { _cachedToken = body.access_token; resolve(_cachedToken); }
                    else reject(new Error('Token refresh failed: ' + JSON.stringify(body)));
                } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

function _request(method, url, body, token) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const payload = body ? JSON.stringify(body) : null;
        const opts = {
            hostname: u.hostname,
            path: u.pathname + u.search,
            method,
            headers: {
                'Authorization': `Zoho-oauthtoken ${token}`,
                'Content-Type': 'application/json',
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
            }
        };
        const req = https.request(opts, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
                catch { resolve({ status: res.statusCode, body: d }); }
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

async function _call(method, path, body = null, retried = false) {
    const token = _token();
    if (!token) throw new Error('ZOHO_PAYMENTS_ACCESS_TOKEN not set');
    const accountId = process.env.ZOHO_PAYMENTS_ACCOUNT_ID;
    if (!accountId) throw new Error('ZOHO_PAYMENTS_ACCOUNT_ID not set');
    const { status, body: resBody } = await _request(method, `${BASE}/accounts/${accountId}${path}`, body, token);
    if (status === 401 && !retried) {
        await _refreshToken();
        return _call(method, path, body, true);
    }
    if (status >= 400) throw new Error(`Zoho Payments ${status}: ${JSON.stringify(resBody)}`);
    return resBody;
}

async function createPaymentLink({ amount, description, customer = {}, expiryHours = 48 }) {
    if (!process.env.ZOHO_PAYMENTS_ACCOUNT_ID || !process.env.ZOHO_PAYMENTS_REFRESH_TOKEN) {
        throw new Error('Zoho Payments not configured — set ZOHO_PAYMENTS_* env vars');
    }
    const expiry = new Date(Date.now() + expiryHours * 3_600_000);
    const expiryStr = expiry.toISOString().replace(/\.\d{3}Z$/, '+05:30');

    const payload = { amount: parseFloat(amount), currency: 'INR', description, expiry_time: expiryStr };
    if (customer.name || customer.phone) {
        payload.customer = {};
        if (customer.name) payload.customer.name = customer.name;
        if (customer.phone) payload.customer.mobile = customer.phone;
    }

    const data = await _call('POST', '/paymentlinks', payload);
    const link = data.payment_link || data;
    return {
        link_id: link.link_id || link.id,
        link_url: link.link_url || link.url || link.short_url,
        status: link.status || 'active'
    };
}

async function getPaymentLinkStatus(link_id) {
    const data = await _call('GET', `/paymentlinks/${link_id}`);
    const link = data.payment_link || data;
    const payment = (link.payments || [])[0];
    return {
        status: link.status,
        paid_amount: link.paid_amount || link.amount_paid,
        payment_id: link.payment_id || (payment && payment.payment_id)
    };
}

module.exports = { createPaymentLink, getPaymentLinkStatus };
