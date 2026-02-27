require('dotenv').config();
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');

(async () => {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  const email = 'playstore-reviewer@qcpaintshop.com';
  const password = 'ReviewTest@2026';
  const hash = await bcrypt.hash(password, 10);

  const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);

  if (existing.length > 0) {
    await pool.query('UPDATE users SET password_hash = ?, is_active = 1, status = ? WHERE email = ?', [hash, 'active', email]);
    console.log('Updated existing test account');
  } else {
    const [branches] = await pool.query('SELECT id FROM branches LIMIT 1');
    const branchId = branches[0] ? branches[0].id : 1;

    await pool.query(
      'INSERT INTO users (full_name, username, email, phone, password_hash, role, branch_id, status, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ['Play Store Reviewer', 'playstore-reviewer', email, '9999999999', hash, 'staff', branchId, 'active', 1]
    );
    console.log('Created new test account');
  }

  // Verify the account can login
  const [verify] = await pool.query('SELECT id, status, is_active, role, branch_id FROM users WHERE email = ?', [email]);
  if (verify.length > 0) {
    const u = verify[0];
    console.log(`Verified: id=${u.id}, status=${u.status}, is_active=${u.is_active}, role=${u.role}, branch_id=${u.branch_id}`);
    if (u.status !== 'active') {
      console.error('WARNING: status is not active! Login will fail.');
    }
  }

  console.log('Email:', email);
  console.log('Password:', password);
  await pool.end();
})();
