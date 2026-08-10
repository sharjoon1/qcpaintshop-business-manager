/**
 * E-7 regression test: bodyless / no-Content-Type POSTs must yield a clean 400
 * (or handler-defined status), never a 500 TypeError from `req.body` being
 * undefined.
 *
 * Express's json() parser leaves req.body undefined when the request has no
 * body / no JSON Content-Type. The global body-normalizer middleware in
 * server.js (added for E-7) sets req.body = {} so OTP/auth handlers that
 * destructure req.body keep working and return their intended validation
 * errors.
 */

const express = require('express');
const http = require('http');

// Replicate the server.js middleware order relevant to E-7
function buildApp() {
    const app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ limit: '10mb', extended: true }));
    app.use((req, res, next) => { if (req.body === undefined) req.body = {}; next(); });

    // Mimic routes/engineers.js send-otp + routes/painters/public.js send-otp style
    app.post('/api/test/send-otp', (req, res) => {
        try {
            const phone = String(req.body.phone || '').replace(/\D/g, '').slice(-10);
            if (!/^[6-9]\d{9}$/.test(phone)) {
                return res.status(400).json({ success: false, message: 'Enter a valid 10-digit Indian mobile number' });
            }
            res.json({ success: true, phone });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    // Mimic routes/auth.js login destructuring
    app.post('/api/test/login', (req, res) => {
        try {
            const { username, password } = req.body;
            if (!username || !password) return res.status(400).json({ success: false, message: 'Credentials required' });
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    return app;
}

function request(app, path, { method = 'POST', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const server = http.createServer(app);
        server.listen(0, () => {
            const port = server.address().port;
            const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    server.close();
                    resolve({ status: res.statusCode, body: data });
                });
            });
            req.on('error', reject);
            if (body !== undefined) req.write(body);
            req.end();
        });
    });
}

describe('E-7 bodyless request handling', () => {
    const app = buildApp();

    it('bodyless POST to send-otp returns 400 (not 500)', async () => {
        const res = await request(app, '/api/test/send-otp', { headers: {} });
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).success).toBe(false);
    });

    it('POST with non-JSON content-type (text/plain) returns 400 (not 500)', async () => {
        const res = await request(app, '/api/test/send-otp', {
            headers: { 'Content-Type': 'text/plain' },
            body: 'phone=9999999999'
        });
        expect(res.status).toBe(400);
    });

    it('valid JSON body still works', async () => {
        const res = await request(app, '/api/test/send-otp', {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: '9876543210' })
        });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).phone).toBe('9876543210');
    });

    it('bodyless POST to login returns 400 with credentials message', async () => {
        const res = await request(app, '/api/test/login', { headers: {} });
        expect(res.status).toBe(400);
        expect(JSON.parse(res.body).message).toBe('Credentials required');
    });
});
