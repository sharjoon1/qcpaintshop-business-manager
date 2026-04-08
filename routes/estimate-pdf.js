const express = require('express');
const router = express.Router();

let pool;
let puppeteerCore;
let chromiumPath;

function setPool(dbPool) { pool = dbPool; }

// Lazy-load puppeteer and find Chromium path
async function getPuppeteer() {
    if (!puppeteerCore) {
        puppeteerCore = require('puppeteer-core');
    }
    if (!chromiumPath) {
        // Try to find Chromium from the full puppeteer package (used by whatsapp-web.js)
        try {
            const puppeteerFull = require('puppeteer');
            chromiumPath = puppeteerFull.executablePath();
        } catch {
            // Fallback to common system paths
            const fs = require('fs');
            const paths = ['/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/chromium'];
            chromiumPath = paths.find(p => fs.existsSync(p));
        }
        if (!chromiumPath) {
            throw new Error('Chromium not found. Install puppeteer or chromium-browser.');
        }
        console.log('[Estimate PDF] Using Chromium at:', chromiumPath);
    }
    return { puppeteer: puppeteerCore, executablePath: chromiumPath };
}

// Auth helper: supports both Authorization header AND ?token= query param
async function authenticateRequest(req) {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
    if (!token) return null;
    const [sessions] = await pool.query(
        `SELECT s.*, u.id as user_id, u.username, u.role, u.full_name
         FROM user_sessions s JOIN users u ON s.user_id = u.id
         WHERE s.session_token = ? AND s.expires_at > NOW() AND u.status = 'active'`,
        [token]
    );
    return sessions.length > 0 ? sessions[0] : null;
}

// GET /api/estimates/:id/pdf
router.get('/:id/pdf', async (req, res) => {
    let browser;
    try {
        const user = await authenticateRequest(req);
        if (!user) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }

        // Verify estimate exists
        const [estimates] = await pool.query('SELECT estimate_number FROM estimates WHERE id = ?', [req.params.id]);
        if (estimates.length === 0) {
            return res.status(404).json({ success: false, message: 'Estimate not found' });
        }

        const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
        const { puppeteer, executablePath } = await getPuppeteer();

        browser = await puppeteer.launch({
            executablePath,
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        const page = await browser.newPage();

        // Build URL to the print page
        const protocol = req.protocol;
        const host = req.get('host');
        const isReceipt = req.query.receipt === '1';
        const isPO = req.query.po;
        let pageFile = 'estimate-print.html';
        if (isReceipt) pageFile = 'payment-receipt.html';
        let printUrl = `${protocol}://${host}/${pageFile}?id=${req.params.id}&mode=pdf&token=${token}`;
        if (isPO) printUrl += `&po=${isPO}&hide_payment=1`;

        await page.goto(printUrl, { waitUntil: 'networkidle0', timeout: 15000 });

        // Wait for content to render
        const waitSelector = isReceipt ? '#receiptContent' : '#printContent';
        await page.waitForSelector(waitSelector, { timeout: 15000 });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
            printBackground: true
        });

        let filename = `Estimate-${estimates[0].estimate_number || req.params.id}.pdf`;
        if (isReceipt) filename = `Receipt-${estimates[0].estimate_number || req.params.id}.pdf`;
        if (isPO) filename = `PO-${isPO}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error('PDF generation error:', error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Failed to generate PDF: ' + error.message });
        }
    } finally {
        if (browser) {
            try { await browser.close(); } catch {}
        }
    }
});

module.exports = { router, setPool };
