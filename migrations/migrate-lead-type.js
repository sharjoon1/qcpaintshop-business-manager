/**
 * Migration: Add lead_type column to leads table
 * Tracks what a lead was converted to: customer, painter, or engineer
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    console.log('Adding lead_type column to leads table...');

    try {
        // Check if column already exists
        const [cols] = await pool.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'lead_type'`,
            [process.env.DB_NAME]
        );

        if (cols.length === 0) {
            await pool.query(`
                ALTER TABLE leads
                ADD COLUMN lead_type ENUM('customer', 'painter', 'engineer') DEFAULT NULL
                AFTER customer_id
            `);
            console.log('Added lead_type column');
        } else {
            console.log('lead_type column already exists');
        }

        console.log('Migration complete!');
    } catch (error) {
        console.error('Migration error:', error);
    } finally {
        await pool.end();
    }
}

migrate();
