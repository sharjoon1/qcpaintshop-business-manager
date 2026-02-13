/**
 * Migration: Create salary_advances table + salary.approve permission
 * Run: node scripts/migrate-salary-advances.js
 *
 * Tables created:
 *   - salary_advances (Salary advance requests & tracking)
 *
 * Permissions added:
 *   - salary.approve (for manager/accountant roles)
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 5
    });

    try {
        console.log('Starting salary advances migration...\n');

        // 1. Create salary_advances table
        console.log('1/2 Creating salary_advances table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS salary_advances (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user_id INT NOT NULL,
                branch_id INT NOT NULL,
                amount DECIMAL(12,2) NOT NULL,
                reason TEXT,
                status ENUM('pending','approved','rejected','paid','recovered') DEFAULT 'pending',

                -- Approval
                approved_by INT NULL,
                approved_at DATETIME NULL,
                rejected_by INT NULL,
                rejected_at DATETIME NULL,
                rejection_reason TEXT NULL,

                -- Payment
                payment_date DATE NULL,
                payment_method VARCHAR(50) NULL,
                payment_reference VARCHAR(100) NULL,
                paid_by INT NULL,

                -- Recovery
                recovery_month VARCHAR(7) NULL COMMENT 'YYYY-MM format',
                recovered_amount DECIMAL(12,2) DEFAULT 0,

                -- Metadata
                notes TEXT NULL,
                requested_by INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

                -- Foreign keys
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
                FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
                FOREIGN KEY (rejected_by) REFERENCES users(id) ON DELETE SET NULL,
                FOREIGN KEY (paid_by) REFERENCES users(id) ON DELETE SET NULL,
                FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE CASCADE,

                -- Indexes
                INDEX idx_status (status),
                INDEX idx_user (user_id),
                INDEX idx_branch (branch_id),
                INDEX idx_recovery_month (recovery_month)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✅ salary_advances table created');

        // 2. Add salary.approve permission if not exists
        console.log('2/2 Adding salary.approve permission...');
        const [existing] = await pool.query(
            "SELECT id FROM permissions WHERE module = 'salary' AND action = 'approve' LIMIT 1"
        );

        if (existing.length === 0) {
            const [result] = await pool.query(
                "INSERT INTO permissions (module, action, description) VALUES ('salary', 'approve', 'Approve or reject salary advances')"
            );
            const permId = result.insertId;
            console.log(`   ✅ salary.approve permission created (id: ${permId})`);

            // Assign to admin, manager, and accountant roles
            const [roles] = await pool.query(
                "SELECT id, name FROM roles WHERE name IN ('admin', 'manager', 'accountant')"
            );

            for (const role of roles) {
                try {
                    await pool.query(
                        "INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
                        [role.id, permId]
                    );
                    console.log(`   ✅ Assigned salary.approve to ${role.name} role`);
                } catch (e) {
                    console.log(`   ⚠️  Could not assign to ${role.name}: ${e.message}`);
                }
            }
        } else {
            console.log('   ⏭️  salary.approve permission already exists');
        }

        console.log('\n✅ Migration completed successfully!');
    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

migrate().catch(() => process.exit(1));
