async function up(pool) {
    await pool.query(`
        ALTER TABLE painter_leads
        MODIFY COLUMN branch_detected_via
        ENUM('zoho_branch_id','name_prefix','invoice_history','admin_assign','staff_assign') NULL
    `);
    console.log('✅ Added staff_assign to painter_leads.branch_detected_via ENUM');
}

async function down(pool) {
    await pool.query(`
        ALTER TABLE painter_leads
        MODIFY COLUMN branch_detected_via
        ENUM('zoho_branch_id','name_prefix','invoice_history','admin_assign') NULL
    `);
}

module.exports = { up, down };
