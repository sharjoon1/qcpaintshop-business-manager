/**
 * Painter Leads Routes — shared state & cross-sub-router helpers.
 *
 * Holds the cross-router module state and the permission auto-fix
 * (`ensurePainterLeadPermissions`) that mirrors the existing
 * `ensureZohoPermissions` helper in routes/zoho/shared.js.
 *
 * The pool reference is captured so future sub-routers (api.js in Task 3)
 * can pull it via getPool() without each needing its own setPool fan-out
 * in index.js.
 */

let pool;

function setPool(p) {
    pool = p;
}

function getPool() {
    return pool;
}

/**
 * Idempotently insert painter_leads / painters.approve permissions and
 * grant them to the standard roles. Safe to call on every server start;
 * existing rows are preserved by ON DUPLICATE KEY UPDATE / INSERT IGNORE.
 *
 * @param {import('mysql2/promise').Pool} dbPool
 */
async function ensurePainterLeadPermissions(dbPool) {
    const perms = [
        ['painter_leads', 'view',     'View all painter leads',     'View all painter leads'],
        ['painter_leads', 'manage',   'Manage painter leads',       'Manage painter leads'],
        ['painter_leads', 'add',      'Add painter lead',           'Add painter lead'],
        ['painter_leads', 'assign',   'Assign painter leads',       'Assign painter leads'],
        ['painter_leads', 'own.view', 'View own painter leads',     'View own painter leads'],
        ['painter_leads', 'own.edit', 'Edit own painter leads',     'Edit own painter leads'],
        ['painters',      'approve',  'Approve invited painters',   'Approve invited painters'],
    ];

    for (const [mod, act, name, desc] of perms) {
        await dbPool.query(
            `INSERT INTO permissions (module, action, display_name, description)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)`,
            [mod, act, name, desc]
        );
    }

    // Admin: all painter_leads + painters.approve (cross-join covers all).
    await dbPool.query(`
        INSERT IGNORE INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
        WHERE r.name = 'admin'
    `);

    // Manager: all painter_leads.* + painters.approve.
    await dbPool.query(`
        INSERT IGNORE INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
        WHERE r.name = 'manager'
          AND (p.module = 'painter_leads'
               OR (p.module = 'painters' AND p.action = 'approve'))
    `);

    // Staff: add / own.view / own.edit + painters.approve.
    await dbPool.query(`
        INSERT IGNORE INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
        WHERE r.name = 'staff'
          AND (
            (p.module = 'painter_leads' AND p.action IN ('add','own.view','own.edit'))
            OR (p.module = 'painters' AND p.action = 'approve')
          )
    `);
}

module.exports = {
    setPool,
    getPool,
    ensurePainterLeadPermissions,
};
