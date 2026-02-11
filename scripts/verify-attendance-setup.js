const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'qc_admin',
    password: process.env.DB_PASSWORD || 'QC@dm1n2026!Secure',
    database: process.env.DB_NAME || 'qc_business_manager'
};

async function verifyAttendanceSetup() {
    let connection;

    try {
        console.log('🔌 Connecting to database...');
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Connected to database\n');

        // Check required tables
        const requiredTables = [
            'staff_attendance',
            'attendance_photos',
            'attendance_permissions',
            'shop_hours_config',
            'branches',
            'users'
        ];

        console.log('📋 Checking required tables...');
        for (const table of requiredTables) {
            const [rows] = await connection.query(
                `SELECT COUNT(*) as count FROM information_schema.tables
                 WHERE table_schema = ? AND table_name = ?`,
                [dbConfig.database, table]
            );

            if (rows[0].count > 0) {
                console.log(`  ✓ ${table} - EXISTS`);

                // Get row count
                const [countRows] = await connection.query(`SELECT COUNT(*) as count FROM ${table}`);
                console.log(`    Records: ${countRows[0].count}`);
            } else {
                console.log(`  ❌ ${table} - MISSING!`);
            }
        }

        // Check staff_attendance table structure
        console.log('\n📊 Checking staff_attendance table structure...');
        const [columns] = await connection.query(
            `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
             FROM information_schema.columns
             WHERE table_schema = ? AND table_name = 'staff_attendance'
             ORDER BY ORDINAL_POSITION`,
            [dbConfig.database]
        );

        if (columns.length > 0) {
            console.log('  Columns:');
            columns.forEach(col => {
                console.log(`    - ${col.COLUMN_NAME} (${col.DATA_TYPE}) ${col.IS_NULLABLE === 'NO' ? 'NOT NULL' : 'NULL'}`);
            });
        } else {
            console.log('  ⚠️ Table structure not found');
        }

        // Check uploads directory
        console.log('\n📁 Checking uploads directory...');
        const fs = require('fs');
        const path = require('path');

        const uploadsDir = path.join(__dirname, 'uploads', 'attendance');
        if (fs.existsSync(uploadsDir)) {
            console.log(`  ✓ ${uploadsDir} - EXISTS`);
            const files = fs.readdirSync(uploadsDir);
            console.log(`    Files: ${files.length}`);
        } else {
            console.log(`  ❌ ${uploadsDir} - MISSING!`);
            console.log('    Creating directory...');
            fs.mkdirSync(uploadsDir, { recursive: true });
            console.log('  ✓ Directory created');
        }

        // Check for today's attendance records
        console.log('\n📅 Checking today\'s attendance records...');
        const today = new Date().toISOString().split('T')[0];
        const [todayRecords] = await connection.query(
            'SELECT user_id, clock_in_time FROM staff_attendance WHERE date = ?',
            [today]
        );

        if (todayRecords.length > 0) {
            console.log(`  Found ${todayRecords.length} attendance record(s) for today:`);
            todayRecords.forEach(record => {
                console.log(`    - User ID: ${record.user_id}, Clock In: ${record.clock_in_time}`);
            });
        } else {
            console.log('  No attendance records for today');
        }

        // Check shop hours configuration
        console.log('\n⏰ Checking shop hours configuration...');
        const [shopHours] = await connection.query(
            'SELECT branch_id, day_of_week, open_time, close_time FROM shop_hours_config LIMIT 5'
        );

        if (shopHours.length > 0) {
            console.log(`  ✓ Found ${shopHours.length} shop hours configurations`);
            shopHours.forEach(sh => {
                console.log(`    - Branch ${sh.branch_id}, Day ${sh.day_of_week}: ${sh.open_time} - ${sh.close_time}`);
            });
        } else {
            console.log('  ⚠️ No shop hours configured');
        }

        // Check branches
        console.log('\n🏢 Checking branches...');
        const [branches] = await connection.query('SELECT id, name, latitude, longitude FROM branches');

        if (branches.length > 0) {
            console.log(`  ✓ Found ${branches.length} branch(es)`);
            branches.forEach(branch => {
                console.log(`    - ID: ${branch.id}, Name: ${branch.name}, GPS: ${branch.latitude}, ${branch.longitude}`);
            });
        } else {
            console.log('  ⚠️ No branches found');
        }

        console.log('\n✅ Verification complete!');

    } catch (error) {
        console.error('❌ Verification error:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log('\n🔌 Database connection closed');
        }
    }
}

// Run the verification
verifyAttendanceSetup();
