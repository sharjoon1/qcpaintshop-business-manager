const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'qc_admin',
    password: process.env.DB_PASSWORD || 'QC@dm1n2026!Secure',
    database: process.env.DB_NAME || 'qc_business_manager'
};

async function checkColumns() {
    let connection;

    try {
        console.log('🔌 Connecting to database...');
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Connected\n');

        // Get current columns
        const [columns] = await connection.query(
            `SELECT COLUMN_NAME, DATA_TYPE
             FROM information_schema.columns
             WHERE table_schema = ? AND table_name = 'staff_attendance'
             ORDER BY ORDINAL_POSITION`,
            [dbConfig.database]
        );

        console.log('📊 Current columns in staff_attendance:');
        const columnNames = columns.map(c => c.COLUMN_NAME);
        columns.forEach(col => {
            console.log(`  - ${col.COLUMN_NAME} (${col.DATA_TYPE})`);
        });

        // Check for required columns
        const requiredColumns = [
            'total_working_minutes',
            'is_early_checkout',
            'break_start_time',
            'break_end_time',
            'break_duration_minutes'
        ];

        console.log('\n🔍 Checking required columns:');
        const missingColumns = [];
        requiredColumns.forEach(col => {
            if (columnNames.includes(col)) {
                console.log(`  ✓ ${col} - EXISTS`);
            } else {
                console.log(`  ❌ ${col} - MISSING!`);
                missingColumns.push(col);
            }
        });

        if (missingColumns.length > 0) {
            console.log('\n⚠️ Missing columns detected!');
            console.log('Run fix-attendance-columns.js to add them.');
        } else {
            console.log('\n✅ All required columns exist!');
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log('\n🔌 Database connection closed');
        }
    }
}

checkColumns();
