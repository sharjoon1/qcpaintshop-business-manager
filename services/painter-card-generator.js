/**
 * Painter Card Generator
 * Generates visiting card (landscape 1050x600) and ID card (portrait 600x900) using Sharp
 */
const sharp = require('sharp');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const CARD_WIDTH = 1050;
const CARD_HEIGHT = 600;
const ID_WIDTH = 600;
const ID_HEIGHT = 900;
const PRIMARY = '#1B5E3B';
const SECONDARY = '#D4A24E';
const ORIGIN = process.env.APP_ORIGIN || 'https://act.qcpaintshop.com';

function escapeSvg(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getSpecLabel(specialization) {
    return (specialization || 'both')
        .replace('both', 'Interior & Exterior')
        .replace('interior', 'Interior')
        .replace('exterior', 'Exterior')
        .replace('industrial', 'Industrial')
        + ' Specialist';
}

/**
 * Load company logo from settings table, returns resized PNG buffer or null
 */
async function loadCompanyLogo(pool, size = 80) {
    try {
        const [rows] = await pool.query(
            "SELECT setting_value FROM settings WHERE setting_key = 'business_logo' LIMIT 1"
        );
        if (!rows.length || !rows[0].setting_value) return null;

        const logoFile = rows[0].setting_value;
        // Logo could be a full path like /uploads/logos/xxx.png or just the filename
        const logoPath = logoFile.startsWith('/')
            ? path.join(__dirname, '..', 'public', logoFile.split('?')[0])
            : path.join(__dirname, '..', 'public', 'uploads', 'logos', logoFile);

        if (!fs.existsSync(logoPath)) return null;

        return await sharp(logoPath)
            .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
            .png()
            .toBuffer();
    } catch (e) {
        return null;
    }
}

/**
 * Load profile photo as circular image with white border ring, or create initials avatar
 * Returns { photo: Buffer, ring: Buffer }
 */
async function loadProfilePhoto(profile_photo, full_name, size = 180) {
    const half = size / 2;
    const ringSize = size + 10;
    const ringHalf = ringSize / 2;

    let photoBuffer;
    try {
        const photoPath = profile_photo
            ? path.join(__dirname, '..', 'public', profile_photo.split('?')[0])
            : null;
        if (photoPath && fs.existsSync(photoPath)) {
            photoBuffer = await sharp(photoPath)
                .resize(size, size, { fit: 'cover' })
                .png()
                .toBuffer();
        }
    } catch (e) { /* use initials fallback */ }

    if (!photoBuffer) {
        const initial = (full_name || 'P').charAt(0).toUpperCase();
        const initialSvg = `<svg width="${size}" height="${size}"><circle cx="${half}" cy="${half}" r="${half}" fill="${SECONDARY}"/><text x="${half}" y="${half}" text-anchor="middle" dominant-baseline="central" font-family="Arial,sans-serif" font-size="${Math.round(size * 0.43)}" font-weight="bold" fill="white">${initial}</text></svg>`;
        photoBuffer = await sharp(Buffer.from(initialSvg)).png().toBuffer();
    }

    // Circle mask
    const circleMask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${half}" cy="${half}" r="${half - 2}" fill="white"/></svg>`);
    const circleMaskBuf = await sharp(circleMask).png().toBuffer();
    const circularPhoto = await sharp(photoBuffer)
        .resize(size, size)
        .composite([{ input: circleMaskBuf, blend: 'dest-in' }])
        .png()
        .toBuffer();

    // White border ring
    const photoRing = Buffer.from(`<svg width="${ringSize}" height="${ringSize}"><circle cx="${ringHalf}" cy="${ringHalf}" r="${ringHalf - 1}" fill="none" stroke="white" stroke-width="3"/></svg>`);
    const photoRingBuf = await sharp(photoRing).png().toBuffer();

    return { photo: circularPhoto, ring: photoRingBuf };
}

// ═══════════════════════════════════════════════════════
// VISITING CARD — 1050x600 Landscape
// ═══════════════════════════════════════════════════════

async function generateCard(painter, pool) {
    const {
        id, full_name, phone, city, specialization,
        experience_years, referral_code, profile_photo
    } = painter;

    // Generate QR code
    const registerUrl = `${ORIGIN}/painter-register.html?ref=${referral_code}`;
    const qrBuffer = await QRCode.toBuffer(registerUrl, {
        width: 130, margin: 1,
        color: { dark: PRIMARY, light: '#FFFFFF' }
    });

    // Load assets in parallel
    const [{ photo: circularPhoto, ring: photoRingBuf }, logoBuf] = await Promise.all([
        loadProfilePhoto(profile_photo, full_name, 180),
        pool ? loadCompanyLogo(pool, 60) : Promise.resolve(null)
    ]);

    const specLabel = getSpecLabel(specialization);
    const expText = experience_years ? `${experience_years} years experience` : '';
    const e = escapeSvg;

    // Logo header positioning
    const logoOffset = logoBuf ? 80 : 0; // shift text right if logo present

    const cardSvg = `
    <svg width="${CARD_WIDTH}" height="${CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:${PRIMARY}"/>
                <stop offset="100%" style="stop-color:${SECONDARY}"/>
            </linearGradient>
            <linearGradient id="footerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:${PRIMARY}"/>
                <stop offset="100%" style="stop-color:#2D7A4F"/>
            </linearGradient>
        </defs>

        <!-- White background with subtle border -->
        <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="20" fill="white"/>
        <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="20" fill="none" stroke="#e2e8f0" stroke-width="1"/>

        <!-- Header gradient bar -->
        <rect width="${CARD_WIDTH}" height="90" rx="20" fill="url(#headerGrad)"/>
        <rect y="20" width="${CARD_WIDTH}" height="70" fill="url(#headerGrad)"/>

        <!-- Header text (shifted right if logo present) -->
        <text x="${40 + logoOffset}" y="40" font-family="Arial,sans-serif" font-size="22" font-weight="bold" fill="white">QUALITY COLOURS</text>
        <text x="${40 + logoOffset}" y="62" font-family="Arial,sans-serif" font-size="12" fill="white" opacity="0.85">Your Trusted Paint Shop</text>

        <!-- Gold accent line -->
        <rect y="88" width="${CARD_WIDTH}" height="3" fill="${SECONDARY}"/>

        <!-- LEFT SIDE: Name + Contact -->
        <text x="50" y="145" font-family="Arial,sans-serif" font-size="34" font-weight="bold" fill="#1a1a2e">${e(full_name)}</text>
        <text x="50" y="175" font-family="Arial,sans-serif" font-size="18" fill="#64748b">${e(specLabel)}</text>
        ${expText ? `<text x="50" y="200" font-family="Arial,sans-serif" font-size="14" fill="#94a3b8">${e(expText)}</text>` : ''}

        <!-- Divider -->
        <line x1="50" y1="${expText ? 220 : 200}" x2="580" y2="${expText ? 220 : 200}" stroke="#e2e8f0" stroke-width="1"/>

        <!-- Phone -->
        <text x="50" y="${expText ? 255 : 235}" font-family="Arial,sans-serif" font-size="18" fill="#334155">&#x1F4DE;  ${e(phone)}</text>

        <!-- City -->
        ${city ? `<text x="50" y="${expText ? 285 : 265}" font-family="Arial,sans-serif" font-size="18" fill="#334155">&#x1F4CD;  ${e(city)}</text>` : ''}

        <!-- RIGHT SIDE: Photo placeholder area (composited later) -->

        <!-- QR label (bottom-right area) -->
        <text x="${CARD_WIDTH - 105}" y="${CARD_HEIGHT - 100}" font-family="Arial,sans-serif" font-size="10" fill="#94a3b8" text-anchor="middle">Scan to join</text>

        <!-- Footer -->
        <rect y="${CARD_HEIGHT - 55}" width="${CARD_WIDTH}" height="55" rx="0" fill="url(#footerGrad)"/>
        <rect y="${CARD_HEIGHT - 55}" width="${CARD_WIDTH}" height="35" fill="url(#footerGrad)"/>
        <rect x="0" y="${CARD_HEIGHT - 20}" width="${CARD_WIDTH}" height="20" rx="20" fill="url(#footerGrad)"/>

        <!-- Footer content -->
        <text x="40" y="${CARD_HEIGHT - 22}" font-family="Arial,sans-serif" font-size="12" fill="white" opacity="0.9">QC PAINTERS PROGRAM</text>
        <text x="${CARD_WIDTH / 2}" y="${CARD_HEIGHT - 22}" font-family="Arial,sans-serif" font-size="14" font-weight="bold" fill="white" text-anchor="middle" letter-spacing="2">Ref: ${e(referral_code)}</text>
        <text x="${CARD_WIDTH - 40}" y="${CARD_HEIGHT - 22}" font-family="Arial,sans-serif" font-size="12" fill="white" text-anchor="end" opacity="0.9">Your Paint Partner</text>
    </svg>`;

    const cardBase = await sharp(Buffer.from(cardSvg)).png().toBuffer();

    // Photo positioned on the right side, vertically centered in content area
    const photoTop = 120;
    const photoLeft = CARD_WIDTH - 240;

    const composites = [
        { input: photoRingBuf, top: photoTop - 5, left: photoLeft - 5 },
        { input: circularPhoto, top: photoTop, left: photoLeft },
        { input: qrBuffer, top: CARD_HEIGHT - 245, left: CARD_WIDTH - 170 },
    ];

    // Add logo to header if available
    if (logoBuf) {
        composites.push({ input: logoBuf, top: 15, left: 30 });
    }

    const outputDir = path.join(__dirname, '..', 'public', 'uploads', 'painter-cards');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputPath = path.join(outputDir, `painter_${id}.png`);

    await sharp(cardBase)
        .composite(composites)
        .png({ quality: 90 })
        .toFile(outputPath);

    return `/uploads/painter-cards/painter_${id}.png?v=${Date.now()}`;
}

// ═══════════════════════════════════════════════════════
// ID CARD — 600x900 Portrait (badge-style)
// ═══════════════════════════════════════════════════════

async function generateIdCard(painter, pool) {
    const {
        id, full_name, phone, city, specialization,
        experience_years, referral_code, profile_photo
    } = painter;

    // Generate QR code
    const registerUrl = `${ORIGIN}/painter-register.html?ref=${referral_code}`;
    const qrBuffer = await QRCode.toBuffer(registerUrl, {
        width: 140, margin: 1,
        color: { dark: PRIMARY, light: '#FFFFFF' }
    });

    // Load assets in parallel
    const [{ photo: circularPhoto, ring: photoRingBuf }, logoBuf] = await Promise.all([
        loadProfilePhoto(profile_photo, full_name, 180),
        pool ? loadCompanyLogo(pool, 50) : Promise.resolve(null)
    ]);

    const specLabel = getSpecLabel(specialization);
    const infoLine = [city, experience_years ? `${experience_years} yrs` : ''].filter(Boolean).join(' | ');
    const e = escapeSvg;

    const logoOffset = logoBuf ? 60 : 0;

    const idSvg = `
    <svg width="${ID_WIDTH}" height="${ID_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="hGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:${PRIMARY}"/>
                <stop offset="100%" style="stop-color:#2D7A4F"/>
            </linearGradient>
            <linearGradient id="fGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:${PRIMARY}"/>
                <stop offset="100%" style="stop-color:${SECONDARY}"/>
            </linearGradient>
        </defs>

        <!-- Background -->
        <rect width="${ID_WIDTH}" height="${ID_HEIGHT}" rx="24" fill="white"/>
        <rect width="${ID_WIDTH}" height="${ID_HEIGHT}" rx="24" fill="none" stroke="#e2e8f0" stroke-width="1"/>

        <!-- Green header block -->
        <rect width="${ID_WIDTH}" height="130" rx="24" fill="url(#hGrad)"/>
        <rect y="24" width="${ID_WIDTH}" height="106" fill="url(#hGrad)"/>

        <!-- Header text -->
        <text x="${ID_WIDTH / 2}" y="55" font-family="Arial,sans-serif" font-size="20" font-weight="bold" fill="white" text-anchor="middle">QUALITY COLOURS</text>
        <text x="${ID_WIDTH / 2}" y="80" font-family="Arial,sans-serif" font-size="13" fill="white" text-anchor="middle" opacity="0.85">QC Painters Program</text>
        <text x="${ID_WIDTH / 2}" y="110" font-family="Arial,sans-serif" font-size="11" fill="white" text-anchor="middle" opacity="0.7">Painter Identity Card</text>

        <!-- Photo placeholder (composited later, centered) -->

        <!-- Name & Details -->
        <text x="${ID_WIDTH / 2}" y="370" font-family="Arial,sans-serif" font-size="28" font-weight="bold" fill="#1a1a2e" text-anchor="middle">${e(full_name)}</text>
        <text x="${ID_WIDTH / 2}" y="398" font-family="Arial,sans-serif" font-size="16" fill="#64748b" text-anchor="middle">${e(specLabel)}</text>
        ${infoLine ? `<text x="${ID_WIDTH / 2}" y="422" font-family="Arial,sans-serif" font-size="14" fill="#94a3b8" text-anchor="middle">${e(infoLine)}</text>` : ''}

        <!-- Phone -->
        <text x="${ID_WIDTH / 2}" y="452" font-family="Arial,sans-serif" font-size="15" fill="#334155" text-anchor="middle">&#x1F4DE; ${e(phone)}</text>

        <!-- Gold divider -->
        <rect x="60" y="470" width="${ID_WIDTH - 120}" height="2" fill="${SECONDARY}" rx="1"/>

        <!-- Referral Code label -->
        <text x="${ID_WIDTH / 2}" y="502" font-family="Arial,sans-serif" font-size="12" fill="#94a3b8" text-anchor="middle" letter-spacing="1">REFERRAL CODE</text>

        <!-- Referral code box -->
        <rect x="150" y="510" width="${ID_WIDTH - 300}" height="44" rx="10" fill="#f0fdf4" stroke="${PRIMARY}" stroke-width="1.5"/>
        <text x="${ID_WIDTH / 2}" y="538" font-family="Arial,sans-serif" font-size="24" font-weight="bold" fill="${PRIMARY}" text-anchor="middle" letter-spacing="3">${e(referral_code)}</text>

        <!-- QR label -->
        <text x="${ID_WIDTH / 2}" y="${ID_HEIGHT - 115}" font-family="Arial,sans-serif" font-size="11" fill="#94a3b8" text-anchor="middle">Scan to join!</text>

        <!-- Footer -->
        <rect y="${ID_HEIGHT - 60}" width="${ID_WIDTH}" height="60" rx="0" fill="url(#fGrad)"/>
        <rect y="${ID_HEIGHT - 60}" width="${ID_WIDTH}" height="36" fill="url(#fGrad)"/>
        <rect x="0" y="${ID_HEIGHT - 24}" width="${ID_WIDTH}" height="24" rx="24" fill="url(#fGrad)"/>

        <text x="${ID_WIDTH / 2}" y="${ID_HEIGHT - 30}" font-family="Arial,sans-serif" font-size="12" fill="white" text-anchor="middle" opacity="0.95">Join us &amp; earn loyalty points on every purchase!</text>
        <text x="${ID_WIDTH / 2}" y="${ID_HEIGHT - 12}" font-family="Arial,sans-serif" font-size="10" fill="white" text-anchor="middle" opacity="0.7">Quality Colours — Your Trusted Paint Partner</text>
    </svg>`;

    const idBase = await sharp(Buffer.from(idSvg)).png().toBuffer();

    // Center the photo below header
    const photoLeft = (ID_WIDTH - 180) / 2;
    const photoTop = 150;

    const composites = [
        { input: photoRingBuf, top: photoTop - 5, left: photoLeft - 5 },
        { input: circularPhoto, top: photoTop, left: photoLeft },
        { input: qrBuffer, top: ID_HEIGHT - 260, left: (ID_WIDTH - 140) / 2 },
    ];

    // Add logo in header top-left corner (avoid overlapping centered text)
    if (logoBuf) {
        composites.push({ input: logoBuf, top: 12, left: 20 });
    }

    const outputDir = path.join(__dirname, '..', 'public', 'uploads', 'painter-cards');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, `painter_id_${id}.png`);

    await sharp(idBase)
        .composite(composites)
        .png({ quality: 90 })
        .toFile(outputPath);

    return `/uploads/painter-cards/painter_id_${id}.png?v=${Date.now()}`;
}

module.exports = { generateCard, generateIdCard };
