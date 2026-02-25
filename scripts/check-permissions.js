require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  // Check what permissions staff users actually have for credit_limits
  const [perms] = await pool.query(`
    SELECT DISTINCT r.name as role_name, rp.module, rp.action
    FROM role_permissions rp
    JOIN roles r ON rp.role_id = r.id
    WHERE rp.module = 'credit_limits'
    ORDER BY r.name, rp.action
  `);
  console.log('Roles with credit_limits permissions:');
  console.log(JSON.stringify(perms, null, 2));

  // Check all roles
  const [roles] = await pool.query('SELECT id, name FROM roles ORDER BY id');
  console.log('\nAll roles:', JSON.stringify(roles));

  // Check what the /api/auth/permissions endpoint returns for a staff user
  const [staffUsers] = await pool.query(`
    SELECT u.id, u.full_name, u.role, r.id as role_id
    FROM users u
    JOIN roles r ON u.role = r.name
    WHERE u.role NOT IN ('admin', 'super_admin', 'manager')
    AND u.is_active = 1
    LIMIT 3
  `);
  console.log('\nSample staff users:', JSON.stringify(staffUsers));

  if (staffUsers.length > 0) {
    const roleId = staffUsers[0].role_id;
    const [staffPerms] = await pool.query(`
      SELECT module, action FROM role_permissions WHERE role_id = ?
    `, [roleId]);
    console.log(`\nPermissions for role_id=${roleId} (${staffUsers[0].role}):`);
    staffPerms.forEach(p => console.log(`  ${p.module}.${p.action}`));
  }

  await pool.end();
})();
