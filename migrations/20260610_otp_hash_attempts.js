/**
 * S2 — hash OTPs at rest + per-OTP attempt counters.
 *
 * 1. Widens the OTP columns to VARCHAR(64) so they can hold sha256 hex.
 * 2. Adds an attempt counter per store (wrong-guess cap enforced in code,
 *    MAX_OTP_ATTEMPTS in services/otp-utils.js).
 * 3. Converts any existing plaintext OTPs in place via SQL SHA2(otp, 256) —
 *    services/otp-utils.js hashOtp() produces the identical format, so
 *    in-flight OTPs keep working across the deploy and no plaintext remains.
 *
 * All steps are additive/idempotent (information_schema-guarded); safe to
 * re-run. ALTERs are metadata/inplace-class changes on small tables.
 */

async function columnType(pool, table, column) {
    const [rows] = await pool.query(
        `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
    );
    return rows.length ? String(rows[0].COLUMN_TYPE) : null;
}

exports.up = async function up(pool) {
    const stores = [
        { table: 'otp_verifications', otpCol: 'otp', attemptsCol: 'attempts' },
        { table: 'painter_sessions', otpCol: 'otp', attemptsCol: 'otp_attempts' },
        { table: 'engineer_sessions', otpCol: 'otp', attemptsCol: 'otp_attempts' },
    ];

    for (const { table, otpCol, attemptsCol } of stores) {
        const otpType = await columnType(pool, table, otpCol);
        if (!otpType) {
            console.log(`  [skip] ${table}.${otpCol} not found`);
            continue;
        }

        const width = /varchar\((\d+)\)/i.exec(otpType);
        if (!width || parseInt(width[1], 10) < 64) {
            await pool.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${otpCol}\` VARCHAR(64) NULL`);
            console.log(`  ✓ ${table}.${otpCol} → VARCHAR(64)`);
        }

        if (!(await columnType(pool, table, attemptsCol))) {
            await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${attemptsCol}\` INT NOT NULL DEFAULT 0`);
            console.log(`  ✓ ${table}.${attemptsCol} added`);
        }

        // Convert remaining plaintext values (anything shorter than 64 chars).
        // SHA2(x,256) === otp-utils hashOtp(x), so unexpired OTPs stay valid.
        const [r] = await pool.query(
            `UPDATE \`${table}\` SET \`${otpCol}\` = SHA2(\`${otpCol}\`, 256)
             WHERE \`${otpCol}\` IS NOT NULL AND CHAR_LENGTH(\`${otpCol}\`) < 64`
        );
        if (r.affectedRows) console.log(`  ✓ ${table}: ${r.affectedRows} plaintext OTP(s) hashed in place`);
    }
};

// Direct-run support for prod (where `node migrate.js` can't be blind-run —
// the pre-2026-04-30 _migrations gap). Usage:
//   node migrations/20260610_otp_hash_attempts.js
//   then: INSERT IGNORE INTO _migrations (name) VALUES ('20260610_otp_hash_attempts.js');
// migrate.js require()s this file and only calls exports.up — this block
// stays inert under the runner (require.main !== module).
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
