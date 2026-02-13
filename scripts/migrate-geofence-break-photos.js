/**
 * Migration: Geo-fence, Break Photos & Staff Salary Permission
 *
 * Changes:
 * 1. ALTER staff_attendance: add break photo and GPS columns
 * 2. CREATE TABLE geofence_violations
 * 3. INSERT salary.view permission for staff role
 * 4. Sync branches.geo_fence_radius = branches.geo_fence_radius_meters
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
        console.log('Starting migration: geofence-break-photos...\n');

        // 1. Add break photo and GPS columns to staff_attendance
        console.log('1. Adding break photo/GPS columns to staff_attendance...');
        const breakColumns = [
            { name: 'break_start_photo', def: 'VARCHAR(500) DEFAULT NULL' },
            { name: 'break_end_photo', def: 'VARCHAR(500) DEFAULT NULL' },
            { name: 'break_start_lat', def: 'DECIMAL(10,8) DEFAULT NULL' },
            { name: 'break_start_lng', def: 'DECIMAL(11,8) DEFAULT NULL' },
            { name: 'break_end_lat', def: 'DECIMAL(10,8) DEFAULT NULL' },
            { name: 'break_end_lng', def: 'DECIMAL(11,8) DEFAULT NULL' }
        ];

        for (const col of breakColumns) {
            try {
                await conn.query(`ALTER TABLE staff_attendance ADD COLUMN ${col.name} ${col.def}`);
                console.log(`   Added column: ${col.name}`);
            } catch (e) {
                if (e.code === 'ER_DUP_FIELDNAME') {
                    console.log(`   Column ${col.name} already exists, skipping`);
                } else {
                    throw e;
                }
            }
        }

        // 2. Create geofence_violations table
        console.log('\n2. Creating geofence_violations table...');
        await conn.query(`
            CREATE TABLE IF NOT EXISTS geofence_violations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                branch_id INT NOT NULL,
                latitude DECIMAL(10,8) NOT NULL,
                longitude DECIMAL(11,8) NOT NULL,
                distance_from_fence INT NOT NULL,
                fence_radius INT NOT NULL,
                violation_type ENUM('left_area', 'returned') NOT NULL DEFAULT 'left_area',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_user_id (user_id),
                INDEX idx_branch_id (branch_id),
                INDEX idx_created_at (created_at),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
            )
        `);
        console.log('   geofence_violations table ready');

        // 3. Insert salary.view permission for staff role
        console.log('\n3. Adding salary.view permission for staff role...');
        try {
            // Find the staff role ID
            const [roles] = await conn.query("SELECT id FROM roles WHERE name = 'staff' LIMIT 1");
            if (roles.length > 0) {
                const staffRoleId = roles[0].id;
                // Check if already exists
                const [existing] = await conn.query(
                    "SELECT id FROM role_permissions WHERE role_id = ? AND module = 'salary' AND action = 'view'",
                    [staffRoleId]
                );
                if (existing.length === 0) {
                    await conn.query(
                        "INSERT INTO role_permissions (role_id, module, action) VALUES (?, 'salary', 'view')",
                        [staffRoleId]
                    );
                    console.log(`   Added salary.view permission for staff role (role_id: ${staffRoleId})`);
                } else {
                    console.log('   salary.view permission already exists for staff role');
                }
            } else {
                console.log('   WARNING: No "staff" role found in roles table. Skipping permission insert.');
            }
        } catch (e) {
            console.log(`   Note: Could not add permission - ${e.message}`);
        }

        // 4. Sync geo_fence_radius with geo_fence_radius_meters
        console.log('\n4. Syncing geo_fence_radius columns...');
        try {
            // First ensure geo_fence_radius column exists
            try {
                await conn.query('ALTER TABLE branches ADD COLUMN geo_fence_radius INT DEFAULT 500');
                console.log('   Added geo_fence_radius column to branches');
            } catch (e) {
                if (e.code === 'ER_DUP_FIELDNAME') {
                    console.log('   geo_fence_radius column already exists');
                } else {
                    throw e;
                }
            }

            // Sync values from geo_fence_radius_meters to geo_fence_radius
            const [result] = await conn.query(
                'UPDATE branches SET geo_fence_radius = geo_fence_radius_meters WHERE geo_fence_radius_meters IS NOT NULL AND geo_fence_radius_meters > 0'
            );
            console.log(`   Synced ${result.affectedRows} branch(es) geo_fence_radius values`);
        } catch (e) {
            console.log(`   Note: Column sync - ${e.message}`);
        }

        console.log('\n--- Migration complete! ---');

    } catch (error) {
        console.error('\nMigration failed:', error.message);
        throw error;
    } finally {
        conn.release();
        await pool.end();
    }
}

migrate().catch(err => {
    console.error(err);
    process.exit(1);
});
