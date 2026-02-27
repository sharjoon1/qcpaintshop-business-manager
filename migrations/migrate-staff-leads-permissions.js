/**
 * Migration: Add staff lead management permissions (leads.own.*)
 * Adds leads.own.view, leads.own.add, leads.own.edit to the permissions table,
 * allowing staff to manage their own assigned leads.
 *
 * Run: node migrations/migrate-staff-leads-permissions.js
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

    console.log('Starting staff leads permissions migration...\n');

    try {
        // 1. Insert leads.own.* permissions
        console.log('[1/2] Adding leads.own.* permissions...');
        const perms = [
            ['leads', 'own.view', 'View Own Leads', 'View leads assigned to self'],
            ['leads', 'own.add', 'Add Own Leads', 'Create new leads (auto-assigned to self)'],
            ['leads', 'own.edit', 'Edit Own Leads', 'Update own leads, log followups, change status']
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

        // 2. Auto-assign all 3 permissions to staff, manager, admin, and super_admin roles
        console.log('[2/2] Auto-assigning to staff/manager/admin/super_admin roles...');
        const [roles] = await pool.query(
            "SELECT id, name FROM roles WHERE name IN ('staff', 'manager', 'admin', 'super_admin') AND status = 'active'"
        );
        const [permRows] = await pool.query(
            "SELECT id, module, action FROM permissions WHERE module = 'leads' AND action LIKE 'own.%'"
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

        console.log('\n=== Staff leads permissions migration completed ===');
        console.log('\nPermissions added: leads.own.view, leads.own.add, leads.own.edit');
        console.log('Assigned to: staff, manager, admin, super_admin');
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
