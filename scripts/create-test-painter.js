/**
 * Create test painter account for Play Store reviewer
 * Usage: node scripts/create-test-painter.js
 *
 * Test Account:
 *   Phone: 9999999999
 *   OTP: 123456 (fixed, always works)
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

async function createTestPainter() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'business_manager'
    });

    try {
        const phone = '9999999999';
        const fullName = 'Test Painter';
        const city = 'Chennai';
        const referralCode = 'TEST' + Date.now().toString(36).toUpperCase();

        // Check if test painter exists
        const [existing] = await pool.query('SELECT id, status FROM painters WHERE phone = ?', [phone]);

        if (existing.length) {
            // Update to approved status
            await pool.query(
                'UPDATE painters SET status = ?, full_name = ? WHERE phone = ?',
                ['approved', fullName, phone]
            );
            console.log(`✅ Test painter updated (ID: ${existing[0].id})`);
        } else {
            // Create new
            const [result] = await pool.query(
                `INSERT INTO painters (full_name, phone, city, status, referral_code, created_at)
                 VALUES (?, ?, ?, 'approved', ?, NOW())`,
                [fullName, phone, city, referralCode]
            );
            console.log(`✅ Test painter created (ID: ${result.insertId})`);
        }

        console.log('\n📱 Play Store Reviewer Instructions:');
        console.log('   1. Open QC Painters app');
        console.log('   2. Enter phone: 9999999999');
        console.log('   3. Enter OTP: 123456');
        console.log('   4. Dashboard loads with test data\n');

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

createTestPainter();
