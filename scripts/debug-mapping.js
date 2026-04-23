require('dotenv').config();
const { createPool } = require('../config/database');
const pool = createPool();

(async () => {
  try {
    // Check 1: Zoho items with AJAX
    const [items] = await pool.query("SELECT zoho_item_id, zoho_item_name, zoho_status FROM zoho_items_map WHERE zoho_item_name LIKE '%AJAX%' LIMIT 10");
    console.log('Zoho items with AJAX:', JSON.stringify(items, null, 2));

    // Check 2: mapped-zoho-ids (active products only)
    const [mapped] = await pool.query(
      "SELECT DISTINCT ps.zoho_item_id FROM pack_sizes ps INNER JOIN products p ON p.id = ps.product_id AND p.status = 'active' WHERE ps.zoho_item_id IS NOT NULL AND ps.zoho_item_id != '' AND ps.is_active = 1"
    );
    console.log('\nMapped IDs (active products):', mapped.length, JSON.stringify(mapped));

    // Check 3: orphaned pack_sizes
    const [orphaned] = await pool.query(
      "SELECT ps.id, ps.zoho_item_id, ps.is_active, ps.product_id, p.status as product_status, p.name as product_name FROM pack_sizes ps LEFT JOIN products p ON p.id = ps.product_id WHERE ps.zoho_item_id IS NOT NULL AND ps.zoho_item_id != ''"
    );
    console.log('\nAll pack_sizes with zoho mappings:', JSON.stringify(orphaned, null, 2));

    // Check 4: active products
    const [products] = await pool.query("SELECT id, name, status FROM products");
    console.log('\nAll products:', JSON.stringify(products, null, 2));

    // Check 5: zoho search test - what does the search return for "150 AJAX"?
    const [searchResults] = await pool.query(
      "SELECT zoho_item_id, zoho_item_name, zoho_brand, zoho_rate, zoho_sku FROM zoho_items_map WHERE (zoho_status = 'active' OR zoho_status IS NULL) AND (zoho_item_name LIKE ? OR zoho_brand LIKE ? OR zoho_sku LIKE ?) ORDER BY zoho_brand, zoho_item_name LIMIT 50",
      ['%150 AJAX%', '%150 AJAX%', '%150 AJAX%']
    );
    console.log('\nSearch "150 AJAX":', JSON.stringify(searchResults, null, 2));

    // Check 6: search with just "AJAX"
    const [searchResults2] = await pool.query(
      "SELECT zoho_item_id, zoho_item_name, zoho_brand, zoho_rate, zoho_sku FROM zoho_items_map WHERE (zoho_status = 'active' OR zoho_status IS NULL) AND (zoho_item_name LIKE ? OR zoho_brand LIKE ? OR zoho_sku LIKE ?) ORDER BY zoho_brand, zoho_item_name LIMIT 50",
      ['%AJAX%', '%AJAX%', '%AJAX%']
    );
    console.log('\nSearch "AJAX":', JSON.stringify(searchResults2, null, 2));

    process.exit();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
