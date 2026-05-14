/**
 * Add 'Password Reset' to otp_verifications.purpose ENUM.
 *
 * The mobile-OTP forgot-password flow (server.js /api/auth/forgot-password-mobile
 * + public/forgot-password.html) sends OTPs with purpose='Password Reset'. The
 * existing ENUM only listed 'registration','login','forgot_password','Staff
 * Registration' so MySQL strict mode rejected the INSERT with "Data truncated
 * for column 'purpose'", surfacing as "Failed to send OTP" in the UI.
 *
 * This migration extends the ENUM. Existing rows are untouched.
 *
 * Already applied directly to prod 2026-05-14 (see [[reference_prod_migrations_gap]]),
 * so on prod this migration just needs to be marked applied. Other environments
 * (dev / new clones) will run it normally.
 */
require('dotenv').config();
const { createPool } = require('../config/database');

(async () => {
    const pool = createPool();
    try {
        console.log("Adding 'Password Reset' to otp_verifications.purpose ENUM…");
        await pool.query(
            "ALTER TABLE otp_verifications MODIFY COLUMN purpose " +
            "ENUM('registration','login','forgot_password','Staff Registration','Password Reset') NOT NULL"
        );
        const [r] = await pool.query("SHOW COLUMNS FROM otp_verifications LIKE 'purpose'");
        console.log('   purpose now =', r[0].Type);
        console.log('✓ otp_verifications.purpose ENUM updated');
    } catch (err) {
        console.error('Migration failed:', err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();
