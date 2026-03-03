/**
 * Painter Card Generator — Premium Design v4
 * Visiting card (1400x800) — centered name/phone, BIG logo
 * ID card (800x1200) — portrait badge, BIG logo
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

async function loadPhoto(photo, name, sz = 260, ringColor = 'white') {
    const h = sz / 2, rs = sz + 16, rh = rs / 2;
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
    const ring = await sharp(Buffer.from(`<svg width="${rs}" height="${rs}"><circle cx="${rh}" cy="${rh}" r="${rh - 1}" fill="none" stroke="${ringColor}" stroke-width="7"/></svg>`)).png().toBuffer();
    return { circ, ring, sz, rs };
}

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

// ══════════════════════════════════════════
// VISITING CARD — 1400x800
// Centered name/phone, big logo, photo right
// ══════════════════════════════════════════

async function generateCard(painter, pool) {
    const { id, full_name, phone, city, specialization, experience_years, referral_code, profile_photo } = painter;

    const url = `${ORIGIN}/painter-register.html?ref=${referral_code}`;
    const qr = await QRCode.toBuffer(url, { width: 180, margin: 1, color: { dark: G, light: '#FFF' } });

    const pSz = 280;
    const logoSz = 180;
    const [{ circ, ring }, logo] = await Promise.all([
        loadPhoto(profile_photo, full_name, pSz),
        pool ? loadLogo(pool, logoSz) : Promise.resolve(null)
    ]);

    const spec = specLabel(specialization);
    const exp = experience_years ? `${experience_years} years experience` : '';
    const e = esc;

    // Text centered in left portion (before photo area)
    const cx = 530;

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

        <!-- Background -->
        <rect width="${CARD_W}" height="${CARD_H}" rx="28" fill="white"/>

        <!-- Gold inner border -->
        <rect x="6" y="6" width="${CARD_W - 12}" height="${CARD_H - 12}" rx="24" fill="none" stroke="${GOLD}" stroke-width="1.5" opacity="0.25"/>

        <!-- Decorative circles behind photo -->
        <circle cx="${CARD_W - 190}" cy="340" r="240" fill="#f0fdf4" opacity="0.3"/>

        <!-- GREEN LEFT STRIP + gold edge -->
        <rect width="26" height="${CARD_H}" rx="28" fill="${G}"/>
        <rect x="22" width="8" height="${CARD_H}" fill="${G}"/>
        <rect x="28" width="5" height="${CARD_H}" fill="${GOLD}"/>

        <!-- Header bar — tall for big logo -->
        <rect x="33" width="${CARD_W - 33}" height="190" fill="url(#hg)"/>
        <rect x="33" y="0" width="28" height="190" fill="url(#hg)"/>

        <!-- Company text (positioned after logo space) -->
        <text x="${logo ? 250 : 60}" y="85" font-family="Arial,sans-serif" font-size="50" font-weight="bold" fill="white">QUALITY COLOURS</text>
        <text x="${logo ? 250 : 60}" y="128" font-family="Arial,sans-serif" font-size="28" fill="white" opacity="0.9">Your Trusted Paint Shop</text>

        <!-- Gold accent -->
        <rect x="33" y="188" width="${CARD_W - 33}" height="7" fill="${GOLD}"/>

        <!-- NAME — CENTERED, HUGE -->
        <text x="${cx}" y="295" font-family="Arial,sans-serif" font-size="90" font-weight="bold" fill="#111827" text-anchor="middle">${e(full_name)}</text>

        <!-- Gold underline centered -->
        <rect x="${cx - 210}" y="310" width="420" height="5" rx="2.5" fill="${GOLD}"/>

        <!-- Spec centered -->
        <text x="${cx}" y="365" font-family="Arial,sans-serif" font-size="36" fill="#4b5563" text-anchor="middle">${e(spec)}</text>
        ${exp ? `<text x="${cx}" y="405" font-family="Arial,sans-serif" font-size="28" fill="#9ca3af" text-anchor="middle">${e(exp)}</text>` : ''}

        <!-- Phone — CENTERED, BIG -->
        <text x="${cx}" y="${exp ? 475 : 445}" font-family="Arial,sans-serif" font-size="50" font-weight="700" fill="#1f2937" text-anchor="middle">&#x1F4DE;  ${e(phone)}</text>

        <!-- City centered -->
        ${city ? `<text x="${cx}" y="${exp ? 530 : 500}" font-family="Arial,sans-serif" font-size="38" fill="#374151" text-anchor="middle">&#x1F4CD;  ${e(city)}</text>` : ''}

        <!-- QR label -->
        <text x="${CARD_W - 130}" y="${CARD_H - 145}" font-family="Arial,sans-serif" font-size="18" fill="#9ca3af" text-anchor="middle">Scan to join</text>

        <!-- Footer -->
        <rect y="${CARD_H - 80}" width="${CARD_W}" height="80" fill="url(#fg)"/>
        <rect x="0" y="${CARD_H - 28}" width="${CARD_W}" height="28" rx="28" fill="url(#fg)"/>

        <text x="60" y="${CARD_H - 32}" font-family="Arial,sans-serif" font-size="24" fill="white" font-weight="700">QC PAINTERS PROGRAM</text>
        <text x="${CARD_W / 2}" y="${CARD_H - 32}" font-family="Arial,sans-serif" font-size="30" font-weight="bold" fill="white" text-anchor="middle" letter-spacing="4">Ref: ${e(referral_code)}</text>
        <text x="${CARD_W - 60}" y="${CARD_H - 32}" font-family="Arial,sans-serif" font-size="22" fill="white" text-anchor="end" opacity="0.9">Your Paint Partner</text>
    </svg>`;

    const base = await sharp(Buffer.from(svg)).png().toBuffer();
    const pTop = 210, pLeft = CARD_W - pSz - 65;
    const comp = [
        { input: ring, top: pTop - 8, left: pLeft - 8 },
        { input: circ, top: pTop, left: pLeft },
        { input: qr, top: CARD_H - 305, left: CARD_W - 220 },
    ];
    if (logo) comp.push({ input: logo, top: 5, left: 42 });

    const dir = path.join(__dirname, '..', 'public', 'uploads', 'painter-cards');
    ensureDir(dir);
    await sharp(base).composite(comp).png({ quality: 90 }).toFile(path.join(dir, `painter_${id}.png`));
    return `/uploads/painter-cards/painter_${id}.png?v=${Date.now()}`;
}

// ══════════════════════════════════════════
// ID CARD — 800x1200 Premium Badge
// Big logo, big fonts
// ══════════════════════════════════════════

async function generateIdCard(painter, pool) {
    const { id, full_name, phone, city, specialization, experience_years, referral_code, profile_photo } = painter;

    const url = `${ORIGIN}/painter-register.html?ref=${referral_code}`;
    const qr = await QRCode.toBuffer(url, { width: 180, margin: 1, color: { dark: G, light: '#FFF' } });

    const pSz = 260;
    const logoSz = 130;
    const [{ circ, ring }, logo] = await Promise.all([
        loadPhoto(profile_photo, full_name, pSz, GOLD),
        pool ? loadLogo(pool, logoSz) : Promise.resolve(null)
    ]);

    const spec = specLabel(specialization);
    const info = [city, experience_years ? `${experience_years} yrs` : ''].filter(Boolean).join('  |  ');
    const e = esc;

    const nameY = 520;
    const specY = 578;
    const phoneY = info ? 660 : 628;
    const divY = phoneY + 32;
    const labelY = divY + 38;
    const boxY = labelY + 18;
    const codeY = boxY + 48;

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

        <!-- Background -->
        <rect width="${ID_W}" height="${ID_H}" rx="32" fill="white"/>

        <!-- Gold inner border -->
        <rect x="8" y="8" width="${ID_W - 16}" height="${ID_H - 16}" rx="28" fill="none" stroke="${GOLD}" stroke-width="2" opacity="0.35"/>

        <!-- Green header -->
        <rect width="${ID_W}" height="185" rx="32" fill="url(#hg)"/>
        <rect y="32" width="${ID_W}" height="153" fill="url(#hg)"/>

        <!-- Gold accent -->
        <rect y="183" width="${ID_W}" height="7" fill="${GOLD}"/>

        <!-- Header text -->
        <text x="${ID_W / 2}" y="68" font-family="Arial,sans-serif" font-size="46" font-weight="bold" fill="white" text-anchor="middle">QUALITY COLOURS</text>
        <text x="${ID_W / 2}" y="110" font-family="Arial,sans-serif" font-size="26" fill="white" text-anchor="middle" opacity="0.9">QC Painters Program</text>
        <text x="${ID_W / 2}" y="153" font-family="Arial,sans-serif" font-size="24" fill="white" text-anchor="middle" opacity="0.75" letter-spacing="3">PAINTER IDENTITY CARD</text>

        <!-- Name — BIG -->
        <text x="${ID_W / 2}" y="${nameY}" font-family="Arial,sans-serif" font-size="68" font-weight="bold" fill="#111827" text-anchor="middle">${e(full_name)}</text>

        <!-- Gold underline -->
        <rect x="${(ID_W - 360) / 2}" y="${nameY + 14}" width="360" height="5" rx="2.5" fill="${GOLD}"/>

        <!-- Spec -->
        <text x="${ID_W / 2}" y="${specY}" font-family="Arial,sans-serif" font-size="34" fill="#4b5563" text-anchor="middle">${e(spec)}</text>
        ${info ? `<text x="${ID_W / 2}" y="${specY + 42}" font-family="Arial,sans-serif" font-size="28" fill="#9ca3af" text-anchor="middle">${e(info)}</text>` : ''}

        <!-- Phone — BIG -->
        <text x="${ID_W / 2}" y="${phoneY}" font-family="Arial,sans-serif" font-size="44" font-weight="600" fill="#1f2937" text-anchor="middle">&#x1F4DE;  ${e(phone)}</text>

        <!-- Gold divider -->
        <rect x="70" y="${divY}" width="${ID_W - 140}" height="4" fill="${GOLD}" rx="2"/>

        <!-- Referral label -->
        <text x="${ID_W / 2}" y="${labelY}" font-family="Arial,sans-serif" font-size="22" fill="#9ca3af" text-anchor="middle" letter-spacing="3">REFERRAL CODE</text>

        <!-- Code box -->
        <rect x="130" y="${boxY}" width="${ID_W - 260}" height="70" rx="16" fill="#f0fdf4" stroke="${G}" stroke-width="3"/>
        <text x="${ID_W / 2}" y="${codeY}" font-family="Arial,sans-serif" font-size="52" font-weight="bold" fill="${G}" text-anchor="middle" letter-spacing="6">${e(referral_code)}</text>

        <!-- QR label -->
        <text x="${ID_W / 2}" y="${ID_H - 340}" font-family="Arial,sans-serif" font-size="18" fill="#9ca3af" text-anchor="middle">Scan to join!</text>

        <!-- Footer -->
        <rect y="${ID_H - 90}" width="${ID_W}" height="90" fill="url(#fg)"/>
        <rect x="0" y="${ID_H - 32}" width="${ID_W}" height="32" rx="32" fill="url(#fg)"/>

        <text x="${ID_W / 2}" y="${ID_H - 48}" font-family="Arial,sans-serif" font-size="22" fill="white" text-anchor="middle" font-weight="600">Join us &amp; earn loyalty points on every purchase!</text>
        <text x="${ID_W / 2}" y="${ID_H - 18}" font-family="Arial,sans-serif" font-size="16" fill="white" text-anchor="middle" opacity="0.8">Quality Colours — Your Trusted Paint Partner</text>
    </svg>`;

    const base = await sharp(Buffer.from(svg)).png().toBuffer();
    const pLeft = (ID_W - pSz) / 2, pTop = 210;
    const comp = [
        { input: ring, top: pTop - 8, left: pLeft - 8 },
        { input: circ, top: pTop, left: pLeft },
        { input: qr, top: ID_H - 325, left: (ID_W - 180) / 2 },
    ];
    if (logo) comp.push({ input: logo, top: 8, left: 16 });

    const dir = path.join(__dirname, '..', 'public', 'uploads', 'painter-cards');
    ensureDir(dir);
    await sharp(base).composite(comp).png({ quality: 90 }).toFile(path.join(dir, `painter_id_${id}.png`));
    return `/uploads/painter-cards/painter_id_${id}.png?v=${Date.now()}`;
}

module.exports = { generateCard, generateIdCard };
