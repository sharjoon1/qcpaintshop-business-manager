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

  // Check actual columns in users table
  const [columns] = await pool.query("SHOW COLUMNS FROM users");
  const colNames = columns.map(c => c.Field);
  const hasIsActive = colNames.includes('is_active');
  const hasStatus = colNames.includes('status');

  console.log('Users table columns:', colNames.join(', '));
  console.log(`has is_active: ${hasIsActive}, has status: ${hasStatus}`);

  const [existing] = await pool.query('SELECT id, status FROM users WHERE email = ?', [email]);

  if (existing.length > 0) {
    console.log(`Existing account found (id=${existing[0].id}, current status=${existing[0].status})`);
    let updateSQL = 'UPDATE users SET password_hash = ?';
    const params = [hash];

    if (hasStatus) {
      updateSQL += ", status = 'active'";
    }
    if (hasIsActive) {
      updateSQL += ', is_active = 1';
    }
    updateSQL += ' WHERE email = ?';
    params.push(email);

    await pool.query(updateSQL, params);
    console.log('Updated existing test account');
  } else {
    const [branches] = await pool.query('SELECT id FROM branches LIMIT 1');
    const branchId = branches[0] ? branches[0].id : 1;

    let insertCols = 'full_name, username, email, phone, password_hash, role, branch_id';
    let insertPlaceholders = '?, ?, ?, ?, ?, ?, ?';
    const params = ['Play Store Reviewer', 'playstore-reviewer', email, '9999999999', hash, 'staff', branchId];

    if (hasStatus) {
      insertCols += ', status';
      insertPlaceholders += ', ?';
      params.push('active');
    }
    if (hasIsActive) {
      insertCols += ', is_active';
      insertPlaceholders += ', ?';
      params.push(1);
    }

    await pool.query(`INSERT INTO users (${insertCols}) VALUES (${insertPlaceholders})`, params);
    console.log('Created new test account');
  }

  // Verify the account can login
  const selectCols = ['id', 'role', 'branch_id'];
  if (hasStatus) selectCols.push('status');
  if (hasIsActive) selectCols.push('is_active');

  const [verify] = await pool.query(`SELECT ${selectCols.join(', ')} FROM users WHERE email = ?`, [email]);
  if (verify.length > 0) {
    const u = verify[0];
    console.log('Verified account:', JSON.stringify(u));
    if (hasStatus && u.status !== 'active') {
      console.error('WARNING: status is not "active"! Login will FAIL.');
    } else {
      console.log('Account is ready for login.');
    }
  }

  console.log('\n=== Play Store Test Credentials ===');
  console.log('Email:', email);
  console.log('Password:', password);
  await pool.end();
})();
