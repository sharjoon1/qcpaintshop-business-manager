/**
 * Migration: Fix attendance_photos ENUM + Generate VAPID keys
 *
 * Changes:
 * 1. Add 'break_start' and 'break_end' to attendance_photos.photo_type ENUM
 * 2. Generate VAPID keys for Web Push (if not already set)
 */

const mysql = require('mysql2/promise');
const webPush = require('web-push');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function migrate() {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'qcpaintshop',
        waitForConnections: true,
        connectionLimit: 5
    });

    const conn = await pool.getConnection();

    try {
        console.log('Starting migration: fix-break-enum...\n');

        // 1. Fix attendance_photos.photo_type ENUM
        console.log('1. Checking attendance_photos.photo_type ENUM...');
        const [colInfo] = await conn.query(
            `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_photos' AND COLUMN_NAME = 'photo_type'`
        );

        if (colInfo.length > 0) {
            const currentType = colInfo[0].COLUMN_TYPE;
            console.log(`   Current type: ${currentType}`);

            if (!currentType.includes('break_start')) {
                await conn.query(
                    `ALTER TABLE attendance_photos MODIFY COLUMN photo_type ENUM('clock_in','clock_out','break_start','break_end') NOT NULL`
                );
                console.log('   Updated ENUM to include break_start and break_end\n');
            } else {
                console.log('   ENUM already includes break values, skipping\n');
            }
        } else {
            console.log('   attendance_photos table or photo_type column not found\n');
        }

        // 2. Generate VAPID keys if not set
        console.log('2. Checking VAPID keys...');
        if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
            console.log('   VAPID keys already set in .env\n');
        } else {
            const vapidKeys = webPush.generateVAPIDKeys();
            console.log('   Generated new VAPID keys:');
            console.log(`   VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
            console.log(`   VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`);
            console.log(`   VAPID_EMAIL=info@qcpaintshop.com`);
            console.log('');

            // Append to .env file
            const envPath = path.join(__dirname, '..', '.env');
            const envLines = [
                '',
                '# Web Push VAPID keys (auto-generated)',
                `VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`,
                `VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`,
                `VAPID_EMAIL=info@qcpaintshop.com`
            ].join('\n');

            fs.appendFileSync(envPath, envLines + '\n');
            console.log('   Appended VAPID keys to .env\n');
        }

        console.log('Migration completed successfully!');

    } catch (error) {
        console.error('Migration failed:', error);
        throw error;
    } finally {
        conn.release();
        await pool.end();
    }
}

migrate().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
