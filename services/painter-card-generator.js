/**
 * Painter Card Generator — Premium Design v6
 * Visiting card (1400x800) — bigger logo with backdrop, improved text styling
 * ID card (800x1200) — portrait badge, bigger logo with backdrop
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
const DARK = '#0d2818';
const ORIGIN = process.env.APP_ORIGIN || 'https://act.qcpaintshop.com';

const esc = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function specLabel(s) {
    return (s || 'both').replace('both', 'Interior & Exterior').replace('interior', 'Interior').replace('exterior', 'Exterior').replace('industrial', 'Industrial') + ' Specialist';
}

// SVG icon paths (Material Design, 24x24 viewBox)
function phoneIcon(x, y, sz, color) {
    const s = sz / 24;
    return `<g transform="translate(${x},${y}) scale(${s})"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" fill="${color}"/></g>`;
}

function locationIcon(x, y, sz, color) {
    const s = sz / 24;
    return `<g transform="translate(${x},${y}) scale(${s})"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="${color}"/></g>`;
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
// VISITING CARD — 1400x800 Professional
// ══════════════════════════════════════════

async function generateCard(painter, pool) {
    const { id, full_name, phone, city, specialization, experience_years, referral_code, profile_photo } = painter;

    const url = `${ORIGIN}/painter-register.html?ref=${referral_code}`;
    const qr = await QRCode.toBuffer(url, { width: 180, margin: 1, color: { dark: G, light: '#FFF' } });

    const pSz = 280;
    const logoSz = 250;
    const [{ circ, ring }, logo] = await Promise.all([
        loadPhoto(profile_photo, full_name, pSz),
        pool ? loadLogo(pool, logoSz) : Promise.resolve(null)
    ]);

    const spec = specLabel(specialization);
    const exp = experience_years ? `${experience_years} years experience` : '';
    const e = esc;

    // Text centered in left portion (before photo area)
    const cx = 530;
    const phoneY = exp ? 478 : 450;
    const cityY = exp ? 540 : 510;

    const svg = `
    <svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="hg" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:${DARK}"/><stop offset="100%" style="stop-color:${G}"/>
            </linearGradient>
            <linearGradient id="fg" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:${G}"/><stop offset="100%" style="stop-color:${GOLD}"/>
            </linearGradient>
            <linearGradient id="gg" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:${GOLD}"/><stop offset="100%" style="stop-color:#b8860b"/>
            </linearGradient>
        </defs>

        <!-- Background -->
        <rect width="${CARD_W}" height="${CARD_H}" rx="28" fill="white"/>

        <!-- Subtle pattern overlay -->
        <rect x="33" y="0" width="${CARD_W - 33}" height="${CARD_H}" rx="0" fill="#fafbfc" opacity="0.5"/>

        <!-- Gold double border -->
        <rect x="5" y="5" width="${CARD_W - 10}" height="${CARD_H - 10}" rx="25" fill="none" stroke="${GOLD}" stroke-width="1" opacity="0.2"/>
        <rect x="10" y="10" width="${CARD_W - 20}" height="${CARD_H - 20}" rx="22" fill="none" stroke="${GOLD}" stroke-width="0.5" opacity="0.15"/>

        <!-- Decorative circles behind photo -->
        <circle cx="${CARD_W - 190}" cy="340" r="240" fill="${G}" opacity="0.03"/>
        <circle cx="${CARD_W - 190}" cy="340" r="180" fill="${GOLD}" opacity="0.04"/>

        <!-- GREEN LEFT STRIP + gold edge -->
        <rect width="26" height="${CARD_H}" rx="28" fill="${G}"/>
        <rect x="22" width="8" height="${CARD_H}" fill="${G}"/>
        <rect x="28" width="5" height="${CARD_H}" fill="url(#gg)"/>

        <!-- Header bar -->
        <rect x="33" width="${CARD_W - 33}" height="180" fill="url(#hg)"/>

        <!-- Logo backdrop — white circle glow for visibility -->
        ${logo ? `<circle cx="155" cy="90" r="140" fill="white" opacity="0.12"/>` : ''}

        <!-- Company text -->
        <text x="${logo ? 300 : 60}" y="78" font-family="Arial,sans-serif" font-size="48" font-weight="bold" fill="white" letter-spacing="2">QUALITY COLOURS</text>
        <text x="${logo ? 300 : 60}" y="118" font-family="Arial,sans-serif" font-size="24" fill="${GOLD}" opacity="0.9" letter-spacing="1">The Branded Paint Showroom</text>
        <text x="${logo ? 300 : 60}" y="155" font-family="Arial,sans-serif" font-size="20" fill="white" opacity="0.6" letter-spacing="4">QC PAINTERS PROGRAM</text>

        <!-- Gold accent line -->
        <rect x="33" y="178" width="${CARD_W - 33}" height="5" fill="url(#gg)"/>

        <!-- NAME — CENTERED with shadow -->
        <text x="${cx + 2}" y="282" font-family="Arial,sans-serif" font-size="72" font-weight="bold" fill="${G}" text-anchor="middle" opacity="0.08" letter-spacing="2">${e(full_name)}</text>
        <text x="${cx}" y="280" font-family="Arial,sans-serif" font-size="72" font-weight="bold" fill="#111827" text-anchor="middle" letter-spacing="2">${e(full_name)}</text>

        <!-- Gold underline with diamond ends -->
        <rect x="${cx - 220}" y="296" width="440" height="4" rx="2" fill="url(#gg)"/>
        <rect x="${cx - 4}" y="292" width="8" height="12" rx="2" fill="${GOLD}" transform="rotate(45, ${cx}, 298)"/>

        <!-- Spec -->
        <text x="${cx}" y="348" font-family="Arial,sans-serif" font-size="32" fill="${G}" text-anchor="middle" font-weight="600">${e(spec)}</text>
        ${exp ? `<text x="${cx}" y="388" font-family="Arial,sans-serif" font-size="24" fill="#9ca3af" text-anchor="middle">${e(exp)}</text>` : ''}

        <!-- Phone with SVG icon — larger pill -->
        <rect x="${cx - 230}" y="${phoneY - 34}" width="460" height="54" rx="27" fill="${G}" opacity="0.06"/>
        ${phoneIcon(cx - 210, phoneY - 32, 36, G)}
        <text x="${cx + 10}" y="${phoneY + 2}" font-family="Arial,sans-serif" font-size="46" font-weight="700" fill="#1f2937" text-anchor="middle" letter-spacing="1">${e(phone)}</text>

        <!-- City with SVG icon -->
        ${city ? `
            ${locationIcon(cx - 130, cityY - 24, 28, GOLD)}
            <text x="${cx + 10}" y="${cityY}" font-family="Arial,sans-serif" font-size="30" fill="#4b5563" text-anchor="middle">${e(city)}</text>
        ` : ''}

        <!-- QR section -->
        <rect x="${CARD_W - 250}" y="${CARD_H - 320}" width="230" height="230" rx="16" fill="white" stroke="${G}" stroke-width="1" opacity="0.3"/>
        <text x="${CARD_W - 135}" y="${CARD_H - 132}" font-family="Arial,sans-serif" font-size="16" fill="#9ca3af" text-anchor="middle" letter-spacing="1">SCAN TO JOIN</text>

        <!-- Footer -->
        <rect y="${CARD_H - 75}" width="${CARD_W}" height="75" fill="url(#fg)"/>
        <rect x="0" y="${CARD_H - 28}" width="${CARD_W}" height="28" rx="28" fill="url(#fg)"/>

        <text x="60" y="${CARD_H - 30}" font-family="Arial,sans-serif" font-size="22" fill="white" font-weight="700" letter-spacing="1">QC PAINTERS</text>
        <text x="${CARD_W / 2}" y="${CARD_H - 30}" font-family="Arial,sans-serif" font-size="28" font-weight="bold" fill="${GOLD}" text-anchor="middle" letter-spacing="5">${e(referral_code)}</text>
        <text x="${CARD_W - 60}" y="${CARD_H - 30}" font-family="Arial,sans-serif" font-size="20" fill="white" text-anchor="end" opacity="0.85">Your Paint Partner</text>
    </svg>`;

    const base = await sharp(Buffer.from(svg)).png().toBuffer();
    const pTop = 200, pLeft = CARD_W - pSz - 65;
    const comp = [
        { input: ring, top: pTop - 8, left: pLeft - 8 },
        { input: circ, top: pTop, left: pLeft },
        { input: qr, top: CARD_H - 310, left: CARD_W - 225 },
    ];
    if (logo) comp.push({ input: logo, top: -35, left: 33 });

    const dir = path.join(__dirname, '..', 'public', 'uploads', 'painter-cards');
    ensureDir(dir);
    await sharp(base).composite(comp).png({ quality: 95 }).toFile(path.join(dir, `painter_${id}.png`));
    return `/uploads/painter-cards/painter_${id}.png?v=${Date.now()}`;
}

// ══════════════════════════════════════════
// ID CARD — 800x1200 Premium Badge
// ══════════════════════════════════════════

async function generateIdCard(painter, pool) {
    const { id, full_name, phone, city, specialization, experience_years, referral_code, profile_photo } = painter;

    const url = `${ORIGIN}/painter-register.html?ref=${referral_code}`;
    const qr = await QRCode.toBuffer(url, { width: 180, margin: 1, color: { dark: G, light: '#FFF' } });

    const pSz = 260;
    const logoSz = 180;
    const [{ circ, ring }, logo] = await Promise.all([
        loadPhoto(profile_photo, full_name, pSz, GOLD),
        pool ? loadLogo(pool, logoSz) : Promise.resolve(null)
    ]);

    const spec = specLabel(specialization);
    const info = [city, experience_years ? `${experience_years} yrs` : ''].filter(Boolean).join('  |  ');
    const e = esc;

    const nameY = 520;
    const specY = 578;
    const phoneY = info ? 660 : 630;
    const divY = phoneY + 35;
    const labelY = divY + 40;
    const boxY = labelY + 18;
    const codeY = boxY + 50;

    const svg = `
    <svg width="${ID_W}" height="${ID_H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="hg" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:${DARK}"/><stop offset="100%" style="stop-color:${G}"/>
            </linearGradient>
            <linearGradient id="fg" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:${G}"/><stop offset="100%" style="stop-color:${GOLD}"/>
            </linearGradient>
            <linearGradient id="gg" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:${GOLD}"/><stop offset="100%" style="stop-color:#b8860b"/>
            </linearGradient>
        </defs>

        <!-- Background -->
        <rect width="${ID_W}" height="${ID_H}" rx="32" fill="white"/>

        <!-- Gold double border -->
        <rect x="6" y="6" width="${ID_W - 12}" height="${ID_H - 12}" rx="29" fill="none" stroke="${GOLD}" stroke-width="2" opacity="0.3"/>
        <rect x="12" y="12" width="${ID_W - 24}" height="${ID_H - 24}" rx="26" fill="none" stroke="${GOLD}" stroke-width="0.5" opacity="0.15"/>

        <!-- Green header -->
        <rect width="${ID_W}" height="185" rx="32" fill="url(#hg)"/>
        <rect y="32" width="${ID_W}" height="153" fill="url(#hg)"/>

        <!-- Logo backdrop — white circle glow -->
        ${logo ? `<circle cx="100" cy="95" r="100" fill="white" opacity="0.12"/>` : ''}

        <!-- Gold accent -->
        <rect y="183" width="${ID_W}" height="5" fill="url(#gg)"/>

        <!-- Header text -->
        <text x="${logo ? 480 : ID_W / 2}" y="65" font-family="Arial,sans-serif" font-size="46" font-weight="bold" fill="white" text-anchor="middle" letter-spacing="2">QUALITY COLOURS</text>
        <text x="${logo ? 480 : ID_W / 2}" y="105" font-family="Arial,sans-serif" font-size="22" fill="${GOLD}" text-anchor="middle" letter-spacing="1">QC Painters Program</text>
        <text x="${logo ? 480 : ID_W / 2}" y="152" font-family="Arial,sans-serif" font-size="22" fill="white" text-anchor="middle" opacity="0.7" letter-spacing="4">PAINTER IDENTITY CARD</text>

        <!-- Name with shadow -->
        <text x="${ID_W / 2 + 2}" y="${nameY + 2}" font-family="Arial,sans-serif" font-size="62" font-weight="bold" fill="${G}" text-anchor="middle" opacity="0.08" letter-spacing="1.5">${e(full_name)}</text>
        <text x="${ID_W / 2}" y="${nameY}" font-family="Arial,sans-serif" font-size="62" font-weight="bold" fill="#111827" text-anchor="middle" letter-spacing="1.5">${e(full_name)}</text>

        <!-- Gold underline — wider -->
        <rect x="${(ID_W - 380) / 2}" y="${nameY + 14}" width="380" height="4" rx="2" fill="url(#gg)"/>

        <!-- Spec -->
        <text x="${ID_W / 2}" y="${specY}" font-family="Arial,sans-serif" font-size="30" fill="${G}" text-anchor="middle" font-weight="600">${e(spec)}</text>
        ${info ? `<text x="${ID_W / 2}" y="${specY + 42}" font-family="Arial,sans-serif" font-size="24" fill="#9ca3af" text-anchor="middle">${e(info)}</text>` : ''}

        <!-- Phone with SVG icon in pill -->
        <rect x="${(ID_W - 340) / 2}" y="${phoneY - 30}" width="340" height="46" rx="23" fill="${G}" opacity="0.07"/>
        ${phoneIcon((ID_W - 300) / 2, phoneY - 28, 28, G)}
        <text x="${ID_W / 2 + 14}" y="${phoneY}" font-family="Arial,sans-serif" font-size="38" font-weight="700" fill="#1f2937" text-anchor="middle">${e(phone)}</text>

        <!-- Gold divider -->
        <rect x="60" y="${divY}" width="${ID_W - 120}" height="3" fill="url(#gg)" rx="1.5"/>

        <!-- Referral label -->
        <text x="${ID_W / 2}" y="${labelY}" font-family="Arial,sans-serif" font-size="20" fill="#9ca3af" text-anchor="middle" letter-spacing="4">REFERRAL CODE</text>

        <!-- Code box — thicker gold border -->
        <rect x="120" y="${boxY}" width="${ID_W - 240}" height="72" rx="18" fill="#f0fdf4" stroke="${GOLD}" stroke-width="3"/>
        <text x="${ID_W / 2}" y="${codeY}" font-family="Arial,sans-serif" font-size="48" font-weight="bold" fill="${G}" text-anchor="middle" letter-spacing="6">${e(referral_code)}</text>

        <!-- QR section -->
        <text x="${ID_W / 2}" y="${ID_H - 335}" font-family="Arial,sans-serif" font-size="16" fill="#9ca3af" text-anchor="middle" letter-spacing="2">SCAN TO JOIN</text>

        <!-- Footer -->
        <rect y="${ID_H - 90}" width="${ID_W}" height="90" fill="url(#fg)"/>
        <rect x="0" y="${ID_H - 32}" width="${ID_W}" height="32" rx="32" fill="url(#fg)"/>

        <text x="${ID_W / 2}" y="${ID_H - 48}" font-family="Arial,sans-serif" font-size="20" fill="white" text-anchor="middle" font-weight="600" letter-spacing="0.5">Join us &amp; earn loyalty points on every purchase!</text>
        <text x="${ID_W / 2}" y="${ID_H - 18}" font-family="Arial,sans-serif" font-size="15" fill="${GOLD}" text-anchor="middle" opacity="0.9">Quality Colours — Your Trusted Paint Partner</text>
    </svg>`;

    const base = await sharp(Buffer.from(svg)).png().toBuffer();
    const pLeft = (ID_W - pSz) / 2, pTop = 210;
    const comp = [
        { input: ring, top: pTop - 8, left: pLeft - 8 },
        { input: circ, top: pTop, left: pLeft },
        { input: qr, top: ID_H - 320, left: (ID_W - 180) / 2 },
    ];
    if (logo) comp.push({ input: logo, top: 4, left: 10 });

    const dir = path.join(__dirname, '..', 'public', 'uploads', 'painter-cards');
    ensureDir(dir);
    await sharp(base).composite(comp).png({ quality: 95 }).toFile(path.join(dir, `painter_id_${id}.png`));
    return `/uploads/painter-cards/painter_id_${id}.png?v=${Date.now()}`;
}

module.exports = { generateCard, generateIdCard };
