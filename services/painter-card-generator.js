/**
 * Painter Visiting Card Generator
 * Generates a professional PNG business card using Sharp
 */
const sharp = require('sharp');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const CARD_WIDTH = 1050;
const CARD_HEIGHT = 600;
const PRIMARY = '#1B5E3B';
const SECONDARY = '#D4A24E';
const ORIGIN = process.env.APP_ORIGIN || 'https://act.qcpaintshop.com';

async function generateCard(painter) {
    const {
        id, full_name, phone, city, specialization,
        experience_years, referral_code, profile_photo
    } = painter;

    // 1. Generate QR code as PNG buffer
    const registerUrl = `${ORIGIN}/painter-register.html?ref=${referral_code}`;
    const qrBuffer = await QRCode.toBuffer(registerUrl, {
        width: 140,
        margin: 1,
        color: { dark: PRIMARY, light: '#FFFFFF' }
    });

    // 2. Load profile photo or create initials avatar
    let photoBuffer;
    try {
        const photoPath = profile_photo
            ? path.join(__dirname, '..', 'public', profile_photo.split('?')[0])
            : null;
        if (photoPath && fs.existsSync(photoPath)) {
            photoBuffer = await sharp(photoPath)
                .resize(120, 120, { fit: 'cover' })
                .png()
                .toBuffer();
        }
    } catch (e) { /* use initials fallback */ }

    if (!photoBuffer) {
        // Create initials circle
        const initial = (full_name || 'P').charAt(0).toUpperCase();
        const initialSvg = `<svg width="120" height="120"><circle cx="60" cy="60" r="60" fill="${SECONDARY}"/><text x="60" y="60" text-anchor="middle" dominant-baseline="central" font-family="Arial,sans-serif" font-size="52" font-weight="bold" fill="white">${initial}</text></svg>`;
        photoBuffer = await sharp(Buffer.from(initialSvg)).png().toBuffer();
    }

    // 3. Make photo circular with mask
    const circleMask = Buffer.from(`<svg width="120" height="120"><circle cx="60" cy="60" r="58" fill="white"/></svg>`);
    const circleMaskBuf = await sharp(circleMask).png().toBuffer();
    const circularPhoto = await sharp(photoBuffer)
        .resize(120, 120)
        .composite([{ input: circleMaskBuf, blend: 'dest-in' }])
        .png()
        .toBuffer();

    // Add white border ring around photo
    const photoRing = Buffer.from(`<svg width="130" height="130"><circle cx="65" cy="65" r="64" fill="none" stroke="white" stroke-width="3"/></svg>`);
    const photoRingBuf = await sharp(photoRing).png().toBuffer();

    // 4. Build SVG card layout
    const specLabel = (specialization || 'both')
        .replace('both', 'Interior & Exterior')
        .replace('interior', 'Interior')
        .replace('exterior', 'Exterior')
        .replace('industrial', 'Industrial')
        + ' Specialist';
    const expText = experience_years ? `${experience_years} years experience` : '';

    const escapeSvg = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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

        <!-- White background -->
        <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="20" fill="white"/>

        <!-- Header gradient bar -->
        <rect width="${CARD_WIDTH}" height="90" rx="20" fill="url(#headerGrad)"/>
        <rect y="20" width="${CARD_WIDTH}" height="70" fill="url(#headerGrad)"/>

        <!-- Header text -->
        <text x="40" y="42" font-family="Arial,sans-serif" font-size="24" font-weight="bold" fill="white">QC PAINTERS</text>
        <text x="${CARD_WIDTH - 40}" y="42" font-family="Arial,sans-serif" font-size="14" fill="white" text-anchor="end" opacity="0.9">Quality Colours</text>
        <text x="${CARD_WIDTH - 40}" y="62" font-family="Arial,sans-serif" font-size="11" fill="white" text-anchor="end" opacity="0.7">Your Trusted Paint Partner</text>

        <!-- Thin gold accent line -->
        <rect y="88" width="${CARD_WIDTH}" height="3" fill="${SECONDARY}"/>

        <!-- Name & details -->
        <text x="200" y="160" font-family="Arial,sans-serif" font-size="28" font-weight="bold" fill="#1a1a2e">${escapeSvg(full_name)}</text>
        <text x="200" y="190" font-family="Arial,sans-serif" font-size="16" fill="#64748b">${escapeSvg(specLabel)}</text>
        ${expText ? `<text x="200" y="215" font-family="Arial,sans-serif" font-size="14" fill="#94a3b8">${escapeSvg(expText)}</text>` : ''}

        <!-- Divider -->
        <line x1="200" y1="240" x2="650" y2="240" stroke="#e2e8f0" stroke-width="1"/>

        <!-- Phone -->
        <text x="216" y="275" font-family="Arial,sans-serif" font-size="16" fill="#334155">&#x1F4DE;  ${escapeSvg(phone)}</text>

        <!-- City -->
        ${city ? `<text x="216" y="305" font-family="Arial,sans-serif" font-size="16" fill="#334155">&#x1F4CD;  ${escapeSvg(city)}</text>` : ''}

        <!-- Referral code -->
        <text x="216" y="${city ? 345 : 315}" font-family="Arial,sans-serif" font-size="13" fill="#94a3b8">Referral Code</text>
        <text x="216" y="${city ? 370 : 340}" font-family="Arial,sans-serif" font-size="20" font-weight="bold" fill="${PRIMARY}" letter-spacing="2">${escapeSvg(referral_code)}</text>

        <!-- QR label -->
        <text x="${CARD_WIDTH - 120}" y="410" font-family="Arial,sans-serif" font-size="10" fill="#94a3b8" text-anchor="middle">Scan to Register</text>

        <!-- Footer -->
        <rect y="${CARD_HEIGHT - 50}" width="${CARD_WIDTH}" height="50" rx="0" fill="url(#footerGrad)"/>
        <rect y="${CARD_HEIGHT - 50}" width="${CARD_WIDTH}" height="30" fill="url(#footerGrad)"/>
        <rect x="0" y="${CARD_HEIGHT - 20}" width="${CARD_WIDTH}" height="20" rx="20" fill="url(#footerGrad)"/>
        <text x="${CARD_WIDTH / 2}" y="${CARD_HEIGHT - 18}" font-family="Arial,sans-serif" font-size="13" fill="white" text-anchor="middle" opacity="0.9">Quality Colours — Your Trusted Paint Partner</text>
    </svg>`;

    // 5. Composite everything
    const cardBase = await sharp(Buffer.from(cardSvg)).png().toBuffer();

    const outputPath = path.join(__dirname, '..', 'public', 'uploads', 'painter-cards', `painter_${id}.png`);

    await sharp(cardBase)
        .composite([
            // Profile photo (positioned in left area)
            { input: circularPhoto, top: 130, left: 50 },
            { input: photoRingBuf, top: 125, left: 45 },
            // QR code (positioned in right area)
            { input: qrBuffer, top: 250, left: CARD_WIDTH - 190 },
        ])
        .png({ quality: 90 })
        .toFile(outputPath);

    return `/uploads/painter-cards/painter_${id}.png?v=${Date.now()}`;
}

module.exports = { generateCard };
