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

// ─── POST /generate ───────────────────────────────────────────────────────────
router.post('/generate', perm, async (req, res) => {
    try {
        let { customer_name, whatsapp_number, brands, categories, markup_percent, effective_date } = req.body;

        if (!customer_name || typeof customer_name !== 'string' || !customer_name.trim()) {
            return res.status(400).json({ success: false, message: 'customer_name is required' });
        }
        customer_name = customer_name.trim().slice(0, 100);
        const safeName = customer_name.replace(/[^a-zA-Z0-9\-_]/g, '_');

        if (!Array.isArray(brands) || brands.length === 0) {
            return res.status(400).json({ success: false, message: 'brands must be a non-empty array' });
        }
        if (brands.length > 20) {
            return res.status(400).json({ success: false, message: 'Too many brands requested' });
        }
        const VALID_BRANDS = Object.keys(BRAND_LABELS);
        const validatedBrands = brands.filter(b => VALID_BRANDS.includes(b));
        if (validatedBrands.length === 0) {
            return res.status(400).json({ success: false, message: 'No valid brands supplied' });
        }

        const markupPct = parseFloat(markup_percent);
        if (isNaN(markupPct) || markupPct < 0 || markupPct > 200) {
            return res.status(400).json({ success: false, message: 'markup_percent must be between 0 and 200' });
        }

        const filterCats = Array.isArray(categories)
            ? categories.map(c => (c || '').toLowerCase().trim()).filter(Boolean)
            : [];

        let waNumber = null;
        if (whatsapp_number) {
            const digits = String(whatsapp_number).replace(/\D/g, '');
            const normalized = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits;
            if (normalized.length === 10) waNumber = normalized;
        }

        const brandGroups = [];
        for (const brand of validatedBrands) {
            const [rows] = await pool.query(
                'SELECT parsed_rows FROM brand_dpl_lists WHERE brand = ?', [brand]
            );
            if (!rows.length || !rows[0].parsed_rows) continue;

            let parsedRows;
            try {
                parsedRows = typeof rows[0].parsed_rows === 'string'
                    ? JSON.parse(rows[0].parsed_rows) : rows[0].parsed_rows;
            } catch (e) { continue; }

            const filtered = filterCats.length > 0
                ? parsedRows.filter(r => filterCats.includes((r.category || '').toLowerCase().trim()))
                : parsedRows;

            if (!filtered.length) continue;

            const withPrice = filtered.map(r => ({
                ...r,
                finalPrice: computeFinalPrice(r.dpl, markupPct),
            }));

            brandGroups.push(groupRowsForPdf(withPrice, BRAND_LABELS[brand] || brand));
        }

        if (brandGroups.length === 0) {
            return res.status(400).json({ success: false, message: 'No DPL data found for selected brands' });
        }
        const totalItems = brandGroups.reduce(
            (sum, g) => sum + g.categories.reduce((s, c) => s + c.items.length, 0), 0
        );
        if (totalItems === 0) {
            return res.status(400).json({ success: false, message: 'No items match selected categories' });
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

                const caption = `Hi! Please find your price list attached.\nCustomer: ${customer_name}\nDate: ${effective_date || new Date().toISOString().slice(0, 10)}\nMarkup: +${markupPct}%`;
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
        const dateStr  = (effective_date || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
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
