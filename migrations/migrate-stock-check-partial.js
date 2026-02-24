/**
 * Stock Check Partial (Batch) Submission Migration
 *
 * Run: node migrations/migrate-stock-check-partial.js
 *
 * Changes:
 * 1. Add item_status column to stock_check_items (pending/checked/submitted/adjusted)
 * 2. Backfill item_status based on existing assignment status and reported_qty
 */

const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

async function migrate() {
    let pool;
    try {
        pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'business_manager',
            port: process.env.DB_PORT || 3306
        });

        console.log('Connected. Running stock check partial submission migration...\n');

        // 1. Add item_status column
        console.log('1. Adding item_status column to stock_check_items...');
        try {
            await pool.query(`
                ALTER TABLE stock_check_items
                ADD COLUMN item_status ENUM('pending','checked','submitted','adjusted') DEFAULT 'pending' AFTER notes
            `);
            console.log('   OK - item_status column added');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
                console.log('   SKIP - column already exists');
            } else {
                console.error('   ERROR:', err.message);
            }
        }

        // 2. Add index on item_status for efficient queries
        console.log('2. Adding index on item_status...');
        try {
            await pool.query(`
                ALTER TABLE stock_check_items
                ADD INDEX idx_item_status (assignment_id, item_status)
            `);
            console.log('   OK - index added');
        } catch (err) {
            if (err.code === 'ER_DUP_KEYNAME' || err.message.includes('Duplicate key name')) {
                console.log('   SKIP - index already exists');
            } else {
                console.error('   ERROR:', err.message);
            }
        }

        // 3. Backfill existing data
        console.log('3. Backfilling item_status for existing records...');

        // 3a. Assignments with status 'reviewed' or 'adjusted' — items with reported_qty → 'adjusted'
        const [adjResult] = await pool.query(`
            UPDATE stock_check_items sci
            INNER JOIN stock_check_assignments sca ON sci.assignment_id = sca.id
            SET sci.item_status = 'adjusted'
            WHERE sca.status IN ('reviewed', 'adjusted')
              AND sci.reported_qty IS NOT NULL
              AND sci.item_status = 'pending'
        `);
        console.log(`   Adjusted items (reviewed/adjusted assignments): ${adjResult.affectedRows}`);

        // 3b. Assignments with status 'submitted' — items with reported_qty → 'submitted'
        const [subResult] = await pool.query(`
            UPDATE stock_check_items sci
            INNER JOIN stock_check_assignments sca ON sci.assignment_id = sca.id
            SET sci.item_status = 'submitted'
            WHERE sca.status = 'submitted'
              AND sci.reported_qty IS NOT NULL
              AND sci.item_status = 'pending'
        `);
        console.log(`   Submitted items (submitted assignments): ${subResult.affectedRows}`);

        // 3c. Assignments still 'pending' — items with reported_qty → 'checked' (saved progress)
        const [chkResult] = await pool.query(`
            UPDATE stock_check_items sci
            INNER JOIN stock_check_assignments sca ON sci.assignment_id = sca.id
            SET sci.item_status = 'checked'
            WHERE sca.status = 'pending'
              AND sci.reported_qty IS NOT NULL
              AND sci.item_status = 'pending'
        `);
        console.log(`   Checked items (pending assignments with saved progress): ${chkResult.affectedRows}`);

        console.log('\n=== Migration complete! ===');

    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate();
