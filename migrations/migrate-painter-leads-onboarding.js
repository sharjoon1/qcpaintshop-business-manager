/**
 * Painter Onboarding & Marketing Workflow
 * Extends painter_leads, creates painter_lead_invites, wires staff approval.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

exports.up = async function (pool) {
  console.log('=== Painter leads onboarding migration ===');

  async function columnExists(table, column) {
    const [rows] = await pool.query('SHOW COLUMNS FROM ?? WHERE Field = ?', [table, column]);
    return rows.length > 0;
  }

  async function addColumn(table, column, def) {
    if (await columnExists(table, column)) {
      console.log(`    - ${table}.${column} already exists`);
      return;
    }
    await pool.query(`ALTER TABLE ?? ADD COLUMN ?? ${def}`, [table, column]);
    console.log(`    - ${table}.${column} added`);
  }

  async function addIndex(table, indexName, columns) {
    const [rows] = await pool.query(
      'SELECT 1 FROM information_schema.STATISTICS WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
      [table, indexName]
    );
    if (rows.length > 0) {
      console.log(`    - index ${indexName} already exists`);
      return;
    }
    await pool.query(`ALTER TABLE ?? ADD INDEX ?? (${columns})`, [table, indexName]);
    console.log(`    - index ${indexName} added`);
  }

  // 1. Extend painter_leads status ENUM and add onboarding columns
  await pool.query(`
    ALTER TABLE painter_leads
      MODIFY COLUMN status ENUM(
        'new','in_progress','interested','invited','registered','converted','active_painter',
        'not_interested','unreachable','wrong_number','duplicate','snoozed'
      ) DEFAULT 'new'
  `);
  console.log('  [1/5] painter_leads status ENUM extended');

  await addColumn('painter_leads', 'source', "ENUM('zoho_import','staff_walk_in','staff_referral','painter_referral','admin_bulk') DEFAULT 'staff_walk_in'");
  await addColumn('painter_leads', 'source_lead_id', 'INT NULL');
  await addColumn('painter_leads', 'created_by', 'INT NULL');
  await addColumn('painter_leads', 'invited_at', 'TIMESTAMP NULL');
  await addColumn('painter_leads', 'invited_by', 'INT NULL');
  await addColumn('painter_leads', 'invite_token', 'VARCHAR(64) NULL UNIQUE');
  await addColumn('painter_leads', 'approved_by', 'INT NULL');
  await addColumn('painter_leads', 'approved_at', 'TIMESTAMP NULL');
  await addColumn('painter_leads', 'zoho_contact_id', 'VARCHAR(50) NULL');

  await addIndex('painter_leads', 'idx_invite_token', 'invite_token');
  await addIndex('painter_leads', 'idx_created_by', 'created_by');
  await addIndex('painter_leads', 'idx_invited_by', 'invited_by');
  await addIndex('painter_leads', 'idx_source_lead', 'source_lead_id');
  console.log('  [1/5] painter_leads columns/indexes added');

  // 2. Create painter_lead_invites
  await pool.query(`
    CREATE TABLE IF NOT EXISTS painter_lead_invites (
      id INT AUTO_INCREMENT PRIMARY KEY,
      painter_lead_id INT NOT NULL,
      sent_by INT NOT NULL,
      sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      channel ENUM('whatsapp','sms') NOT NULL,
      message TEXT NOT NULL,
      invite_token VARCHAR(64) NOT NULL,
      clicked_at TIMESTAMP NULL,
      registered_at TIMESTAMP NULL,
      status ENUM('sent','delivered','clicked','registered','failed') DEFAULT 'sent',
      INDEX idx_lead (painter_lead_id),
      INDEX idx_token (invite_token)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('  [2/5] painter_lead_invites created');

  // 3. Extend painter_lead_followups with sms
  await pool.query(`
    ALTER TABLE painter_lead_followups
      MODIFY COLUMN followup_type ENUM('call','whatsapp','visit','sms') NOT NULL
  `);
  console.log('  [3/5] painter_lead_followups extended');

  // 4. Extend painters
  await addColumn('painters', 'painter_lead_id', 'INT NULL');
  await addColumn('painters', 'invited_by_staff_id', 'INT NULL');
  await addIndex('painters', 'idx_painter_lead', 'painter_lead_id');
  console.log('  [4/5] painters extended');

  // 5. Seed permissions
  const perms = [
    ['painter_leads', 'view', 'View all painter leads'],
    ['painter_leads', 'manage', 'Manage painter leads'],
    ['painter_leads', 'add', 'Add painter lead'],
    ['painter_leads', 'assign', 'Assign painter leads'],
    ['painter_leads', 'own.view', 'View own painter leads'],
    ['painter_leads', 'own.edit', 'Edit own painter leads'],
    ['painters', 'approve', 'Approve invited painters']
  ];
  for (const [mod, action, name] of perms) {
    await pool.query(
      `INSERT INTO permissions (module, action, display_name, description)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)`,
      [mod, action, name, name]
    );
  }

  async function assignToRole(roleName, moduleFilter, actionFilter = null) {
    let where = 'r.name = ?';
    const params = [roleName];
    if (moduleFilter) {
      where += ' AND p.module = ?';
      params.push(moduleFilter);
    }
    if (actionFilter) {
      where += ' AND p.action IN (?)';
      params.push(actionFilter);
    }
    await pool.query(
      `INSERT IGNORE INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE ${where}`,
      params
    );
  }

  await assignToRole('admin', null); // admin gets everything
  await assignToRole('manager', 'painter_leads');
  await assignToRole('manager', 'painters', ['approve']);
  await assignToRole('staff', 'painter_leads', ['add', 'own.view', 'own.edit']);
  await assignToRole('staff', 'painters', ['approve']);
  console.log('  [5/5] permissions seeded');

  console.log('Migration complete');
};
