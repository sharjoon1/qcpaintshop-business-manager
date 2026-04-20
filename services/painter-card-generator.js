/**
 * Painter Card Generator — v9
 * Visiting card (1400x800) — Painter's personal card. No QC branding, no QR,
 *     no referral code. Clean modern typography with photo, name, phone, city.
 *     Intended for painter → customer sharing.
 * ID card (800x1200) — Official QC-issued painter identity. Stronger QC branding,
 *     unique ID number, issue year, QR + referral. Painter → painter recruitment.
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
// VISITING CARD — 1400x800 v9 Personal
// Painter-owned look. No QC branding. No QR. No referral.
// Clean modern typography for painter → customer sharing.
// ══════════════════════════════════════════════════════

async function generateCard(painter, pool) {
    const { id, full_name, phone, city, specialization, experience_years, profile_photo } = painter;

    const pSz = 320;
    // Personal accent — warm terracotta/indigo pair so every card feels distinct
    // without QC's signature green. Deterministic per painter id.
    const palettes = [
        { accent: '#b45309', soft: '#fef3c7', deep: '#78350f' }, // warm amber
        { accent: '#1e40af', soft: '#dbeafe', deep: '#1e3a8a' }, // indigo
        { accent: '#9f1239', soft: '#ffe4e6', deep: '#881337' }, // rose
        { accent: '#115e59', soft: '#ccfbf1', deep: '#134e4a' }, // teal
        { accent: '#581c87', soft: '#f3e8ff', deep: '#3b0764' }, // purple
    ];
    const palette = palettes[id % palettes.length];

    const { circ, ring, rs: ringSize } = await loadPhoto(profile_photo, full_name, pSz, palette.accent);

    const spec = specLabel(specialization);
    const exp = experience_years ? `${experience_years}+ years` : '';
    const e = esc;
    const initial = (full_name || 'P').charAt(0).toUpperCase();

    // ── Layout geometry ──
    // Two-column: left accent stripe with monogram, right content.
    const stripeW = 220;
    const contentX = stripeW + 70;
    const centerY = CARD_H / 2;

    const photoCY = centerY;
    const photoX = CARD_W - pSz - 100;
    const photoTop = Math.round(photoCY - pSz / 2);
    const ringTop = Math.round(photoCY - ringSize / 2);
    const ringLeft = Math.round(photoX - (ringSize - pSz) / 2);

    // Name block left-aligned in the content column
    const nameBlockY = 220;
    const nameY = nameBlockY;
    const accentBarY = nameY + 18;
    const specY = accentBarY + 48;
    const expY = specY + 34;

    // Contact block below
    const contactBlockY = CARD_H - 230;
    const phoneY = contactBlockY;
    const cityY = phoneY + 52;

    const svg = `
    <svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="stripeGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="${palette.accent}"/>
                <stop offset="100%" stop-color="${palette.deep}"/>
            </linearGradient>
            <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="${palette.accent}"/>
                <stop offset="100%" stop-color="${palette.deep}"/>
            </linearGradient>
            <filter id="vizShadow" x="-10%" y="-10%" width="120%" height="120%">
                <feGaussianBlur in="SourceAlpha" stdDeviation="6"/>
                <feOffset dx="0" dy="4"/>
                <feComponentTransfer><feFuncA type="linear" slope="0.12"/></feComponentTransfer>
                <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
        </defs>

        <!-- ═══ CARD BASE ═══ -->
        <rect width="${CARD_W}" height="${CARD_H}" rx="24" fill="#ffffff"/>

        <!-- Left accent stripe -->
        <rect x="0" y="0" width="${stripeW}" height="${CARD_H}" rx="24" fill="url(#stripeGrad)"/>
        <rect x="${stripeW - 24}" y="0" width="24" height="${CARD_H}" fill="url(#stripeGrad)"/>

        <!-- Big monogram on stripe -->
        <text x="${stripeW / 2}" y="${CARD_H / 2 + 15}" font-family="Georgia, 'Times New Roman', serif" font-size="260" font-weight="bold" fill="white" text-anchor="middle" opacity="0.12">${e(initial)}</text>

        <!-- Small monogram initials bottom of stripe -->
        <text x="${stripeW / 2}" y="${CARD_H - 50}" font-family="${FONT}" font-size="18" fill="white" text-anchor="middle" letter-spacing="4" opacity="0.85" font-weight="600">${e(initial)}</text>
        <line x1="${stripeW / 2 - 30}" y1="${CARD_H - 85}" x2="${stripeW / 2 + 30}" y2="${CARD_H - 85}" stroke="white" stroke-width="1.5" opacity="0.5"/>

        <!-- Subtle top-left accent dot -->
        <circle cx="${stripeW / 2}" cy="${60}" r="6" fill="white" opacity="0.5"/>

        <!-- ═══ RIGHT CONTENT AREA ═══ -->

        <!-- "PROFESSIONAL PAINTER" eyebrow -->
        <text x="${contentX}" y="${nameY - 50}" font-family="${FONT}" font-size="14" fill="${palette.accent}" letter-spacing="6" font-weight="700">PROFESSIONAL PAINTER</text>

        <!-- Painter Name - the hero -->
        <text x="${contentX}" y="${nameY}" font-family="Georgia, 'Times New Roman', serif" font-size="64" font-weight="700" fill="#111827" letter-spacing="0.5">${e(full_name)}</text>

        <!-- Accent bar -->
        <rect x="${contentX}" y="${accentBarY}" width="80" height="4" rx="2" fill="${palette.accent}"/>

        <!-- Specialization -->
        <text x="${contentX}" y="${specY}" font-family="${FONT}" font-size="26" fill="#4b5563" font-weight="500" letter-spacing="0.5">${e(spec)}</text>

        <!-- Experience (subtle) -->
        ${exp ? `<text x="${contentX}" y="${expY}" font-family="${FONT}" font-size="17" fill="#9ca3af" letter-spacing="1.5" font-weight="500">${e(exp.toUpperCase())}</text>` : ''}

        <!-- ═══ CONTACT BLOCK ═══ -->

        <!-- Thin horizontal divider -->
        <line x1="${contentX}" y1="${contactBlockY - 60}" x2="${contentX + 300}" y2="${contactBlockY - 60}" stroke="#e5e7eb" stroke-width="1"/>
        <text x="${contentX}" y="${contactBlockY - 35}" font-family="${FONT}" font-size="11" fill="#9ca3af" letter-spacing="4" font-weight="700">CONTACT</text>

        <!-- Phone -->
        ${phoneIcon(contentX, phoneY - 28, 32, palette.accent)}
        <text x="${contentX + 48}" y="${phoneY}" font-family="${FONT}" font-size="34" font-weight="600" fill="#111827" letter-spacing="1">${e(phone)}</text>

        <!-- City -->
        ${city ? `
            ${locationIcon(contentX, cityY - 24, 28, palette.accent)}
            <text x="${contentX + 48}" y="${cityY}" font-family="${FONT}" font-size="24" fill="#6b7280" font-weight="500" letter-spacing="0.3">${e(city)}</text>
        ` : ''}

        <!-- Soft decorative dots top-right -->
        <circle cx="${CARD_W - 60}" cy="60" r="3" fill="${palette.accent}" opacity="0.3"/>
        <circle cx="${CARD_W - 80}" cy="60" r="3" fill="${palette.accent}" opacity="0.3"/>
        <circle cx="${CARD_W - 100}" cy="60" r="3" fill="${palette.accent}" opacity="0.3"/>
    </svg>`;

    const base = await sharp(Buffer.from(svg)).png().toBuffer();

    const comp = [
        { input: ring, top: ringTop, left: ringLeft },
        { input: circ, top: photoTop, left: photoX },
    ];

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
    const { id, full_name, phone, city, specialization, referral_code, profile_photo, current_level, created_at } = painter;

    const url = `${ORIGIN}/painter-register.html?ref=${referral_code}`;
    const qr = await QRCode.toBuffer(url, { width: 200, margin: 1, color: { dark: DARK, light: '#FFFFFF' } });

    const pSz = 240;
    const logoSz = 64;
    const lc = getLevelColor(current_level);
    const [{ circ, ring, rs: ringSize }, logo] = await Promise.all([
        loadPhoto(profile_photo, full_name, pSz, GOLD),
        pool ? loadLogo(pool, logoSz) : Promise.resolve(null)
    ]);

    const e = esc;
    const cx = ID_W / 2;
    const memberSince = created_at ? new Date(created_at).getFullYear() : new Date().getFullYear();
    const paddedId = String(id).padStart(5, '0');
    const validYear = new Date().getFullYear() + 1;

    // ── Layout geometry ──
    const headerH = 180;
    const footerH = 70;
    const photoTop = headerH + 30;
    const photoLeft = Math.round(cx - pSz / 2);
    const ringTop = Math.round(photoTop - (ringSize - pSz) / 2);
    const ringLeft = Math.round(photoLeft - (ringSize - pSz) / 2);

    // "OFFICIAL MEMBER" banner across photo bottom
    const bannerY = photoTop + pSz + 2;

    // Text block
    const nameY = bannerY + 62;
    const badgeY = nameY + 10;
    const specY = badgeY + 42;

    // Meta data grid (2 cols) — ID / Member Since / Region / Valid Thru
    const metaRow1Y = specY + 42;
    const metaRow2Y = metaRow1Y + 48;

    // Phone pill
    const phoneY = metaRow2Y + 52;

    // Ornamental divider
    const dividerY = phoneY + 30;

    // Referral code — placed ABOVE QR for prominence
    const refLabelY = dividerY + 30;
    const refBoxY = refLabelY + 12;
    const refBoxH = 52;
    const refCodeY = refBoxY + 36;

    // QR section — BELOW referral
    const scanLabelY = refBoxY + refBoxH + 28;
    const qrSize = 150;
    const qrImgY = scanLabelY + 14;
    const qrImgX = Math.round(cx - qrSize / 2);
    const qrBoxX = qrImgX - 14;
    const qrBoxY = qrImgY - 12;
    const qrBoxW = qrSize + 28;
    const qrBoxH = qrSize + 24;

    const svg = `
    <svg width="${ID_W}" height="${ID_H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="idHeaderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#061a10"/>
                <stop offset="50%" stop-color="${DARK}"/>
                <stop offset="100%" stop-color="${G}"/>
            </linearGradient>
            <linearGradient id="idGoldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#b8860b"/>
                <stop offset="40%" stop-color="${GOLD}"/>
                <stop offset="60%" stop-color="#e6bc6a"/>
                <stop offset="100%" stop-color="${GOLD}"/>
            </linearGradient>
            <linearGradient id="idBodyBg" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#ffffff"/>
                <stop offset="100%" stop-color="#f5faf7"/>
            </linearGradient>
            <radialGradient id="crestGrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="${GOLD}" stop-opacity="0.25"/>
                <stop offset="100%" stop-color="${GOLD}" stop-opacity="0"/>
            </radialGradient>
            <filter id="idTextShadow" x="-5%" y="-5%" width="110%" height="110%">
                <feGaussianBlur in="SourceAlpha" stdDeviation="1.8"/>
                <feOffset dx="0" dy="1"/>
                <feComponentTransfer><feFuncA type="linear" slope="0.25"/></feComponentTransfer>
                <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <filter id="idLogoGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur in="SourceAlpha" stdDeviation="14"/>
                <feComponentTransfer><feFuncA type="linear" slope="0.25"/></feComponentTransfer>
                <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
        </defs>

        <!-- ═══ CARD BASE ═══ -->
        <rect width="${ID_W}" height="${ID_H}" rx="28" fill="url(#idBodyBg)"/>

        <!-- Gold perimeter accent -->
        <rect x="4" y="4" width="${ID_W - 8}" height="${ID_H - 8}" rx="26" fill="none" stroke="url(#idGoldGrad)" stroke-width="1" opacity="0.5"/>
        <rect x="10" y="10" width="${ID_W - 20}" height="${ID_H - 20}" rx="22" fill="none" stroke="${GOLD}" stroke-width="0.5" opacity="0.3"/>

        <!-- ═══ HEADER (200px) — premium official ═══ -->
        <rect width="${ID_W}" height="${headerH}" rx="28" fill="url(#idHeaderGrad)"/>
        <rect y="28" width="${ID_W}" height="${headerH - 28}" fill="url(#idHeaderGrad)"/>

        <!-- Diagonal holographic lines -->
        <line x1="0" y1="${headerH}" x2="${headerH}" y2="0" stroke="white" stroke-width="0.5" opacity="0.05"/>
        <line x1="120" y1="${headerH}" x2="${headerH + 120}" y2="0" stroke="white" stroke-width="0.5" opacity="0.04"/>
        <line x1="240" y1="${headerH}" x2="${headerH + 240}" y2="0" stroke="white" stroke-width="0.4" opacity="0.04"/>
        <line x1="360" y1="${headerH}" x2="${headerH + 360}" y2="0" stroke="white" stroke-width="0.4" opacity="0.03"/>
        <line x1="480" y1="${headerH}" x2="${headerH + 480}" y2="0" stroke="white" stroke-width="0.3" opacity="0.03"/>

        <!-- Gold crest background behind logo -->
        <circle cx="${cx}" cy="${headerH / 2 - 8}" r="80" fill="url(#crestGrad)"/>

        <!-- Top ribbon -->
        <rect x="0" y="0" width="${ID_W}" height="6" fill="url(#idGoldGrad)"/>

        <!-- "OFFICIAL IDENTITY CARD" eyebrow -->
        <text x="${cx}" y="38" font-family="${FONT}" font-size="11" fill="${GOLD}" text-anchor="middle" letter-spacing="6" font-weight="700">OFFICIAL IDENTITY CARD</text>

        <!-- Thin gold underline under eyebrow -->
        <line x1="${cx - 80}" y1="48" x2="${cx + 80}" y2="48" stroke="${GOLD}" stroke-width="0.8" opacity="0.6"/>

        <!-- Logo (if available) left of company name; else centered -->
        ${logo ? `<circle cx="${cx - 150}" cy="${headerH / 2 + 10}" r="${logoSz / 2 + 20}" fill="white" opacity="0.12" filter="url(#idLogoGlow)"/>` : ''}

        <!-- Company name — centered, with decorative bars -->
        <text x="${cx}" y="${headerH / 2 + 20}" font-family="Georgia, 'Times New Roman', serif" font-size="46" font-weight="700" fill="white" text-anchor="middle" letter-spacing="6" filter="url(#idTextShadow)">QUALITY COLOURS</text>
        <text x="${cx}" y="${headerH / 2 + 52}" font-family="${FONT}" font-size="14" fill="url(#idGoldGrad)" text-anchor="middle" letter-spacing="8" font-weight="600">THE BRANDED PAINT SHOWROOM</text>

        <!-- Decorative bars flanking company name -->
        <rect x="40" y="${headerH / 2 + 10}" width="60" height="2" fill="${GOLD}" opacity="0.7"/>
        <rect x="${ID_W - 100}" y="${headerH / 2 + 10}" width="60" height="2" fill="${GOLD}" opacity="0.7"/>

        <!-- Gold accent line bottom of header -->
        <rect y="${headerH - 4}" width="${ID_W}" height="4" fill="url(#idGoldGrad)"/>

        <!-- ═══ BODY ═══ -->

        <!-- Decorative gold circles behind photo -->
        <circle cx="${cx}" cy="${photoTop + pSz / 2}" r="${pSz / 2 + 45}" fill="${GOLD}" opacity="0.06"/>
        <circle cx="${cx}" cy="${photoTop + pSz / 2}" r="${pSz / 2 + 25}" fill="${GOLD}" opacity="0.08"/>

        <!-- Decorative watermarks (subtle) -->
        ${paintBrushIcon(30, ID_H - footerH - 180, 100, G, 0.03)}
        ${paintBrushIcon(ID_W - 130, headerH + 20, 90, GOLD, 0.03)}

        <!-- "OFFICIAL MEMBER" banner below photo -->
        <rect x="${cx - 140}" y="${bannerY}" width="280" height="32" rx="16" fill="${DARK}"/>
        <text x="${cx}" y="${bannerY + 22}" font-family="${FONT}" font-size="13" fill="${GOLD}" text-anchor="middle" letter-spacing="5" font-weight="700">OFFICIAL MEMBER</text>

        <!-- Name centered -->
        <text x="${cx}" y="${nameY}" font-family="Georgia, 'Times New Roman', serif" font-size="44" font-weight="700" fill="#111827" text-anchor="middle" letter-spacing="0.5">${e(full_name)}</text>

        <!-- Level badge centered -->
        ${levelBadgePill(cx - 70, badgeY, current_level)}

        <!-- Specialization -->
        <text x="${cx}" y="${specY}" font-family="${FONT}" font-size="20" fill="${G}" font-weight="600" text-anchor="middle" letter-spacing="0.5">${e(specLabel(specialization))}</text>

        <!-- Meta grid — ID & Member Since -->
        <text x="${cx - 140}" y="${metaRow1Y}" font-family="${FONT}" font-size="10" fill="#9ca3af" letter-spacing="3" font-weight="700">ID NO.</text>
        <text x="${cx - 140}" y="${metaRow1Y + 26}" font-family="'Courier New', monospace" font-size="20" fill="#111827" font-weight="700" letter-spacing="2">QC-${paddedId}</text>

        <text x="${cx + 30}" y="${metaRow1Y}" font-family="${FONT}" font-size="10" fill="#9ca3af" letter-spacing="3" font-weight="700">MEMBER SINCE</text>
        <text x="${cx + 30}" y="${metaRow1Y + 26}" font-family="'Courier New', monospace" font-size="20" fill="#111827" font-weight="700" letter-spacing="2">${memberSince}</text>

        <!-- Row 2: City + Valid -->
        ${city ? `
            <text x="${cx - 140}" y="${metaRow2Y}" font-family="${FONT}" font-size="10" fill="#9ca3af" letter-spacing="3" font-weight="700">REGION</text>
            <text x="${cx - 140}" y="${metaRow2Y + 26}" font-family="${FONT}" font-size="18" fill="#111827" font-weight="600" letter-spacing="0.5">${e(city)}</text>
        ` : ''}

        <text x="${cx + 30}" y="${metaRow2Y}" font-family="${FONT}" font-size="10" fill="#9ca3af" letter-spacing="3" font-weight="700">VALID THRU</text>
        <text x="${cx + 30}" y="${metaRow2Y + 26}" font-family="'Courier New', monospace" font-size="18" fill="#111827" font-weight="700" letter-spacing="2">12 / ${validYear}</text>

        <!-- Phone pill -->
        <rect x="${cx - 175}" y="${phoneY - 28}" width="350" height="46" rx="23" fill="${G}" opacity="0.06"/>
        <rect x="${cx - 175}" y="${phoneY - 28}" width="350" height="46" rx="23" fill="none" stroke="${G}" stroke-width="1" opacity="0.2"/>
        ${phoneIcon(cx - 150, phoneY - 26, 28, G)}
        <text x="${cx + 20}" y="${phoneY}" font-family="${FONT}" font-size="26" font-weight="700" fill="#1f2937" text-anchor="middle" letter-spacing="1">${e(phone)}</text>

        <!-- Gold ornamental divider -->
        <g transform="translate(${cx}, ${dividerY})">
            <line x1="-180" y1="0" x2="-30" y2="0" stroke="${GOLD}" stroke-width="1.5" opacity="0.6"/>
            <line x1="30" y1="0" x2="180" y2="0" stroke="${GOLD}" stroke-width="1.5" opacity="0.6"/>
            <circle cx="0" cy="0" r="4" fill="${GOLD}" opacity="0.8"/>
            <circle cx="-18" cy="0" r="2" fill="${GOLD}" opacity="0.5"/>
            <circle cx="18" cy="0" r="2" fill="${GOLD}" opacity="0.5"/>
        </g>

        <!-- Scan label -->
        <text x="${cx}" y="${scanLabelY}" font-family="${FONT}" font-size="12" fill="#6b7280" text-anchor="middle" letter-spacing="4" font-weight="700">SCAN TO VERIFY &amp; JOIN</text>

        <!-- QR frame with shadow -->
        <rect x="${qrBoxX + 2}" y="${qrBoxY + 3}" width="${qrBoxW}" height="${qrBoxH}" rx="14" fill="#000" opacity="0.06"/>
        <rect x="${qrBoxX}" y="${qrBoxY}" width="${qrBoxW}" height="${qrBoxH}" rx="14" fill="white" stroke="${GOLD}" stroke-width="1.5"/>

        <!-- Referral label -->
        <text x="${cx}" y="${refLabelY}" font-family="${FONT}" font-size="11" fill="#9ca3af" text-anchor="middle" letter-spacing="5" font-weight="700">REFERRAL CODE</text>

        <!-- Referral code box - dark green with gold border -->
        <rect x="110" y="${refBoxY}" width="${ID_W - 220}" height="${refBoxH}" rx="16" fill="${DARK}"/>
        <rect x="114" y="${refBoxY + 4}" width="${ID_W - 228}" height="${refBoxH - 8}" rx="12" fill="none" stroke="${GOLD}" stroke-width="1.5" opacity="0.7"/>
        <text x="${cx}" y="${refCodeY}" font-family="'Courier New', monospace" font-size="36" font-weight="bold" fill="${GOLD}" text-anchor="middle" letter-spacing="8">${e(referral_code)}</text>

        <!-- ═══ FOOTER (80px) ═══ -->
        <rect y="${ID_H - footerH}" width="${ID_W}" height="${footerH}" fill="url(#idHeaderGrad)"/>
        <rect y="${ID_H - 28}" width="${ID_W}" height="28" rx="28" fill="url(#idHeaderGrad)"/>
        <rect y="${ID_H - footerH}" width="${ID_W}" height="3" fill="url(#idGoldGrad)"/>

        <text x="${cx}" y="${ID_H - footerH + 30}" font-family="${FONT}" font-size="15" fill="white" text-anchor="middle" font-weight="600" letter-spacing="2">AUTHORIZED PAINTER • EARN POINTS ON EVERY PURCHASE</text>
        <text x="${cx}" y="${ID_H - 16}" font-family="${FONT}" font-size="11" fill="${GOLD}" text-anchor="middle" letter-spacing="3" font-weight="600">QUALITY COLOURS — YOUR TRUSTED PAINT PARTNER</text>
    </svg>`;

    const base = await sharp(Buffer.from(svg)).png().toBuffer();
    const comp = [
        { input: ring, top: ringTop, left: ringLeft },
        { input: circ, top: photoTop, left: photoLeft },
        { input: qr, top: qrImgY, left: qrImgX },
    ];
    if (logo) comp.push({ input: logo, top: Math.round(headerH / 2 - logoSz / 2 + 10), left: Math.round(cx - 150 - logoSz / 2) });

    const dir = path.join(__dirname, '..', 'public', 'uploads', 'painter-cards');
    ensureDir(dir);
    await sharp(base).composite(comp).png({ quality: 95 }).toFile(path.join(dir, `painter_id_${id}.png`));
    return `/uploads/painter-cards/painter_id_${id}.png?v=${Date.now()}`;
}

module.exports = { generateCard, generateIdCard };
