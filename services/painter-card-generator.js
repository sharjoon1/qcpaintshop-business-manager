/**
 * Painter Card Generator
 * Generates visiting card (landscape 1200x700) and ID card (portrait 700x1050) using Sharp
 * Designed for WhatsApp sharing — large, bold, readable on mobile
 */
const sharp = require('sharp');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 700;
const ID_WIDTH = 700;
const ID_HEIGHT = 1050;
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

async function loadCompanyLogo(pool, size = 80) {
    try {
        const [rows] = await pool.query(
            "SELECT setting_value FROM settings WHERE setting_key = 'business_logo' LIMIT 1"
        );
        if (!rows.length || !rows[0].setting_value) return null;

        const logoFile = rows[0].setting_value;
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

async function loadProfilePhoto(profile_photo, full_name, size = 220) {
    const half = size / 2;
    const ringSize = size + 12;
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
        const initialSvg = `<svg width="${size}" height="${size}"><circle cx="${half}" cy="${half}" r="${half}" fill="${SECONDARY}"/><text x="${half}" y="${half}" text-anchor="middle" dominant-baseline="central" font-family="Arial,sans-serif" font-size="${Math.round(size * 0.45)}" font-weight="bold" fill="white">${initial}</text></svg>`;
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
    const photoRing = Buffer.from(`<svg width="${ringSize}" height="${ringSize}"><circle cx="${ringHalf}" cy="${ringHalf}" r="${ringHalf - 1}" fill="none" stroke="white" stroke-width="4"/></svg>`);
    const photoRingBuf = await sharp(photoRing).png().toBuffer();

    return { photo: circularPhoto, ring: photoRingBuf, size, ringSize };
}

// ═══════════════════════════════════════════════════════
// VISITING CARD — 1200x700 Landscape
// ═══════════════════════════════════════════════════════

async function generateCard(painter, pool) {
    const {
        id, full_name, phone, city, specialization,
        experience_years, referral_code, profile_photo
    } = painter;

    const registerUrl = `${ORIGIN}/painter-register.html?ref=${referral_code}`;
    const qrBuffer = await QRCode.toBuffer(registerUrl, {
        width: 150, margin: 1,
        color: { dark: PRIMARY, light: '#FFFFFF' }
    });

    const photoSize = 220;
    const [{ photo: circularPhoto, ring: photoRingBuf, ringSize }, logoBuf] = await Promise.all([
        loadProfilePhoto(profile_photo, full_name, photoSize),
        pool ? loadCompanyLogo(pool, 70) : Promise.resolve(null)
    ]);

    const specLabel = getSpecLabel(specialization);
    const expText = experience_years ? `${experience_years} years experience` : '';
    const e = escapeSvg;
    const logoShift = logoBuf ? 90 : 0;

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

        <!-- Background -->
        <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="24" fill="white"/>

        <!-- Header -->
        <rect width="${CARD_WIDTH}" height="100" rx="24" fill="url(#headerGrad)"/>
        <rect y="24" width="${CARD_WIDTH}" height="76" fill="url(#headerGrad)"/>

        <!-- Header text -->
        <text x="${50 + logoShift}" y="48" font-family="Arial,sans-serif" font-size="28" font-weight="bold" fill="white">QUALITY COLOURS</text>
        <text x="${50 + logoShift}" y="75" font-family="Arial,sans-serif" font-size="16" fill="white" opacity="0.85">Your Trusted Paint Shop</text>

        <!-- Gold accent line -->
        <rect y="98" width="${CARD_WIDTH}" height="4" fill="${SECONDARY}"/>

        <!-- LEFT: Name + Contact -->
        <text x="60" y="165" font-family="Arial,sans-serif" font-size="42" font-weight="bold" fill="#1a1a2e">${e(full_name)}</text>
        <text x="60" y="200" font-family="Arial,sans-serif" font-size="22" fill="#64748b">${e(specLabel)}</text>
        ${expText ? `<text x="60" y="232" font-family="Arial,sans-serif" font-size="18" fill="#94a3b8">${e(expText)}</text>` : ''}

        <!-- Divider -->
        <line x1="60" y1="${expText ? 250 : 220}" x2="640" y2="${expText ? 250 : 220}" stroke="#e2e8f0" stroke-width="1.5"/>

        <!-- Phone -->
        <text x="60" y="${expText ? 290 : 260}" font-family="Arial,sans-serif" font-size="24" fill="#334155">&#x1F4DE;  ${e(phone)}</text>

        <!-- City -->
        ${city ? `<text x="60" y="${expText ? 328 : 298}" font-family="Arial,sans-serif" font-size="24" fill="#334155">&#x1F4CD;  ${e(city)}</text>` : ''}

        <!-- QR label -->
        <text x="${CARD_WIDTH - 115}" y="${CARD_HEIGHT - 110}" font-family="Arial,sans-serif" font-size="13" fill="#94a3b8" text-anchor="middle">Scan to join</text>

        <!-- Footer -->
        <rect y="${CARD_HEIGHT - 65}" width="${CARD_WIDTH}" height="65" rx="0" fill="url(#footerGrad)"/>
        <rect y="${CARD_HEIGHT - 65}" width="${CARD_WIDTH}" height="41" fill="url(#footerGrad)"/>
        <rect x="0" y="${CARD_HEIGHT - 24}" width="${CARD_WIDTH}" height="24" rx="24" fill="url(#footerGrad)"/>

        <text x="50" y="${CARD_HEIGHT - 26}" font-family="Arial,sans-serif" font-size="16" fill="white" opacity="0.9">QC PAINTERS PROGRAM</text>
        <text x="${CARD_WIDTH / 2}" y="${CARD_HEIGHT - 26}" font-family="Arial,sans-serif" font-size="20" font-weight="bold" fill="white" text-anchor="middle" letter-spacing="3">Ref: ${e(referral_code)}</text>
        <text x="${CARD_WIDTH - 50}" y="${CARD_HEIGHT - 26}" font-family="Arial,sans-serif" font-size="16" fill="white" text-anchor="end" opacity="0.9">Your Paint Partner</text>
    </svg>`;

    const cardBase = await sharp(Buffer.from(cardSvg)).png().toBuffer();

    const photoTop = 130;
    const photoLeft = CARD_WIDTH - photoSize - 70;

    const composites = [
        { input: photoRingBuf, top: photoTop - 6, left: photoLeft - 6 },
        { input: circularPhoto, top: photoTop, left: photoLeft },
        { input: qrBuffer, top: CARD_HEIGHT - 270, left: CARD_WIDTH - 190 },
    ];

    if (logoBuf) {
        composites.push({ input: logoBuf, top: 15, left: 40 });
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
// ID CARD — 700x1050 Portrait (badge-style)
// ═══════════════════════════════════════════════════════

async function generateIdCard(painter, pool) {
    const {
        id, full_name, phone, city, specialization,
        experience_years, referral_code, profile_photo
    } = painter;

    const registerUrl = `${ORIGIN}/painter-register.html?ref=${referral_code}`;
    const qrBuffer = await QRCode.toBuffer(registerUrl, {
        width: 160, margin: 1,
        color: { dark: PRIMARY, light: '#FFFFFF' }
    });

    const photoSize = 220;
    const [{ photo: circularPhoto, ring: photoRingBuf }, logoBuf] = await Promise.all([
        loadProfilePhoto(profile_photo, full_name, photoSize),
        pool ? loadCompanyLogo(pool, 55) : Promise.resolve(null)
    ]);

    const specLabel = getSpecLabel(specialization);
    const infoLine = [city, experience_years ? `${experience_years} yrs` : ''].filter(Boolean).join('  |  ');
    const e = escapeSvg;

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
        <rect width="${ID_WIDTH}" height="${ID_HEIGHT}" rx="28" fill="white"/>

        <!-- Green header -->
        <rect width="${ID_WIDTH}" height="150" rx="28" fill="url(#hGrad)"/>
        <rect y="28" width="${ID_WIDTH}" height="122" fill="url(#hGrad)"/>

        <!-- Header text -->
        <text x="${ID_WIDTH / 2}" y="60" font-family="Arial,sans-serif" font-size="26" font-weight="bold" fill="white" text-anchor="middle">QUALITY COLOURS</text>
        <text x="${ID_WIDTH / 2}" y="90" font-family="Arial,sans-serif" font-size="16" fill="white" text-anchor="middle" opacity="0.9">QC Painters Program</text>
        <text x="${ID_WIDTH / 2}" y="120" font-family="Arial,sans-serif" font-size="14" fill="white" text-anchor="middle" opacity="0.75">Painter Identity Card</text>

        <!-- Name & Details -->
        <text x="${ID_WIDTH / 2}" y="425" font-family="Arial,sans-serif" font-size="36" font-weight="bold" fill="#1a1a2e" text-anchor="middle">${e(full_name)}</text>
        <text x="${ID_WIDTH / 2}" y="460" font-family="Arial,sans-serif" font-size="20" fill="#64748b" text-anchor="middle">${e(specLabel)}</text>
        ${infoLine ? `<text x="${ID_WIDTH / 2}" y="490" font-family="Arial,sans-serif" font-size="18" fill="#94a3b8" text-anchor="middle">${e(infoLine)}</text>` : ''}

        <!-- Phone -->
        <text x="${ID_WIDTH / 2}" y="525" font-family="Arial,sans-serif" font-size="22" fill="#334155" text-anchor="middle">&#x1F4DE; ${e(phone)}</text>

        <!-- Gold divider -->
        <rect x="70" y="548" width="${ID_WIDTH - 140}" height="3" fill="${SECONDARY}" rx="1.5"/>

        <!-- Referral Code label -->
        <text x="${ID_WIDTH / 2}" y="585" font-family="Arial,sans-serif" font-size="15" fill="#94a3b8" text-anchor="middle" letter-spacing="2">REFERRAL CODE</text>

        <!-- Referral code box -->
        <rect x="160" y="596" width="${ID_WIDTH - 320}" height="52" rx="12" fill="#f0fdf4" stroke="${PRIMARY}" stroke-width="2"/>
        <text x="${ID_WIDTH / 2}" y="630" font-family="Arial,sans-serif" font-size="30" font-weight="bold" fill="${PRIMARY}" text-anchor="middle" letter-spacing="4">${e(referral_code)}</text>

        <!-- QR label -->
        <text x="${ID_WIDTH / 2}" y="${ID_HEIGHT - 125}" font-family="Arial,sans-serif" font-size="14" fill="#94a3b8" text-anchor="middle">Scan to join!</text>

        <!-- Footer -->
        <rect y="${ID_HEIGHT - 70}" width="${ID_WIDTH}" height="70" rx="0" fill="url(#fGrad)"/>
        <rect y="${ID_HEIGHT - 70}" width="${ID_WIDTH}" height="42" fill="url(#fGrad)"/>
        <rect x="0" y="${ID_HEIGHT - 28}" width="${ID_WIDTH}" height="28" rx="28" fill="url(#fGrad)"/>

        <text x="${ID_WIDTH / 2}" y="${ID_HEIGHT - 36}" font-family="Arial,sans-serif" font-size="15" fill="white" text-anchor="middle" opacity="0.95">Join us &amp; earn loyalty points on every purchase!</text>
        <text x="${ID_WIDTH / 2}" y="${ID_HEIGHT - 14}" font-family="Arial,sans-serif" font-size="12" fill="white" text-anchor="middle" opacity="0.7">Quality Colours — Your Trusted Paint Partner</text>
    </svg>`;

    const idBase = await sharp(Buffer.from(idSvg)).png().toBuffer();

    const photoLeft = (ID_WIDTH - photoSize) / 2;
    const photoTop = 170;

    const composites = [
        { input: photoRingBuf, top: photoTop - 6, left: photoLeft - 6 },
        { input: circularPhoto, top: photoTop, left: photoLeft },
        { input: qrBuffer, top: ID_HEIGHT - 290, left: (ID_WIDTH - 160) / 2 },
    ];

    if (logoBuf) {
        composites.push({ input: logoBuf, top: 14, left: 24 });
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
