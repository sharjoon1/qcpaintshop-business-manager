const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');

async function migrate() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });

    await connection.execute(`
        CREATE TABLE IF NOT EXISTS admin_notifications (
            id INT PRIMARY KEY AUTO_INCREMENT,
            title VARCHAR(200) NOT NULL,
            body TEXT NOT NULL,
            image_url VARCHAR(500) DEFAULT NULL,
            type ENUM('info','offer') NOT NULL DEFAULT 'info',
            offer_url VARCHAR(500) DEFAULT NULL,
            audience_type ENUM('all','branch','level','city','specific') NOT NULL DEFAULT 'all',
            audience_value JSON DEFAULT NULL,
            reach_count INT NOT NULL DEFAULT 0,
            sent_at DATETIME NOT NULL,
            created_by INT NOT NULL,
            INDEX idx_sent_at (sent_at),
            INDEX idx_type (type)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const dir = path.join(__dirname, '..', 'public/uploads/admin-notif-images');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    console.log('[migrate-admin-notifications] Done');
    await connection.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
