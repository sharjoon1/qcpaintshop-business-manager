require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/database').createPool();

async function migrate() {
    console.log('=== Estimate Payment + PO Migration ===');

    const paymentCols = [
        "ADD COLUMN IF NOT EXISTS payment_status ENUM('unpaid','partial','paid') DEFAULT 'unpaid'",
        "ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50)",
        "ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(255)",
        "ADD COLUMN IF NOT EXISTS payment_amount DECIMAL(12,2) DEFAULT 0",
        "ADD COLUMN IF NOT EXISTS payment_recorded_by INT",
        "ADD COLUMN IF NOT EXISTS payment_recorded_at DATETIME",
        "ADD COLUMN IF NOT EXISTS billing_invoice_id INT",
        "ADD INDEX IF NOT EXISTS idx_payment_status (payment_status)"
    ];
    for (const col of paymentCols) {
        try { await pool.query('ALTER TABLE estimates ' + col); }
        catch (e) { if (!e.message.includes('Duplicate')) console.warn('Skip:', e.message); }
    }
    console.log('Added payment columns to estimates');

    const poCols = [
        "ADD COLUMN IF NOT EXISTS estimate_id INT",
        "ADD COLUMN IF NOT EXISTS delivery_name VARCHAR(255)",
        "ADD COLUMN IF NOT EXISTS delivery_phone VARCHAR(20)",
        "ADD COLUMN IF NOT EXISTS delivery_address TEXT",
        "ADD COLUMN IF NOT EXISTS is_third_party BOOLEAN DEFAULT false",
        "ADD INDEX IF NOT EXISTS idx_estimate (estimate_id)"
    ];
    for (const col of poCols) {
        try { await pool.query('ALTER TABLE vendor_purchase_orders ' + col); }
        catch (e) { if (!e.message.includes('Duplicate')) console.warn('Skip:', e.message); }
    }
    console.log('Added delivery columns to vendor_purchase_orders');

    console.log('=== Migration Complete ===');
    process.exit(0);
}

migrate().catch(err => { console.error('Migration failed:', err); process.exit(1); });
