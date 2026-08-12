// Billing invoice/receipt PDF generation (Batch B1b — cashier print pipeline).
// Structural clone of routes/estimate-pdf.js: lazy Puppeteer bootstrap, ?token=
// auth helper, setPool convention. Mounted on /api/billing BEFORE the main
// billingRoutes router (precedent: the /api/estimates double-mount).
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
        console.log('[Billing PDF] Using Chromium at:', chromiumPath);
    }
    return { puppeteer: puppeteerCore, executablePath: chromiumPath };
}

// Auth helper: supports both Authorization header AND ?token= query param
// (Puppeteer navigates with ?token=, browsers open the URL directly).
async function authenticateRequest(req) {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
    if (!token) return null;
    const [sessions] = await pool.query(
        `SELECT s.*, u.id as user_id, u.username, u.role, u.full_name, u.branch_id
         FROM user_sessions s JOIN users u ON s.user_id = u.id
         WHERE s.token_hash = LOWER(SHA2(?, 256)) AND s.expires_at > NOW() AND u.status = 'active'`,
        [token]
    );
    return sessions.length > 0 ? sessions[0] : null;
}

// Branch isolation: full admins see all; branch staff may access only
// unassigned (NULL branch) invoices or their own branch's invoices.
function pdfBranchAllowed(user, invoiceBranchId) {
    if (!user) return false;
    if (['admin', 'administrator', 'super_admin'].includes(String(user.role || '').toLowerCase())) return true;
    if (invoiceBranchId === null || invoiceBranchId === undefined) return true;
    return Number(invoiceBranchId) === Number(user.branch_id);
}

// GET /api/billing/invoices/:id/pdf         → A4 sale bill  (billing-invoice-print.html, #printContent)
// GET /api/billing/invoices/:id/pdf?receipt=1 → sale receipt (billing-receipt.html, #receiptContent)
router.get('/invoices/:id/pdf', async (req, res) => {
    let browser;
    try {
        const user = await authenticateRequest(req);
        if (!user) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }

        // Verify invoice exists + enforce branch isolation (soft-deleted excluded)
        const [invoices] = await pool.query(
            'SELECT invoice_number, branch_id FROM billing_invoices WHERE id = ? AND deleted_at IS NULL',
            [req.params.id]
        );
        if (invoices.length === 0) {
            return res.status(404).json({ success: false, message: 'Invoice not found' });
        }
        if (!pdfBranchAllowed(user, invoices[0].branch_id)) {
            return res.status(403).json({ success: false, message: 'Not authorized for this invoice' });
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
        const pageFile = isReceipt ? 'billing-receipt.html' : 'billing-invoice-print.html';
        const printUrl = `${protocol}://${host}/${pageFile}?id=${req.params.id}&mode=pdf&token=${token}`;

        await page.goto(printUrl, { waitUntil: 'networkidle0', timeout: 15000 });

        // Wait for content to render
        const waitSelector = isReceipt ? '#receiptContent' : '#printContent';
        await page.waitForSelector(waitSelector, { timeout: 15000 });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
            printBackground: true
        });

        const number = invoices[0].invoice_number || req.params.id;
        const filename = isReceipt ? `Receipt-${number}.pdf` : `Invoice-${number}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error('Billing PDF generation error:', error);
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
