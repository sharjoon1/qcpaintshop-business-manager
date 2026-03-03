/**
 * Painter Card Generator — Premium Design v3
 * Visiting card (1400x800 landscape) and ID card (800x1200 portrait)
 * EXTRA BIG, BOLD fonts — designed for WhatsApp mobile sharing
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
// VISITING CARD — 1400x800 Premium v3
// ══════════════════════════════════════════

async function generateCard(painter, pool) {
    const { id, full_name, phone, city, specialization, experience_years, referral_code, profile_photo } = painter;

    const url = `${ORIGIN}/painter-register.html?ref=${referral_code}`;
    const qr = await QRCode.toBuffer(url, { width: 180, margin: 1, color: { dark: G, light: '#FFF' } });

    const pSz = 280;
    const logoSz = 110;
    const [{ circ, ring }, logo] = await Promise.all([
        loadPhoto(profile_photo, full_name, pSz),
        pool ? loadLogo(pool, logoSz) : Promise.resolve(null)
    ]);

    const spec = specLabel(specialization);
    const exp = experience_years ? `${experience_years} years experience` : '';
    const e = esc;
    const ls = logo ? (logoSz + 20) : 0;

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

        <!-- Subtle gold inner border -->
        <rect x="6" y="6" width="${CARD_W - 12}" height="${CARD_H - 12}" rx="24" fill="none" stroke="${GOLD}" stroke-width="1.5" opacity="0.25"/>

        <!-- Decorative circle behind photo area -->
        <circle cx="${CARD_W - 200}" cy="330" r="240" fill="#f0fdf4" opacity="0.35"/>
        <circle cx="${CARD_W - 160}" cy="370" r="180" fill="#f0fdf4" opacity="0.2"/>

        <!-- GREEN LEFT STRIP with gold edge -->
        <rect width="26" height="${CARD_H}" rx="28" fill="${G}"/>
        <rect x="22" width="8" height="${CARD_H}" fill="${G}"/>
        <rect x="28" width="5" height="${CARD_H}" fill="${GOLD}"/>

        <!-- Header bar — taller -->
        <rect x="33" width="${CARD_W - 33}" height="140" fill="url(#hg)"/>
        <rect x="33" y="0" width="28" height="140" fill="url(#hg)"/>

        <!-- Company name — EXTRA BIG -->
        <text x="${55 + ls}" y="62" font-family="Arial,sans-serif" font-size="48" font-weight="bold" fill="white">QUALITY COLOURS</text>
        <text x="${55 + ls}" y="102" font-family="Arial,sans-serif" font-size="26" fill="white" opacity="0.9">Your Trusted Paint Shop</text>

        <!-- Gold accent line — bold -->
        <rect x="33" y="138" width="${CARD_W - 33}" height="7" fill="${GOLD}"/>

        <!-- NAME — EXTRA BIG -->
        <text x="60" y="225" font-family="Arial,sans-serif" font-size="80" font-weight="bold" fill="#111827">${e(full_name)}</text>

        <!-- Gold accent underline -->
        <rect x="60" y="238" width="400" height="5" rx="2.5" fill="${GOLD}"/>

        <!-- Specialization — BIG -->
        <text x="60" y="290" font-family="Arial,sans-serif" font-size="36" fill="#4b5563">${e(spec)}</text>
        ${exp ? `<text x="60" y="330" font-family="Arial,sans-serif" font-size="28" fill="#9ca3af">${e(exp)}</text>` : ''}

        <!-- Divider -->
        <rect x="60" y="${exp ? 352 : 312}" width="520" height="2" fill="#e5e7eb" rx="1"/>

        <!-- Phone — EXTRA BIG -->
        <text x="60" y="${exp ? 405 : 365}" font-family="Arial,sans-serif" font-size="46" font-weight="600" fill="#1f2937">&#x1F4DE;  ${e(phone)}</text>

        <!-- City — BIG -->
        ${city ? `<text x="60" y="${exp ? 460 : 420}" font-family="Arial,sans-serif" font-size="38" fill="#374151">&#x1F4CD;  ${e(city)}</text>` : ''}

        <!-- QR label -->
        <text x="${CARD_W - 130}" y="${CARD_H - 140}" font-family="Arial,sans-serif" font-size="18" fill="#9ca3af" text-anchor="middle">Scan to join</text>

        <!-- Footer — bold -->
        <rect y="${CARD_H - 80}" width="${CARD_W}" height="80" fill="url(#fg)"/>
        <rect x="0" y="${CARD_H - 28}" width="${CARD_W}" height="28" rx="28" fill="url(#fg)"/>

        <text x="60" y="${CARD_H - 32}" font-family="Arial,sans-serif" font-size="24" fill="white" font-weight="700">QC PAINTERS PROGRAM</text>
        <text x="${CARD_W / 2}" y="${CARD_H - 32}" font-family="Arial,sans-serif" font-size="30" font-weight="bold" fill="white" text-anchor="middle" letter-spacing="4">Ref: ${e(referral_code)}</text>
        <text x="${CARD_W - 60}" y="${CARD_H - 32}" font-family="Arial,sans-serif" font-size="22" fill="white" text-anchor="end" opacity="0.9">Your Paint Partner</text>
    </svg>`;

    const base = await sharp(Buffer.from(svg)).png().toBuffer();
    const pTop = 150, pLeft = CARD_W - pSz - 70;
    const comp = [
        { input: ring, top: pTop - 8, left: pLeft - 8 },
        { input: circ, top: pTop, left: pLeft },
        { input: qr, top: CARD_H - 300, left: CARD_W - 220 },
    ];
    if (logo) comp.push({ input: logo, top: 15, left: 48 });

    const dir = path.join(__dirname, '..', 'public', 'uploads', 'painter-cards');
    ensureDir(dir);
    await sharp(base).composite(comp).png({ quality: 90 }).toFile(path.join(dir, `painter_${id}.png`));
    return `/uploads/painter-cards/painter_${id}.png?v=${Date.now()}`;
}

// ══════════════════════════════════════════
// ID CARD — 800x1200 Premium Badge v3
// ══════════════════════════════════════════

async function generateIdCard(painter, pool) {
    const { id, full_name, phone, city, specialization, experience_years, referral_code, profile_photo } = painter;

    const url = `${ORIGIN}/painter-register.html?ref=${referral_code}`;
    const qr = await QRCode.toBuffer(url, { width: 180, margin: 1, color: { dark: G, light: '#FFF' } });

    const pSz = 260;
    const logoSz = 90;
    const [{ circ, ring }, logo] = await Promise.all([
        loadPhoto(profile_photo, full_name, pSz, GOLD),
        pool ? loadLogo(pool, logoSz) : Promise.resolve(null)
    ]);

    const spec = specLabel(specialization);
    const info = [city, experience_years ? `${experience_years} yrs` : ''].filter(Boolean).join('  |  ');
    const e = esc;

    // Dynamic Y positioning
    const nameY = 515;
    const specY = 570;
    const phoneY = info ? 650 : 618;
    const divY = phoneY + 30;
    const labelY = divY + 38;
    const boxY = labelY + 18;
    const codeY = boxY + 46;

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

        <!-- Gold inner border — more visible -->
        <rect x="8" y="8" width="${ID_W - 16}" height="${ID_H - 16}" rx="28" fill="none" stroke="${GOLD}" stroke-width="2" opacity="0.35"/>

        <!-- Green header -->
        <rect width="${ID_W}" height="180" rx="32" fill="url(#hg)"/>
        <rect y="32" width="${ID_W}" height="148" fill="url(#hg)"/>

        <!-- Gold bottom border of header -->
        <rect y="178" width="${ID_W}" height="7" fill="${GOLD}"/>

        <!-- Header text — EXTRA BIG -->
        <text x="${ID_W / 2}" y="65" font-family="Arial,sans-serif" font-size="44" font-weight="bold" fill="white" text-anchor="middle">QUALITY COLOURS</text>
        <text x="${ID_W / 2}" y="105" font-family="Arial,sans-serif" font-size="26" fill="white" text-anchor="middle" opacity="0.9">QC Painters Program</text>
        <text x="${ID_W / 2}" y="148" font-family="Arial,sans-serif" font-size="22" fill="white" text-anchor="middle" opacity="0.75" letter-spacing="3">PAINTER IDENTITY CARD</text>

        <!-- Name — EXTRA BIG -->
        <text x="${ID_W / 2}" y="${nameY}" font-family="Arial,sans-serif" font-size="68" font-weight="bold" fill="#111827" text-anchor="middle">${e(full_name)}</text>

        <!-- Gold accent underline -->
        <rect x="${(ID_W - 350) / 2}" y="${nameY + 12}" width="350" height="5" rx="2.5" fill="${GOLD}"/>

        <!-- Specialization — BIG -->
        <text x="${ID_W / 2}" y="${specY}" font-family="Arial,sans-serif" font-size="34" fill="#4b5563" text-anchor="middle">${e(spec)}</text>
        ${info ? `<text x="${ID_W / 2}" y="${specY + 40}" font-family="Arial,sans-serif" font-size="28" fill="#9ca3af" text-anchor="middle">${e(info)}</text>` : ''}

        <!-- Phone — EXTRA BIG -->
        <text x="${ID_W / 2}" y="${phoneY}" font-family="Arial,sans-serif" font-size="44" font-weight="600" fill="#1f2937" text-anchor="middle">&#x1F4DE;  ${e(phone)}</text>

        <!-- Gold divider -->
        <rect x="70" y="${divY}" width="${ID_W - 140}" height="4" fill="${GOLD}" rx="2"/>

        <!-- REFERRAL CODE label -->
        <text x="${ID_W / 2}" y="${labelY}" font-family="Arial,sans-serif" font-size="22" fill="#9ca3af" text-anchor="middle" letter-spacing="3">REFERRAL CODE</text>

        <!-- Code box — BIGGER -->
        <rect x="140" y="${boxY}" width="${ID_W - 280}" height="68" rx="16" fill="#f0fdf4" stroke="${G}" stroke-width="3"/>
        <text x="${ID_W / 2}" y="${codeY}" font-family="Arial,sans-serif" font-size="50" font-weight="bold" fill="${G}" text-anchor="middle" letter-spacing="6">${e(referral_code)}</text>

        <!-- QR label -->
        <text x="${ID_W / 2}" y="${ID_H - 335}" font-family="Arial,sans-serif" font-size="18" fill="#9ca3af" text-anchor="middle">Scan to join!</text>

        <!-- Footer — taller -->
        <rect y="${ID_H - 90}" width="${ID_W}" height="90" fill="url(#fg)"/>
        <rect x="0" y="${ID_H - 32}" width="${ID_W}" height="32" rx="32" fill="url(#fg)"/>

        <text x="${ID_W / 2}" y="${ID_H - 48}" font-family="Arial,sans-serif" font-size="22" fill="white" text-anchor="middle" font-weight="600">Join us &amp; earn loyalty points on every purchase!</text>
        <text x="${ID_W / 2}" y="${ID_H - 18}" font-family="Arial,sans-serif" font-size="16" fill="white" text-anchor="middle" opacity="0.8">Quality Colours — Your Trusted Paint Partner</text>
    </svg>`;

    const base = await sharp(Buffer.from(svg)).png().toBuffer();
    const pLeft = (ID_W - pSz) / 2, pTop = 205;
    const comp = [
        { input: ring, top: pTop - 8, left: pLeft - 8 },
        { input: circ, top: pTop, left: pLeft },
        { input: qr, top: ID_H - 320, left: (ID_W - 180) / 2 },
    ];
    if (logo) comp.push({ input: logo, top: 12, left: 20 });

    const dir = path.join(__dirname, '..', 'public', 'uploads', 'painter-cards');
    ensureDir(dir);
    await sharp(base).composite(comp).png({ quality: 90 }).toFile(path.join(dir, `painter_id_${id}.png`));
    return `/uploads/painter-cards/painter_id_${id}.png?v=${Date.now()}`;
}

module.exports = { generateCard, generateIdCard };
