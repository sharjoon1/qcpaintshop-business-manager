/**
 * Composite indexes on hot query patterns (U7)
 *
 * Single-column indexes (added by fix-missing-indexes.js) cover individual
 * filters but miss the multi-column WHERE/ORDER patterns that production
 * EXPLAIN keeps warning about. Each index here was picked from a specific
 * query in the codebase — see the audit report (U7) for the source line.
 *
 * Uses ALGORITHM=INPLACE LOCK=NONE so the ALTERs are non-blocking on
 * MariaDB 10.11. Skips silently if the index name already exists, so
 * the migration is safe to re-run.
 */
const INDEXES = [
    // Attendance: WHERE user_id = ? AND date = ? — used everywhere
    { table: 'staff_attendance', name: 'idx_staff_attn_user_date',
      cols: '(user_id, date)' },

    // Painter estimate listing — painter dashboard + admin list
    { table: 'painter_estimates', name: 'idx_pe_painter_status_created',
      cols: '(painter_id, status, created_at DESC)' },
    { table: 'painter_estimates', name: 'idx_pe_status_created',
      cols: '(status, created_at DESC)' },

    // Painter point ledger — running balance / history paging
    { table: 'painter_point_transactions', name: 'idx_ppt_painter_created',
      cols: '(painter_id, created_at DESC)' },

    // Leads — followup queue + per-staff list
    { table: 'leads', name: 'idx_leads_branch_status_followup',
      cols: '(branch_id, status, next_followup_date)' },
    { table: 'leads', name: 'idx_leads_assigned_status',
      cols: '(assigned_to, status)' },

    // Zoho — branch-filtered dashboard slices
    { table: 'zoho_invoices', name: 'idx_zinv_branch_date',
      cols: '(local_branch_id, invoice_date)' },
    { table: 'zoho_payments', name: 'idx_zpay_branch_date',
      cols: '(local_branch_id, payment_date)' },

    // Staff tasks — pending/overdue widgets
    { table: 'staff_tasks', name: 'idx_st_assigned_status_due',
      cols: '(assigned_to, status, due_date)' },

    // Notifications — unread feed
    { table: 'notifications', name: 'idx_notif_user_read_created',
      cols: '(user_id, read_at, created_at DESC)' },

    // Chat / AI conversation paging
    { table: 'ai_messages', name: 'idx_aim_conv_created',
      cols: '(conversation_id, created_at DESC)' },

    // Painter attendance check-ins
    { table: 'painter_attendance_checkins', name: 'idx_pac_painter_date',
      cols: '(painter_id, checkin_date)' },
];

async function tableExists(pool, table) {
    const [rows] = await pool.query("SHOW TABLES LIKE ?", [table]);
    return rows.length > 0;
}

async function indexExists(pool, table, name) {
    const [rows] = await pool.query(
        `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
         LIMIT 1`,
        [table, name]
    );
    return rows.length > 0;
}

async function columnExists(pool, table, column) {
    const [rows] = await pool.query(
        `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
         LIMIT 1`,
        [table, column]
    );
    return rows.length > 0;
}

function extractCols(spec) {
    return spec.replace(/^\(|\)$/g, '').split(',').map(c =>
        c.trim().replace(/\s+(ASC|DESC)$/i, '')
    );
}

async function up(pool) {
    let added = 0, skipped = 0;
    for (const idx of INDEXES) {
        if (!(await tableExists(pool, idx.table))) {
            console.log(`  ${idx.table} not present — skipping ${idx.name}`);
            skipped++;
            continue;
        }
        if (await indexExists(pool, idx.table, idx.name)) {
            console.log(`  ${idx.table}.${idx.name} already present — skipping`);
            skipped++;
            continue;
        }
        // Verify every column exists; alternate column names like
        // local_branch_id may not be present in older databases.
        const missingCol = [];
        for (const c of extractCols(idx.cols)) {
            if (!(await columnExists(pool, idx.table, c))) missingCol.push(c);
        }
        if (missingCol.length) {
            console.log(`  ${idx.table}.${idx.name}: missing columns ${missingCol.join(',')} — skipping`);
            skipped++;
            continue;
        }
        try {
            await pool.query(
                `ALTER TABLE \`${idx.table}\`
                 ADD INDEX \`${idx.name}\` ${idx.cols},
                 ALGORITHM=INPLACE, LOCK=NONE`
            );
            console.log(`  Added ${idx.table}.${idx.name} ${idx.cols}`);
            added++;
        } catch (err) {
            // Some servers / engines reject INPLACE+LOCK=NONE for certain
            // index types — fall back to default.
            if (err.code === 'ER_ALTER_OPERATION_NOT_SUPPORTED' || err.code === 'ER_NOT_SUPPORTED_YET') {
                await pool.query(
                    `ALTER TABLE \`${idx.table}\` ADD INDEX \`${idx.name}\` ${idx.cols}`
                );
                console.log(`  Added ${idx.table}.${idx.name} ${idx.cols} (fallback)`);
                added++;
            } else {
                throw err;
            }
        }
    }
    console.log(`  Composite indexes: ${added} added, ${skipped} skipped`);
}

module.exports = { up };
