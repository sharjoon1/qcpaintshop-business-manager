// routes/admin-notifications.js
'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const { requirePermission } = require('../middleware/permissionMiddleware');
const fcmAdmin = require('../services/fcm-admin');

let pool;
function setPool(p) { pool = p; }

const UPLOAD_DIR = 'public/uploads/admin-notif-images';
const BASE_URL = process.env.APP_BASE_URL || 'https://act.qcpaintshop.com';

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only image files allowed'));
    },
});

/**
 * Pure function: build the audience WHERE extension + params for painter_fcm_tokens query.
 * Exported for unit testing.
 */
function buildAudienceQuery(audienceType, audienceValue) {
    let sql = `SELECT DISTINCT pft.fcm_token
               FROM painter_fcm_tokens pft
               JOIN painters p ON p.id = pft.painter_id
               WHERE p.status = 'active' AND pft.is_active = 1 AND pft.fcm_token IS NOT NULL`;
    const params = [];

    if (audienceType === 'branch' && Array.isArray(audienceValue) && audienceValue.length) {
        sql += ' AND p.branch_id IN (?)';
        params.push(audienceValue);
    } else if (audienceType === 'level' && Array.isArray(audienceValue) && audienceValue.length) {
        sql += ' AND p.current_level IN (?)';
        params.push(audienceValue);
    } else if (audienceType === 'city' && Array.isArray(audienceValue) && audienceValue.length) {
        sql += ' AND p.city IN (?)';
        params.push(audienceValue);
    } else if (audienceType === 'specific' && Array.isArray(audienceValue) && audienceValue.length) {
        sql += ' AND p.id IN (?)';
        params.push(audienceValue);
    }

    return { sql, params };
}

async function getTargetTokens(audienceType, audienceValue) {
    const { sql, params } = buildAudienceQuery(audienceType, audienceValue);
    const [rows] = await pool.query(sql, params);
    return rows; // [{ fcm_token }]
}

// POST /upload-image
router.post('/upload-image', requirePermission('painters', 'manage'), upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

        const filename = `notif_${Date.now()}_${Math.round(Math.random() * 1e9)}.jpg`;
        const outPath = path.join(UPLOAD_DIR, filename);

        await sharp(req.file.buffer)
            .resize({ width: 1024, withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toFile(outPath);

        res.json({ success: true, imageUrl: `/uploads/admin-notif-images/${filename}` });
    } catch (err) {
        console.error('[admin-notifications] upload error:', err);
        res.status(500).json({ success: false, message: 'Upload failed' });
    }
});

// GET /audience-count  (must be before /:id)
router.get('/audience-count', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const { audienceType = 'all' } = req.query;
        const audienceValue = req.query.audienceValue ? JSON.parse(req.query.audienceValue) : null;
        const tokens = await getTargetTokens(audienceType, audienceValue);
        res.json({ success: true, count: tokens.length });
    } catch (err) {
        console.error('[admin-notifications] audience-count error:', err);
        res.status(500).json({ success: false, message: 'Failed to count audience' });
    }
});

// GET / — history
router.get('/', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, parseInt(req.query.limit) || 20);
        const offset = (page - 1) * limit;

        const [rows] = await pool.query(
            `SELECT id, title, type, audience_type, reach_count, sent_at
             FROM admin_notifications ORDER BY sent_at DESC LIMIT ? OFFSET ?`,
            [limit, offset]
        );
        const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM admin_notifications');

        res.json({ success: true, notifications: rows, total, page, limit });
    } catch (err) {
        console.error('[admin-notifications] list error:', err);
        res.status(500).json({ success: false, message: 'Failed to load history' });
    }
});

// POST / — send notification
router.post('/', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const { title, body, imageUrl, type = 'info', offerUrl, audienceType = 'all', audienceValue } = req.body;

        if (!title?.trim()) return res.status(400).json({ success: false, message: 'Title is required' });
        if (!body?.trim()) return res.status(400).json({ success: false, message: 'Body is required' });
        if (type === 'offer' && !offerUrl?.trim()) {
            return res.status(400).json({ success: false, message: 'Offer URL is required for offer type' });
        }

        const tokenRows = await getTargetTokens(audienceType, audienceValue || null);
        const allTokens = tokenRows.map(r => r.fcm_token);

        let successCount = 0;
        const allInvalidTokens = [];

        if (allTokens.length > 0) {
            const fullImageUrl = imageUrl ? `${BASE_URL}${imageUrl}` : undefined;

            for (let i = 0; i < allTokens.length; i += 500) {
                const batch = allTokens.slice(i, i + 500);
                const result = await fcmAdmin.sendToDevices(batch, {
                    title,
                    body,
                    imageUrl: fullImageUrl,
                    type,
                    offerUrl: offerUrl || '',
                });
                successCount += result.successCount || 0;
                if (result.invalidTokens?.length) allInvalidTokens.push(...result.invalidTokens);
            }
        }

        const [insertResult] = await pool.query(
            `INSERT INTO admin_notifications (title, body, image_url, type, offer_url, audience_type, audience_value, reach_count, sent_at, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
            [
                title.trim(), body.trim(),
                imageUrl || null, type,
                offerUrl?.trim() || null,
                audienceType,
                audienceValue ? JSON.stringify(audienceValue) : null,
                allTokens.length,
                req.user.id,
            ]
        );

        if (allInvalidTokens.length > 0) {
            await pool.query('DELETE FROM painter_fcm_tokens WHERE fcm_token IN (?)', [allInvalidTokens]);
        }

        res.json({ success: true, reach: allTokens.length, id: insertResult.insertId });
    } catch (err) {
        console.error('[admin-notifications] send error:', err);
        res.status(500).json({ success: false, message: 'Failed to send notification' });
    }
});

// GET /:id — notification detail
router.get('/:id', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM admin_notifications WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
        res.json({ success: true, notification: rows[0] });
    } catch (err) {
        console.error('[admin-notifications] get error:', err);
        res.status(500).json({ success: false, message: 'Failed to load notification' });
    }
});

module.exports = { router, setPool, buildAudienceQuery };
