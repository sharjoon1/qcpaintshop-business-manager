/**
 * DOWNLOAD PRODUCT IMAGES FROM BRAND CDNs
 * Uses verified CDN URLs only.
 *
 * Usage: node scripts/download-product-images.js [--dry-run] [--brand=BrandName] [--limit=N]
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const DRY_RUN = process.argv.includes('--dry-run');
const BRAND_ARG = (process.argv.find(a => a.startsWith('--brand=')) || '').split('=')[1] || '';
const LIMIT = parseInt((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1]) || 9999;
const IMAGE_DEST = path.join(__dirname, '..', 'public', 'uploads', 'products');

// ========== BIRLA OPUS CDN (verified working) ==========
const B = 'https://assets.birlaopus.com/is/image/grasimindustries';

function getBirlaOpusUrl(name) {
    const n = name.toLowerCase();

    // Emulsions - specific product matches (longer first)
    if (n.includes('calista ever wash') && n.includes('shine')) return `${B}/birlaopus-calista-ever-wash-web`;
    if (n.includes('calista ever wash')) return `${B}/birlaopus-calista-ever-wash-web`;
    if (n.includes('calista ever clear')) return `${B}/birla-opus-calista-ever-clear-packshot`;
    if (n.includes('calista ever stay')) return `${B}/birla-opus-calista-ever-clear-packshot`; // everstay CDN 403, use everclear
    if (n.includes('calista neo star') && n.includes('shine')) return `${B}/birla-opus-calista-neostarshine-websitemock`;
    if (n.includes('calista neo star')) return `${B}/birla-opus-calista-neo-star`;
    if (n.includes('calista perfect choice')) return `${B}/birla-opus-calista-neo-star`; // fallback to neo star
    if (n.includes('one pure elegance') && n.includes('shine')) return `${B}/birlaopus-one-pure-elegance-shine`;
    if (n.includes('one pure elegance')) return `${B}/birlaopus-one-pure-elegance-web`;
    if (n.includes('one true life')) return `${B}/birla-opus-one-true-life-website-mock`;
    if (n.includes('one true look')) return `${B}/birla-opus-one-true-life-website-mock`; // no specific, use true life
    if (n.includes('one true flex')) return `${B}/birla-opus-one-true-life-website-mock`;
    if (n.includes('one true vision')) return `${B}/birla-opus-one-true-life-website-mock`;
    if (n.includes('style color smart')) return `${B}/birlaopus-style-color-smart-web`;
    if (n.includes('style color fresh')) return `${B}/birlaopus-style-color-fresh`;
    if (n.includes('style power bright')) return `${B}/birlaopus-style-powerbright-websitemock`;
    if (n.includes('style power fit')) return `${B}/birlaopus-style-powerfit-websitemock`;
    if (n.includes('style super bright') || n.includes('super bright dist')) return `${B}/birlaopus-style-super-bright-distemper-web`;
    if (n.includes('super smooth dist')) return `${B}/birlaopus-style-super-bright-distemper-web`;

    // Enamels - CST range and others
    if (n.includes('sparkle gloss') || n.includes('sparkle gl')) return `${B}/calista-sparkle-gloss-enamel`;
    if (n.includes('sparkle pu')) return `${B}/calista-sparkle-pu-enamel`;
    if (n.includes('sparkle satin')) return `${B}/calista-sparkle-satin-enamel`;
    if (n.includes('cst ') && n.includes('satin')) return `${B}/calista-sparkle-satin-enamel`;
    if (n.includes('cst ') || n.includes('enamel opus')) return `${B}/calista-sparkle-gloss-enamel`;

    // Wood Finishes
    if (n.includes('allwood melamine') || n.includes('melamine opus')) return `${B}/allwood-melamine`;
    if (n.includes('allwood soft touch') || n.includes('softtouch')) return `${B}/allwood-softtouch`;
    if (n.includes('allwood italian pu') || n.includes('italian pu')) return `${B}/allwood-italian-pu-1l-fop`;
    if (n.includes('allwood pu ext') || n.includes('pu exterior')) return `${B}/allwood-pu-exterior`;
    if (n.includes('allwood pu int') || n.includes('pu interior')) return `${B}/allwood-pu-exterior`; // no interior, use exterior
    if (n.includes('allwood') || n.includes('nc lacquer') || n.includes('nc sealer')) return `${B}/allwood-melamine`;

    // Waterproofing
    if (n.includes('alldry wall') && n.includes('fix')) return `${B}/all-dry-wall-fix-packshot`;
    if (n.includes('alldry salt') || n.includes('salt seal')) return `${B}/all-dry-salt-seal-packshot`;
    if (n.includes('alldry total') && n.includes('2k')) return `${B}/all-dry-total-2k-packshot-1`;
    if (n.includes('alldry') || n.includes('seepg') || n.includes('crack master')) return `${B}/all-dry-wall-fix-packshot`;

    // Putty - use everclear as fallback (no specific putty image found)
    if (n.includes('putty') || n.includes('plaster')) return `${B}/birla-opus-calista-ever-clear-packshot`;

    // Primers - use neo star as fallback
    if (n.includes('primer') || n.includes('pro white') || n.includes('pro hide') || n.includes('pro fresh') || n.includes('perfect start')) return `${B}/birla-opus-calista-neo-star`;
    if (n.includes('red oxide') || n.includes('metal primer') || n.includes('wood primer') || n.includes('cover max')) return `${B}/birla-opus-calista-neo-star`;

    // Colorants
    if (n.includes('colorant') || n.includes('colourant')) return `${B}/birlaopus-style-color-fresh`;

    // Metallic / special
    if (n.includes('metallic gold')) return `${B}/calista-sparkle-gloss-enamel`;

    return null;
}

// ========== BERGER PAINTS CDN (verified) ==========
const BG = 'https://images.bergerpaints.com';

function getBergerUrl(name) {
    const n = name.toLowerCase();

    // Interior Emulsions
    if (n.includes('easy clean') && (n.includes('silky') || n.includes('silk'))) return `${BG}/s3fs-public/2024-12/Easy%20Clean%20Silky%20Touch%20(2)%20(1).png`;
    if (n.includes('easy clean') && n.includes('fresh')) return `${BG}/s3fs-public/2023-08/Easy%20Clean%20Fresh%20can.png`;
    if (n.includes('easy clean')) return `${BG}/s3fs-public/2023-08/Easy%20Clean%20can_0.png`;
    if (n.includes('rangoli') && n.includes('total care')) return `${BG}/s3fs-public/2025-09/Rangoli_Total_Care-removebg-preview_0.png`;
    if (n.includes('rangoli') && n.includes('rich')) return `${BG}/s3fs-public/2025-09/Rangoli_Matt_Rich_1L-removebg-preview.png`;
    if (n.includes('rangoli')) return `${BG}/s3fs-public/2025-09/Rangoli_Matt_Rich_1L-removebg-preview.png`;
    if (n.includes('bison glow')) return `${BG}/s3fs-public/2023-08/Bison%20Glow%20can.png`;
    if (n.includes('bison lite') || n.includes('bison lt')) return `${BG}/s3fs-public/2023-11/tmp_9c85c9db-7e50-4c13-89ef-0ef211458fe2-fotor-bg-remover-20231108153920.png`;
    if (n.includes('bison smooth')) return `${BG}/2024-01/bison_emulsion.jpg`;
    if (n.includes('bison') && n.includes('emul')) return `${BG}/2024-01/bison_emulsion.jpg`;
    if (n.includes('silk glamor') || n.includes('silk glamour')) return `${BG}/s3fs-public/2025-07/Silk_Glamor_Matt_17-1x.png`;
    if (n.includes('ceiling white')) return `${BG}/s3fs-public/2024-04/ceiling-white-can.png`;

    // Exterior Emulsions
    if (n.includes('long life') && n.includes('15')) return `${BG}/s3fs-public/2024-10/longlife%2015%20can_enhanced.png`;
    if (n.includes('long life') && n.includes('10')) return `${BG}/s3fs-public/2025-02/Longlife%2010%20-%20paint%20can-02%20(1).png`;
    if (n.includes('long life') && n.includes('flexo')) return `${BG}/s3fs-public/2024-10/Weathercoat%20Long%20Life%20Flexo.png`;
    if (n.includes('long life')) return `${BG}/s3fs-public/2024-10/longlife%2015%20can_enhanced.png`;
    if (n.includes('flexo')) return `${BG}/s3fs-public/2024-10/Weathercoat%20Long%20Life%20Flexo.png`;
    if (n.includes('anti dustt') && n.includes('kool')) return `${BG}/s3fs-public/2024-10/anti-dustt-kool-can_enhanced-removebg.png`;
    if (n.includes('anti dustt') || n.includes('anti dust')) return `${BG}/s3fs-public/2024-10/weathercoat-anti-dustt-can__1_-removebg-preview.png`;
    if (n.includes('weathercoat glow')) return `${BG}/s3fs-public/2024-10/weathercoat_glow_paint_can-02__1_-removebg-preview_enhanced.png`;
    if (n.includes('weathercoat champ')) return `${BG}/s3fs-public/2024-05/WC%20Champ%20600x600.png`;
    if (n.includes('walmasta glow')) return `${BG}/s3fs-public/2024-10/Walmasta%20Glow%20paint%20can-02_enhanced.png`;
    if (n.includes('walmasta lite') || n.includes('walmasta lt')) return `${BG}/s3fs-public/2023-09/walmasta%20lite%20can%20(1).png`;
    if (n.includes('walmasta')) return `${BG}/s3fs-public/2023-09/Walmasta%20can.png`;

    // Enamels
    if (n.includes('luxol pu')) return `${BG}/s3fs-public/2025-11/Luxol%20PU%20Enamel_512%20%C3%97%20548%20px.png`;
    if (n.includes('luxol') && n.includes('satin')) return `${BG}/s3fs-public/2025-11/Luxol%20Satin_512%20%C3%97%20548%20px.png`;
    if (n.includes('luxol hi') || n.includes('luxol hg')) return `${BG}/s3fs-public/2025-09/Luxol%20Hi-Gloss%20Enamel%20R%20600X600%20(1).png`;
    if (n.includes('luxol lustre')) return `${BG}/s3fs-public/2023-08/Luxol%20Lustre%20can.png`;
    if (n.includes('luxol')) return `${BG}/s3fs-public/2025-09/Luxol%20Hi-Gloss%20Enamel%20R%20600X600%20(1).png`;
    if (n.includes('lxl')) return `${BG}/s3fs-public/2025-09/Luxol%20Hi-Gloss%20Enamel%20R%20600X600%20(1).png`;
    if (n.includes('butterfly gp')) return `${BG}/s3fs-public/2023-08/Butterfly%20GP%20Enamel%20can.png`;
    if (n.includes('butterfly')) return `${BG}/s3fs-public/2023-08/Butterfly%20GP%20Enamel%20can.png`;

    // Wood Finishes
    if (n.includes('imperia trendz')) return `${BG}/s3fs-public/2024-12/Imperia-trendz-can-shot-1ltr.png`;
    if (n.includes('imperia durakoat')) return `${BG}/s3fs-public/2024-06/Imperia%20Durakoat%201.png`;
    if (n.includes('imperia gold')) return `${BG}/s3fs-public/2023-07/imperia%20gold%20can.png`;
    if (n.includes('imperia breathe')) return `${BG}/s3fs-public/2024-08/Imperia%20Breathe%20Easy%20-%20384%20x%20412.png`;
    if (n.includes('imperia grande') || n.includes('imperia white')) return `${BG}/s3fs-public/2024-06/Imperia%20clear%20and%20white_1.png`;
    if (n.includes('imperia polyester')) return `${BG}/s3fs-public/2023-07/imperia%20polyester%20can.png`;
    if (n.includes('imperia')) return `${BG}/s3fs-public/2024-06/Imperia%20clear%20and%20white_1.png`;
    if (n.includes('rainbow')) return `${BG}/s3fs-public/2023-07/rainbow%20can.png`;
    if (n.includes('woodkeeper')) return `${BG}/s3fs-public/2023-07/Woodkeeper%201K%20PU%20can.png`;
    if (n.includes('melamine 24') || n.includes('melamine carat')) return `${BG}/s3fs-public/2023-07/Melamine%2024%20carat%20can.png`;
    if (n.includes('wood protektor')) return `${BG}/s3fs-public/2023-07/Wood%20Protektor%20can.png`;

    // Putty & Wall Care
    if (n.includes('putty') || n.includes('happy wall')) return `${BG}/s3fs-public/2025-09/Rangoli_Matt_Rich_1L-removebg-preview.png`; // no putty CDN image, use rangoli

    // Waterproofing/Primers
    if (n.includes('dampstop adv')) return `${BG}/s3fs-public/2023-08/Dampstop%20advanced%20(1)_3.png`;
    if (n.includes('dampstop duo') || n.includes('stop duo')) return `${BG}/s3fs-public/2024-10/Dampstop%20duo%20600%20x%20600%20px_0.png`;
    if (n.includes('dampstop elasto')) return `${BG}/s3fs-public/2024-10/Dampstop%20Elasto%20600%20x%20600%20px_1.png`;
    if (n.includes('dampstop')) return `${BG}/s3fs-public/2023-08/Dampstop%20advanced%20(1)_3.png`;
    if (n.includes('seal-o-prime') || n.includes('seal o prime')) return `${BG}/s3fs-public/2024-10/Seal%20o%20Prime%20600%20x%20600%20px_1.png`;
    if (n.includes('roof kool')) return `${BG}/s3fs-public/2024-10/roof_kool_can_1.png`;

    // Colorants/stainers
    if (n.includes('colorant') || n.includes('stainer')) return `${BG}/2024-01/bison_emulsion.jpg`;

    // Primers
    if (n.includes('red oxide') || n.includes('ro primer')) return `${BG}/s3fs-public/2025-09/Luxol%20Hi-Gloss%20Enamel%20R%20600X600%20(1).png`;
    if (n.includes('cement primer') || n.includes('guard primer') || n.includes('o primer') || n.includes('weathercoat') && n.includes('primer')) return `${BG}/s3fs-public/2023-09/Walmasta%20can.png`;
    if (n.includes('white') && n.includes('primer')) return `${BG}/s3fs-public/2023-09/Walmasta%20can.png`;
    if (n.includes('wood primer') || n.includes('parrot')) return `${BG}/s3fs-public/2023-07/Wood%20Protektor%20can.png`;
    if (n.includes('protectmastic')) return `${BG}/s3fs-public/2025-09/Luxol%20Hi-Gloss%20Enamel%20R%20600X600%20(1).png`;
    if (n.includes('primer')) return `${BG}/s3fs-public/2023-09/Walmasta%20can.png`;

    // Epoxy
    if (n.includes('epoxy')) return `${BG}/s3fs-public/2025-09/Luxol%20Hi-Gloss%20Enamel%20R%20600X600%20(1).png`;

    return null;
}

// ========== ASTRAL PAINTS CDN ==========
const AP = 'https://admin.astralpaints.com/wp-content/uploads/2024';

function getAstralUrl(name) {
    const n = name.toLowerCase();

    if (n.includes('elita')) return `${AP}/08/Elita-Luxury-Interior-Emulsion-1.png`;
    if (n.includes('kitchen special')) return `${AP}/08/Kitchen-Special-Interior-Emulsion.png`;
    if (n.includes('esteema') && n.includes('sheen')) return `${AP}/08/Esteema-Premium-Sheen-Interior-Emulsion-2.png`;
    if (n.includes('esteema')) return `${AP}/08/Esteema-Premium-Interior-Emulsion.png`;
    if (n.includes('styla') && n.includes('hi-sheen')) return `${AP}/08/Styla-Hi-Sheen-Interior-Emulsion.png`;
    if (n.includes('styla') && n.includes('smart')) return `${AP}/08/Styla-Smart-Sheen-Interior-Emulsion.png`;
    if (n.includes('styla') && n.includes('popular')) return `${AP}/08/Styla-Popular-Interior-Emulsion.png`;
    if (n.includes('styla') && n.includes('distemper')) return `${AP}/08/Styla-Premium-Acrylic-Distemper.png`;
    if (n.includes('styla') && n.includes('emul')) return `${AP}/08/Styla-Popular-Interior-Emulsion.png`;
    if (n.includes('extura plus')) return `${AP}/08/Extura-Plus-Luxury-Exterior-Emulsion.png`;
    if (n.includes('extura')) return `${AP}/08/Extura-Premium-Exterior-Emulsion.png`;
    if (n.includes('raga') && n.includes('smart')) return `${AP}/08/Raga-Smart-Exterior-Emulsion.png`;
    if (n.includes('raga')) return `${AP}/08/Raga-Popular-Exterior-Emulsion.png`;
    if (n.includes('harmony') && n.includes('emul')) return `${AP}/08/Styla-Popular-Interior-Emulsion.png`;
    if (n.includes('synthetic enamel') || n.includes('premium enamel')) return `${AP}/09/Synthetic-Premium-Enamel.png`;
    if (n.includes('enamel')) return `${AP}/09/Synthetic-Premium-Enamel.png`;
    if (n.includes('exterior primer') || n.includes('ext primer')) return `${AP}/08/Exterior-Premium-Primer-Water-Thinnable.png`;
    if (n.includes('dual primer')) return `${AP}/08/Dual-Primer-Interior-Exterior.png`;
    if (n.includes('red oxide')) return `${AP}/08/Red-Oxide-Premium-Primer.png`;
    if (n.includes('epoxy primer')) return `${AP}/08/Epoxy-Premium-Primer.png`;
    if (n.includes('yellow oxide')) return `${AP}/08/Yellow-Oxide-Premium-Primer.png`;
    if (n.includes('interior primer') || n.includes('int primer')) return `${AP}/08/Interior-Premium-Primer-Solvent-Thinnable.png`;
    if (n.includes('primer')) return `${AP}/08/Interior-Popular-Primer-Water-Thinnable.png`;
    if (n.includes('wall putty') || n.includes('putty')) return `${AP}/08/Wallputty-2.png`;

    // Fallback to generic emulsion
    if (n.includes('emul')) return `${AP}/08/Esteema-Premium-Interior-Emulsion.png`;

    return null;
}

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 15000
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const loc = res.headers.location.startsWith('http') ? res.headers.location : `https://${new URL(url).host}${res.headers.location}`;
                return fetchUrl(loc).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

async function downloadAndSave(url, productId) {
    const buffer = await fetchUrl(url);
    if (buffer.length < 500) throw new Error('Image too small (' + buffer.length + ' bytes)');

    const filename = `product-${productId}.jpg`;
    const destPath = path.join(IMAGE_DEST, filename);

    await sharp(buffer)
        .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toFile(destPath);

    return `/uploads/products/${filename}`;
}

function findImageUrl(productName, brandName) {
    const brand = (brandName || '').toLowerCase();

    if (brand.includes('birla')) return getBirlaOpusUrl(productName);
    if (brand.includes('berger')) return getBergerUrl(productName);
    if (brand.includes('astral')) return getAstralUrl(productName);

    return null;
}

(async () => {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST, user: process.env.DB_USER,
        password: process.env.DB_PASSWORD, database: process.env.DB_NAME
    });

    if (!DRY_RUN) fs.mkdirSync(IMAGE_DEST, { recursive: true });

    let where = "WHERE p.status = 'active'";
    const params = [];
    if (BRAND_ARG) {
        where += ' AND b.name LIKE ?';
        params.push(`%${BRAND_ARG}%`);
    }

    const [products] = await pool.query(`
        SELECT p.id, p.name, p.image_url, b.name as brand_name
        FROM products p
        LEFT JOIN brands b ON b.id = p.brand_id
        ${where}
        ORDER BY b.name, p.name
        LIMIT ?
    `, [...params, LIMIT]);

    console.log(`\nTotal products: ${products.length}\n`);

    let downloaded = 0;
    let failed = 0;
    let noUrl = 0;

    for (const product of products) {
        const url = findImageUrl(product.name, product.brand_name);

        if (!url) {
            noUrl++;
            continue;
        }

        try {
            if (DRY_RUN) {
                console.log(`  [DRY] ${product.brand_name} | ${product.name} → ${url}`);
                downloaded++;
                continue;
            }

            const imageUrl = await downloadAndSave(url, product.id);
            await pool.query('UPDATE products SET image_url = ? WHERE id = ?', [imageUrl, product.id]);
            await pool.query(
                `UPDATE zoho_items_map zim JOIN pack_sizes ps ON ps.zoho_item_id = zim.zoho_item_id
                 SET zim.image_url = ? WHERE ps.product_id = ?`,
                [imageUrl, product.id]
            );
            console.log(`  ✓ [${product.id}] ${product.brand_name} | ${product.name}`);
            downloaded++;
        } catch (err) {
            console.log(`  ✗ [${product.id}] ${product.brand_name} | ${product.name}: ${err.message}`);
            failed++;
        }

        // Rate limit
        if (!DRY_RUN && downloaded % 10 === 0) await new Promise(r => setTimeout(r, 300));
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Downloaded: ${downloaded}, Failed: ${failed}, No URL mapping: ${noUrl}`);
    console.log(`${'='.repeat(60)}\n`);

    await pool.end();
})();
