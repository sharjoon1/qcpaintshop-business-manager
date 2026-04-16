// migrations/migrate-pntr-painter-marketing.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createPool } = require('../config/database');
const pool = createPool();

async function run() {
    console.log('=== PNTR Painter Marketing migration ===');

    // 1. painter_leads
    await pool.query(`
        CREATE TABLE IF NOT EXISTS painter_leads (
            id INT AUTO_INCREMENT PRIMARY KEY,
            zoho_customer_id VARCHAR(50) NULL,
            painter_id INT NULL,
            full_name VARCHAR(255) NOT NULL,
            phone VARCHAR(20) NOT NULL UNIQUE,
            email VARCHAR(255) NULL,
            branch_id INT NULL,
            branch_detected_via ENUM('zoho_branch_id','name_prefix','invoice_history','admin_assign') NULL,
            assigned_to INT NULL,
            status ENUM(
                'new','in_progress','interested','converted','active_painter',
                'not_interested','unreachable','wrong_number','duplicate','snoozed'
            ) DEFAULT 'new',
            last_contact_date TIMESTAMP NULL,
            last_outcome VARCHAR(50) NULL,
            next_eligible_date DATE NULL,
            total_attempts INT DEFAULT 0,
            contact_count INT DEFAULT 0,
            notes TEXT NULL,
            imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            converted_at TIMESTAMP NULL,
            activated_at TIMESTAMP NULL,
            INDEX idx_branch_assigned (branch_id, assigned_to),
            INDEX idx_next_eligible (next_eligible_date, status),
            INDEX idx_painter (painter_id),
            INDEX idx_zoho (zoho_customer_id),
            INDEX idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  [1/9] painter_leads');

    // 2. painter_lead_followups
    await pool.query(`
        CREATE TABLE IF NOT EXISTS painter_lead_followups (
            id INT AUTO_INCREMENT PRIMARY KEY,
            painter_lead_id INT NOT NULL,
            user_id INT NOT NULL,
            followup_type ENUM('call','whatsapp','visit') NOT NULL,
            call_status ENUM('connected','not_answered','wrong_number','switched_off','busy') NULL,
            outcome ENUM(
                'interested_in_program','already_aware','will_visit_shop',
                'wants_callback','not_interested','wrong_number','no_answer'
            ) NULL,
            next_followup_date DATE NULL,
            notes TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_lead (painter_lead_id),
            INDEX idx_user_date (user_id, created_at),
            FOREIGN KEY (painter_lead_id) REFERENCES painter_leads(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  [2/9] painter_lead_followups');

    // 3. painter_daily_assignments
    await pool.query(`
        CREATE TABLE IF NOT EXISTS painter_daily_assignments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            branch_id INT NOT NULL,
            painter_lead_id INT NOT NULL,
            assigned_date DATE NOT NULL,
            contacted_at TIMESTAMP NULL,
            contact_outcome VARCHAR(50) NULL,
            UNIQUE KEY uniq_daily (user_id, painter_lead_id, assigned_date),
            INDEX idx_staff_date (user_id, assigned_date),
            INDEX idx_branch_date (branch_id, assigned_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  [3/9] painter_daily_assignments');

    // 4. painter_marketing_config
    await pool.query(`
        CREATE TABLE IF NOT EXISTS painter_marketing_config (
            id INT AUTO_INCREMENT PRIMARY KEY,
            scope ENUM('branch','user') NOT NULL,
            scope_id INT NOT NULL,
            daily_quota INT NOT NULL DEFAULT 10,
            recycle_days_new INT DEFAULT 7,
            recycle_days_callback INT DEFAULT 3,
            recycle_days_will_visit INT DEFAULT 14,
            recycle_days_already_aware INT DEFAULT 60,
            recycle_days_not_interested INT DEFAULT 30,
            recycle_days_unreachable INT DEFAULT 60,
            recycle_days_active_painter INT DEFAULT 45,
            is_active TINYINT DEFAULT 1,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_scope (scope, scope_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  [4/9] painter_marketing_config');

    // 5. painter_zoho_salesperson_map
    await pool.query(`
        CREATE TABLE IF NOT EXISTS painter_zoho_salesperson_map (
            id INT AUTO_INCREMENT PRIMARY KEY,
            zoho_salesperson_id VARCHAR(50) NOT NULL UNIQUE,
            zoho_salesperson_name VARCHAR(255) NOT NULL,
            zoho_salesperson_phone VARCHAR(20) NULL,
            painter_id INT NULL,
            match_confidence ENUM('exact_phone','exact_name','fuzzy_name','unmatched') DEFAULT 'unmatched',
            last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_painter (painter_id),
            INDEX idx_phone (zoho_salesperson_phone)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  [5/9] painter_zoho_salesperson_map');

    // 6. painter_pntr_import_runs
    await pool.query(`
        CREATE TABLE IF NOT EXISTS painter_pntr_import_runs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            run_type ENUM('initial_bulk','incremental_daily','manual') NOT NULL,
            started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP NULL,
            total_zoho_pntr_customers INT DEFAULT 0,
            imported_count INT DEFAULT 0,
            linked_existing_painter INT DEFAULT 0,
            duplicates_queued INT DEFAULT 0,
            branch_unresolved_count INT DEFAULT 0,
            errors_count INT DEFAULT 0,
            triggered_by INT NULL,
            notes TEXT NULL,
            status ENUM('running','completed','failed') DEFAULT 'running',
            INDEX idx_started (started_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  [6/9] painter_pntr_import_runs');

    // 7. painter_lead_duplicate_queue
    await pool.query(`
        CREATE TABLE IF NOT EXISTS painter_lead_duplicate_queue (
            id INT AUTO_INCREMENT PRIMARY KEY,
            original_painter_lead_id INT NULL,
            duplicate_zoho_customer_id VARCHAR(50) NOT NULL,
            duplicate_zoho_name VARCHAR(255) NOT NULL,
            duplicate_phone VARCHAR(20) NOT NULL,
            resolution ENUM('pending','merged','kept_original','kept_duplicate','ignored') DEFAULT 'pending',
            resolved_by INT NULL,
            resolved_at TIMESTAMP NULL,
            notes TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_resolution (resolution)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  [7/9] painter_lead_duplicate_queue');

    // 8. painter_zoho_sync_queue
    await pool.query(`
        CREATE TABLE IF NOT EXISTS painter_zoho_sync_queue (
            id INT AUTO_INCREMENT PRIMARY KEY,
            painter_id INT NOT NULL,
            sync_type ENUM('customer','salesperson','both') NOT NULL,
            status ENUM('pending','processing','completed','failed') DEFAULT 'pending',
            attempts INT DEFAULT 0,
            last_error TEXT NULL,
            next_retry_at TIMESTAMP NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP NULL,
            INDEX idx_status_retry (status, next_retry_at),
            INDEX idx_painter (painter_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  [8/9] painter_zoho_sync_queue');

    // 9. ALTER painters — skip gracefully if table doesn't exist (e.g. fresh local DB;
    //    run migrate-painters.js first in that case, then re-run this migration)
    const [[{ painters_exists }]] = await pool.query(
        `SELECT COUNT(*) AS painters_exists FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'painters'`
    );
    if (!painters_exists) {
        console.log('  [9/9] painters ALTER — SKIPPED (table not found; run migrate-painters.js first)');
    } else {
        const painterAlters = [
            "ADD COLUMN IF NOT EXISTS zoho_customer_id VARCHAR(50) NULL",
            "ADD COLUMN IF NOT EXISTS zoho_salesperson_id VARCHAR(50) NULL",
            "ADD COLUMN IF NOT EXISTS created_via ENUM('zoho_import','staff_convert','admin_add','self_register','referral') DEFAULT 'self_register'",
            "ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP NULL",
            "ADD COLUMN IF NOT EXISTS source_lead_id INT NULL",
            "ADD INDEX IF NOT EXISTS idx_zoho_customer (zoho_customer_id)",
            "ADD INDEX IF NOT EXISTS idx_zoho_salesperson (zoho_salesperson_id)",
            "ADD INDEX IF NOT EXISTS idx_activated (activated_at)"
        ];
        for (const clause of painterAlters) {
            try { await pool.query(`ALTER TABLE painters ${clause}`); }
            catch (e) { if (!/Duplicate|exists/i.test(e.message)) throw e; }
        }
        console.log('  [9/9] painters ALTER');
    }

    // 10. ALTER painter_invoices_processed — existing column is `invoice_id` (not zoho_invoice_id),
    //     existing UNIQUE is idx_invoice on invoice_id alone.
    //     Keep invoice_id as the universal dedup key (EST-{id} for estimates,
    //     ZINV-{zohoId}-direct or ZINV-{zohoId}-salesperson for the new backfill types).
    //     Skip gracefully if table doesn't exist (run migrate-painters.js first).
    const [[{ pip_exists }]] = await pool.query(
        `SELECT COUNT(*) AS pip_exists FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'painter_invoices_processed'`
    );
    if (!pip_exists) {
        console.log('  [10] painter_invoices_processed ALTER — SKIPPED (table not found; run migrate-painters.js first)');
    } else {
        const pipAlters = [
            "ADD COLUMN IF NOT EXISTS attribution_type ENUM('direct_billing','salesperson','painter_estimate') DEFAULT 'painter_estimate'",
            "ADD COLUMN IF NOT EXISTS source_invoice_date DATE NULL",
            "ADD COLUMN IF NOT EXISTS zoho_invoice_id VARCHAR(50) NULL"
        ];
        for (const clause of pipAlters) {
            try { await pool.query(`ALTER TABLE painter_invoices_processed ${clause}`); }
            catch (e) { if (!/Duplicate|exists/i.test(e.message)) throw e; }
        }
        try { await pool.query(`ALTER TABLE painter_invoices_processed DROP INDEX idx_invoice`); }
        catch (e) { if (!/check that.*exists|doesn.*exist/i.test(e.message)) console.warn('  drop idx_invoice:', e.message); }
        try {
            await pool.query(`ALTER TABLE painter_invoices_processed ADD UNIQUE KEY uniq_painter_invoice_type (painter_id, invoice_id, attribution_type)`);
        } catch (e) { if (!/Duplicate|exists/i.test(e.message)) throw e; }
        console.log('  [10] painter_invoices_processed ALTER');
    }

    console.log('Done.');
    await pool.end();
}
run().catch(err => { console.error(err); process.exit(1); });
