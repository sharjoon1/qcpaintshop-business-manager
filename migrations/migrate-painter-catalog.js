/**
 * Painter Program — admin-controlled catalog ordering + visibility.
 *
 * Six tables: 3 global (default for all painters) + 3 per-painter overrides.
 * Override columns are nullable so NULL = "inherit from global".
 *
 *   painter_catalog_brand_order
 *   painter_catalog_category_order
 *   painter_catalog_product_order
 *   painter_catalog_brand_overrides
 *   painter_catalog_category_overrides
 *   painter_catalog_product_overrides
 *
 * Seeds the three global tables from the existing painter catalog query
 * (products joined with active zoho_items_map) so the admin UI shows
 * every current brand/category/product on first load.
 *
 * Idempotent — safe to re-run.
 *
 * Run with:  node migrations/migrate-painter-catalog.js
 */
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function migrate() {
  let pool;
  try {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'business_manager',
      port: process.env.DB_PORT || 3306
    });

    console.log('Painter catalog ordering + visibility migration\n');

    // 1) Global tables ------------------------------------------------------
    console.log('1. Creating painter_catalog_brand_order...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS painter_catalog_brand_order (
        brand VARCHAR(150) NOT NULL PRIMARY KEY,
        sort_order INT NOT NULL DEFAULT 999,
        is_hidden TINYINT(1) NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_sort (sort_order),
        INDEX idx_hidden (is_hidden)
      )
    `);
    console.log('   ✓ painter_catalog_brand_order');

    console.log('2. Creating painter_catalog_category_order...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS painter_catalog_category_order (
        brand VARCHAR(150) NOT NULL,
        category VARCHAR(150) NOT NULL,
        sort_order INT NOT NULL DEFAULT 999,
        is_hidden TINYINT(1) NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (brand, category),
        INDEX idx_brand_sort (brand, sort_order),
        INDEX idx_hidden (is_hidden)
      )
    `);
    console.log('   ✓ painter_catalog_category_order');

    console.log('3. Creating painter_catalog_product_order...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS painter_catalog_product_order (
        product_id INT NOT NULL PRIMARY KEY,
        sort_order INT NOT NULL DEFAULT 999,
        is_hidden TINYINT(1) NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_sort (sort_order),
        INDEX idx_hidden (is_hidden)
      )
    `);
    console.log('   ✓ painter_catalog_product_order');

    // 2) Per-painter override tables ---------------------------------------
    // NULL columns let us "inherit" a single field while overriding the other.
    console.log('4. Creating painter_catalog_brand_overrides...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS painter_catalog_brand_overrides (
        painter_id INT NOT NULL,
        brand VARCHAR(150) NOT NULL,
        sort_order INT DEFAULT NULL,
        is_hidden TINYINT(1) DEFAULT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (painter_id, brand),
        INDEX idx_painter (painter_id)
      )
    `);
    console.log('   ✓ painter_catalog_brand_overrides');

    console.log('5. Creating painter_catalog_category_overrides...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS painter_catalog_category_overrides (
        painter_id INT NOT NULL,
        brand VARCHAR(150) NOT NULL,
        category VARCHAR(150) NOT NULL,
        sort_order INT DEFAULT NULL,
        is_hidden TINYINT(1) DEFAULT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (painter_id, brand, category),
        INDEX idx_painter (painter_id)
      )
    `);
    console.log('   ✓ painter_catalog_category_overrides');

    console.log('6. Creating painter_catalog_product_overrides...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS painter_catalog_product_overrides (
        painter_id INT NOT NULL,
        product_id INT NOT NULL,
        sort_order INT DEFAULT NULL,
        is_hidden TINYINT(1) DEFAULT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (painter_id, product_id),
        INDEX idx_painter (painter_id)
      )
    `);
    console.log('   ✓ painter_catalog_product_overrides');

    // 3) Seed global tables from existing painter catalog data -------------
    // We only seed rows that don't already exist (INSERT IGNORE). Initial
    // sort_order is the row-number ordered alphabetically, in steps of 10
    // so the admin has room to insert items between others without a full
    // resequence.
    console.log('\n7. Seeding painter_catalog_brand_order from existing brands...');
    const [brandRows] = await pool.query(`
      SELECT DISTINCT TRIM(zim.zoho_brand) AS brand
        FROM products p
        JOIN pack_sizes ps ON ps.product_id = p.id AND ps.is_active = 1
        JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
       WHERE p.status = 'active'
         AND (zim.zoho_status = 'active' OR zim.zoho_status IS NULL)
         AND zim.zoho_brand IS NOT NULL
         AND TRIM(zim.zoho_brand) <> ''
       ORDER BY brand
    `);
    let bIdx = 0;
    for (const r of brandRows) {
      await pool.query(
        `INSERT IGNORE INTO painter_catalog_brand_order (brand, sort_order, is_hidden)
         VALUES (?, ?, 0)`,
        [r.brand, (bIdx + 1) * 10]
      );
      bIdx++;
    }
    console.log(`   ✓ seeded ${brandRows.length} brand row(s)`);

    console.log('8. Seeding painter_catalog_category_order from existing brand/category pairs...');
    const [catRows] = await pool.query(`
      SELECT DISTINCT TRIM(zim.zoho_brand) AS brand, TRIM(zim.zoho_category_name) AS category
        FROM products p
        JOIN pack_sizes ps ON ps.product_id = p.id AND ps.is_active = 1
        JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
       WHERE p.status = 'active'
         AND (zim.zoho_status = 'active' OR zim.zoho_status IS NULL)
         AND zim.zoho_brand IS NOT NULL
         AND TRIM(zim.zoho_brand) <> ''
         AND zim.zoho_category_name IS NOT NULL
         AND TRIM(zim.zoho_category_name) <> ''
       ORDER BY brand, category
    `);
    let lastBrand = null;
    let cIdx = 0;
    for (const r of catRows) {
      if (r.brand !== lastBrand) { cIdx = 0; lastBrand = r.brand; }
      cIdx++;
      await pool.query(
        `INSERT IGNORE INTO painter_catalog_category_order (brand, category, sort_order, is_hidden)
         VALUES (?, ?, ?, 0)`,
        [r.brand, r.category, cIdx * 10]
      );
    }
    console.log(`   ✓ seeded ${catRows.length} brand/category row(s)`);

    console.log('9. Seeding painter_catalog_product_order from existing products...');
    const [prodRows] = await pool.query(`
      SELECT p.id, p.name,
             MAX(TRIM(zim.zoho_brand))         AS brand,
             MAX(TRIM(zim.zoho_category_name)) AS category
        FROM products p
        JOIN pack_sizes ps ON ps.product_id = p.id AND ps.is_active = 1
        JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
       WHERE p.status = 'active'
         AND (zim.zoho_status = 'active' OR zim.zoho_status IS NULL)
       GROUP BY p.id, p.name
       ORDER BY brand, category, p.name
    `);
    let lastKey = null;
    let pIdx = 0;
    for (const r of prodRows) {
      const key = (r.brand || '') + '||' + (r.category || '');
      if (key !== lastKey) { pIdx = 0; lastKey = key; }
      pIdx++;
      await pool.query(
        `INSERT IGNORE INTO painter_catalog_product_order (product_id, sort_order, is_hidden)
         VALUES (?, ?, 0)`,
        [r.id, pIdx * 10]
      );
    }
    console.log(`   ✓ seeded ${prodRows.length} product row(s)`);

    try {
      await pool.query(
        "INSERT IGNORE INTO _migrations (filename, status) VALUES ('migrate-painter-catalog.js', 'success')"
      );
    } catch (_) {}

    console.log('\n✓ Painter catalog ordering + visibility schema ready.\n');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    if (pool) await pool.end();
  }
}

migrate();
