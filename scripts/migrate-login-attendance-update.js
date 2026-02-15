/**
 * Migration: Login, Attendance & Branch Configuration Updates
 *
 * Changes:
 * 1. Convert shop_hours_config.day_of_week from tinyint to VARCHAR day names
 * 2. Update shop_hours_config open times to 08:30 (except Sunday)
 * 3. Add geo_fence_enabled column to users table
 * 4. Create user_branches table for multi-branch assignment
 * 5. Populate user_branches from existing users.branch_id
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
        console.log('Starting migration: login-attendance-update...\n');

        // 1. Convert day_of_week from tinyint to day name strings (idempotent)
        console.log('1. Converting shop_hours_config.day_of_week to day names...');
        const [colInfo] = await conn.query(
            `SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'shop_hours_config' AND COLUMN_NAME = 'day_of_week'`
        );

        if (colInfo.length > 0 && colInfo[0].DATA_TYPE === 'tinyint') {
            // Convert column to VARCHAR first
            await conn.query(`ALTER TABLE shop_hours_config MODIFY COLUMN day_of_week VARCHAR(10) NOT NULL`);

            // Map integer values to day names
            const dayMap = {
                '0': 'sunday', '1': 'monday', '2': 'tuesday', '3': 'wednesday',
                '4': 'thursday', '5': 'friday', '6': 'saturday'
            };
            for (const [num, name] of Object.entries(dayMap)) {
                const [r] = await conn.query(
                    `UPDATE shop_hours_config SET day_of_week = ? WHERE day_of_week = ?`,
                    [name, num]
                );
                if (r.affectedRows > 0) console.log(`   Converted ${num} -> ${name} (${r.affectedRows} rows)`);
            }
            console.log('   Column converted to day name strings\n');
        } else {
            console.log('   Column already uses string day names, skipping\n');
        }

        // 2. Update shop_hours_config open times to 08:30
        console.log('2. Updating shop_hours_config open times to 08:30...');
        const [shopResult] = await conn.query(
            `UPDATE shop_hours_config SET open_time = '08:30:00'`
        );
        console.log(`   Updated ${shopResult.affectedRows} rows\n`);

        // 3. Add geo_fence_enabled column to users
        console.log('3. Adding geo_fence_enabled column to users...');
        try {
            await conn.query(
                `ALTER TABLE users ADD COLUMN geo_fence_enabled BOOLEAN DEFAULT TRUE AFTER branch_id`
            );
            console.log('   Added column: geo_fence_enabled\n');
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log('   Column geo_fence_enabled already exists, skipping\n');
            } else {
                throw e;
            }
        }

        // 4. Create user_branches table
        console.log('4. Creating user_branches table...');
        try {
            await conn.query(`
                CREATE TABLE user_branches (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    branch_id INT NOT NULL,
                    is_primary BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY unique_user_branch (user_id, branch_id),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
                )
            `);
            console.log('   Created table: user_branches\n');
        } catch (e) {
            if (e.code === 'ER_TABLE_EXISTS_ERROR') {
                console.log('   Table user_branches already exists, skipping\n');
            } else {
                throw e;
            }
        }

        // 5. Populate user_branches from existing users.branch_id
        console.log('5. Populating user_branches from existing data...');
        const [populateResult] = await conn.query(`
            INSERT IGNORE INTO user_branches (user_id, branch_id, is_primary)
            SELECT id, branch_id, TRUE FROM users WHERE branch_id IS NOT NULL
        `);
        console.log(`   Inserted ${populateResult.affectedRows} rows\n`);

        // 6. Add clock_in_distance and clock_out_distance columns to staff_attendance
        console.log('6. Adding distance columns to staff_attendance...');
        for (const col of ['clock_in_distance', 'clock_out_distance']) {
            try {
                await conn.query(
                    `ALTER TABLE staff_attendance ADD COLUMN ${col} INT DEFAULT NULL`
                );
                console.log(`   Added column: ${col}`);
            } catch (e) {
                if (e.code === 'ER_DUP_FIELDNAME') {
                    console.log(`   Column ${col} already exists, skipping`);
                } else {
                    throw e;
                }
            }
        }
        console.log('');

        // 7. Add review_notes column to attendance_permissions
        console.log('7. Adding review_notes column to attendance_permissions...');
        try {
            await conn.query(
                `ALTER TABLE attendance_permissions ADD COLUMN review_notes TEXT DEFAULT NULL`
            );
            console.log('   Added column: review_notes\n');
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log('   Column review_notes already exists, skipping\n');
            } else {
                throw e;
            }
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
