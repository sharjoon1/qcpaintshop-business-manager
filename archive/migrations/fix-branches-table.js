const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'qc_admin',
    password: process.env.DB_PASSWORD || 'QC@dm1n2026!Secure',
    database: process.env.DB_NAME || 'qc_business_manager'
};

async function fixBranchesTable() {
    let connection;

    try {
        console.log('🔌 Connecting to database...');
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Connected to database\n');

        // Create branches table
        console.log('🏢 Creating branches table...');
        await connection.query(`
            CREATE TABLE IF NOT EXISTS branches (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(255) NOT NULL,
                code VARCHAR(50) UNIQUE,
                address TEXT,
                city VARCHAR(100),
                state VARCHAR(100),
                pincode VARCHAR(20),
                country VARCHAR(100) DEFAULT 'India',
                phone VARCHAR(20),
                email VARCHAR(255),
                manager_id INT,
                latitude DECIMAL(10, 8),
                longitude DECIMAL(11, 8),
                geo_fence_radius INT DEFAULT 100 COMMENT 'Radius in meters',
                is_active BOOLEAN DEFAULT TRUE,
                opening_time TIME DEFAULT '09:00:00',
                closing_time TIME DEFAULT '18:00:00',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_code (code),
                INDEX idx_manager (manager_id),
                INDEX idx_active (is_active)
            )
        `);
        console.log('  ✓ branches table created');

        // Check if default branch exists
        const [existing] = await connection.query('SELECT COUNT(*) as count FROM branches');

        if (existing[0].count === 0) {
            console.log('\n⚙️ Creating default branch...');

            await connection.query(
                `INSERT INTO branches
                 (name, code, address, city, state, pincode, phone, email, geo_fence_radius)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    'Quality Colours - Main Branch',
                    'QC-MAIN',
                    'Ramanathapuram',
                    'Ramanathapuram',
                    'Tamil Nadu',
                    '623501',
                    '+91 7418831122',
                    'info@qcpaintshop.com',
                    500 // 500 meters radius
                ]
            );

            const [newBranch] = await connection.query('SELECT id FROM branches WHERE code = ?', ['QC-MAIN']);
            console.log(`  ✓ Created default branch (ID: ${newBranch[0].id})`);

            // Now insert default shop hours for this branch
            console.log('\n⏰ Creating default shop hours...');
            const branchId = newBranch[0].id;

            // Mon-Sat, 9 AM - 6 PM
            for (let day = 1; day <= 6; day++) {
                await connection.query(
                    `INSERT INTO shop_hours_config
                     (branch_id, day_of_week, is_working_day, open_time, close_time, expected_hours, late_threshold_minutes)
                     VALUES (?, ?, TRUE, '09:00:00', '18:00:00', 8.00, 15)`,
                    [branchId, day]
                );
            }

            // Sunday closed
            await connection.query(
                `INSERT INTO shop_hours_config
                 (branch_id, day_of_week, is_working_day, open_time, close_time, expected_hours)
                 VALUES (?, 0, FALSE, '09:00:00', '18:00:00', 0)`,
                [branchId]
            );

            console.log('  ✓ Created default shop hours (Mon-Sat: 9 AM - 6 PM)');

            // Update existing users to have this branch_id if they don't have one
            console.log('\n👥 Updating users with default branch...');
            await connection.query(
                'UPDATE users SET branch_id = ? WHERE branch_id IS NULL OR branch_id = 0',
                [branchId]
            );
            console.log('  ✓ Users updated with default branch');

        } else {
            console.log('\n⚙️ Branches already exist');
        }

        console.log('\n🎉 Branches table fixed successfully!');
        console.log('\n📋 Next steps:');
        console.log('  1. Restart the server: npm start');
        console.log('  2. Try clocking in again');
        console.log('  3. Check browser console and Network tab if it still fails');

    } catch (error) {
        console.error('❌ Error fixing branches table:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log('\n🔌 Database connection closed');
        }
    }
}

// Run the fix
fixBranchesTable();
