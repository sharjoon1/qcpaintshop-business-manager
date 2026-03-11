/**
 * MATCH LOCAL PRODUCT IMAGES → DB PRODUCTS
 *
 * 1. Reads all images from local "Product Images" folder
 * 2. Fetches products from DB
 * 3. Matches image filenames to product names using keyword similarity
 * 4. Compresses and copies matched images to public/uploads/products/
 * 5. Updates products.image_url in DB
 *
 * Usage: node scripts/match-product-images.js [--dry-run]
 *
 * Runs on SERVER after images are SCP'd to /tmp/product-images/
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const IMAGE_SOURCE = '/tmp/product-images';
const IMAGE_DEST = path.join(__dirname, '..', 'public', 'uploads', 'products');

// ─── Keyword extraction from filenames ───────────────────────────────────────

function extractKeywords(filename) {
    // Remove extension and path
    let name = path.basename(filename, path.extname(filename));
    // Replace hyphens, underscores, dots with spaces
    name = name.replace(/[-_.]/g, ' ');
    // Remove common prefixes
    name = name.replace(/^birla\s*opus\s*paints?\s*/i, '');
    name = name.replace(/^birla\s*opus\s*/i, '');
    name = name.replace(/^asian\s*paints?\s*/i, '');
    name = name.replace(/^berger\s*paints?\s*/i, '');
    name = name.replace(/^shalimar\s*paints?\s*/i, '');
    name = name.replace(/^addisons?\s*/i, '');
    name = name.replace(/^cumi\s*/i, '');
    // Remove size indicators
    name = name.replace(/\d+\s*x\s*\d+\s*px/gi, '');
    name = name.replace(/\d+x\d+/gi, '');
    name = name.replace(/\b\d+\b/g, '');
    // Split into keywords and normalize
    return name.toLowerCase().split(/\s+/).filter(w => w.length > 1);
}

function extractProductKeywords(productName) {
    let name = productName;
    // Remove SKU-like prefixes
    name = name.replace(/^[A-Z]{2,6}\d{1,4}\s+/i, '');
    // Remove brand suffixes
    name = name.replace(/\s+(OPUS|BERGER|ASTRAL|ADDISONS?|NIPPON)$/i, '');
    // Remove size indicators
    name = name.replace(/\b\d+\s*(LT?R?|KG|ML|PC|NOS)\b/gi, '');
    return name.toLowerCase().split(/[\s-_]+/).filter(w => w.length > 1);
}

// ─── Similarity scoring ──────────────────────────────────────────────────────

function matchScore(imageKeywords, productKeywords) {
    if (!imageKeywords.length || !productKeywords.length) return 0;

    let matches = 0;
    let partialMatches = 0;

    for (const ik of imageKeywords) {
        for (const pk of productKeywords) {
            if (ik === pk) {
                matches++;
            } else if (ik.length > 3 && pk.length > 3) {
                // Partial match: one contains the other
                if (ik.includes(pk) || pk.includes(ik)) {
                    partialMatches++;
                }
            }
        }
    }

    const totalMatches = matches + (partialMatches * 0.5);
    // Score: percentage of image keywords that matched
    const coverage = totalMatches / imageKeywords.length;
    // Bonus for matching more product keywords
    const productCoverage = totalMatches / productKeywords.length;

    return (coverage * 0.6 + productCoverage * 0.4) * totalMatches;
}

// ─── Brand detection from folder ─────────────────────────────────────────────

function getBrandFromFolder(filePath) {
    const parts = filePath.split(/[/\\]/);
    // Find the folder after "Product Images"
    const idx = parts.findIndex(p => p === 'Product Images' || p === 'product-images');
    if (idx >= 0 && idx + 1 < parts.length) {
        const folder = parts[idx + 1];
        if (/addison/i.test(folder)) return 'Addisons';
        if (/asian/i.test(folder)) return 'Asian Paints';
        if (/berger/i.test(folder)) return 'Berger Paints';
        if (/birla|opus/i.test(folder)) return 'Birla Opus';
        if (/cumi/i.test(folder)) return 'Cumi';
        if (/shalimar/i.test(folder)) return 'Shalimar Paints';
    }
    return null;
}

// ─── Find all images recursively ─────────────────────────────────────────────

function findImages(dir) {
    const images = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            images.push(...findImages(fullPath));
        } else if (/\.(jpg|jpeg|png|webp)$/i.test(entry.name)) {
            images.push(fullPath);
        }
    }
    return images;
}

// ═══════════════════════════════════════════════════════════════════════════════

(async () => {
    // Check source directory
    if (!fs.existsSync(IMAGE_SOURCE)) {
        console.error(`Source directory not found: ${IMAGE_SOURCE}`);
        console.error('SCP images first: scp -r "D:/QUALITY COLOURS/MEDIA/Product Images" root@server:/tmp/product-images/');
        process.exit(1);
    }

    // Ensure destination
    if (!DRY_RUN) {
        fs.mkdirSync(IMAGE_DEST, { recursive: true });
    }

    const pool = await mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  PRODUCT IMAGE MATCHING ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'}`);
    console.log(`${'='.repeat(60)}\n`);

    // 1. Load all images
    const allImages = findImages(IMAGE_SOURCE);
    console.log(`Found ${allImages.length} images in ${IMAGE_SOURCE}\n`);

    // 2. Load products
    const [products] = await pool.query(
        `SELECT p.id, p.name, b.name as brand_name
         FROM products p
         LEFT JOIN brands b ON b.id = p.brand_id
         WHERE p.status = 'active'
         ORDER BY p.name`
    );
    console.log(`Loaded ${products.length} active products\n`);

    // 3. Match images to products
    const matched = [];   // { productId, productName, imagePath, score }
    const unmatched = [];  // images without a good match
    const productsMatched = new Set();

    // Pre-compute image metadata
    const imageData = allImages.map(imgPath => ({
        path: imgPath,
        keywords: extractKeywords(imgPath),
        brand: getBrandFromFolder(imgPath),
        filename: path.basename(imgPath)
    }));

    for (const img of imageData) {
        // Score ALL products for this image, pick the best AVAILABLE one
        const candidates = [];

        for (const product of products) {
            // Brand must match if image has a brand folder
            if (img.brand) {
                const productBrand = (product.brand_name || '').toLowerCase();
                const imageBrand = img.brand.toLowerCase();
                if (!productBrand.includes(imageBrand.split(' ')[0]) &&
                    !imageBrand.includes(productBrand.split(' ')[0])) {
                    continue; // Skip brand mismatch
                }
            }

            const productKeywords = extractProductKeywords(product.name);
            const score = matchScore(img.keywords, productKeywords);

            if (score >= 1.0) {
                candidates.push({ product, score });
            }
        }

        // Sort by score descending, pick first available
        candidates.sort((a, b) => b.score - a.score);

        let assigned = false;
        for (const c of candidates) {
            if (!productsMatched.has(c.product.id)) {
                matched.push({
                    productId: c.product.id,
                    productName: c.product.name,
                    brandName: c.product.brand_name,
                    imagePath: img.path,
                    imageFilename: img.filename,
                    score: c.score.toFixed(2)
                });
                productsMatched.add(c.product.id);
                assigned = true;
                break;
            }
        }

        if (!assigned) {
            const best = candidates[0];
            unmatched.push({
                imagePath: img.path,
                imageFilename: img.filename,
                bestProduct: best ? best.product.name : 'none',
                bestScore: best ? best.score.toFixed(2) : '0'
            });
        }
    }

    // Sort matched by score descending
    matched.sort((a, b) => b.score - a.score);

    console.log(`=== MATCHED: ${matched.length} images → products ===\n`);
    for (const m of matched) {
        console.log(`  [${m.score}] "${m.imageFilename}" → "${m.productName}" (${m.brandName})`);
    }

    console.log(`\n=== UNMATCHED: ${unmatched.length} images ===\n`);
    for (const u of unmatched) {
        console.log(`  "${u.imageFilename}" — best: "${u.bestProduct}" (score: ${u.bestScore})`);
    }

    console.log(`\n=== PRODUCTS WITHOUT IMAGES: ${products.length - productsMatched.size} ===\n`);

    if (DRY_RUN) {
        console.log('--- DRY RUN COMPLETE ---\n');
        await pool.end();
        return;
    }

    // 4. Process matched images: compress and save
    console.log('\nProcessing matched images...\n');
    let updated = 0;

    for (const m of matched) {
        try {
            const ext = '.jpg';
            const destFilename = `product-${m.productId}${ext}`;
            const destPath = path.join(IMAGE_DEST, destFilename);
            const imageUrl = `/uploads/products/${destFilename}`;

            // Compress with sharp
            await sharp(m.imagePath)
                .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 85 })
                .toFile(destPath);

            // Update DB
            await pool.query(
                'UPDATE products SET image_url = ? WHERE id = ?',
                [imageUrl, m.productId]
            );

            // Also update zoho_items_map image_url for all pack_sizes of this product
            await pool.query(
                `UPDATE zoho_items_map zim
                 JOIN pack_sizes ps ON ps.zoho_item_id = zim.zoho_item_id
                 SET zim.image_url = ?
                 WHERE ps.product_id = ?`,
                [imageUrl, m.productId]
            );

            updated++;
            console.log(`  ✓ ${destFilename} ← "${m.imageFilename}" → "${m.productName}"`);
        } catch (err) {
            console.error(`  ✗ Failed: "${m.imageFilename}": ${err.message}`);
        }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  COMPLETE: ${updated} products updated with images`);
    console.log(`  Products still without images: ${products.length - updated}`);
    console.log(`${'='.repeat(60)}\n`);

    await pool.end();
})();
