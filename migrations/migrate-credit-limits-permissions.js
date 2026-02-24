/**
 * Migration: Add credit_limits permissions
 * Adds credit_limits.view and credit_limits.manage to the permissions table,
 * so admin can assign credit limit access to specific roles.
 *
 * Run: node migrations/migrate-credit-limits-permissions.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'qc_business_manager',
        waitForConnections: true,
        connectionLimit: 5
    });

    console.log('Starting credit_limits permissions migration...\n');

    try {
        // 1. Insert credit_limits permissions
        console.log('[1/2] Adding credit_limits permissions...');
        const perms = [
            ['credit_limits', 'view', 'View Credit Limits', 'View credit limits page, customer list, and credit status'],
            ['credit_limits', 'manage', 'Manage Credit Limits', 'Set/edit credit limits, create customers, approve/reject requests, sync to Zoho']
        ];

        let added = 0;
        for (const [module, action, displayName, description] of perms) {
            const [existing] = await pool.query(
                'SELECT id FROM permissions WHERE module = ? AND action = ?',
                [module, action]
            );
            if (existing.length === 0) {
                await pool.query(
                    'INSERT INTO permissions (module, action, display_name, description) VALUES (?, ?, ?, ?)',
                    [module, action, displayName, description]
                );
                console.log(`  -> Added ${module}.${action} (${displayName})`);
                added++;
            } else {
                console.log(`  -> ${module}.${action} already exists (id=${existing[0].id}), skipping`);
            }
        }
        console.log(`  -> ${added} permissions added`);

        // 2. Auto-assign both permissions to admin and manager system roles
        console.log('[2/2] Auto-assigning to admin/manager roles...');
        const [roles] = await pool.query(
            "SELECT id, name FROM roles WHERE name IN ('admin', 'manager', 'super_admin') AND status = 'active'"
        );
        const [permRows] = await pool.query(
            "SELECT id, module, action FROM permissions WHERE module = 'credit_limits'"
        );

        let assigned = 0;
        for (const role of roles) {
            for (const perm of permRows) {
                const [exists] = await pool.query(
                    'SELECT id FROM role_permissions WHERE role_id = ? AND permission_id = ?',
                    [role.id, perm.id]
                );
                if (exists.length === 0) {
                    await pool.query(
                        'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
                        [role.id, perm.id]
                    );
                    console.log(`  -> Assigned ${perm.module}.${perm.action} to ${role.name}`);
                    assigned++;
                }
            }
        }
        console.log(`  -> ${assigned} role-permission mappings created`);

        console.log('\n=== Credit limits permissions migration completed ===');
        console.log('\nNote: Admin can now assign credit_limits.view and credit_limits.manage');
        console.log('to any staff role via Settings > Roles > Permissions.');
    } catch (err) {
        console.error('Migration failed:', err.message);
        throw err;
    } finally {
        await pool.end();
    }
}

migrate().catch(err => {
    console.error(err);
    process.exit(1);
});
