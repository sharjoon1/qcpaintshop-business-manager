/**
 * Paint Colors & Visualization Routes
 * /api/paint-colors/* and /api/design-requests/:id/(visualize|visualizations|auto-visualize)
 * — mounted at /api so paths keep their original shape.
 * A1: extracted verbatim from server.js (pure mechanical move, no logic changes).
 * Only __dirname-relative paths gained a '..' segment (module lives in routes/).
 * geminiAI is shared with the inline /api/ai-status endpoint → injected via setGeminiAI.
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { requireAuth, requireRole } = require('../middleware/permissionMiddleware');

let pool = null;
function setPool(p) {
    pool = p;
}

let geminiAI = null;
function setGeminiAI(g) {
    geminiAI = g;
}

// ========================================
// PAINT COLORS & VISUALIZATION
// ========================================

// Load paint color catalogs
const paintColorsDir = path.join(__dirname, '..', 'data', 'paint-colors');
const paintCatalogs = {};
if (fs.existsSync(paintColorsDir)) {
    fs.readdirSync(paintColorsDir).filter(f => f.endsWith('.json')).forEach(f => {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(paintColorsDir, f), 'utf8'));
            paintCatalogs[data.brandCode] = data;
        } catch (e) { console.error(`Error loading paint catalog ${f}:`, e.message); }
    });
}

// --- Color theory helpers for auto-visualization ---
function hexToHsl(hex) {
    let r = parseInt(hex.slice(1, 3), 16) / 255;
    let g = parseInt(hex.slice(3, 5), 16) / 255;
    let b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function escXml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function selectColorCombinations(catalog) {
    const allColors = [];
    for (const family of catalog.families) {
        for (const color of family.colors) {
            allColors.push({ ...color, family: family.code, familyName: family.name, hsl: hexToHsl(color.hex) });
        }
    }
    const light = allColors.filter(c => c.hsl.l >= 65).sort((a, b) => b.hsl.l - a.hsl.l);
    const medium = allColors.filter(c => c.hsl.l >= 30 && c.hsl.l < 65).sort((a, b) => b.hsl.l - a.hsl.l);
    const dark = allColors.filter(c => c.hsl.l < 30).sort((a, b) => a.hsl.l - b.hsl.l);

    const lightNeutral = light.filter(c => c.hsl.s < 20);
    const lightWarm = light.filter(c => c.temperature === 'Warm' && c.hsl.s >= 15);
    const lightCool = light.filter(c => c.temperature === 'Cool' && c.hsl.s >= 15);
    const medWarm = medium.filter(c => c.temperature === 'Warm');
    const medCool = medium.filter(c => c.temperature === 'Cool');
    const pick = (arr, i = 0) => arr[Math.min(i, arr.length - 1)] || allColors[0];

    return [
        // 2-COLOR
        { type: 'two-color', label: 'Classic Elegance', description: 'Neutral walls with a refined accent',
          colors: [{ ...pick(lightNeutral, 2), role: 'Walls' }, { ...pick(medium, 5), role: 'Trim & Accents' }] },
        { type: 'two-color', label: 'Warm Harmony', description: 'Inviting warm tones throughout',
          colors: [{ ...pick(lightWarm.length ? lightWarm : light, 3), role: 'Walls' }, { ...pick(medWarm.length ? medWarm : medium, 4), role: 'Trim & Accents' }] },
        { type: 'two-color', label: 'Cool Contemporary', description: 'Modern cool tones for a sleek look',
          colors: [{ ...pick(lightCool.length ? lightCool : light, 2), role: 'Walls' }, { ...pick(medCool.length ? medCool : medium, 5), role: 'Trim & Accents' }] },
        // 3-COLOR
        { type: 'three-color', label: 'Sophisticated Trio', description: 'Balanced light, medium and dark tones',
          colors: [{ ...pick(lightNeutral, 5), role: 'Walls' }, { ...pick(medium, 10), role: 'Secondary' }, { ...pick(dark, 2), role: 'Doors & Accents' }] },
        { type: 'three-color', label: 'Vibrant Living', description: 'Bold and expressive color story',
          colors: [{ ...pick(lightWarm.length ? lightWarm : light, 5), role: 'Walls' }, { ...pick(medCool.length ? medCool : medium, 8), role: 'Secondary' }, { ...pick(dark, 5), role: 'Doors & Accents' }] },
        { type: 'three-color', label: 'Earth & Nature', description: 'Natural tones inspired by the landscape',
          colors: [
            pick(light.filter(c => c.hsl.h >= 25 && c.hsl.h <= 90), 0) || pick(light, 8),
            { role: 'Walls' },
            pick(medium.filter(c => c.hsl.h >= 60 && c.hsl.h <= 180), 0) || pick(medium, 15),
            { role: 'Secondary' },
            pick(dark.filter(c => c.hsl.h >= 15 && c.hsl.h <= 60), 0) || pick(dark, 0),
            { role: 'Doors & Accents' }
          ].filter(x => x.hex) // build properly below
        }
    ].map(combo => {
        // Fix Earth & Nature combo which needs special handling
        if (combo.label === 'Earth & Nature') {
            const earthWall = light.find(c => c.hsl.h >= 25 && c.hsl.h <= 90) || pick(light, 8);
            const earthMid = medium.find(c => c.hsl.h >= 60 && c.hsl.h <= 180) || pick(medium, 15);
            const earthDark = dark.find(c => c.hsl.h >= 15 && c.hsl.h <= 60) || pick(dark, 0);
            combo.colors = [
                { ...earthWall, role: 'Walls' },
                { ...earthMid, role: 'Secondary' },
                { ...earthDark, role: 'Doors & Accents' }
            ];
        }
        return combo;
    });
}

function createFooterSvg(imgWidth, combo, customerInfo, brandName) {
    const colors = combo.colors;
    const footerH = colors.length === 3 ? 130 : 110;
    const swatchSz = 28;

    let swatchesXml = '';
    const colW = Math.floor((imgWidth - 40) / colors.length);
    colors.forEach((c, i) => {
        const x = 20 + colW * i;
        swatchesXml += `
            <rect x="${x}" y="12" width="${swatchSz}" height="${swatchSz}" rx="5" fill="${c.hex}" stroke="#ffffff" stroke-width="1.5"/>
            <text x="${x + swatchSz + 8}" y="25" font-family="Arial,sans-serif" font-size="12" font-weight="bold" fill="#ffffff">${escXml(c.name)}</text>
            <text x="${x + swatchSz + 8}" y="38" font-family="Arial,sans-serif" font-size="9" fill="#a0a0c0">${escXml(c.code)} | ${escXml(c.role)}</text>`;
    });

    const custLine = (customerInfo.name || '') + (customerInfo.city ? ' | ' + customerInfo.city : '');
    const promo = 'Transform your space with Quality Colours \u2013 Professional Color Consultation';

    return { height: footerH, svg: `<svg width="${imgWidth}" height="${footerH}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${imgWidth}" height="${footerH}" fill="#1a1a2e"/>
        <line x1="20" y1="48" x2="${imgWidth - 20}" y2="48" stroke="#2a2a4e" stroke-width="1"/>
        ${swatchesXml}
        <text x="20" y="66" font-family="Arial,sans-serif" font-size="13" font-weight="bold" fill="#e0e0ff">${escXml(combo.label)}</text>
        <text x="20" y="80" font-family="Arial,sans-serif" font-size="10" fill="#8080b0">${escXml(combo.description)}</text>
        <text x="20" y="${footerH - 28}" font-family="Arial,sans-serif" font-size="10" fill="#a0a0c0">${escXml(custLine)}</text>
        <text x="20" y="${footerH - 12}" font-family="Arial,sans-serif" font-size="9" fill="#667eea" font-style="italic">${escXml(promo)}</text>
        <text x="${imgWidth - 20}" y="66" font-family="Arial,sans-serif" font-size="13" font-weight="bold" fill="#ffffff" text-anchor="end">${escXml(brandName)}</text>
        <text x="${imgWidth - 20}" y="${footerH - 12}" font-family="Arial,sans-serif" font-size="10" fill="#667eea" text-anchor="end">Quality Colours Visualizer</text>
    </svg>` };
}

async function generateAutoViz(photoBuffer, combo, customerInfo, brandName) {
    if (!geminiAI) throw new Error('Gemini API key not configured');

    const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp';
    const model = geminiAI.getGenerativeModel({
        model: modelName,
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
    });

    // Convert photo to base64
    const imageBase64 = photoBuffer.toString('base64');
    const colors = combo.colors;

    // Build color instructions
    let colorInstructions;
    if (combo.type === 'two-color') {
        colorInstructions = `- Main walls and large flat painted surfaces: ${colors[0].name} (hex ${colors[0].hex}, RGB ${colors[0].rgb.join(',')})
- Trim, pillars, borders, railings, and accent painted areas: ${colors[1].name} (hex ${colors[1].hex}, RGB ${colors[1].rgb.join(',')})`;
    } else {
        colorInstructions = `- Main walls and large flat painted surfaces: ${colors[0].name} (hex ${colors[0].hex}, RGB ${colors[0].rgb.join(',')})
- Secondary surfaces like pillars, balcony walls, borders, and fascia: ${colors[1].name} (hex ${colors[1].hex}, RGB ${colors[1].rgb.join(',')})
- Doors, window frames, gates, and small accent features: ${colors[2].name} (hex ${colors[2].hex}, RGB ${colors[2].rgb.join(',')})`;
    }

    const prompt = `You are a professional building exterior paint color visualization tool.

Edit this building/elevation photo by precisely repainting the painted surfaces with these exact colors:

${colorInstructions}

CRITICAL RULES:
- ONLY repaint surfaces that would normally be painted (walls, trim, pillars, doors, gates)
- Keep sky, ground, vegetation, glass windows, roof tiles, stone/brick textures, and all non-paintable surfaces COMPLETELY UNCHANGED
- Preserve all architectural details, shadows, depth, lighting, and perspective exactly
- The paint must look photorealistic - natural finish with proper shading from existing light sources
- Maintain the exact same image composition, angle, and framing
- Do NOT add any text, labels, watermarks, or annotations to the image
- The result should look like an actual professional photograph of the repainted building`;

    const result = await model.generateContent([
        { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
        { text: prompt }
    ]);

    // Extract generated image from response
    let imageBuffer = null;
    const candidate = result.response.candidates?.[0];
    if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
            if (part.inlineData) {
                imageBuffer = Buffer.from(part.inlineData.data, 'base64');
                break;
            }
        }
    }

    if (!imageBuffer) {
        const textResponse = candidate?.content?.parts?.map(p => p.text).filter(Boolean).join(' ') || 'No response';
        throw new Error('Gemini did not return an image. Response: ' + textResponse.slice(0, 200));
    }

    // Get dimensions of the AI-generated image
    const meta = await sharp(imageBuffer).metadata();
    const imgWidth = meta.width;

    // Create branded footer
    const { height: footerH, svg: footerSvg } = createFooterSvg(imgWidth, combo, customerInfo, brandName);
    const footerBuf = await sharp(Buffer.from(footerSvg)).png().toBuffer();

    const filename = `viz-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
    const outputPath = path.join(__dirname, '..', 'public', 'uploads', 'visualizations', filename);

    await sharp(imageBuffer)
        .extend({ bottom: footerH, background: { r: 26, g: 26, b: 46, alpha: 255 } })
        .composite([{ input: footerBuf, gravity: 'south' }])
        .jpeg({ quality: 92 })
        .toFile(outputPath);

    return `/uploads/visualizations/${filename}`;
}

// --- Pollinations AI (Flux - Free Text-to-Image) ---
// NOTE: Pollinations 'kontext' (img2img) moved to PAID-ONLY in Feb 2026.
// We use the free 'flux' model for text-to-image building visualization as a fallback.
async function generateAutoVizPollinations(photoRelPath, combo, customerInfo, brandName) {
    const colors = combo.colors;

    // Build a detailed text-to-image prompt describing a painted building with these colors
    let colorDesc;
    if (combo.type === 'two-color') {
        colorDesc = `The main exterior walls are painted in ${colors[0].name} (hex ${colors[0].hex}), a beautiful ${colors[0].temperature || 'neutral'} tone. The trim, window frames, pillars, and accent borders are painted in ${colors[1].name} (hex ${colors[1].hex}).`;
    } else {
        colorDesc = `The main exterior walls are painted in ${colors[0].name} (hex ${colors[0].hex}), a ${colors[0].temperature || 'neutral'} tone. The secondary surfaces like pillars, balcony walls, and fascia are painted in ${colors[1].name} (hex ${colors[1].hex}). The doors, window frames, and small accent features are painted in ${colors[2].name} (hex ${colors[2].hex}).`;
    }

    const prompt = `A photorealistic professional exterior photograph of a modern Indian residential building freshly painted. ${colorDesc} The building has clear architectural details with balconies, windows with glass, a main entrance door, and decorative trim work. Natural daylight, blue sky with light clouds, well-maintained surroundings with some greenery. Shot with a DSLR camera, sharp focus, vibrant but realistic colors. The paint looks freshly applied with a smooth satin finish. No text, no watermarks, no labels.`;

    const seed = Math.floor(Math.random() * 999999);
    const apiUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=flux&width=1024&height=768&nologo=true&seed=${seed}&enhance=true`;

    console.log(`[Pollinations:flux] Generating: ${combo.label}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    try {
        const response = await fetch(apiUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
            const errText = await response.text().catch(() => 'Unknown error');
            throw new Error(`Pollinations API ${response.status}: ${errText.slice(0, 200)}`);
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) {
            throw new Error('Pollinations returned non-image response: ' + contentType);
        }

        const imageBuffer = Buffer.from(await response.arrayBuffer());
        const meta = await sharp(imageBuffer).metadata();
        if (!meta.width || !meta.height) throw new Error('Invalid image from Pollinations');

        // Add branded footer
        const { height: footerH, svg: footerSvg } = createFooterSvg(meta.width, combo, customerInfo, brandName);
        const footerBuf = await sharp(Buffer.from(footerSvg)).png().toBuffer();

        const filename = `viz-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
        const outputPath = path.join(__dirname, '..', 'public', 'uploads', 'visualizations', filename);

        await sharp(imageBuffer)
            .extend({ bottom: footerH, background: { r: 26, g: 26, b: 46, alpha: 255 } })
            .composite([{ input: footerBuf, gravity: 'south' }])
            .jpeg({ quality: 92 })
            .toFile(outputPath);

        console.log(`[Pollinations:flux] Done: ${combo.label}`);
        return `/uploads/visualizations/${filename}`;
    } finally {
        clearTimeout(timeoutId);
    }
}

// GET /api/paint-colors/brands - list available paint brands
router.get('/paint-colors/brands', requireAuth, (req, res) => {
    const brands = Object.values(paintCatalogs).map(c => ({
        code: c.brandCode,
        name: c.brand,
        familyCount: c.families.length,
        colorCount: c.families.reduce((sum, f) => sum + f.colors.length, 0)
    }));
    res.json({ success: true, data: brands });
});

// GET /api/paint-colors/:brand/families - color families for a brand
router.get('/paint-colors/:brand/families', requireAuth, (req, res) => {
    const catalog = paintCatalogs[req.params.brand];
    if (!catalog) return res.status(404).json({ success: false, error: 'Brand not found' });
    const families = catalog.families.map(f => ({
        code: f.code,
        name: f.name,
        colorCount: f.colors.length
    }));
    res.json({ success: true, data: families });
});

// GET /api/paint-colors/:brand/colors - filtered/paginated colors
router.get('/paint-colors/:brand/colors', requireAuth, (req, res) => {
    const catalog = paintCatalogs[req.params.brand];
    if (!catalog) return res.status(404).json({ success: false, error: 'Brand not found' });

    const { family, search, temperature, page = 1, limit = 60 } = req.query;
    let colors = [];
    const families = family ? catalog.families.filter(f => f.code === family) : catalog.families;
    families.forEach(f => {
        f.colors.forEach(c => colors.push({ ...c, family: f.code, familyName: f.name }));
    });

    if (search) {
        const q = search.toLowerCase();
        colors = colors.filter(c => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
    }
    if (temperature) {
        colors = colors.filter(c => c.temperature === temperature);
    }

    const total = colors.length;
    const pg = parseInt(page);
    const lim = parseInt(limit);
    const paginated = colors.slice((pg - 1) * lim, pg * lim);

    res.json({ success: true, data: paginated, total, page: pg, limit: lim });
});

// POST /api/design-requests/:id/visualize - generate color visualization
router.post('/design-requests/:id/visualize', requireRole('admin', 'manager'), async (req, res) => {
    try {
        const { colorCode, brand } = req.body;
        if (!colorCode || !brand) {
            return res.status(400).json({ success: false, error: 'colorCode and brand are required' });
        }

        // Find the color in catalog
        const catalog = paintCatalogs[brand];
        if (!catalog) return res.status(404).json({ success: false, error: 'Brand not found' });

        let colorInfo = null;
        for (const fam of catalog.families) {
            colorInfo = fam.colors.find(c => c.code === colorCode);
            if (colorInfo) { colorInfo = { ...colorInfo, family: fam.code, familyName: fam.name }; break; }
        }
        if (!colorInfo) return res.status(404).json({ success: false, error: 'Color not found' });

        // Get the design request photo
        const [rows] = await pool.query('SELECT * FROM color_design_requests WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ success: false, error: 'Design request not found' });
        const designReq = rows[0];
        if (!designReq.photo_path) return res.status(400).json({ success: false, error: 'No photo uploaded for this request' });

        // Load original image
        const photoFullPath = path.join(__dirname, '..', 'public', designReq.photo_path);
        if (!fs.existsSync(photoFullPath)) {
            return res.status(404).json({ success: false, error: 'Original photo file not found' });
        }

        const originalImage = sharp(photoFullPath);
        const metadata = await originalImage.metadata();
        const imgWidth = metadata.width;
        const imgHeight = metadata.height;

        // Create color overlay with soft-light blend
        const [r, g, b] = colorInfo.rgb;
        const colorOverlay = await sharp({
            create: { width: imgWidth, height: imgHeight, channels: 4, background: { r, g, b, alpha: 160 } }
        }).png().toBuffer();

        // Apply soft-light blend
        const blended = await sharp(photoFullPath)
            .composite([{ input: colorOverlay, blend: 'soft-light' }])
            .toBuffer();

        // Create branded footer SVG
        const footerHeight = 80;
        const swatchSize = 50;
        const footerSvg = `<svg width="${imgWidth}" height="${footerHeight}" xmlns="http://www.w3.org/2000/svg">
            <rect width="${imgWidth}" height="${footerHeight}" fill="#1a1a2e"/>
            <rect x="20" y="15" width="${swatchSize}" height="${swatchSize}" rx="6" fill="${colorInfo.hex}" stroke="#fff" stroke-width="2"/>
            <text x="${swatchSize + 35}" y="32" font-family="Arial, sans-serif" font-size="16" font-weight="bold" fill="#ffffff">${colorInfo.name}</text>
            <text x="${swatchSize + 35}" y="52" font-family="Arial, sans-serif" font-size="13" fill="#a0a0c0">${colorInfo.code} | RGB(${colorInfo.rgb.join(', ')}) | ${colorInfo.hex}</text>
            <text x="${imgWidth - 20}" y="32" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#ffffff" text-anchor="end">${catalog.brand}</text>
            <text x="${imgWidth - 20}" y="52" font-family="Arial, sans-serif" font-size="11" fill="#a0a0c0" text-anchor="end">${colorInfo.temperature} | ${colorInfo.finishes.join(', ')}</text>
            <text x="${imgWidth - 20}" y="68" font-family="Arial, sans-serif" font-size="10" fill="#667eea" text-anchor="end">Quality Colours Visualizer</text>
        </svg>`;
        const footerBuffer = await sharp(Buffer.from(footerSvg)).png().toBuffer();

        // Combine blended image + footer
        const filename = `viz-${req.params.id}-${Date.now()}.jpg`;
        const outputPath = path.join(__dirname, '..', 'public', 'uploads', 'visualizations', filename);

        await sharp(blended)
            .extend({ bottom: footerHeight, background: { r: 26, g: 26, b: 46, alpha: 255 } })
            .composite([{ input: footerBuffer, gravity: 'south' }])
            .jpeg({ quality: 90 })
            .toFile(outputPath);

        const vizUrl = `/uploads/visualizations/${filename}`;

        // Save to DB
        await pool.query(
            `INSERT INTO design_visualizations (design_request_id, brand, color_code, color_name, color_hex, visualization_path, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [req.params.id, brand, colorInfo.code, colorInfo.name, colorInfo.hex, vizUrl, req.user.id]
        );

        res.json({
            success: true,
            visualizationUrl: vizUrl,
            colorInfo: {
                code: colorInfo.code,
                name: colorInfo.name,
                hex: colorInfo.hex,
                rgb: colorInfo.rgb,
                temperature: colorInfo.temperature,
                finishes: colorInfo.finishes,
                brand: catalog.brand
            }
        });
    } catch (err) {
        console.error('Visualization error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/design-requests/:id/visualizations - list visualizations for a request
router.get('/design-requests/:id/visualizations', requireRole('admin', 'manager'), async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM design_visualizations WHERE design_request_id = ? ORDER BY created_at DESC',
            [req.params.id]
        );
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Helper: attempt AI generation for a single combo, with model fallback
// Primary: Gemini (true img2img - edits actual photo)
// Fallback: Pollinations flux (free text-to-image - generates sample building)
async function generateSingleVariation(aiModel, combo, designReq, photoFullPath, catalog, userId) {
    const customerInfo = { name: designReq.name, city: designReq.city || '' };

    const tryModel = async (model) => {
        if (model === 'pollinations') {
            return await generateAutoVizPollinations(designReq.photo_path, combo, customerInfo, catalog.brand);
        } else {
            const photoBuffer = await sharp(photoFullPath).resize(1200, null, { withoutEnlargement: true }).toBuffer();
            return await generateAutoViz(photoBuffer, combo, customerInfo, catalog.brand);
        }
    };

    // Determine fallback model
    const fallbackModel = aiModel === 'gemini' ? 'pollinations' : 'gemini';
    const canFallbackGemini = fallbackModel === 'gemini' && geminiAI;
    const canFallbackPollinations = fallbackModel === 'pollinations';

    let usedModel = aiModel;
    let imageUrl;
    try {
        imageUrl = await tryModel(aiModel);
    } catch (primaryErr) {
        const msg = primaryErr.message || '';
        const isServiceDown = msg.includes('530') || msg.includes('1033') || msg.includes('503');
        const isQuotaError = msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED');
        const isConfigError = msg.includes('not configured');
        const shouldFallback = isServiceDown || isQuotaError || isConfigError;

        if (shouldFallback && (canFallbackGemini || canFallbackPollinations)) {
            console.log(`[Viz] ${aiModel} failed (${msg.slice(0, 80)}), falling back to ${fallbackModel}...`);
            try {
                imageUrl = await tryModel(fallbackModel);
                usedModel = fallbackModel;
            } catch (fallbackErr) {
                throw new Error(`Both AI models failed. ${aiModel}: ${msg.slice(0, 100)}. ${fallbackModel}: ${fallbackErr.message.slice(0, 100)}`);
            }
        } else {
            throw primaryErr;
        }
    }

    return { imageUrl, usedModel };
}

// POST /api/design-requests/:id/auto-visualize - generate AI color combinations
router.post('/design-requests/:id/auto-visualize', requireRole('admin', 'manager'), async (req, res) => {
    try {
        const { brand, aiModel = 'gemini' } = req.body;
        if (!brand) return res.status(400).json({ success: false, error: 'brand is required' });

        const catalog = paintCatalogs[brand];
        if (!catalog) return res.status(404).json({ success: false, error: 'Brand not found' });

        const [rows] = await pool.query('SELECT * FROM color_design_requests WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ success: false, error: 'Design request not found' });
        const designReq = rows[0];
        if (!designReq.photo_path) return res.status(400).json({ success: false, error: 'No photo uploaded for this request' });

        const photoFullPath = path.join(__dirname, '..', 'public', designReq.photo_path);
        if (!fs.existsSync(photoFullPath)) return res.status(404).json({ success: false, error: 'Original photo not found' });

        // Select color combinations (3 variations)
        const allCombos = selectColorCombinations(catalog);
        const combos = allCombos.slice(0, 3);

        // Delay between calls: Pollinations flux free tier = 15s rate limit, Gemini = 2s
        const delayMs = aiModel === 'pollinations' ? 16000 : 2000;

        const variations = [];
        const errors = [];
        let actualModel = aiModel;
        for (let i = 0; i < combos.length; i++) {
            const combo = combos[i];
            try {
                console.log(`[Viz:${aiModel}] Generating ${i + 1}/${combos.length}: ${combo.label}...`);

                const result = await generateSingleVariation(aiModel, combo, designReq, photoFullPath, catalog, req.user.id);
                const imageUrl = result.imageUrl;
                actualModel = result.usedModel;

                // Save to DB
                const colorCodes = combo.colors.map(c => c.code).join(' + ');
                const primaryHex = combo.colors[0].hex;
                await pool.query(
                    `INSERT INTO design_visualizations (design_request_id, brand, color_code, color_name, color_hex, visualization_path, created_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [req.params.id, brand, colorCodes.slice(0, 20), combo.label.slice(0, 100), primaryHex, imageUrl, req.user.id]
                );

                variations.push({ type: combo.type, label: combo.label, description: combo.description, imageUrl,
                    colors: combo.colors.map(c => ({ code: c.code, name: c.name, hex: c.hex, role: c.role })) });
                console.log(`[Viz:${actualModel}] Done: ${combo.label}`);

                // Rate-limit delay between API calls
                if (i < combos.length - 1) await new Promise(r => setTimeout(r, delayMs));
            } catch (err) {
                console.error(`[Viz:${aiModel}] Failed ${combo.label}:`, err.message);
                errors.push(combo.label + ': ' + err.message);
            }
        }

        if (!variations.length) {
            const errMsg = errors[0] || 'Unknown error';
            // Classify the error for the frontend
            let errorCode = 'GENERATION_FAILED';
            let userMessage = 'Generation failed: ' + errMsg;

            if (errMsg.includes('530') || errMsg.includes('1033') || errMsg.includes('503')) {
                errorCode = 'SERVICE_DOWN';
                userMessage = 'AI service is temporarily unavailable. Both Pollinations and Gemini APIs are currently down. Please try again in a few minutes.';
            } else if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('RESOURCE_EXHAUSTED')) {
                errorCode = 'QUOTA_EXCEEDED';
                userMessage = 'API quota exceeded on both AI models. Please try again later.';
            } else if (errMsg.includes('Both AI models failed')) {
                errorCode = 'BOTH_FAILED';
                userMessage = errMsg;
            }

            return res.status(503).json({ success: false, error: userMessage, errorCode });
        }

        const fallbackUsed = actualModel !== aiModel;
        res.json({
            success: true,
            variations,
            aiModel: actualModel,
            fallbackUsed,
            fallbackNote: fallbackUsed ? `Switched from ${aiModel} to ${actualModel} (original model was unavailable)` : undefined,
            partialErrors: errors.length ? errors : undefined
        });
    } catch (err) {
        console.error('Auto-visualize error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = {
    router,
    setPool,
    setGeminiAI
};
