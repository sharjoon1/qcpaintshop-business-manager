const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'qc_admin',
    password: process.env.DB_PASSWORD || 'QC@dm1n2026!Secure',
    database: process.env.DB_NAME || 'qc_business_manager'
};

async function fixColumns() {
    let connection;

    try {
        console.log('🔌 Connecting to database...');
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Connected to database\n');

        console.log('📊 Adding missing columns to staff_attendance...\n');

        const columnsToAdd = [
            {
                name: 'total_working_minutes',
                sql: `ALTER TABLE staff_attendance ADD COLUMN total_working_minutes INT DEFAULT 0 COMMENT 'Total minutes worked (excluding breaks)' AFTER actual_hours`
            },
            {
                name: 'is_early_checkout',
                sql: `ALTER TABLE staff_attendance ADD COLUMN is_early_checkout BOOLEAN DEFAULT FALSE COMMENT 'Whether staff left before closing time' AFTER is_late`
            },
            {
                name: 'break_start_time',
                sql: `ALTER TABLE staff_attendance ADD COLUMN break_start_time DATETIME COMMENT 'When break started' AFTER clock_out_address`
            },
            {
                name: 'break_end_time',
                sql: `ALTER TABLE staff_attendance ADD COLUMN break_end_time DATETIME COMMENT 'When break ended' AFTER break_start_time`
            },
            {
                name: 'break_duration_minutes',
                sql: `ALTER TABLE staff_attendance ADD COLUMN break_duration_minutes INT DEFAULT 0 COMMENT 'Total break duration in minutes' AFTER break_end_time`
            }
        ];

        for (let i = 0; i < columnsToAdd.length; i++) {
            const col = columnsToAdd[i];
            console.log(`${i + 1}. Adding ${col.name}...`);

            try {
                await connection.query(col.sql);
                console.log(`   ✓ ${col.name} added`);
            } catch (error) {
                if (error.code === 'ER_DUP_FIELDNAME') {
                    console.log(`   ⚠️ ${col.name} already exists (skipped)`);
                } else {
                    throw error;
                }
            }
            console.log('');
        }

        console.log('\n🎉 All missing columns added successfully!');
        console.log('\n📋 Next steps:');
        console.log('  1. Server should auto-reload (if using nodemon)');
        console.log('  2. Try clocking out again');
        console.log('  3. Clock-out should now work!');

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log('\n🔌 Database connection closed');
        }
    }
}

fixColumns();
