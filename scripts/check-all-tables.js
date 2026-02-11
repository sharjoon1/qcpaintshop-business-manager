const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'qc_admin',
    password: process.env.DB_PASSWORD || 'QC@dm1n2026!Secure',
    database: process.env.DB_NAME || 'qc_business_manager'
};

async function checkAllTables() {
    let connection;

    try {
        console.log('🔌 Connecting to database...');
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Connected to database\n');

        // Get all tables
        const [tables] = await connection.query(
            `SELECT table_name, table_rows, data_length, index_length
             FROM information_schema.tables
             WHERE table_schema = ?
             ORDER BY table_name`,
            [dbConfig.database]
        );

        console.log('📊 All Tables in Database:\n');
        console.log('┌─────────────────────────────────────┬──────────┬──────────────┬──────────────┐');
        console.log('│ Table Name                          │ Rows     │ Data Size    │ Index Size   │');
        console.log('├─────────────────────────────────────┼──────────┼──────────────┼──────────────┤');

        tables.forEach(table => {
            const name = (table.table_name || table.TABLE_NAME || '').padEnd(35);
            const rows = String(table.table_rows || table.TABLE_ROWS || 0).padStart(8);
            const dataSize = formatBytes(table.data_length || table.DATA_LENGTH || 0).padStart(12);
            const indexSize = formatBytes(table.index_length || table.INDEX_LENGTH || 0).padStart(12);
            console.log(`│ ${name} │ ${rows} │ ${dataSize} │ ${indexSize} │`);
        });

        console.log('└─────────────────────────────────────┴──────────┴──────────────┴──────────────┘');
        console.log(`\n📈 Total Tables: ${tables.length}`);

        // Tables that should exist
        const requiredTables = [
            'users', 'roles', 'permissions', 'role_permissions',
            'branches', 'settings', 'otp_verifications',
            'customers', 'customer_types', 'leads', 'lead_followups',
            'brands', 'categories', 'products', 'pack_sizes',
            'estimates', 'estimate_items',
            'estimate_requests', 'estimate_request_photos', 'estimate_request_products', 'estimate_request_activity',
            'shop_hours_config', 'staff_attendance', 'attendance_photos', 'attendance_permissions',
            'staff_activities', 'staff_tasks', 'task_updates',
            'staff_salary_config', 'monthly_salaries', 'salary_payments', 'salary_adjustments', 'staff_leave_balance'
        ];

        const existingTableNames = tables.map(t => t.table_name || t.TABLE_NAME);
        const missingTables = requiredTables.filter(t => !existingTableNames.includes(t));

        if (missingTables.length > 0) {
            console.log('\n⚠️  Missing Tables:');
            missingTables.forEach(table => {
                console.log(`   ❌ ${table}`);
            });
        } else {
            console.log('\n✅ All required tables exist!');
        }

        // Check for extra tables not in required list
        const extraTables = existingTableNames.filter(t => !requiredTables.includes(t));
        if (extraTables.length > 0) {
            console.log('\n📌 Additional Tables Found:');
            extraTables.forEach(table => {
                console.log(`   ℹ️  ${table}`);
            });
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

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

checkAllTables();
