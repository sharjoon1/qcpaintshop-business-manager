const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'qc_admin',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'qc_business_manager'
};

async function populateDatabase() {
    let connection;

    try {
        console.log('🔌 Connecting to database...');
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Connected to database\n');

        // ========================================
        // 1. ADD MORE BRANCHES
        // ========================================
        console.log('🏢 Adding branches...');

        const branches = [
            { name: 'Ramanathapuram Branch', code: 'RAM', city: 'Ramanathapuram', phone: '9876543201', address: '123 Main Street, Ramanathapuram' },
            { name: 'Coimbatore Branch', code: 'CBE', city: 'Coimbatore', phone: '9876543202', address: '456 Market Road, Coimbatore' },
            { name: 'Chennai Branch', code: 'CHN', city: 'Chennai', phone: '9876543203', address: '789 Anna Salai, Chennai' }
        ];

        for (const branch of branches) {
            const [existing] = await connection.query('SELECT id FROM branches WHERE code = ?', [branch.code]);
            if (existing.length === 0) {
                await connection.query(
                    `INSERT INTO branches (name, code, city, phone, address, is_active, opening_time, closing_time)
                     VALUES (?, ?, ?, ?, ?, 1, '08:30:00', '20:30:00')`,
                    [branch.name, branch.code, branch.city, branch.phone, branch.address]
                );
                console.log(`  ✓ Added: ${branch.name}`);
            } else {
                console.log(`  ⊘ Exists: ${branch.name}`);
            }
        }

        // Get branch IDs for later use
        const [branchRows] = await connection.query('SELECT id, code FROM branches');
        const branchMap = {};
        branchRows.forEach(b => branchMap[b.code] = b.id);

        // ========================================
        // 2. ADD SHOP HOURS CONFIG FOR ALL BRANCHES
        // ========================================
        console.log('\n⏰ Adding shop hours configuration...');

        for (const branchId of Object.values(branchMap)) {
            const [existing] = await connection.query('SELECT id FROM shop_hours_config WHERE branch_id = ?', [branchId]);

            if (existing.length === 0) {
                // Create shop hours for all 7 days (0=Sunday, 1=Monday, etc.)
                const shopHours = [];
                for (let day = 0; day <= 6; day++) {
                    shopHours.push([
                        branchId,
                        day,
                        true, // is_working_day
                        day === 0 ? '09:00:00' : '08:30:00', // open_time (Sunday opens at 9)
                        day === 0 ? '14:00:00' : '20:30:00', // close_time (Sunday closes at 2pm)
                        day === 0 ? 5.00 : 10.00, // expected_hours
                        15, // late_threshold_minutes
                        15  // early_leave_threshold_minutes
                    ]);
                }

                await connection.query(
                    `INSERT INTO shop_hours_config
                     (branch_id, day_of_week, is_working_day, open_time, close_time, expected_hours, late_threshold_minutes, early_leave_threshold_minutes)
                     VALUES ?`,
                    [shopHours]
                );
                console.log(`  ✓ Added shop hours for branch ID ${branchId}`);
            }
        }

        // ========================================
        // 3. ADD MORE USERS (STAFF)
        // ========================================
        console.log('\n👥 Adding users...');

        const hashedPassword = await bcrypt.hash('password123', 10);

        const users = [
            { username: 'manager1', full_name: 'Ramesh Kumar', email: 'ramesh@qc.com', phone: '9876543301', role: 'manager', branch_id: branchMap['RAM'] || 1 },
            { username: 'staff1', full_name: 'Priya Venkat', email: 'priya@qc.com', phone: '9876543302', role: 'staff', branch_id: branchMap['RAM'] || 1 },
            { username: 'staff2', full_name: 'Arun Pandian', email: 'arun@qc.com', phone: '9876543303', role: 'staff', branch_id: branchMap['CBE'] || 1 },
            { username: 'manager2', full_name: 'Lakshmi Devi', email: 'lakshmi@qc.com', phone: '9876543304', role: 'manager', branch_id: branchMap['CBE'] || 1 },
            { username: 'staff3', full_name: 'Karthik Raj', email: 'karthik@qc.com', phone: '9876543305', role: 'staff', branch_id: branchMap['CHN'] || 1 }
        ];

        for (const user of users) {
            const [existing] = await connection.query('SELECT id FROM users WHERE username = ?', [user.username]);
            if (existing.length === 0) {
                await connection.query(
                    `INSERT INTO users (username, full_name, email, phone, password_hash, role, branch_id, status)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
                    [user.username, user.full_name, user.email, user.phone, hashedPassword, user.role, user.branch_id]
                );
                console.log(`  ✓ Added: ${user.full_name} (${user.role}) - Password: password123`);
            } else {
                console.log(`  ⊘ Exists: ${user.full_name}`);
            }
        }

        // ========================================
        // 4. ADD MORE PRODUCTS
        // ========================================
        console.log('\n📦 Adding more products...');

        const products = [
            { name: 'Tractor Emulsion - Brilliant White', brand_id: 1, category_id: 1, base_price: 650, coverage: 130 },
            { name: 'Royal Aspira - Premium Luxury', brand_id: 1, category_id: 1, base_price: 920, coverage: 145 },
            { name: 'Weatherproof Cool Reflect', brand_id: 2, category_id: 2, base_price: 780, coverage: 120 },
            { name: 'Silk Luxury Emulsion', brand_id: 3, category_id: 1, base_price: 890, coverage: 135 },
            { name: 'Exterior Shield Pro', brand_id: 3, category_id: 2, base_price: 820, coverage: 125 }
        ];

        for (const product of products) {
            const [existing] = await connection.query('SELECT id FROM products WHERE name = ?', [product.name]);
            if (existing.length === 0) {
                await connection.query(
                    `INSERT INTO products (name, brand_id, category_id, product_type, base_price, area_coverage, gst_percentage, status, available_sizes)
                     VALUES (?, ?, ?, 'area_wise', ?, ?, 18, 'active', ?)`,
                    [product.name, product.brand_id, product.category_id, product.base_price, product.coverage, JSON.stringify([1, 4, 10, 20])]
                );
                console.log(`  ✓ Added: ${product.name}`);
            }
        }

        // ========================================
        // 5. ADD MORE CUSTOMERS
        // ========================================
        console.log('\n👤 Adding more customers...');

        const customers = [
            { name: 'Meena Ramachandran', phone: '9876543401', email: 'meena@email.com', city: 'Ramanathapuram' },
            { name: 'Suresh Babu', phone: '9876543402', email: 'suresh@email.com', city: 'Coimbatore' },
            { name: 'Anitha Krishnan', phone: '9876543403', email: 'anitha@email.com', city: 'Chennai' },
            { name: 'Ganesh Moorthy', phone: '9876543404', email: 'ganesh@email.com', city: 'Ramanathapuram' },
            { name: 'Divya Lakshmi', phone: '9876543405', email: 'divya@email.com', city: 'Coimbatore' },
            { name: 'Naveen Kumar', phone: '9876543406', email: 'naveen@email.com', city: 'Chennai' },
            { name: 'Pooja Reddy', phone: '9876543407', email: 'pooja@email.com', city: 'Ramanathapuram' },
            { name: 'Manoj Pillai', phone: '9876543408', email: 'manoj@email.com', city: 'Coimbatore' }
        ];

        for (const customer of customers) {
            const [existing] = await connection.query('SELECT id FROM customers WHERE phone = ?', [customer.phone]);
            if (existing.length === 0) {
                await connection.query(
                    `INSERT INTO customers (name, phone, email, city, status)
                     VALUES (?, ?, ?, ?, 'approved')`,
                    [customer.name, customer.phone, customer.email, customer.city]
                );
                console.log(`  ✓ Added: ${customer.name}`);
            }
        }

        // ========================================
        // 6. ADD SETTINGS DATA
        // ========================================
        console.log('\n⚙️  Adding settings...');

        const settings = [
            { setting_key: 'business_name', setting_value: 'Quality Colours Paints', category: 'business' },
            { setting_key: 'business_phone', setting_value: '9876543210', category: 'business' },
            { setting_key: 'business_email', setting_value: 'info@qualitycolours.com', category: 'business' },
            { setting_key: 'business_address', setting_value: 'Main Branch, Ramanathapuram', category: 'business' },
            { setting_key: 'gst_number', setting_value: '33AAAAA0000A1Z5', category: 'business' },
            { setting_key: 'default_gst_rate', setting_value: '18', category: 'business' }
        ];

        for (const setting of settings) {
            const [existing] = await connection.query('SELECT id FROM settings WHERE setting_key = ?', [setting.setting_key]);
            if (existing.length === 0) {
                await connection.query(
                    `INSERT INTO settings (setting_key, setting_value, category) VALUES (?, ?, ?)`,
                    [setting.setting_key, setting.setting_value, setting.category]
                );
                console.log(`  ✓ Added: ${setting.setting_key}`);
            }
        }

        // ========================================
        // SUMMARY
        // ========================================
        console.log('\n' + '='.repeat(50));
        console.log('✅ DATABASE POPULATED SUCCESSFULLY!\n');

        const [branchCount] = await connection.query('SELECT COUNT(*) as count FROM branches');
        const [userCount] = await connection.query('SELECT COUNT(*) as count FROM users');
        const [customerCount] = await connection.query('SELECT COUNT(*) as count FROM customers');
        const [productCount] = await connection.query('SELECT COUNT(*) as count FROM products');
        const [estimateCount] = await connection.query('SELECT COUNT(*) as count FROM estimates');

        console.log('📊 Current Database Status:');
        console.log(`  🏢 Branches: ${branchCount[0].count}`);
        console.log(`  👥 Users: ${userCount[0].count}`);
        console.log(`  👤 Customers: ${customerCount[0].count}`);
        console.log(`  📦 Products: ${productCount[0].count}`);
        console.log(`  📋 Estimates: ${estimateCount[0].count}`);
        console.log('\n' + '='.repeat(50));

        console.log('\n🔑 Login Credentials:');
        console.log('  Admin: sharjoon / (existing password)');
        console.log('  Manager: manager1 / password123');
        console.log('  Staff: staff1 / password123');
        console.log('  Staff: staff2 / password123');
        console.log('  Staff: staff3 / password123');
        console.log('  Manager: manager2 / password123');

    } catch (error) {
        console.error('❌ Error populating database:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log('\n🔌 Database connection closed');
        }
    }
}

// Run the script
populateDatabase();
