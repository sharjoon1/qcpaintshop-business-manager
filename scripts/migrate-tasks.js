/**
 * Migration: Create staff_tasks and task_updates tables
 * Required for the Task Management module
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
        console.log('Creating staff_tasks table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS staff_tasks (
                id INT AUTO_INCREMENT PRIMARY KEY,
                task_number VARCHAR(50) NOT NULL UNIQUE,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                task_type ENUM('daily', 'weekly', 'monthly', 'one_time', 'recurring') DEFAULT 'one_time',
                priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium',
                category VARCHAR(100),
                assigned_to INT NOT NULL,
                assigned_by INT NOT NULL,
                branch_id INT,
                due_date DATE NOT NULL,
                due_time TIME,
                start_date DATE,
                estimated_hours DECIMAL(5,2),
                actual_hours DECIMAL(5,2),
                status ENUM('pending', 'in_progress', 'completed', 'overdue', 'cancelled', 'on_hold') DEFAULT 'pending',
                completion_percentage INT DEFAULT 0,
                completed_at DATETIME,
                is_late TINYINT(1) DEFAULT 0,
                rating INT,
                rating_notes TEXT,
                admin_notes TEXT,
                staff_notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_assigned_to (assigned_to),
                INDEX idx_status (status),
                INDEX idx_due_date (due_date),
                INDEX idx_priority (priority),
                INDEX idx_branch_id (branch_id),
                INDEX idx_task_number (task_number),
                FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        console.log('staff_tasks table created.');

        console.log('Creating task_updates table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS task_updates (
                id INT AUTO_INCREMENT PRIMARY KEY,
                task_id INT NOT NULL,
                user_id INT NOT NULL,
                update_type ENUM('status_change', 'comment', 'progress', 'photo', 'attachment') DEFAULT 'comment',
                old_status VARCHAR(50),
                new_status VARCHAR(50),
                comment TEXT,
                photo_url VARCHAR(500),
                progress_percentage INT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_task_id (task_id),
                INDEX idx_user_id (user_id),
                FOREIGN KEY (task_id) REFERENCES staff_tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        console.log('task_updates table created.');

        // Add 'tasks' module to permissions if not exists
        const [existing] = await pool.query(
            "SELECT id FROM permissions WHERE module = 'tasks' LIMIT 1"
        );
        if (existing.length === 0) {
            console.log('Adding tasks permissions...');
            const actions = ['view', 'add', 'edit', 'delete', 'assign', 'approve'];
            for (const action of actions) {
                await pool.query(
                    "INSERT IGNORE INTO permissions (module, action, description) VALUES (?, ?, ?)",
                    ['tasks', action, `${action.charAt(0).toUpperCase() + action.slice(1)} tasks`]
                );
            }
            console.log('Tasks permissions added.');
        }

        console.log('\nMigration complete! Tables created:');
        console.log('  - staff_tasks');
        console.log('  - task_updates');

    } catch (error) {
        console.error('Migration failed:', error.message);
    } finally {
        await pool.end();
        process.exit();
    }
}

migrate();
