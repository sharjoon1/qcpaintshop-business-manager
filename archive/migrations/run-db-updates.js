// Safe database updates with error handling
const mysql = require('mysql2/promise');
require('dotenv').config();

async function runUpdates() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'qc_business_manager',
        multipleStatements: true
    });
    
    console.log('🔌 Connected to database: qc_business_manager\n');
    
    try {
        // 1. Create users table
        console.log('1️⃣  Creating users table...');
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS users (
                id INT PRIMARY KEY AUTO_INCREMENT,
                username VARCHAR(100) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                full_name VARCHAR(255),
                phone VARCHAR(20),
                role ENUM('admin', 'staff', 'customer', 'guest') DEFAULT 'guest',
                branch_id INT NULL,
                status ENUM('active', 'inactive', 'pending_approval') DEFAULT 'pending_approval',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_login DATETIME NULL,
                profile_image_url VARCHAR(500) NULL,
                INDEX idx_role (role),
                INDEX idx_status (status),
                INDEX idx_email (email)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ Users table created\n');
        
        // 2. Add columns to estimates table (one by one to handle existing columns)
        console.log('2️⃣  Updating estimates table...');
        
        const estimateColumns = [
            ['status', "VARCHAR(50) DEFAULT 'draft' AFTER grand_total"],
            ['created_by_user_id', 'INT NULL AFTER status'],
            ['assigned_to_staff_id', 'INT NULL AFTER created_by_user_id'],
            ['approved_by_admin_id', 'INT NULL AFTER assigned_to_staff_id'],
            ['approved_at', 'DATETIME NULL AFTER approved_by_admin_id'],
            ['converted_invoice_id', 'VARCHAR(100) NULL AFTER approved_at'],
            ['converted_at', 'DATETIME NULL AFTER converted_invoice_id'],
            ['valid_until', 'DATE NULL AFTER converted_at'],
            ['is_expired', 'BOOLEAN DEFAULT 0 AFTER valid_until'],
            ['column_visibility', 'JSON NULL AFTER is_expired'],
            ['last_updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER column_visibility']
        ];
        
        for (const [colName, colDef] of estimateColumns) {
            try {
                await connection.execute(`ALTER TABLE estimates ADD COLUMN IF NOT EXISTS ${colName} ${colDef}`);
                console.log(`   ✅ Added column: ${colName}`);
            } catch (err) {
                if (err.code === 'ER_DUP_FIELDNAME') {
                    console.log(`   ⏭️  Column ${colName} already exists`);
                } else {
                    console.log(`   ⚠️  Error adding ${colName}:`, err.message);
                }
            }
        }
        console.log('');
        
        // 3. Create estimate_status_history table
        console.log('3️⃣  Creating estimate_status_history table...');
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS estimate_status_history (
                id INT PRIMARY KEY AUTO_INCREMENT,
                estimate_id INT NOT NULL,
                old_status VARCHAR(50) NULL,
                new_status VARCHAR(50) NOT NULL,
                changed_by_user_id INT NOT NULL,
                reason TEXT NULL,
                notes TEXT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (estimate_id) REFERENCES estimates(id) ON DELETE CASCADE,
                FOREIGN KEY (changed_by_user_id) REFERENCES users(id),
                INDEX idx_estimate_id (estimate_id),
                INDEX idx_timestamp (timestamp)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ Estimate status history table created\n');
        
        // 4. Create user_sessions table
        console.log('4️⃣  Creating user_sessions table...');
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS user_sessions (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user_id INT NOT NULL,
                session_token VARCHAR(255) UNIQUE NOT NULL,
                ip_address VARCHAR(45),
                user_agent TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME NOT NULL,
                last_activity DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_session_token (session_token),
                INDEX idx_expires_at (expires_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ User sessions table created\n');
        
        // 5. Create estimate_settings table
        console.log('5️⃣  Creating estimate_settings table...');
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS estimate_settings (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user_id INT NOT NULL,
                default_column_visibility JSON,
                default_show_gst_breakdown BOOLEAN DEFAULT 0,
                default_valid_days INT DEFAULT 30,
                auto_assign_to_creator BOOLEAN DEFAULT 1,
                email_template TEXT,
                whatsapp_template TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE KEY unique_user_settings (user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ Estimate settings table created\n');
        
        // 6. Create audit_log table
        console.log('6️⃣  Creating audit_log table...');
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS audit_log (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user_id INT,
                action VARCHAR(100) NOT NULL,
                table_name VARCHAR(50),
                record_id INT,
                old_value JSON,
                new_value JSON,
                ip_address VARCHAR(45),
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
                INDEX idx_user_id (user_id),
                INDEX idx_action (action),
                INDEX idx_timestamp (timestamp),
                INDEX idx_table_record (table_name, record_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ Audit log table created\n');
        
        // 7. Update existing estimates with default values
        console.log('7️⃣  Updating existing estimates...');
        await connection.execute(`
            UPDATE estimates
            SET column_visibility = JSON_OBJECT(
                'mix_info', true,
                'breakdown', true,
                'color_cost', true,
                'qty_area', true
            )
            WHERE column_visibility IS NULL
        `);
        
        await connection.execute(`
            UPDATE estimates
            SET valid_until = DATE_ADD(estimate_date, INTERVAL 30 DAY)
            WHERE valid_until IS NULL
        `);
        console.log('   ✅ Existing estimates updated\n');
        
        // 8. Show summary
        console.log('📊 Database Summary:\n');
        const [tables] = await connection.execute('SHOW TABLES');
        console.log('   Tables:', tables.length);
        tables.forEach(t => {
            console.log('     •', Object.values(t)[0]);
        });
        
        console.log('\n✅ Phase 1 Database Setup Complete!');
        console.log('📝 Next: Run create-admin-user.js to create admin account\n');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await connection.end();
    }
}

runUpdates();
