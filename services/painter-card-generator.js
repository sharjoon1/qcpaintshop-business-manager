/**
 * Painter Card Generator — Enterprise Design v8
 * Visiting card (1400x800) — Premium corporate, Asian Paints dealer quality
 * ID card (800x1200) — QR + referral dominant, painter-to-painter sharing
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
const FONT = "'Segoe UI',Arial,sans-serif";
const ORIGIN = process.env.APP_ORIGIN || 'https://act.qcpaintshop.com';

const esc = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function specLabel(s) {
    return (s || 'both').replace('both', 'Interior & Exterior').replace('interior', 'Interior').replace('exterior', 'Exterior').replace('industrial', 'Industrial') + ' Specialist';
}

const LEVEL_COLORS = {
    bronze:  { primary: '#CD7F32', secondary: '#A0522D', light: '#fdf4e8', label: 'Bronze' },
    silver:  { primary: '#9CA3AF', secondary: '#D1D5DB', light: '#f3f4f6', label: 'Silver' },
    gold:    { primary: '#D4A24E', secondary: '#b8860b', light: '#fef9ee', label: 'Gold' },
    diamond: { primary: '#3B82F6', secondary: '#1D4ED8', light: '#eff6ff', label: 'Diamond' },
};

function getLevelColor(level) {
    return LEVEL_COLORS[level] || LEVEL_COLORS.bronze;
}

// ── SVG Icon Paths (Material Design, 24x24 viewBox) ──

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

function paintBrushIcon(x, y, sz, color, opacity = 0.04) {
    const s = sz / 24;
    return `<g transform="translate(${x},${y}) scale(${s})" opacity="${opacity}"><path d="M7 14c-1.66 0-3 1.34-3 3 0 1.31-1.16 2-2 2 .92 1.22 2.49 2 4 2 2.21 0 4-1.79 4-4 0-1.66-1.34-3-3-3zm13.71-9.37l-1.34-1.34a.996.996 0 00-1.41 0L9 12.25 11.75 15l8.96-8.96a.996.996 0 000-1.41z" fill="${color}"/></g>`;
}

// ── Shared SVG Definitions ──

function sharedDefs(lc) {
    return `
        <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0a2a1a"/>
            <stop offset="35%" stop-color="${DARK}"/>
            <stop offset="70%" stop-color="${G}"/>
            <stop offset="100%" stop-color="#1a6b42"/>
        </linearGradient>
        <linearGradient id="footerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="${G}"/>
            <stop offset="50%" stop-color="${DARK}"/>
            <stop offset="100%" stop-color="#0a2a1a"/>
        </linearGradient>
        <linearGradient id="levelGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="${lc.primary}"/>
            <stop offset="100%" stop-color="${lc.secondary}"/>
        </linearGradient>
        <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#c49332"/>
            <stop offset="30%" stop-color="${GOLD}"/>
            <stop offset="70%" stop-color="#e6bc6a"/>
            <stop offset="100%" stop-color="${GOLD}"/>
        </linearGradient>
        <linearGradient id="goldTextGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${GOLD}"/>
            <stop offset="50%" stop-color="#e6bc6a"/>
            <stop offset="100%" stop-color="#b8860b"/>
        </linearGradient>
        <filter id="cardShadow" x="-2%" y="-2%" width="104%" height="104%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="4"/>
            <feOffset dx="0" dy="2"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.12"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="textShadow" x="-5%" y="-5%" width="110%" height="110%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.5"/>
            <feOffset dx="0" dy="1"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.15"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="logoGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="12"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.18"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>`;
}

function levelBadgePill(x, y, level, w = 140, h = 34) {
    const lc = getLevelColor(level);
    return `
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${lc.primary}" opacity="0.10"/>
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="none" stroke="${lc.primary}" stroke-width="1.5" opacity="0.3"/>
        ${starIcon(x + 10, y + (h - 22) / 2, 22, lc.primary)}
        <text x="${x + 38}" y="${y + h / 2 + 6}" font-family="${FONT}" font-size="16" font-weight="700" fill="${lc.primary}" letter-spacing="1">${lc.label}</text>
    `;
}

// ── Asset Loaders ──

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
    const h = sz / 2;
    const ringW = 8;
    const innerRingW = 3;
    const rs = sz + (ringW + innerRingW) * 2;
    const rh = rs / 2;
    let buf;
    try {
        const pp = photo ? path.join(__dirname, '..', 'public', photo.split('?')[0]) : null;
        if (pp && fs.existsSync(pp)) buf = await sharp(pp).resize(sz, sz, { fit: 'cover' }).png().toBuffer();
    } catch (e) {}
    if (!buf) {
        const ini = (name || 'P').charAt(0).toUpperCase();
        buf = await sharp(Buffer.from(`<svg width="${sz}" height="${sz}"><circle cx="${h}" cy="${h}" r="${h}" fill="${GOLD}"/><text x="${h}" y="${h}" text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-size="${Math.round(sz * 0.40)}" font-weight="bold" fill="white">${ini}</text></svg>`)).png().toBuffer();
    }
    const mask = await sharp(Buffer.from(`<svg width="${sz}" height="${sz}"><circle cx="${h}" cy="${h}" r="${h - 1}" fill="white"/></svg>`)).png().toBuffer();
    const circ = await sharp(buf).resize(sz, sz).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    // Level-colored outer ring + white inner ring
    const ring = await sharp(Buffer.from(`<svg width="${rs}" height="${rs}">
        <circle cx="${rh}" cy="${rh}" r="${rh - 2}" fill="none" stroke="${ringColor}" stroke-width="${ringW}"/>
        <circle cx="${rh}" cy="${rh}" r="${rh - ringW - 1}" fill="none" stroke="white" stroke-width="${innerRingW}"/>
    </svg>`)).png().toBuffer();
    return { circ, ring, sz, rs };
}

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

// ══════════════════════════════════════════════════════
// VISITING CARD — 1400x800 Enterprise v8
// Premium corporate layout, print-shop quality
// ══════════════════════════════════════════════════════

async function generateCard(painter, pool) {
    const { id, full_name, phone, city, specialization, experience_years, referral_code, profile_photo, current_level } = painter;

    const url = `${ORIGIN}/painter-register.html?ref=${referral_code}`;
    const qr = await QRCode.toBuffer(url, { width: 150, margin: 1, color: { dark: G, light: '#FFFFFF' } });

    const pSz = 260;
    const logoSz = 90;
    const lc = getLevelColor(current_level);
    const [{ circ, ring, rs: ringSize }, logo] = await Promise.all([
        loadPhoto(profile_photo, full_name, pSz, lc.primary),
        pool ? loadLogo(pool, logoSz) : Promise.resolve(null)
    ]);

    const spec = specLabel(specialization);
    const exp = experience_years ? `${experience_years} years experience` : '';
    const e = esc;

    // ── Layout geometry ──
    const headerH = 160;
    const footerH = 60;
    const bodyTop = headerH;
    const bodyH = CARD_H - headerH - footerH;
    const bodyCenterY = bodyTop + bodyH / 2;

    // Photo: centered vertically in body, on the left
    const photoAreaX = 70;
    const photoCY = bodyCenterY;
    const photoTop = Math.round(photoCY - pSz / 2);
    const ringTop = Math.round(photoCY - ringSize / 2);
    const ringLeft = Math.round(photoAreaX - (ringSize - pSz) / 2);

    // Right content block starts after photo
    const textX = photoAreaX + pSz + 70;
    const textMaxW = CARD_W - textX - 210; // leave room for QR

    // Vertical distribution of text elements in body
    const nameY = bodyCenterY - 95;
    const underlineY = nameY + 12;
    const specY = underlineY + 36;
    const expY = specY + 34;
    const phoneY = exp ? expY + 48 : specY + 52;
    const cityY = phoneY + 46;

    // QR section on right edge
    const qrSize = 150;
    const qrBoxW = qrSize + 30;
    const qrBoxH = qrSize + 52;
    const qrX = CARD_W - qrBoxW - 45;
    const qrImgX = qrX + 15;
    const qrImgY = bodyCenterY - qrSize / 2 - 10;
    const qrBoxY = qrImgY - 14;
    const qrLabelY = qrImgY + qrSize + 22;

    const svg = `
    <svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            ${sharedDefs(lc)}
        </defs>

        <!-- ═══ CARD BASE ═══ -->
        <rect width="${CARD_W}" height="${CARD_H}" rx="20" fill="#FFFFFF"/>

        <!-- Body off-white fill -->
        <rect x="0" y="${headerH}" width="${CARD_W}" height="${bodyH}" fill="#fafcfb"/>

        <!-- Outer level-colored border -->
        <rect x="2" y="2" width="${CARD_W - 4}" height="${CARD_H - 4}" rx="19" fill="none" stroke="${lc.primary}" stroke-width="2" opacity="0.18"/>

        <!-- ═══ HEADER (160px) ═══ -->
        <rect width="${CARD_W}" height="${headerH}" rx="20" fill="url(#headerGrad)"/>
        <rect y="20" width="${CARD_W}" height="${headerH - 20}" fill="url(#headerGrad)"/>

        <!-- Subtle header pattern — diagonal lines -->
        <line x1="0" y1="${headerH}" x2="${headerH}" y2="0" stroke="white" stroke-width="0.3" opacity="0.04"/>
        <line x1="100" y1="${headerH}" x2="${headerH + 100}" y2="0" stroke="white" stroke-width="0.3" opacity="0.04"/>
        <line x1="200" y1="${headerH}" x2="${headerH + 200}" y2="0" stroke="white" stroke-width="0.3" opacity="0.03"/>

        <!-- Logo white glow background -->
        ${logo ? `<circle cx="${55 + logoSz / 2}" cy="${headerH / 2}" r="${logoSz / 2 + 24}" fill="white" opacity="0.10" filter="url(#logoGlow)"/>` : ''}

        <!-- Company name block -->
        <text x="${logo ? 55 + logoSz + 28 : 55}" y="${headerH / 2 - 14}" font-family="${FONT}" font-size="44" font-weight="bold" fill="white" letter-spacing="5" filter="url(#textShadow)">QUALITY COLOURS</text>
        <text x="${logo ? 55 + logoSz + 28 : 55}" y="${headerH / 2 + 22}" font-family="${FONT}" font-size="18" fill="url(#goldTextGrad)" letter-spacing="2" font-style="italic">The Branded Paint Showroom</text>

        <!-- Gold accent line at header bottom -->
        <rect y="${headerH - 3}" width="${CARD_W}" height="3" fill="url(#goldGrad)"/>

        <!-- ═══ BODY ═══ -->

        <!-- Decorative circles behind photo area -->
        <circle cx="${photoAreaX + pSz / 2}" cy="${photoCY}" r="${pSz / 2 + 50}" fill="${lc.primary}" opacity="0.025"/>
        <circle cx="${photoAreaX + pSz / 2}" cy="${photoCY}" r="${pSz / 2 + 30}" fill="${G}" opacity="0.02"/>
        <circle cx="${photoAreaX + pSz / 2 + 20}" cy="${photoCY - 20}" r="${pSz / 2 + 70}" fill="${G}" opacity="0.015"/>

        <!-- Decorative paint brush watermarks -->
        ${paintBrushIcon(CARD_W - 300, bodyTop + 20, 120, G, 0.02)}
        ${paintBrushIcon(textX + 80, bodyTop + bodyH - 100, 80, lc.primary, 0.015)}

        <!-- Painter name -->
        <text x="${textX}" y="${nameY}" font-family="${FONT}" font-size="48" font-weight="bold" fill="#111827" letter-spacing="0.5">${e(full_name)}</text>

        <!-- Level-colored underline under name -->
        <rect x="${textX}" y="${underlineY}" width="250" height="3" rx="1.5" fill="url(#levelGrad)"/>

        <!-- Level badge pill to the right -->
        ${levelBadgePill(textX + 270, underlineY - 28, current_level)}

        <!-- Specialization -->
        <text x="${textX}" y="${specY}" font-family="${FONT}" font-size="24" fill="${G}" font-weight="600">${e(spec)}</text>

        <!-- Experience (conditional) -->
        ${exp ? `<text x="${textX}" y="${expY}" font-family="${FONT}" font-size="18" fill="#9ca3af" letter-spacing="0.5">${e(exp)}</text>` : ''}

        <!-- Phone in subtle pill -->
        <rect x="${textX - 12}" y="${phoneY - 30}" width="340" height="46" rx="23" fill="${G}" opacity="0.05"/>
        <rect x="${textX - 12}" y="${phoneY - 30}" width="340" height="46" rx="23" fill="none" stroke="${G}" stroke-width="0.5" opacity="0.08"/>
        ${phoneIcon(textX + 2, phoneY - 27, 28, G)}
        <text x="${textX + 40}" y="${phoneY}" font-family="${FONT}" font-size="32" font-weight="700" fill="#1f2937" letter-spacing="1.5">${e(phone)}</text>

        <!-- City -->
        ${city ? `
            ${locationIcon(textX, cityY - 20, 24, lc.primary)}
            <text x="${textX + 30}" y="${cityY}" font-family="${FONT}" font-size="22" fill="#6b7280" letter-spacing="0.3">${e(city)}</text>
        ` : ''}

        <!-- ═══ QR SECTION ═══ -->
        <rect x="${qrX}" y="${qrBoxY}" width="${qrBoxW}" height="${qrBoxH}" rx="12" fill="white" stroke="${G}" stroke-width="1.5" opacity="1"/>
        <rect x="${qrX + 1}" y="${qrBoxY + 1}" width="${qrBoxW - 2}" height="${qrBoxH - 2}" rx="11" fill="white"/>
        <text x="${qrImgX + qrSize / 2}" y="${qrLabelY}" font-family="${FONT}" font-size="11" fill="#9ca3af" text-anchor="middle" letter-spacing="2.5" font-weight="600">SCAN TO JOIN</text>

        <!-- ═══ FOOTER (60px) ═══ -->
        <rect y="${CARD_H - footerH}" width="${CARD_W}" height="${footerH}" fill="url(#footerGrad)"/>
        <rect y="${CARD_H - 20}" width="${CARD_W}" height="20" rx="20" fill="url(#footerGrad)"/>

        <!-- Footer left: Program name -->
        <text x="50" y="${CARD_H - footerH / 2 + 6}" font-family="${FONT}" font-size="15" fill="white" font-weight="600" letter-spacing="3" opacity="0.85">QC PAINTERS PROGRAM</text>

        <!-- Footer center: Referral code in gold -->
        <text x="${CARD_W / 2}" y="${CARD_H - footerH / 2 + 7}" font-family="${FONT}" font-size="24" font-weight="bold" fill="url(#goldTextGrad)" text-anchor="middle" letter-spacing="6">${e(referral_code)}</text>

        <!-- Footer right: Tagline -->
        <text x="${CARD_W - 50}" y="${CARD_H - footerH / 2 + 5}" font-family="${FONT}" font-size="14" fill="white" text-anchor="end" opacity="0.65" letter-spacing="0.5">Your Trusted Paint Partner</text>
    </svg>`;

    const base = await sharp(Buffer.from(svg)).png().toBuffer();

    const ringOff = Math.round((ringSize - pSz) / 2);
    const comp = [
        { input: ring, top: ringTop, left: ringLeft },
        { input: circ, top: photoTop, left: photoAreaX },
        { input: qr, top: qrImgY, left: qrImgX },
    ];
    if (logo) comp.push({ input: logo, top: Math.round(headerH / 2 - logoSz / 2), left: 55 });

    const dir = path.join(__dirname, '..', 'public', 'uploads', 'painter-cards');
    ensureDir(dir);
    await sharp(base).composite(comp).png({ quality: 95 }).toFile(path.join(dir, `painter_${id}.png`));
    return `/uploads/painter-cards/painter_${id}.png?v=${Date.now()}`;
}

// ══════════════════════════════════════════════════════
// ID CARD — 800x1200 Enterprise v8
// QR + Referral code dominant, painter-to-painter sharing
// ══════════════════════════════════════════════════════

async function generateIdCard(painter, pool) {
    const { id, full_name, phone, city, specialization, referral_code, profile_photo, current_level } = painter;

    const url = `${ORIGIN}/painter-register.html?ref=${referral_code}`;
    const qr = await QRCode.toBuffer(url, { width: 200, margin: 1, color: { dark: G, light: '#FFFFFF' } });

    const pSz = 200;
    const logoSz = 60;
    const lc = getLevelColor(current_level);
    const [{ circ, ring, rs: ringSize }, logo] = await Promise.all([
        loadPhoto(profile_photo, full_name, pSz, lc.primary),
        pool ? loadLogo(pool, logoSz) : Promise.resolve(null)
    ]);

    const e = esc;
    const cx = ID_W / 2;

    // ── Layout geometry ──
    const headerH = 150;
    const footerH = 70;

    // Photo section
    const photoTop = headerH + 35;
    const photoLeft = Math.round(cx - pSz / 2);
    const ringTop = Math.round(photoTop - (ringSize - pSz) / 2);
    const ringLeft = Math.round(photoLeft - (ringSize - pSz) / 2);

    // Text block below photo
    const nameY = photoTop + pSz + 55;
    const badgeY = nameY + 14;
    const specY = badgeY + 44;
    const phoneY = specY + 52;

    // Gold divider
    const dividerY = phoneY + 32;

    // QR section
    const qrSize = 200;
    const scanLabelY = dividerY + 32;
    const qrImgY = scanLabelY + 14;
    const qrImgX = Math.round(cx - qrSize / 2);
    const qrBoxX = qrImgX - 16;
    const qrBoxY = qrImgY - 12;
    const qrBoxW = qrSize + 32;
    const qrBoxH = qrSize + 24;
    const qrBottomLabelY = qrImgY + qrSize + 26;

    // Referral section
    const refLabelY = qrBottomLabelY + 30;
    const refBoxY = refLabelY + 12;
    const refBoxH = 64;
    const refCodeY = refBoxY + 42;

    const svg = `
    <svg width="${ID_W}" height="${ID_H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            ${sharedDefs(lc)}
        </defs>

        <!-- ═══ CARD BASE ═══ -->
        <rect width="${ID_W}" height="${ID_H}" rx="24" fill="#FFFFFF"/>

        <!-- Body off-white -->
        <rect x="0" y="${headerH}" width="${ID_W}" height="${ID_H - headerH - footerH}" fill="#fafcfb"/>

        <!-- Level-colored border -->
        <rect x="2" y="2" width="${ID_W - 4}" height="${ID_H - 4}" rx="23" fill="none" stroke="${lc.primary}" stroke-width="2" opacity="0.18"/>

        <!-- ═══ HEADER (150px) ═══ -->
        <rect width="${ID_W}" height="${headerH}" rx="24" fill="url(#headerGrad)"/>
        <rect y="24" width="${ID_W}" height="${headerH - 24}" fill="url(#headerGrad)"/>

        <!-- Subtle header lines -->
        <line x1="0" y1="${headerH}" x2="${headerH}" y2="0" stroke="white" stroke-width="0.3" opacity="0.04"/>
        <line x1="80" y1="${headerH}" x2="${headerH + 80}" y2="0" stroke="white" stroke-width="0.3" opacity="0.03"/>

        <!-- Logo glow -->
        ${logo ? `<circle cx="${48 + logoSz / 2}" cy="${headerH / 2}" r="${logoSz / 2 + 20}" fill="white" opacity="0.10" filter="url(#logoGlow)"/>` : ''}

        <!-- Company name -->
        <text x="${logo ? 48 + logoSz + 20 : cx}" y="${headerH / 2 - 14}" font-family="${FONT}" font-size="36" font-weight="bold" fill="white" ${logo ? '' : 'text-anchor="middle"'} letter-spacing="4" filter="url(#textShadow)">QUALITY COLOURS</text>
        <text x="${logo ? 48 + logoSz + 20 : cx}" y="${headerH / 2 + 18}" font-family="${FONT}" font-size="16" fill="url(#goldTextGrad)" ${logo ? '' : 'text-anchor="middle"'} letter-spacing="2">QC Painters Program</text>

        <!-- Gold accent line -->
        <rect y="${headerH - 3}" width="${ID_W}" height="3" fill="url(#goldGrad)"/>

        <!-- ═══ BODY ═══ -->

        <!-- Decorative circles behind photo -->
        <circle cx="${cx}" cy="${photoTop + pSz / 2}" r="${pSz / 2 + 40}" fill="${lc.primary}" opacity="0.025"/>
        <circle cx="${cx}" cy="${photoTop + pSz / 2}" r="${pSz / 2 + 25}" fill="${G}" opacity="0.02"/>

        <!-- Decorative watermarks -->
        ${paintBrushIcon(30, ID_H - footerH - 140, 100, G, 0.02)}
        ${paintBrushIcon(ID_W - 110, headerH + 30, 80, lc.primary, 0.015)}

        <!-- Name centered -->
        <text x="${cx}" y="${nameY}" font-family="${FONT}" font-size="42" font-weight="bold" fill="#111827" text-anchor="middle" letter-spacing="0.5">${e(full_name)}</text>

        <!-- Level badge centered -->
        ${levelBadgePill(cx - 70, badgeY, current_level)}

        <!-- Specialization -->
        <text x="${cx}" y="${specY}" font-family="${FONT}" font-size="20" fill="${G}" font-weight="600" text-anchor="middle">${e(specLabel(specialization))}</text>

        <!-- Phone in pill -->
        <rect x="${cx - 155}" y="${phoneY - 26}" width="310" height="42" rx="21" fill="${G}" opacity="0.05"/>
        <rect x="${cx - 155}" y="${phoneY - 26}" width="310" height="42" rx="21" fill="none" stroke="${G}" stroke-width="0.5" opacity="0.08"/>
        ${phoneIcon(cx - 135, phoneY - 24, 26, G)}
        <text x="${cx + 10}" y="${phoneY}" font-family="${FONT}" font-size="28" font-weight="700" fill="#1f2937" text-anchor="middle">${e(phone)}</text>

        <!-- Gold divider -->
        <rect x="80" y="${dividerY}" width="${ID_W - 160}" height="2" rx="1" fill="url(#goldGrad)" opacity="0.6"/>

        <!-- Scan label -->
        <text x="${cx}" y="${scanLabelY}" font-family="${FONT}" font-size="13" fill="#9ca3af" text-anchor="middle" letter-spacing="3" font-weight="600">SCAN TO JOIN QC PAINTERS</text>

        <!-- QR frame -->
        <rect x="${qrBoxX}" y="${qrBoxY}" width="${qrBoxW}" height="${qrBoxH}" rx="14" fill="white" stroke="${G}" stroke-width="1.5"/>
        <rect x="${qrBoxX + 1}" y="${qrBoxY + 1}" width="${qrBoxW - 2}" height="${qrBoxH - 2}" rx="13" fill="white"/>

        <!-- Referral label -->
        <text x="${cx}" y="${refLabelY}" font-family="${FONT}" font-size="13" fill="#9ca3af" text-anchor="middle" letter-spacing="4" font-weight="600">REFERRAL CODE</text>

        <!-- Referral code box — level-colored border, light green bg -->
        <rect x="110" y="${refBoxY}" width="${ID_W - 220}" height="${refBoxH}" rx="14" fill="#f0fdf4" stroke="${lc.primary}" stroke-width="2.5"/>
        <text x="${cx}" y="${refCodeY}" font-family="${FONT}" font-size="38" font-weight="bold" fill="${G}" text-anchor="middle" letter-spacing="7">${e(referral_code)}</text>

        <!-- ═══ FOOTER (70px) ═══ -->
        <rect y="${ID_H - footerH}" width="${ID_W}" height="${footerH}" fill="url(#footerGrad)"/>
        <rect y="${ID_H - 24}" width="${ID_W}" height="24" rx="24" fill="url(#footerGrad)"/>

        <text x="${cx}" y="${ID_H - footerH + 30}" font-family="${FONT}" font-size="17" fill="white" text-anchor="middle" font-weight="600" letter-spacing="0.5">Join &amp; earn loyalty points on every purchase!</text>
        <text x="${cx}" y="${ID_H - 16}" font-family="${FONT}" font-size="13" fill="url(#goldTextGrad)" text-anchor="middle" letter-spacing="1">Quality Colours — Your Trusted Paint Partner</text>
    </svg>`;

    const base = await sharp(Buffer.from(svg)).png().toBuffer();
    const comp = [
        { input: ring, top: ringTop, left: ringLeft },
        { input: circ, top: photoTop, left: photoLeft },
        { input: qr, top: qrImgY, left: qrImgX },
    ];
    if (logo) comp.push({ input: logo, top: Math.round(headerH / 2 - logoSz / 2), left: 48 });

    const dir = path.join(__dirname, '..', 'public', 'uploads', 'painter-cards');
    ensureDir(dir);
    await sharp(base).composite(comp).png({ quality: 95 }).toFile(path.join(dir, `painter_id_${id}.png`));
    return `/uploads/painter-cards/painter_id_${id}.png?v=${Date.now()}`;
}

module.exports = { generateCard, generateIdCard };
