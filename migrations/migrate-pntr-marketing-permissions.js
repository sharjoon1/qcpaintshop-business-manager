require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createPool } = require('../config/database');
const pool = createPool();

async function migrate() {
    console.log('=== PNTR Marketing Permissions ===');
    const permissions = [
        ['painters', 'marketing_view',    'Painters — Marketing: View Daily List', 'See today\'s painter marketing list'],
        ['painters', 'marketing_contact', 'Painters — Marketing: Log Followups',   'Record outcomes on painter leads'],
        ['painters', 'marketing_manage',  'Painters — Marketing: Manage',          'Config, review queues, imports, backfill'],
        ['painters', 'marketing_convert', 'Painters — Marketing: Convert',         'Convert painter lead → painter program']
    ];

    const permIds = {};
    for (const [mod, act, displayName, desc] of permissions) {
        const [existing] = await pool.query('SELECT id FROM permissions WHERE module = ? AND action = ?', [mod, act]);
        if (existing.length) {
            permIds[act] = existing[0].id;
            console.log(`  skip (exists): ${mod}.${act}`);
        } else {
            const [res] = await pool.query(
                'INSERT INTO permissions (module, action, display_name, description) VALUES (?, ?, ?, ?)',
                [mod, act, displayName, desc]
            );
            permIds[act] = res.insertId;
            console.log(`  added: ${mod}.${act}`);
        }
    }

    // Default role grants
    const roleGrants = {
        'manager': ['marketing_view', 'marketing_contact', 'marketing_manage', 'marketing_convert'],
        'staff':   ['marketing_view', 'marketing_contact', 'marketing_convert']
    };
    for (const [roleName, actions] of Object.entries(roleGrants)) {
        const [roles] = await pool.query('SELECT id FROM roles WHERE name = ? LIMIT 1', [roleName]);
        if (!roles.length) { console.log(`  skip role ${roleName}: not found`); continue; }
        const roleId = roles[0].id;
        for (const act of actions) {
            const permId = permIds[act];
            if (!permId) continue;
            const [have] = await pool.query(
                'SELECT id FROM role_permissions WHERE role_id = ? AND permission_id = ? LIMIT 1',
                [roleId, permId]
            );
            if (!have.length) {
                await pool.query(
                    'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
                    [roleId, permId]
                );
                console.log(`  granted ${roleName} → ${act}`);
            }
        }
    }

    console.log('Done.');
    await pool.end();
}
migrate().catch(err => { console.error(err); process.exit(1); });
