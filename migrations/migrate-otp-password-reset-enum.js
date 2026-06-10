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
 *
 * Normalized to exports.up(pool) (D2, 2026-06-11) — requiring this file no longer runs it.
 */

exports.up = async function up(pool) {
    console.log("Adding 'Password Reset' to otp_verifications.purpose ENUM…");
    await pool.query(
        "ALTER TABLE otp_verifications MODIFY COLUMN purpose " +
        "ENUM('registration','login','forgot_password','Staff Registration','Password Reset') NOT NULL"
    );
    const [r] = await pool.query("SHOW COLUMNS FROM otp_verifications LIKE 'purpose'");
    console.log('   purpose now =', r[0].Type);
    console.log('✓ otp_verifications.purpose ENUM updated');
};

// Direct-run support (legacy usage: node migrations/migrate-otp-password-reset-enum.js)
if (require.main === module) {
    (async () => {
        require('dotenv').config();
        const { createPool } = require('../config/database');
        const pool = createPool();
        try {
            await exports.up(pool);
            console.log('Done.');
            process.exit(0);
        } catch (err) {
            console.error('Migration failed:', err.message);
            process.exit(1);
        }
    })();
}
