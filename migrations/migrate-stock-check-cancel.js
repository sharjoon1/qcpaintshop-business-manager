/**
 * Migration: Add 'cancelled' status to stock_check_assignments
 * Run: node migrations/migrate-stock-check-cancel.js
 */
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME,
        port: parseInt(process.env.DB_PORT, 10) || 3306
    });

    console.log('Adding cancelled status to stock_check_assignments...');

    await pool.query(`
        ALTER TABLE stock_check_assignments
        MODIFY COLUMN status ENUM('pending','submitted','reviewed','adjusted','cancelled') DEFAULT 'pending'
    `);
    console.log('✓ Added cancelled to status ENUM');

    const [cols] = await pool.query(`SHOW COLUMNS FROM stock_check_assignments LIKE 'cancelled_by'`);
    if (cols.length === 0) {
        await pool.query(`
            ALTER TABLE stock_check_assignments
            ADD COLUMN cancelled_by INT NULL DEFAULT NULL,
            ADD COLUMN cancelled_at DATETIME NULL DEFAULT NULL,
            ADD COLUMN cancel_reason VARCHAR(500) NULL DEFAULT NULL
        `);
        console.log('✓ Added cancelled_by, cancelled_at, cancel_reason columns');
    } else {
        console.log('- cancelled columns already exist');
    }

    // Also fix whatsapp_messages source column — ENUM too restrictive, change to VARCHAR
    const [srcCol] = await pool.query(`SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'whatsapp_messages' AND COLUMN_NAME = 'source'`);
    if (srcCol.length && srcCol[0].COLUMN_TYPE.startsWith('enum')) {
        await pool.query(`ALTER TABLE whatsapp_messages MODIFY COLUMN source VARCHAR(50) DEFAULT 'incoming'`);
        console.log('✓ Changed whatsapp_messages.source from ENUM to VARCHAR(50)');
    } else {
        console.log('- whatsapp_messages.source already VARCHAR');
    }

    console.log('Done!');
    await pool.end();
    process.exit(0);
}

migrate().catch(err => { console.error(err); process.exit(1); });
