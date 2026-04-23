require('dotenv').config();
const mysql = require('mysql2/promise');
(async () => {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST, user: process.env.DB_USER,
        password: process.env.DB_PASSWORD, database: process.env.DB_NAME
    });
    const [result] = await pool.query(
        "UPDATE products SET image_url = CONCAT('/uploads/products/product-', id, '.jpg') WHERE status = 'active'"
    );
    console.log('Reset', result.affectedRows, 'products to placeholder');
    const [r2] = await pool.query(
        `UPDATE zoho_items_map zim
         JOIN pack_sizes ps ON ps.zoho_item_id = zim.zoho_item_id
         JOIN products p ON p.id = ps.product_id AND p.status = 'active'
         SET zim.image_url = p.image_url`
    );
    console.log('Reset', r2.affectedRows, 'zoho_items_map rows');
    await pool.end();
})();
