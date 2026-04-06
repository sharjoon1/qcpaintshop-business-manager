/**
 * Painter Card Generator — Enterprise Design v7
 * Visiting card (1400x800) — Photo-first, modern corporate, level-colored accents
 * ID card (800x1200) — QR + referral code dominant, painter-to-painter sharing
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

// Level color config
const LEVEL_COLORS = {
    bronze:  { primary: '#CD7F32', secondary: '#A0522D', label: 'Bronze' },
    silver:  { primary: '#9CA3AF', secondary: '#D1D5DB', label: 'Silver' },
    gold:    { primary: '#D4A24E', secondary: '#b8860b', label: 'Gold' },
    diamond: { primary: '#3B82F6', secondary: '#1D4ED8', label: 'Diamond' },
};

function getLevelColor(level) {
    return LEVEL_COLORS[level] || LEVEL_COLORS.bronze;
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

function starIcon(x, y, sz, color) {
    const s = sz / 24;
    return `<g transform="translate(${x},${y}) scale(${s})"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="${color}"/></g>`;
}

function levelBadge(x, y, level) {
    const lc = getLevelColor(level);
    return `
        <rect x="${x}" y="${y}" width="130" height="32" rx="16" fill="${lc.primary}" opacity="0.12"/>
        ${starIcon(x + 8, y + 4, 24, lc.primary)}
        <text x="${x + 38}" y="${y + 22}" font-family="'Segoe UI',Arial,sans-serif" font-size="17" font-weight="700" fill="${lc.primary}">${lc.label}</text>
    `;
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
        buf = await sharp(Buffer.from(`<svg width="${sz}" height="${sz}"><circle cx="${h}" cy="${h}" r="${h}" fill="${GOLD}"/><text x="${h}" y="${h}" text-anchor="middle" dominant-baseline="central" font-family="'Segoe UI',Arial,sans-serif" font-size="${Math.round(sz * 0.42)}" font-weight="bold" fill="white">${ini}</text></svg>`)).png().toBuffer();
    }
    const mask = await sharp(Buffer.from(`<svg width="${sz}" height="${sz}"><circle cx="${h}" cy="${h}" r="${h - 2}" fill="white"/></svg>`)).png().toBuffer();
    const circ = await sharp(buf).resize(sz, sz).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    const ring = await sharp(Buffer.from(`<svg width="${rs}" height="${rs}"><circle cx="${rh}" cy="${rh}" r="${rh - 1}" fill="none" stroke="${ringColor}" stroke-width="6"/><circle cx="${rh}" cy="${rh}" r="${rh - 5}" fill="none" stroke="white" stroke-width="2"/></svg>`)).png().toBuffer();
    return { circ, ring, sz, rs };
}

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

// ══════════════════════════════════════════
// VISITING CARD — 1400x800 Enterprise v7
// Photo-first layout, modern corporate
// ══════════════════════════════════════════

async function generateCard(painter, pool) {
    const { id, full_name, phone, city, specialization, experience_years, referral_code, profile_photo, current_level } = painter;

    const url = `${ORIGIN}/painter-register.html?ref=${referral_code}`;
    const qr = await QRCode.toBuffer(url, { width: 160, margin: 1, color: { dark: G, light: '#FFFFFF' } });

    const pSz = 280;
    const logoSz = 70;
    const lc = getLevelColor(current_level);
    const [{ circ, ring }, logo] = await Promise.all([
        loadPhoto(profile_photo, full_name, pSz, lc.primary),
        pool ? loadLogo(pool, logoSz) : Promise.resolve(null)
    ]);

    const spec = specLabel(specialization);
    const exp = experience_years ? `${experience_years} years experience` : '';
    const e = esc;

    // Layout coordinates
    const headerH = 130;
    const photoX = 60;
    const photoY = headerH + 40;
    const textX = photoX + pSz + 60;
    const nameY = photoY + 60;
    const specY = nameY + 48;
    const expY = specY + 36;
    const phoneY = exp ? expY + 50 : specY + 56;
    const cityY = phoneY + 48;
    const qrX = CARD_W - 210;
    const qrY = headerH + 60;

    const svg = `
    <svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:${DARK}"/>
                <stop offset="60%" style="stop-color:${G}"/>
                <stop offset="100%" style="stop-color:#22734a"/>
            </linearGradient>
            <linearGradient id="footerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:${G}"/>
                <stop offset="100%" style="stop-color:${DARK}"/>
            </linearGradient>
            <linearGradient id="levelGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:${lc.primary}"/>
                <stop offset="100%" style="stop-color:${lc.secondary}"/>
            </linearGradient>
            <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:${GOLD}"/>
                <stop offset="100%" style="stop-color:#b8860b"/>
            </linearGradient>
            <filter id="softShadow" x="-4%" y="-4%" width="108%" height="108%">
                <feGaussianBlur in="SourceAlpha" stdDeviation="3"/>
                <feOffset dx="0" dy="2"/>
                <feComponentTransfer><feFuncA type="linear" slope="0.08"/></feComponentTransfer>
                <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
        </defs>

        <!-- Card background -->
        <rect width="${CARD_W}" height="${CARD_H}" rx="24" fill="#FFFFFF"/>

        <!-- Subtle texture pattern -->
        <rect x="0" y="${headerH + 4}" width="${CARD_W}" height="${CARD_H - headerH - 4}" rx="0" fill="#fafcfb"/>

        <!-- Level-colored border accent -->
        <rect x="3" y="3" width="${CARD_W - 6}" height="${CARD_H - 6}" rx="22" fill="none" stroke="${lc.primary}" stroke-width="1.5" opacity="0.2"/>
        <rect x="7" y="7" width="${CARD_W - 14}" height="${CARD_H - 14}" rx="20" fill="none" stroke="${lc.primary}" stroke-width="0.5" opacity="0.1"/>

        <!-- Header -->
        <rect width="${CARD_W}" height="${headerH}" rx="24" fill="url(#headerGrad)"/>
        <rect y="24" width="${CARD_W}" height="${headerH - 24}" fill="url(#headerGrad)"/>

        <!-- Header gold accent line -->
        <rect y="${headerH - 4}" width="${CARD_W}" height="4" fill="url(#goldGrad)"/>

        <!-- Logo backdrop glow -->
        ${logo ? `<circle cx="${52 + logoSz / 2}" cy="${headerH / 2}" r="${logoSz / 2 + 20}" fill="white" opacity="0.08"/>` : ''}

        <!-- Company name -->
        <text x="${logo ? 52 + logoSz + 20 : 50}" y="${headerH / 2 - 12}" font-family="'Segoe UI',Arial,sans-serif" font-size="40" font-weight="bold" fill="white" letter-spacing="3">QUALITY COLOURS</text>
        <text x="${logo ? 52 + logoSz + 20 : 50}" y="${headerH / 2 + 24}" font-family="'Segoe UI',Arial,sans-serif" font-size="20" fill="${GOLD}" letter-spacing="1">The Branded Paint Showroom</text>

        <!-- Decorative circles behind photo area -->
        <circle cx="${photoX + pSz / 2}" cy="${photoY + pSz / 2}" r="${pSz / 2 + 40}" fill="${lc.primary}" opacity="0.03"/>
        <circle cx="${photoX + pSz / 2}" cy="${photoY + pSz / 2}" r="${pSz / 2 + 20}" fill="${G}" opacity="0.02"/>

        <!-- Name -->
        <text x="${textX}" y="${nameY}" font-family="'Segoe UI',Arial,sans-serif" font-size="52" font-weight="bold" fill="#111827" letter-spacing="1" filter="url(#softShadow)">${e(full_name)}</text>

        <!-- Level-colored underline -->
        <rect x="${textX}" y="${nameY + 10}" width="320" height="3.5" rx="2" fill="url(#levelGrad)"/>
        <circle cx="${textX + 160}" cy="${nameY + 12}" r="4" fill="${lc.primary}"/>

        <!-- Level badge -->
        ${levelBadge(textX + 340, nameY - 28, current_level)}

        <!-- Specialization -->
        <text x="${textX}" y="${specY}" font-family="'Segoe UI',Arial,sans-serif" font-size="26" fill="${G}" font-weight="600">${e(spec)}</text>

        <!-- Experience -->
        ${exp ? `<text x="${textX}" y="${expY}" font-family="'Segoe UI',Arial,sans-serif" font-size="20" fill="#9ca3af">${e(exp)}</text>` : ''}

        <!-- Phone pill -->
        <rect x="${textX - 8}" y="${phoneY - 28}" width="360" height="44" rx="22" fill="${G}" opacity="0.05"/>
        ${phoneIcon(textX, phoneY - 26, 30, G)}
        <text x="${textX + 42}" y="${phoneY}" font-family="'Segoe UI',Arial,sans-serif" font-size="34" font-weight="700" fill="#1f2937" letter-spacing="1.5">${e(phone)}</text>

        <!-- City -->
        ${city ? `
            ${locationIcon(textX, cityY - 22, 26, lc.primary)}
            <text x="${textX + 34}" y="${cityY}" font-family="'Segoe UI',Arial,sans-serif" font-size="24" fill="#6b7280">${e(city)}</text>
        ` : ''}

        <!-- QR section -->
        <rect x="${qrX - 16}" y="${qrY - 12}" width="192" height="220" rx="14" fill="white" stroke="${G}" stroke-width="1" opacity="0.15"/>
        <text x="${qrX + 80}" y="${qrY + 198}" font-family="'Segoe UI',Arial,sans-serif" font-size="13" fill="#9ca3af" text-anchor="middle" letter-spacing="2">SCAN TO JOIN</text>

        <!-- Footer -->
        <rect y="${CARD_H - 56}" width="${CARD_W}" height="56" fill="url(#footerGrad)"/>
        <rect y="${CARD_H - 24}" width="${CARD_W}" height="24" rx="24" fill="url(#footerGrad)"/>

        <text x="45" y="${CARD_H - 25}" font-family="'Segoe UI',Arial,sans-serif" font-size="18" fill="white" font-weight="600" letter-spacing="2">QC PAINTERS PROGRAM</text>
        <text x="${CARD_W / 2}" y="${CARD_H - 22}" font-family="'Segoe UI',Arial,sans-serif" font-size="26" font-weight="bold" fill="${GOLD}" text-anchor="middle" letter-spacing="5">${e(referral_code)}</text>
        <text x="${CARD_W - 45}" y="${CARD_H - 25}" font-family="'Segoe UI',Arial,sans-serif" font-size="16" fill="white" text-anchor="end" opacity="0.75">Your Trusted Paint Partner</text>
    </svg>`;

    const base = await sharp(Buffer.from(svg)).png().toBuffer();
    const comp = [
        { input: ring, top: photoY - 8, left: photoX - 8 },
        { input: circ, top: photoY, left: photoX },
        { input: qr, top: qrY, left: qrX },
    ];
    if (logo) comp.push({ input: logo, top: Math.round(headerH / 2 - logoSz / 2), left: 52 });

    const dir = path.join(__dirname, '..', 'public', 'uploads', 'painter-cards');
    ensureDir(dir);
    await sharp(base).composite(comp).png({ quality: 95 }).toFile(path.join(dir, `painter_${id}.png`));
    return `/uploads/painter-cards/painter_${id}.png?v=${Date.now()}`;
}

// ══════════════════════════════════════════
// ID CARD — 800x1200 Enterprise v7
// QR + Referral code dominant, painter-to-painter
// ══════════════════════════════════════════

async function generateIdCard(painter, pool) {
    const { id, full_name, phone, city, specialization, referral_code, profile_photo, current_level } = painter;

    const url = `${ORIGIN}/painter-register.html?ref=${referral_code}`;
    const qr = await QRCode.toBuffer(url, { width: 220, margin: 1, color: { dark: G, light: '#FFFFFF' } });

    const pSz = 200;
    const logoSz = 60;
    const lc = getLevelColor(current_level);
    const [{ circ, ring }, logo] = await Promise.all([
        loadPhoto(profile_photo, full_name, pSz, lc.primary),
        pool ? loadLogo(pool, logoSz) : Promise.resolve(null)
    ]);

    const e = esc;
    const cx = ID_W / 2;

    // Layout coordinates
    const headerH = 140;
    const photoY = headerH + 30;
    const nameY = photoY + pSz + 50;
    const badgeY = nameY + 16;
    const phoneY = badgeY + 50;
    const dividerY = phoneY + 30;
    const scanLabelY = dividerY + 35;
    const qrY = scanLabelY + 10;
    const refLabelY = qrY + 240;
    const refBoxY = refLabelY + 10;
    const refCodeY = refBoxY + 48;
    const footerH = 70;

    const svg = `
    <svg width="${ID_W}" height="${ID_H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:${DARK}"/>
                <stop offset="60%" style="stop-color:${G}"/>
                <stop offset="100%" style="stop-color:#22734a"/>
            </linearGradient>
            <linearGradient id="footerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:${G}"/>
                <stop offset="100%" style="stop-color:${DARK}"/>
            </linearGradient>
            <linearGradient id="levelGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:${lc.primary}"/>
                <stop offset="100%" style="stop-color:${lc.secondary}"/>
            </linearGradient>
            <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:${GOLD}"/>
                <stop offset="100%" style="stop-color:#b8860b"/>
            </linearGradient>
            <filter id="softShadow" x="-4%" y="-4%" width="108%" height="108%">
                <feGaussianBlur in="SourceAlpha" stdDeviation="2"/>
                <feOffset dx="0" dy="1"/>
                <feComponentTransfer><feFuncA type="linear" slope="0.06"/></feComponentTransfer>
                <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
        </defs>

        <!-- Card background -->
        <rect width="${ID_W}" height="${ID_H}" rx="28" fill="#FFFFFF"/>

        <!-- Subtle body background -->
        <rect x="0" y="${headerH + 4}" width="${ID_W}" height="${ID_H - headerH - footerH - 4}" fill="#fafcfb"/>

        <!-- Level-colored border -->
        <rect x="4" y="4" width="${ID_W - 8}" height="${ID_H - 8}" rx="26" fill="none" stroke="${lc.primary}" stroke-width="1.5" opacity="0.2"/>
        <rect x="8" y="8" width="${ID_W - 16}" height="${ID_H - 16}" rx="24" fill="none" stroke="${lc.primary}" stroke-width="0.5" opacity="0.1"/>

        <!-- Header -->
        <rect width="${ID_W}" height="${headerH}" rx="28" fill="url(#headerGrad)"/>
        <rect y="28" width="${ID_W}" height="${headerH - 28}" fill="url(#headerGrad)"/>

        <!-- Header gold accent -->
        <rect y="${headerH - 4}" width="${ID_W}" height="4" fill="url(#goldGrad)"/>

        <!-- Logo backdrop -->
        ${logo ? `<circle cx="${50 + logoSz / 2}" cy="${headerH / 2}" r="${logoSz / 2 + 16}" fill="white" opacity="0.08"/>` : ''}

        <!-- Company name -->
        <text x="${logo ? 50 + logoSz + 16 : cx}" y="${headerH / 2 - 12}" font-family="'Segoe UI',Arial,sans-serif" font-size="36" font-weight="bold" fill="white" ${logo ? '' : 'text-anchor="middle"'} letter-spacing="2">QUALITY COLOURS</text>
        <text x="${logo ? 50 + logoSz + 16 : cx}" y="${headerH / 2 + 20}" font-family="'Segoe UI',Arial,sans-serif" font-size="18" fill="${GOLD}" ${logo ? '' : 'text-anchor="middle"'} letter-spacing="2">QC Painters Program</text>

        <!-- Decorative circles behind photo -->
        <circle cx="${cx}" cy="${photoY + pSz / 2}" r="${pSz / 2 + 30}" fill="${lc.primary}" opacity="0.03"/>

        <!-- Name -->
        <text x="${cx}" y="${nameY}" font-family="'Segoe UI',Arial,sans-serif" font-size="44" font-weight="bold" fill="#111827" text-anchor="middle" letter-spacing="1" filter="url(#softShadow)">${e(full_name)}</text>

        <!-- Level badge centered -->
        ${levelBadge(cx - 65, badgeY, current_level)}

        <!-- Phone -->
        <rect x="${cx - 150}" y="${phoneY - 24}" width="300" height="38" rx="19" fill="${G}" opacity="0.05"/>
        ${phoneIcon(cx - 130, phoneY - 22, 24, G)}
        <text x="${cx + 10}" y="${phoneY}" font-family="'Segoe UI',Arial,sans-serif" font-size="28" font-weight="700" fill="#1f2937" text-anchor="middle">${e(phone)}</text>

        <!-- Divider -->
        <rect x="80" y="${dividerY}" width="${ID_W - 160}" height="2" fill="url(#levelGrad)" rx="1"/>

        <!-- Scan label -->
        <text x="${cx}" y="${scanLabelY}" font-family="'Segoe UI',Arial,sans-serif" font-size="16" fill="#9ca3af" text-anchor="middle" letter-spacing="3">SCAN TO JOIN QC PAINTERS</text>

        <!-- QR background frame -->
        <rect x="${cx - 122}" y="${qrY - 10}" width="244" height="244" rx="16" fill="white" stroke="${G}" stroke-width="1" opacity="0.15"/>

        <!-- Referral label -->
        <text x="${cx}" y="${refLabelY}" font-family="'Segoe UI',Arial,sans-serif" font-size="16" fill="#9ca3af" text-anchor="middle" letter-spacing="4">REFERRAL CODE</text>

        <!-- Referral code box — level-colored border -->
        <rect x="100" y="${refBoxY}" width="${ID_W - 200}" height="68" rx="16" fill="#f0fdf4" stroke="${lc.primary}" stroke-width="2.5"/>
        <text x="${cx}" y="${refCodeY}" font-family="'Segoe UI',Arial,sans-serif" font-size="40" font-weight="bold" fill="${G}" text-anchor="middle" letter-spacing="6">${e(referral_code)}</text>

        <!-- Footer -->
        <rect y="${ID_H - footerH}" width="${ID_W}" height="${footerH}" fill="url(#footerGrad)"/>
        <rect y="${ID_H - 28}" width="${ID_W}" height="28" rx="28" fill="url(#footerGrad)"/>

        <text x="${cx}" y="${ID_H - footerH + 30}" font-family="'Segoe UI',Arial,sans-serif" font-size="18" fill="white" text-anchor="middle" font-weight="600">Join &amp; earn loyalty points on every purchase!</text>
        <text x="${cx}" y="${ID_H - 14}" font-family="'Segoe UI',Arial,sans-serif" font-size="14" fill="${GOLD}" text-anchor="middle" opacity="0.85">Quality Colours — Your Trusted Paint Partner</text>
    </svg>`;

    const base = await sharp(Buffer.from(svg)).png().toBuffer();
    const pLeft = Math.round(cx - pSz / 2);
    const comp = [
        { input: ring, top: photoY - 8, left: pLeft - 8 },
        { input: circ, top: photoY, left: pLeft },
        { input: qr, top: qrY, left: Math.round(cx - 110) },
    ];
    if (logo) comp.push({ input: logo, top: Math.round(headerH / 2 - logoSz / 2), left: 50 });

    const dir = path.join(__dirname, '..', 'public', 'uploads', 'painter-cards');
    ensureDir(dir);
    await sharp(base).composite(comp).png({ quality: 95 }).toFile(path.join(dir, `painter_id_${id}.png`));
    return `/uploads/painter-cards/painter_id_${id}.png?v=${Date.now()}`;
}

module.exports = { generateCard, generateIdCard };
