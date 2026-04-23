require('dotenv').config();
const { createPool } = require('../config/database');
const pool = createPool();

(async () => {
    try {
        const [prods] = await pool.query("SELECT COUNT(*) as cnt FROM products WHERE status = 'active'");
        console.log('Active products in Products tab:', prods[0].cnt);

        const [catalog] = await pool.query(
            "SELECT COUNT(*) as cnt FROM zoho_items_map zim " +
            "INNER JOIN pack_sizes ps ON ps.zoho_item_id = zim.zoho_item_id AND ps.is_active = 1 " +
            "INNER JOIN products p ON p.id = ps.product_id AND p.status = 'active' " +
            "WHERE (zim.zoho_status = 'active' OR zim.zoho_status IS NULL)"
        );
        console.log('Catalog items (with products join):', catalog[0].cnt);

        const [allMapped] = await pool.query(
            "SELECT COUNT(*) as cnt FROM zoho_items_map zim " +
            "INNER JOIN pack_sizes ps ON ps.zoho_item_id = zim.zoho_item_id AND ps.is_active = 1 " +
            "WHERE (zim.zoho_status = 'active' OR zim.zoho_status IS NULL)"
        );
        console.log('All mapped items (no products filter):', allMapped[0].cnt);

        const [prodList] = await pool.query("SELECT id, name, status FROM products WHERE status = 'active' ORDER BY name");
        console.log('\nProducts list:');
        prodList.forEach(p => console.log('  ', p.id, p.name, p.status));

        const [catItems] = await pool.query(
            "SELECT zim.zoho_item_id, zim.zoho_item_name, zim.zoho_brand, p.name as product_name " +
            "FROM zoho_items_map zim " +
            "INNER JOIN pack_sizes ps ON ps.zoho_item_id = zim.zoho_item_id AND ps.is_active = 1 " +
            "INNER JOIN products p ON p.id = ps.product_id AND p.status = 'active' " +
            "WHERE (zim.zoho_status = 'active' OR zim.zoho_status IS NULL) " +
            "ORDER BY p.name, zim.zoho_item_name"
        );
        console.log('\nCatalog items:');
        catItems.forEach(c => console.log('  ', c.product_name, '|', c.zoho_item_name, '|', c.zoho_brand));

        // Check: any pack_sizes without products join?
        const [orphans] = await pool.query(
            "SELECT ps.id, ps.zoho_item_id, ps.product_id, ps.is_active, p.status as prod_status, p.name as prod_name " +
            "FROM pack_sizes ps " +
            "LEFT JOIN products p ON p.id = ps.product_id " +
            "WHERE ps.is_active = 1 AND (p.status != 'active' OR p.id IS NULL)"
        );
        console.log('\nOrphaned active pack_sizes (no active product):', orphans.length);
        orphans.forEach(o => console.log('  ', o.id, o.zoho_item_id, 'product:', o.product_id, o.prod_status, o.prod_name));

        process.exit();
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
})();
