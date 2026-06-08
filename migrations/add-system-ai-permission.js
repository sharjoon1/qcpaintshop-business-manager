/**
 * Migration: Add the system.ai permission (RT-008)
 *
 * Registers system.ai so the AI Dashboard routes — PUT /api/ai/config (writes provider API keys),
 * GET /api/ai/app-scan, POST /api/ai/app-analyze — can be gated by requirePermission('system','ai').
 *
 * Full-admin roles (admin/administrator/super_admin) bypass ALL permission checks, so AI access is
 * admin-only by default. We deliberately do NOT auto-grant to any other role; the owner can grant
 * system.ai to a specific role via Settings > Roles > Permissions.
 *
 * Idempotent. Run: node migrations/add-system-ai-permission.js
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

    try {
        const [existing] = await pool.query(
            "SELECT id FROM permissions WHERE module = 'system' AND action = 'ai'"
        );
        if (existing.length) {
            console.log(`system.ai already exists (id=${existing[0].id}) — nothing to do.`);
        } else {
            const [r] = await pool.query(
                `INSERT INTO permissions (module, action, display_name, description)
                 VALUES ('system', 'ai', 'AI Dashboard',
                         'Access the AI dashboard: edit AI config (provider API keys) and run app scans/analysis')`
            );
            console.log(`Added system.ai permission (id=${r.insertId}).`);
        }
        console.log('Full-admin roles bypass permission checks, so AI routes are admin-only by default.');
        console.log('Grant system.ai to other roles via Settings > Roles > Permissions if needed.');
    } catch (err) {
        console.error('Migration failed:', err.message);
        throw err;
    } finally {
        await pool.end();
    }
}

migrate().catch(err => { console.error(err); process.exit(1); });
