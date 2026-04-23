require('dotenv').config();
const mysql = require('mysql2/promise');
(async () => {
    const pool = await mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
    const [[r1]] = await pool.query("SELECT COUNT(*) as c FROM products WHERE status = 'active'");
    const [[r2]] = await pool.query("SELECT COUNT(*) as c FROM products WHERE status = 'active' AND image_url IS NOT NULL AND image_url != ''");
    const [[r3]] = await pool.query("SELECT COUNT(*) as c FROM products WHERE status = 'active' AND image_url LIKE '/uploads/products/product-%'");
    console.log('Active products:', r1.c);
    console.log('With any image:', r2.c);
    console.log('Placeholder images:', r3.c);
    console.log('Real images:', r2.c - r3.c);
    console.log('No image:', r1.c - r2.c);
    const [samples] = await pool.query("SELECT p.id, p.name, b.name as brand FROM products p LEFT JOIN brands b ON b.id = p.brand_id WHERE p.status = 'active' AND (p.image_url IS NULL OR p.image_url = '' OR p.image_url LIKE '/uploads/products/product-%') ORDER BY b.name, p.name");
    console.log('\nProducts needing real images (' + samples.length + '):');
    samples.forEach(s => console.log('  [' + (s.brand||'?') + '] ' + s.name + ' (id:' + s.id + ')'));
    await pool.end();
})();
