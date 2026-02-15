/**
 * MIGRATION: Staff Upgrade - PAN Card & KYC Status
 * Adds PAN number, PAN proof, and KYC status fields to users and staff_registrations tables.
 *
 * Run: node scripts/migrate-staff-upgrade.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'qcpaintshop',
        waitForConnections: true,
        connectionLimit: 2
    });

    try {
        console.log('Starting staff upgrade migration...\n');

        // Check if columns already exist before adding
        const [userCols] = await pool.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'`,
            [process.env.DB_NAME || 'qcpaintshop']
        );
        const existingUserCols = userCols.map(c => c.COLUMN_NAME);

        const [regCols] = await pool.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'staff_registrations'`,
            [process.env.DB_NAME || 'qcpaintshop']
        );
        const existingRegCols = regCols.map(c => c.COLUMN_NAME);

        // 1. Add PAN number to users
        if (!existingUserCols.includes('pan_number')) {
            await pool.query(`ALTER TABLE users ADD COLUMN pan_number VARCHAR(10) NULL AFTER aadhar_proof_url`);
            console.log('  + users.pan_number added');
        } else {
            console.log('  ~ users.pan_number already exists');
        }

        // 2. Add PAN proof URL to users
        if (!existingUserCols.includes('pan_proof_url')) {
            await pool.query(`ALTER TABLE users ADD COLUMN pan_proof_url VARCHAR(500) NULL AFTER pan_number`);
            console.log('  + users.pan_proof_url added');
        } else {
            console.log('  ~ users.pan_proof_url already exists');
        }

        // 3. Add KYC status to users
        if (!existingUserCols.includes('kyc_status')) {
            await pool.query(`ALTER TABLE users ADD COLUMN kyc_status ENUM('incomplete','complete','verified') DEFAULT 'incomplete' AFTER pan_proof_url`);
            console.log('  + users.kyc_status added');
        } else {
            console.log('  ~ users.kyc_status already exists');
        }

        // 4. Add PAN number to staff_registrations
        if (!existingRegCols.includes('pan_number')) {
            await pool.query(`ALTER TABLE staff_registrations ADD COLUMN pan_number VARCHAR(10) NULL AFTER aadhar_proof_url`);
            console.log('  + staff_registrations.pan_number added');
        } else {
            console.log('  ~ staff_registrations.pan_number already exists');
        }

        // 5. Add PAN proof URL to staff_registrations
        if (!existingRegCols.includes('pan_proof_url')) {
            await pool.query(`ALTER TABLE staff_registrations ADD COLUMN pan_proof_url VARCHAR(500) NULL AFTER pan_number`);
            console.log('  + staff_registrations.pan_proof_url added');
        } else {
            console.log('  ~ staff_registrations.pan_proof_url already exists');
        }

        // 6. Compute initial KYC status for existing users
        await pool.query(`
            UPDATE users SET kyc_status = CASE
                WHEN aadhar_number IS NOT NULL AND aadhar_proof_url IS NOT NULL
                     AND pan_number IS NOT NULL AND pan_proof_url IS NOT NULL
                     AND bank_account_number IS NOT NULL AND bank_ifsc_code IS NOT NULL THEN 'complete'
                ELSE 'incomplete'
            END
            WHERE kyc_status = 'incomplete' OR kyc_status IS NULL
        `);
        console.log('  + Computed initial KYC status for existing users');

        console.log('\nMigration completed successfully!');
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

migrate();
