const express = require('express');
const router = express.Router();
const { requirePermission } = require('../middleware/permissionMiddleware');
const { computeFinalPrice, groupRowsForPdf, generatePriceListPdf } = require('../services/price-list-pdf-generator');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sessionManager = require('../services/whatsapp-session-manager');

let pool;
function setPool(p) { pool = p; }

const BRAND_LABELS = {
    birlaopus: 'Birla Opus',
    asian:     'Asian Paints',
    berger:    'Berger Paints',
    gem:       'Gem Paints',
    jsw:       'JSW Paints',
    nippon:    'Nippon Paint',
};

const perm = requirePermission('zoho', 'manage');

// ─── GET /brands ─────────────────────────────────────────────────────────────
router.get('/brands', perm, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT brand, parsed_count, effective_date, parsed_rows
             FROM brand_dpl_lists
             WHERE parsed_rows IS NOT NULL
             ORDER BY brand`
        );

        const data = rows
            .map(row => {
                let parsedRows = [];
                try {
                    parsedRows = typeof row.parsed_rows === 'string'
                        ? JSON.parse(row.parsed_rows)
                        : (row.parsed_rows || []);
                } catch (e) { /* leave empty */ }

                const categories = [...new Set(
                    parsedRows.map(r => r.category).filter(Boolean)
                )].sort();

                const effDate = row.effective_date
                    ? (typeof row.effective_date === 'string'
                        ? row.effective_date
                        : new Date(row.effective_date).toISOString().slice(0, 10))
                    : null;

                return {
                    brand: row.brand,
                    label: BRAND_LABELS[row.brand] || row.brand,
                    effective_date: effDate,
                    item_count: row.parsed_count || 0,
                    categories,
                };
            })
            .filter(b => b.item_count > 0);

        res.json({ success: true, data });
    } catch (err) {
        console.error('[price-list] GET /brands:', err);
        res.status(500).json({ success: false, message: 'Failed to load brands' });
    }
});

// ─── GET /items ───────────────────────────────────────────────────────────────
router.get('/items', perm, async (req, res) => {
    try {
        const raw = typeof req.query.brands === 'string' ? req.query.brands : '';
        const requested = raw.split(',').map(b => b.trim().toLowerCase()).filter(Boolean);

        const VALID_BRANDS = Object.keys(BRAND_LABELS);
        const validated = requested.filter(b => VALID_BRANDS.includes(b)).slice(0, 6);
        if (validated.length === 0) {
            return res.status(400).json({ success: false, message: 'No valid brands supplied' });
        }

        const data = [];
        for (const brand of validated) {
            const [rows] = await pool.query(
                'SELECT parsed_rows FROM brand_dpl_lists WHERE brand = ? AND parsed_rows IS NOT NULL AND parsed_count > 0',
                [brand]
            );
            if (!rows.length || !rows[0].parsed_rows) continue;

            let parsedRows;
            try {
                parsedRows = typeof rows[0].parsed_rows === 'string'
                    ? JSON.parse(rows[0].parsed_rows) : rows[0].parsed_rows;
            } catch (e) { continue; }

            for (const r of parsedRows) {
                data.push({
                    brand,
                    brandLabel: BRAND_LABELS[brand],
                    category:   (r.category || 'Other').trim(),
                    product:    r.product || '',
                    colourName: r.colourName || '',
                    packSize:   r.packSize || '',
                    dpl:        parseFloat(r.dpl) || 0,
                });
            }
        }

        data.sort((a, b) => {
            const br = a.brand.localeCompare(b.brand, 'en');
            if (br !== 0) return br;
            const ca = a.category.localeCompare(b.category, 'en');
            if (ca !== 0) return ca;
            const pr = a.product.localeCompare(b.product, 'en');
            return pr !== 0 ? pr : a.packSize.localeCompare(b.packSize, 'en', { numeric: true });
        });

        res.json({ success: true, data });
    } catch (err) {
        console.error('[price-list] GET /items:', err);
        res.status(500).json({ success: false, message: 'Failed to load items' });
    }
});

// ─── POST /generate ───────────────────────────────────────────────────────────
router.post('/generate', perm, async (req, res) => {
    try {
        let { customer_name, whatsapp_number, markup_percent, effective_date, items } = req.body;

        if (!customer_name || typeof customer_name !== 'string' || !customer_name.trim()) {
            return res.status(400).json({ success: false, message: 'customer_name is required' });
        }
        customer_name = customer_name.trim().slice(0, 100);
        const safeName = customer_name.replace(/[^a-zA-Z0-9\-_]/g, '_');

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'items must be a non-empty array' });
        }
        if (items.length > 500) {
            return res.status(400).json({ success: false, message: 'Too many items (max 500)' });
        }

        const markupPct = parseFloat(markup_percent);
        if (isNaN(markupPct) || markupPct < -99 || markupPct > 200) {
            return res.status(400).json({ success: false, message: 'markup_percent must be between -99 and 200' });
        }

        const VALID_BRANDS = Object.keys(BRAND_LABELS);
        for (const item of items) {
            if (!item.brand || !VALID_BRANDS.includes(item.brand)) {
                return res.status(400).json({ success: false, message: 'Invalid brand in items' });
            }
            if (typeof item.dpl !== 'number' || item.dpl < 0) {
                return res.status(400).json({ success: false, message: 'items[].dpl must be a number >= 0' });
            }
        }

        let waNumber = null;
        if (whatsapp_number) {
            const digits = String(whatsapp_number).replace(/\D/g, '');
            const normalized = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits;
            if (normalized.length === 10) waNumber = normalized;
        }

        const withPrice = items.map(item => ({
            product:    item.product || '',
            category:   item.category || 'Other',
            colourName: item.colourName || '',
            packSize:   item.packSize || '',
            finalPrice: computeFinalPrice(item.dpl, markupPct),
        }));

        const brandMap = new Map();
        for (let i = 0; i < items.length; i++) {
            const brand = items[i].brand;
            const label = items[i].brandLabel || BRAND_LABELS[brand] || brand;
            if (!brandMap.has(brand)) brandMap.set(brand, { label, rows: [] });
            brandMap.get(brand).rows.push(withPrice[i]);
        }

        const brandGroups = [];
        for (const [, { label, rows }] of brandMap) {
            brandGroups.push(groupRowsForPdf(rows, label));
        }

        const pdfBuffer = await generatePriceListPdf(brandGroups, {
            customerName: customer_name,
            markupPercent: markupPct,
            effectiveDate: effective_date || new Date().toISOString().slice(0, 10),
        });

        if (waNumber) {
            let tmpPath = null;
            try {
                const tmpDir = path.join(os.tmpdir(), 'qc-price-lists');
                fs.mkdirSync(tmpDir, { recursive: true });
                tmpPath = path.join(tmpDir, `PL-${safeName}-${Date.now()}.pdf`);
                fs.writeFileSync(tmpPath, pdfBuffer);

                const markupSign = markupPct >= 0 ? '+' : '';
                const caption = `Hi! Please find your price list attached.\nCustomer: ${customer_name}\nDate: ${effective_date || new Date().toISOString().slice(0, 10)}\nMarkup: ${markupSign}${markupPct}%`;
                const mediaOpts = { type: 'document', mediaPath: tmpPath, caption, filename: `PriceList-${safeName}.pdf` };
                const source = { source: 'price_list', sent_by: req.user?.id };

                const ADMIN_BRANCH = -1;
                const GENERAL_ID   =  0;
                let sent = false;
                try { sent = await sessionManager.sendMedia(ADMIN_BRANCH, waNumber, mediaOpts, source); } catch (e) { /* fallback */ }
                if (!sent) {
                    try { sent = await sessionManager.sendMedia(GENERAL_ID, waNumber, mediaOpts, source); } catch (e) { /* ignore */ }
                }
            } catch (e) {
                console.warn('[price-list] WhatsApp send failed:', e.message);
            } finally {
                if (tmpPath) try { fs.unlinkSync(tmpPath); } catch (_) {}
            }
        }

        const dateStr = (effective_date || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="PriceList-${safeName}-${dateStr}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        res.end(pdfBuffer);

    } catch (err) {
        console.error('[price-list] POST /generate:', err);
        res.status(500).json({ success: false, message: 'Failed to generate price list' });
    }
});

module.exports = { router, setPool };
