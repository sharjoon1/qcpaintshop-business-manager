/**
 * Migration: Add Bank Details columns to users table
 * Run: node scripts/migrate-bank-details.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 5
    });

    try {
        console.log('Starting bank details migration...\n');

        const bankColumns = [
            { name: 'bank_account_name', def: 'VARCHAR(150) NULL' },
            { name: 'bank_name', def: 'VARCHAR(150) NULL' },
            { name: 'bank_account_number', def: 'VARCHAR(30) NULL' },
            { name: 'bank_ifsc_code', def: 'VARCHAR(11) NULL' },
            { name: 'upi_id', def: 'VARCHAR(100) NULL' }
        ];

        for (const col of bankColumns) {
            const [existing] = await pool.query(`
                SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = ?
            `, [process.env.DB_NAME, col.name]);

            if (existing.length === 0) {
                await pool.query(`ALTER TABLE users ADD COLUMN ${col.name} ${col.def}`);
                console.log(`✅ Added users.${col.name} column`);
            } else {
                console.log(`ℹ️  users.${col.name} already exists`);
            }
        }

        console.log('\n📊 Bank details migration complete!');

    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

migrate();
