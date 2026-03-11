/**
 * GENERATE BRAND PLACEHOLDER IMAGES
 * For products without images, creates a branded placeholder using sharp.
 * Shows brand name + product name on a colored background.
 *
 * Usage: node scripts/generate-brand-placeholders.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const IMAGE_DEST = path.join(__dirname, '..', 'public', 'uploads', 'products');

// Brand colors for placeholder images
const BRAND_COLORS = {
    'Asian Paints':    { bg: '#E8393D', text: '#FFFFFF', accent: '#FFD700' },
    'Berger Paints':   { bg: '#004B87', text: '#FFFFFF', accent: '#FFD700' },
    'Birla Opus':      { bg: '#1A1A2E', text: '#FFFFFF', accent: '#C9A84C' },
    'Addisons':        { bg: '#2E7D32', text: '#FFFFFF', accent: '#FFC107' },
    'Astral Paints':   { bg: '#FF6F00', text: '#FFFFFF', accent: '#FFFFFF' },
    'Shalimar Paints': { bg: '#1565C0', text: '#FFFFFF', accent: '#FFD700' },
    'Crizon':          { bg: '#6A1B9A', text: '#FFFFFF', accent: '#FFD700' },
    'CUMI':            { bg: '#FF5722', text: '#FFFFFF', accent: '#FFFFFF' },
    'AkzoNobel':       { bg: '#003E74', text: '#FFFFFF', accent: '#97C93D' },
    'Nippon':          { bg: '#E50012', text: '#FFFFFF', accent: '#FFFFFF' },
    'Generic':         { bg: '#455A64', text: '#FFFFFF', accent: '#B0BEC5' },
};

function escapeXml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(str, maxLen) {
    if (str.length <= maxLen) return str;
    return str.substring(0, maxLen - 3) + '...';
}

function createPlaceholderSVG(brandName, productName, categoryName, colors) {
    const brand = escapeXml(truncate(brandName || 'Paint', 30));
    const product = escapeXml(truncate(productName || 'Product', 35));
    const category = escapeXml(truncate(categoryName || '', 30));

    return `<svg width="800" height="800" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${colors.bg};stop-opacity:1"/>
      <stop offset="100%" style="stop-color:${darken(colors.bg, 30)};stop-opacity:1"/>
    </linearGradient>
  </defs>
  <rect width="800" height="800" fill="url(#bg)" rx="20"/>

  <!-- Paint can icon -->
  <g transform="translate(300,180)">
    <rect x="30" y="40" width="140" height="200" rx="12" fill="${colors.accent}" opacity="0.3"/>
    <rect x="50" y="0" width="100" height="20" rx="8" fill="${colors.accent}" opacity="0.4"/>
    <rect x="60" y="80" width="80" height="60" rx="6" fill="${colors.text}" opacity="0.2"/>
  </g>

  <!-- Brand name -->
  <text x="400" y="500" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="48" font-weight="bold" fill="${colors.accent}">${brand}</text>

  <!-- Product name -->
  <text x="400" y="580" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="32" fill="${colors.text}">${product}</text>

  <!-- Category -->
  <text x="400" y="640" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="22" fill="${colors.text}" opacity="0.7">${category}</text>

  <!-- QC Paint Shop watermark -->
  <text x="400" y="760" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="16" fill="${colors.text}" opacity="0.4">QC Paint Shop</text>
</svg>`;
}

function darken(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, (num >> 16) - Math.round(2.55 * percent));
    const g = Math.max(0, ((num >> 8) & 0x00FF) - Math.round(2.55 * percent));
    const b = Math.max(0, (num & 0x0000FF) - Math.round(2.55 * percent));
    return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
}

(async () => {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    fs.mkdirSync(IMAGE_DEST, { recursive: true });

    // Get products without images
    const [products] = await pool.query(`
        SELECT p.id, p.name, b.name as brand_name, c.name as category_name
        FROM products p
        LEFT JOIN brands b ON b.id = p.brand_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.status = 'active' AND (p.image_url IS NULL OR p.image_url = '')
        ORDER BY p.id
    `);

    console.log(`Generating placeholders for ${products.length} products...\n`);

    let created = 0;
    let failed = 0;

    for (const product of products) {
        try {
            const brandName = product.brand_name || 'Generic';
            const colors = BRAND_COLORS[brandName] || BRAND_COLORS['Generic'];
            const svg = createPlaceholderSVG(brandName, product.name, product.category_name, colors);

            const filename = `product-${product.id}.jpg`;
            const destPath = path.join(IMAGE_DEST, filename);
            const imageUrl = `/uploads/products/${filename}`;

            await sharp(Buffer.from(svg))
                .resize(400, 400)
                .jpeg({ quality: 85 })
                .toFile(destPath);

            await pool.query('UPDATE products SET image_url = ? WHERE id = ?', [imageUrl, product.id]);
            await pool.query(
                `UPDATE zoho_items_map zim
                 JOIN pack_sizes ps ON ps.zoho_item_id = zim.zoho_item_id
                 SET zim.image_url = ?
                 WHERE ps.product_id = ?`,
                [imageUrl, product.id]
            );

            created++;
            if (created % 100 === 0) console.log(`  Progress: ${created}/${products.length}`);
        } catch (err) {
            console.error(`  Failed product #${product.id} "${product.name}": ${err.message}`);
            failed++;
        }
    }

    console.log(`\nDone: ${created} placeholders created, ${failed} failed`);

    // Verify
    const [verify] = await pool.query("SELECT COUNT(*) as cnt FROM products WHERE status = 'active' AND image_url IS NOT NULL AND image_url != ''");
    console.log(`Total products with images: ${verify[0].cnt}`);

    await pool.end();
})();
