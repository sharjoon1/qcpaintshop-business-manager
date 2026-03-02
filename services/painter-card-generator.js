/**
 * Painter Card Generator
 * Visiting card (1400x800 landscape) and ID card (800x1200 portrait)
 * BIG, BOLD, designed for WhatsApp mobile sharing
 */
const sharp = require('sharp');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const CARD_W = 1400;
const CARD_H = 800;
const ID_W = 800;
const ID_H = 1200;
const G = '#1B5E3B';
const GOLD = '#D4A24E';
const ORIGIN = process.env.APP_ORIGIN || 'https://act.qcpaintshop.com';

const esc = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function specLabel(s) {
    return (s || 'both').replace('both', 'Interior & Exterior').replace('interior', 'Interior').replace('exterior', 'Exterior').replace('industrial', 'Industrial') + ' Specialist';
}

async function loadLogo(pool, sz = 80) {
    try {
        const [r] = await pool.query("SELECT setting_value FROM settings WHERE setting_key='business_logo' LIMIT 1");
        if (!r.length || !r[0].setting_value) return null;
        const f = r[0].setting_value;
        const p = f.startsWith('/') ? path.join(__dirname, '..', 'public', f.split('?')[0]) : path.join(__dirname, '..', 'public', 'uploads', 'logos', f);
        if (!fs.existsSync(p)) return null;
        return await sharp(p).resize(sz, sz, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
    } catch (e) { return null; }
}

async function loadPhoto(photo, name, sz = 260) {
    const h = sz / 2, rs = sz + 14, rh = rs / 2;
    let buf;
    try {
        const pp = photo ? path.join(__dirname, '..', 'public', photo.split('?')[0]) : null;
        if (pp && fs.existsSync(pp)) buf = await sharp(pp).resize(sz, sz, { fit: 'cover' }).png().toBuffer();
    } catch (e) {}
    if (!buf) {
        const ini = (name || 'P').charAt(0).toUpperCase();
        buf = await sharp(Buffer.from(`<svg width="${sz}" height="${sz}"><circle cx="${h}" cy="${h}" r="${h}" fill="${GOLD}"/><text x="${h}" y="${h}" text-anchor="middle" dominant-baseline="central" font-family="Arial,sans-serif" font-size="${Math.round(sz * 0.45)}" font-weight="bold" fill="white">${ini}</text></svg>`)).png().toBuffer();
    }
    const mask = await sharp(Buffer.from(`<svg width="${sz}" height="${sz}"><circle cx="${h}" cy="${h}" r="${h - 2}" fill="white"/></svg>`)).png().toBuffer();
    const circ = await sharp(buf).resize(sz, sz).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    const ring = await sharp(Buffer.from(`<svg width="${rs}" height="${rs}"><circle cx="${rh}" cy="${rh}" r="${rh - 1}" fill="none" stroke="white" stroke-width="5"/></svg>`)).png().toBuffer();
    return { circ, ring, sz, rs };
}

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

// ══════════════════════════════════════════
// VISITING CARD — 1400x800
// ══════════════════════════════════════════

async function generateCard(painter, pool) {
    const { id, full_name, phone, city, specialization, experience_years, referral_code, profile_photo } = painter;

    const url = `${ORIGIN}/painter-register.html?ref=${referral_code}`;
    const qr = await QRCode.toBuffer(url, { width: 160, margin: 1, color: { dark: G, light: '#FFF' } });

    const pSz = 260;
    const [{ circ, ring }, logo] = await Promise.all([
        loadPhoto(profile_photo, full_name, pSz),
        pool ? loadLogo(pool, 80) : Promise.resolve(null)
    ]);

    const spec = specLabel(specialization);
    const exp = experience_years ? `${experience_years} years experience` : '';
    const e = esc;
    const ls = logo ? 100 : 0;

    const svg = `
    <svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="hg" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:${G}"/><stop offset="100%" style="stop-color:#2D7A4F"/>
            </linearGradient>
            <linearGradient id="fg" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:${G}"/><stop offset="100%" style="stop-color:${GOLD}"/>
            </linearGradient>
        </defs>

        <rect width="${CARD_W}" height="${CARD_H}" rx="28" fill="white"/>

        <!-- GREEN LEFT STRIP -->
        <rect width="20" height="${CARD_H}" rx="28" fill="${G}"/>
        <rect x="20" width="10" height="${CARD_H}" fill="${G}"/>

        <!-- Header bar -->
        <rect x="30" width="${CARD_W - 30}" height="110" rx="0" fill="url(#hg)"/>
        <rect x="30" y="0" width="28" height="110" fill="url(#hg)"/>

        <!-- Company name -->
        <text x="${60 + ls}" y="50" font-family="Arial,sans-serif" font-size="32" font-weight="bold" fill="white">QUALITY COLOURS</text>
        <text x="${60 + ls}" y="80" font-family="Arial,sans-serif" font-size="18" fill="white" opacity="0.9">Your Trusted Paint Shop</text>

        <!-- Gold accent -->
        <rect x="30" y="108" width="${CARD_W - 30}" height="5" fill="${GOLD}"/>

        <!-- NAME — BIG -->
        <text x="60" y="185" font-family="Arial,sans-serif" font-size="52" font-weight="bold" fill="#111827">${e(full_name)}</text>

        <!-- Specialization -->
        <text x="60" y="225" font-family="Arial,sans-serif" font-size="26" fill="#4b5563">${e(spec)}</text>
        ${exp ? `<text x="60" y="260" font-family="Arial,sans-serif" font-size="20" fill="#9ca3af">${e(exp)}</text>` : ''}

        <!-- Divider -->
        <rect x="60" y="${exp ? 280 : 245}" width="500" height="2" fill="#e5e7eb" rx="1"/>

        <!-- Phone BIG -->
        <text x="60" y="${exp ? 325 : 290}" font-family="Arial,sans-serif" font-size="30" font-weight="600" fill="#1f2937">&#x1F4DE;  ${e(phone)}</text>

        <!-- City -->
        ${city ? `<text x="60" y="${exp ? 370 : 335}" font-family="Arial,sans-serif" font-size="28" fill="#374151">&#x1F4CD;  ${e(city)}</text>` : ''}

        <!-- QR label -->
        <text x="${CARD_W - 120}" y="${CARD_H - 120}" font-family="Arial,sans-serif" font-size="14" fill="#9ca3af" text-anchor="middle">Scan to join</text>

        <!-- Footer -->
        <rect y="${CARD_H - 70}" width="${CARD_W}" height="70" fill="url(#fg)"/>
        <rect x="0" y="${CARD_H - 28}" width="${CARD_W}" height="28" rx="28" fill="url(#fg)"/>

        <text x="60" y="${CARD_H - 28}" font-family="Arial,sans-serif" font-size="18" fill="white" font-weight="600">QC PAINTERS PROGRAM</text>
        <text x="${CARD_W / 2}" y="${CARD_H - 28}" font-family="Arial,sans-serif" font-size="24" font-weight="bold" fill="white" text-anchor="middle" letter-spacing="4">Ref: ${e(referral_code)}</text>
        <text x="${CARD_W - 60}" y="${CARD_H - 28}" font-family="Arial,sans-serif" font-size="18" fill="white" text-anchor="end" opacity="0.9">Your Paint Partner</text>
    </svg>`;

    const base = await sharp(Buffer.from(svg)).png().toBuffer();
    const pTop = 140, pLeft = CARD_W - pSz - 80;
    const comp = [
        { input: ring, top: pTop - 7, left: pLeft - 7 },
        { input: circ, top: pTop, left: pLeft },
        { input: qr, top: CARD_H - 285, left: CARD_W - 200 },
    ];
    if (logo) comp.push({ input: logo, top: 16, left: 50 });

    const dir = path.join(__dirname, '..', 'public', 'uploads', 'painter-cards');
    ensureDir(dir);
    await sharp(base).composite(comp).png({ quality: 90 }).toFile(path.join(dir, `painter_${id}.png`));
    return `/uploads/painter-cards/painter_${id}.png?v=${Date.now()}`;
}

// ══════════════════════════════════════════
// ID CARD — 800x1200 Portrait
// ══════════════════════════════════════════

async function generateIdCard(painter, pool) {
    const { id, full_name, phone, city, specialization, experience_years, referral_code, profile_photo } = painter;

    const url = `${ORIGIN}/painter-register.html?ref=${referral_code}`;
    const qr = await QRCode.toBuffer(url, { width: 180, margin: 1, color: { dark: G, light: '#FFF' } });

    const pSz = 260;
    const [{ circ, ring }, logo] = await Promise.all([
        loadPhoto(profile_photo, full_name, pSz),
        pool ? loadLogo(pool, 60) : Promise.resolve(null)
    ]);

    const spec = specLabel(specialization);
    const info = [city, experience_years ? `${experience_years} yrs` : ''].filter(Boolean).join('  |  ');
    const e = esc;

    const svg = `
    <svg width="${ID_W}" height="${ID_H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="hg" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:${G}"/><stop offset="100%" style="stop-color:#2D7A4F"/>
            </linearGradient>
            <linearGradient id="fg" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:${G}"/><stop offset="100%" style="stop-color:${GOLD}"/>
            </linearGradient>
        </defs>

        <rect width="${ID_W}" height="${ID_H}" rx="32" fill="white"/>

        <!-- Green header -->
        <rect width="${ID_W}" height="170" rx="32" fill="url(#hg)"/>
        <rect y="32" width="${ID_W}" height="138" fill="url(#hg)"/>

        <!-- Gold bottom border of header -->
        <rect y="168" width="${ID_W}" height="5" fill="${GOLD}"/>

        <!-- Header text -->
        <text x="${ID_W / 2}" y="65" font-family="Arial,sans-serif" font-size="30" font-weight="bold" fill="white" text-anchor="middle">QUALITY COLOURS</text>
        <text x="${ID_W / 2}" y="100" font-family="Arial,sans-serif" font-size="18" fill="white" text-anchor="middle" opacity="0.9">QC Painters Program</text>
        <text x="${ID_W / 2}" y="135" font-family="Arial,sans-serif" font-size="16" fill="white" text-anchor="middle" opacity="0.75">PAINTER IDENTITY CARD</text>

        <!-- Name BIG -->
        <text x="${ID_W / 2}" y="490" font-family="Arial,sans-serif" font-size="44" font-weight="bold" fill="#111827" text-anchor="middle">${e(full_name)}</text>

        <!-- Specialization -->
        <text x="${ID_W / 2}" y="530" font-family="Arial,sans-serif" font-size="24" fill="#4b5563" text-anchor="middle">${e(spec)}</text>
        ${info ? `<text x="${ID_W / 2}" y="565" font-family="Arial,sans-serif" font-size="20" fill="#9ca3af" text-anchor="middle">${e(info)}</text>` : ''}

        <!-- Phone BIG -->
        <text x="${ID_W / 2}" y="605" font-family="Arial,sans-serif" font-size="28" font-weight="600" fill="#1f2937" text-anchor="middle">&#x1F4DE;  ${e(phone)}</text>

        <!-- Gold divider -->
        <rect x="80" y="630" width="${ID_W - 160}" height="3" fill="${GOLD}" rx="1.5"/>

        <!-- REFERRAL CODE label -->
        <text x="${ID_W / 2}" y="670" font-family="Arial,sans-serif" font-size="16" fill="#9ca3af" text-anchor="middle" letter-spacing="3">REFERRAL CODE</text>

        <!-- Code box -->
        <rect x="180" y="684" width="${ID_W - 360}" height="58" rx="14" fill="#f0fdf4" stroke="${G}" stroke-width="2.5"/>
        <text x="${ID_W / 2}" y="722" font-family="Arial,sans-serif" font-size="36" font-weight="bold" fill="${G}" text-anchor="middle" letter-spacing="5">${e(referral_code)}</text>

        <!-- QR label -->
        <text x="${ID_W / 2}" y="${ID_H - 140}" font-family="Arial,sans-serif" font-size="15" fill="#9ca3af" text-anchor="middle">Scan to join!</text>

        <!-- Footer -->
        <rect y="${ID_H - 80}" width="${ID_W}" height="80" fill="url(#fg)"/>
        <rect x="0" y="${ID_H - 32}" width="${ID_W}" height="32" rx="32" fill="url(#fg)"/>

        <text x="${ID_W / 2}" y="${ID_H - 40}" font-family="Arial,sans-serif" font-size="17" fill="white" text-anchor="middle" font-weight="600">Join us &amp; earn loyalty points on every purchase!</text>
        <text x="${ID_W / 2}" y="${ID_H - 16}" font-family="Arial,sans-serif" font-size="13" fill="white" text-anchor="middle" opacity="0.8">Quality Colours — Your Trusted Paint Partner</text>
    </svg>`;

    const base = await sharp(Buffer.from(svg)).png().toBuffer();
    const pLeft = (ID_W - pSz) / 2, pTop = 195;
    const comp = [
        { input: ring, top: pTop - 7, left: pLeft - 7 },
        { input: circ, top: pTop, left: pLeft },
        { input: qr, top: ID_H - 325, left: (ID_W - 180) / 2 },
    ];
    if (logo) comp.push({ input: logo, top: 16, left: 28 });

    const dir = path.join(__dirname, '..', 'public', 'uploads', 'painter-cards');
    ensureDir(dir);
    await sharp(base).composite(comp).png({ quality: 90 }).toFile(path.join(dir, `painter_id_${id}.png`));
    return `/uploads/painter-cards/painter_id_${id}.png?v=${Date.now()}`;
}

module.exports = { generateCard, generateIdCard };
