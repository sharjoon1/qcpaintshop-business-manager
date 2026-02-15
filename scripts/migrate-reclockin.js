/**
 * Migration: Add allow_reclockin column to staff_attendance
 *
 * Enables the re-clock-in workflow where admin can approve
 * staff to clock in again after clocking out (for overtime).
 */

const mysql = require('mysql2/promise');
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
        console.log('Starting migration: reclockin...\n');

        // 1. Add allow_reclockin column to staff_attendance
        console.log('1. Checking staff_attendance.allow_reclockin column...');
        const [cols] = await conn.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staff_attendance' AND COLUMN_NAME = 'allow_reclockin'`
        );

        if (cols.length === 0) {
            await conn.query(
                `ALTER TABLE staff_attendance ADD COLUMN allow_reclockin TINYINT DEFAULT 0`
            );
            console.log('   Added allow_reclockin column\n');
        } else {
            console.log('   Column already exists, skipping\n');
        }

        // 2. Verify attendance_permissions supports re_clockin request_type
        console.log('2. Checking attendance_permissions.request_type...');
        const [typeCol] = await conn.query(
            `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_permissions' AND COLUMN_NAME = 'request_type'`
        );

        if (typeCol.length > 0) {
            const colType = typeCol[0].COLUMN_TYPE;
            console.log(`   Current type: ${colType}`);

            if (colType.includes('enum') || colType.includes('ENUM')) {
                if (!colType.includes('re_clockin')) {
                    // It's an ENUM, need to add re_clockin
                    // Extract existing values and add re_clockin
                    const values = colType.match(/'([^']+)'/g).map(v => v.replace(/'/g, ''));
                    values.push('re_clockin');
                    const newEnum = values.map(v => `'${v}'`).join(',');
                    await conn.query(
                        `ALTER TABLE attendance_permissions MODIFY COLUMN request_type ENUM(${newEnum}) NOT NULL`
                    );
                    console.log('   Updated ENUM to include re_clockin\n');
                } else {
                    console.log('   ENUM already includes re_clockin\n');
                }
            } else {
                // VARCHAR - no change needed, accepts any string
                console.log('   Column is VARCHAR, no change needed\n');
            }
        } else {
            console.log('   attendance_permissions.request_type column not found\n');
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
